# WarpDesk client workspace — agent instructions

## Canonical copy

This file lives under **`vendor/warpdesk-client-kit/AGENTS.md`**. The workspace root **`AGENTS.md`** is a short pointer so you can override behaviour locally without forking the kit.

---

## Git and deploy

Do **not** run **`git push`** (or equivalent: `gh repo sync`, force-push, etc.) to **any** remote unless the **developer explicitly asks** to deploy, publish, or push. Treat pushing as a deliberate human step. Local commits are fine when the developer asks for local-only work.

---

## Knowledge articles (business vs technical)

Place Markdown under the nested **`…-knowledge-base/knowledge/`** tree:

| Path | Use |
| ---- | --- |
| **`knowledge/business/`** | Customer-facing / “public to clients” documentation (process, SLAs, onboarding). |
| **`knowledge/technical/`** | Internal-only docs (architecture, runbooks); default visibility is developers-only in the app. |

Other paths under **`knowledge/`** default to internal until classified. Prefer **`business/`** vs **`technical/`** for new articles.

---

## Tickets — workflow (developers)

1. **Create and check out** a branch whose name includes the **ticket number**, e.g. **`ticket-42`** or **`feature/ticket-42`** (stay consistent within the team). Do this **before** you commit work for that ticket. A conventional commit prefix on whatever branch you happen to be on (e.g. `feat(ticket#42): …` on **`main`**) is **not** a substitute—ticket work belongs on a **dedicated branch**, not only in the message.
2. After pushing the branch or opening a PR, set the ticket’s **`code_link_url`** in the app, or put it in a **draft** (`draft_ticket_update` / YAML) and have a human **apply** it in **warpdesk-tools** (or the app / raw HTTP API), or use **`npm run warpdesk:ticket:patch`** / **`PATCH`** from automation—so work is traceable.
3. Use **`list_priority_active_tickets`** (MCP) or **`npm run warpdesk:tickets:queue`** to see the highest-priority **active** queue without listing every ticket. Pass **`band`** (e.g. `10`) on the MCP tool to match **`GET …/tickets?queue=1&band=10`** (tickets within that many **priority_score** points of the top active ticket).
4. Use **`get_ticket_by_number`** (MCP) or **`GET …/tickets/by-number/{n}`** when you know the workspace ticket number instead of the UUID.
5. Status intent reminder: use **`needs_client`** when code changes are ready for client validation/feedback, use **`client_responded`** when the client replies, and move back to **`cooking`** once developers resume implementation.

---

## Time clocks, Cursor session, and ticket selector (WarpDesk Tools)

When **`warpdesk-tools`** is installed and the workspace folder is open in VS Code / Cursor:

1. **Set active ticket** — Command **WarpDesk: Set active ticket** (UUID + number) so clocks know which ticket to log against. Ticket numbers can only be changed while **no** clock is running.
2. **Dev clock** — **WarpDesk: Start dev clock** / **Stop dev clock**. Only one of **dev** or **Cursor** clock runs at a time. The extension can **auto-pause** dev after configurable idle time (`warpdesk-tools.clockIdleMinutes`).
3. **Cursor clock** — Do **not** flip clocks from the agent alone. Use MCP **`request_cursor_session`**: **`action: start`** calls the extension on **localhost** (reads **`.warpdesk/extension-control.json`**). **Requires the dev clock to be running** and the current **git branch name to include the ticket number**. Start ends the open dev segment and begins a **Cursor** segment. **`action: stop`** ends the Cursor segment and returns to **idle**. Optional **`action: stop_and_resume_dev`** ends Cursor and immediately starts a new dev segment.
4. **Ticket selector file** — A single canonical file **`.warpdesk/tickets.ticket_selector`** (JSON, schema version 2) is **updated automatically** when MCP **`list_priority_active_tickets`**, **`get_ticket`**, **`get_ticket_by_number`**, or **`search_tickets`** succeeds, and when **`tickets-cli.mjs list`** (including **`--queue`**) succeeds from the workspace root. Rows are **merged** (existing tickets stay unless removed server-side), **sorted by `priority_score`** (nulls last), and include **cumulative `dev_ms` / `cursor_ms` / `total_ms`** from **POST `/api/w/…/tickets/time-summaries`**. The **active** hex is preserved by **ticket id** when possible. Open the file with the **WarpDesk ticket selector** editor: read-only ticket + comments, **Refresh**, **Start/Resume** (assign self, `cooking`, branch `ticket-<n>`, optional `code_link_url`, start dev clock), **Pause** (stop dev; stop Cursor first if needed). Hex **tooltips** show persisted clock totals; the footer still reflects **live** refresh for the selected ticket. Footer **hex** colours follow the same pastel rules as the web app (see framework `lib/tickets/ticket-title-pastel.ts` — keep the extension copy in sync).
5. **Failed clock POSTs** — The extension queues segments under **`.warpdesk/clock-pending.jsonl`** and retries on the next successful stop.

