/**
 * Stderr-only logger (design §1.6). stdout is reserved for the MCP
 * protocol in `serve` — every log line goes to stderr. Level via
 * SUPERMEMORY_LOG_LEVEL (error | warn | info | debug; default info).
 */

export type LogLevel = "error" | "warn" | "info" | "debug";

export const LOG_LEVELS: readonly LogLevel[] = ["error", "warn", "info", "debug"];

const LEVEL_ORDER: Record<LogLevel, number> = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

export interface Logger {
  error(message: string): void;
  warn(message: string): void;
  info(message: string): void;
  debug(message: string): void;
}

export interface LoggerOptions {
  /** Minimum level to emit; defaults to SUPERMEMORY_LOG_LEVEL or "info". */
  minLevel?: LogLevel;
  /** Line sink; defaults to console.error (stderr). */
  sink?: (line: string) => void;
}

export function parseLogLevel(raw: string | undefined): LogLevel {
  const candidate = (raw ?? "").trim().toLowerCase();
  return (LOG_LEVELS as readonly string[]).includes(candidate)
    ? (candidate as LogLevel)
    : "info";
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  const minLevel: LogLevel =
    opts.minLevel ?? parseLogLevel(process.env["SUPERMEMORY_LOG_LEVEL"]);
  const minOrder = LEVEL_ORDER[minLevel];
  const sink = opts.sink ?? ((line: string) => console.error(line));

  const emit = (level: LogLevel, message: string): void => {
    if (LEVEL_ORDER[level] <= minOrder) {
      sink(`supermemory: ${level} ${message}`);
    }
  };

  return {
    error: (message) => emit("error", message),
    warn: (message) => emit("warn", message),
    info: (message) => emit("info", message),
    debug: (message) => emit("debug", message),
  };
}
