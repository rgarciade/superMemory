import { describe, expect, it } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  conflictNoteFileName,
  conflictSnapshotBranchName,
  readConflictNotes,
  renderConflictNote,
  writeConflictNote,
  type ConflictNoteData,
} from "../../src/sync/conflict-note.js";
import { conflictNoteCommitHeader } from "../../src/sync/commit-message.js";
import { AppError, ERROR_CODES } from "../../src/util/errors.js";

// Task 3.6 [RED first]: conflict-note.ts — write/read
// conflicts/<date>-<note-id>.md (frontmatter status: open, note_path,
// snapshot_branch, detected_at; body: both sides' summaries + a
// `supermemory resolve` pointer); secrets lint before its chore(conflict)
// commit (design §4.4 — the note is vault-visible in Obsidian).

const DETECTED_AT = new Date("2026-07-14T10:30:00.000Z");

function noteData(overrides: Partial<ConflictNoteData> = {}): ConflictNoteData {
  return {
    noteId: "DEC-0042",
    notePath: "decisions/DEC-0042-fts5.md",
    snapshotBranch: "conflict/20260714-1030-DEC-0042",
    detectedAt: DETECTED_AT,
    localSummary: "Local: rewrote the decision rationale for FTS5.",
    remoteSummary: "Remote: added a latency caveat paragraph.",
    ...overrides,
  };
}

describe("names (deterministic, date-keyed)", () => {
  it("derives the conflict note file name from the detection time and note id", () => {
    expect(conflictNoteFileName(DETECTED_AT, "DEC-0042")).toBe("20260714-1030-DEC-0042.md");
  });

  it("derives the snapshot branch name (design §4.4: conflict/<date>-<note-id>)", () => {
    expect(conflictSnapshotBranchName(DETECTED_AT, "DEC-0042")).toBe(
      "conflict/20260714-1030-DEC-0042",
    );
  });

  it("sanitizes path-hostile characters out of note ids", () => {
    expect(conflictNoteFileName(DETECTED_AT, "a/b\\c")).toBe("20260714-1030-a-b-c.md");
    expect(conflictSnapshotBranchName(DETECTED_AT, "a/b")).toBe("conflict/20260714-1030-a-b");
  });
});

describe("renderConflictNote", () => {
  it("renders the contract frontmatter and both sides plus the resolve pointer", () => {
    const rendered = renderConflictNote(noteData());
    expect(rendered).toMatch(/^---\n/);
    expect(rendered).toContain("status: open");
    expect(rendered).toContain("note_id: DEC-0042");
    expect(rendered).toContain("note_path: decisions/DEC-0042-fts5.md");
    expect(rendered).toContain("snapshot_branch: conflict/20260714-1030-DEC-0042");
    expect(rendered).toContain("detected_at: 2026-07-14T10:30:00.000Z");
    expect(rendered).toContain("Local: rewrote the decision rationale for FTS5.");
    expect(rendered).toContain("Remote: added a latency caveat paragraph.");
    expect(rendered).toContain("supermemory resolve");
  });
});

describe("writeConflictNote", () => {
  let dir: string;
  it("writes the note into conflicts/ and returns its path", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "supermemory-conflicts-"));
    try {
      const written = await writeConflictNote(dir, noteData());
      expect(written).toBe(path.join(dir, "20260714-1030-DEC-0042.md"));
      const files = await readdir(dir);
      expect(files).toEqual(["20260714-1030-DEC-0042.md"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("blocks a secret in either summary (SECRETS_BLOCKED) and writes nothing", async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "supermemory-conflicts-"));
    try {
      let caught: unknown;
      try {
        await writeConflictNote(dir, noteData({
          remoteSummary: "leaked AKIAIOSFODNN7EXAMPLE in the diff",
        }));
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(AppError);
      expect((caught as AppError).code).toBe(ERROR_CODES.SECRETS_BLOCKED);
      expect(await readdir(dir)).toEqual([]); // nothing written
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("readConflictNotes", () => {
  it("round-trips written notes and lists them deterministically by file name", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "supermemory-conflicts-"));
    try {
      await writeConflictNote(dir, noteData({ noteId: "DEC-0002", snapshotBranch: "conflict/20260714-1030-DEC-0002" }));
      await writeConflictNote(dir, noteData({ noteId: "DEC-0001", snapshotBranch: "conflict/20260714-1030-DEC-0001" }));

      const notes = await readConflictNotes(dir);
      expect(notes.map((n) => n.noteId)).toEqual(["DEC-0001", "DEC-0002"]);
      expect(notes[0]).toMatchObject({
        status: "open",
        noteId: "DEC-0001",
        notePath: "decisions/DEC-0042-fts5.md",
        snapshotBranch: "conflict/20260714-1030-DEC-0001",
        detectedAt: "2026-07-14T10:30:00.000Z",
        path: path.join(dir, "20260714-1030-DEC-0001.md"),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("reports resolved notes with their status, ignores non-markdown, skips malformed", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "supermemory-conflicts-"));
    try {
      await writeConflictNote(dir, noteData({ noteId: "DEC-0009", snapshotBranch: "conflict/20260714-1030-DEC-0009" }));
      // Flip it to resolved, the way `supermemory resolve` finalizes.
      const { writeFile } = await import("node:fs/promises");
      const resolvedPath = path.join(dir, "20260714-1030-DEC-0009.md");
      const raw = await import("node:fs/promises").then((fs) => fs.readFile(resolvedPath, "utf8"));
      await writeFile(resolvedPath, raw.replace("status: open", "status: resolved"), "utf8");
      // Noise that must be ignored or skipped, never fatal.
      await writeFile(path.join(dir, "notes.txt"), "not markdown", "utf8");
      await writeFile(path.join(dir, "99999999-9999-broken.md"), "no frontmatter at all", "utf8");

      const notes = await readConflictNotes(dir);
      expect(notes).toHaveLength(1);
      expect(notes[0]?.status).toBe("resolved");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("conflictNoteCommitHeader (grammar lives in commit-message.ts)", () => {
  it("renders the design §4.4 chore(conflict) header", () => {
    expect(conflictNoteCommitHeader("DEC-0042")).toBe(
      "chore(conflict): record divergent edits for DEC-0042",
    );
  });
});
