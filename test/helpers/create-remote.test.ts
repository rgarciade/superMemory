import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  createClone,
  createDivergentClones,
  createRemote,
  isBareRepo,
} from "./create-remote.js";

// Task 1.5: bare remote + local-path clones + divergence helper —
// the hermetic stand-in for GitHub (design §1.8).
describe("createRemote", () => {
  it("creates a bare repo that clones can push to", async () => {
    const remote = await createRemote();
    try {
      expect(await isBareRepo(remote.url)).toBe(true);
      const clone = await createClone(remote.url);
      try {
        await clone.write("notes/a.md", "# A\n");
        await clone.commit("test: a");
        await clone.git.push("origin", "main");
        const log = await clone.git.log();
        expect(log.total).toBe(1);
      } finally {
        await clone.cleanup();
      }
    } finally {
      await remote.cleanup();
    }
  });

  it("clones carry local identity and gpgsign off", async () => {
    const remote = await createRemote();
    try {
      const clone = await createClone(remote.url);
      try {
        expect((await clone.git.raw(["config", "user.name"])).trim()).toBe(
          "Test User",
        );
        expect(
          (await clone.git.raw(["config", "commit.gpgsign"])).trim(),
        ).toBe("false");
      } finally {
        await clone.cleanup();
      }
    } finally {
      await remote.cleanup();
    }
  });
});

describe("createDivergentClones", () => {
  it("leaves local and remote ahead on the same note region", async () => {
    const d = await createDivergentClones({
      notePath: "specs/SPEC-search.md",
      baseContent: "---\nspec_id: SPEC-search\n---\n\n# base\n",
      localContent: "---\nspec_id: SPEC-search\n---\n\n# local edit\n",
      remoteContent: "---\nspec_id: SPEC-search\n---\n\n# remote edit\n",
    });
    try {
      const localAhead = await d.local.git.raw([
        "rev-list",
        "--count",
        "origin/main..main",
      ]);
      const remoteAhead = await d.local.git.raw([
        "rev-list",
        "--count",
        "main..origin/main",
      ]);
      expect(localAhead.trim()).toBe("1");
      expect(remoteAhead.trim()).toBe("1");

      // same note, different content on each side
      const localNote = await readFile(
        path.join(d.local.root, "specs/SPEC-search.md"),
        "utf8",
      );
      const remoteNote = await readFile(
        path.join(d.remote.root, "specs/SPEC-search.md"),
        "utf8",
      );
      expect(localNote).toContain("# local edit");
      expect(remoteNote).toContain("# remote edit");
    } finally {
      await d.cleanup();
    }
  });
});
