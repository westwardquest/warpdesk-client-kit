import * as fs from "node:fs";
import * as path from "node:path";

/**
 * Walk up from startDir until a directory containing warpdesk.config is found.
 * @param {string} [start]
 * @returns {string | null}
 */
export function findWorkspaceRoot(start = process.cwd()) {
  let dir = path.resolve(start);
  for (;;) {
    if (fs.existsSync(path.join(dir, "warpdesk.config"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}
