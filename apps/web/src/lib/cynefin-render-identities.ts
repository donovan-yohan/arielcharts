import type { CynefinItem, CynefinTransition } from './cynefin-mutations';

export interface CynefinRenderEntry<T> {
  record: T;
  renderKey: string;
}

export interface CynefinRenderIdentityState<T> {
  entries: CynefinRenderEntry<T>[];
  nextId: number;
}

interface ReconciliationOptions<T> {
  fingerprint: (record: T) => string;
  prefix: string;
}

function bucketIndices<T>(records: readonly T[], fingerprint: (record: T) => string): Map<string, number[]> {
  const buckets = new Map<string, number[]>();
  records.forEach((record, index) => {
    const key = fingerprint(record);
    buckets.set(key, [...(buckets.get(key) ?? []), index]);
  });
  return buckets;
}

function reconcileRenderIdentityState<T>(
  previous: CynefinRenderIdentityState<T> | null,
  records: readonly T[],
  options: ReconciliationOptions<T>,
): CynefinRenderIdentityState<T> {
  if (!previous) {
    return {
      entries: records.map((record, index) => ({ record, renderKey: `${options.prefix}:${index}` })),
      nextId: records.length,
    };
  }

  const previousRecords = previous.entries.map((entry) => entry.record);
  const previousBuckets = bucketIndices(previousRecords, options.fingerprint);
  const nextBuckets = bucketIndices(records, options.fingerprint);
  const previousMatchByNext = new Map<number, number>();
  const matchedPrevious = new Set<number>();
  const ambiguousPrevious = new Set<number>();
  const ambiguousNext = new Set<number>();

  for (const indices of nextBuckets.values()) {
    if (indices.length > 1) indices.forEach((index) => ambiguousNext.add(index));
  }

  for (const [fingerprint, previousIndices] of previousBuckets) {
    const nextIndices = nextBuckets.get(fingerprint) ?? [];
    if (previousIndices.length > 1 || nextIndices.length > 1) {
      previousIndices.forEach((index) => ambiguousPrevious.add(index));
      nextIndices.forEach((index) => ambiguousNext.add(index));
      continue;
    }
    if (previousIndices.length === 1 && nextIndices.length === 1) {
      previousMatchByNext.set(nextIndices[0]!, previousIndices[0]!);
      matchedPrevious.add(previousIndices[0]!);
    }
  }

  const orderedAnchors = [...previousMatchByNext.entries()]
    .map(([nextIndex, previousIndex]) => ({ nextIndex, previousIndex }))
    .sort((left, right) => left.previousIndex - right.previousIndex)
    .reduce<Array<{ nextIndex: number; previousIndex: number }>>((anchors, candidate) => {
      const last = anchors.at(-1);
      if (!last || candidate.nextIndex > last.nextIndex) anchors.push(candidate);
      return anchors;
    }, []);
  const boundaries = [
    { nextIndex: -1, previousIndex: -1 },
    ...orderedAnchors,
    { nextIndex: records.length, previousIndex: previousRecords.length },
  ];

  for (let boundaryIndex = 1; boundaryIndex < boundaries.length; boundaryIndex += 1) {
    const before = boundaries[boundaryIndex - 1]!;
    const after = boundaries[boundaryIndex]!;
    const previousRun = previousRecords
      .map((_, index) => index)
      .filter((index) => index > before.previousIndex
        && index < after.previousIndex
        && !matchedPrevious.has(index)
        && !ambiguousPrevious.has(index));
    const nextRun = records
      .map((_, index) => index)
      .filter((index) => index > before.nextIndex
        && index < after.nextIndex
        && !previousMatchByNext.has(index)
        && !ambiguousNext.has(index));
    if (previousRun.length !== 1 || nextRun.length !== 1) continue;
    previousMatchByNext.set(nextRun[0]!, previousRun[0]!);
    matchedPrevious.add(previousRun[0]!);
  }

  const remainingPrevious = previousRecords
    .map((_, index) => index)
    .filter((index) => !matchedPrevious.has(index) && !ambiguousPrevious.has(index));
  const remainingNext = records
    .map((_, index) => index)
    .filter((index) => !previousMatchByNext.has(index) && !ambiguousNext.has(index));
  if (remainingPrevious.length === 1 && remainingNext.length === 1) {
    previousMatchByNext.set(remainingNext[0]!, remainingPrevious[0]!);
  }

  let nextId = previous.nextId;
  return {
    entries: records.map((record, index) => {
      const previousIndex = previousMatchByNext.get(index);
      if (previousIndex !== undefined) {
        return { record, renderKey: previous.entries[previousIndex]!.renderKey };
      }
      const renderKey = `${options.prefix}:${nextId}`;
      nextId += 1;
      return { record, renderKey };
    }),
    nextId,
  };
}

const itemOptions: ReconciliationOptions<CynefinItem> = {
  fingerprint: (item) => JSON.stringify([item.domain, item.label]),
  prefix: 'cynefin-item-render',
};

const transitionOptions: ReconciliationOptions<CynefinTransition> = {
  fingerprint: (transition) => JSON.stringify([transition.from, transition.to, transition.label ?? null]),
  prefix: 'cynefin-transition-render',
};

export function reconcileCynefinItemRenderIdentities(
  previous: CynefinRenderIdentityState<CynefinItem> | null,
  items: readonly CynefinItem[],
): CynefinRenderIdentityState<CynefinItem> {
  return reconcileRenderIdentityState(previous, items, itemOptions);
}

export function reconcileCynefinTransitionRenderIdentities(
  previous: CynefinRenderIdentityState<CynefinTransition> | null,
  transitions: readonly CynefinTransition[],
): CynefinRenderIdentityState<CynefinTransition> {
  return reconcileRenderIdentityState(previous, transitions, transitionOptions);
}
