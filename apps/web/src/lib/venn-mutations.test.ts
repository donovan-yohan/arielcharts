// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addVennStyle,
  addVennSubset,
  deleteVennStyle,
  deleteVennSubset,
  editVennStyle,
  editVennSubset,
  getVennDiagramSnapshot,
  getVennStyleIdentity,
  getVennSubsetIdentity,
  isVennSourceRepresentable,
  moveVennStyle,
  moveVennSubset,
  renameVennSet,
  resolveVennStyle,
  resolveVennSubset,
  type VennStyleIdentity,
  type VennSubsetIdentity,
} from './venn-mutations';

const SOURCE = `venn-beta
  set A["Audience"]: 10
  set B: 8
  set C: 6
  union A, B["Shared"]: 4
  union A, C: 3
  union B, C: 2
  union A, B, C: 2
  style A fill:#336699,stroke:#112233
  style A, B fill-opacity:0.5`;

function subsetIdentity(source: string, sets: readonly string[]): VennSubsetIdentity {
  const subsets = getVennDiagramSnapshot(source).subsets;
  const key = [...sets].sort().join(',');
  const subset = subsets.find((candidate) => [...candidate.sets].sort().join(',') === key);
  if (!subset) throw new Error(`Missing Venn subset ${sets.join(',')}.`);
  return getVennSubsetIdentity(subset, subsets);
}

function styleIdentity(source: string, sets: readonly string[]): VennStyleIdentity {
  const styles = getVennDiagramSnapshot(source).styles;
  const key = [...sets].sort().join(',');
  const style = styles.find((candidate) => [...candidate.sets].sort().join(',') === key);
  if (!style) throw new Error(`Missing Venn style ${sets.join(',')}.`);
  return getVennStyleIdentity(style, styles);
}

async function expectVenn(source: string): Promise<void> {
  await expect(mermaid.parse(source)).resolves.toMatchObject({ diagramType: 'venn' });
}

