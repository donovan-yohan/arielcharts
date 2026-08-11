export interface SemanticRenderEntry<T> { record: T; renderKey: string; }
export interface SemanticRenderIdentityState<T> { entries: SemanticRenderEntry<T>[]; nextId: number; }

interface HierarchyRecord<T> {
  children: HierarchyRecord<T>[];
  index: number;
  record: T;
}

/**
 * Retains a mounted form only when its source record can be matched without
 * guessing. A unique unchanged fingerprint is an anchor; a single record in
 * an anchored gap is the safe remote-rename case. Duplicates always remount.
 */
export function reconcileSemanticRenderIdentities<T>(
  previous: SemanticRenderIdentityState<T> | null,
  records: readonly T[],
  { fingerprint, prefix }: { fingerprint: (record: T) => string; prefix: string },
): SemanticRenderIdentityState<T> {
  if (!previous) return { entries: records.map((record, index) => ({ record, renderKey: `${prefix}:${index}` })), nextId: records.length };
  const buckets = (items: readonly T[]) => items.reduce((result, record, index) => {
    const key = fingerprint(record); result.set(key, [...(result.get(key) ?? []), index]); return result;
  }, new Map<string, number[]>());
  const oldRecords = previous.entries.map((entry) => entry.record);
  const oldBuckets = buckets(oldRecords); const nextBuckets = buckets(records);
  const matched = new Map<number, number>(); const used = new Set<number>(); const ambiguousOld = new Set<number>(); const ambiguousNext = new Set<number>();
  for (const indices of nextBuckets.values()) if (indices.length > 1) indices.forEach((index) => ambiguousNext.add(index));
  for (const [key, oldIndices] of oldBuckets) {
    const nextIndices = nextBuckets.get(key) ?? [];
    if (oldIndices.length > 1 || nextIndices.length > 1) { oldIndices.forEach((index) => ambiguousOld.add(index)); nextIndices.forEach((index) => ambiguousNext.add(index)); continue; }
    if (nextIndices.length === 1) { matched.set(nextIndices[0]!, oldIndices[0]!); used.add(oldIndices[0]!); }
  }
  const anchors = [...matched.entries()].map(([nextIndex, oldIndex]) => ({ nextIndex, oldIndex })).sort((a, b) => a.oldIndex - b.oldIndex).reduce<Array<{ nextIndex: number; oldIndex: number }>>((result, candidate) => !result.length || candidate.nextIndex > result.at(-1)!.nextIndex ? [...result, candidate] : result, []);
  const boundaries = [{ nextIndex: -1, oldIndex: -1 }, ...anchors, { nextIndex: records.length, oldIndex: oldRecords.length }];
  for (let boundary = 1; boundary < boundaries.length; boundary += 1) {
    const before = boundaries[boundary - 1]!; const after = boundaries[boundary]!;
    const oldRun = oldRecords.map((_, index) => index).filter((index) => index > before.oldIndex && index < after.oldIndex && !used.has(index) && !ambiguousOld.has(index));
    const nextRun = records.map((_, index) => index).filter((index) => index > before.nextIndex && index < after.nextIndex && !matched.has(index) && !ambiguousNext.has(index));
    if (oldRun.length === 1 && nextRun.length === 1) { matched.set(nextRun[0]!, oldRun[0]!); used.add(oldRun[0]!); }
  }
  const remainingOld = oldRecords.map((_, index) => index).filter((index) => !used.has(index) && !ambiguousOld.has(index));
  const remainingNext = records.map((_, index) => index).filter((index) => !matched.has(index) && !ambiguousNext.has(index));
  if (remainingOld.length === 1 && remainingNext.length === 1) matched.set(remainingNext[0]!, remainingOld[0]!);
  let nextId = previous.nextId;
  return { entries: records.map((record, index) => {
    const oldIndex = matched.get(index); if (oldIndex !== undefined) return { record, renderKey: previous.entries[oldIndex]!.renderKey };
    const renderKey = `${prefix}:${nextId}`; nextId += 1; return { record, renderKey };
  }), nextId };
}

/**
 * Reconciles preorder tree records one sibling group at a time. This keeps a
 * whole subtree mounted when an ancestor is renamed without transferring a
 * draft between same-looking records in different branches.
 */
export function reconcileHierarchicalSemanticRenderIdentities<T>(
  previous: SemanticRenderIdentityState<T> | null,
  records: readonly T[],
  {
    fingerprint,
    path,
    prefix,
  }: {
    fingerprint: (record: T) => string;
    path: (record: T) => readonly string[];
    prefix: string;
  },
): SemanticRenderIdentityState<T> {
  if (!previous) {
    return {
      entries: records.map((record, index) => ({ record, renderKey: `${prefix}:${index}` })),
      nextId: records.length,
    };
  }

  const buildForest = (items: readonly T[]): HierarchyRecord<T>[] => {
    const byPath = new Map<string, HierarchyRecord<T>>();
    const roots: HierarchyRecord<T>[] = [];
    items.forEach((record, index) => {
      const segments = [...path(record)];
      const entry = { children: [], index, record };
      byPath.set(JSON.stringify(segments), entry);
      const parent = segments.length > 1
        ? byPath.get(JSON.stringify(segments.slice(0, -1)))
        : undefined;
      if (parent) parent.children.push(entry);
      else roots.push(entry);
    });
    return roots;
  };

  const previousRoots = buildForest(previous.entries.map((entry) => entry.record));
  const nextRoots = buildForest(records);
  const matched = new Map<number, number>();

  const reconcileSiblings = (
    oldSiblings: readonly HierarchyRecord<T>[],
    nextSiblings: readonly HierarchyRecord<T>[],
  ) => {
    const siblingState: SemanticRenderIdentityState<HierarchyRecord<T>> = {
      entries: oldSiblings.map((entry) => ({
        record: entry,
        renderKey: previous.entries[entry.index]!.renderKey,
      })),
      nextId: previous.nextId,
    };
    const reconciled = reconcileSemanticRenderIdentities(siblingState, nextSiblings, {
      fingerprint: (entry) => fingerprint(entry.record),
      prefix,
    });
    const oldByKey = new Map(siblingState.entries.map((entry) => [entry.renderKey, entry.record]));
    reconciled.entries.forEach((entry) => {
      const old = oldByKey.get(entry.renderKey);
      if (!old) return;
      matched.set(entry.record.index, old.index);
      reconcileSiblings(old.children, entry.record.children);
    });
  };

  reconcileSiblings(previousRoots, nextRoots);
  let nextId = previous.nextId;
  return {
    entries: records.map((record, index) => {
      const oldIndex = matched.get(index);
      if (oldIndex !== undefined) {
        return { record, renderKey: previous.entries[oldIndex]!.renderKey };
      }
      const renderKey = `${prefix}:${nextId}`;
      nextId += 1;
      return { record, renderKey };
    }),
    nextId,
  };
}
