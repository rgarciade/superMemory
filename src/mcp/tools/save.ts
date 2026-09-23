import { readFile } from "node:fs/promises";
import path from "node:path";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { getNoteById } from "../../index/queries.js";
import type { IndexStore } from "../../index/store.js";
import { deriveNoteId, deriveTitle, parseNoteFile } from "../../notes/parse.js";
import { saveNote, type SyncPort } from "../../notes/save-pipeline.js";
import type { NoteTypeDef, RulesModel } from "../../rules/types.js";
import type { Clock } from "../../util/clock.js";

/**
 * `save` — thin: schema check -> validateNote (via `notes/save-pipeline`,
 * violation returned verbatim) -> save-pipeline (tool-catalog spec: "save —
 * validated create and update"). No separate validateNote call here:
 * save-pipeline already performs it (design 5.3/2.8) — a second call here
 * would be pure duplication against the same rules and frontmatter.
 *
 * Two schema layers, not one (fresh-context review finding 4): the SDK
 * enforces `catalog.ts`'s WIRE schema before this handler runs, but that
 * schema is a single flat object merging every declared type's fields
 * (a documented SDK limitation — see catalog.ts), so it cannot reject a
 * field that belongs to a DIFFERENT type. This handler re-parses `args`
 * through `catalog.saveSchemas[type]` — the true, per-type `.strict()`
 * schema — before doing anything else, so a `decision` save can never
 * carry `incident`/`session_log` fields into the written frontmatter.
 */

export interface SaveDeps {
  vaultPath: string;
  rules: RulesModel;
  store: IndexStore;
  clock: Clock;
  syncPort: SyncPort;
  /** Provenance recorded on the write event (e.g. "mcp:claude", "cli"). */
  via: string;
  /** `catalog.saveSchemas` — the true per-type schemas (catalog.ts §wire-schema note). */
  saveSchemas: Record<string, z.ZodObject<z.ZodRawShape>>;
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

    const schema = deps.saveSchemas[type];
    if (!schema) {
      return errorResult(`no save schema declared for type "${type}"`);
    }
    const parsed = schema.safeParse(args);
    if (!parsed.success) {
      return errorResult(formatZodError(parsed.error), { issues: toSaveIssues(parsed.error) });
    }

    const { type: _type, content: rawContent, title: titleArg, ...frontmatter } =
      parsed.data as Record<string, unknown>;
    const content = typeof rawContent === "string" ? rawContent : "";
    const titleValue = typeof titleArg === "string" ? titleArg : undefined;

    const incomingId = deriveNoteId(type, frontmatter, def);
    // A note's identity is its id (design decision, second re-review —
    // see apply-progress.md): if this id already lives in the index,
    // look it up BEFORE computing the new path, so a title change (a
    // different derived path under the same id) is recognized as a MOVE
    // rather than colliding with — or silently orphaning — itself.
    const existingNote = incomingId !== undefined ? getNoteById(deps.store, incomingId) : undefined;

    const title = deriveTitle(content, titleValue !== undefined ? { title: titleValue } : {}, "untitled.md");
    const resolved = resolvePath(def.folder, def.naming, frontmatter, title, incomingId);
    if ("error" in resolved) return errorResult(resolved.error);
    const notePath = resolved.path;

    // A naming template that doesn't fully disambiguate (no template at
    // all, or one that doesn't reference every id-bearing field) can
    // collide two different notes onto the same path. Never silently
    // overwrite a note that isn't the one being saved: if the target
    // already exists, its derived id must match the incoming id exactly.
    const conflict = await detectPathConflict(deps.vaultPath, notePath, type, def, incomingId);
    if (conflict) return errorResult(conflict, { path: notePath });

    const previousPath =
      existingNote !== undefined && existingNote.path !== notePath ? existingNote.path : undefined;

    const result = await saveNote(
      { store: deps.store, clock: deps.clock, syncPort: deps.syncPort },
      {
        vaultPath: deps.vaultPath,
        rules: deps.rules,
        type,
        path: notePath,
        ...(previousPath !== undefined ? { previousPath } : {}),
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
  incomingId: string | undefined,
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

  if (incomingId !== undefined && incomingId === existingId) {
    return undefined; // same note, re-saved — an intentional update
  }

  return (
    `save would overwrite a different note at "${notePath}" ` +
    `(existing id: ${existingId ?? "none"}, incoming id: ${incomingId ?? "none"}) — refusing to overwrite. ` +
    "Choose a naming template that disambiguates by id, or save to an explicit, distinct path."
  );
}

/**
 * Deterministic path from the type's folder + naming template + a title
 * slug. `slugify` strips all non-ASCII, so a non-ASCII-only title (e.g.
 * CJK) can produce an empty slug — falls back to a slugified id when the
 * title's own slug is empty; if BOTH are empty, refuses rather than ever
 * writing a hidden dotfile like `folder/.md` (fresh-context review
 * finding 7).
 */
function resolvePath(
  folder: string,
  naming: string | undefined,
  frontmatter: Record<string, unknown>,
  title: string,
  fallbackId: string | undefined,
): { path: string } | { error: string } {
  const titleSlug = slugify(title);
  const slug = titleSlug !== "" ? titleSlug : slugify(fallbackId ?? "");
  if (slug === "") {
    return {
      error:
        "could not derive a safe file name: the title produced an empty slug " +
        "(e.g. non-ASCII-only text) and no id is available to fall back on — " +
        "provide an ASCII title, or an id field the note type declares",
    };
  }

  const fileName = (naming ?? "{slug}.md").replace(/\{([A-Za-z0-9_]+)\}/g, (token, key: string) => {
    if (key === "slug") return slug;
    const value = frontmatter[key];
    return typeof value === "string" ? value : token;
  });
  const normalizedFolder = folder.endsWith("/") ? folder : `${folder}/`;
  return { path: `${normalizedFolder}${fileName}` };
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}

/**
 * Normalizes zod issues to the same `{ field, message }` shape
 * save-pipeline's `ValidationIssue[]` already exposes (rules/validate.ts),
 * so callers see one consistent issues contract regardless of which
 * validation layer caught the problem.
 */
function toSaveIssues(error: z.ZodError): Array<{ field?: string; message: string }> {
  return error.issues.map((issue) => ({
    ...(issue.path.length > 0 ? { field: issue.path.join(".") } : {}),
    message: issue.message,
  }));
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
