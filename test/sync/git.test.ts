import { describe, expect, it, vi } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { simpleGit, type SimpleGit } from "simple-git";
import { createGitClient } from "../../src/sync/git.js";
import { createTestVault } from "../helpers/create-test-vault.js";
import {
  createClone,
  createDivergentClones,
  createRemote,
} from "../helpers/create-remote.js";

// Task 3.3 [RED first]: git.ts — typed thin simple-git wrapper exposing
// exactly the operations the sync engine needs (design §4.1): status,
// add, commit with human author + trailers, pull --rebase --autostash,
// push (no force surface), show, branch, rebase abort/continue.

const AUTHOR = { name: "Jane Doe", email: "jane@example.com" };

describe("createGitClient — status", () => {
  it("reports clean on a fresh vault", async () => {
    const vault = await createTestVault();
    try {
      const git = createGitClient(vault.root);
      const status = await git.status();
      expect(status.clean).toBe(true);
      expect(status.staged).toEqual([]);
      expect(status.changed).toEqual([]);
      expect(status.untracked).toEqual([]);
      expect(status.conflicted).toEqual([]);
    } finally {
      await vault.cleanup();
    }
  });

  it("reports untracked, changed, and staged files distinctly", async () => {
    const vault = await createTestVault();
    try {
      await vault.write("logs/new-note.md", "# New");
      const rulesPath = path.join(".memory", "rules.md");
      const original = await readFile(path.join(vault.root, rulesPath), "utf8");
      await vault.write(rulesPath, `${original}\n<!-- touched -->`);

      const git = createGitClient(vault.root);
      expect((await git.status()).untracked).toEqual(["logs/new-note.md"]);
      expect((await git.status()).changed).toEqual([rulesPath]);

      await git.add([rulesPath]);
      const staged = await git.status();
      expect(staged.staged).toEqual([rulesPath]);
      expect(staged.clean).toBe(false);
    } finally {
      await vault.cleanup();
    }
  });
});

describe("createGitClient — commit with human author + trailers", () => {
  it("sets the git author to the human identity, not the machine's", async () => {
    const vault = await createTestVault();
    try {
      const git = createGitClient(vault.root);
      await vault.write("decisions/DEC-9001-t.md", "# T");
      await git.add(["decisions/DEC-9001-t.md"]);
      const sha = await git.commit({
        message: 'note(add): decision "T" [DEC-9001]\n\nAuthor: Jane Doe\nVia: cli',
        author: AUTHOR,
      });
      expect(sha).toMatch(/^[0-9a-f]{7,40}$/);

      expect((await vault.git.raw(["log", "-1", "--format=%an"])).trim()).toBe("Jane Doe");
      expect((await vault.git.raw(["log", "-1", "--format=%ae"])).trim()).toBe("jane@example.com");

      // Trailers survive as a final paragraph (git interpret-trailers format).
      const full = await vault.git.raw(["log", "-1", "--format=%B"]);
      expect(full.trim()).toBe(
        'note(add): decision "T" [DEC-9001]\n\nAuthor: Jane Doe\nVia: cli',
      );
      const trailers = await vault.git.raw([
        "log",
        "-1",
        "--format=%(trailers:key=Author,valueonly)",
      ]);
      expect(trailers.trim()).toBe("Jane Doe");
    } finally {
      await vault.cleanup();
    }
  });

  it("commits without an explicit author using the repo identity (thin passthrough)", async () => {
    const vault = await createTestVault();
    try {
      const git = createGitClient(vault.root);
      await vault.write("facts/F-1.md", "# F");
      await git.add(["facts/F-1.md"]);
      await git.commit({ message: "test: no explicit author" });
      expect((await vault.git.raw(["log", "-1", "--format=%an"])).trim()).toBe("Test User");
    } finally {
      await vault.cleanup();
    }
  });
});

describe("createGitClient — pull --rebase --autostash", () => {
  it("rebases onto the remote and restores uncommitted local work via autostash", async () => {
    // Different-region edits: the rebase itself is clean, so the only
    // thing autostash has to protect is the uncommitted local file.
    const clones = await createDivergentClones({
      notePath: "specs/SPEC-autostash.md",
      baseContent: "---\nspec_id: SPEC-autostash\nstatus: draft\n---\n\n# Base\n\nLine two.\n",
      localContent: "---\nspec_id: SPEC-autostash\nstatus: draft\n---\n\n# Local edit\n\nLine two.\n",
      remoteContent: "---\nspec_id: SPEC-autostash\nstatus: draft\n---\n\n# Base\n\nRemote line two.\n",
    });
    try {
      await clones.local.write("specs/SPEC-dirty.md", "---\nspec_id: SPEC-dirty\nstatus: draft\n---\n\n# Dirty\n");

      const git = createGitClient(clones.local.root);
      await git.pullRebaseAutostash();
      // Autostash effects (git's transient output text is version-dependent):
      // the remote content landed AND the uncommitted file survived.

      const pulled = await readFile(
        path.join(clones.local.root, "specs", "SPEC-autostash.md"),
        "utf8",
      );
      expect(pulled).toContain("Remote line two.");
      const dirty = await readFile(path.join(clones.local.root, "specs", "SPEC-dirty.md"), "utf8");
      expect(dirty).toContain("# Dirty");
      // The local commit was replayed on top of the remote one.
      const count = await clones.local.git.raw(["rev-list", "--count", "origin/main..HEAD"]);
      expect(count.trim()).toBe("1");
    } finally {
      await clones.cleanup();
    }
  });

  it("passes an explicit remote and branch through to pull", async () => {
    const raw = vi.fn().mockResolvedValue("");
    const fake = { raw } as unknown as SimpleGit;
    const git = createGitClient("/tmp/unused", () => fake);
    await git.pullRebaseAutostash("origin", "main");
    expect(raw).toHaveBeenCalledWith(["pull", "--rebase", "--autostash", "origin", "main"]);
  });
});

