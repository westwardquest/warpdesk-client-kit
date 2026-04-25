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
 * - WARPDESK_HOOK_PERMISSION — `deny` | `ask` when blocked (default `deny`).
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
  const m = p.match(/^\/([a-zA-Z]):\/?(.*)$/);
  if (m) {
    return path.join(`${m[1].toUpperCase()}:`, ...m[2].split("/").filter(Boolean));
  }
  return p;
}

/**
 * @param {Record<string, unknown>} payload
 * @returns {string}
 */
function resolveStartDir(payload) {
  if (typeof payload.cwd === "string" && payload.cwd.trim()) {
    return path.resolve(normalizeCursorPath(payload.cwd.trim()));
  }
  const roots = payload.workspace_roots;
  if (Array.isArray(roots) && typeof roots[0] === "string" && roots[0].trim()) {
    return path.resolve(normalizeCursorPath(roots[0].trim()));
  }
  return process.cwd();
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

function readLocalClockPhase(workspaceRoot) {
  const p = path.join(workspaceRoot, ".warpdesk", "clock-local-state.json");
  if (!fs.existsSync(p)) return "idle";
  try {
    const j = JSON.parse(fs.readFileSync(p, "utf8"));
    const ph = j.phase;
    if (ph === "dev" || ph === "cursor" || ph === "idle") return ph;
    return "idle";
  } catch {
    return "idle";
  }
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

function isExemptPath(workspaceRoot, filePath) {
  if (!filePath) return false;
  const absFile = path.resolve(filePath);
  const absRoot = path.resolve(workspaceRoot);
  const rel = path.relative(absRoot, absFile);
  if (rel.startsWith("..") || rel === "") return false;
  const norm = rel.split(path.sep).join("/");
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

  if (/^node\b/i.test(seg)) return "ambiguous";

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

function requireClock(
  phase,
  allowCursor,
) {
  return (
    phase === "dev" || (allowCursor && phase === "cursor")
  );
}

function denyClock(permission) {
  const msg =
    "WarpDesk dev clock is not running (see .warpdesk/clock-local-state.json). Start dev on the active ticket in WarpDesk Tools / the ticket selector before agent file edits, or set WARPDESK_HOOK_ALLOW_CURSOR_PHASE=1 to allow while the Cursor clock phase is active.";
  return {
    permission,
    user_message: msg,
    agent_message:
      "Blocked by WarpDesk clock hook: start the dev clock on the active ticket (or enable cursor phase via env) before substantive edits (including this shell). Set WARPDESK_HOOK_GATE_SHELL=0 to disable shell gating.",
  };
}

function main() {
  const editTools = parseEditTools();
  const gateShell = gateShellEnabled();
  let inputRaw = "";
  try {
    inputRaw = fs.readFileSync(0, "utf8");
  } catch {
    out({ permission: "allow" });
    return;
  }

  let payload;
  try {
    payload = inputRaw ? JSON.parse(inputRaw) : {};
  } catch {
    out({ permission: "allow" });
    return;
  }

  const toolName =
    typeof payload.tool_name === "string" ? payload.tool_name : "";

  if (!toolName) {
    out({ permission: "allow" });
    return;
  }

  const startDir = resolveStartDir(
    /** @type {Record<string, unknown>} */ (payload),
  );
  const workspaceRoot = findWorkspaceRoot(startDir);
  if (!workspaceRoot) {
    out({ permission: "allow" });
    return;
  }

  const phase = readLocalClockPhase(workspaceRoot);
  const allowCursor = process.env.WARPDESK_HOOK_ALLOW_CURSOR_PHASE === "1";
  const clockOk = requireClock(phase, allowCursor);

  const permRaw = (process.env.WARPDESK_HOOK_PERMISSION || "deny").toLowerCase();
  const permBlock = permRaw === "ask" ? "ask" : "deny";

  if (toolName === "Shell" && gateShell) {
    const toolInput = payload.tool_input;
    const command =
      toolInput && typeof toolInput === "object" && typeof toolInput.command === "string"
        ? toolInput.command
        : "";
    if (!command) {
      out({ permission: "allow" });
      return;
    }
    const kind = shellCommandKind(command);
    if (kind === "read" || (kind === "ambiguous" && !ambiguousIsDeny())) {
      out({ permission: "allow" });
      return;
    }
    if (kind === "ambiguous" && ambiguousIsDeny() && clockOk) {
      out({ permission: "allow" });
      return;
    }
    if (clockOk) {
      out({ permission: "allow" });
      return;
    }
    out(denyClock(permBlock));
    return;
  }

  if (!editTools.has(toolName)) {
    out({ permission: "allow" });
    return;
  }

  const toolInput = payload.tool_input;
  const target = primaryTargetPath(toolInput);
  if (target && isExemptPath(workspaceRoot, target)) {
    out({ permission: "allow" });
    return;
  }

  if (clockOk) {
    out({ permission: "allow" });
    return;
  }

  out(denyClock(permBlock));
}

main();
