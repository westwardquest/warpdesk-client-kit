/**
 * Vendored for `warpdesk-client-kit` MCP: must resolve next to `ticket-selector-file.ts` so
 * quickstart/vendor layouts (no monorepo `packages/warpdesk-tools` tree) still work.
 * Keep in sync with `packages/warpdesk-tools/workspace-users-cache.js`.
 *
 * Keeps `.warpdesk/workspace-users.json` in sync with the ticket selector and API.
 * See ensureWorkspaceUsersCacheForSelectorDoc — call after reading/writing `.warpdesk/.ticket_selector`.
 */
const path = require("node:path");
const fs = require("node:fs");

const USERS_CACHE_RELATIVE = path.join(".warpdesk", "workspace-users.json");

/** Same token pattern as tools mention replacement (user UUIDs). */
const MENTION_RE =
  /<@([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})>/gi;

/**
 * @param {string} s
 * @returns {boolean}
 */
function isUuid(s) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    String(s),
  );
}

/**
 * @param {string} text
 * @param {Set<string>} out
 */
function extractMentionsFromText(text, out) {
  if (typeof text !== "string" || !text) return;
  MENTION_RE.lastIndex = 0;
  let m;
  while ((m = MENTION_RE.exec(text)) !== null) {
    if (m[1]) out.add(m[1].toLowerCase());
  }
}

/**
 * @param {unknown} snap
 * @param {Set<string>} out
 * @param {number} depth
 */
function collectUserIdsFromSnapshot(snap, out, depth) {
  if (!snap || typeof snap !== "object" || depth > 5) return;
  const o = /** @type {Record<string, unknown>} */ (snap);
  for (const [k, v] of Object.entries(o)) {
    if (
      (k.endsWith("_user_id") ||
        k === "user_id" ||
        k === "author_id" ||
        k === "assignee_user_id" ||
        k === "me_user_id" ||
        k === "reporter_user_id" ||
        k === "actor_user_id" ||
        k === "sender_user_id" ||
        k === "recipient_user_id") &&
      typeof v === "string" &&
      isUuid(v)
    ) {
      out.add(v.toLowerCase());
    }
    if (typeof v === "string" && (k === "body" || k === "description")) {
      extractMentionsFromText(v, out);
    }
    if (v && typeof v === "object" && !Array.isArray(v) && depth < 5) {
      collectUserIdsFromSnapshot(v, out, depth + 1);
    }
    if (Array.isArray(v) && depth < 5) {
      for (const item of v) {
        if (item && typeof item === "object") {
          const row = /** @type {Record<string, unknown>} */ (item);
          if (typeof row.author_id === "string" && isUuid(row.author_id)) {
            out.add(row.author_id.toLowerCase());
          }
          if (typeof row.body === "string") {
            extractMentionsFromText(row.body, out);
          }
        }
      }
    }
  }
}

/**
 * User ids referenced in the selector: snapshot fields, comment authors, `<@uuid>` in bodies.
 * Does not treat ticket or comment `id` as people.
 *
 * @param {unknown} doc
 * @returns {Set<string>} lowercase hex ids
 */
function extractUserIdsFromTicketSelectorDoc(doc) {
  const out = new Set();
  if (!doc || typeof doc !== "object") return out;
  const d = /** @type {Record<string, unknown>} */ (doc);
  if (!Array.isArray(d.tickets)) return out;
  for (const t of d.tickets) {
    if (!t || typeof t !== "object") continue;
    const row = /** @type {Record<string, unknown>} */ (t);
    if (typeof row.assignee_user_id === "string" && isUuid(row.assignee_user_id)) {
      out.add(row.assignee_user_id.toLowerCase());
    }
    const snap = row.ticket_snapshot;
    if (snap && typeof snap === "object") {
      collectUserIdsFromSnapshot(snap, out, 0);
    }
    const comments = row.comments_snapshot;
    if (Array.isArray(comments)) {
      for (const c of comments) {
        if (!c || typeof c !== "object") continue;
        const com = /** @type {Record<string, unknown>} */ (c);
        if (typeof com.author_id === "string" && isUuid(com.author_id)) {
          out.add(com.author_id.toLowerCase());
        }
        if (typeof com.body === "string") {
          extractMentionsFromText(com.body, out);
        }
      }
    }
  }
  return out;
}

/**
 * @param {string} workspaceRoot
 * @returns {Record<string, { user_id: string; role?: string; label?: string; avatar_url?: string | null }> | null}
 */
