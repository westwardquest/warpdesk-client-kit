/**
 * Stdio MCP server: ticket tools call the app's HTTP API with a personal access token.
 * Draft tool `draft_ticket_update` writes YAML under `.warpdesk/ticket-drafts/` (apply only via WarpDesk Tools, not MCP).
 * Run: `npm run mcp:tickets` from this package directory with env set.
 *
 * Auth: `WARPDESK_PERSONAL_ACCESS_TOKEN` (wds_pat_…) from app Settings → Personal access tokens.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import * as fs from "node:fs";
import * as path from "node:path";
import * as z from "zod/v4";
import { loadWorkspaceConfig } from "./workspace-config";
import { findWorkspaceRoot, writeTicketDraft } from "./ticket-draft";
import { trySyncTicketSelectorFromMcpToolResponse } from "./ticket-selector-file";

const PAT_ENV = "WARPDESK_PERSONAL_ACCESS_TOKEN";

function requireEnv(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`Missing required env: ${name}`);
    process.exit(1);
  }
  return v;
}

function baseUrl(): string {
  return requireEnv("WARPDESK_BASE_URL").replace(/\/$/, "");
}

function authHeaders(contentType?: string): Record<string, string> {
  const pat = requireEnv(PAT_ENV);
  const h: Record<string, string> = {
    Authorization: `Bearer ${pat}`,
    Accept: "application/json",
  };
  if (contentType) {
    h["Content-Type"] = contentType;
  }
  return h;
}

async function maybeAppendTicketSelectorHint(
  slug: string,
  r: { text: string; isError?: boolean },
  shape: "list" | "get" | "lookup",
): Promise<string> {
  if (r.isError) {
    return r.text;
  }
  const root = findWorkspaceRoot(process.cwd());
  if (!root) {
    return r.text;
  }
  try {
    const sync = await trySyncTicketSelectorFromMcpToolResponse({
      workspaceRoot: root,
      slug,
      toolText: r.text,
      shape,
    });
    if (sync.ok) {
      return (
        `${r.text}\n\nUpdated WarpDesk ticket selector: ${sync.relativePath}`
      );
    }
  } catch {
    /* ignore selector side effects */
  }
  return r.text;
}

