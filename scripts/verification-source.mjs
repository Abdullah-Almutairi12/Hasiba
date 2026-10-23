import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

/** A content identity remains reproducible even before the next code checkpoint. */
export function verificationSource(root) {
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
  const files = git("ls-files", "--cached", "--others", "--exclude-standard")
    .split("\n").filter((file) =>
      /^(lib|artifacts|scripts)\//.test(file) && /\.(tsx?|mjs|json|sql|toml|ya?ml)$/.test(file) ||
      /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig[^/]*\.json|\.replit)$/.test(file),
    );
  const hash = createHash("sha256");
  for (const file of [...new Set(files)].sort()) {
    hash.update(file).update("\0").update(readFileSync(`${root}/${file}`)).update("\0");
  }
  return {
    commit: git("rev-parse", "HEAD"), sourceSha256: hash.digest("hex"),
    dirty: git("status", "--porcelain") !== "", node: process.version,
    definition: "Sorted tracked/untracked nonignored source/config paths plus bytes; excludes generated outputs and reports",
  };
}
