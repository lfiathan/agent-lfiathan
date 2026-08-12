import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// Registered as its own gateway MCP server, separate from the ledger one, so
// it carries the training agent's own API key. The server-side scope check
// then still applies: this key reaches /api/dietary and /api/strava and gets a
// 403 anywhere else, which is the only real boundary — MCP servers themselves
// are visible to every agent in this OpenClaw version.
const API_BASE = process.env.LFIATHAN_API_BASE ?? "http://localhost:3000";
const API_KEY = process.env.LFIATHAN_API_KEY ?? "";
const USER_ID = process.env.LFIATHAN_USER_ID ?? "";

const DAY_MODEL =
  "The log holds one row per DAY, not one per meal. To record a meal: read the day first, " +
  "and if it exists update it by sending the full food_entries array with the new item appended — " +
  "sending only the new item replaces the day's food. If no row exists, create one.";

const tools = [
  {
    name: "dietary_get_day",
    description:
      `Read one day of food and training. A day with no entry returns found:false — that is normal, not an error. ${DAY_MODEL}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["date"],
      additionalProperties: false,
    },
  },
  {
    name: "dietary_list",
    description:
      "Read a range of days, for progress questions. Never answer from memory about what he ate " +
      "or lifted — read it. Optional training_only limits to days with a training block.",
    inputSchema: {
      type: "object" as const,
      properties: {
        from: { type: "string", description: "YYYY-MM-DD" },
        to: { type: "string", description: "YYYY-MM-DD" },
        training_only: { type: "boolean" },
        limit: { type: "integer", minimum: 1, maximum: 400 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "dietary_log_day",
    description:
      `Create the log for a day that has none yet. ${DAY_MODEL} ` +
      "Log what he actually reported; do not invent macros he did not give. An estimate is fine " +
      "when you say it is an estimate.",
    inputSchema: {
      type: "object" as const,
      properties: {
        log_date: { type: "string", description: "YYYY-MM-DD" },
        calories: { type: "integer", minimum: 0 },
        protein_g: { type: "number", minimum: 0 },
        carbs_g: { type: "number", minimum: 0 },
        fat_g: { type: "number", minimum: 0 },
        fiber_g: { type: "number", minimum: 0 },
        water_ml: { type: "integer", minimum: 0 },
        training_block: { type: "boolean" },
        training_intensity: {
          type: "string",
          enum: ["easy", "tempo", "long", "interval", "race", "recovery", "rest"],
        },
        training_distance_km: { type: "number", minimum: 0 },
        training_notes: { type: "string", maxLength: 5000 },
        supplement_creatine: { type: "boolean" },
        supplement_magnesium: { type: "boolean" },
        supplement_vitamin_c: { type: "boolean" },
        food_entries: {
          type: "array",
          description: "Each item: name (required), plus optional grams, calories, protein_g, carbs_g, fat_g, meal.",
          items: { type: "object" },
        },
        notes: { type: "string", maxLength: 5000 },
      },
      required: ["log_date"],
      additionalProperties: false,
    },
  },
  {
    name: "dietary_update_day",
    description:
      `Change a day already logged — correcting a figure, or appending a meal. ${DAY_MODEL} ` +
      "Get the id from dietary_get_day or dietary_list.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Dietary log id for that day" },
        calories: { type: "integer", minimum: 0 },
        protein_g: { type: "number", minimum: 0 },
        carbs_g: { type: "number", minimum: 0 },
        fat_g: { type: "number", minimum: 0 },
        fiber_g: { type: "number", minimum: 0 },
        water_ml: { type: "integer", minimum: 0 },
        training_block: { type: "boolean" },
        training_intensity: {
          type: "string",
          enum: ["easy", "tempo", "long", "interval", "race", "recovery", "rest"],
        },
        training_distance_km: { type: "number", minimum: 0 },
        training_notes: { type: "string", maxLength: 5000 },
        supplement_creatine: { type: "boolean" },
        supplement_magnesium: { type: "boolean" },
        supplement_vitamin_c: { type: "boolean" },
        food_entries: { type: "array", items: { type: "object" } },
        notes: { type: "string", maxLength: 5000 },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
];

type Json = Record<string, unknown>;

async function call(path: string, init: RequestInit = {}): Promise<Json> {
  if (!API_KEY) throw new Error("LFIATHAN_API_KEY is not set");
  if (!USER_ID) throw new Error("LFIATHAN_USER_ID is not set");

  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "x-api-key": API_KEY,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });

  const text = await response.text();

  if (!response.ok) {
    if (response.status === 401) throw new Error("401 — the API key was rejected.");
    if (response.status === 403) {
      throw new Error("403 — this key is not scoped for that resource. Say so; do not retry.");
    }
    // Deliberately NOT thrown. A day with no row is the normal case in the
    // read-then-create flow, and surfacing it as a tool error made routine
    // backfilling look like the tool was broken.
    if (response.status === 404) {
      return { found: false, note: "No log exists for that day yet — create one." };
    }
    throw new Error(`${response.status} — ${text.slice(0, 300)}`);
  }

  return text ? (JSON.parse(text) as Json) : {};
}

function query(params: Record<string, unknown>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== "") q.set(k, String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

async function dispatch(name: string, args: Json): Promise<Json> {
  switch (name) {
    case "dietary_get_day":
      return call(`/api/dietary/user/${USER_ID}/date/${String(args.date)}`);

    case "dietary_list":
      return call(
        `/api/dietary/user/${USER_ID}${query({
          from: args.from,
          to: args.to,
          training_only: args.training_only,
          limit: args.limit,
        })}`
      );

    case "dietary_log_day":
      return call("/api/dietary", {
        method: "POST",
        body: JSON.stringify({ user_id: USER_ID, ...args }),
      });

    case "dietary_update_day": {
      const { id, ...patch } = args;
      if (!id) throw new Error("id is required");
      return call(`/api/dietary/${String(id)}`, {
        method: "PUT",
        body: JSON.stringify(patch),
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: "agent-lfiathan-trainer", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const name = request.params.name;
  const args = (request.params.arguments ?? {}) as Json;

  try {
    const result = await dispatch(name, args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  } catch (err) {
    return {
      content: [
        { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
      ],
      isError: true,
    };
  }
});

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`trainer mcp failed to start: ${String(err)}\n`);
  process.exit(1);
});