describe("createGitClient — push", () => {
  it("pushes commits to the remote", async () => {
    const remoteRepo = await createRemote();
    const clone = await createClone(remoteRepo.url);
    try {
      await clone.write("facts/F-2.md", "# F2");
      await clone.commit("test: push me");

      const git = createGitClient(clone.root);
      await git.push();

      const remoteHead = await simpleGit(remoteRepo.url).raw(["rev-parse", "main"]);
      const localHead = await clone.git.raw(["rev-parse", "HEAD"]);
      expect(remoteHead.trim()).toBe(localHead.trim());
    } finally {
      await clone.cleanup();
      await remoteRepo.cleanup();
    }
  });
});

describe("createGitClient — no force API, exact plumbing", () => {
  it("issues pull with --rebase --autostash and never a force flag", async () => {
    const raw = vi.fn().mockResolvedValue("");
    const fake = { raw } as unknown as SimpleGit;
    const git = createGitClient("/tmp/unused", () => fake);

    await git.pullRebaseAutostash();
    expect(raw).toHaveBeenCalledWith(["pull", "--rebase", "--autostash"]);

    await git.push("origin", "main");
    expect(raw).toHaveBeenCalledWith(["push", "origin", "main"]);

    await git.push();
    expect(raw).toHaveBeenCalledWith(["push", "origin"]);

    for (const call of raw.mock.calls) {
      const args = call[0] as string[];
      expect(args.some((a) => a.includes("force"))).toBe(false);
    }
  });
});

describe("createGitClient — show / branch / rebase abort–continue", () => {
  it("showFile returns the HEAD version of a path (deletion derivation input)", async () => {
    const vault = await createTestVault();
    try {
      await vault.write("decisions/DEC-42-show.md", "---\ndecision_id: DEC-42\n---\n\n# Show me");
      await vault.commit("test: seed show target");
      const git = createGitClient(vault.root);
      const head = await git.showFile("HEAD", "decisions/DEC-42-show.md");
      expect(head).toContain("decision_id: DEC-42");

      await vault.write("decisions/DEC-42-show.md", "# changed");
      expect(await git.showFile("HEAD", "decisions/DEC-42-show.md")).toContain("decision_id: DEC-42");
    } finally {
      await vault.cleanup();
    }
  });

  it("createBranch snapshots a ref; rebaseAbort restores pre-rebase state", async () => {
    // Same-region edits: the rebase must conflict (the curated-ladder shape).
    const clones = await createDivergentClones({
      notePath: "specs/SPEC-ladder.md",
      baseContent: "---\nspec_id: SPEC-ladder\nstatus: draft\n---\n\n# Base\n\nSame paragraph.\n",
      localContent: "---\nspec_id: SPEC-ladder\nstatus: draft\n---\n\n# Base\n\nLocal paragraph.\n",
      remoteContent: "---\nspec_id: SPEC-ladder\nstatus: draft\n---\n\n# Base\n\nRemote paragraph.\n",
    });
    try {
      const git = createGitClient(clones.local.root);
      const preAbortHead = (await clones.local.git.raw(["rev-parse", "HEAD"])).trim();

      // Snapshot the incoming (remote) side for the ladder's curated path.
      await git.createBranch("conflict/20260714-1030-SPEC-ladder", "origin/main");
      const snapshot = await git.showFile(
        "conflict/20260714-1030-SPEC-ladder",
        "specs/SPEC-ladder.md",
      );
      expect(snapshot).toContain("Remote paragraph.");

      // The pull-rebase conflicts (same region, divergent edits).
      await expect(git.pullRebaseAutostash()).rejects.toThrow();
      let status = await git.status();
      expect(status.conflicted).toContain("specs/SPEC-ladder.md");

      // Abort: local state intact — HEAD is where it was, no conflicts.
      await git.rebaseAbort();
      status = await git.status();
      expect(status.conflicted).toEqual([]);
      expect(status.changed).toEqual([]);
      const postAbortHead = (await clones.local.git.raw(["rev-parse", "HEAD"])).trim();
      expect(postAbortHead).toBe(preAbortHead);
      const local = await readFile(
        path.join(clones.local.root, "specs", "SPEC-ladder.md"),
        "utf8",
      );
      expect(local).toContain("Local paragraph.");
    } finally {
      await clones.cleanup();
    }
  });

  it("rebaseContinue finishes the rebase once conflicts are resolved and staged", async () => {
    const clones = await createDivergentClones({
      notePath: "specs/SPEC-continue.md",
      baseContent: "# Base\n\nCommon line.\n",
      localContent: "# Base\n\nLocal line.\n",
      remoteContent: "# Base\n\nRemote line.\n",
    });
    try {
      const git = createGitClient(clones.local.root);

      await expect(git.pullRebaseAutostash()).rejects.toThrow();
      expect((await git.status()).conflicted).toContain("specs/SPEC-continue.md");

      await clones.local.write("specs/SPEC-continue.md", "# Base\n\nMerged line.\n");
      await git.add(["specs/SPEC-continue.md"]);
      await git.rebaseContinue();

      const status = await git.status();
      expect(status.conflicted).toEqual([]);
      expect(status.clean).toBe(true);
      const merged = await readFile(path.join(clones.local.root, "specs", "SPEC-continue.md"), "utf8");
      expect(merged).toContain("Merged line.");
      // Rebased: local commit replayed on top of the remote one.
      const count = await clones.local.git.raw(["rev-list", "--count", "origin/main..HEAD"]);
      expect(count.trim()).toBe("1");
    } finally {
      await clones.cleanup();
    }
  });
});
