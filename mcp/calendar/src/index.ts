import "dotenv/config";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { readFileSync } from "node:fs";
import ical from "node-ical";
import type { CalendarResponse, VEvent } from "node-ical";

/**
 * Read-only calendar over Google's secret iCal address.
 *
 * Deliberately not OAuth. Calendar scopes are sensitive, so an unverified app
 * stays in Testing where refresh tokens expire every seven days — the same trap
 * that ruled OAuth out for mail. The private ICS URL never expires and needs no
 * console project. It is read-only by nature, which is the whole permission
 * model here: nothing an agent does can alter the calendar.
 *
 * That URL is a credential in its own right: anyone holding it can read the
 * whole calendar. It lives in gateway config, never in a prompt.
 */
function readIcsUrl(): string {
  // Preferred: a file readable only by the gateway user. The URL grants read
  // access to the whole calendar, so keeping it out of config — and out of any
  // transcript — is worth the extra indirection.
  const path = process.env.CALENDAR_ICS_URL_FILE;
  if (path) {
    try {
      return readFileSync(path, "utf8").trim();
    } catch {
      return "";
    }
  }
  return process.env.CALENDAR_ICS_URL ?? "";
}

const ICS_URL = readIcsUrl();
const TZ = process.env.CALENDAR_TZ ?? "Asia/Jakarta";
const CACHE_MS = Number.parseInt(process.env.CALENDAR_CACHE_SECONDS ?? "300", 10) * 1000;

type Json = Record<string, unknown>;

interface Occurrence {
  summary: string;
  start: Date;
  end: Date;
  allDay: boolean;
  location?: string;
  description?: string;
}

let cache: { at: number; events: CalendarResponse } | null = null;

async function loadCalendar(): Promise<CalendarResponse> {
  if (!ICS_URL) throw new Error("Calendar URL not configured — CALENDAR_ICS_URL_FILE is empty or unreadable.");
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.events;

  const events = await ical.async.fromURL(ICS_URL);
  cache = { at: Date.now(), events };
  return events;
}

/**
 * ICS text fields arrive either as a plain string or as { val, params } when
 * the property carried parameters such as ALTREP or LANGUAGE. Both shapes have
 * to be flattened before anything reads them.
 */
function text(v: unknown): string | undefined {
  if (typeof v === "string") return v.trim() || undefined;
  if (v && typeof v === "object" && "val" in (v as Record<string, unknown>)) {
    const val = (v as { val?: unknown }).val;
    return typeof val === "string" ? val.trim() || undefined : undefined;
  }
  return undefined;
}

function fmt(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d).replace(", ", " ");
}

function dayStart(dateStr: string): Date {
  // Interpreted in the calendar's timezone rather than the server's, so "today"
  // means his today.
  return new Date(`${dateStr}T00:00:00${offsetFor(TZ)}`);
}

function offsetFor(tz: string): string {
  const now = new Date();
  const utc = new Date(now.toLocaleString("en-US", { timeZone: "UTC" }));
  const local = new Date(now.toLocaleString("en-US", { timeZone: tz }));
  const mins = Math.round((local.getTime() - utc.getTime()) / 60000);
  const sign = mins >= 0 ? "+" : "-";
  const abs = Math.abs(mins);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
}

/**
 * Expand events in a window, including repeats.
 *
 * A student's calendar is mostly recurring classes, so a parser that ignores
 * RRULE reports an almost empty week. Cancelled and moved instances are honored
 * through the exdate and recurrences fields node-ical provides.
 */
function occurrencesBetween(
  data: CalendarResponse,
  from: Date,
  to: Date
): Occurrence[] {
  const out: Occurrence[] = [];

  for (const key of Object.keys(data)) {
    const ev = data[key] as VEvent;
    if (!ev || ev.type !== "VEVENT" || !ev.start) continue;

    const durationMs =
      (ev.end ? new Date(ev.end).getTime() : new Date(ev.start).getTime()) -
      new Date(ev.start).getTime();
    const allDay = (ev as unknown as { datetype?: string }).datetype === "date";

    const push = (start: Date, summary?: string, location?: string, description?: string) => {
      const end = new Date(start.getTime() + durationMs);
      if (end < from || start > to) return;
      out.push({
        summary: summary ?? text(ev.summary) ?? "(tanpa judul)",
        start,
        end,
        allDay,
        location: location ?? text(ev.location),
        description: description ?? undefined,
      });
    };

    if (ev.rrule) {
      const dates = ev.rrule.between(
        new Date(from.getTime() - durationMs),
        to,
        true
      );
      for (const d of dates) {
        const key = d.toISOString().slice(0, 10);
        const exdate = (ev as unknown as { exdate?: Record<string, unknown> }).exdate ?? {};
        if (Object.keys(exdate).some((k) => k.startsWith(key))) continue;

        const recurrences = (ev as unknown as { recurrences?: Record<string, VEvent> }).recurrences ?? {};
        const moved = Object.entries(recurrences).find(([k]) => k.startsWith(key));
        if (moved) {
          const m = moved[1];
          push(new Date(m.start), text(m.summary), text(m.location), undefined);
          continue;
        }
        push(d);
      }
    } else {
      push(new Date(ev.start));
    }
  }

  out.sort((a, b) => a.start.getTime() - b.start.getTime());
  return out;
}

function serialise(o: Occurrence): Json {
  return {
    summary: o.summary,
    start: fmt(o.start),
    end: fmt(o.end),
    allDay: o.allDay,
    ...(o.location ? { location: o.location } : {}),
  };
}

const tools = [
  {
    name: "calendar_agenda",
    description:
      "His schedule for a date or a range, recurring classes included. Read this before " +
      "assuming he is free, before proposing a time, and before nudging him to do something. " +
      "Defaults to today. Read-only — nothing here can change his calendar.",
    inputSchema: {
      type: "object" as const,
      properties: {
        from: { type: "string", description: "YYYY-MM-DD, defaults to today" },
        to: { type: "string", description: "YYYY-MM-DD, defaults to the from date" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "calendar_upcoming",
    description:
      "The next events from now, across the coming days. Use for what is next rather than " +
      "what fills a particular day.",
    inputSchema: {
      type: "object" as const,
      properties: {
        days: { type: "integer", minimum: 1, maximum: 90, description: "How far ahead to look, default 7" },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "Default 10" },
      },
      additionalProperties: false,
    },
  },
];

async function dispatch(name: string, args: Json): Promise<Json> {
  const data = await loadCalendar();

  if (name === "calendar_agenda") {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date());
    const fromStr = (args.from as string) ?? today;
    const toStr = (args.to as string) ?? fromStr;
    const from = dayStart(fromStr);
    const to = new Date(dayStart(toStr).getTime() + 24 * 60 * 60 * 1000 - 1);
    const events = occurrencesBetween(data, from, to).map(serialise);
    return { timezone: TZ, from: fromStr, to: toStr, count: events.length, events };
  }

  if (name === "calendar_upcoming") {
    const days = (args.days as number) ?? 7;
    const limit = (args.limit as number) ?? 10;
    const now = new Date();
    const to = new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
    const events = occurrencesBetween(data, now, to).slice(0, limit).map(serialise);
    return { timezone: TZ, days, count: events.length, events };
  }

  throw new Error(`Unknown tool: ${name}`);
}

const server = new Server(
  { name: "agent-lfiathan-calendar", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const args = (request.params.arguments ?? {}) as Json;
  try {
    const result = await dispatch(request.params.name, args);
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
  process.stderr.write(`calendar mcp failed to start: ${String(err)}\n`);
  process.exit(1);
});
