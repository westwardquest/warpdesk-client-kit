#!/usr/bin/env node
/**
 * Cursor preToolUse hook: require WarpDesk **dev** clock before substantive edits.
 *
 * Copy into `.cursor/hooks/` and point `.cursor/hooks.json` at this file, or run
 * from `vendor/warpdesk-client-kit/templates/cursor-hooks/` (see hooks.warpdesk-dev-clock.example.json).
 *
 * Env (optional):
 * - WARPDESK_HOOK_EDIT_TOOLS — comma-separated tool_name values to gate (default below).
 * - WARPDESK_HOOK_ALLOW_CURSOR_PHASE=1 — treat **cursor** phase like **dev** (allow edits while Cursor clock runs).
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

function main() {
  const editTools = parseEditTools();
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
  if (!toolName || !editTools.has(toolName)) {
    out({ permission: "allow" });
    return;
  }

  const cwd =
    typeof payload.cwd === "string" && payload.cwd
      ? payload.cwd
      : process.cwd();
  const workspaceRoot = findWorkspaceRoot(cwd);
  if (!workspaceRoot) {
    out({ permission: "allow" });
    return;
  }

  const toolInput = payload.tool_input;
  const target = primaryTargetPath(toolInput);
  if (target && isExemptPath(workspaceRoot, target)) {
    out({ permission: "allow" });
    return;
  }

  const phase = readLocalClockPhase(workspaceRoot);
  const allowCursor = process.env.WARPDESK_HOOK_ALLOW_CURSOR_PHASE === "1";
  const allowed =
    phase === "dev" || (allowCursor && phase === "cursor");

  if (allowed) {
    out({ permission: "allow" });
    return;
  }

  const permRaw = (process.env.WARPDESK_HOOK_PERMISSION || "deny").toLowerCase();
  const permission = permRaw === "ask" ? "ask" : "deny";
  const msg =
    "WarpDesk dev clock is not running (see .warpdesk/clock-local-state.json). Start dev on the active ticket in WarpDesk Tools / the ticket selector before agent file edits, or set WARPDESK_HOOK_ALLOW_CURSOR_PHASE=1 to allow while the Cursor clock phase is active.";

  out({
    permission,
    user_message: msg,
    agent_message:
      "Blocked by WarpDesk clock hook: start the dev clock on the active ticket (or enable cursor phase via env) before using write/edit tools.",
  });
}

main();
