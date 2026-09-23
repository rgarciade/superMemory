import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  deriveCommitMessage,
  formatCommitMessage,
  parseNoteCommitHeader,
} from "../../src/sync/commit-message.js";
import { parseRules } from "../../src/rules/parser.js";
import type { RulesModel } from "../../src/rules/types.js";
import { FIXTURE_VAULT_DIR } from "../helpers/create-test-vault.js";

// Task 3.2 [RED first]: commit-message.ts — the pure commit grammar
// (design §4.3): note(<op>): <type> "<title>" [<id>] + meaningful-change
// suffix + Author:/Via:/Spec: trailers, byte-identical on repeat
// derivation. Also absorbs 2.14's header parser so derivation and
// classification share one grammar (spec scenario: exact header bytes).

async function loadRules(): Promise<RulesModel> {
  const raw = await readFile(path.join(FIXTURE_VAULT_DIR, ".memory", "rules.md"), "utf8");
  return parseRules(raw);
}

const DECISION_FM = {
  decision_id: "DEC-0042",
  spec_id: "SPEC-search",
  status: "accepted",
};

describe("deriveCommitMessage — header grammar", () => {
  it("derives the spec's exact addition header", async () => {
    const rules = await loadRules();
    const message = deriveCommitMessage({
      op: "add",
      type: "decision",
      frontmatter: DECISION_FM,
      body: "# FTS5 instead of embeddings for search\n\nbody",
      fileName: "DEC-0042-fts5-instead-of-embeddings.md",
      noteTypeDef: rules.noteTypes["decision"],
    });
    expect(message.header).toBe('note(add): decision "FTS5 instead of embeddings for search" [DEC-0042]');
  });

  it("resolves the title by priority: # heading > title frontmatter > filename slug", async () => {
    const rules = await loadRules();
    const base = {
      op: "update" as const,
      type: "spec",
      frontmatter: { spec_id: "SPEC-a", status: "active", title: "Frontmatter Title" },
      fileName: "SPEC-a-some-file.md",
      noteTypeDef: rules.noteTypes["spec"],
    };
    expect(deriveCommitMessage({ ...base, body: "# Heading Wins\n" }).header).toContain('"Heading Wins"');
    expect(deriveCommitMessage({ ...base, body: "no heading\n" }).header).toContain('"Frontmatter Title"');
    expect(
      deriveCommitMessage({
        ...base,
        frontmatter: { spec_id: "SPEC-a", status: "active" },
        body: "no heading\n",
      }).header,
    ).toContain('"SPEC A Some File"');
  });

  it("omits the [<id>] segment when the type has no id (session logs)", async () => {
    const rules = await loadRules();
    const message = deriveCommitMessage({
      op: "add",
      type: "session_log",
      frontmatter: { date: "2026-07-14", actor: "agent" },
      body: "# Session 2026-07-14\n\n- entry",
      fileName: "2026-07-14.md",
      noteTypeDef: rules.noteTypes["session_log"],
    });
    expect(message.header).toBe('note(add): session_log "Session 2026-07-14"');
    expect(message.header).not.toContain("[");
  });

  it("uses the type's explicit id_field when declared", async () => {
    const rules = await loadRules();
    const message = deriveCommitMessage({
      op: "add",
      type: "spec",
      frontmatter: { spec_id: "SPEC-a", status: "draft" },
      body: "# A",
      fileName: "SPEC-a.md",
      noteTypeDef: rules.noteTypes["spec"],
    });
    expect(message.header).toBe('note(add): spec "A" [SPEC-a]');
  });
});

describe("deriveCommitMessage — meaningful-change suffix", () => {
  const rulesInput = async () => {
    const rules = await loadRules();
    return {
      type: "spec",
      frontmatter: { spec_id: "SPEC-a", status: "active" },
      prevFrontmatter: { spec_id: "SPEC-a", status: "draft" },
      body: "# A",
      fileName: "SPEC-a.md",
      noteTypeDef: rules.noteTypes["spec"],
    };
  };

  it("appends (status: draft→active) when the status transitions", async () => {
    const message = deriveCommitMessage({ op: "update", ...(await rulesInput()) });
    expect(message.header).toBe('note(update): spec "A" [SPEC-a] (status: draft→active)');
  });

  it("produces no suffix on a body-only edit (no prev status change)", async () => {
    const input = await rulesInput();
    const message = deriveCommitMessage({
      op: "update",
      ...input,
      prevFrontmatter: input.prevFrontmatter,
      frontmatter: { ...input.frontmatter, status: "draft" },
    });
    expect(message.header).toBe('note(update): spec "A" [SPEC-a]');
  });

  it("produces no suffix when prevFrontmatter is absent", async () => {
    const { prevFrontmatter: _prev, ...input } = await rulesInput();
    expect(deriveCommitMessage({ op: "update", ...input }).header).not.toContain("status:");
  });
});

describe("deriveCommitMessage — delete derives from the HEAD version", () => {
  it("uses the caller-supplied HEAD frontmatter/body (git show HEAD:<path> is the caller's job)", async () => {
    const rules = await loadRules();
    const message = deriveCommitMessage({
      op: "delete",
      type: "decision",
      frontmatter: DECISION_FM,
      body: "# FTS5 instead of embeddings for search",
      fileName: "DEC-0042.md",
      noteTypeDef: rules.noteTypes["decision"],
    });
    expect(message.header).toBe('note(delete): decision "FTS5 instead of embeddings for search" [DEC-0042]');
  });
});

