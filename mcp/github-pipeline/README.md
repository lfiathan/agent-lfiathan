# GitHub Pipeline MCP Server

Minimal MCP server to read GitHub repo info, create PRs, trigger workflows, deploy to VPS, and run npm scripts.

## Setup

1. `cd mcp/github-pipeline`
2. `npm install`
3. `cp .env.example .env` and fill in your values
4. `npm run dev` (development) or `npm run build && npm start` (production)

## Environment

Create a `.env` file in this directory (see `.env.example`):

**Required:**
- `GITHUB_TOKEN` — Personal access token with `repo` + `workflow` scopes
- `GITHUB_OWNER` — GitHub username or organization
- `GITHUB_REPO` — Repository name

**Optional:**
- `GITHUB_DEFAULT_BRANCH` — Default branch (default: `main`)
- `GITHUB_API_URL` — GitHub Enterprise API base URL
- `REPO_PATH` — Path to repo root (auto-detected from MCP server location)

## Tools

| Tool | Description |
|------|-------------|
| `github_get_repo` | Get basic repository metadata |
| `github_create_pr` | Create a pull request |
| `github_trigger_workflow` | Trigger a GitHub Actions workflow dispatch |
| `github_list_workflows` | List all workflows with IDs and status |
| `deploy_to_vps` | Trigger the deploy workflow to ship to VPS |
| `list_npm_scripts` | List npm scripts from package.json |
| `run_npm_script` | Run an npm script |

## MCP Client Config

Add to your MCP client config (e.g. Claude Desktop, Gemini Code Assist):

```json
{
  "mcpServers": {
    "github-pipeline": {
      "command": "node",
      "args": ["/path/to/agent-lfiathan/mcp/github-pipeline/dist/index.js"],
      "env": {
        "GITHUB_TOKEN": "ghp_...",
        "GITHUB_OWNER": "lfiathan",
        "GITHUB_REPO": "agent-lfiathan",
        "REPO_PATH": "/path/to/agent-lfiathan"
      }
    }
  }
}
```

Or if you have a `.env` file configured, you can skip the `env` block — the server loads `dotenv` automatically.