async function toolJson(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ text: string; isError?: boolean }> {
  const url = `${baseUrl()}${path}`;
  try {
    const headers = authHeaders(
      body !== undefined ? "application/json" : undefined,
    );
    const res = await fetch(url, {
      method,
      headers,
      body:
        body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    const summary = `${res.status} ${res.statusText}\n${text}`;
    if (!res.ok) {
      return { text: summary, isError: true };
    }
    return { text: summary };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      text: `fetch failed: ${msg}`,
      isError: true,
    };
  }
}

const mcpServer = new McpServer({
  name: "warpdesk-tickets",
  version: "0.1.0",
});

/** When set, registers legacy tools `update_ticket` and `add_ticket_comment`. Default is draft-only (`draft_ticket_update`); apply/reject drafts only via WarpDesk Tools, not MCP. */
const allowDirectTicketUpdates =
  process.env.WARPDESK_MCP_ALLOW_DIRECT_UPDATES === "1" ||
  process.env.WARPDESK_MCP_ALLOW_DIRECT_UPDATES === "true";

mcpServer.registerTool(
  "bootstrap_workspace",
  {
    description:
      "Create workspace + your developer membership (POST /api/workspaces/bootstrap). Use after local scaffold; read warpdesk.config for name/slug and knowledge repo URL. Requires WARPDESK_PERSONAL_ACCESS_TOKEN in MCP env.",
    inputSchema: {
      name: z.string().min(1).describe("Workspace display name"),
      slug: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
        .describe("Workspace slug (must match main repo folder name)"),
      git_repo_url: z
        .string()
        .url()
        .optional()
        .describe(
          "HTTPS URL of the knowledge-only repo (…/<slug>-knowledge-base)",
        ),
    },
  },
  async ({ name, slug, git_repo_url }) => {
    let r: { text: string; isError?: boolean };
    try {
      r = await toolJson("POST", "/api/workspaces/bootstrap", {
        name,
        slug,
        ...(git_repo_url ? { git_repo_url } : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      r = { text: msg, isError: true };
    }
    return {
      content: [{ type: "text" as const, text: r.text }],
      ...(r.isError ? { isError: true as const } : {}),
    };
  },
);

mcpServer.registerTool(
  "get_users",
  {
    description:
      "Get all members for a workspace (GET /api/w/{slug}/users). Returns user_id, role, label, avatar_url.",
    inputSchema: {
      slug: z.string().describe("Workspace slug"),
    },
  },
  async ({ slug }) => {
    const apiPath = `/api/w/${encodeURIComponent(slug)}/users`;
    let r: { text: string; isError?: boolean };
    try {
      r = await toolJson("GET", apiPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      r = { text: msg, isError: true };
    }
    return {
      content: [{ type: "text" as const, text: r.text }],
      ...(r.isError ? { isError: true as const } : {}),
    };
  },
);

mcpServer.registerTool(
  "get_ticket",
  {
    description:
      "Get one ticket with comments (GET /api/w/{slug}/tickets/{id}). On success, merges this ticket into .warpdesk/.ticket_selector.",
    inputSchema: {
      slug: z.string().describe("Workspace slug"),
      ticketId: z.string().uuid().describe("Ticket UUID"),
    },
  },
  async ({ slug, ticketId }) => {
    const apiPath = `/api/w/${encodeURIComponent(slug)}/tickets/${encodeURIComponent(ticketId)}`;
    let r: { text: string; isError?: boolean };
    try {
      r = await toolJson("GET", apiPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      r = { text: msg, isError: true };
    }
    const text = await maybeAppendTicketSelectorHint(slug, r, "get");
    return {
      content: [{ type: "text" as const, text }],
      ...(r.isError ? { isError: true as const } : {}),
    };
  },
);

mcpServer.registerTool(
  "get_ticket_by_number",
  {
    description:
      "Get one ticket by integer ticket_number with comments (GET .../tickets/by-number/{n}). Same JSON shape as get_ticket. On success, merges into .warpdesk/.ticket_selector.",
    inputSchema: {
      slug: z
        .string()
        .optional()
        .describe("Workspace slug (optional; if missing, tool returns guidance)"),
      ticket_number: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe("Workspace-scoped ticket number"),
    },
  },
  async ({ slug, ticket_number }) => {
    if (!slug || typeof slug !== "string" || !slug.trim() || ticket_number == null) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              [
                "Missing required args for get_ticket_by_number.",
                "Ask the user to start/select a ticket context first, then call with:",
                '- slug: workspace slug (example: "duck-island-icecream")',
                "- ticket_number: integer ticket number (example: 42)",
                "",
                "Tip: if you do not have the number, call list_priority_active_tickets or search_tickets first.",
              ].join("\n"),
          },
        ],
        isError: true as const,
      };
    }
    const apiPath = `/api/w/${encodeURIComponent(slug)}/tickets/by-number/${encodeURIComponent(String(ticket_number))}`;
    let r: { text: string; isError?: boolean };
    try {
      r = await toolJson("GET", apiPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      r = { text: msg, isError: true };
    }
    const text = await maybeAppendTicketSelectorHint(slug, r, "get");
    return {
      content: [{ type: "text" as const, text }],
      ...(r.isError ? { isError: true as const } : {}),
    };
  },
);

mcpServer.registerTool(
  "list_priority_active_tickets",
  {
    description:
      "List priority work-queue tickets (GET .../tickets?queue=1&include_comments=1), ordered by priority_score. The server queue **excludes `needs_client`**. For other statuses or broader lists, use **`search_tickets`** or the app/CLI. Optional band=N (with queue) returns only tickets within N points of the top priority_score in that set. On success, merges ticket rows plus ticket/comment snapshots into .warpdesk/.ticket_selector.",
    inputSchema: {
      slug: z.string().describe("Workspace slug"),
      limit: z.number().int().min(1).max(100).optional(),
      band: z
        .number()
        .int()
        .min(0)
        .max(1000)
        .optional()
        .describe(
          "With default queue behaviour: pass with queue to narrow to top band (e.g. 10). Sent as band= query param.",
        ),
    },
  },
  async ({ slug, limit, band }) => {
    const q = new URLSearchParams();
    q.set("queue", "1");
    if (limit != null) {
      q.set("limit", String(limit));
    }
    if (band != null) {
      q.set("band", String(band));
    }
    q.set("include_comments", "1");
    const apiPath = `/api/w/${encodeURIComponent(slug)}/tickets?${q.toString()}`;
    let r: { text: string; isError?: boolean };
    try {
      r = await toolJson("GET", apiPath);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      r = { text: msg, isError: true };
    }
    const text = await maybeAppendTicketSelectorHint(slug, r, "list");
    return {
      content: [{ type: "text" as const, text }],
      ...(r.isError ? { isError: true as const } : {}),
    };
  },
);

const ticketPatchSchema = {
  title: z.string().optional(),
  description: z.string().optional(),
  type: z.enum(["bug", "feature", "question", "chore", "document"]).optional(),
  status: z
    .enum([
      "posted",
      "heeded",
      "cooking",
      "blocked",
      "needs_client",
      "client_responded",
      "closed",
    ])
    .optional(),
  customer_score: z.number().min(0).max(100).optional(),
  customer_priority: z.enum(["low", "normal", "high", "max"]).optional(),
  assignee_user_id: z.string().uuid().nullable().optional(),
  code_link_url: z.string().nullable().optional(),
  deadline: z.string().nullable().optional(),
};

mcpServer.registerTool(
  "draft_ticket_update",
  {
    description:
      "Create a reviewable YAML draft under .warpdesk/ticket-drafts/ (schema .ticket_draft). Humans apply or discard only in the WarpDesk Tools *.ticket_draft editor — agents MUST NOT apply/reject via shell, CLI, or any MCP tool. Prefer this over direct updates for agent-driven ticket changes. After success: reply briefly (paths only); do NOT add closing paragraphs telling the user to Confirm in WarpDesk Tools or to close the ticket — avoid repeating that in chat or inside draft comment bodies (the YAML file documents workflow).",
    inputSchema: {
      slug: z.string().describe("Workspace slug (must match warpdesk.config WORKSPACE_SLUG)"),
      ticketId: z.string().uuid().describe("Ticket UUID"),
      ...ticketPatchSchema,
      comment: z
        .object({
          body: z.string().optional(),
          visibility: z.enum(["public", "internal"]).optional(),
          parent_comment_id: z.string().uuid().optional(),
        })
        .optional()
        .describe("Optional comment to post after PATCH"),
    },
  },
  async (args) => {
    const root = findWorkspaceRoot(process.cwd());
    if (!root) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Could not find workspace root (warpdesk.config). Open the client workspace folder in Cursor.",
          },
        ],
        isError: true,
      };
    }
    let cfgSlug: string;
    try {
      ({ slug: cfgSlug } = loadWorkspaceConfig(root));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [{ type: "text" as const, text: msg }],
        isError: true,
      };
    }
    if (cfgSlug !== args.slug) {
      return {
        content: [
          {
            type: "text" as const,
            text: `slug "${args.slug}" does not match warpdesk.config WORKSPACE_SLUG "${cfgSlug}".`,
          },
        ],
        isError: true,
      };
    }
    const {
      slug,
      ticketId,
      comment,
      ...rest
    } = args as Record<string, unknown> & {
      slug: string;
      ticketId: string;
      comment?: {
        body?: string;
        visibility?: "public" | "internal";
        parent_comment_id?: string;
      };
    };
    const initial: Parameters<typeof writeTicketDraft>[0]["initial"] = { ...rest };
    if (comment) {
      initial.comment = comment;
    }
    const r = writeTicketDraft({
      workspaceRoot: root,
      slug,
      ticketId,
      initial,
    });
    const text =
      `Wrote draft file (YAML).\n\n` +
      `draft_path (relative to workspace): ${r.draftRelativePath}\n` +
      `absolutePath: ${r.absolutePath}\n\n` +
      `Do not append boilerplate to your reply or to ticket comment fields asking the user to Confirm in WarpDesk Tools—the draft headers explain apply/reject; keep prose concise. Agents cannot apply via MCP/CLI/shell.`;
    return { content: [{ type: "text" as const, text }] };
  },
);

