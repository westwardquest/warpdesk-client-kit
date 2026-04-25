# Cursor hook: dev clock before edits

Optional **project** hook so the agent cannot use substantive **write / edit** tools until the WarpDesk **dev** clock is running (same signal as **`.warpdesk/clock-local-state.json`** `phase`).

## Install

1. Ensure **Node.js** is on your PATH (Cursor inherits the environment from your OS login; restart Cursor after installing Node).
2. Copy **`hooks.warpdesk-dev-clock.example.json`** to **`.cursor/hooks.json`** at the workspace repo root (merge with any existing `hooks` keys — do not delete unrelated hooks).
3. Adjust **`command`** if your kit is not under **`vendor/warpdesk-client-kit/`** (e.g. monorepo path to **`packages/warpdesk-client-kit/templates/cursor-hooks/preToolUse-warpdesk-dev-clock.mjs`**).

## Behaviour

- Resolves workspace root from hook **`cwd`**, or **`workspace_roots[0]`** when **`cwd`** is empty (Cursor often sends roots only), by walking up until **`warpdesk.config`** exists.
- If no config is found, the hook **allows** (fail open for non–WarpDesk trees).
- Gates tool names in **`WARPDESK_HOOK_EDIT_TOOLS`** (comma-separated); default includes **`Write`**, **`StrReplace`**, and other common edit aliases — extend if your Cursor version uses different names.
- **`Shell` (optional, on by default):** set **`WARPDESK_HOOK_GATE_SHELL=0`** to disable. When enabled, **read-only** commands (e.g. **`git diff`**, **`git status`**, many **`npm run test` / `npx vitest`** patterns) are allowed without the clock. **Suspicious** commands (redirection to a file, **`git commit`**, **`npm install`**, **`copy`/`move`**, **`npx`** not matching a small allowlist, arbitrary **`npm run`**, **`node`**, etc.) require the same dev-clock phase as file-edit tools. **Ambiguous** commands default to **allow**; set **`WARPDESK_HOOK_SHELL_AMBIGUOUS=deny`** to require the clock for those too. Heuristics are not a full sandbox; review tool output if needed.
- **Allows** path-targeted edits under **`.warpdesk/`**, **`vendor/`**, and **`knowledge/`** (for **`Write` / StrReplace–style tools) without requiring the clock — **Shell** is not path-parsed the same way; use exemptions above at your own risk.
- **`WARPDESK_HOOK_ALLOW_CURSOR_PHASE=1`**: also allow when **`phase`** is **`cursor`** (agent-driven Cursor segment).
- **`WARPDESK_HOOK_PERMISSION`**: **`deny`** (default) or **`ask`** when the clock is idle.

See **`AGENTS.md`** in this kit for workflow context (dev vs Cursor clock, **`request_cursor_session`**).
