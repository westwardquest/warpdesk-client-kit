/**
 * Apply or reject ticket drafts (PATCH + optional POST, or delete file).
 * Used by warpdesk-tools extension; shared single implementation with ticket-draft.ts write path.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";

const PATCH_KEYS = [
  "title",
  "description",
  "type",
  "status",
  "customer_score",
  "customer_priority",
  "assignee_user_id",
  "code_link_url",
  "deadline",
];

function parseWarpdeskConfig(raw) {
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

function loadPersonalAccessToken(workspaceRoot) {
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

function resolveAppBaseUrl(cfg) {
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

function loadWorkspaceConfig(workspaceRoot) {
  const raw = fs.readFileSync(path.join(workspaceRoot, "warpdesk.config"), "utf8");
  const cfg = parseWarpdeskConfig(raw);
  const slug = cfg.WORKSPACE_SLUG?.trim();
  if (!slug) {
    throw new Error("warpdesk.config: WORKSPACE_SLUG is required.");
  }
  const token = loadPersonalAccessToken(workspaceRoot);
  if (!token) {
    throw new Error(
      "No personal access token: set WARPDESK_PERSONAL_ACCESS_TOKEN (wds_pat_…) in the environment or in .cursor/mcp.json under mcpServers.warpdesk-tickets.env.",
    );
  }
  const baseUrl = resolveAppBaseUrl(cfg);
  return { cfg, slug, baseUrl, token };
}

function parseDraftFile(absPath) {
  const raw = fs.readFileSync(absPath, "utf8");
  const doc = YAML.parse(raw);
  if (!doc || typeof doc !== "object") {
    throw new Error("Invalid draft: expected YAML object");
  }
  return doc;
}

function buildPatchBody(doc) {
  const body = {};
  for (const k of PATCH_KEYS) {
    if (Object.prototype.hasOwnProperty.call(doc, k)) {
      body[k] = doc[k];
    }
  }
  return body;
}

async function apiFetch(baseUrl, token, method, pathname, jsonBody) {
  const url = `${baseUrl}${pathname}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
  if (jsonBody !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, {
    method,
    headers,
    body: jsonBody !== undefined ? JSON.stringify(jsonBody) : undefined,
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

/**
 * @param {{ workspaceRoot: string, draftPath: string }} params
 */
export async function applyTicketUpdateDraft(params) {
  const { workspaceRoot } = params;
  const absDraft = path.isAbsolute(params.draftPath)
    ? params.draftPath
    : path.join(workspaceRoot, params.draftPath);

  if (!fs.existsSync(absDraft)) {
    return { ok: false, summary: `Draft file not found: ${absDraft}` };
  }

  let doc;
  try {
    doc = parseDraftFile(absDraft);
  } catch (e) {
    return {
      ok: false,
      summary: e instanceof Error ? e.message : String(e),
    };
  }

  if (doc.schema_version != null && doc.schema_version !== 1) {
    return { ok: false, summary: `Unsupported schema_version: ${doc.schema_version}` };
  }

  let slug;
  let baseUrl;
  let token;
  try {
    ({ slug, baseUrl, token } = loadWorkspaceConfig(workspaceRoot));
  } catch (e) {
    return {
      ok: false,
      summary: e instanceof Error ? e.message : String(e),
    };
  }

  if (doc.workspace_slug !== slug) {
    return {
      ok: false,
      summary: `Draft workspace_slug (${doc.workspace_slug}) does not match warpdesk.config WORKSPACE_SLUG (${slug}).`,
    };
  }

  const ticketId = doc.ticket_id;
  const uuidRe =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!uuidRe.test(ticketId)) {
    return { ok: false, summary: "Invalid ticket_id in draft." };
  }

  const patchBody = buildPatchBody(doc);
  const comment = doc.comment;
  const hasComment =
    comment &&
    typeof comment.body === "string" &&
    comment.body.trim().length > 0;

  if (Object.keys(patchBody).length === 0 && !hasComment) {
    return {
      ok: false,
      summary:
        "Nothing to apply: add at least one PATCH field or a comment.body in the draft.",
    };
  }

  const parts = [];
  /** @type {unknown} */
  let patchResponseJson = null;

  if (Object.keys(patchBody).length > 0) {
    const pathname = `/api/w/${encodeURIComponent(slug)}/tickets/${encodeURIComponent(ticketId)}`;
    const r = await apiFetch(baseUrl, token, "PATCH", pathname, patchBody);
    parts.push(`${r.status} PATCH ${pathname}\n${r.text}`);
    if (!r.ok) {
      return { ok: false, summary: parts.join("\n\n") };
    }
    try {
      patchResponseJson = JSON.parse(r.text);
    } catch {
      patchResponseJson = null;
    }
  }

  if (hasComment) {
    const pathname = `/api/w/${encodeURIComponent(slug)}/tickets/${encodeURIComponent(ticketId)}/comments`;
    const commentPayload = {
      body: String(comment.body).trim(),
    };
    if (comment.visibility === "public" || comment.visibility === "internal") {
      commentPayload.visibility = comment.visibility;
    }
    if (
      comment.parent_comment_id &&
      uuidRe.test(comment.parent_comment_id)
    ) {
      commentPayload.parent_comment_id = comment.parent_comment_id;
    }
    const r = await apiFetch(baseUrl, token, "POST", pathname, commentPayload);
    parts.push(`${r.status} POST ${pathname}\n${r.text}`);
    if (!r.ok) {
      return { ok: false, summary: parts.join("\n\n") };
    }
  }

  try {
    fs.unlinkSync(absDraft);
  } catch (e) {
    parts.push(
      `Warning: could not delete draft file: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  if (patchResponseJson == null) {
    const pathname = `/api/w/${encodeURIComponent(slug)}/tickets/${encodeURIComponent(ticketId)}`;
    const r = await apiFetch(baseUrl, token, "GET", pathname);
    if (r.ok) {
      try {
        patchResponseJson = JSON.parse(r.text);
      } catch {
        patchResponseJson = null;
      }
    }
  }

  return {
    ok: true,
    summary: parts.join("\n\n"),
    json: patchResponseJson,
  };
}

/**
 * @param {{ workspaceRoot: string, draftPath: string }} params
 */
export function rejectTicketUpdateDraft(params) {
  const absDraft = path.isAbsolute(params.draftPath)
    ? params.draftPath
    : path.join(params.workspaceRoot, params.draftPath);
  if (!fs.existsSync(absDraft)) {
    return { ok: false, summary: `Draft file not found: ${absDraft}` };
  }
  fs.unlinkSync(absDraft);
  return { ok: true, summary: `Discarded draft: ${absDraft}` };
}
