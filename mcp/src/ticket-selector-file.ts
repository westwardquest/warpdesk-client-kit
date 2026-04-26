/**
 * Canonical ticket selector JSON for WarpDesk Tools (*.ticket_selector).
 * Single file per workspace; merge + priority sort; bulk time summaries.
 */
import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { loadWorkspaceConfig } from "./workspace-config";

const require = createRequire(import.meta.url);
const wu = require(
  path.join(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../../packages/warpdesk-tools/workspace-users-cache.js",
  ),
) as {
  ensureWorkspaceUsersCacheForSelectorDoc: (params: {
    workspaceRoot: string;
    selectorDoc: unknown;
    fetchUsers: () => Promise<{
      ok: boolean;
      json: { ok?: boolean; users?: unknown } | null;
    }>;
  }) => Promise<void>;
};

export const CANONICAL_SELECTOR_RELATIVE = path.join(
  ".warpdesk",
  "tickets.ticket_selector",
);

const LEGACY_SELECTOR_DIR = path.join(".warpdesk", "ticket-selectors");

/** Must match server `MAX_TICKET_IDS` in time-summaries route. */
export const BULK_TIME_SUMMARY_MAX_IDS = 100;

export type TicketSelectorEntry = {
  id: string;
  ticket_number: number;
  title: string;
  priority_score: number | null;
  status?: string;
  type?: string;
  dev_ms?: number;
  cursor_ms?: number;
  total_ms?: number;
  first_started_at?: string | null;
  ticket_snapshot?: Record<string, unknown>;
  comments_snapshot?: Array<{
    id: string;
    ticket_id?: string;
    body: string;
    visibility: string;
    author_id?: string | null;
    created_at: string;
    parent_comment_id?: string | null;
  }>;
};

export type TicketSelectorDoc = {
  schema_version: number;
  workspace_slug: string;
  tickets: TicketSelectorEntry[];
  active_index: number;
};

export type IncomingTicketRow = {
  id: string;
  ticket_number: number;
  title: string;
  priority_score: number | null;
  status?: string;
  type?: string;
  ticket_snapshot?: Record<string, unknown>;
  comments_snapshot?: TicketSelectorEntry["comments_snapshot"];
};

type BulkSummary = {
  ticket_id: string;
  dev_ms: number;
  cursor_ms: number;
  first_started_at: string | null;
};

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    s,
  );
}

function normalizeIncoming(row: unknown): IncomingTicketRow | null {
  if (!row || typeof row !== "object") return null;
  const r = row as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  if (!isUuid(id)) return null;
  const ticket_number = Number(r.ticket_number);
  if (!Number.isFinite(ticket_number) || ticket_number < 1) return null;
  const title =
    typeof r.title === "string" && r.title.trim() ? r.title.trim() : "(no title)";
  let priority_score: number | null = null;
  if (r.priority_score === null || r.priority_score === undefined) {
    priority_score = null;
  } else if (typeof r.priority_score === "number" && Number.isFinite(r.priority_score)) {
    priority_score = r.priority_score;
  }
  const status = typeof r.status === "string" ? r.status : undefined;
  if (status === "closed") return null;
  const type = typeof r.type === "string" ? r.type : undefined;
  const ticket_snapshot = normalizeTicketSnapshot(r);
  const comments_snapshot = normalizeCommentsSnapshot(r.comments);
  return {
    id,
    ticket_number,
    title,
    priority_score,
    status,
    type,
    ticket_snapshot,
    comments_snapshot,
  };
}

function normalizeTicketSnapshot(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (k === "comments") continue;
    if (
      typeof v === "string" ||
      typeof v === "number" ||
      typeof v === "boolean" ||
      v === null
    ) {
      out[k] = v;
    }
  }
  return out;
}

