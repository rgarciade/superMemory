import { describe, expect, it } from "vitest";
import {
  SECRET_PATTERNS_V1,
  assertNoSecrets,
  findSecrets,
} from "../../src/sync/secrets.js";
import { AppError, ERROR_CODES } from "../../src/util/errors.js";

// Task 3.1 [RED first]: secrets.ts — pure v1 pattern set, high-precision
// only, no entropy heuristics; blocked content raises SECRETS_BLOCKED
// (sync-ladder spec: "Secrets lint before every commit").

const AWS_KEY = "AKIAIOSFODNN7EXAMPLE"; // canonical AWS docs example
const GITHUB_CLASSIC = `ghp_${"a1B2c3D4e5".repeat(3)}f6G7`; // ghp_ + 36
const GITHUB_FINE = `github_pat_${"A1b2C3d4E5".repeat(4)}F6`;
const GITLAB_PAT = `glpat-${"x9Y8z7W6v5".repeat(2)}U4`;
const SLACK_BOT = `xoxb-${"123456789012-1234567890123-AbCdEfGhIjKlMnOp"}`; // concatenated: keeps GitHub push protection off this literal
const SLACK_APP = `xoxa-${"223456789012-AbCdEfGhIjKlMnOp"}`; // concatenated: same
const GOOGLE_KEY = `AIza${"SyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q".slice(0, 35)}`; // AIza + exactly 35
const OPENAI_KEY = `sk-proj-${"a1B2c3D4e5".repeat(4)}`;

describe("SECRET_PATTERNS_V1 (module-level constant)", () => {
  it("is a frozen, stable pattern set — extendable but never rebuilt per call", () => {
    expect(Object.isFrozen(SECRET_PATTERNS_V1)).toBe(true);
    expect(SECRET_PATTERNS_V1.map((p) => p.id)).toEqual([
      "aws-access-key-id",
      "github-token",
      "github-fine-grained-token",
      "gitlab-pat",
      "slack-token",
      "google-api-key",
      "private-key-block",
      "openai-api-key",
    ]);
  });
});

describe("findSecrets — each v1 pattern flags its token", () => {
  const cases: Array<[string, string, string]> = [
    ["aws-access-key-id", "deploy key: AKIAIOSFODNN7EXAMPLE leaked", AWS_KEY],
    ["github-token", `token: ${GITHUB_CLASSIC} in a note`, GITHUB_CLASSIC],
    ["github-fine-grained-token", `token: ${GITHUB_FINE}`, GITHUB_FINE],
    ["gitlab-pat", `ci token ${GITLAB_PAT}`, GITLAB_PAT],
    ["slack-token", `bot ${SLACK_BOT}`, SLACK_BOT],
    ["slack-token", `app ${SLACK_APP}`, SLACK_APP],
    ["google-api-key", `key = "${GOOGLE_KEY}"`, GOOGLE_KEY],
    ["openai-api-key", `export OPENAI=${OPENAI_KEY}`, OPENAI_KEY],
  ];

  for (const [id, content, match] of cases) {
    it(`flags ${id}`, () => {
      const findings = findSecrets(content);
      expect(findings).toHaveLength(1);
      expect(findings[0]?.id).toBe(id);
      expect(findings[0]?.line).toBe(1);
      expect(findings[0]?.match).toBe(match);
    });
  }

  it("flags private key blocks (RSA, OPENSSH, plain, encrypted)", () => {
    for (const header of [
      "-----BEGIN RSA PRIVATE KEY-----",
      "-----BEGIN OPENSSH PRIVATE KEY-----",
      "-----BEGIN PRIVATE KEY-----",
      "-----BEGIN ENCRYPTED PRIVATE KEY-----",
    ]) {
      expect(findSecrets(`${header}\nMIIE...`).map((f) => f.id)).toEqual([
        "private-key-block",
      ]);
    }
  });

  it("does NOT flag public key blocks", () => {
    expect(findSecrets("-----BEGIN PUBLIC KEY-----\nMIIB...")).toEqual([]);
  });
});

describe("findSecrets — high precision only (no entropy heuristics)", () => {
  const negatives: Array<[string, string]> = [
    ["bare prefix, no body", "the deploy uses ghp_ tokens"],
    ["too-short AWS shape", "AKIA1234 is not a full key"],
    ["AWS prefix glued into prose", "we use AKIA-style identifiers"],
    ["github_pat_ without a body", "fine-grained tokens start with github_pat_"],
    ["bare glpat-", "gitlab pats look like glpat-…"],
    ["bare xox", "slack prefixes are xoxb-, xoxp-, …"],
    ["AIza alone", "google keys start AIza…"],
    ["sk-proj- alone", "openai keys start sk-proj-…"],
    ["random base64 with no known prefix", "YWJjZGVmZ2hpamtsbW5vcHFyc3R1dnd4eXo="],
    ["password-style assignment (v1 excludes it)", "password=correct-horse-battery"],
    ["high-entropy hex (no heuristic)", "deadbeef0123456789abcdef0123456789"],
  ];

  for (const [name, content] of negatives) {
    it(`does not flag: ${name}`, () => {
      expect(findSecrets(content)).toEqual([]);
    });
  }
});

describe("findSecrets — reporting shape", () => {
  it("reports one finding per match with 1-based line numbers, sorted by position", () => {
    const content = [
      "# Session notes",
      "",
      `key one: ${AWS_KEY}`,
      "some prose in between",
      `key two: ${GITHUB_CLASSIC}`,
      `same line again: ${AWS_KEY}`,
    ].join("\n");
    const findings = findSecrets(content);
    expect(findings.map((f) => f.line)).toEqual([3, 5, 6]);
  });

  it("masks the matched secret in the preview so reports never re-print it", () => {
    const findings = findSecrets(`token: ${GITHUB_CLASSIC}`);
    const preview = findings[0]?.preview ?? "";
    expect(preview).not.toContain(GITHUB_CLASSIC);
    expect(preview.startsWith("ghp")).toBe(true);
    expect(preview).toContain("…");
  });

  it("returns [] for clean content", () => {
    expect(findSecrets("# A boring note\n\nJust prose about AWS and GitHub.")).toEqual([]);
  });
});

describe("assertNoSecrets — the block gate (SECRETS_BLOCKED)", () => {
  it("passes clean content without throwing", () => {
    expect(() => assertNoSecrets("specs/a.md", "# Clean\n\nnothing here")).not.toThrow();
  });

  it("throws AppError SECRETS_BLOCKED naming the file, kind, and line", () => {
    let caught: unknown;
    try {
      assertNoSecrets("specs/SPEC-a.md", `prose\n\nkey: ${AWS_KEY}`);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AppError);
    const appError = caught as AppError;
    expect(appError.code).toBe(ERROR_CODES.SECRETS_BLOCKED);
    expect(appError.message).toContain("specs/SPEC-a.md");
    expect(appError.message).toContain("AWS access key ID");
    expect(appError.message).toContain("line 3");
    expect(appError.hint).toBeTruthy();
  });

  it("names every distinct finding when several secrets are present", () => {
    const content = `a ${AWS_KEY}\nb ${GITHUB_CLASSIC}`;
    let message = "";
    try {
      assertNoSecrets("logs/2026-07-14.md", content);
    } catch (error) {
      message = (error as AppError).message;
    }
    expect(message).toContain("AWS access key ID");
    expect(message).toContain("GitHub token");
  });
});