6. **Optional hard gate + lifecycle wiring (Cursor hooks)** — Rules alone cannot stop **`Write`** / edit tools or **Shell** bypasses. Copy the hook template from **`vendor/warpdesk-client-kit/templates/cursor-hooks/`** into **`.cursor/hooks.json`** (see **`README.md`** there). It combines:
   - lifecycle orchestration (`sessionStart` / `stop` / `sessionEnd` and tool heartbeat) to call extension control start/stop/touch endpoints
   - hard `preToolUse` enforcement from **`.warpdesk/clock-local-state.json`** (strict mode defaults to requiring `phase: cursor` + ticket id)
   - shell heuristics (including explicit `node -e` fs-write detection and direct block on writing `.warpdesk/clock-local-state.json`)
   - Quick verification checklist in a workspace: confirm **`.cursor/hooks.json`** includes lifecycle + preToolUse commands, confirm preToolUse has **`failClosed: true`**, confirm the referenced scripts exist under **`vendor/warpdesk-client-kit/templates/cursor-hooks/`**, and confirm **`.warpdesk/clock-local-state.json`** changes phase during start/stop flows.

**Primary information source:** prefer the knowledge repo **`knowledge/business/`** and **`knowledge/technical/`** for customer-specific process. Use **web search** only when the user asks or the knowledge base is insufficient.

### MAIN ACTIONS (quick reference)

