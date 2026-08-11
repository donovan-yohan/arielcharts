import { describe, expect, it } from 'vitest';
import { reconcileHierarchicalSemanticRenderIdentities } from './semantic-render-identities';

type Node = { ancestors: string[]; label: string; value: number | null };

const options = {
  fingerprint: (node: Node) => JSON.stringify([node.label, node.value]),
  path: (node: Node) => [...node.ancestors, node.label],
  prefix: 'tree',
};

describe('hierarchical semantic render identities', () => {
  it('keeps every descendant mounted through an ancestor rename', () => {
    const before: Node[] = [
      { ancestors: [], label: 'Root', value: null },
      { ancestors: ['Root'], label: 'P', value: null },
      { ancestors: ['Root', 'P'], label: 'A', value: 1 },
      { ancestors: ['Root', 'P'], label: 'B', value: 2 },
    ];
    const previous = reconcileHierarchicalSemanticRenderIdentities(null, before, options);
    const after: Node[] = [
      { ancestors: [], label: 'Root', value: null },
      { ancestors: ['Root'], label: 'X', value: null },
      { ancestors: ['Root', 'X'], label: 'A', value: 1 },
      { ancestors: ['Root', 'X'], label: 'B', value: 2 },
    ];
    const next = reconcileHierarchicalSemanticRenderIdentities(previous, after, options);

    expect(next.entries.map((entry) => entry.renderKey)).toEqual(
      previous.entries.map((entry) => entry.renderKey),
    );
  });

  it('does not confuse delimiter-bearing labels with nested paths', () => {
    const before: Node[] = [
      { ancestors: [], label: 'Root', value: null },
      { ancestors: ['Root'], label: 'A / B', value: 1 },
      { ancestors: ['Root'], label: 'A', value: null },
      { ancestors: ['Root', 'A'], label: 'B', value: 2 },
    ];
    const previous = reconcileHierarchicalSemanticRenderIdentities(null, before, options);
    const after = [before[0]!, before[2]!, before[3]!, before[1]!];
    const next = reconcileHierarchicalSemanticRenderIdentities(previous, after, options);

    expect(next.entries[2]!.renderKey).toBe(previous.entries[3]!.renderKey);
    expect(next.entries[3]!.renderKey).toBe(previous.entries[1]!.renderKey);
  });
});
