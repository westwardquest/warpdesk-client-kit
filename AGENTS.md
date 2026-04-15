# EDF client workspace — agent instructions

## Canonical copy

This file lives under **`vendor/edf-client-kit/AGENTS.md`**. The workspace root **`AGENTS.md`** is a short pointer so you can override behaviour locally without forking the kit.

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

1. Create a branch that includes the **ticket number**, e.g. **`ticket-42`** or `feature/ticket-42` (stay consistent within the team).
2. After pushing the branch or opening a PR, set the ticket’s **`code_link_url`** in the app (or via **`update_ticket`** MCP / **`PATCH`** API) to the branch or PR URL so work is traceable.
3. Use **`list_priority_active_tickets`** (MCP) or **`npm run edf:tickets:queue`** to see the highest-priority **active** queue without listing every ticket.

---

## Tickets — comments

Ticket comments should be **customer-facing**: clear, professional, and **not** overly technical. **Avoid** pasted code, stack traces, and internal file paths unless the customer explicitly asked for that level of detail.

---

## Before a push (when the developer asked to push)

Summarise **ticket updates** and **draft comments** you intend to post. Let the developer **accept**, **edit**, **ask you to revise**, or **reject** before you run **`git push`** or post comments—do not treat push as automatic after edits.

---

## Agent sessions (most Cursor chats — read this first)

**Coding agents and many Cursor chats do not expose MCP tools** (`list_tickets`, etc.). You will not see `edf-tickets` in your tool list. **That is normal.**

To list or fetch tickets you **must** use the **Shell** tool from the **workspace repo root**:

```bash
npm run edf:tickets
```

Same HTTP API as MCP: `GET /api/w/{slug}/tickets`. Reads **`WORKSPACE_SLUG`** and **`DEV_APP_ORIGIN`** from **`edf.config`**, and **`EDF_PERSONAL_ACCESS_TOKEN`** from the environment or **`.cursor/mcp.json`** (`mcpServers.edf-tickets.env`).

Other commands:

```bash
npm run edf:tickets:queue
npm run edf:ticket -- <ticket-uuid>
npm run edf:tickets:lookup -- "search text"
npm run edf:ticket:patch -- <ticket-uuid> path/to/patch.json
```

Or run **`node vendor/edf-client-kit/mcp/tickets-cli.mjs`** with subcommands `list` (**`--queue`** for active priority queue), `get`, `lookup`, **`patch`**.

**Do not** tell the user you “cannot” pull live tickets because MCP is unavailable — **run the commands above** and report the output. If the command errors (401, missing token), tell them to create a **personal access token** in the app (**Settings → Personal access tokens** on the same deployment as **`EDF_BASE_URL`**) and set **`EDF_PERSONAL_ACCESS_TOKEN`** in **`.cursor/mcp.json`**. The MCP and CLI do **not** use `EDF_SUPABASE_ACCESS_TOKEN`.

**Do not** paste contents of **`.cursor/mcp.json`** into chat (it contains a bearer token).

---

## When MCP tools *are* available (rare in agent mode)

If **`list_tickets`**, **`list_priority_active_tickets`**, **`get_ticket`**, or **`update_ticket`** appear in your tool list, you may use those instead of the CLI. **Do not** call `list_mcp_resources` or similar unless your environment documents it — prefer the CLI when unsure.

If ticket calls return **401**, the PAT may be wrong, revoked, or created on a different deployment than **`EDF_BASE_URL`**. There is no `refresh_supabase_session` tool — issue a new PAT in the app if needed.

---

## MCP in Cursor (when you want `edf-tickets` in the IDE)

1. **Open the client workspace folder as the Cursor project root** (the folder that contains `.cursor/mcp.json` and `vendor/edf-client-kit`). Opening only a subfolder breaks `${workspaceFolder}` in the MCP config.
2. **Enable the server in Cursor (required once per machine/workspace):** **Settings → Features → Model Context Protocol** → find **edf-tickets** → **toggle on**. Quickstart and repo files **cannot** enable this for you; Cursor stores the toggle in the IDE, not in `mcp.json`. If ticket tools never appear, this is the first thing to check.
3. **Config shape:** stdio servers must include **`"type": "stdio"`**. **`args`** must use **`${workspaceFolder}/vendor/edf-client-kit/...`** full paths for **`tsx`** and **`mcp/src/index.ts`** — Cursor resolves bare `node_modules/...` from the workspace root and will fail to find `tsx`. Re-run **`npm run quickstart:customer -- --client-root <path-to-this-workspace>`** from the framework repo if your `.cursor/mcp.json` predates that fix.
4. **Auth:** **`EDF_PERSONAL_ACCESS_TOKEN`** (full `edf_pat_…`) and **`EDF_BASE_URL`** are **required** in `mcp.json` `env`. After updating the token, restart Cursor or reload MCP.

### For agents

If the user expects MCP ticket tools but they are missing, **tell them explicitly** to enable **edf-tickets** in **Cursor Settings → Features → Model Context Protocol** (step 2 above). Do not assume quickstart already turned it on.

---

## Preconditions

- **`edf.config`** exists at the workspace repo root. **`WORKSPACE_SLUG`** equals the **main workspace repo folder name** (not the knowledge repo).
- **`.cursor/mcp.json`** exists and points MCP at `vendor/edf-client-kit` (written by quickstart; gitignored). It must include a non-empty **`EDF_PERSONAL_ACCESS_TOKEN`** for MCP/CLI to work.
- The **knowledge** repository is the folder named **`<WORKSPACE_SLUG>-knowledge-base`** (often **nested** under the workspace repo). The `workspace` row’s **`git_repo_url`** must point to that repo’s **HTTPS** URL (not the app source repo).

## Steps

1. Read **`edf.config`** for `WORKSPACE_NAME`, `WORKSPACE_SLUG`, and `KNOWLEDGE_REPO_HTTPS` (or build `https://github.com/<GITHUB_OWNER>/<WORKSPACE_SLUG>-knowledge-base`).
2. Use MCP tool **`bootstrap_workspace`** only if that tool is available; otherwise direct the user to the app or quickstart for bootstrap.
3. For ticket lists, **`npm run edf:tickets`** (see above) unless MCP ticket tools are in your tool list.
4. If the user asks to add/remove members and you have no membership API, direct them to the framework app; do not fake this via local files.

## Do not

- Point **`git_repo_url`** at the application repo when it is separate from the knowledge repo (GitHub `push` webhooks would reindex on every code push).
- Create or edit local membership JSON as if it updates Supabase.
