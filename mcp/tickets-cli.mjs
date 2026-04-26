#!/usr/bin/env node
/**
 * List / fetch WarpDesk tickets over HTTP (same routes as MCP). Use when MCP tools are not
 * available in the current chat — agents can run this via the terminal from the workspace root.
 * Ticket draft apply/reject is not available here; use the warpdesk-tools extension (Confirm/Discard).
 *
 * Usage (cwd = workspace root, where warpdesk.config lives):
 *   node vendor/warpdesk-client-kit/mcp/tickets-cli.mjs list [--limit N] [--status <status>] [--queue]
 *   (after a successful list, updates .warpdesk/tickets.ticket_selector when tsx is available)
 *   node vendor/warpdesk-client-kit/mcp/tickets-cli.mjs get <ticketUuid>
 *   node vendor/warpdesk-client-kit/mcp/tickets-cli.mjs lookup <query>
 *   node vendor/warpdesk-client-kit/mcp/tickets-cli.mjs patch <ticketUuid> <path-to.json>
 *
 * Auth: WARPDESK_PERSONAL_ACCESS_TOKEN (env or .cursor/mcp.json warpdesk-tickets env).
 * Base URL: env WARPDESK_BASE_URL, or warpdesk.config DEV_APP_ORIGIN.
 * Slug: warpdesk.config WORKSPACE_SLUG.
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { findWorkspaceRoot } from "./workspace-root.mjs";

const __dirnameCli = path.dirname(fileURLToPath(import.meta.url));

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

function loadToken(workspaceRoot) {
  const patEnv = process.env.WARPDESK_PERSONAL_ACCESS_TOKEN?.trim();
  if (patEnv) {
    return patEnv;
  }
  const mcpPath = path.join(workspaceRoot, ".cursor", "mcp.json");
  if (fs.existsSync(mcpPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(mcpPath, "utf8"));
      const pat = j?.mcpServers?.["warpdesk-tickets"]?.env?.WARPDESK_PERSONAL_ACCESS_TOKEN;
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
  const env = process.env.WARPDESK_BASE_URL?.trim();
  if (env) {
    return env.replace(/\/$/, "");
  }
  const origin = cfg.DEV_APP_ORIGIN?.trim();
  if (!origin) {
    throw new Error(
      "Set DEV_APP_ORIGIN in warpdesk.config or WARPDESK_BASE_URL in the environment.",
    );
  }
  return origin.replace(/\/$/, "");
}

async function apiGet(workspaceRoot, cfg, pathname) {
  const token = loadToken(workspaceRoot);
  if (!token) {
    throw new Error(
      "No personal access token: set WARPDESK_PERSONAL_ACCESS_TOKEN (wds_pat_…) in the environment or in .cursor/mcp.json under mcpServers.warpdesk-tickets.env. Create one in the app: Settings → Personal access tokens.",
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
      "No personal access token: set WARPDESK_PERSONAL_ACCESS_TOKEN (wds_pat_…) in the environment or in .cursor/mcp.json under mcpServers.warpdesk-tickets.env.",
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
      "warpdesk.config not found — run this from the workspace repo root (or a subfolder under it).",
    );
  }
  const cfg = parseConfig(
    fs.readFileSync(path.join(workspaceRoot, "warpdesk.config"), "utf8"),
  );
  const slug = cfg.WORKSPACE_SLUG?.trim();
  if (!slug) {
    throw new Error("warpdesk.config: WORKSPACE_SLUG is required.");
  }

  const argv = process.argv.slice(2);
  const cmd = argv[0] || "list";

  if (cmd === "draft") {
    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const tsxCli = path.join(__dirname, "node_modules", "tsx", "dist", "cli.mjs");
    const draftCli = path.join(__dirname, "src", "ticket-draft-cli.ts");
    if (!fs.existsSync(tsxCli)) {
      throw new Error(`tsx not found at ${tsxCli} — run npm install in vendor/warpdesk-client-kit.`);
    }
    const result = spawnSync(
      process.execPath,
      [tsxCli, draftCli, ...argv],
      { stdio: "inherit", cwd: workspaceRoot, env: process.env },
    );
    process.exit(result.status ?? 1);
  }

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
    if (typeof body === "object" && body !== null && body.ok === true) {
      const tsxCli = path.join(__dirnameCli, "node_modules", "tsx", "dist", "cli.mjs");
      const syncCli = path.join(__dirnameCli, "src", "ticket-selector-sync-cli.ts");
      if (fs.existsSync(tsxCli) && fs.existsSync(syncCli)) {
        const result = spawnSync(
          process.execPath,
          [tsxCli, syncCli, workspaceRoot, slug],
          {
            input: JSON.stringify(body),
            encoding: "utf-8",
            cwd: workspaceRoot,
            env: process.env,
          },
        );
        if (result.status !== 0) {
          const err = (result.stderr || result.stdout || "").trim();
          console.error(
            err
              ? `WarpDesk: ticket selector not updated (${err.slice(0, 400)})`
              : "WarpDesk: ticket selector not updated.",
          );
        }
      }
    }
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
  node .../tickets-cli.mjs draft <ticketUuid> [initial.json]
`);
  process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
