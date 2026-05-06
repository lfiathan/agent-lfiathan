import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { Octokit } from "octokit";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultRepoPath = path.resolve(__dirname, "../../..");

// ─── Tool definitions ───────────────────────────────────────────────
const tools = [
  {
    name: "github_get_repo",
    description: "Get basic repository metadata.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "github_create_pr",
    description: "Create a pull request in the configured repo.",
    inputSchema: {
      type: "object" as const,
      properties: {
        title: { type: "string" },
        body: { type: "string" },
        head: { type: "string" },
        base: { type: "string" },
      },
      required: ["title", "head"],
      additionalProperties: false,
    },
  },
  {
    name: "github_trigger_workflow",
    description: "Trigger a GitHub Actions workflow dispatch.",
    inputSchema: {
      type: "object" as const,
      properties: {
        workflow_id: { type: "string" },
        ref: { type: "string" },
        inputs: {
          type: "object",
          additionalProperties: { type: "string" },
        },
      },
      required: ["workflow_id"],
      additionalProperties: false,
    },
  },
  {
    name: "github_list_workflows",
    description:
      "List all GitHub Actions workflows in the repo with their IDs and status.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "deploy_to_vps",
    description:
      "Trigger the CI/CD deploy workflow to deploy the latest main branch to the VPS. Optionally specify a branch.",
    inputSchema: {
      type: "object" as const,
      properties: {
        ref: {
          type: "string",
          description: "Branch to deploy (default: main)",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "list_npm_scripts",
    description: "List npm scripts from the repo package.json.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      additionalProperties: false,
    },
  },
  {
    name: "run_npm_script",
    description: "Run an npm script from the repo package.json.",
    inputSchema: {
      type: "object" as const,
      properties: {
        script: { type: "string" },
        args: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["script"],
      additionalProperties: false,
    },
  },
];

// ─── Schemas ────────────────────────────────────────────────────────
const githubConfigSchema = z.object({
  token: z.string().min(1, "GITHUB_TOKEN is required"),
  owner: z.string().min(1, "GITHUB_OWNER is required"),
  repo: z.string().min(1, "GITHUB_REPO is required"),
  apiUrl: z.string().min(1).optional(),
  defaultBranch: z.string().min(1).optional(),
});

const createPrSchema = z.object({
  title: z.string().min(1),
  body: z.string().optional(),
  head: z.string().min(1),
  base: z.string().optional(),
});

const triggerWorkflowSchema = z.object({
  workflow_id: z.string().min(1),
  ref: z.string().optional(),
  inputs: z.record(z.string()).optional(),
});

const deploySchema = z.object({
  ref: z.string().optional(),
});

const runScriptSchema = z.object({
  script: z.string().min(1),
  args: z.array(z.string()).optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────
function getRepoPath(): string {
  return path.resolve(process.env.REPO_PATH || defaultRepoPath);
}

function getGitHubConfig() {
  const result = githubConfigSchema.safeParse({
    token: process.env.GITHUB_TOKEN,
    owner: process.env.GITHUB_OWNER,
    repo: process.env.GITHUB_REPO,
    apiUrl: process.env.GITHUB_API_URL,
    defaultBranch: process.env.GITHUB_DEFAULT_BRANCH || "main",
  });

  if (!result.success) {
    const missing = result.error.issues
      .map((i) => `${i.path.join(".")}: ${i.message}`)
      .join(", ");
    throw new Error(
      `GitHub config validation failed: ${missing}. ` +
        `Set GITHUB_TOKEN, GITHUB_OWNER, and GITHUB_REPO in your environment or .env file.`
    );
  }

  return result.data;
}

let octokit: Octokit | null = null;

function getOctokit() {
  const config = getGitHubConfig();
  if (!octokit) {
    octokit = new Octokit({
      auth: config.token,
      ...(config.apiUrl ? { baseUrl: config.apiUrl } : {}),
    });
  }
  return { client: octokit, config };
}

function asText(value: unknown) {
  return {
    content: [{ type: "text" as const, text: String(value) }],
  };
}

function asJson(value: unknown) {
  return asText(JSON.stringify(value, null, 2));
}

function asError(message: string) {
  return {
    content: [{ type: "text" as const, text: message }],
    isError: true,
  };
}

function trimOutput(output: string, limit = 12000) {
  if (output.length <= limit) {
    return output;
  }
  return `${output.slice(0, limit)}\n...truncated`;
}

async function listScripts() {
  const repoPath = getRepoPath();
  const packagePath = path.join(repoPath, "package.json");
  const raw = await fs.readFile(packagePath, "utf-8");
  const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
  return parsed.scripts || {};
}

async function runScript(script: string, args: string[]) {
  const repoPath = getRepoPath();
  const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";
  const cmdArgs = ["run", script, "--", ...args];

  try {
    const result = await execFileAsync(npmCmd, cmdArgs, {
      cwd: repoPath,
      env: process.env,
    });
    return {
      ok: true,
      stdout: trimOutput(result.stdout ?? ""),
      stderr: trimOutput(result.stderr ?? ""),
    };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & {
      stdout?: string;
      stderr?: string;
      code?: number;
    };
    return {
      ok: false,
      code: err.code ?? null,
      stdout: trimOutput(err.stdout ?? ""),
      stderr: trimOutput(err.stderr ?? ""),
      message: err.message,
    };
  }
}

// ─── Server setup ───────────────────────────────────────────────────
const server = new Server(
  { name: "github-pipeline-mcp", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  try {
    switch (request.params.name) {
      case "github_get_repo": {
        const { client, config } = getOctokit();
        const response = await client.rest.repos.get({
          owner: config.owner,
          repo: config.repo,
        });
        const data = response.data;
        return asJson({
          id: data.id,
          name: data.name,
          full_name: data.full_name,
          private: data.private,
          default_branch: data.default_branch,
          html_url: data.html_url,
          description: data.description,
          updated_at: data.updated_at,
        });
      }

      case "github_create_pr": {
        const args = createPrSchema.parse(request.params.arguments || {});
        const { client, config } = getOctokit();
        const response = await client.rest.pulls.create({
          owner: config.owner,
          repo: config.repo,
          title: args.title,
          body: args.body,
          head: args.head,
          base: args.base || config.defaultBranch || "main",
        });
        return asJson({
          number: response.data.number,
          url: response.data.html_url,
          state: response.data.state,
          title: response.data.title,
        });
      }

      case "github_trigger_workflow": {
        const args = triggerWorkflowSchema.parse(
          request.params.arguments || {}
        );
        const { client, config } = getOctokit();
        await client.rest.actions.createWorkflowDispatch({
          owner: config.owner,
          repo: config.repo,
          workflow_id: args.workflow_id,
          ref: args.ref || config.defaultBranch || "main",
          inputs: args.inputs,
        });
        return asText("Workflow dispatch requested.");
      }

      case "github_list_workflows": {
        const { client, config } = getOctokit();
        const response = await client.rest.actions.listRepoWorkflows({
          owner: config.owner,
          repo: config.repo,
        });
        const workflows = response.data.workflows.map((w) => ({
          id: w.id,
          name: w.name,
          path: w.path,
          state: w.state,
          html_url: w.html_url,
        }));
        return asJson({ total_count: response.data.total_count, workflows });
      }

      case "deploy_to_vps": {
        const args = deploySchema.parse(request.params.arguments || {});
        const { client, config } = getOctokit();
        const ref = args.ref || config.defaultBranch || "main";

        try {
          await client.rest.actions.createWorkflowDispatch({
            owner: config.owner,
            repo: config.repo,
            workflow_id: "deploy.yml",
            ref,
          });
          return asJson({
            ok: true,
            message: `Deploy workflow triggered on branch '${ref}'.`,
            note: "Check the Actions tab in GitHub for deployment progress.",
          });
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : "Unknown error";
          return asError(
            `Failed to trigger deploy workflow: ${msg}. ` +
              `Make sure .github/workflows/deploy.yml exists and workflow_dispatch is enabled.`
          );
        }
      }

      case "list_npm_scripts": {
        const scripts = await listScripts();
        return asJson(scripts);
      }

      case "run_npm_script": {
        const args = runScriptSchema.parse(request.params.arguments || {});
        const scripts = await listScripts();
        if (!scripts[args.script]) {
          return asJson({
            ok: false,
            message: `Script not found: ${args.script}`,
            scripts: Object.keys(scripts),
          });
        }
        const result = await runScript(args.script, args.args ?? []);
        return asJson(result);
      }

      default:
        return asError(`Unknown tool: ${request.params.name}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return asError(`Tool execution failed: ${message}`);
  }
});

// ─── Start ──────────────────────────────────────────────────────────
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("github-pipeline-mcp server running on stdio");
}

main().catch((err) => {
  console.error("Fatal error starting MCP server:", err);
  process.exit(1);
});
