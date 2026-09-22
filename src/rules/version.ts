import { AppError } from "../util/errors.js";

/**
 * The format_version contract (rules-parsing spec / RFC §4.4).
 *
 * The vault's rules.md declares the rules-format semver; this build
 * supports one major line. Same major = accepted (minor/patch are
 * backward compatible); any other major = refused with an actionable
 * error. This is the single check reused at boot (P1), after a sync
 * changes rules (P3 pre-pull guard + post-sync reload), and by the
 * parser whenever rules are loaded.
 */

/** The rules-format major this build supports, e.g. "1.0". */
export const SUPPORTED_FORMAT_VERSION = "1.0";

/**
 * Canonical string for a declared version. YAML parses unquoted `1.0`
 * as the number 1 (RFC §4.2 examples are unquoted) — integers render
 * with one decimal, everything else as-is.
 */
export function normalizeFormatVersion(declared: string | number): string {
  if (typeof declared === "number") {
    return Number.isInteger(declared) ? declared.toFixed(1) : String(declared);
  }
  return declared;
}

export function supportedFormatMajor(): number {
  return parseMajor(SUPPORTED_FORMAT_VERSION);
}

/**
 * Throws `FORMAT_VERSION_UNSUPPORTED` unless `declared` shares this
 * build's format major. The error names the required version and directs
 * the user to update the app (spec wording contract).
 */
export function checkFormatVersion(declared: string | number | undefined): void {
  const supported = supportedFormatMajor();
  if (
    declared === undefined ||
    (typeof declared === "string" && declared.trim() === "")
  ) {
    throw new AppError("FORMAT_VERSION_UNSUPPORTED", missingVersionMessage(), {
      hint: "Open .memory/rules.md and add `format_version: 1.0` to the frontmatter.",
    });
  }
  const declaredString = normalizeFormatVersion(declared);
  const required = parseMajor(declaredString);
  if (Number.isNaN(required)) {
    throw new AppError(
      "FORMAT_VERSION_UNSUPPORTED",
      `vault rules.md declares an invalid format_version "${declaredString}" — expected a semver like 1.0.`,
      { hint: "Set `format_version: 1.0` in .memory/rules.md frontmatter." },
    );
  }
  if (required !== supported) {
    throw new AppError(
      "FORMAT_VERSION_UNSUPPORTED",
      unsupportedMessage(declaredString, required),
      {
        hint: `Update the app (npx supermemory@latest) to a build that supports rules format ${required}.x, or ask the team to keep the vault on format ${supported}.x.`,
      },
    );
  }
}

function unsupportedMessage(declared: string, required: number): string {
  const supported = supportedFormatMajor();
  if (required > supported) {
    return `vault requires format ${required}.x (declared ${declared}), but this supermemory build supports ${supported}.x — update the app to read this vault.`;
  }
  return `vault declares format ${declared}, but this supermemory build supports ${supported}.x — update the app (or the vault) so both speak the same rules format.`;
}

function missingVersionMessage(): string {
  return `vault rules.md is missing format_version — this supermemory build supports ${supportedFormatMajor()}.x and needs the version declared.`;
}

function parseMajor(version: string): number {
  const match = /^\s*(\d+)(?:\.\d+)?(?:\.\d+)?\s*$/.exec(version);
  if (!match || match[1] === undefined) return Number.NaN;
  return Number.parseInt(match[1], 10);
}