function readUsersCache(workspaceRoot) {
  const abs = path.join(workspaceRoot, USERS_CACHE_RELATIVE);
  if (!fs.existsSync(abs)) {
    return null;
  }
  try {
    const raw = JSON.parse(fs.readFileSync(abs, "utf8"));
    if (!raw || typeof raw !== "object") {
      return null;
    }
    return raw.users && typeof raw.users === "object" ? raw.users : null;
  } catch {
    return null;
  }
}

/**
 * @param {string} workspaceRoot
 * @param {Record<string, { user_id: string; role?: string; label?: string; avatar_url?: string | null }>} users
 */
function writeUsersCache(workspaceRoot, users) {
  const abs = path.join(workspaceRoot, USERS_CACHE_RELATIVE);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(
    abs,
    `${JSON.stringify({ schema_version: 1, users }, null, 2)}\n`,
    "utf8",
  );
}

/**
 * @param {Set<string>} neededLower
 * @param {Record<string, unknown> | null} cache
 */
function cacheCoversAllNeeded(neededLower, cache) {
  if (neededLower.size === 0) {
    return true;
  }
  if (!cache) {
    return false;
  }
  const keys = Object.keys(cache);
  for (const id of neededLower) {
    const found = keys.some((k) => k.toLowerCase() === id);
    if (!found) {
      return false;
    }
  }
  return true;
}

/**
 * @param {unknown} json
 * @returns {Record<string, { user_id: string; role: string; label: string; avatar_url: string | null }>}
 */
function usersArrayToRecord(json) {
  const out = {};
  if (!json || typeof json !== "object" || !Array.isArray(/** @type {{users?: unknown}} */ (json).users)) {
    return out;
  }
  for (const u of /** @type {{ users: unknown[] }} */ (json).users) {
    if (!u || typeof u !== "object" || typeof /** @type {{user_id?: string}} */ (u).user_id !== "string") {
      continue;
    }
    const row = /** @type {{user_id: string; role?: string; label?: string; avatar_url?: string | null}} */ (u);
    out[row.user_id] = {
      user_id: row.user_id,
      role: typeof row.role === "string" ? row.role : "",
      label: typeof row.label === "string" ? row.label : "",
      avatar_url: typeof row.avatar_url === "string" ? row.avatar_url : null,
    };
  }
  return out;
}

/**
 * @param {Set<string>} neededLower
 * @param {Record<string, { user_id: string; role?: string; label?: string; avatar_url?: string | null }>} merged
 */
function addPlaceholdersForStillMissing(neededLower, merged) {
  for (const id of neededLower) {
    const found = Object.keys(merged).some((k) => k.toLowerCase() === id);
    if (!found) {
      const canon = id;
      merged[canon] = {
        user_id: canon,
        label: `${canon.slice(0, 8)}…`,
        role: "",
        avatar_url: null,
      };
    }
  }
}

/**
 * - If workspace-users.json is missing: GET /users and write it.
 * - If it exists: collect user ids from the selector; if any id is not in the file, GET /users, merge, write.
 *   After a fetch, placeholder rows stop repeated refetch for ids the API does not return.
 *
 * @param {object} params
 * @param {string} params.workspaceRoot
 * @param {unknown} params.selectorDoc
 * @param {() => Promise<{ ok: boolean; json: { ok?: boolean; users?: unknown } | null }>} params.fetchUsers
 * @returns {Promise<void>}
 */
async function ensureWorkspaceUsersCacheForSelectorDoc(params) {
  const { workspaceRoot, selectorDoc, fetchUsers } = params;
  const needed = extractUserIdsFromTicketSelectorDoc(selectorDoc);
  const existing = readUsersCache(workspaceRoot);

  if (!existing) {
    const r = await fetchUsers();
    if (!r.ok || !r.json || r.json.ok !== true) {
      return;
    }
    const fromApi = usersArrayToRecord(r.json);
    const merged = { ...fromApi };
    addPlaceholdersForStillMissing(needed, merged);
    writeUsersCache(workspaceRoot, merged);
    return;
  }

  if (cacheCoversAllNeeded(needed, existing)) {
    return;
  }

  const r = await fetchUsers();
  if (!r.ok || !r.json || r.json.ok !== true) {
    return;
  }
  const fromApi = usersArrayToRecord(r.json);
  const merged = { ...existing, ...fromApi };
  addPlaceholdersForStillMissing(needed, merged);
  writeUsersCache(workspaceRoot, merged);
}

module.exports = {
  USERS_CACHE_RELATIVE,
  readUsersCache,
  writeUsersCache,
  extractUserIdsFromTicketSelectorDoc,
  ensureWorkspaceUsersCacheForSelectorDoc,
};
