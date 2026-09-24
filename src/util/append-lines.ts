import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";

export interface AppendLinesResult {
  /** true iff this call changed the file's bytes. */
  changed: boolean;
  /**
   * The file's bytes before this call (null if the file did not exist)
   * — captured atomically with the merge decision, for rollback
   * tracking.
   */
  original: Buffer | null;
}

/**
 * Ensures every non-empty line of `content` is effectively present in
 * `filePath`, appending only what is missing. Byte-exact (raw Buffer
 * comparison, never decodes the existing file as UTF-8), preserves the
 * file's own EOL (LF/CRLF) for appended lines, negation-aware
 * (gitignore last-match-wins: a trailing `!line` un-ignores, so a
 * negated entry is treated as missing and re-appended), never modifies
 * or reorders existing lines. Creates the file (with `content`) when
 * absent.
 *
 * Extracted verbatim from `init.ts`'s `mergeMissingLines` (design AD-5
 * of add-project-config; the semantics are the N7 regression contract
 * from the add-m1-core remediation). The util captures `original`
 * itself and returns it; callers that need rollback tracking consume
 * the result without this module knowing about trackers.
 */
export async function appendMissingLines(
  filePath: string,
  content: string,
): Promise<AppendLinesResult> {
  const existed = existsSync(filePath);
  const original = existed ? await readFile(filePath) : null;

  if (original === null) {
    await writeFile(filePath, content, "utf8");
    return { changed: true, original: null };
  }

  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const eolBuf = Buffer.from(eol, "ascii");
  const existingLines = splitLinesRaw(original);
  const requiredLines = content
    .split("\n")
    .map((line) => line.replace(/\r$/, "").trim())
    .filter((line) => line.length > 0);

  const missingLines = requiredLines.filter(
    (line) => !isEffectivelyPresentRaw(existingLines, line),
  );
  if (missingLines.length === 0) return { changed: false, original };

  const needsSeparator = original.length > 0 && !bufferEndsWith(original, eolBuf);
  const appended = Buffer.from(missingLines.join(eol) + eol, "utf8");
  await writeFile(
    filePath,
    needsSeparator ? Buffer.concat([original, eolBuf, appended]) : Buffer.concat([original, appended]),
  );
  return { changed: true, original };
}

/** Splits `buf` on raw `\n` bytes, trimming a trailing `\r` and ASCII space/tab from each line — never decodes the bytes as text. */
function splitLinesRaw(buf: Buffer): Buffer[] {
  const lines: Buffer[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i += 1) {
    if (buf[i] === 0x0a) {
      lines.push(trimLineRaw(buf.subarray(start, i)));
      start = i + 1;
    }
  }
  if (start < buf.length) lines.push(trimLineRaw(buf.subarray(start)));
  return lines;
}

function trimLineRaw(line: Buffer): Buffer {
  let end = line.length;
  if (end > 0 && line[end - 1] === 0x0d) end -= 1; // trailing CR (CRLF line)
  let start = 0;
  while (start < end && isAsciiBlank(line[start]!)) start += 1;
  while (end > start && isAsciiBlank(line[end - 1]!)) end -= 1;
  return line.subarray(start, end);
}

function isAsciiBlank(byte: number): boolean {
  return byte === 0x20 || byte === 0x09;
}

function bufferEndsWith(buf: Buffer, suffix: Buffer): boolean {
  if (suffix.length === 0) return true;
  if (buf.length < suffix.length) return false;
  return buf.subarray(buf.length - suffix.length).equals(suffix);
}

/**
 * True when `target` (one of our own plain-ASCII scaffold lines) is in
 * effect among `existingLines` (raw byte lines from the file): its LAST
 * occurrence (among itself and its `!target` negation) must be the
 * positive form. Absent entirely, or last-negated, counts as NOT
 * present (so it gets re-appended).
 */
function isEffectivelyPresentRaw(existingLines: Buffer[], target: string): boolean {
  const targetBuf = Buffer.from(target, "utf8");
  const negatedBuf = Buffer.from(`!${target}`, "utf8");
  let present = false;
  for (const line of existingLines) {
    if (line.equals(targetBuf)) present = true;
    else if (line.equals(negatedBuf)) present = false;
  }
  return present;
}
