# WarpDesk client kit

Portable **ticket MCP** and **Cursor** onboarding for customer workspaces: `mcp/`, reference **`templates/`**, **`AGENTS.md`**, and this README.

**In the WarpDesk framework monorepo**, this tree is a **git submodule** at **`packages/warpdesk-client-kit`** (remote URL in **`.gitmodules`** / **`WARPDESK_CLIENT_KIT_GIT_URL`**) — clone the framework with **`--recurse-submodules`**. Customer workspaces get **`vendor/warpdesk-client-kit`** via **`npm run quickstart:customer`** (submodule when the workspace is a git repo) or **`scripts/quickstarts/setup-warpdesk-kit.mjs`**.

Workspace-only automation (webhook helper, quickstart, optional launch helper) lives in the framework repo under **`scripts/quickstarts/`** — see **[`docs/engineering/repository_layout.md`](../../docs/engineering/repository_layout.md)**.

## Publishing (maintainers)

The **published** client kit is the Git remote configured for this submodule (see **`WARPDESK_CLIENT_KIT_GIT_URL`**). Work in **`packages/warpdesk-client-kit`** in the monorepo (that folder is the submodule checkout), commit, and push:

```bash
cd packages/warpdesk-client-kit
git push origin main

cd ../..
git add packages/warpdesk-client-kit
git commit -m "chore: bump warpdesk-client-kit submodule"
```

Full workflow and clone instructions: **[`scripts/setup-warpdesk-kit-remote.md`](../../scripts/setup-warpdesk-kit-remote.md)**.

Quickstart defaults **`WARPDESK_CLIENT_KIT_GIT_URL`** to the URL in **`.env.example`**. Override in **`.env.local`** if you fork.

## Contents

- **`mcp/`** — stdio MCP server (`npm run mcp:tickets`) plus **`mcp/tickets-cli.mjs`** (list/get/lookup/patch; **`draft`** for YAML ticket drafts under **`.warpdesk/ticket-drafts/*.ticket_draft`**). Also registers **`create_ticket_selector_file`** (JSON under **`.warpdesk/ticket-selectors/*.ticketselector`**) and **`request_cursor_session`** (localhost → **warpdesk-tools**). Apply/reject drafts use **`mcp/lib/apply-ticket-draft.mjs`** from the **warpdesk-tools** extension (not MCP or CLI). MCP **defaults to draft-only** for ticket mutations (no **`update_ticket`** / **`add_ticket_comment`** unless **`WARPDESK_MCP_ALLOW_DIRECT_UPDATES=1`** in `mcp.json` env). Quickstart adds a workspace **`package.json`** with **`npm run warpdesk:tickets`**, **`warpdesk:ticket:draft`**, etc.
- **`../warpdesk-tools`** (framework monorepo) — optional **VS Code / Cursor** extension **warpdesk-tools** (Apply / Discard ticket draft commands). Not vendored into customer repos by default; install from a VSIX or open the folder in **Extensions → Install from Location**.
- **`templates/`** — `warpdesk.config.example`, `workspace-users.json.example`, **`templates/workspace-AGENTS.stub.md`** (copied to the workspace root as **`AGENTS.md`** so the full rules stay in this kit), **`templates/warpdesk-ticket-drafts.mdc`** (copied by quickstart to **`.cursor/rules/warpdesk-ticket-drafts.mdc`** — draft-only ticket mutations), knowledge-repo template (used by quickstart from monorepo paths, not copied into trimmed `vendor/`).
- **`AGENTS.md`** — full Cursor/agent rules for tickets, MCP, knowledge **`business/`** vs **`technical/`**, and git/push expectations.

## Workspace copy under `vendor/warpdesk-client-kit`

- **With a workspace git root (default):** quickstart adds **`vendor/warpdesk-client-kit`** as a **git submodule** — the full published tree is visible and pullable in Cursor’s Source Control.
- **With `--no-git-init`:** quickstart uses a **shallow clone** and **trims** to runtime MCP files only:

  - `package.json`
  - `mcp/`
  - `.git` (so you can **`git pull`** in that clone)
  - installed dependencies (`node_modules/`)

  Templates and monorepo scripts are omitted from that trimmed tree to reduce noise.

## Naming (fixed)

- **Workspace slug** = main **workspace repo** folder name (GitHub-safe: `a-z`, `0-9`, hyphens).
- **Knowledge repo** folder name is **`<slug>-knowledge-base`**, usually **nested** under the workspace clone (`quickstarts/<slug>/<slug>-knowledge-base/`). Only that repo gets the GitHub **`push`** webhook to the WarpDesk app.

## After scaffold

1. In **Cursor:** **Settings → Features → Model Context Protocol** → enable **warpdesk-tickets** (quickstart cannot enable it automatically).
2. Re-run from the **framework** repo only when needed: **`npm run quickstart:customer -- --client-root <workspace-repo>`** — refresh bootstrap/session + **`.cursor/mcp.json`**.
3. Knowledge webhook (if not created by quickstart `--push`): from the framework repo, **`node scripts/quickstarts/create-knowledge-webhook.mjs <workspace-root>`**.

See the framework **`README.md`**, **[`docs/engineering/repository_layout.md`](../../docs/engineering/repository_layout.md)**, and **[`docs/integrations/agents_and_api.md`](../../docs/integrations/agents_and_api.md)** (MCP + quickstart).

## Env (MCP)

| Variable | Purpose |
| -------- | ------- |
| `WARPDESK_BASE_URL` | Same as `DEV_APP_ORIGIN` in `warpdesk.config` (no trailing slash). Must match the deployment where the PAT was created. |
| `WARPDESK_PERSONAL_ACCESS_TOKEN` | **Required.** Full `wds_pat_…` from the app **Settings → Personal access tokens**. The MCP sends this as `Authorization: Bearer …` on every request — not Supabase session/JWT keys. |

## Updating the kit

- **From a client workspace (submodule):** `vendor/warpdesk-client-kit` is **tracked** by the workspace repo. Run **`git pull`** inside **`vendor/warpdesk-client-kit`**, or **`git submodule update --remote vendor/warpdesk-client-kit`** from the workspace root, then **`npm install`** there if needed.
- **In the framework monorepo:** **`packages/warpdesk-client-kit`** is the same GitHub repo — **`git pull`** / **`git push`** there (see **Publishing** above). No separate “sync from framework” script.
- **Recreate from scratch:** re-run **`npm run quickstart:customer`** (or **`scripts/quickstarts/setup-warpdesk-kit.mjs`**) if you prefer a clean tree.

**Shallow clone workspaces (`--no-git-init`):** `vendor/` stays gitignored; **`git pull`** inside **`vendor/warpdesk-client-kit`** is still the simple path.
