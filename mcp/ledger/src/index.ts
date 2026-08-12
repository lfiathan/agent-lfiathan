import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// The agent's web_fetch refuses loopback addresses and offers no override, so
// this server is how a finance agent reaches the ledger at all. It runs as a
// stdio subprocess of the gateway, which puts it outside that restriction.
const API_BASE = process.env.LFIATHAN_API_BASE ?? "http://localhost:3000";
const API_KEY = process.env.LFIATHAN_API_KEY ?? "";
const USER_ID = process.env.LFIATHAN_USER_ID ?? "";

const APPROVAL_RULE =
  "Present the candidate and wait for the user's explicit go-ahead before calling this. " +
  "Never decide on your own initiative — a decided candidate never returns to the queue.";

const tools = [
  {
    name: "ledger_list_transactions",
    description:
      "List recorded transactions, newest first. This is the authoritative ledger; never answer from memory.",
    inputSchema: {
      type: "object" as const,
      properties: {
        type: { type: "string", enum: ["income", "expense"] },
        from: { type: "string", description: "ISO date, inclusive lower bound" },
        to: { type: "string", description: "ISO date, inclusive upper bound" },
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ledger_balance",
    description:
      "What he actually has. Use this for any question about balance or how much is left — " +
      "never sum the whole ledger, which only sees outflows and always reads hugely negative. " +
      "Counts forward from the last self-reported saldo-awal anchor and excludes transfers. " +
      "If anchoredAt is null there is no anchor and the balance is unknown; say so.",
    inputSchema: {
      type: "object" as const,
      properties: {
        currency: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ledger_summary",
    description: "Totals per type and currency over an optional date range.",
    inputSchema: {
      type: "object" as const,
      properties: {
        from: { type: "string" },
        to: { type: "string" },
        currency: { type: "string" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ledger_list_pending_approvals",
    description:
      "Email-imported candidates awaiting a decision. Bank mail goes straight to the ledger; " +
      "everything else waits here because marketing mail parses into confident nonsense.",
    inputSchema: {
      type: "object" as const,
      properties: {
        limit: { type: "integer", minimum: 1, maximum: 500 },
      },
      additionalProperties: false,
    },
  },
  {
    name: "ledger_approve_candidate",
    description:
      `Record a pending candidate in the ledger, optionally correcting it first. ${APPROVAL_RULE} ` +
      "The importer guesses direction badly on marketplace mail — check whether the email is " +
      "seller-side or buyer-side before accepting inferredType.",
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string", description: "Approval id from ledger_list_pending_approvals" },
        amount: { type: "number", exclusiveMinimum: 0 },
        currency: { type: "string" },
        inferredType: { type: "string", enum: ["income", "expense"] },
        category: { type: "string" },
        occurredAt: { type: "string", description: "ISO date-time" },
      },
      required: ["id"],
      additionalProperties: false,
    },
  },
  {
    name: "ledger_reject_candidate",
    description: `Discard a pending candidate without recording it. ${APPROVAL_RULE}`,
    inputSchema: {
      type: "object" as const,
      properties: {
        id: { type: "string" },
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
    // Translated rather than passed through raw: these three carry meaning the
    // agent should act on rather than retry blindly.
    if (response.status === 401) throw new Error("401 — the ledger API key was rejected.");
    if (response.status === 403) {
      throw new Error("403 — this key is not scoped for that resource. Say so; do not retry.");
    }
    if (response.status === 409) {
      throw new Error("409 — that candidate was already approved or rejected.");
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
    case "ledger_list_transactions":
      return call(
        `/api/transactions/user/${USER_ID}${query({
          type: args.type,
          from: args.from,
          to: args.to,
          limit: args.limit,
        })}`
      );

    case "ledger_balance":
      return call(
        `/api/transactions/user/${USER_ID}/balance${query({ currency: args.currency })}`
      );

    case "ledger_summary":
      return call(
        `/api/transactions/user/${USER_ID}/summary${query({
          from: args.from,
          to: args.to,
          currency: args.currency,
        })}`
      );

    case "ledger_list_pending_approvals":
      return call(
        `/api/transactions/approvals/user/${USER_ID}${query({
          status: "pending",
          limit: args.limit,
        })}`
      );

    case "ledger_approve_candidate": {
      const { id, ...overrides } = args;
      if (!id) throw new Error("id is required");
      return call(`/api/transactions/approvals/${String(id)}/approve`, {
        method: "POST",
        body: JSON.stringify(overrides),
      });
    }

    case "ledger_reject_candidate": {
      if (!args.id) throw new Error("id is required");
      return call(`/api/transactions/approvals/${String(args.id)}/reject`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

const server = new Server(
  { name: "agent-lfiathan-ledger", version: "0.1.0" },
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
    // Errors are returned as content rather than thrown so the agent reads the
    // reason and can tell the user, instead of seeing an opaque tool failure.
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
  process.stderr.write(`ledger mcp failed to start: ${String(err)}\n`);
  process.exit(1);
});
