import { describe, expect, it } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { completeVaultPath } from "../../../src/cli/commands/setup-completion.js";

// Tab directory-completion for the setup wizard's vault-path prompt
// (post-gate UX addition on top of add-project-config). The PURE helper
// is the tested unit: `completeVaultPath(fragment, cwd, homeDir)` —
// split the fragment at the last "/" into (dirPart, prefix), resolve
// dirPart against the injected cwd (or the injected homeDir when it
// starts with "~"), and list DIRECTORIES matching the prefix
// (case-insensitive; dotfiles only when the prefix starts with ".").
// Real tmp dirs via mkdtemp — no chdir, no HOME writes (seam rule).
// A unique match drills deeper (trailing "/"); multiple matches render
// rows (capped at 8) and extend the fragment to the longest common
// prefix; zero matches yield an empty result. Ambient reads live only
// in the console prompt edge, never here.

/** A fresh empty tmp directory, removed by the returned disposer. */
async function makeTmpDir(prefix: string): Promise<{ dir: string; cleanup: () => Promise<void> }> {
  const dir = await mkdtemp(path.join(tmpdir(), `${prefix}-`));
  return { dir, cleanup: () => rm(dir, { recursive: true, force: true }) };
}

/** A subdirectory (never a file) inside `base`. */
async function makeDir(base: string, name: string): Promise<void> {
  await mkdir(path.join(base, name), { recursive: true });
}

describe("completeVaultPath", () => {
  it("no-slash fragment completes against the injected cwd", async () => {
    const { dir, cleanup } = await makeTmpDir("vault-cwd");
    try {
      await makeDir(dir, "docs");
      expect(completeVaultPath("do", dir, "/anywhere/home")).toEqual({
        completion: "docs/",
        rows: [],
      });
    } finally {
      await cleanup();
    }
  });

  it("fragment ending in '/' lists all subdirectories as rows", async () => {
    const { dir, cleanup } = await makeTmpDir("vault-trail");
    try {
      await makeDir(path.join(dir, "src"), "alpha");
      await makeDir(path.join(dir, "src"), "beta");
      // dirPart "src/" resolves against cwd; prefix "" matches every
      // subdirectory; the common prefix adds nothing to the fragment.
      expect(completeVaultPath("src/", dir, "/anywhere/home")).toEqual({
        rows: ["alpha", "beta"],
      });
    } finally {
      await cleanup();
    }
  });

  it("unique match drills deeper with a trailing slash", async () => {
    const { dir, cleanup } = await makeTmpDir("vault-unique");
    try {
      await makeDir(dir, "util");
      await makeDir(dir, "other");
      expect(completeVaultPath("ut", dir, "/anywhere/home")).toEqual({
        completion: "util/",
        rows: [],
      });
      // The trailing slash from the previous completion makes the next
      // Tab list util's contents (drill-down), not re-match siblings.
      // deep+deeper share the common prefix "deep", so the fragment
      // extends there while the ambiguity renders.
      await makeDir(path.join(dir, "util"), "deep");
      await makeDir(path.join(dir, "util"), "deeper");
      expect(completeVaultPath("util/", dir, "/anywhere/home")).toEqual({
        completion: "util/deep",
        rows: ["deep", "deeper"],
      });
    } finally {
      await cleanup();
    }
  });

  it("multiple matches render rows and extend to the common prefix", async () => {
    const { dir, cleanup } = await makeTmpDir("vault-multi");
    try {
      await makeDir(dir, "util");
      await makeDir(dir, "utils");
      await makeDir(dir, "utilitarian");
      // Common prefix of all three is "util" — longer than the typed
      // "u" — so the fragment extends there; rows stay ambiguous.
      expect(completeVaultPath("u", dir, "/anywhere/home")).toEqual({
        completion: "util",
        rows: ["util", "utilitarian", "utils"],
      });
    } finally {
      await cleanup();
    }
  });

  it("multiple matches with no common extension leave the fragment alone", async () => {
    const { dir, cleanup } = await makeTmpDir("vault-ambig");
    try {
      await makeDir(dir, "alpha");
      await makeDir(dir, "beta");
      expect(completeVaultPath("", dir, "/anywhere/home")).toEqual({
        rows: ["alpha", "beta"],
      });
    } finally {
      await cleanup();
    }
  });

  it("zero matches yield an empty result", async () => {
    const { dir, cleanup } = await makeTmpDir("vault-zero");
    try {
      await makeDir(dir, "docs");
      expect(completeVaultPath("zz", dir, "/anywhere/home")).toEqual({
        rows: [],
      });
      // A fragment whose dirPart does not exist is equally empty.
      expect(completeVaultPath("nope/zz", dir, "/anywhere/home")).toEqual({
        rows: [],
      });
    } finally {
      await cleanup();
    }
  });

  it("tilde fragments resolve against the injected homeDir", async () => {
    const { dir: home, cleanup } = await makeTmpDir("vault-home");
    try {
      await makeDir(home, "Documents");
      // dirPart "~/" resolves to the INJECTED home; the completion keeps
      // the typed "~/" form and uses the entry's real casing.
      expect(completeVaultPath("~/do", "/anywhere/cwd", home)).toEqual({
        completion: "~/Documents/",
        rows: [],
      });
    } finally {
      await cleanup();
    }
  });

  it("dotfiles are excluded unless the prefix starts with '.'", async () => {
    const { dir, cleanup } = await makeTmpDir("vault-dot");
    try {
      await makeDir(dir, ".hidden");
      await makeDir(dir, "visible");
      // "visible" is the only non-dotfile match ⇒ unique ⇒ drills deeper;
      // ".hidden" stays invisible to a non-dot prefix.
      expect(completeVaultPath("", dir, "/anywhere/home")).toEqual({
        completion: "visible/",
        rows: [],
      });
      // A dot prefix opts into dotfile matches (unique ⇒ drills deeper).
      expect(completeVaultPath(".", dir, "/anywhere/home")).toEqual({
        completion: ".hidden/",
        rows: [],
      });
    } finally {
      await cleanup();
    }
  });

  it("non-directory entries are ignored", async () => {
    const { dir, cleanup } = await makeTmpDir("vault-files");
    try {
      await writeFile(path.join(dir, "notes.md"), "text", "utf8");
      await makeDir(dir, "notes-archive");
      // "notes.md" (a file) matches the prefix but is NOT a directory:
      // the unique directory match drills deeper instead of stalling
      // on a file-vs-dir ambiguity.
      expect(completeVaultPath("notes", dir, "/anywhere/home")).toEqual({
        completion: "notes-archive/",
        rows: [],
      });
    } finally {
      await cleanup();
    }
  });

  it("rows cap at 8 even with more matches", async () => {
    const { dir, cleanup } = await makeTmpDir("vault-cap");
    try {
      for (const name of ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8", "c9", "ca"]) {
        await makeDir(dir, name);
      }
      // 10 matches, common prefix "c" not longer than the typed "c":
      // no extension, and only the first 8 sorted rows render.
      expect(completeVaultPath("c", dir, "/anywhere/home")).toEqual({
        rows: ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"],
      });
    } finally {
      await cleanup();
    }
  });

  it("matching is case-insensitive; completion uses the real casing", async () => {
    const { dir, cleanup } = await makeTmpDir("vault-case");
    try {
      await makeDir(dir, "Docs");
      expect(completeVaultPath("do", dir, "/anywhere/home")).toEqual({
        completion: "Docs/",
        rows: [],
      });
    } finally {
      await cleanup();
    }
  });
});
