# Ledger MCP server

Gives an OpenClaw agent read access to the transaction ledger and the ability to
work the email-import approval queue.

## Why this exists

The agent cannot call the API directly. Its `web_fetch` tool refuses loopback
addresses, and `tools.web.fetch.ssrfPolicy` exposes no setting that changes
that — only RFC 2544 and IPv6 ULA ranges. Removing `exec` (so the finance agent
needs no sandbox) rules out shelling to `curl`.

An MCP server runs as a stdio subprocess of the gateway, outside that
restriction, and is the supported way to give an agent capabilities it does not
otherwise have.

## Isolation

**MCP servers are gateway-global in OpenClaw 2026.7.1.** `mcp.servers.<name>`
has no agent-scoping field and `agents.list[]` entries have no `mcp` key, so
every agent sees every registered server. A workspace `.mcp.json` does not work
either — in the shipped build that filename belongs to `openclaw attach`, not
to agent configuration.

Isolation therefore has to come from the other end: deny the tools per agent.

MCP tool names are namespaced with the server name and a **double** underscore,
so `ledger_balance` is addressed as `ledger__ledger_balance`. Denying the bare
name silently matches nothing — the gateway log will report the deny as applied
while every tool stays available.

```json5
// agents.list[] entry for an agent that must not see the ledger
tools: { deny: ["ledger__ledger_list_transactions", "ledger__ledger_balance",
                "ledger__ledger_summary", "ledger__ledger_list_pending_approvals",
                "ledger__ledger_approve_candidate", "ledger__ledger_reject_candidate"] }
```

Check it landed rather than assuming: the gateway log prints
`tool policy removed N tool(s) via agents.<id>.tools.deny: ...` with the names it
actually matched.

This is weaker than per-agent credentials: the API key lives in the gateway
config, so a missing deny entry grants access. The server-side scope check
still bounds the damage — the finance key reaches `/api/transactions` and
`/api/portfolio` and gets a 403 anywhere else.

## Setup

```bash
npm install && npm run build
```

Then register it once, in `~/.openclaw/openclaw.json`:

```json
{
  "mcp": {
    "servers": {
      "ledger": {
        "enabled": true,
        "command": "node",
        "args": ["/opt/agent-lfiathan/mcp/ledger/dist/index.js"],
        "env": {
          "LFIATHAN_API_BASE": "http://localhost:3000",
          "LFIATHAN_API_KEY": "<the finance agent's key>",
          "LFIATHAN_USER_ID": "<ledger owner uuid>"
        }
      }
    }
  }
}
```

Config changes to `mcp` hot-reload; no gateway restart needed.

## Tools

| Tool | Does |
| --- | --- |
| `ledger_list_transactions` | recorded rows, newest first, optional type and date range |
| `ledger_summary` | totals per type and currency |
| `ledger_list_pending_approvals` | candidates awaiting a decision |
| `ledger_approve_candidate` | record one, optionally correcting it first |
| `ledger_reject_candidate` | discard one |

The two deciding tools carry an explicit instruction in their descriptions to
wait for the user's go-ahead. That is guidance to the model, not an enforced
gate — a decided candidate cannot be undone from the queue, so treat the
wording as load-bearing.

`401`, `403` and `409` are translated into sentences the agent can act on
instead of retrying blindly.