function normalizeCommentsSnapshot(
  comments: unknown,
): TicketSelectorEntry["comments_snapshot"] {
  if (!Array.isArray(comments)) {
    return [];
  }
  const out: NonNullable<TicketSelectorEntry["comments_snapshot"]> = [];
  for (const c of comments) {
    if (!c || typeof c !== "object") continue;
    const row = c as Record<string, unknown>;
    out.push({
      id: typeof row.id === "string" ? row.id : "",
      ticket_id: typeof row.ticket_id === "string" ? row.ticket_id : undefined,
      body: typeof row.body === "string" ? row.body : "",
      visibility: typeof row.visibility === "string" ? row.visibility : "",
      author_id:
        typeof row.author_id === "string" ? row.author_id : null,
      created_at: typeof row.created_at === "string" ? row.created_at : "",
      parent_comment_id:
        typeof row.parent_comment_id === "string" ? row.parent_comment_id : null,
    });
  }
  return out;
}

export function sortTicketsByPriority(tickets: TicketSelectorEntry[]): TicketSelectorEntry[] {
  return [...tickets].sort((a, b) => {
    const pa = a.priority_score;
    const pb = b.priority_score;
    if (pa === null && pb === null) {
      return b.ticket_number - a.ticket_number;
    }
    if (pa === null) return 1;
    if (pb === null) return -1;
    if (pb !== pa) return pb - pa;
    return b.ticket_number - a.ticket_number;
  });
}

function mergeEntry(
  existing: TicketSelectorEntry | undefined,
  incoming: IncomingTicketRow,
): TicketSelectorEntry {
  const base: TicketSelectorEntry = existing ?? {
    id: incoming.id,
    ticket_number: incoming.ticket_number,
    title: incoming.title,
    priority_score: incoming.priority_score,
  };
  return {
    ...base,
    id: incoming.id,
    ticket_number: incoming.ticket_number,
    title: incoming.title,
    priority_score: incoming.priority_score,
    ...(incoming.status !== undefined ? { status: incoming.status } : {}),
    ...(incoming.type !== undefined ? { type: incoming.type } : {}),
    ...(incoming.ticket_snapshot
      ? { ticket_snapshot: incoming.ticket_snapshot }
      : {}),
    ...(incoming.comments_snapshot
      ? { comments_snapshot: incoming.comments_snapshot }
      : {}),
  };
}

export function readCanonicalSelectorDoc(
  workspaceRoot: string,
): TicketSelectorDoc | null {
  const abs = path.join(workspaceRoot, CANONICAL_SELECTOR_RELATIVE);
  if (!fs.existsSync(abs)) {
    return null;
  }
  try {
    const raw = fs.readFileSync(abs, "utf8");
    const doc = JSON.parse(raw) as TicketSelectorDoc;
    if (!doc || typeof doc !== "object" || !Array.isArray(doc.tickets)) {
      return null;
    }
    return doc;
  } catch {
    return null;
  }
}

function resolveActiveIndexAfterSort(
  previousDoc: TicketSelectorDoc | null,
  sorted: TicketSelectorEntry[],
): number {
  if (sorted.length === 0) return 0;
  let prevId: string | null = null;
  if (previousDoc?.tickets?.length) {
    const idx = Math.min(
      Math.max(0, Number(previousDoc.active_index) || 0),
      previousDoc.tickets.length - 1,
    );
    prevId = previousDoc.tickets[idx]?.id ?? null;
  }
  if (prevId) {
    const j = sorted.findIndex((t) => t.id === prevId);
    if (j >= 0) return j;
  }
  return 0;
}