describe("deriveCommitMessage — trailers (interpret-trailers format)", () => {
  it("derives Author/Via from provenance inputs and Spec from frontmatter spec_id", async () => {
    const rules = await loadRules();
    const message = deriveCommitMessage({
      op: "add",
      type: "decision",
      frontmatter: DECISION_FM,
      body: "# D",
      fileName: "DEC-0042.md",
      noteTypeDef: rules.noteTypes["decision"],
      author: "Jane Doe",
      via: "claude-code",
    });
    expect(message.trailers).toEqual({
      Author: "Jane Doe",
      Via: "claude-code",
      Spec: "SPEC-search",
    });
    expect(formatCommitMessage(message)).toBe(
      [
        'note(add): decision "D" [DEC-0042]',
        "",
        "Author: Jane Doe",
        "Via: claude-code",
        "Spec: SPEC-search",
      ].join("\n"),
    );
  });

  it("omits trailers that have no value, in deterministic order", async () => {
    const rules = await loadRules();
    const message = deriveCommitMessage({
      op: "add",
      type: "session_log",
      frontmatter: { date: "2026-07-14", actor: "agent" },
      body: "# S",
      fileName: "2026-07-14.md",
      noteTypeDef: rules.noteTypes["session_log"],
      via: "cli",
    });
    expect(message.trailers).toEqual({ Via: "cli" });
    expect(formatCommitMessage(message)).toBe('note(add): session_log "S"\n\nVia: cli');
  });
});

describe("deriveCommitMessage — determinism (byte-identical)", () => {
  it("derives the identical full message twice from the same inputs", async () => {
    const rules = await loadRules();
    const input = {
      op: "update" as const,
      type: "decision",
      frontmatter: { ...DECISION_FM, status: "superseded" },
      prevFrontmatter: DECISION_FM,
      body: "# D",
      fileName: "DEC-0042.md",
      noteTypeDef: rules.noteTypes["decision"],
      author: "Jane Doe",
      via: "mcp:cursor",
    };
    const first = formatCommitMessage(deriveCommitMessage(input));
    const second = formatCommitMessage(deriveCommitMessage(input));
    expect(first).toBe(second);
    expect(first).toBe('note(update): decision "D" [DEC-0042] (status: accepted→superseded)\n\nAuthor: Jane Doe\nVia: mcp:cursor\nSpec: SPEC-search');
  });
});

describe("parseNoteCommitHeader — the absorbed grammar parser (was 2.14's local parser)", () => {
  it("parses an add header with an id", () => {
    const parsed = parseNoteCommitHeader('note(add): decision "Use an in-memory index" [DEC-1]');
    expect(parsed).toEqual({
      op: "add",
      type: "decision",
      title: "Use an in-memory index",
      id: "DEC-1",
      statusChanged: false,
    });
  });

  it("parses an update header with a status-change suffix", () => {
    const parsed = parseNoteCommitHeader(
      'note(update): decision "Use an in-memory index" [DEC-1] (status: proposed→accepted)',
    );
    expect(parsed?.op).toBe("update");
    expect(parsed?.statusChanged).toBe(true);
    expect(parsed?.statusTransition).toEqual({ from: "proposed", to: "accepted" });
  });

  it("parses a header with no id (e.g. a session log)", () => {
    const parsed = parseNoteCommitHeader('note(add): session_log "Session 2026-01-01"');
    expect(parsed?.id).toBeUndefined();
    expect(parsed?.type).toBe("session_log");
  });

  it("returns undefined for non-grammar headers", () => {
    expect(parseNoteCommitHeader("chore(index): regenerate maps (12 notes)")).toBeUndefined();
    expect(parseNoteCommitHeader("Merge branch 'x'")).toBeUndefined();
    expect(parseNoteCommitHeader("random commit text")).toBeUndefined();
  });
});

describe("derivation and classification share one grammar (round-trip)", () => {
  it("every derived header parses back to the same op/type/title/id", async () => {
    const rules = await loadRules();
    for (const [op, frontmatter, prev] of [
      ["add", DECISION_FM, undefined],
      ["update", { ...DECISION_FM, status: "superseded" }, DECISION_FM],
      ["delete", DECISION_FM, undefined],
    ] as const) {
      const message = deriveCommitMessage({
        op,
        type: "decision",
        frontmatter,
        ...(prev === undefined ? {} : { prevFrontmatter: prev }),
        body: "# Round Trip",
        fileName: "DEC-0042.md",
        noteTypeDef: rules.noteTypes["decision"],
      });
      const parsed = parseNoteCommitHeader(message.header);
      expect(parsed, message.header).toBeDefined();
      expect(parsed?.op).toBe(op);
      expect(parsed?.type).toBe("decision");
      expect(parsed?.title).toBe("Round Trip");
      expect(parsed?.id).toBe("DEC-0042");
    }
  });

  it("a derived status suffix sets statusChanged and round-trips the transition", async () => {
    const rules = await loadRules();
    const message = deriveCommitMessage({
      op: "update",
      type: "spec",
      frontmatter: { spec_id: "SPEC-a", status: "active" },
      prevFrontmatter: { spec_id: "SPEC-a", status: "draft" },
      body: "# A",
      fileName: "SPEC-a.md",
      noteTypeDef: rules.noteTypes["spec"],
    });
    const parsed = parseNoteCommitHeader(message.header);
    expect(parsed?.statusChanged).toBe(true);
    expect(parsed?.statusTransition).toEqual({ from: "draft", to: "active" });
  });
});
