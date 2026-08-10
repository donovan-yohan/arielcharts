export type CanonicalDraft = object;

/**
 * Reconciles a form's local edits with the latest source-derived record. A
 * field being edited locally wins; every other field remains canonical.
 */
export function reconcileCanonicalDraft<T extends CanonicalDraft>(
  canonical: T,
  draft: T,
  dirtyFields: ReadonlySet<keyof T>,
): T {
  const next = { ...canonical } as T;
  for (const field of dirtyFields) {
    next[field] = draft[field];
  }
  return next;
}

export function getDirtyDraftFields<T extends CanonicalDraft>(
  draft: T,
  canonical: T,
): Set<keyof T> {
  const fields = new Set<keyof T>();
  for (const field of new Set<keyof T>([
    ...(Object.keys(draft) as (keyof T)[]),
    ...(Object.keys(canonical) as (keyof T)[]),
  ])) {
    if (!Object.is(draft[field], canonical[field])) fields.add(field);
  }
  return fields;
}

export function sameCanonicalDraft<T extends CanonicalDraft>(left: T, right: T): boolean {
  const fields = new Set<keyof T>([
    ...(Object.keys(left) as (keyof T)[]),
    ...(Object.keys(right) as (keyof T)[]),
  ]);
  return [...fields].every((field) => Object.is(left[field], right[field]));
}
