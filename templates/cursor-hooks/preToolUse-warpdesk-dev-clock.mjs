#!/usr/bin/env node
/**
 * Cursor preToolUse hook: require WarpDesk **dev** clock before substantive edits.
 *
 * Copy into `.cursor/hooks/` and point `.cursor/hooks.json` at this file, or run
 * from `vendor/warpdesk-client-kit/templates/cursor-hooks/` (see hooks.warpdesk-dev-clock.example.json).
 *
 * Env (optional):
 * - WARPDESK_HOOK_EDIT_TOOLS — comma-separated tool_name values to gate (default: edit-family below).
 * - WARPDESK_HOOK_GATE_SHELL — set `0` or `false` to skip gating the **Shell** tool (default: on).
 *   When on, only **suspicious** shell lines are gated; read-only patterns (e.g. `git diff`, `git status`,
 *   `npm test`, `npx vitest`) are allowed without the clock. **Ambiguous** commands default to allow;
 *   set WARPDESK_HOOK_SHELL_AMBIGUOUS=deny to require the clock for them too.
 * - WARPDESK_HOOK_ALLOW_CURSOR_PHASE=1 — treat **cursor** phase like **dev**.
 * - WARPDESK_HOOK_REQUIRE_CURSOR_PHASE=0 — disable strict mode that requires **cursor** for gated writes (default: strict mode on, so **dev** alone is not enough for agent edits).
 * - WARPDESK_HOOK_ALLOW_NO_TICKET_ID=1 — allow **dev** and **cursor** even when **ticketId** is empty in clock state (default: require a non-empty **ticketId** whenever phase is dev or cursor).
 * - WARPDESK_HOOK_PERMISSION — `deny` | `ask` when blocked (default `deny`).
 * - WARPDESK_HOOK_DEBUG=1 — log JSON lines to **stderr** (see Cursor Hooks output) with reason codes; does not change stdout.
 *
 * Requires **Node** on PATH (Windows: install Node and restart Cursor).
 */
import fs from "node:fs";
import path from "node:path";

const DEFAULT_EDIT_TOOLS = new Set([
  "Write",
  "StrReplace",
  "search_replace",
  "Edit",
  "MultiEdit",
  "apply_patch",
]);

const GIT_READ =
  /^(?:git)\s+(?:diff|log|status|show|rev-parse|describe|ls-files|check-ignore|blame|for-each-ref|whatchanged|shortlog|remote|help)(?:\s|$)/i;
const GIT_WRITE =
  /^(?:git)\s+(?:add|commit|push|pull|stage|am|rebase|merge|cherry-pick|format-patch|apply|reset|worktree|stash|mv|init|submodule|tag)(?:\s|$)/i;
const GIT_MAYBE_WRITE =
  /^(?:git)\s+(?:checkout|switch|clean|rm|config)(?:\s|$)/i;
const NPM_WRITE =
  /^(?:npm|yarn|pnpm)\s+(?:install|i\b|add|update|remove|uninstall|ci|dedupe)(?:\s|$)/i;
const SED_PEARL_INPLACE = /\b(?:sed|perl)\b[^\n&|;]*?[\s-]+-i[=\s\w]*/i;

function out(obj) {
  process.stdout.write(`${JSON.stringify(obj)}\n`);
}

function debugEnabled() {
  const v = process.env.WARPDESK_HOOK_DEBUG;
  if (v == null || v === "") return false;
  return v === "1" || v === "true" || v.toLowerCase() === "yes";
}

/**
 * @param {string} event
 * @param {Record<string, unknown>} [data]
 */
function dbg(event, data) {
  if (!debugEnabled()) return;
  const row = { event, ...data, hookPid: process.pid, hookCwd: process.cwd() };
  process.stderr.write(
    `[warpdesk-dev-clock-hook] ${JSON.stringify(row)}\n`,
  );
}

/**
 * @param {Set<string>} set
 * @param {string} name
 */
function setHasI(set, name) {
  if (set.has(name)) return true;
  for (const t of set) {
    if (t.toLowerCase() === name.toLowerCase()) return true;
  }
  return false;
}

