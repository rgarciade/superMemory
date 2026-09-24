import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
import {
  createTestVault,
  VAULT_FOLDERS,
} from "./create-test-vault.js";

// Task 1.4: proves the hermetic vault factory — fixture copy, git identity,
// gpgsign off, fixed dates, seed notes, cleanup (design §1.8).
describe("createTestVault", () => {
  it("copies the fixture vault into a tmp dir with .memory intact", async () => {
    const vault = await createTestVault();
    try {
      expect(existsSync(vault.paths.rulesPath)).toBe(true);
      expect(existsSync(path.join(vault.paths.templatesDir, "decision.md"))).toBe(
        true,
      );
      expect(existsSync(vault.paths.configPath)).toBe(true);
      expect(existsSync(vault.paths.gitattributesPath)).toBe(true);
      for (const folder of VAULT_FOLDERS) {
        expect(existsSync(vault.paths.folders[folder])).toBe(true);
      }
      // never a nested .git inside the committed fixture source
      expect(vault.root).not.toContain("fixtures");
    } finally {
      await vault.cleanup();
    }
  });

  it("initializes a git repo with local identity, gpgsign off, fixed dates", async () => {
    const vault = await createTestVault();
    try {
      expect(existsSync(path.join(vault.root, ".git"))).toBe(true);
      const name = await vault.git.raw(["config", "user.name"]);
      expect(name.trim()).toBe("Test User");
      const gpgsign = await vault.git.raw(["config", "commit.gpgsign"]);
      expect(gpgsign.trim()).toBe("false");
      const log = await vault.git.log();
      expect(log.total).toBe(1);
      expect(log.latest?.author_name).toBe("Test User");
      // fixed dates make history deterministic
      expect(log.latest?.date.startsWith("2025-01-01")).toBe(true);
    } finally {
      await vault.cleanup();
    }
  });

  it("seeds optional notes and commits them", async () => {
    const vault = await createTestVault({
      seedNotes: [
        {
          path: "specs/SPEC-search-fts.md",
          content: "---\nspec_id: SPEC-search\nstatus: draft\n---\n\n# Search\n",
        },
      ],
    });
    try {
      const seeded = path.join(vault.root, "specs", "SPEC-search-fts.md");
      expect(existsSync(seeded)).toBe(true);
      const log = await vault.git.log();
      expect(log.total).toBe(1); // seeds ride the single baseline commit
      const status = await vault.git.status();
      expect(status.isClean()).toBe(true);
    } finally {
      await vault.cleanup();
    }
  });

  it("cleanup deletes the tmp tree and closes registered handles", async () => {
    const vault = await createTestVault();
    let closed = 0;
    vault.onClose(() => {
      closed += 1;
    });
    const root = vault.root;
    await vault.cleanup();
    expect(closed).toBe(1);
    expect(existsSync(root)).toBe(false);
  });

  it("write + commit round-trip keeps the tree clean", async () => {
    const vault = await createTestVault();
    try {
      await vault.write(
        "decisions/DEC-1-try-fts.md",
        "---\ndecision_id: DEC-1\n---\n\n# Try FTS\n",
      );
      await vault.commit("test: add decision");
      const status = await vault.git.status();
      expect(status.isClean()).toBe(true);
      const log = await vault.git.log();
      expect(log.total).toBe(2);
    } finally {
      await vault.cleanup();
    }
  });
});
