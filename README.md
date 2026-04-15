# EDF client kit

Portable **ticket MCP** and **Cursor** onboarding for customer workspaces: `mcp/`, reference **`templates/`**, **`AGENTS.md`**, and this README.

**In the Extreme Development Framework monorepo**, this tree is a **git submodule** at **`packages/edf-client-kit`** that tracks **[westwardquest/edf-client-kit](https://github.com/westwardquest/edf-client-kit)** — clone the framework with **`--recurse-submodules`**. Customer workspaces get **`vendor/edf-client-kit`** via **`npm run quickstart:customer`** (submodule when the workspace is a git repo) or **`scripts/quickstarts/setup-edf-kit.mjs`**.

Workspace-only automation (webhook helper, quickstart, optional launch helper) lives in the framework repo under **`scripts/quickstarts/`** — see **[`docs/repository_layout.md`](../../docs/repository_layout.md)**.

## Publishing (maintainers)

The **published** repo is **[github.com/westwardquest/edf-client-kit](https://github.com/westwardquest/edf-client-kit)**. Work in **`packages/edf-client-kit`** in the monorepo (that folder is the submodule checkout), commit, and push:

```bash
cd packages/edf-client-kit
git push origin main

cd ../..
git add packages/edf-client-kit
git commit -m "chore: bump edf-client-kit submodule"
```

Full workflow and clone instructions: **[`scripts/setup-edf-kit-remote.md`](../../scripts/setup-edf-kit-remote.md)**.

Quickstart defaults **`EDF_CLIENT_KIT_GIT_URL`** to **`https://github.com/westwardquest/edf-client-kit.git`**. Override in **`.env.local`** if you fork.

## Contents

- **`mcp/`** — stdio MCP server (`npm run mcp:tickets`) plus **`mcp/tickets-cli.mjs`** (list/get/lookup/patch via the same HTTP API when MCP is not available in chat). Quickstart adds a workspace **`package.json`** with **`npm run edf:tickets`** (and **`edf:tickets:queue`**, **`edf:ticket:patch`**).
- **`templates/`** — `edf.config.example`, `workspace-users.json.example`, **`templates/workspace-AGENTS.stub.md`** (copied to the workspace root as **`AGENTS.md`** so the full rules stay in this kit), knowledge-repo template (used by quickstart from monorepo paths, not copied into trimmed `vendor/`).
- **`AGENTS.md`** — full Cursor/agent rules for tickets, MCP, knowledge **`business/`** vs **`technical/`**, and git/push expectations.

## Workspace copy under `vendor/edf-client-kit`

- **With a workspace git root (default):** quickstart adds **`vendor/edf-client-kit`** as a **git submodule** — the full published tree is visible and pullable in Cursor’s Source Control.
- **With `--no-git-init`:** quickstart uses a **shallow clone** and **trims** to runtime MCP files only:

  - `package.json`
  - `mcp/`
  - `.git` (so you can **`git pull`** in that clone)
  - installed dependencies (`node_modules/`)

  Templates and monorepo scripts are omitted from that trimmed tree to reduce noise.

## Naming (fixed)

- **Workspace slug** = main **workspace repo** folder name (GitHub-safe: `a-z`, `0-9`, hyphens).
- **Knowledge repo** folder name is **`<slug>-knowledge-base`**, usually **nested** under the workspace clone (`quickstarts/<slug>/<slug>-knowledge-base/`). Only that repo gets the GitHub **`push`** webhook to EDF.

## After scaffold

1. In **Cursor:** **Settings → Features → Model Context Protocol** → enable **edf-tickets** (quickstart cannot enable it automatically).
2. Re-run from the **framework** repo only when needed: **`npm run quickstart:customer -- --client-root <workspace-repo>`** — refresh bootstrap/session + **`.cursor/mcp.json`**.
3. Knowledge webhook (if not created by quickstart `--push`): from the framework repo, **`node scripts/quickstarts/create-knowledge-webhook.mjs <workspace-root>`**.

See the framework **`README.md`**, **[`docs/repository_layout.md`](../../docs/repository_layout.md)**, and **`examples/cursor-workspace/README.md`**.

## Env (MCP)

| Variable | Purpose |
| -------- | ------- |
| `EDF_BASE_URL` | Same as `DEV_APP_ORIGIN` in `edf.config` (no trailing slash). Must match the deployment where the PAT was created. |
| `EDF_PERSONAL_ACCESS_TOKEN` | **Required.** Full `edf_pat_…` from the app **Settings → Personal access tokens**. The MCP sends this as `Authorization: Bearer …` on every request (no `EDF_SUPABASE_ACCESS_TOKEN`). |

## Updating the kit

- **From a client workspace (submodule):** `vendor/edf-client-kit` is **tracked** by the workspace repo. Run **`git pull`** inside **`vendor/edf-client-kit`**, or **`git submodule update --remote vendor/edf-client-kit`** from the workspace root, then **`npm install`** there if needed.
- **In the framework monorepo:** **`packages/edf-client-kit`** is the same GitHub repo — **`git pull`** / **`git push`** there (see **Publishing** above). No separate “sync from framework” script.
- **Recreate from scratch:** re-run **`npm run quickstart:customer`** (or **`scripts/quickstarts/setup-edf-kit.mjs`**) if you prefer a clean tree.

**Shallow clone workspaces (`--no-git-init`):** `vendor/` stays gitignored; **`git pull`** inside **`vendor/edf-client-kit`** is still the simple path.
