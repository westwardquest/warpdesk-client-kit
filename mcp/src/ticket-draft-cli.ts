/**
 * CLI for ticket drafts (invoked via tsx from tickets-cli.mjs).
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { findWorkspaceRoot, writeTicketDraft } from "./ticket-draft";
import { loadWorkspaceConfig } from "./workspace-config";

async function main() {
  const argv = process.argv.slice(2);
  const cmd = argv[0];

  if (!cmd || cmd === "-h" || cmd === "--help") {
    printUsage();
    process.exit(cmd ? 0 : 1);
  }

  const workspaceRoot = findWorkspaceRoot();
  if (!workspaceRoot) {
    throw new Error(
      "warpdesk.config not found — run from the workspace repo root (or a subfolder under it).",
    );
  }

  if (cmd === "draft") {
    if (!argv[1]) {
      console.error("draft requires <ticketUuid>");
      printUsage();
      process.exit(1);
    }
    const ticketId = argv[1];
    const { slug } = loadWorkspaceConfig(workspaceRoot);
    let initial: Parameters<typeof writeTicketDraft>[0]["initial"];
    if (argv[2]) {
      const p = path.resolve(workspaceRoot, argv[2]);
      const raw = fs.readFileSync(p, "utf8");
      initial = JSON.parse(raw) as typeof initial;
    }
    const r = writeTicketDraft({
      workspaceRoot,
      slug,
      ticketId,
      initial,
    });
    console.log(
      JSON.stringify(
        {
          ok: true,
          draft_path: r.draftRelativePath,
          absolutePath: r.absolutePath,
        },
        null,
        2,
      ),
    );
    console.error(
      "\nEdit the file if needed, then open it in the WarpDesk Tools ticket draft editor and use Confirm or Discard (apply/reject are not available via CLI).\n",
    );
    return;
  }

  printUsage();
  process.exit(1);
}

function printUsage() {
  console.error(`Usage:
  npx tsx mcp/src/ticket-draft-cli.ts draft <ticketUuid> [initial.json]
`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