| Goal | Steps |
| ---- | ----- |
| **Fetch ticket data** | MCP **`list_priority_active_tickets`** (optional `band`), **`get_ticket`**, **`get_ticket_by_number`**, **`search_tickets`** — each success refreshes **`.warpdesk/tickets.ticket_selector`**. Or **`npm run warpdesk:tickets`** / CLI **`list`**. Open **`.warpdesk/tickets.ticket_selector`** in WarpDesk Tools. |
| **Code / doc change** | **`request_cursor_session`** `start` → implement → update knowledge if behaviour changed → **`request_cursor_session`** `stop` (or `stop_and_resume_dev` when you want to jump straight back to dev clock). |
| **Deployment** | Follow **`docs/deployment_strategy.md`** at the root of the WarpDesk **framework** monorepo (or mirror the checklist into **knowledge/technical/** for your team). |
| **Ticket field / comment change** | **`draft_ticket_update`** → human **Confirm** in **warpdesk-tools** (or text-editor commands). |

---

## Tickets — updates and comments (YAML draft)

The **`warpdesk-tickets` MCP server does not expose** **`update_ticket`** or **`add_ticket_comment`** by default. Agents must use **draft → review → apply** for any ticket field change or comment.

1. **`draft_ticket_update`** — writes **`.warpdesk/ticket-drafts/<slug>-<ticket-id>-<id>.ticket_draft`** (YAML). Optional PATCH fields and an optional **`comment`** block (same shape as the HTTP API).
2. The user (or you) **edits** the file; humans **Confirm** or **Discard** in the **`warpdesk-tools`** custom editor for **`*.ticket_draft`** (or the palette commands when the file is opened as **text**). Agents **must not** apply or discard drafts via MCP, CLI, or shell—there are no **`apply_ticket_update_draft`** / **`reject_ticket_update_draft`** tools and no **`apply-draft`** / **`reject-draft`** CLI.
3. **Confirm** runs **PATCH** then optional **POST comment** (same rules as **`mcp/lib/apply-ticket-draft.mjs`**), then **deletes** the draft. **Discard** deletes the file without calling the API.

Ticket comments in the draft should stay **customer-facing**: clear, professional, and **not** overly technical. **Avoid** pasted code, stack traces, and internal file paths unless the customer asked for that detail.

**Escape hatch (humans / scripts only):** set **`WARPDESK_MCP_ALLOW_DIRECT_UPDATES=1`** in **`mcp.json`** `env` next to **`warpdesk-tickets`** to register the legacy **`update_ticket`** and **`add_ticket_comment`** tools (e.g. rare automation). Do not enable this just to skip review.

---

## Before a push (when the developer asked to push)

Summarise **ticket updates** and anything else you intend to do on the remote. Let the developer **accept**, **edit**, **ask you to revise**, or **reject** before you run **`git push`**—do not treat push as automatic after edits.

---

## Tickets — MCP first (read this first)

**Prefer the `warpdesk-tickets` MCP tools** whenever they appear in your tool list (`list_priority_active_tickets`, `get_ticket`, `get_ticket_by_number`, `draft_ticket_update`, `search_tickets`, `request_cursor_session`, `bootstrap_workspace`; plus **`update_ticket`** / **`add_ticket_comment`** only if **`WARPDESK_MCP_ALLOW_DIRECT_UPDATES=1`**). They call the same HTTP API as the app. Read-style ticket tools **merge into `.warpdesk/tickets.ticket_selector`** (see **Ticket selector file** above). For **mutations**, use **`draft_ticket_update`** only to write the draft file; tell the user to **Confirm** in **warpdesk-tools** (do not apply via tools or terminal).

**If MCP tools are not available** (tools not listed, or calls fail after fixing auth), use the **Shell** tool from the **workspace repo root** and run the npm scripts below—the CLI uses the same API and **`warpdesk.config`** / **`.cursor/mcp.json`** token.

```bash
npm run warpdesk:tickets
npm run warpdesk:tickets:queue
npm run warpdesk:ticket -- <ticket-uuid>
npm run warpdesk:tickets:lookup -- "search text"
npm run warpdesk:ticket:patch -- <ticket-uuid> path/to/patch.json
npm run warpdesk:ticket:draft -- <ticket-uuid>   # optional: path/to/initial.json
```

Or run **`node vendor/warpdesk-client-kit/mcp/tickets-cli.mjs`** with subcommands `list` (**`--queue`** for the active priority queue), `get`, `lookup`, **`patch`**, **`draft`**.

**Do not** tell the user you “cannot” access tickets—use MCP when present, otherwise run the CLI commands above and report the output. If the command errors (401, missing token), tell them to create a **personal access token** in the app (**Settings → Personal access tokens** on the same deployment as **`WARPDESK_BASE_URL`**) and set **`WARPDESK_PERSONAL_ACCESS_TOKEN`** in **`.cursor/mcp.json`**. The MCP and CLI do **not** use Supabase session/JWT keys for ticket HTTP calls.

**Do not** paste contents of **`.cursor/mcp.json`** into chat (it contains a bearer token).

---

## MCP in Cursor (enable `warpdesk-tickets`)

1. **Open the client workspace folder as the Cursor project root** (the folder that contains `.cursor/mcp.json` and `vendor/warpdesk-client-kit`). Opening only a subfolder breaks `${workspaceFolder}` in the MCP config.
2. **Enable the server in Cursor (required once per machine/workspace):** **Settings → Features → Model Context Protocol** → find **warpdesk-tickets** → **toggle on**. Quickstart and repo files **cannot** enable this for you; Cursor stores the toggle in the IDE, not in `mcp.json`. If ticket tools never appear, this is the first thing to check.
3. **Config shape:** stdio servers must include **`"type": "stdio"`**. **`args`** must use **`${workspaceFolder}/vendor/warpdesk-client-kit/...`** full paths for **`tsx`** and **`mcp/src/index.ts`** — Cursor resolves bare `node_modules/...` from the workspace root and will fail to find `tsx`. Re-run **`npm run quickstart:customer -- --client-root <path-to-this-workspace>`** from the framework repo if your `.cursor/mcp.json` predates that fix.
4. **Auth:** **`WARPDESK_PERSONAL_ACCESS_TOKEN`** (full `wds_pat_…`) and **`WARPDESK_BASE_URL`** are **required** in `mcp.json` `env`. After updating the token, restart Cursor or reload MCP. Optional: **`WARPDESK_MCP_ALLOW_DIRECT_UPDATES=1`** registers legacy direct PATCH/comment tools (default off).

### For agents

If the user expects MCP ticket tools but they are missing, **tell them explicitly** to enable **warpdesk-tickets** in **Cursor Settings → Features → Model Context Protocol** (step 2 above). Do not assume quickstart already turned it on.

---

## Preconditions

- **`warpdesk.config`** exists at the workspace repo root. **`WORKSPACE_SLUG`** equals the **main workspace repo folder name** (not the knowledge repo).
- **`.cursor/mcp.json`** exists and points MCP at `vendor/warpdesk-client-kit` (written by quickstart; gitignored). It must include a non-empty **`WARPDESK_PERSONAL_ACCESS_TOKEN`** for MCP/CLI to work.
- The **knowledge** repository is the folder named **`<WORKSPACE_SLUG>-knowledge-base`** (often **nested** under the workspace repo). The `workspace` row’s **`git_repo_url`** must point to that repo’s **HTTPS** URL (not the app source repo).

## Steps

1. Read **`warpdesk.config`** for `WORKSPACE_NAME`, `WORKSPACE_SLUG`, and `KNOWLEDGE_REPO_HTTPS` (or build `https://github.com/<GITHUB_OWNER>/<WORKSPACE_SLUG>-knowledge-base`).
2. Use MCP tool **`bootstrap_workspace`** when that tool is available; otherwise direct the user to the app or quickstart for bootstrap.
3. For ticket lists and updates, **use MCP tools first**; fall back to the **`npm run warpdesk:*`** CLI commands in the previous section when MCP is unavailable.
4. If the user asks to add/remove members and you have no membership API, direct them to the framework app; do not fake this via local files.

## Do not

- Commit ticket work only by changing the **commit message** (e.g. `feat(ticket#N):`) while staying on **`main`** / another shared branch—**use a ticket branch** (see **Tickets — workflow**).
- Apply ticket updates or post comments **via MCP** without going through **`draft_ticket_update`** → human review → **Confirm in warpdesk-tools** (use the app UI or CLI **`patch`** if you are not using MCP; there is no MCP or CLI apply-draft for agents).
- Point **`git_repo_url`** at the application repo when it is separate from the knowledge repo (GitHub `push` webhooks would reindex on every code push).
- Create or edit local membership JSON as if it updates Supabase.
