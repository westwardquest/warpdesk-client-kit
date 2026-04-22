/**
 * Ticket update drafts: YAML on disk under .warpdesk/ticket-drafts/.
 * Apply/reject (PATCH + optional POST, or delete file) lives in ../lib/apply-ticket-draft.mjs
 * for the WarpDesk Tools extension and must not be exposed to agents via MCP or draft CLI.
 */
import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";
import { findWorkspaceRoot } from "../workspace-root.mjs";

export { findWorkspaceRoot };

const DRAFT_SUBDIR = path.join(".warpdesk", "ticket-drafts");

export type TicketDraftDoc = {
  schema_version: number;
  workspace_slug: string;
  ticket_id: string;
  title?: string;
  description?: string;
  type?: string;
  status?: string;
  customer_score?: number;
  customer_priority?: string;
  assignee_user_id?: string | null;
  code_link_url?: string | null;
  deadline?: string | null;
  comment?: {
    body?: string;
    visibility?: string;
    parent_comment_id?: string;
  };
};

function draftTemplate(
  slug: string,
  ticketId: string,
  initial: Partial<TicketDraftDoc>,
): string {
  const lines: string[] = [
    `# WarpDesk ticket update draft — edit optional fields, then open this file in the WarpDesk Tools ticket draft editor and use Confirm or Discard.`,
    `# Do not apply via MCP tools, CLI, or shell; humans confirm in the extension only.`,
    `schema_version: 1`,
    `workspace_slug: ${YAML.stringify(slug).replace(/\n/g, "\n  ")}`,
    `ticket_id: ${ticketId}`,
    ``,
    `# --- PATCH fields (omit a key or leave commented to leave unchanged) ---`,
  ];

  const optionalYaml = (key: string, val: unknown, comment: string) => {
    if (val !== undefined && val !== null && val !== "") {
      lines.push(`${key}: ${YAML.stringify(val).replace(/\n/g, "\n  ")}`);
    } else {
      lines.push(`# ${comment}`);
      lines.push(`# ${key}: ...`);
    }
  };

  optionalYaml("title", initial.title, "string");
  optionalYaml("description", initial.description, "string (markdown)");
  optionalYaml("type", initial.type, "bug | feature | question | chore");
  optionalYaml(
    "status",
    initial.status,
    "open | in_progress | blocked | waiting_on_client | closed",
  );
  optionalYaml("customer_score", initial.customer_score, "0–100 (developers)");
  optionalYaml(
    "customer_priority",
    initial.customer_priority,
    "low | normal | high | max (clients)",
  );
  optionalYaml("assignee_user_id", initial.assignee_user_id, "uuid or null");
  optionalYaml("code_link_url", initial.code_link_url, "url or null");
  optionalYaml("deadline", initial.deadline, "ISO date string or null");

  lines.push(``);
  lines.push(`# --- Optional comment (omit entire comment block to skip) ---`);
  if (initial.comment?.body) {
    lines.push(`comment:`);
    lines.push(`  body: |`);
    for (const line of String(initial.comment.body).split("\n")) {
      lines.push(`    ${line}`);
    }
    if (initial.comment.visibility) {
      lines.push(`  visibility: ${initial.comment.visibility}`);
    }
    if (initial.comment.parent_comment_id) {
      lines.push(`  parent_comment_id: ${initial.comment.parent_comment_id}`);
    }
  } else {
    lines.push(`# comment:`);
    lines.push(`#   body: "..."`);
    lines.push(`#   visibility: public  # or internal`);
  }

  return lines.join("\n") + "\n";
}

export function writeTicketDraft(params: {
  workspaceRoot: string;
  slug: string;
  ticketId: string;
  initial?: Partial<TicketDraftDoc>;
}): { draftRelativePath: string; absolutePath: string } {
  const { workspaceRoot, slug, ticketId } = params;
  const short = crypto.randomBytes(4).toString("hex");
  const name = `${slug}-${ticketId}-${short}.ticket_draft`;
  const dir = path.join(workspaceRoot, DRAFT_SUBDIR);
  fs.mkdirSync(dir, { recursive: true });
  const absolutePath = path.join(dir, name);
  const body = draftTemplate(slug, ticketId, params.initial ?? {});
  fs.writeFileSync(absolutePath, body, "utf8");
  const draftRelativePath = path.join(DRAFT_SUBDIR, name);
  return {
    draftRelativePath: draftRelativePath.split(path.sep).join("/"),
    absolutePath,
  };
}
