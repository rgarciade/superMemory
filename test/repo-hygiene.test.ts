import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Second remediation batch, N6 [RED first]: a few tests deliberately
// create `tmp-sm-*` directories directly under the app repo root (the
// check-4 "vault inside the app repo" fixtures in
// test/boot/validate-boot.test.ts and test/cli/commands/init.test.ts —
// they must, by design, prove the guard rejects a path that is
// genuinely inside this repo). Each of those tests cleans up after
// itself via `finally`, but the pattern must also be gitignored so an
// interrupted test run (or a crash mid-test) never leaves an untracked
// directory show up in `git status`.

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));

async function isIgnored(relPath: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["check-ignore", "--quiet", relPath], {
      cwd: repoRoot,
    });
    return true;
  } catch {
    return false;
  }
}

describe("repo hygiene — tmp-sm-* fixtures created inside the app repo root", () => {
  it("a tmp-sm-* directory created at the repo root is gitignored", async () => {
    const dir = await mkdtemp(path.join(repoRoot, "tmp-sm-hygiene-test-"));
    const relName = path.relative(repoRoot, dir);
    try {
      expect(await isIgnored(relName)).toBe(true);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
