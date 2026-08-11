# CLAUDE.md — agent-lfiathan

Financial agent backend powered by Hermes, Fastify, PostgreSQL (Knex), and Redis.

## CHRONICLE memory

This project is wired to the CHRONICLE MCP memory server (`chronicle`), part of
Muhammad Alif Aditya's TA research (implementation in `~/repositories/chronicle`).

The tools are `mcp__plugin_chronicle-memory_chronicle__memory_search` and
`..._memory_store`. They are deferred — if they are not in your active toolset,
load them with `ToolSearch` (`select:mcp__plugin_chronicle-memory_chronicle__memory_search`).
`ToolSearch` waits for a server that is still connecting, so "still connecting"
is never a reason to skip the call.

- **Before your first Read, Grep, or Edit in a session**, call `memory_search` with
  a description of the task. No triviality exemption — a one-line lookup is exactly
  the case where a stored answer beats re-deriving it. If it returns nothing useful,
  you have lost one call.
- Whenever you **make a decision, discover a constraint/convention, fix a non-trivial
  bug, or learn something a future session should know**, call `memory_store` with
  the session id, task, action, touched files, and a one-sentence insight.
- If either tool returns an `error` field (e.g. the pgvector DB on port 5433 is
  unreachable), **say so in your reply to the user** and note that you are working
  without project memory. Do not silently continue as if memory were empty.
