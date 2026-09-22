import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { renderTemplate } from "../../src/rules/templates.js";
import { FIXTURE_VAULT_DIR } from "../helpers/create-test-vault.js";

// Task 1.10 [RED first]: {{placeholder}} renderer — pure string
// interpolation only (rules-parsing spec).
const decisionTemplate = await readFile(
  path.join(FIXTURE_VAULT_DIR, ".memory", "templates", "decision.md"),
  "utf8",
);

describe("renderTemplate", () => {
  it("renders the decision template with all supplied values", () => {
    const rendered = renderTemplate(decisionTemplate, {
      next_id: "0042",
      spec_id: "SPEC-search",
      today: "2025-06-01",
      author: "Raul",
      title: "FTS5 instead of embeddings",
    });
    expect(rendered).toContain("decision_id: DEC-0042");
    expect(rendered).toContain("spec_id: SPEC-search");
    expect(rendered).toContain("date: 2025-06-01");
    expect(rendered).toContain("author: Raul");
    expect(rendered).toContain("# FTS5 instead of embeddings");
    // no token for a supplied key remains
    expect(rendered).not.toMatch(/\{\{(next_id|spec_id|today|author|title)\}\}/);
  });

  it("performs interpolation only: prose and markdown pass through unchanged", () => {
    const template = "Plain prose with *markdown* and [links](http://x).\n";
    expect(renderTemplate(template, { key: "value" })).toBe(template);
  });

  it("does not interpret conditionals, loops, or lookups", () => {
    const template = "{{#if title}}show{{/if}}\n{{#each items}}x{{/each}}\n{{ lookup.deep.path }}\n";
    const rendered = renderTemplate(template, { title: "T" });
    // Non-placeholder syntax must survive verbatim — there is no engine.
    expect(rendered).toContain("{{#if title}}show{{/if}}");
    expect(rendered).toContain("{{#each items}}x{{/each}}");
    expect(rendered).toContain("{{ lookup.deep.path }}");
  });

  it("leaves tokens for unsupplied keys untouched", () => {
    const rendered = renderTemplate("id: {{next_id}}\n", {});
    expect(rendered).toBe("id: {{next_id}}\n");
  });

  it("replaces repeated occurrences of the same placeholder", () => {
    const rendered = renderTemplate("{{today}} and {{today}}", {
      today: "2025-06-01",
    });
    expect(rendered).toBe("2025-06-01 and 2025-06-01");
  });

  it("renders empty-string values (key supplied => token gone)", () => {
    const rendered = renderTemplate("title: {{title}}|", { title: "" });
    expect(rendered).toBe("title: |");
  });
});
