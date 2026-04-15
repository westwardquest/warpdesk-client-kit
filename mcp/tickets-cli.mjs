#!/usr/bin/env node
/**
 * List / fetch EDF tickets over HTTP (same routes as MCP). Use when MCP tools are not
 * available in the current chat — agents can run this via the terminal from the workspace root.
 *
 * Usage (cwd = workspace root, where edf.config lives):
 *   node vendor/edf-client-kit/mcp/tickets-cli.mjs list [--limit N] [--status <status>] [--queue]
 *   node vendor/edf-client-kit/mcp/tickets-cli.mjs get <ticketUuid>
 *   node vendor/edf-client-kit/mcp/tickets-cli.mjs lookup <query>
 *   node vendor/edf-client-kit/mcp/tickets-cli.mjs patch <ticketUuid> <path-to.json>
 *
 * Auth: EDF_PERSONAL_ACCESS_TOKEN (env or .cursor/mcp.json edf-tickets env).
 * Base URL: env EDF_BASE_URL, or edf.config DEV_APP_ORIGIN.
 * Slug: edf.config WORKSPACE_SLUG.
 */
import * as fs from "node:fs";
import * as path from "node:path";

function parseConfig(raw) {
  const out = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

function findWorkspaceRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "edf.config"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function loadToken(workspaceRoot) {
  const patEnv = process.env.EDF_PERSONAL_ACCESS_TOKEN?.trim();
  if (patEnv) {
    return patEnv;
  }
  const mcpPath = path.join(workspaceRoot, ".cursor", "mcp.json");
  if (fs.existsSync(mcpPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
      const pat = j?.mcpServers?.["edf-tickets"]?.env?.EDF_PERSONAL_ACCESS_TOKEN;
      if (typeof pat === "string" && pat.trim()) {
        return pat.trim();
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

function baseUrl(cfg) {
  const env = process.env.EDF_BASE_URL?.trim();
  if (env) {
    return env.replace(/\/$/, "");
  }
  const origin = cfg.DEV_APP_ORIGIN?.trim();
  if (!origin) {
    throw new Error(
      "Set DEV_APP_ORIGIN in edf.config or EDF_BASE_URL in the environment.",
    );
  }
  return origin.replace(/\/$/, "");
}

async function apiGet(workspaceRoot, cfg, pathname) {
  const token = loadToken(workspaceRoot);
  if (!token) {
    throw new Error(
      "No personal access token: set EDF_PERSONAL_ACCESS_TOKEN (edf_pat_…) in the environment or in .cursor/mcp.json under mcpServers.edf-tickets.env. Create one in the app: Settings → Personal access tokens.",
    );
  }
  const root = baseUrl(cfg);
  const url = `${root}${pathname}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { res, body };
}

async function apiPatch(workspaceRoot, cfg, pathname, jsonBody) {
  const token = loadToken(workspaceRoot);
  if (!token) {
    throw new Error(
      "No personal access token: set EDF_PERSONAL_ACCESS_TOKEN (edf_pat_…) in the environment or in .cursor/mcp.json under mcpServers.edf-tickets.env.",
    );
  }
  const root = baseUrl(cfg);
  const url = `${root}${pathname}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(jsonBody),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = text;
  }
  return { res, body };
}

function printList(body) {
  if (typeof body !== "object" || body === null || body.ok !== true) {
    console.log(JSON.stringify(body, null, 2));
    return;
  }
  const tickets = body.tickets ?? [];
  const ws = body.workspace;
  if (ws) {
    console.error(`Workspace: ${ws.name} (${ws.slug})  role: ${body.role ?? "?"}`);
  }
  if (tickets.length === 0) {
    console.error("No tickets.");
    return;
  }
  for (const t of tickets) {
    const num = t.ticket_number != null ? `#${t.ticket_number}` : "";
    console.log(`${num}\t${t.status}\t${t.title}\n  id: ${t.id}`);
  }
}

async function main() {
  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error(
      "edf.config not found — run this from the workspace repo root (or a subfolder under it).",
    );
  }
  const cfg = parseConfig(
    fs.readFileSync(path.join(workspaceRoot, "edf.config"), "utf8"),
  );
  const slug = cfg.WORKSPACE_SLUG?.trim();
  if (!slug) {
    throw new Error("edf.config: WORKSPACE_SLUG is required.");
  }

  const argv = process.argv.slice(2);
  const cmd = argv[0] || "list";

  if (cmd === "list") {
    const q = new URLSearchParams();
    for (let i = 1; i < argv.length; i++) {
      if (argv[i] === "--limit" && argv[i + 1]) {
        q.set("limit", argv[++i]);
      } else if (argv[i] === "--status" && argv[i + 1]) {
        q.set("status", argv[++i]);
      } else if (argv[i] === "--queue") {
        q.set("queue", "1");
      }
    }
    const qs = q.toString();
    const pathname = `/api/w/${encodeURIComponent(slug)}/tickets${qs ? `?${qs}` : ""}`;
    const { res, body } = await apiGet(workspaceRoot, cfg, pathname);
    if (!res.ok) {
      console.error(res.status, res.statusText);
      console.log(typeof body === "string" ? body : JSON.stringify(body, null, 2));
      process.exit(1);
    }
    printList(body);
    return;
  }

  if (cmd === "get" && argv[1]) {
    const ticketId = argv[1];
    const pathname = `/api/w/${encodeURIComponent(slug)}/tickets/${encodeURIComponent(ticketId)}`;
    const { res, body } = await apiGet(workspaceRoot, cfg, pathname);
    console.log(
      typeof body === "string" ? body : JSON.stringify(body, null, 2),
    );
    if (!res.ok) {
      process.exit(1);
    }
    return;
  }

  if (cmd === "patch" && argv[1] && argv[2]) {
    const ticketId = argv[1];
    const jsonPath = path.resolve(workspaceRoot, argv[2]);
    const raw = fs.readFileSync(jsonPath, "utf8");
    let payload;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new Error(`Invalid JSON file: ${jsonPath}`);
    }
    const pathname = `/api/w/${encodeURIComponent(slug)}/tickets/${encodeURIComponent(ticketId)}`;
    const { res, body } = await apiPatch(workspaceRoot, cfg, pathname, payload);
    console.log(
      typeof body === "string" ? body : JSON.stringify(body, null, 2),
    );
    if (!res.ok) {
      process.exit(1);
    }
    return;
  }

  if (cmd === "lookup" && argv[1]) {
    const query = argv[1];
    const params = new URLSearchParams({ q: query });
    const pathname = `/api/w/${encodeURIComponent(slug)}/tickets/lookup?${params.toString()}`;
    const { res, body } = await apiGet(workspaceRoot, cfg, pathname);
    console.log(
      typeof body === "string" ? body : JSON.stringify(body, null, 2),
    );
    if (!res.ok) {
      process.exit(1);
    }
    return;
  }

  console.error(`Usage:
  node .../tickets-cli.mjs list [--limit N] [--status <status>] [--queue]
  node .../tickets-cli.mjs get <ticketUuid>
  node .../tickets-cli.mjs lookup <query>
  node .../tickets-cli.mjs patch <ticketUuid> <patch.json>
`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
