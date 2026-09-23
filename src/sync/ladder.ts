import type { RulesModel } from "../rules/types.js";
import { resolveNoteType } from "../index/build.js";

/**
 * The conflict ladder's pure half (design §4.4): classification and
 * routing. The impulsive git acts (checkout --theirs, rebase --continue,
 * --abort, snapshot branch) belong to the engine; this module decides
 * WHAT to do so the decision is testable without a repo.
 *
 * Routing rule: automatic resolution only when *every* conflict is
 * auto-resolvable — any curated conflict routes the whole rebase to the
 * curated path (abort, snapshot, conflict note). Auto-resolving half a
 * conflicted rebase while aborting the other half has no clean git
 * semantics; the safety ordering is deliberate.
 *
 * Session-log entry format (v1, this module's contract): one entry per
 * bullet line, `- <timestamp> | <entry-id> | <text>`. The normalizer
 * makes union-merged logs canonical: chronologically sorted, deduped by
 * entry id.
 */

export type LadderCategory = "generated" | "union" | "curated";

export interface LadderDecision {
  /**
   * `auto` — every conflict is machine-resolvable (generated → take
   * either side + continue + deterministic regeneration; union →
   * concatenation + normalization).
   * `curated-abort` — at least one curated conflict: abort the rebase
   * (local state intact), snapshot the incoming side, write a conflict
   * note, pause push.
   */
  action: "auto" | "curated-abort";
  byCategory: { generated: string[]; union: string[]; curated: string[] };
  /** Non-empty iff `action === "curated-abort"`. */
  curatedPaths: string[];
}

/** Generated-path default when rules declare no `git.generated_paths`. */
export const DEFAULT_GENERATED_PATHS: readonly string[] = ["index/"];

const CURATED_POLICY_DEFAULT = "human_required";
const UNION_POLICY = "union";

/**
 * Classifies one conflicted path:
 * - `generated` — under a `git.generated_paths` entry (default `index/`);
 * - `union` — a declared note type whose effective conflict policy is
 *   `union` (explicit `conflict_policy` beats `conflict_policy_defaults`);
 * - `curated` — everything else (the never-delete path).
 */
export function classifyConflictPath(relPath: string, rules: RulesModel): LadderCategory {
  const normalized = relPath.split("\\").join("/");
  const generatedPaths = rules.git.generatedPaths ?? DEFAULT_GENERATED_PATHS;
  if (generatedPaths.some((prefix) => pathUnder(normalized, prefix))) {
    return "generated";
  }
  const resolved = resolveNoteType(normalized, rules);
  if (resolved !== undefined) {
    const policy =
      resolved.def.conflictPolicy ??
      rules.conflictPolicyDefaults[resolved.type] ??
      CURATED_POLICY_DEFAULT;
    if (policy === UNION_POLICY) return "union";
  }
  return "curated";
}

/**
 * Routes the whole rebase from the conflicted paths: any curated
 * conflict ⇒ `curated-abort`; otherwise `auto` (mixed generated+union is
 * fine — both categories are machine-resolvable).
 */
export function planConflictLadder(conflictedPaths: string[], rules: RulesModel): LadderDecision {
  const byCategory: LadderDecision["byCategory"] = { generated: [], union: [], curated: [] };
  for (const relPath of conflictedPaths) {
    byCategory[classifyConflictPath(relPath, rules)].push(relPath);
  }
  const curatedPaths = byCategory.curated;
  return {
    action: curatedPaths.length > 0 ? "curated-abort" : "auto",
    byCategory,
    curatedPaths,
  };
}

/**
 * Marker-level union fallback: when `.gitattributes merge=union` still
 * produces conflict markers, resolve by taking BOTH regions — the
 * normalizer makes the result canonical afterwards. Local region first
 * (deterministic), markers dropped.
 */
export function resolveUnionConflict(conflictedContent: string): string {
  return conflictedContent
    .split("\n")
    .filter((line) => !isConflictMarker(line))
    .join("\n");
}

function isConflictMarker(line: string): boolean {
  return /^<{7}( .*)?$/.test(line) || /^={7}$/.test(line) || /^>{7}( .*)?$/.test(line);
}

interface LogEntry {
  line: string;
  timestamp: string;
  id: string;
  /** Parsed timestamp (ms); Number.NaN sorts undated entries last. */
  time: number;
  /** Original line order — the tiebreaker for equal timestamps. */
  order: number;
}

const ENTRY_PATTERN = /^- ([^|]+) \| ([^|]+) \| (.*)$/;

/**
 * Canonicalizes a union-merged session log: entries chronologically
 * sorted (undated last), deduped by entry id (first occurrence wins),
 * non-entry lines preserved in place. Idempotent.
 */
export function normalizeSessionLog(content: string): string {
  // Operate on raw lines so frontmatter and formatting round-trip exactly.
  const lines = content.split("\n");
  const entries: LogEntry[] = [];
  let firstEntryIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === undefined) continue;
    const match = ENTRY_PATTERN.exec(line);
    if (!match) continue;
    const timestamp = match[1];
    const id = match[2];
    if (timestamp === undefined || id === undefined) continue;
    if (firstEntryIndex === -1) firstEntryIndex = i;
    entries.push({
      line,
      timestamp: timestamp.trim(),
      id: id.trim(),
      time: Date.parse(timestamp.trim()),
      order: entries.length,
    });
  }
  if (firstEntryIndex === -1) return content; // nothing to normalize

  const seen = new Set<string>();
  const deduped = entries.filter((entry) => {
    if (seen.has(entry.id)) return false;
    seen.add(entry.id);
    return true;
  });
  deduped.sort((a, b) => {
    const at = Number.isNaN(a.time) ? Number.POSITIVE_INFINITY : a.time;
    const bt = Number.isNaN(b.time) ? Number.POSITIVE_INFINITY : b.time;
    if (at !== bt) return at - bt;
    return a.order - b.order; // stable for equal timestamps
  });

  // Splice the canonical block where the first entry lived; drop the rest.
  const before = lines.slice(0, firstEntryIndex);
  const after = lines
    .slice(firstEntryIndex + 1)
    .filter((line) => !ENTRY_PATTERN.test(line));
  return [...before, ...deduped.map((entry) => entry.line), ...after].join("\n");
}

function pathUnder(path: string, folderPrefix: string): boolean {
  const prefix = folderPrefix.endsWith("/") ? folderPrefix : `${folderPrefix}/`;
  return path === folderPrefix.replace(/\/$/, "") || path.startsWith(prefix);
}