mcpServer.registerTool(
  "search_tickets",
  {
    description:
      "Search tickets by title, #number, or id prefix (GET .../tickets/lookup?q= with include_comments=1). On success, merges hits plus per-ticket comment snapshots into .warpdesk/.ticket_selector.",
    inputSchema: {
      slug: z.string(),
      q: z.string().min(1),
      exclude: z.string().uuid().optional(),
    },
  },
  async ({ slug, q, exclude }) => {
    const params = new URLSearchParams({ q });
    params.set("include_comments", "1");
    if (exclude) {
      params.set("exclude", exclude);
    }
    const path = `/api/w/${encodeURIComponent(slug)}/tickets/lookup?${params.toString()}`;
    let r: { text: string; isError?: boolean };
    try {
      r = await toolJson("GET", path);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      r = { text: msg, isError: true };
    }
    const text = await maybeAppendTicketSelectorHint(slug, r, "lookup");
    return {
      content: [{ type: "text" as const, text }],
      ...(r.isError ? { isError: true as const } : {}),
    };
  },
);

mcpServer.registerTool(
  "request_cursor_session",
  {
    description:
      "Calls the WarpDesk Tools extension on localhost (POST /cursor-session/start|stop). If start returns dev_not_running, STOP: ask the user to start the WarpDesk dev clock (and ensure the git branch includes the ticket number), then only retry this tool — do not use Shell or other tools to write files. Requires the extension: dev clock must be running before start; stop ends Cursor clock and resumes dev by default.",
    inputSchema: {
      action: z
        .enum(["start", "stop", "stop_and_resume_dev"])
        .describe(
          "start: end dev segment and begin Cursor segment. stop: end Cursor segment and resume dev by default. stop_and_resume_dev: explicit alias for stop+resume.",
        ),
      ticket_number: z
        .number()
        .int()
        .min(1)
        .optional()
        .describe(
          "Expected ticket number when action=start. If provided and the running dev clock is on a different ticket, start is denied with ticket_mismatch.",
        ),
    },
  },
  async ({ action, ticket_number }) => {
    const root = findWorkspaceRoot(process.cwd());
    if (!root) {
      return {
        content: [
          {
            type: "text" as const,
            text: "Could not find workspace root (warpdesk.config).",
          },
        ],
        isError: true,
      };
    }
    const ctrlPath = path.join(root, ".warpdesk", "extension-control.json");
    if (!fs.existsSync(ctrlPath)) {
      return {
        content: [
          {
            type: "text" as const,
            text:
              "WarpDesk Tools extension control file missing (.warpdesk/extension-control.json). Open the workspace in VS Code/Cursor with WarpDesk Tools activated.",
          },
        ],
        isError: true,
      };
    }
    let port: number;
    let authToken: string;
    try {
      const raw = fs.readFileSync(ctrlPath, "utf8");
      const j = JSON.parse(raw) as { port?: number; authToken?: string };
      if (typeof j.port !== "number" || !j.authToken) {
        throw new Error("Invalid extension-control.json");
      }
      port = j.port;
      authToken = j.authToken;
    } catch (e) {
      return {
        content: [
          {
            type: "text" as const,
            text: e instanceof Error ? e.message : String(e),
          },
        ],
        isError: true,
      };
    }
    const pathname =
      action === "start" ? "/cursor-session/start" : "/cursor-session/stop";
    const url = `http://127.0.0.1:${port}${pathname}`;
    const bodyObj =
      action === "stop_and_resume_dev"
        ? { resume_dev: true, source_hook_event: "mcp_tool" }
        : action === "stop"
          ? { source_hook_event: "mcp_tool" }
          : {
              source_hook_event: "mcp_tool",
              ...(ticket_number != null ? { ticket_number } : {}),
            };
    const body = JSON.stringify(bodyObj);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${authToken}`,
          "Content-Type": "application/json",
        },
        body,
      });
      const text = await res.text();
      let payload: { ok?: boolean; code?: string; error?: string } | null = null;
      try {
        payload = text ? (JSON.parse(text) as { ok?: boolean; code?: string; error?: string }) : null;
      } catch {
        payload = null;
      }
      if (res.ok && payload && typeof payload === "object" && payload.ok === false) {
        const code = typeof payload.code === "string" ? payload.code : "";
        const errMsg =
          typeof payload.error === "string" && payload.error.trim()
            ? payload.error.trim()
            : "Extension returned ok: false";
        const steer =
          code === "dev_not_running"
            ? [
                "",
                `Extension error: ${errMsg}`,
                "Agent guidance (read this, then stop trying other tools for edits):",
                "• Do NOT use Shell, terminal, or workarounds to write project files; hooks will still block or violate policy.",
                "• Do NOT call request_cursor_session(start) in a loop without user action. Ask the user once, clearly:",
                "  – In VS Code / Cursor: run command “WarpDesk: Start dev clock” (dev segment must be running).",
                "  – Check out a branch whose name includes the active ticket number (e.g. ticket-27) if the extension requires it.",
                "  – Then the user (or you after they confirm) can call request_cursor_session with action \"start\" again.",
                "• Send a short message to the user listing these steps, then wait. One failed start = pause until dev clock is on.",
              ].join("\n")
            : code === "ticket_mismatch"
              ? [
                  "",
                  `Extension error: ${errMsg}`,
                  "Agent guidance (firm):",
                  "• Do NOT start Cursor session on the wrong ticket clock.",
                  "• Ask the user to switch the running WarpDesk dev clock to the requested ticket number, then retry request_cursor_session(action=\"start\", ticket_number=...).",
                  "• Do NOT bypass with Shell edits or repeated start attempts while ticket mismatch remains.",
                ].join("\n")
            : code === "cursor_not_running"
              ? [
                  "",
                  `Extension error: ${errMsg}`,
                  "If you meant to stop, Cursor clock may already be off. Do not improvise file writes via Shell.",
                ].join("\n")
              : [
                  "",
                  `Extension error: ${errMsg}`,
                  "Ask the user to fix the WarpDesk Tools / clock state; do not bypass with Shell file writes.",
                ].join("\n");
        return {
          content: [
            {
              type: "text" as const,
              text: `200 ${res.statusText}\n${text}${steer}`,
            },
          ],
          isError: true,
        };
      }
      if (!res.ok) {
        return {
          content: [{ type: "text" as const, text: `${res.status} ${res.statusText}\n${text}` }],
          isError: true,
        };
      }
      return { content: [{ type: "text" as const, text: `${res.status} ${res.statusText}\n${text}` }] };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return {
        content: [
          {
            type: "text" as const,
            text: `Local extension request failed: ${msg}`,
          },
        ],
        isError: true,
      };
    }
  },
);

if (allowDirectTicketUpdates) {
mcpServer.registerTool(
  "update_ticket",
  {
    description:
      "Partial update to a ticket (PATCH .../tickets/{id}). JSON fields optional: title, description, type, status, customer_score (developers) or customer_priority (clients: low|normal|high|max); developers may set assignee_user_id, code_link_url, deadline. Attachments are not changed via this tool.",
    inputSchema: {
      slug: z.string(),
      ticketId: z.string().uuid(),
      title: z.string().optional(),
      description: z.string().optional(),
      type: z.enum(["bug", "feature", "question", "chore", "document"]).optional(),
      status: z
        .enum([
          "posted",
          "heeded",
          "cooking",
          "blocked",
          "needs_client",
          "client_responded",
          "closed",
        ])
        .optional(),
      customer_score: z.number().min(0).max(100).optional(),
      customer_priority: z
        .enum(["low", "normal", "high", "max"])
        .optional(),
      assignee_user_id: z.string().uuid().nullable().optional(),
      code_link_url: z.string().nullable().optional(),
      deadline: z.string().nullable().optional(),
    },
  },
  async ({
    slug,
    ticketId,
    title,
    description,
    type,
    status,
    customer_score,
    customer_priority,
    assignee_user_id,
    code_link_url,
    deadline,
  }) => {
    const body: Record<string, unknown> = {};
    if (title !== undefined) {
      body.title = title;
    }
    if (description !== undefined) {
      body.description = description;
    }
    if (type !== undefined) {
      body.type = type;
    }
    if (status !== undefined) {
      body.status = status;
    }
    if (customer_score !== undefined) {
      body.customer_score = customer_score;
    }
    if (customer_priority !== undefined) {
      body.customer_priority = customer_priority;
    }
    if (assignee_user_id !== undefined) {
      body.assignee_user_id = assignee_user_id;
    }
    if (code_link_url !== undefined) {
      body.code_link_url = code_link_url;
    }
    if (deadline !== undefined) {
      body.deadline = deadline;
    }
    const path = `/api/w/${encodeURIComponent(slug)}/tickets/${encodeURIComponent(ticketId)}`;
    let r: { text: string; isError?: boolean };
    try {
      r = await toolJson("PATCH", path, body);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      r = { text: msg, isError: true };
    }
    return {
      content: [{ type: "text" as const, text: r.text }],
      ...(r.isError ? { isError: true as const } : {}),
    };
  },
);

mcpServer.registerTool(
  "add_ticket_comment",
  {
    description: "Post a comment on a ticket (POST .../tickets/{id}/comments).",
    inputSchema: {
      slug: z.string(),
      ticketId: z.string().uuid(),
      body: z.string().min(1),
      visibility: z.enum(["public", "internal"]).optional(),
      parent_comment_id: z.string().uuid().optional(),
    },
  },
  async ({ slug, ticketId, body, visibility, parent_comment_id }) => {
    const path = `/api/w/${encodeURIComponent(slug)}/tickets/${encodeURIComponent(ticketId)}/comments`;
    let r: { text: string; isError?: boolean };
    try {
      r = await toolJson("POST", path, {
        body,
        ...(visibility ? { visibility } : {}),
        ...(parent_comment_id ? { parent_comment_id } : {}),
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      r = { text: msg, isError: true };
    }
    return {
      content: [{ type: "text" as const, text: r.text }],
      ...(r.isError ? { isError: true as const } : {}),
    };
  },
);
}

async function main() {
  requireEnv("WARPDESK_BASE_URL");
  requireEnv(PAT_ENV);
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}

main().catch((error) => {
  console.error("warpdesk-tickets MCP:", error);
  process.exit(1);
});
