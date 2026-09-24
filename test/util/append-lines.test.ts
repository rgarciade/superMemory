import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { appendMissingLines } from "../../src/util/append-lines.js";

// Task 1.1 [RED first]: the N7 regression suite (init's mergeMissingLines
// semantics, paid for in the add-m1-core remediation) ported to the shared
// util contract `appendMissingLines(filePath, content)` — byte-exact,
// EOL-preserving, negation-aware, never decoding the existing file as
// UTF-8. These pins travel with the util so every future caller (setup's
// project .gitignore line, W4) inherits the hard-won edges for free.

/** Hermetic tmp dir per test — no chdir, no env, cleaned up even on failure. */
async function inTempDir(run: (dir: string) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "append-lines-"));
  try {
    await run(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("appendMissingLines", () => {
  it("creates an absent file with exactly `content` and reports original: null", async () => {
    await inTempDir(async (dir) => {
      const filePath = path.join(dir, ".gitignore");
      const content = "node_modules/\n.memory/cache/\n";

      const result = await appendMissingLines(filePath, content);

      expect(result).toEqual({ changed: true, original: null });
      expect(await readFile(filePath)).toEqual(Buffer.from(content, "utf8"));
    });
  });

  it("is an idempotent no-op when every required line is already present — writes nothing, original = pre-call bytes", async () => {
    await inTempDir(async (dir) => {
      const filePath = path.join(dir, ".gitignore");
      const pre = "node_modules/\n.memory/cache/\n";
      await writeFile(filePath, pre, "utf8");
      const mtimeBefore = (await stat(filePath)).mtimeMs;

      const result = await appendMissingLines(filePath, "node_modules/\n.memory/cache/\n");

      expect(result.changed).toBe(false);
      expect(result.original).toEqual(Buffer.from(pre, "utf8"));
      // byte-identical, and provably no write happened (mtime untouched)
      expect(await readFile(filePath)).toEqual(Buffer.from(pre, "utf8"));
      expect((await stat(filePath)).mtimeMs).toBe(mtimeBefore);
    });
  });

  it("appends only the missing lines when the file is partially present", async () => {
    await inTempDir(async (dir) => {
      const filePath = path.join(dir, ".gitignore");
      const pre = "node_modules/\n.env\n";
      await writeFile(filePath, pre, "utf8");

      const result = await appendMissingLines(filePath, ".env\n.memory/cache/\n");

      expect(result.changed).toBe(true);
      expect(result.original).toEqual(Buffer.from(pre, "utf8"));
      // pre-existing entries first and unmodified; only the missing line added
      expect(await readFile(filePath)).toEqual(
        Buffer.from("node_modules/\n.env\n.memory/cache/\n", "utf8"),
      );
    });
  });

  it("preserves an existing CRLF file's line ending for the appended lines (N7)", async () => {
    await inTempDir(async (dir) => {
      const filePath = path.join(dir, ".gitignore");
      const pre = "node_modules/\r\n.env\r\n";
      await writeFile(filePath, pre, "utf8");

      const result = await appendMissingLines(filePath, ".memory/cache/\n");

      expect(result.changed).toBe(true);
      expect(result.original).toEqual(Buffer.from(pre, "utf8"));
      const after = await readFile(filePath);
      // original bytes are a verbatim prefix — untouched
      expect(after.subarray(0, pre.length).toString("latin1")).toBe(pre);
      // appended section uses CRLF; no bare LF was introduced
      const appended = after.subarray(pre.length);
      expect(appended).toEqual(Buffer.from(".memory/cache/\r\n", "utf8"));
    });
  });

  it("re-appends a line whose only prior occurrence was negated (gitignore last-match-wins)", async () => {
    await inTempDir(async (dir) => {
      const filePath = path.join(dir, ".gitignore");
      // the file un-ignores .memory/cache/ via a later `!` line — the
      // positive entry is NOT in effect, so it must be re-appended.
      const pre = ".memory/cache/\n!.memory/cache/\n";
      await writeFile(filePath, pre, "utf8");

      const result = await appendMissingLines(filePath, ".memory/cache/\n");

      expect(result.changed).toBe(true);
      expect(result.original).toEqual(Buffer.from(pre, "utf8"));
      const lines = (await readFile(filePath, "utf8")).split("\n").filter(Boolean);
      const last = [...lines].reverse().find((l) => l === ".memory/cache/" || l === "!.memory/cache/");
      expect(last).toBe(".memory/cache/");
    });
  });

  it("does NOT re-append a line whose last occurrence is already positive (negation triangulated)", async () => {
    await inTempDir(async (dir) => {
      const filePath = path.join(dir, ".gitignore");
      // negated, then re-affirmed — the positive form IS in effect.
      const pre = "!.memory/cache/\n.memory/cache/\n";
      await writeFile(filePath, pre, "utf8");

      const result = await appendMissingLines(filePath, ".memory/cache/\n");

      expect(result.changed).toBe(false);
      expect(result.original).toEqual(Buffer.from(pre, "utf8"));
      expect((await readFile(filePath, "utf8")).split("\n").filter((l) => l === ".memory/cache/").length).toBe(1);
    });
  });

  it("survives raw non-UTF-8 bytes — raw Buffer comparison, never decoded", async () => {
    await inTempDir(async (dir) => {
      const filePath = path.join(dir, ".gitignore");
      // "node_modules/ <Latin-1 0xE9>\n" — 0xE9 alone is invalid UTF-8;
      // a decode-compare-encode round trip would corrupt it irreversibly.
      const pre = Buffer.concat([
        Buffer.from("node_modules/ ", "utf8"),
        Buffer.from([0xe9]),
        Buffer.from("\n", "utf8"),
      ]);
      await writeFile(filePath, pre);

      const result = await appendMissingLines(filePath, ".memory/cache/\n");

      expect(result.changed).toBe(true);
      expect(result.original).toEqual(pre);
      expect(await readFile(filePath)).toEqual(
        Buffer.concat([pre, Buffer.from(".memory/cache/\n", "utf8")]),
      );
    });
  });

  it("never modifies or reorders existing lines — appends after the original bytes, inserting the EOL separator when the file lacks a trailing newline", async () => {
    await inTempDir(async (dir) => {
      const filePath = path.join(dir, ".gitignore");
      const pre = "node_modules/"; // no trailing newline
      await writeFile(filePath, pre, "utf8");

      const result = await appendMissingLines(filePath, ".env\n.memory/cache/\n");

      expect(result.changed).toBe(true);
      expect(result.original).toEqual(Buffer.from(pre, "utf8"));
      expect(await readFile(filePath)).toEqual(
        Buffer.from("node_modules/\n.env\n.memory/cache/\n", "utf8"),
      );
    });
  });
});
