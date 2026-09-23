import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { IndexStore } from "../../index/store.js";
import { deriveNoteId, deriveTitle, parseNoteFile } from "../../notes/parse.js";
import { saveNote, type SyncPort } from "../../notes/save-pipeline.js";
import type { NoteTypeDef, RulesModel } from "../../rules/types.js";
import type { Clock } from "../../util/clock.js";

/**
 * `save` — thin: zod schema check (already enforced by the SDK before this
 * handler runs) -> validateNote (via `notes/save-pipeline`, violation
 * returned verbatim) -> save-pipeline (tool-catalog spec: "save —
 * validated create and update"). No separate validateNote call here:
 * save-pipeline already performs it (design 5.3/2.8) — a second call here
 * would be pure duplication against the same rules and frontmatter.
 */

export interface SaveDeps {
  vaultPath: string;
  rules: RulesModel;
  store: IndexStore;
  clock: Clock;
  syncPort: SyncPort;
  /** Provenance recorded on the write event (e.g. "mcp:claude", "cli"). */
  via: string;
}

export function createSaveHandler(deps: SaveDeps) {
  return async (args: Record<string, unknown>): Promise<CallToolResult> => {
    const type = typeof args["type"] === "string" ? args["type"] : undefined;
    if (!type) return errorResult("save requires a \"type\" field");

    const def = deps.rules.noteTypes[type];
    if (!def) {
      return errorResult(
        `unknown note type "${type}" — declared types are: ${Object.keys(deps.rules.noteTypes).join(", ")}`,
      );
    }

    const content = typeof args["content"] === "string" ? args["content"] : "";
    const titleArg = typeof args["title"] === "string" ? args["title"] : undefined;
    const { type: _type, content: _content, title: _title, ...frontmatter } = args;

    const title = deriveTitle(content, titleArg !== undefined ? { title: titleArg } : {}, "untitled.md");
    const notePath = resolvePath(def.folder, def.naming, frontmatter, title);

    // A naming template that doesn't fully disambiguate (no template at
    // all, or one that doesn't reference every id-bearing field) can
    // collide two different notes onto the same path. Never silently
    // overwrite a note that isn't the one being saved: if the target
    // already exists, its derived id must match the incoming id exactly.
    const conflict = await detectPathConflict(deps.vaultPath, notePath, type, def, frontmatter);
    if (conflict) return errorResult(conflict, { path: notePath });

    const result = await saveNote(
      { store: deps.store, clock: deps.clock, syncPort: deps.syncPort },
      {
        vaultPath: deps.vaultPath,
        rules: deps.rules,
        type,
        path: notePath,
        frontmatter,
        content,
        via: deps.via,
      },
    );

    if (!result.ok) {
      return errorResult(result.issues.map((issue) => issue.message).join("; "), {
        issues: result.issues,
      });
    }
    return toResult({ path: result.path, id: result.id ?? null });
  };
}

/**
 * Refuses a save that would silently replace a DIFFERENT note at the
 * target path (fresh-context review finding 1). Only a path whose
 * existing note derives the SAME id as the incoming save is treated as
 * an intentional update; everything else — including a target with no
 * derivable id at all (e.g. `session_log`, which declares none) — is a
 * collision and is refused, naming the conflicting path. Append/union
 * semantics for id-less types is a Phase 3 sync question, not solved
 * here (disclosed in apply-progress.md).
 */
async function detectPathConflict(
  vaultPath: string,
  notePath: string,
  type: string,
  def: NoteTypeDef,
  incomingFrontmatter: Record<string, unknown>,
): Promise<string | undefined> {
  const fileAbs = path.join(vaultPath, notePath);
  let raw: string;
  try {
    raw = await readFile(fileAbs, "utf8");
  } catch {
    return undefined; // nothing at the target path — a plain create, no conflict
  }

  const { frontmatter: existingFrontmatter } = parseNoteFile(raw);
  const existingId = deriveNoteId(type, existingFrontmatter, def);
  const incomingId = deriveNoteId(type, incomingFrontmatter, def);

  if (incomingId !== undefined && incomingId === existingId) {
    return undefined; // same note, re-saved — an intentional update
  }

  return (
    `save would overwrite a different note at "${notePath}" ` +
    `(existing id: ${existingId ?? "none"}, incoming id: ${incomingId ?? "none"}) — refusing to overwrite. ` +
    "Choose a naming template that disambiguates by id, or save to an explicit, distinct path."
  );
}

/** Deterministic path from the type's folder + naming template + a title slug. */
function resolvePath(
  folder: string,
  naming: string | undefined,
  frontmatter: Record<string, unknown>,
  title: string,
): string {
  const slug = slugify(title);
  const fileName = (naming ?? "{slug}.md").replace(/\{([A-Za-z0-9_]+)\}/g, (token, key: string) => {
    if (key === "slug") return slug;
    const value = frontmatter[key];
    return typeof value === "string" ? value : token;
  });
  const normalizedFolder = folder.endsWith("/") ? folder : `${folder}/`;
  return `${normalizedFolder}${fileName}`;
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toResult(payload: Record<string, unknown>): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function errorResult(message: string, extra: Record<string, unknown> = {}): CallToolResult {
  return {
    content: [{ type: "text", text: message }],
    structuredContent: { error: message, ...extra },
    isError: true,
  };
}
