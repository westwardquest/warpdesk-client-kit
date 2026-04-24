/**
 * Ticket selector JSON for WarpDesk Tools custom editor (*.ticketselector).
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";

const SELECTOR_SUBDIR = path.join(".warpdesk", "ticket-selectors");

export type TicketSelectorEntry = {
  id: string;
  ticket_number: number;
  title: string;
  priority_score: number | null;
};

export type TicketSelectorDoc = {
  schema_version: number;
  workspace_slug: string;
  tickets: TicketSelectorEntry[];
  active_index: number;
};

export function writeTicketSelectorFile(params: {
  workspaceRoot: string;
  slug: string;
  tickets: TicketSelectorEntry[];
  active_index?: number;
}): { relativePath: string; absolutePath: string } {
  const { workspaceRoot, slug, tickets } = params;
  const active_index =
    typeof params.active_index === "number" &&
    params.active_index >= 0 &&
    params.active_index < tickets.length
      ? params.active_index
      : 0;
  const short = crypto.randomBytes(4).toString("hex");
  const name = `${slug}-tickets-${short}.ticketselector`;
  const dir = path.join(workspaceRoot, SELECTOR_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  const absolutePath = path.join(dir, name);
  const doc: TicketSelectorDoc = {
    schema_version: 1,
    workspace_slug: slug,
    tickets,
    active_index,
  };
  fs.writeFileSync(
    absolutePath,
    `${JSON.stringify(doc, null, 2)}\n`,
    "utf8",
  );
  const relativePath = path.join(SELECTOR_SUBDIR, name);
  return {
    relativePath: relativePath.split(path.sep).join("/"),
    absolutePath,
  };
}