function parseEditTools() {
  const raw = process.env.WARPDESK_HOOK_EDIT_TOOLS;
  if (!raw || !raw.trim()) return DEFAULT_EDIT_TOOLS;
  const s = new Set();
  for (const p of raw.split(",")) {
    const t = p.trim();
    if (t) s.add(t);
  }
  return s.size ? s : DEFAULT_EDIT_TOOLS;
}

function gateShellEnabled() {
  const v = process.env.WARPDESK_HOOK_GATE_SHELL;
  if (v == null || v === "") return true;
  return v !== "0" && v !== "false" && v.toLowerCase() !== "no";
}

function ambiguousIsDeny() {
  return process.env.WARPDESK_HOOK_SHELL_AMBIGUOUS === "deny";
}

/**
 * @param {string} p Cursor may send "/c:/foo/bar"
 * @returns {string}
 */
function normalizeCursorPath(p) {
  const s = String(p).trim();
  const fileUn = s.match(/^file:\/\/\/\/?([a-zA-Z]):\/?(.*)$/i);
  if (fileUn) {
    return path.join(
      `${fileUn[1].toUpperCase()}:`,
      ...fileUn[2].split(/[/\\]+/).filter(Boolean),
    );
  }
  const m = s.match(/^\/([a-zA-Z]):\/?(.*)$/);
  if (m) {
    return path.join(`${m[1].toUpperCase()}:`, ...m[2].split("/").filter(Boolean));
  }
  return s;
}

/**
 * Resolves a folder that contains `warpdesk.config` (WarpDesk **client** workspace).
 * Tries `cwd`, **every** `workspace_roots` entry, then — if the tool targets a file —
 * walks up from that file. This avoids a **fail-open** when Cursor lists a parent
 * monorepo path first and that tree has no `warpdesk.config`.
 *
 * @param {Record<string, unknown>} payload
 * @returns {string | null}
 */
function resolveWorkspaceRootForHook(payload) {
  const tryDirs = /** @type {string[]} */ ([]);
  if (typeof payload.cwd === "string" && payload.cwd.trim()) {
    tryDirs.push(path.resolve(normalizeCursorPath(payload.cwd.trim())));
  }
  const roots = payload.workspace_roots;
  if (Array.isArray(roots)) {
    for (const r of roots) {
      if (typeof r === "string" && r.trim()) {
        tryDirs.push(path.resolve(normalizeCursorPath(r.trim())));
      }
    }
  }
  if (tryDirs.length === 0) {
    tryDirs.push(process.cwd());
  }
  for (const d of tryDirs) {
    const w = findWorkspaceRoot(d);
    if (w) {
      return w;
    }
  }
  const toolInput = payload.tool_input;
  if (toolInput && typeof toolInput === "object") {
    const target = primaryTargetPath(toolInput);
    if (target) {
      const abs = path.resolve(normalizeCursorPath(target));
      const w = findWorkspaceRoot(path.dirname(abs));
      if (w) {
        return w;
      }
    }
  }
  return null;
}