describe('Venn source mutations', () => {
  it('snapshots ordered base sets, intersections, labels, sizes, and structured styles', async () => {
    mermaid.initialize({ startOnLoad: false });
    expect(getVennDiagramSnapshot(SOURCE)).toEqual({
      styles: [
        {
          properties: [{ name: 'fill', value: '#336699' }, { name: 'stroke', value: '#112233' }],
          sets: ['A'],
        },
        { properties: [{ name: 'fill-opacity', value: '0.5' }], sets: ['A', 'B'] },
      ],
      subsets: [
        { authoredValue: 10, label: 'Audience', sets: ['A'], value: 10 },
        { authoredValue: 8, label: null, sets: ['B'], value: 8 },
        { authoredValue: 6, label: null, sets: ['C'], value: 6 },
        { authoredValue: 4, label: 'Shared', sets: ['A', 'B'], value: 4 },
        { authoredValue: 3, label: null, sets: ['A', 'C'], value: 3 },
        { authoredValue: 2, label: null, sets: ['B', 'C'], value: 2 },
        { authoredValue: 2, label: null, sets: ['A', 'B', 'C'], value: 2 },
      ],
    });
    expect(editVennSubset(SOURCE, subsetIdentity(SOURCE, ['A']), { label: 'Audience', value: 10 })).toBe(SOURCE);
    expect(renameVennSet(SOURCE, subsetIdentity(SOURCE, ['A']), 'A')).toBe(SOURCE);
    expect(editVennStyle(SOURCE, styleIdentity(SOURCE, ['A']), {
      properties: [{ name: 'fill', value: '#336699' }, { name: 'stroke', value: '#112233' }],
    })).toBe(SOURCE);
    await expectVenn(SOURCE);
  });

  it('adds, minimally edits, reorders, and deletes sets and intersections', async () => {
    mermaid.initialize({ startOnLoad: false });
    const addedSet = addVennSubset(SOURCE, { label: 'Delivery', sets: ['D'], value: 7 });
    expect(addedSet).toContain('  set D["Delivery"]: 7\n  union A, B');
    await expectVenn(addedSet);

    const addedUnion = addVennSubset(addedSet, { label: null, sets: ['B', 'D'], value: 3 });
    expect(addedUnion).toContain('  union B, D: 3\n  style A');
    await expectVenn(addedUnion);

    const edited = editVennSubset(addedUnion, subsetIdentity(addedUnion, ['B', 'D']), {
      label: 'Delivered together',
      value: 2.5,
    });
    expect(edited).toContain('union B, D["Delivered together"]: 2.5');
    await expectVenn(edited);

    const movedSet = moveVennSubset(edited, subsetIdentity(edited, ['D']), 'up');
    expect(getVennDiagramSnapshot(movedSet).subsets.filter((subset) => subset.sets.length === 1).map((subset) => subset.sets[0])).toEqual([
      'A',
      'B',
      'D',
      'C',
    ]);
    const movedUnion = moveVennSubset(movedSet, subsetIdentity(movedSet, ['B', 'D']), 'up');
    expect(getVennDiagramSnapshot(movedUnion).subsets.filter((subset) => subset.sets.length > 1).map((subset) => subset.sets)).toEqual([
      ['A', 'B'],
      ['A', 'C'],
      ['B', 'C'],
      ['B', 'D'],
      ['A', 'B', 'C'],
    ]);
    await expectVenn(movedUnion);

    const deletedUnion = deleteVennSubset(movedUnion, subsetIdentity(movedUnion, ['B', 'D']));
    const deletedSet = deleteVennSubset(deletedUnion, subsetIdentity(deletedUnion, ['D']));
    expect(getVennDiagramSnapshot(deletedSet).subsets).toEqual(getVennDiagramSnapshot(SOURCE).subsets);
    await expectVenn(deletedSet);
  });

  it('renames a set and every intersection/style reference atomically without touching comments', async () => {
    mermaid.initialize({ startOnLoad: false });
    const source = SOURCE.replace('  union A, B', '%% A is described here\n  union A, B');
    const renamed = renameVennSet(source, subsetIdentity(source, ['A']), 'Alpha');
    expect(renamed).toBe(source
      .replace('set A[', 'set Alpha[')
      .replaceAll('union A,', 'union Alpha,')
      .replaceAll('union A, B', 'union Alpha, B')
      .replace('style A fill', 'style Alpha fill')
      .replace('style A, B', 'style Alpha, B'));
    expect(renamed).toContain('%% A is described here');
    expect(getVennDiagramSnapshot(renamed).subsets.map((subset) => subset.sets)).toEqual([
      ['Alpha'],
      ['B'],
      ['C'],
      ['Alpha', 'B'],
      ['Alpha', 'C'],
      ['B', 'C'],
      ['Alpha', 'B', 'C'],
    ]);
    await expectVenn(renamed);

    const spaced = `venn-beta
  set   A["Alpha"]: 10
  set B: 8
  union  A ,  B: 4
  style   A , B fill:#fff`;
    const renamedSpaced = renameVennSet(spaced, subsetIdentity(spaced, ['A']), 'Audience');
    expect(renamedSpaced).toBe(`venn-beta
  set   Audience["Alpha"]: 10
  set B: 8
  union  Audience ,  B: 4
  style   Audience , B fill:#fff`);
    await expectVenn(renamedSpaced);
  });

  it('adds, edits, reorders, and deletes validated structured styles', async () => {
    mermaid.initialize({ startOnLoad: false });
    const added = addVennStyle(SOURCE, {
      properties: [{ name: 'fill', value: 'rgb(12,34,56)' }, { name: 'opacity', value: '0.75' }],
      sets: ['C'],
    });
    expect(added).toContain('style C fill:rgb(12,34,56),opacity:0.75');
    await expectVenn(added);
    const edited = editVennStyle(added, styleIdentity(added, ['C']), {
      properties: [{ name: 'fill', value: '#abcdef' }],
    });
    expect(edited).toContain('style C fill:#abcdef');
    const moved = moveVennStyle(edited, styleIdentity(edited, ['C']), 'up');
    expect(getVennDiagramSnapshot(moved).styles.map((style) => style.sets)).toEqual([
      ['A'],
      ['C'],
      ['A', 'B'],
    ]);
    expect(resolveVennStyle(moved, styleIdentity(moved, ['C']))).toEqual({
      properties: [{ name: 'fill', value: '#abcdef' }],
      sets: ['C'],
    });
    const deleted = deleteVennStyle(moved, styleIdentity(moved, ['C']));
    expect(getVennDiagramSnapshot(deleted).styles).toEqual(getVennDiagramSnapshot(SOURCE).styles);
    await expectVenn(deleted);
  });

  it('preserves BOM/metadata frontmatter/comments, physical endings, and final-newline policy', async () => {
    mermaid.initialize({ startOnLoad: false });
    const source = '\uFEFF---\rtitle: Sets\r---\r%% keep\rvenn-beta\r  set A: 10\r  set B: 8\r  union A, B: 4';
    const edited = editVennSubset(source, subsetIdentity(source, ['A', 'B']), { value: 3 });
    expect(edited).toBe(source.replace('union A, B: 4', 'union A, B: 3'));
    await expectVenn(edited);

    for (const ending of ['\n', '\r\n', '\r']) {
      const noFinal = `venn-beta${ending}  set A: 10`;
      const added = addVennSubset(noFinal, { label: null, sets: ['B'], value: 8 });
      expect(added).toBe(`${noFinal}${ending}  set B: 8`);
      expect(deleteVennSubset(added, subsetIdentity(added, ['B']))).toBe(noFinal);
      const withFinal = `${noFinal}${ending}`;
      expect(addVennSubset(withFinal, { label: null, sets: ['B'], value: 8 })).toBe(
        `${withFinal}  set B: 8${ending}`,
      );
      await expectVenn(added);
    }
    const mixed = 'venn-beta\r\n  set A: 10\r  set B: 8\n  set C: 6';
    const moved = moveVennSubset(mixed, subsetIdentity(mixed, ['C']), 'up');
    expect(moved).toBe('venn-beta\r\n  set A: 10\r  set C: 6\n  set B: 8');
    expect(moved.match(/\r\n|\n|\r/gu)).toEqual(mixed.match(/\r\n|\n|\r/gu));
    await expectVenn(moved);
  });

  it('keeps identities stable across unrelated prepends and rejects stale or ambiguous records', () => {
    const union = subsetIdentity(SOURCE, ['A', 'B']);
    const prepended = SOURCE.replace('  set A', '  set Remote: 12\n  set A');
    expect(resolveVennSubset(prepended, union)).toEqual({ authoredValue: 4, label: 'Shared', sets: ['A', 'B'], value: 4 });
    expect(editVennSubset(prepended, union, { value: 3 })).toContain('union A, B["Shared"]: 3');

    const replaced = SOURCE.replace('union A, B["Shared"]: 4', 'union A, B["Shared"]: 3');
    expect(() => resolveVennSubset(replaced, union)).toThrow('changed remotely');
    expect(() => editVennSubset(replaced, union, { value: 2 })).toThrow('changed remotely');
    expect(() => deleteVennSubset(replaced, union)).toThrow('changed remotely');
    expect(() => moveVennSubset(replaced, union, 'down')).toThrow('changed remotely');

    const ambiguous = getVennSubsetIdentity(
      { label: null, sets: ['A'], value: 1 },
      [{ label: null, sets: ['A'], value: 1 }, { label: null, sets: ['A'], value: 1 }],
    );
    expect(() => resolveVennSubset('venn-beta\n  set A: 1', ambiguous)).toThrow('changed remotely');
    expect(isVennSourceRepresentable('venn-beta\n  set A: 1\n  set A: 1')).toBe(false);
    expect(isVennSourceRepresentable('venn-beta\n  set A: 5\n  set B: 5\n  union A, B: 2\n  union B, A: 2')).toBe(false);
  });

  it('fails closed for unknown dependencies, impossible subset sizes, dangling styles, and advanced syntax', async () => {
    mermaid.initialize({ startOnLoad: false });
    expect(() => addVennSubset(SOURCE, { label: null, sets: ['A', 'Missing'], value: 1 })).toThrow('unknown set');
    expect(() => editVennSubset(SOURCE, subsetIdentity(SOURCE, ['A', 'B']), { value: 11 })).toThrow('cannot exceed');
    expect(() => deleteVennSubset(SOURCE, subsetIdentity(SOURCE, ['A']))).toThrow('intersections depend');
    expect(() => deleteVennSubset(SOURCE, subsetIdentity(SOURCE, ['A', 'B']))).toThrow('style depends');
    expect(() => addVennStyle(SOURCE, { properties: [{ name: 'fill', value: '#fff' }], sets: ['A', 'D'] })).toThrow('existing declared subset');
    expect(() => addVennStyle(SOURCE, { properties: [{ name: 'position', value: 'fixed' }], sets: ['B'] })).toThrow('not in the safe subset');
    expect(() => addVennStyle(SOURCE, { properties: [{ name: 'opacity', value: '2' }], sets: ['B'] })).toThrow('between zero and one');
    expect(() => addVennStyle(SOURCE, { properties: [{ name: 'fill', value: 'rgb(999,0,0)' }], sets: ['B'] })).toThrow('safe Mermaid color');
    expect(() => renameVennSet(SOURCE, subsetIdentity(SOURCE, ['A']), 'B')).toThrow('already exists');
    expect(() => addVennSubset(SOURCE, { label: null, sets: ['D'], value: -1 })).toThrow(
      'Venn base set values must be finite numbers greater than zero.',
    );
    expect(() => addVennSubset(SOURCE, { label: null, sets: ['D'], value: 0 })).toThrow(
      'Venn base set values must be finite numbers greater than zero.',
    );
    expect(() => addVennSubset(SOURCE, { label: null, sets: ['D'], value: Number.POSITIVE_INFINITY })).toThrow(
      'Venn base set values must be finite numbers greater than zero.',
    );
    expect(() => addVennSubset(SOURCE, { label: null, sets: ['A', 'B'], value: -1 })).toThrow(
      'Venn subset values must be finite numbers greater than or equal to zero.',
    );

    for (const source of [
      'venn-beta\n  union A, B: 1',
      'venn-beta\n  set A: 1\n  union A, Missing: 1',
      'venn-beta\n  set A: 1\n  set B: 1\n  union A, B: 2',
      'venn-beta\n  set A: -1',
      'venn-beta\n  set A: 0',
      'venn-beta\n  union A: 1',
      'venn-beta\n  title Advanced\n  set A: 1',
      'venn-beta\n  set A: 1\n  text A [label]',
      'venn-beta\n  set A: 1\n  style A filter:blur',
      'Venn-beta\n  set A: 1',
      '---\ntitle: ,bad\n---\nvenn-beta\n  set A: 1',
      '%%{init: {theme: neutral}}%%\nvenn-beta\n  set A: 1',
      '%%{init: {"theme":"neutral"}}%%\nvenn-beta\n  set A: 1',
      '---\nconfig:\n  theme: neutral\n---\nvenn-beta\n  set A: 1',
    ]) {
      expect(isVennSourceRepresentable(source), source).toBe(false);
    }
    await expectVenn('venn-beta\n  title Advanced\n  set A: 1');
    await expectVenn('venn-beta\n  set A: 1\n  text A [label]');
  });

  it('pins omitted Mermaid defaults, materializes only explicit value edits, and rejects incomplete higher-order lattices', async () => {
    mermaid.initialize({ startOnLoad: false });
    const omitted = `venn-beta
  set A
  set B
  union A, B`;
    expect(getVennDiagramSnapshot(omitted).subsets).toEqual([
      { authoredValue: null, label: null, sets: ['A'], value: 10 },
      { authoredValue: null, label: null, sets: ['B'], value: 10 },
      { authoredValue: null, label: null, sets: ['A', 'B'], value: 2.5 },
    ]);
    const union = subsetIdentity(omitted, ['A', 'B']);
    expect(editVennSubset(omitted, union, { label: 'Default overlap' })).toBe(
      omitted.replace('union A, B', 'union A, B["Default overlap"]'),
    );
    expect(editVennSubset(omitted, union, { value: 3 })).toBe(
      omitted.replace('union A, B', 'union A, B: 3'),
    );
    await expectVenn(omitted);
    await expectVenn(addVennSubset('venn-beta\n  set A', { authoredValue: null, label: null, sets: ['B'], value: 10 }));

    expect(isVennSourceRepresentable(`venn-beta
  set A: 10
  set B: 10
  set C: 10
  union A, B: 2
  union A, B, C: 1`)).toBe(false);
    expect(isVennSourceRepresentable(`venn-beta
  set A: 10
  set B: 10
  set C: 10
  union A, B: 2
  union A, C: 2
  union B, C: 0
  union A, B, C: 1`)).toBe(false);
    expect(isVennSourceRepresentable(`venn-beta
  set A: 10
  set B: 10
  set C: 10
  union A, B: 2
  union A, C: 2
  union B, C: 2
  union A, B, C: 1`)).toBe(true);
    expect(isVennSourceRepresentable('venn-beta\n  set A: 10\n  set B: 10\n  union A, B: 0')).toBe(true);
    const omittedSet = 'venn-beta\n  set A';
    const omittedIdentity = subsetIdentity(omittedSet, ['A']);
    expect(() => resolveVennSubset('venn-beta\n  set A: 10', omittedIdentity)).toThrow('changed remotely');
  });
});
