import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

// Trivial runner proof (task 1.1): vitest is wired with no globals —
// { describe, it, expect } are imported explicitly per design §1.7.
describe("package scaffold", () => {
  it("package.json declares the supermemory ESM package shape", async () => {
    const pkgPath = fileURLToPath(new URL("../package.json", import.meta.url));
    const pkg = JSON.parse(await readFile(pkgPath, "utf8")) as {
      name: string;
      type: string;
      engines: { node: string };
      bin: Record<string, string>;
      files: string[];
    };
    expect(pkg.name).toBe("supermemory");
    expect(pkg.type).toBe("module");
    expect(pkg.engines.node).toBe(">=22.0.0");
    expect(pkg.bin["supermemory"]).toBe("dist/cli/index.js");
    expect(pkg.files).toEqual(["dist"]);
  });
});