function findWorkspaceRoot(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    if (fs.existsSync(path.join(dir, "warpdesk.config"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * @param {string} workspaceRoot
 * @returns {{ phase: "idle" | "dev" | "cursor"; ticketId: string | null }}
 */
function readLocalClockState(workspaceRoot) {
  const p = path.join(workspaceRoot, ".warpdesk", "clock-local-state.json");
  if (!fs.existsSync(p)) {
    return { phase: "idle", ticketId: null };
  }
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const ph = j.phase;
    const phase =
      ph === "dev" || ph === "cursor" || ph === "idle" ? ph : "idle";
    const raw = j.ticketId;
    const ticketId =
      typeof raw === "string" && raw.trim() ? raw.trim() : null;
    return { phase, ticketId };
  } catch {
    return { phase: "idle", ticketId: null };
  }
}

function allowNoTicketIdBypass() {
  const v = process.env.WARPDESK_HOOK_ALLOW_NO_TICKET_ID;
  if (v == null || v === "") return false;
  return v === "1" || v === "true" || v.toLowerCase() === "yes";
}

function requireCursorPhase() {
  const v = process.env.WARPDESK_HOOK_REQUIRE_CURSOR_PHASE;
  if (v == null || v === "") return true;
  return !(v === "0" || v === "false" || v.toLowerCase() === "no");
}

/**
 * @param {string} phase
 * @param {string | null} ticketId
 * @param {boolean} allowCursor
 * @returns {{ allow: boolean; reason: "ok" | "phase" | "no_ticket" }}
 */
function evaluateClockGate(phase, ticketId, allowCursor) {
  const phaseOk = requireCursorPhase()
    ? phase === "cursor"
    : phase === "dev" || (allowCursor && phase === "cursor");
  if (!phaseOk) {
    return { allow: false, reason: "phase" };
  }
  if (allowNoTicketIdBypass()) {
    return { allow: true, reason: "ok" };
  }
  if (ticketId) {
    return { allow: true, reason: "ok" };
  }
  return { allow: false, reason: "no_ticket" };
}

function primaryTargetPath(toolInput) {
  if (!toolInput || typeof toolInput !== "object") return null;
  const ti = toolInput;
  const cand =
    ti.path ??
    ti.file_path ??
    ti.target_file ??
    ti.filePath ??
    ti.file ??
    null;
  return typeof cand === "string" && cand.trim() ? cand.trim() : null;
}

const CLOCK_LOCAL_STATE_BASENAME = "clock-local-state.json";

/**
 * @param {string} norm workspace-relative path with `/` separators
 * @returns {boolean} true if this is the local clock file (not eligible for the usual `.warpdesk/` exemption)
 */
function isClockLocalStatePath(norm) {
  if (!norm.endsWith(CLOCK_LOCAL_STATE_BASENAME)) return false;
  return norm.split("/").includes(".warpdesk");
}

function isExemptPath(workspaceRoot, filePath) {
  if (!filePath) return false;
  const absFile = path.resolve(filePath);
  const absRoot = path.resolve(workspaceRoot);
  const rel = path.relative(absRoot, absFile);
  if (rel.startsWith("..") || rel === "") return false;
  const norm = rel.split(path.sep).join("/");
  if (isClockLocalStatePath(norm)) return false;
  if (norm === ".warpdesk" || norm.startsWith(".warpdesk/")) return true;
  if (norm === "vendor" || norm.startsWith("vendor/")) return true;
  if (norm === "knowledge" || norm.startsWith("knowledge/")) return true;
  if (norm.includes("/knowledge/")) return true;
  return false;
}

/**
 * @param {string} cmd
 * @returns {"read" | "write" | "ambiguous"}
 */
function shellCommandKind(cmd) {
  if (!cmd || !cmd.trim()) return "read";
  const line = cmd.trim();

  if (line.startsWith("REM ") || line.startsWith("::") || line.startsWith("#"))
    return "read";
  if (nodeShellLooksLikeWrite(line)) return "write";

  const segments = line.split(/\s*;\s*|\s+&&\s+|\n+/);
  let worst = /** @type {0|1|2} */ (0);
  for (const raw of segments) {
    const seg = raw.trim();
    if (!seg) continue;
    const kind = oneShellSegmentKind(seg);
    if (kind === "write") {
      worst = 2;
      break;
    }
    if (kind === "ambiguous" && worst < 1) worst = 1;
  }
  if (worst === 2) return "write";
  if (worst === 1) return "ambiguous";
  return "read";
}

/**
 * `node -e` / `node --eval` one-liners are otherwise **ambiguous** (allowed without
 * the clock by default). If the **same shell segment** contains obvious fs write APIs,
 * treat as **write** so the dev clock (and ticket when required) still applies.
 * @param {string} seg one shell segment (includes quoted code from the agent)
 * @returns {boolean}
 */
function nodeShellLooksLikeWrite(seg) {
  if (!/^node(?:\.exe)?\b/i.test(seg)) return false;
  if (
    /\b(?:writeFile|appendFile|outputFile|createWriteStream|copyFile|rename|rmdir|rm|unlink|truncate|mkdir)(?:Sync)?\s*\(/i.test(
      seg,
    )
  ) {
    return true;
  }
  if (/\bfs\.(?:append|write|copy|rename|rm|unlink|mkdir|createWriteStream)\b/i.test(seg))
    return true;
  if (/\bfs\.promises\.(?:writeFile|appendFile|copyFile)\b/i.test(seg)) return true;
  if (
    /clock-local-state\.json/i.test(seg) &&
    /\b(?:writeFile|appendFile|outputFile|createWriteStream|write|append|copyFile|rename|unlink|rm|mkdir)\b/i.test(
      seg,
    )
  ) {
    return true;
  }
  return false;
}

/**
 * @param {string} seg
 * @returns {"read" | "write" | "ambiguous"}
 */
function oneShellSegmentKind(seg) {
  if (/^(?:@?cd|Set-Location|pushd|popd)\b/i.test(seg)) return "read";

  if (hasDangerousRedirection(seg)) return "write";

  if (SED_PEARL_INPLACE.test(seg)) return "write";

  if (/\bOut-File\b|\bSet-Content\b|\bAdd-Content\b/i.test(seg)) return "write";

  if (NPM_WRITE.test(seg)) return "write";

  if (GIT_WRITE.test(seg)) return "write";
  if (GIT_MAYBE_WRITE.test(seg)) return "write";

  if (GIT_READ.test(seg)) return "read";

  if (isGitReadish(seg)) return "read";

  if (isNpmRunReadSafe(seg)) return "read";

  if (isNpxReadSafe(seg)) return "read";

  if (/^(?:ls|dir|Get-ChildItem|gci|Get-Content|type|where|Get-Command|Test-Path|cat|head|tail|wc|findstr|Select-String|Measure-Object|echo|Write-Output)\b/i.test(
    seg,
  ))
    return "read";

  if (
    /^(?:git)\s+branch(?!\s+-(?:D|M|d|m|f|C|c))/i.test(seg) &&
    !/\bbranch\s+(?:-a|-r|-d|-D)\b/.test(seg)
  )
    return "read";

  if (/\b(?:xcopy|robocopy|move|copy|ren|del|rmdir|erase|md|mkdir|mklink)\b/i.test(seg))
    return "write";

  if (/\b(?:cp|mv|rm|touch|tee|shred)\b/.test(seg)) return "write";

  if (/\b(?:^|\s)(?:code|cursor)\s+/.test(seg)) return "write";

  if (/\b(?:rmdir|New-Item|Remove-Item|Copy-Item|Move-Item)\b/i.test(seg))
    return "write";

  if (/^node(?:\.exe)?\b/i.test(seg)) {
    if (nodeShellLooksLikeWrite(seg)) return "write";
    return "ambiguous";
  }

  if (/\b(?:npx|npm exec)\b/i.test(seg)) return "ambiguous";

  if (/\b(?:npm|yarn|pnpm)\s+run\b/i.test(seg)) return "ambiguous";

  if (/\b(?:python|py|pwsh|bash|sh|cmd)\b/i.test(seg)) return "ambiguous";

  return "ambiguous";
}

function hasDangerousRedirection(seg) {
  const s = String(seg)
    .replace(/\b\d?>\s*(?:nul|NUL|NULL|null):?/g, " ")
    .replace(/(?:1>&2|2>&1|2>&-)/g, " ")
    .replace(/\b(?:2|1)>\s*[&\d-]+\b/g, " ");

  if (/(?:^|[^\d\s])\s*(>>?)\s+[^\s&|;]+/.test(s)) return true;
  if (/\btee\b/i.test(s)) return true;
  return false;
}

const reGitSubcommand = /^(?:git)\s+\w+/i;

/**
 * @param {string} seg
 */
function isGitReadish(seg) {
  if (GIT_READ.test(seg)) return true;
  if (!reGitSubcommand.test(seg)) return false;
  if (GIT_WRITE.test(seg) || GIT_MAYBE_WRITE.test(seg)) return false;
  if (/\b(?:--global|--file|config\s+-e|config\s+--edit)\b/.test(seg)) return false;
  if (/^git\s+diff(?:\s|$)/i.test(seg)) return true;
  if (/^git\s+config\s+--(get|list)\b/.test(seg)) return true;
  if (/^git\s+help\b/.test(seg)) return true;
  return false;
}

const reNpmRunReadSafe =
  /^(?:npm|yarn|pnpm)(?:\s+run)?\s+(?:test|lint|format|typecheck|type-check|check)\b/i;

/**
 * @param {string} seg
 */
function isNpmRunReadSafe(seg) {
  if (!reNpmRunReadSafe.test(seg)) return false;
  if (NPM_WRITE.test(seg)) return false;
  if (hasDangerousRedirection(seg)) return false;
  return true;
}

const reNpxReadTools =
  /^(?:(?:npx|pnpm\s+dlx|yarn\s+dlx)\s+)(?:vitest|eslint|tsc|prettier|jest|playwright|mocha)\b/i;

/**
 * @param {string} seg
 */
function isNpxReadSafe(seg) {
  if (!/^(?:npx|pnpm\s+dlx|yarn\s+dlx)\b/i.test(seg)) return false;
  if (hasDangerousRedirection(seg) || SED_PEARL_INPLACE.test(seg)) return false;
  if (reNpxReadTools.test(seg)) return true;
  return false;
}

function denyClock(permission) {
  const msg =
    "WarpDesk cursor clock is not active (see .warpdesk/clock-local-state.json). Start a Cursor session (MCP request_cursor_session action=start) on the active ticket before agent edits. If you intentionally want dev-phase writes, set WARPDESK_HOOK_REQUIRE_CURSOR_PHASE=0 and optionally WARPDESK_HOOK_ALLOW_CURSOR_PHASE=1.";
  return {
    permission,
    user_message: msg,
    agent_message:
      "Blocked by WarpDesk clock hook: cursor phase is required for gated writes/shell. Call request_cursor_session start (active ticket + ticket branch) before edits, or relax with WARPDESK_HOOK_REQUIRE_CURSOR_PHASE=0.",
  };
}

function denyNoTicketId(permission) {
  return {
    permission,
    user_message:
      "WarpDesk clock has no active ticket (ticketId is empty in .warpdesk/clock-local-state.json). Set the active ticket (WarpDesk: Set active ticket, or Start in the ticket selector) before agent edits.",
    agent_message:
      "Blocked: ticketId must be set in .warpdesk/clock-local-state.json for dev/cursor phase. The extension sets it when you pick a ticket. Set WARPDESK_HOOK_ALLOW_NO_TICKET_ID=1 only if you must bypass (not recommended).",
  };
}

/**
 * @param {"deny"|"ask"} permission
 * @param {"phase"|"no_ticket"} blockReason
 */
function denyForClock(permission, blockReason) {
  return blockReason === "no_ticket"
    ? denyNoTicketId(permission)
    : denyClock(permission);
}

function main() {
  const editTools = parseEditTools();
  const gateShell = gateShellEnabled();
  const editToolsList = process.env.WARPDESK_HOOK_EDIT_TOOLS
    ? [...editTools]
    : null;

  let inputRaw = "";
  try {
    inputRaw = fs.readFileSync(0, "utf8");
  } catch (e) {
    dbg("allow", {
      reason: "stdin_read_failed",
      err: e instanceof Error ? e.message : String(e),
    });
    out({ permission: "allow" });
    return;
  }

  let payload;
  try {
    const sanitized = inputRaw.replace(/^\uFEFF/, "").trim();
    payload = sanitized ? JSON.parse(sanitized) : {};
  } catch (e) {
    dbg("deny", { reason: "stdin_json_parse_failed", err: String(e) });
    out({
      permission: "deny",
      user_message:
        "WarpDesk hook failed to parse hook input JSON (BOM/format issue). Blocking edits until hook is healthy.",
      agent_message:
        "Hook parse failed; do not proceed with edits until preToolUse can parse JSON input.",
    });
    return;
  }

  const toolName =
    typeof payload.tool_name === "string" ? payload.tool_name.trim() : "";

  if (!toolName) {
    dbg("allow", { reason: "empty_tool_name" });
    out({ permission: "allow" });
    return;
  }

  const workspaceRoot = resolveWorkspaceRootForHook(
    /** @type {Record<string, unknown>} */ (payload),
  );
  if (!workspaceRoot) {
    dbg("allow", {
      reason: "no_warpdesk_config_resolved",
      note: "Tried cwd, all workspace_roots, and the tool file target directory (see resolveWorkspaceRootForHook).",
    });
    out({ permission: "allow" });
    return;
  }

  const { phase, ticketId } = readLocalClockState(workspaceRoot);
  const allowCursor = process.env.WARPDESK_HOOK_ALLOW_CURSOR_PHASE === "1";
  const gate = evaluateClockGate(phase, ticketId, allowCursor);
  const clockOk = gate.allow;

  const permRaw = (process.env.WARPDESK_HOOK_PERMISSION || "deny").toLowerCase();
  const permBlock = permRaw === "ask" ? "ask" : "deny";

  const isShell = toolName.toLowerCase() === "shell";
  if (isShell && gateShell) {
    const toolInput = payload.tool_input;
    const command =
      toolInput && typeof toolInput === "object" && typeof toolInput.command === "string"
        ? toolInput.command
        : "";
    if (!command) {
      dbg("allow", { reason: "shell_empty_command" });
      out({ permission: "allow" });
      return;
    }
    const kind = shellCommandKind(command);
    if (kind === "read" || (kind === "ambiguous" && !ambiguousIsDeny())) {
      dbg("allow", {
        reason: "shell_kind_allows",
        toolName,
        shellKind: kind,
      });
      out({ permission: "allow" });
      return;
    }
    if (kind === "ambiguous" && ambiguousIsDeny() && clockOk) {
      dbg("allow", { reason: "shell_ambiguous_clock_ok" });
      out({ permission: "allow" });
      return;
    }
    if (clockOk) {
      dbg("allow", {
        reason: "shell_clock_ok",
        toolName,
        phase,
        ticketId,
      });
      out({ permission: "allow" });
      return;
    }
    dbg("deny", {
      reason: "shell_needs_clock",
      toolName,
      phase,
      ticketId,
      block: gate.reason,
      kind,
    });
    out(denyForClock(permBlock, gate.reason));
    return;
  }

  if (!setHasI(editTools, toolName)) {
    dbg("allow", {
      reason: "tool_not_in_edit_gate_set",
      toolName,
      toolNameCodePoints: [...toolName].map((c) => c.charCodeAt(0)).join(","),
      editToolsEnv: process.env.WARPDESK_HOOK_EDIT_TOOLS ?? "(default set)",
      editToolsResolved: editToolsList ?? [...DEFAULT_EDIT_TOOLS],
    });
    out({ permission: "allow" });
    return;
  }

  const toolInput = payload.tool_input;
  const target = primaryTargetPath(toolInput);
  const exempt = Boolean(target && isExemptPath(workspaceRoot, target));
  if (exempt) {
    dbg("allow", {
      reason: "exempt_path",
      toolName,
      target,
      phase,
      ticketId,
    });
    out({ permission: "allow" });
    return;
  }

  if (clockOk) {
    dbg("allow", {
      reason: "clock_ok",
      toolName,
      phase,
      ticketId,
      target,
      exempt: false,
    });
    out({ permission: "allow" });
    return;
  }

  dbg("deny", {
    reason: "edit_needs_dev_clock",
    toolName,
    phase,
    ticketId,
    block: gate.reason,
    target,
  });
  out(denyForClock(permBlock, gate.reason));
}

main();
