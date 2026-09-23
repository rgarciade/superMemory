import { AppError, ERROR_CODES } from "../util/errors.js";

/**
 * Secrets lint — the v1 pattern set (design §4.6).
 *
 * High-precision prefixes only: every pattern anchors on a vendor-issued
 * token prefix, never on entropy or `password=`-style shapes — a false
 * positive that blocks a commit is its own incident class. The set is a
 * frozen module-level constant, trivially extendable in v2.
 *
 * Pure: no I/O. The engine calls `assertNoSecrets` before every commit on
 * every trigger (debounce, interval, manual, tool) and at every
 * conflict-ladder stage that creates one (normalization, conflict notes,
 * `resolve` finalization, `chore(index)` regeneration).
 */

export interface SecretPattern {
  /** Stable identifier — asserted by tests, referenced in reports. */
  id: string;
  /** Human-readable kind, used in SECRETS_BLOCKED messages. */
  kind: string;
  /** Global regex — anchored on vendor prefixes, not entropy. */
  pattern: RegExp;
}

/** v1 pattern set (design §4.6). Frozen: extend by shipping a v2 set. */
export const SECRET_PATTERNS_V1: readonly SecretPattern[] = Object.freeze([
  { id: "aws-access-key-id", kind: "AWS access key ID", pattern: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "github-token", kind: "GitHub token", pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { id: "github-fine-grained-token", kind: "GitHub fine-grained token", pattern: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { id: "gitlab-pat", kind: "GitLab personal access token", pattern: /\bglpat-[A-Za-z0-9_-]{16,}/g },
  { id: "slack-token", kind: "Slack token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}/g },
  { id: "google-api-key", kind: "Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}/g },
  { id: "private-key-block", kind: "Private key block", pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/g },
  { id: "openai-api-key", kind: "OpenAI API key", pattern: /\bsk-proj-[A-Za-z0-9_-]{16,}/g },
]);

export interface SecretFinding {
  id: string;
  kind: string;
  /** 1-based line number of the match. */
  line: number;
  /** The matched text — for local diagnostics only, never re-printed raw. */
  match: string;
  /** Masked preview (first characters + length) — safe to surface. */
  preview: string;
}

/** Scans content against every v1 pattern; findings sorted by position. */
export function findSecrets(content: string): SecretFinding[] {
  const findings: Array<SecretFinding & { index: number }> = [];
  for (const secretPattern of SECRET_PATTERNS_V1) {
    // Module-level regexes are stateful (`g`) — clone before use so
    // concurrent/repeated scans can never observe lastIndex drift.
    const pattern = new RegExp(secretPattern.pattern.source, secretPattern.pattern.flags);
    for (const match of content.matchAll(pattern)) {
      const text = match[0];
      const index = match.index ?? 0;
      findings.push({
        id: secretPattern.id,
        kind: secretPattern.kind,
        line: lineOf(content, index),
        match: text,
        preview: mask(text),
        index,
      });
    }
  }
  findings.sort((a, b) => a.index - b.index);
  return findings.map(({ index: _index, ...finding }) => finding);
}

/**
 * The block gate (sync-ladder spec): throws `SECRETS_BLOCKED` when the
 * content contains a flagged secret — the caller never commits, and the
 * write stays pending. Clean content passes through untouched.
 */
export function assertNoSecrets(fileName: string, content: string): void {
  const findings = findSecrets(content);
  const first = findings[0];
  if (findings.length === 0 || first === undefined) return;
  const located = findings.map((f) => `${f.kind} at line ${f.line}`).join("; ");
  throw new AppError(
    ERROR_CODES.SECRETS_BLOCKED,
    `refusing to commit "${fileName}": flagged secret (${located}). First match: ${first.kind} at line ${first.line}`,
    {
      hint: "Remove the secret from the note before committing — store credentials in an environment variable or a secret store, not the vault.",
    },
  );
}

function lineOf(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) {
    if (content.charCodeAt(i) === 10 /* \n */) line++;
  }
  return line;
}

function mask(text: string): string {
  if (text.length <= 12) return text;
  return `${text.slice(0, 4)}…(${text.length} chars)`;
}
