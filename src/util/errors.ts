/**
 * The single error shape for every actionable failure (design §1.5).
 *
 * Stable codes let the CLI, the MCP layer, and tests assert uniformly
 * instead of string-matching ad hoc. Spec-mandated message contract:
 * `No vault configured. Run: supermemory setup` maps to
 * `NO_VAULT_CONFIGURED`.
 */

export type AppErrorCode =
  | "RULES_PARSE_ERROR"
  | "FORMAT_VERSION_UNSUPPORTED"
  | "BOOT_VALIDATION_FAILED"
  | "SQLITE_FTS5_MISSING"
  | "SECRETS_BLOCKED"
  | "LOCK_HELD"
  | "CONFLICT_CURATED"
  | "NO_VAULT_CONFIGURED";

/** Stable error codes, one entry per module surface (design §1.5). */
export const ERROR_CODES = {
  RULES_PARSE_ERROR: "RULES_PARSE_ERROR",
  FORMAT_VERSION_UNSUPPORTED: "FORMAT_VERSION_UNSUPPORTED",
  BOOT_VALIDATION_FAILED: "BOOT_VALIDATION_FAILED",
  SQLITE_FTS5_MISSING: "SQLITE_FTS5_MISSING",
  SECRETS_BLOCKED: "SECRETS_BLOCKED",
  LOCK_HELD: "LOCK_HELD",
  CONFLICT_CURATED: "CONFLICT_CURATED",
  NO_VAULT_CONFIGURED: "NO_VAULT_CONFIGURED",
} as const satisfies Record<AppErrorCode, AppErrorCode>;

export type AppErrorCodeValue = (typeof ERROR_CODES)[AppErrorCode];

export class AppError extends Error {
  readonly code: string;
  readonly hint?: string;

  constructor(
    code: AppErrorCodeValue | string,
    message: string,
    opts?: { hint?: string; cause?: unknown },
  ) {
    super(message, opts?.cause === undefined ? undefined : { cause: opts.cause });
    this.name = "AppError";
    this.code = code;
    this.hint = opts?.hint;
  }

  toString(): string {
    const hint = this.hint ? `\nhint: ${this.hint}` : "";
    return `supermemory: [${this.code}] ${this.message}${hint}`;
  }
}

/** Spec-mandated message for an unconfigured environment (boot-validation). */
export const NO_VAULT_CONFIGURED_MESSAGE =
  "No vault configured. Run: supermemory setup";
