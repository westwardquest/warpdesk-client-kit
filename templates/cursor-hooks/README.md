# Cursor hook: dev clock before edits

Optional **project** hook so the agent cannot use substantive **write / edit** tools until the WarpDesk **dev** clock is running with an **active ticket** (same file as **`.warpdesk/clock-local-state.json`**: `phase` and non-empty `ticketId`).

## Install

1. Ensure **Node.js** is on your PATH (Cursor inherits the environment from your OS login; restart Cursor after installing Node).
2. Copy **`hooks.warpdesk-dev-clock.example.json`** to **`.cursor/hooks.json`** at the workspace repo root (merge with any existing `hooks` keys — do not delete unrelated hooks).
3. Adjust **`command`** if your kit is not under **`vendor/warpdesk-client-kit/`** (e.g. monorepo path to **`packages/warpdesk-client-kit/templates/cursor-hooks/preToolUse-warpdesk-dev-clock.mjs`**).

## Behaviour

- Resolves the **client** workspace by trying **`cwd`**, **each** entry in **`workspace_roots`** (not only the first — monorepo parents without `warpdesk.config` no longer force a fail-open), then walking up from the **tool target file** when present, until **`warpdesk.config`** exists.
- If no config is found after that, the hook **allows** (fail open for non–WarpDesk trees).
- Gates tool names in **`WARPDESK_HOOK_EDIT_TOOLS`** (comma-separated); default includes **`Write`**, **`StrReplace`**, and other common edit aliases — extend if your Cursor version uses different names.
- **`Shell` (optional, on by default):** set **`WARPDESK_HOOK_GATE_SHELL=0`** to disable. When enabled, **read-only** commands (e.g. **`git diff`**, **`git status`**, many **`npm run test` / `npx vitest`** patterns) are allowed without the clock. **Suspicious** commands (redirection to a file, **`git commit`**, **`npm install`**, **`copy`/`move`**, **`npx`** not matching a small allowlist, arbitrary **`npm run`**, **`node`**, etc.) require the same dev-clock phase as file-edit tools. Plain **`node`** / **`node.exe`** stays **ambiguous** by default, but **`node -e` / `--eval` text that embeds obvious **`fs`** writes** (e.g. **`writeFileSync`**) is classified as **write**, not ambiguous, so it cannot bypass the clock. **Ambiguous** commands default to **allow**; set **`WARPDESK_HOOK_SHELL_AMBIGUOUS=deny`** to require the clock for those too. Heuristics are not a full sandbox; review tool output if needed.
- **Allows** path-targeted edits under **`.warpdesk/`**, **`vendor/`**, and **`knowledge/`** (for **`Write`** / **StrReplace**–style tools) without requiring the clock — **except** **`.warpdesk/clock-local-state.json`**, which is always gated: otherwise the agent could forge **phase** / **ticketId** to bypass the hook on the next tool call. **Shell** is not path-parsed the same way; use exemptions above at your own risk.
- **`WARPDESK_HOOK_ALLOW_CURSOR_PHASE=1`**: also allow when **`phase`** is **`cursor`** (agent-driven Cursor segment).
- When **`phase`** is **`dev`** or **`cursor`** (and Cursor phase is allowed), edits require a **non-empty `ticketId`** in **`clock-local-state.json`**. If **`ticketId`** is missing, the hook **blocks** with a specific message. Set **`WARPDESK_HOOK_ALLOW_NO_TICKET_ID=1`** only to skip that check (e.g. local emergency).
- **`WARPDESK_HOOK_PERMISSION`**: **`deny`** (default) or **`ask`** for any **blocked** tool use (idle phase, missing **`ticketId`**, or gated **Shell** that needs the clock).
- **`WARPDESK_HOOK_DEBUG=1`**: log JSON lines to **stderr** (Hooks output in Cursor) with **`reason`** codes (`tool_not_in_edit_gate_set`, `no_warpdesk_config_resolved`, `exempt_path`, `edit_needs_dev_clock`, etc.). Tool names are matched **case-insensitively** (`write` vs `Write`).
- Input JSON is parsed after removing a leading UTF-8 BOM (`\uFEFF`). If parsing still fails, the hook returns **`deny`** to avoid fail-open writes.
- The example `hooks.warpdesk-dev-clock.example.json` sets **`failClosed: true`** so timeouts/crashes/error output from this hook do not silently allow edits.

See **`AGENTS.md`** in this kit for workflow context (dev vs Cursor clock, **`request_cursor_session`**).
