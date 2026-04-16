/**
 * Read warpdesk.config, PAT, and app origin from a client workspace (same rules as tickets-cli.mjs).
 */
import * as fs from "node:fs";
import * as path from "node:path";

export function parseEdfConfig(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    const k = t.slice(0, i).trim();
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    out[k] = v;
  }
  return out;
}

export function loadPersonalAccessToken(workspaceRoot: string): string | null {
  const patEnv = process.env.WARPDESK_PERSONAL_ACCESS_TOKEN?.trim();
  if (patEnv) {
    return patEnv;
  }
  const mcpPath = path.join(workspaceRoot, ".cursor", "mcp.json");
  if (fs.existsSync(mcpPath)) {
    try {
      const j = JSON.parse(fs.readFileSync(mcpPath, "utf8")) as {
        mcpServers?: {
          "warpdesk-tickets"?: { env?: { WARPDESK_PERSONAL_ACCESS_TOKEN?: string } };
        };
      };
      const pat = j?.mcpServers?.["warpdesk-tickets"]?.env?.WARPDESK_PERSONAL_ACCESS_TOKEN;
      if (typeof pat === "string" && pat.trim()) {
        return pat.trim();
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

export function resolveAppBaseUrl(cfg: Record<string, string>): string {
  const env = process.env.WARPDESK_BASE_URL?.trim();
  if (env) {
    return env.replace(/\/$/, "");
  }
  const origin = cfg.DEV_APP_ORIGIN?.trim();
  if (!origin) {
    throw new Error(
      "Set DEV_APP_ORIGIN in warpdesk.config or WARPDESK_BASE_URL in the environment.",
    );
  }
  return origin.replace(/\/$/, "");
}

export function loadWorkspaceConfig(workspaceRoot: string): {
  cfg: Record<string, string>;
  slug: string;
  baseUrl: string;
  token: string;
} {
  const raw = fs.readFileSync(path.join(workspaceRoot, "warpdesk.config"), "utf8");
  const cfg = parseEdfConfig(raw);
  const slug = cfg.WORKSPACE_SLUG?.trim();
  if (!slug) {
    throw new Error("warpdesk.config: WORKSPACE_SLUG is required.");
  }
  const token = loadPersonalAccessToken(workspaceRoot);
  if (!token) {
    throw new Error(
      "No personal access token: set WARPDESK_PERSONAL_ACCESS_TOKEN (wds_pat_…) in the environment or in .cursor/mcp.json under mcpServers.warpdesk-tickets.env.",
    );
  }
  const baseUrl = resolveAppBaseUrl(cfg);
  return { cfg, slug, baseUrl, token };
}
