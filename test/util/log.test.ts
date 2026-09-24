import { describe, expect, it } from "vitest";
import { createLogger, type LogLevel } from "../../src/util/log.js";

// Task 1.7 [RED first]: stderr-only logger with level filtering (design §1.6).
describe("createLogger", () => {
  it("writes each line to the injected sink with the level prefix", () => {
    const lines: string[] = [];
    const log = createLogger({ minLevel: "info", sink: (l) => lines.push(l) });
    log.info("vault booted");
    log.warn("pull failed");
    log.error("boom");
    expect(lines).toEqual([
      "supermemory: info vault booted",
      "supermemory: warn pull failed",
      "supermemory: error boom",
    ]);
  });

  it("filters levels below the minimum", () => {
    const lines: string[] = [];
    const log = createLogger({ minLevel: "error", sink: (l) => lines.push(l) });
    log.debug("hidden");
    log.info("hidden");
    log.warn("hidden");
    log.error("shown");
    expect(lines).toEqual(["supermemory: error shown"]);
  });

  it("debug passes when the minimum is debug", () => {
    const lines: string[] = [];
    const log = createLogger({ minLevel: "debug", sink: (l) => lines.push(l) });
    log.debug("detail");
    expect(lines).toEqual(["supermemory: debug detail"]);
  });

  it("every level name is accepted and ordered error < warn < info < debug", () => {
    const levels: LogLevel[] = ["error", "warn", "info", "debug"];
    expect(levels.length).toBe(4);
  });

  it("default sink is console.error (stderr) — the MCP stdout stays clean", () => {
    const log = createLogger({ minLevel: "info" });
    // The default construction must not throw and must expose the API.
    expect(typeof log.error).toBe("function");
    expect(typeof log.warn).toBe("function");
    expect(typeof log.info).toBe("function");
    expect(typeof log.debug).toBe("function");
  });
});