async function fetchBulkSummaries(params: {
  baseUrl: string;
  token: string;
  slug: string;
  ticketIds: string[];
}): Promise<Map<string, BulkSummary> | null> {
  const { baseUrl, token, slug, ticketIds } = params;
  if (ticketIds.length === 0) {
    return new Map();
  }
  const out = new Map<string, BulkSummary>();
  for (let i = 0; i < ticketIds.length; i += BULK_TIME_SUMMARY_MAX_IDS) {
    const batch = ticketIds.slice(i, i + BULK_TIME_SUMMARY_MAX_IDS);
    const url = `${baseUrl}/api/w/${encodeURIComponent(slug)}/tickets/time-summaries`;
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ ticket_ids: batch }),
    });
    const text = await res.text();
    let json: unknown;
    try {
      json = JSON.parse(text);
    } catch {
      return null;
    }
    if (!res.ok || !json || typeof json !== "object") {
      return null;
    }
    const o = json as Record<string, unknown>;
    if (o.ok !== true || !Array.isArray(o.summaries)) {
      return null;
    }
    for (const s of o.summaries) {
      if (!s || typeof s !== "object") continue;
      const row = s as Record<string, unknown>;
      const ticket_id = typeof row.ticket_id === "string" ? row.ticket_id : "";
      if (!isUuid(ticket_id)) continue;
      const dev_ms = Number(row.dev_ms);
      const cursor_ms = Number(row.cursor_ms);
      if (!Number.isFinite(dev_ms) || !Number.isFinite(cursor_ms)) continue;
      const first_started_at =
        row.first_started_at === null || typeof row.first_started_at === "string"
          ? (row.first_started_at as string | null)
          : null;
      out.set(ticket_id, {
        ticket_id,
        dev_ms: Math.max(0, Math.floor(dev_ms)),
        cursor_ms: Math.max(0, Math.floor(cursor_ms)),
        first_started_at,
      });
    }
  }
  return out;
}

function applySummaries(
  tickets: TicketSelectorEntry[],
  summaries: Map<string, BulkSummary> | null,
): TicketSelectorEntry[] {
  if (!summaries) {
    return tickets;
  }
  return tickets.map((t) => {
    const s = summaries.get(t.id);
    if (!s) {
      return t;
    }
    return {
      ...t,
      dev_ms: s.dev_ms,
      cursor_ms: s.cursor_ms,
      total_ms: s.dev_ms + s.cursor_ms,
      first_started_at: s.first_started_at,
    };
  });
}

export function tryCleanupLegacySelectorFiles(workspaceRoot: string): void {
  const dir = path.join(workspaceRoot, LEGACY_SELECTOR_DIR);
  if (!fs.existsSync(dir)) return;
  try {
    const names = fs.readdirSync(dir);
    for (const name of names) {
      if (!name.endsWith(".ticket_selector")) continue;
      try {
        fs.unlinkSync(path.join(dir, name));
      } catch {
        /* ignore */
      }
    }
  } catch {
    /* ignore */
  }
}

export type SyncCanonicalSelectorResult =
  | { ok: true; relativePath: string; absolutePath: string }
  | { ok: false; reason: string };

/**
 * Merges incoming rows into the canonical selector, sorts by priority, refreshes clocks via bulk API.
 */
