import { describe, expect, it, vi } from "vitest";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { buildIndex } from "../../src/index/build.js";
import { findNotes } from "../../src/index/queries.js";
import {
  createNullSyncPort,
  saveNote,
  type SyncPort,
  type WriteEvent,
} from "../../src/notes/save-pipeline.js";
import { parseRules } from "../../src/rules/parser.js";
import type { RulesModel } from "../../src/rules/types.js";
import { createTestVault, type TestVault } from "../helpers/create-test-vault.js";

// Task 2.8 [RED first]: validate -> render/merge -> pull-before-write (via
// injected SyncPort, null impl in P2) -> write -> index.upsert ->
// SyncPort.notifyWrite -> { path, id }.

async function loadRules(vaultRoot: string): Promise<RulesModel> {
  const raw = await readFile(path.join(vaultRoot, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

const FIXED_NOW = new Date("2026-01-01T00:00:00.000Z");
const fixedClock = { now: () => FIXED_NOW };

function fakeSyncPort(): SyncPort & {
  pullLatest: ReturnType<typeof vi.fn<(notePath?: string) => Promise<void>>>;
  notifyWrite: ReturnType<typeof vi.fn<(event: WriteEvent) => void>>;
} {
  return {
    pullLatest: vi.fn(async () => {}),
    notifyWrite: vi.fn(),
  };
}

const SPEC_NOTE = `---
spec_id: SPEC-search
status: draft
owner: Raul
---

# Search spec

## Purpose
Full-text search.

## Linked Knowledge

Auto-maintained index of linked notes.
`;

async function setup(): Promise<{
  vault: TestVault;
  rules: RulesModel;
  store: Awaited<ReturnType<typeof buildIndex>>;
}> {
  const vault = await createTestVault({
    seedNotes: [{ path: "specs/SPEC-search-spec.md", content: SPEC_NOTE }],
  });
  const rules = await loadRules(vault.root);
  const store = await buildIndex(vault.root, rules);
  return { vault, rules, store };
}

describe("saveNote — validation", () => {
  it("rejects a non-conforming note, naming the violated rule, and writes nothing", async () => {
    const { vault, rules, store } = await setup();
    try {
      const syncPort = fakeSyncPort();
      const result = await saveNote(
        { store, clock: fixedClock, syncPort },
        {
          vaultPath: vault.root,
          rules,
          type: "decision",
          path: "decisions/BAD-ID-slug.md",
          frontmatter: { decision_id: "not-a-valid-id", spec_id: "SPEC-search" },
          content: "# Bad decision\n",
          via: "test",
        },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.length).toBeGreaterThan(0);
        expect(result.issues.some((i) => i.field === "decision_id")).toBe(true);
      }
      await expect(
        readFile(path.join(vault.root, "decisions/BAD-ID-slug.md"), "utf8"),
      ).rejects.toThrow();
      expect(syncPort.notifyWrite).not.toHaveBeenCalled();
    } finally {
      await vault.cleanup();
    }
  });
});

describe("saveNote — create", () => {
  it("writes a new conforming note, indexes it immediately, and notifies the sync port", async () => {
    const { vault, rules, store } = await setup();
    try {
      const syncPort = fakeSyncPort();
      const result = await saveNote(
        { store, clock: fixedClock, syncPort },
        {
          vaultPath: vault.root,
          rules,
          type: "decision",
          path: "decisions/DEC-1-use-memory-index.md",
          frontmatter: { decision_id: "DEC-1", spec_id: "SPEC-search", status: "proposed" },
          content: "# Use an in-memory index\n\nBody text.\n",
          via: "test",
        },
      );

      expect(result).toEqual({ ok: true, path: "decisions/DEC-1-use-memory-index.md", id: "DEC-1" });

      const onDisk = await readFile(
        path.join(vault.root, "decisions/DEC-1-use-memory-index.md"),
        "utf8",
      );
      expect(onDisk).toContain("decision_id: DEC-1");
      expect(onDisk).toContain("Use an in-memory index");

      const found = findNotes(store, { type: "decision" });
      expect(found.map((n) => n.id)).toContain("DEC-1");

      expect(syncPort.pullLatest).not.toHaveBeenCalled(); // create: no pull-before-write
      expect(syncPort.notifyWrite).toHaveBeenCalledTimes(1);
      expect(syncPort.notifyWrite).toHaveBeenCalledWith({
        op: "add",
        type: "decision",
        id: "DEC-1",
        path: "decisions/DEC-1-use-memory-index.md",
        via: "test",
        at: FIXED_NOW,
      });
    } finally {
      await vault.cleanup();
    }
  });
});

describe("saveNote — update", () => {
  it("pulls before write and merges frontmatter, preserving fields not overwritten", async () => {
    const { vault, rules, store } = await setup();
    try {
      const syncPort = fakeSyncPort();
      const result = await saveNote(
        { store, clock: fixedClock, syncPort },
        {
          vaultPath: vault.root,
          rules,
          type: "spec",
          path: "specs/SPEC-search-spec.md",
          frontmatter: { status: "active" },
          via: "test",
        },
      );

      expect(result).toEqual({ ok: true, path: "specs/SPEC-search-spec.md", id: "SPEC-search" });
      expect(syncPort.pullLatest).toHaveBeenCalledWith("specs/SPEC-search-spec.md");

      const onDisk = await readFile(path.join(vault.root, "specs/SPEC-search-spec.md"), "utf8");
      expect(onDisk).toContain("status: active");
      expect(onDisk).toContain("owner: Raul"); // preserved, not overwritten
      expect(onDisk).toContain("Full-text search."); // body preserved (no content given)

      expect(store.byId.get("SPEC-search")?.status).toBe("active");
    } finally {
      await vault.cleanup();
    }
  });
});

describe("saveNote — Linked Knowledge maintenance", () => {
  it("appends an entry to the target spec and is idempotent on a repeated save", async () => {
    const { vault, rules, store } = await setup();
    try {
      const syncPort = fakeSyncPort();
      const input = {
        vaultPath: vault.root,
        rules,
        type: "decision" as const,
        path: "decisions/DEC-1-use-memory-index.md",
        frontmatter: { decision_id: "DEC-1", spec_id: "SPEC-search", status: "proposed" },
        content: "# Use an in-memory index\n",
        via: "test",
      };

      await saveNote({ store, clock: fixedClock, syncPort }, input);
      await saveNote({ store, clock: fixedClock, syncPort }, input);

      const specOnDisk = await readFile(
        path.join(vault.root, "specs/SPEC-search-spec.md"),
        "utf8",
      );
      const occurrences = specOnDisk.split("decisions/DEC-1-use-memory-index.md").length - 1;
      expect(occurrences).toBe(1);
      expect(store.byId.get("SPEC-search")?.body).toContain(
        "decisions/DEC-1-use-memory-index.md",
      );
    } finally {
      await vault.cleanup();
    }
  });
});

describe("saveNote — validates before touching the filesystem", () => {
  // Fresh-context review finding 8: mergeNoteContent (access + readFile)
  // ran before validateNote, so a path escaping the type's declared
  // folder was checked for existence — and read — before being rejected.
  // Proven here with a directory sitting just outside the vault: the old
  // ordering calls readFile() on it (EISDIR, an unhandled crash instead
  // of a clean validation rejection); the fix must reject on the folder
  // mismatch before ever attempting that read.
  it("rejects a path escaping the type's declared folder without crashing, even when something exists there", async () => {
    const vault = await createTestVault();
    const outsideDir = path.join(vault.root, "..", `sm-outside-${Date.now()}`);
    await mkdir(outsideDir);
    try {
      const rules = await loadRules(vault.root);
      const store = await buildIndex(vault.root, rules);

      const result = await saveNote(
        { store, clock: fixedClock, syncPort: createNullSyncPort() },
        {
          vaultPath: vault.root,
          rules,
          type: "decision",
          path: `../${path.basename(outsideDir)}`,
          frontmatter: { decision_id: "DEC-1", spec_id: "SPEC-search" },
          content: "# Escape attempt\n",
          via: "test",
        },
      );

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.issues.some((i) => i.kind === "folder")).toBe(true);
      }
    } finally {
      await rm(outsideDir, { recursive: true, force: true });
      await vault.cleanup();
    }
  });
});

describe("createNullSyncPort", () => {
  it("is a safe no-op implementation", async () => {
    const port = createNullSyncPort();
    await expect(port.pullLatest("any/path.md")).resolves.toBeUndefined();
    expect(() =>
      port.notifyWrite({
        op: "add",
        type: "spec",
        path: "specs/x.md",
        via: "test",
        at: new Date(),
      }),
    ).not.toThrow();
  });
});
