import { readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  createPrompt,
  isEnterKey,
  isTabKey,
  makeTheme,
  useKeypress,
  usePrefix,
  useState,
  type Status,
} from "@inquirer/core";

/**
 * Tab directory-completion for the setup wizard's vault-path prompt
 * (post-gate UX addition on add-project-config).
 *
 * The decisions live in the PURE helper (`completeVaultPath`): it is
 * fully injected (fragment, cwd, homeDir) and exercised by
 * test/cli/commands/setup-completion.test.ts. The console prompt
 * component (`directoryInput`) is thin edge wiring in the exact shape
 * of @inquirer/input 5.1.6 (same createPrompt lifecycle, same
 * ExitPromptError semantics from the framework) — it only feeds the
 * current line into the helper on Tab and renders the helper's rows.
 * The ambient reads (`process.cwd()`, `os.homedir()`) appear ONLY in
 * that console edge, never in the helper (seam rule, design §6).
 */

/** At most this many completion rows render under the prompt line. */
const MAX_ROWS = 8;

export interface VaultPathCompletion {
  /**
   * The new, longer fragment to place on the line — `dirPart + match + "/"`
   * for a unique match (trailing slash drills into it on the next Tab), or
   * `dirPart + <common prefix>` when several matches share one. Absent
   * when nothing extends the typed fragment.
   */
  completion?: string;
  /**
   * Ambiguous sibling directory names to render (already capped at
   * MAX_ROWS, sorted). Empty when the match was unique or there is none.
   */
  rows: string[];
}

/**
 * Completes a typed path fragment against the real filesystem:
 * splits at the last "/" into (dirPart, prefix), resolves dirPart
 * against `cwd` — or `homeDir` when it starts with "~" — and considers
 * only DIRECTORIES whose name matches `prefix` case-insensitively
 * (dotfiles excluded unless the prefix starts with "."). Unique match ⇒
 * completion drills deeper; multiple matches ⇒ rows + common-prefix
 * extension; zero matches (including a missing or unreadable dirPart) ⇒
 * empty result. Total: never throws.
 */
export function completeVaultPath(
  fragment: string,
  cwd: string,
  homeDir: string,
): VaultPathCompletion {
  const lastSlash = fragment.lastIndexOf("/");
  const dirPart = lastSlash === -1 ? "" : fragment.slice(0, lastSlash + 1);
  const prefix = lastSlash === -1 ? fragment : fragment.slice(lastSlash + 1);

  let matches: string[];
  try {
    matches = readdirSync(resolveBaseDir(dirPart, cwd, homeDir), {
      withFileTypes: true,
    }).flatMap((entry) =>
      isDirectoryMatch(entry.isDirectory(), entry.name, prefix) ? [entry.name] : [],
    ).sort(compareStrings);
  } catch {
    return { rows: [] };
  }

  if (matches.length === 0) return { rows: [] };
  if (matches.length === 1) {
    return { completion: `${dirPart}${matches[0]}/`, rows: [] };
  }

  const common = commonPrefix(matches);
  const rows = matches.slice(0, MAX_ROWS);
  if (common.length <= prefix.length) return { rows };
  return { completion: dirPart + common, rows };
}

/** Deterministic lexicographic order (code units), independent of locale. */
function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** `~`-prefixed dirParts resolve against the injected home; the rest against cwd. */
function resolveBaseDir(dirPart: string, cwd: string, homeDir: string): string {
  if (dirPart.startsWith("~")) {
    const rest = dirPart.slice(1); // "" or "/sub/dir"
    return rest === "" ? homeDir : path.resolve(homeDir, `.${rest}`);
  }
  return path.resolve(cwd, dirPart);
}

/** Directory check + prefix match in one predicate (dotfiles opt-in only). */
function isDirectoryMatch(isDirectory: boolean, name: string, prefix: string): boolean {
  if (!isDirectory) return false;
  if (name.startsWith(".") && !prefix.startsWith(".")) return false;
  return name.toLowerCase().startsWith(prefix.toLowerCase());
}

/** Longest prefix shared by EVERY name (exact-case, on real entry names). */
function commonPrefix(names: readonly string[]): string {
  let prefix = names[0] ?? "";
  for (const name of names) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i += 1;
    prefix = prefix.slice(0, i);
    if (prefix === "") break;
  }
  return prefix;
}

/**
 * The vault-path prompt: an @inquirer/input-shaped text field whose Tab
 * runs `completeVaultPath` against the launch cwd and the user's home.
 * Enter resolves; backspace/delete are readline-native (the hook mirrors
 * the line into state, exactly like @inquirer/input); Escape is inert
 * the same way it is in @inquirer/input 5.1.6 — abort semantics
 * (ExitPromptError) stay framework-owned, so the existing error flow is
 * untouched. Ambiguous matches render as dimmed rows (max 8) under the
 * prompt line until the next keystroke clears them.
 */
export const directoryInput = createPrompt<string, { message: string }>(
  (config, done) => {
  const theme = makeTheme();
  const [status, setStatus] = useState<Status>("idle");
  const [value, setValue] = useState("");
  const [rows, setRows] = useState<readonly string[]>([]);
  const prefix = usePrefix({ status, theme });

  useKeypress((key, rl) => {
    if (isEnterKey(key)) {
      setValue(value);
      setStatus("done");
      done(value);
      return;
    }
    if (isTabKey(key)) {
      rl.clearLine(0); // Remove the tab character (same as @inquirer input).
      const result = completeVaultPath(value, process.cwd(), os.homedir());
      const next = result.completion ?? value;
      rl.write(next);
      setValue(next);
      setRows(result.rows);
      return;
    }
    setValue(rl.line);
    setRows([]);
  });

  const message = theme.style.message(config.message, status);
  const formattedValue = status === "done" ? theme.style.answer(value) : value;
  const bottomContent =
    rows.length > 0
      ? rows.map((row) => theme.style.help(`  ${row}`)).join("\n")
      : undefined;
  return [
    [prefix, message, formattedValue].filter((v) => v !== undefined).join(" "),
    bottomContent,
  ];
});