export async function syncCanonicalTicketSelector(params: {
  workspaceRoot: string;
  slug: string;
  incoming: IncomingTicketRow[];
}): Promise<SyncCanonicalSelectorResult> {
  const { workspaceRoot, slug, incoming } = params;
  if (incoming.length === 0) {
    return { ok: false, reason: "no incoming tickets" };
  }

  let cfgSlug: string;
  let baseUrl: string;
  let token: string;
  try {
    ({ slug: cfgSlug, baseUrl, token } = loadWorkspaceConfig(workspaceRoot));
  } catch (e) {
    return {
      ok: false,
      reason: e instanceof Error ? e.message : String(e),
    };
  }
  if (cfgSlug !== slug) {
    return {
      ok: false,
      reason: `slug "${slug}" does not match warpdesk.config WORKSPACE_SLUG "${cfgSlug}"`,
    };
  }

  const previous = readCanonicalSelectorDoc(workspaceRoot);
  const byId = new Map<string, TicketSelectorEntry>();
  if (previous?.tickets?.length) {
    for (const t of previous.tickets) {
      if (t?.id && isUuid(t.id)) {
        byId.set(t.id, { ...t });
      }
    }
  }
  for (const row of incoming) {
    const merged = mergeEntry(byId.get(row.id), row);
    byId.set(row.id, merged);
  }

  let mergedList = Array.from(byId.values()).filter((t) => t.status !== "closed");
  mergedList = sortTicketsByPriority(mergedList);
  const active_index = resolveActiveIndexAfterSort(previous, mergedList);

  const summaries = await fetchBulkSummaries({
    baseUrl,
    token,
    slug,
    ticketIds: mergedList.map((t) => t.id),
  });
  mergedList = applySummaries(mergedList, summaries);

  const doc: TicketSelectorDoc = {
    schema_version: 2,
    workspace_slug: slug,
    tickets: mergedList,
    active_index,
  };

  const absolutePath = path.join(workspaceRoot, CANONICAL_SELECTOR_RELATIVE);
  const dir = path.dirname(absolutePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(absolutePath, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  tryCleanupLegacySelectorFiles(workspaceRoot);

  try {
    await wu.ensureWorkspaceUsersCacheForSelectorDoc({
      workspaceRoot,
      selectorDoc: doc,
      fetchUsers: async () => {
        const res = await fetch(
          `${baseUrl}/api/w/${encodeURIComponent(slug)}/users`,
          {
            method: "GET",
            headers: {
              Authorization: `Bearer ${token}`,
              Accept: "application/json",
            },
          },
        );
        const text = await res.text();
        let json: { ok?: boolean; users?: unknown } | null;
        try {
          json = text ? (JSON.parse(text) as { ok?: boolean; users?: unknown }) : null;
        } catch {
          json = null;
        }
        return { ok: res.ok, json };
      },
    });
  } catch {
    /* best-effort cache; ignore */
  }

  return {
    ok: true,
    relativePath: CANONICAL_SELECTOR_RELATIVE.split(path.sep).join("/"),
    absolutePath,
  };
}

export function incomingTicketsFromApiListBody(body: unknown): IncomingTicketRow[] {
  if (!body || typeof body !== "object") return [];
  const o = body as Record<string, unknown>;
  if (o.ok !== true || !Array.isArray(o.tickets)) return [];
  const out: IncomingTicketRow[] = [];
  for (const t of o.tickets) {
    const n = normalizeIncoming(t);
    if (n) out.push(n);
  }
  return out;
}

function extractTicketFromGetBody(body: unknown): IncomingTicketRow[] {
  if (!body || typeof body !== "object") return [];
  const o = body as Record<string, unknown>;
  if (o.ok !== true) return [];
  const ticket = o.ticket;
  const n = normalizeIncoming(ticket);
  return n ? [n] : [];
}

/** Lookup route returns `{ tickets }` without top-level `ok`. */
export function incomingTicketsFromLookupBody(body: unknown): IncomingTicketRow[] {
  if (!body || typeof body !== "object") return [];
  const o = body as Record<string, unknown>;
  const tickets = Array.isArray(o.tickets) ? o.tickets : null;
  if (!tickets) return [];
  const out: IncomingTicketRow[] = [];
  for (const t of tickets) {
    const n = normalizeIncoming(t);
    if (n) {
      out.push({
        ...n,
        priority_score: n.priority_score ?? null,
      });
    }
  }
  return out;
}

/** MCP toolJson returns `status statusText\\n` + JSON body. */
export function parseMcpToolJsonBody(toolText: string): unknown | null {
  const nl = toolText.indexOf("\n");
  if (nl === -1) return null;
  const jsonPart = toolText.slice(nl + 1).trim();
  if (!jsonPart) return null;
  try {
    return JSON.parse(jsonPart) as unknown;
  } catch {
    return null;
  }
}

export async function trySyncTicketSelectorFromMcpToolResponse(params: {
  workspaceRoot: string;
  slug: string;
  toolText: string;
  /** Which response shape to expect after parsing JSON. */
  shape: "list" | "get" | "lookup";
}): Promise<SyncCanonicalSelectorResult> {
  const parsed = parseMcpToolJsonBody(params.toolText);
  if (!parsed) {
    return { ok: false, reason: "could not parse tool response JSON" };
  }
  let incoming: IncomingTicketRow[] = [];
  if (params.shape === "list") {
    incoming = incomingTicketsFromApiListBody(parsed);
  } else if (params.shape === "get") {
    incoming = extractTicketFromGetBody(parsed);
  } else {
    incoming = incomingTicketsFromLookupBody(parsed);
  }
  if (incoming.length === 0) {
    return { ok: false, reason: "no tickets in response" };
  }
  return syncCanonicalTicketSelector({
    workspaceRoot: params.workspaceRoot,
    slug: params.slug,
    incoming,
  });
}
