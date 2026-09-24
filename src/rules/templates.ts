/**
 * `{{placeholder}}` template renderer (rules-parsing spec / RFC §4.3).
 *
 * Pure string interpolation ONLY: supplied keys are substituted, prose
 * passes through unchanged, and no logic, conditionals, loops, or
 * external lookups are ever interpreted. Tokens for unsupplied keys
 * remain untouched (e.g. `{{next_id}}` resolved later by the caller).
 */

export function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template.replace(
    /\{\{([A-Za-z0-9_]+)\}\}/g,
    (token: string, key: string): string =>
      Object.hasOwn(values, key) ? (values[key] ?? "") : token,
  );
}
