// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addTreemapNode,
  deleteTreemapNode,
  editTreemapNode,
  getTreemapDiagramSnapshot,
  getTreemapNodeIdentity,
  isTreemapSourceRepresentable,
  moveTreemapNode,
  reparentTreemapNode,
  resolveTreemapNode,
  type TreemapNodeIdentity,
} from './treemap-mutations';

const SOURCE = `treemap-beta
  "Portfolio"
    "Product"
      "Build": 4
      "Ship": 2
    "Support"
      "Operate": 3`;

function identity(source: string, label: string): TreemapNodeIdentity {
  const nodes = getTreemapDiagramSnapshot(source).nodes;
  const node = nodes.find((candidate) => candidate.label === label);
  if (!node) throw new Error(`Missing Treemap node ${label}.`);
  return getTreemapNodeIdentity(node, nodes);
}

async function expectTreemap(source: string): Promise<void> {
  await expect(mermaid.parse(source)).resolves.toMatchObject({ diagramType: 'treemap' });
}

describe('Treemap source mutations', () => {
  it('snapshots one rooted hierarchy with positive leaf values', async () => {
    mermaid.initialize({ startOnLoad: false });
    expect(getTreemapDiagramSnapshot(SOURCE)).toEqual({
      nodes: [
        { ancestorLabels: [], label: 'Portfolio', value: null },
        { ancestorLabels: ['Portfolio'], label: 'Product', value: null },
        { ancestorLabels: ['Portfolio', 'Product'], label: 'Build', value: 4 },
        { ancestorLabels: ['Portfolio', 'Product'], label: 'Ship', value: 2 },
        { ancestorLabels: ['Portfolio'], label: 'Support', value: null },
        { ancestorLabels: ['Portfolio', 'Support'], label: 'Operate', value: 3 },
      ],
    });
    expect(editTreemapNode(SOURCE, identity(SOURCE, 'Build'), { label: 'Build', value: 4 })).toBe(SOURCE);
    expect(moveTreemapNode(SOURCE, identity(SOURCE, 'Portfolio'), 'up')).toBe(SOURCE);
    await expectTreemap(SOURCE);
  });

  it('adds, minimally edits, deletes, reorders, and reparents whole subtrees', async () => {
    mermaid.initialize({ startOnLoad: false });
    const added = addTreemapNode(SOURCE, { label: 'Learn', value: 1.5 }, identity(SOURCE, 'Product'));
    expect(added).toContain('      "Learn": 1.5\n    "Support"');
    await expectTreemap(added);

    const edited = editTreemapNode(added, identity(added, 'Learn'), { label: "Learn 'fast'", value: 2.25 });
    expect(edited.replace('"Learn \'fast\'": 2.25', '"Learn": 1.5')).toBe(added);
    await expectTreemap(edited);

    const moved = moveTreemapNode(edited, identity(edited, "Learn 'fast'"), 'up');
    expect(getTreemapDiagramSnapshot(moved).nodes.filter((node) => node.ancestorLabels.at(-1) === 'Product').map((node) => node.label)).toEqual([
      'Build',
      "Learn 'fast'",
      'Ship',
    ]);
    await expectTreemap(moved);

    const reparented = reparentTreemapNode(moved, identity(moved, 'Product'), identity(moved, 'Support'));
    expect(getTreemapDiagramSnapshot(reparented).nodes.find((node) => node.label === 'Product')?.ancestorLabels).toEqual([
      'Portfolio',
      'Support',
    ]);
    expect(getTreemapDiagramSnapshot(reparented).nodes.find((node) => node.label === 'Build')?.ancestorLabels).toEqual([
      'Portfolio',
      'Support',
      'Product',
    ]);
    await expectTreemap(reparented);

    const deleted = deleteTreemapNode(reparented, identity(reparented, 'Product'));
    expect(getTreemapDiagramSnapshot(deleted).nodes.map((node) => node.label)).toEqual([
      'Portfolio',
      'Support',
      'Operate',
    ]);
    await expectTreemap(deleted);

    const fromBlank = addTreemapNode('', { label: 'Root', value: 1 });
    expect(fromBlank).toBe('treemap-beta\n  "Root": 1');
    await expectTreemap(fromBlank);
  });

  it('preserves BOM, safe metadata frontmatter, comments, EOL slots, and final-newline policy', async () => {
    mermaid.initialize({ startOnLoad: false });
    const source = '\uFEFF---\rtitle: Delivery\r---\r%% keep\rtreemap-beta\r  "Root"\r    "A": 1';
    const added = addTreemapNode(source, { label: 'B', value: 2 }, identity(source, 'Root'));
    expect(added).toBe(`${source}\r    "B": 2`);
    const moved = moveTreemapNode(added, identity(added, 'B'), 'up');
    expect(moved).toContain('%% keep\rtreemap-beta');
    expect(moved).toContain('    "B": 2\r    "A": 1');
    await expectTreemap(moved);

    for (const ending of ['\n', '\r\n', '\r']) {
      const noFinal = `treemap-beta${ending}  "Root"${ending}    "A": 1`;
      const next = addTreemapNode(noFinal, { label: 'B', value: 2 }, identity(noFinal, 'Root'));
      expect(next).toBe(`${noFinal}${ending}    "B": 2`);
      expect(deleteTreemapNode(next, identity(next, 'B'))).toBe(noFinal);
      const withFinal = `${noFinal}${ending}`;
      expect(addTreemapNode(withFinal, { label: 'B', value: 2 }, identity(withFinal, 'Root'))).toBe(
        `${withFinal}    "B": 2${ending}`,
      );
      await expectTreemap(next);
    }
    const mixed = 'treemap-beta\r\n  "Root"\r    "A": 1\n    "B": 2';
    const reordered = moveTreemapNode(mixed, identity(mixed, 'B'), 'up');
    expect(reordered.match(/\r\n|\n|\r/gu)).toEqual(mixed.match(/\r\n|\n|\r/gu));
    expect(reordered).toBe('treemap-beta\r\n  "Root"\r    "B": 2\n    "A": 1');
  });

  it('restores no-final-newline policy after deleting a reparented EOF subtree', async () => {
    mermaid.initialize({ startOnLoad: false });
    for (const ending of ['\n', '\r\n', '\r']) {
      const original = [
        'treemap-beta',
        '  "Portfolio"',
        '    "Core": 8',
        '    "Growth": 4',
      ].join(ending);
      let source = addTreemapNode(original, { label: 'Holding', value: null }, identity(original, 'Portfolio'));
      source = addTreemapNode(source, { label: 'Income', value: 3 }, identity(source, 'Portfolio'));
      source = editTreemapNode(source, identity(source, 'Income'), { label: 'Dividend' });
      source = moveTreemapNode(source, identity(source, 'Dividend'), 'up');
      source = reparentTreemapNode(source, identity(source, 'Dividend'), identity(source, 'Holding'));

      expect(deleteTreemapNode(source, identity(source, 'Holding'))).toBe(original);
      await expectTreemap(source);
    }
  });

  it('uses opaque source identities without display-path delimiters and rejects only truly ambiguous records', async () => {
    const build = identity(SOURCE, 'Build');
    const prepended = SOURCE.replace('      "Build": 4', '      "Remote": 1\n      "Build": 4');
    expect(resolveTreemapNode(prepended, build)).toEqual({
      ancestorLabels: ['Portfolio', 'Product'],
      label: 'Build',
      value: 4,
    });
    expect(editTreemapNode(prepended, build, { value: 5 })).toContain('"Build": 5');

    const replaced = SOURCE.replace('"Build": 4', '"Build": 9');
    expect(() => resolveTreemapNode(replaced, build)).toThrow('changed remotely');
    expect(() => editTreemapNode(replaced, build, { value: 5 })).toThrow('changed remotely');
    expect(() => deleteTreemapNode(replaced, build)).toThrow('changed remotely');
    expect(() => moveTreemapNode(replaced, build, 'down')).toThrow('changed remotely');
    expect(() => reparentTreemapNode(replaced, build, identity(replaced, 'Support'))).toThrow('changed remotely');
    const equivalentNumericText = SOURCE.replace('"Build": 4', '"Build": 4.0');
    expect(() => resolveTreemapNode(equivalentNumericText, build)).toThrow('changed remotely');

    const duplicatePath = 'treemap-beta\n  "Root / Main"\n    "Group"\n      "Leaf / detail": 1\n    "Group"\n      "Other": 2';
    expect(isTreemapSourceRepresentable(duplicatePath)).toBe(true);
    const leaf = identity(duplicatePath, 'Leaf / detail');
    expect(resolveTreemapNode(duplicatePath, leaf)).toMatchObject({
      ancestorLabels: ['Root / Main', 'Group'], label: 'Leaf / detail', value: 1,
    });
    expect(editTreemapNode(duplicatePath, leaf, { value: 2 })).toContain('"Leaf / detail": 2');
    const groups = getTreemapDiagramSnapshot(duplicatePath).nodes.filter((node) => node.label === 'Group');
    expect(groups).toHaveLength(2);
    expect(() => resolveTreemapNode(duplicatePath, getTreemapNodeIdentity(groups[0]!, groups))).toThrow('changed remotely');
    const identicalLeaves = 'treemap-beta\n  "Root"\n    "Group"\n      "Leaf": 1\n    "Group"\n      "Leaf": 1';
    expect(isTreemapSourceRepresentable(identicalLeaves)).toBe(true);
    const leaves = getTreemapDiagramSnapshot(identicalLeaves).nodes.filter((node) => node.label === 'Leaf');
    expect(() => resolveTreemapNode(identicalLeaves, getTreemapNodeIdentity(leaves[0]!, leaves))).toThrow('changed remotely');
    await expectTreemap(duplicatePath);
    const repeatedAncestor = 'treemap-beta\n  "Root"\n    "Left"\n      "Target": 1\n  "Root"\n    "Left"\n      "Other": 2';
    expect(isTreemapSourceRepresentable(repeatedAncestor)).toBe(false);
  });

  it('fails closed for cycles, valued parents, malformed indentation, invalid values, and valid advanced syntax', async () => {
    mermaid.initialize({ startOnLoad: false });
    expect(() => reparentTreemapNode(SOURCE, identity(SOURCE, 'Product'), identity(SOURCE, 'Build'))).toThrow('leaf nodes');
    expect(() => reparentTreemapNode(SOURCE, identity(SOURCE, 'Product'), identity(SOURCE, 'Ship'))).toThrow('leaf nodes');
    expect(() => reparentTreemapNode(SOURCE, identity(SOURCE, 'Support'), identity(SOURCE, 'Support'))).toThrow('own descendant');
    expect(() => editTreemapNode(SOURCE, identity(SOURCE, 'Product'), { value: 1 })).toThrow('parent nodes');
    expect(() => deleteTreemapNode(SOURCE, identity(SOURCE, 'Portfolio'))).toThrow('root cannot be deleted');
    expect(reparentTreemapNode(SOURCE, identity(SOURCE, 'Build'), identity(SOURCE, 'Product'))).toBe(SOURCE);
    const huge = `1${'0'.repeat(308)}`;
    expect(isTreemapSourceRepresentable(`treemap-beta\n  "Root"\n    "A": ${huge}\n    "B": ${huge}`)).toBe(false);
    for (const source of [
      'treemap-beta\n  "Root": 1\n    "Child": 1',
      'treemap-beta\n  "Root"\n      "Wide": 1\n    "Mismatched": 1',
      'treemap-beta\n  "Root"\n    "Leaf": 0',
      'treemap-beta\n  "Root"\n    "Leaf": -1',
      'treemap-beta\n  "Root"\n    "Leaf": Infinity',
      'treemap-beta\n  "Root"\n    "Leaf": 1e2',
      'treemap-beta\n  " Root ": 1',
      'treemap-beta\n  "Root":::important\n    "Leaf": 1',
      'treemap-beta\n  title Advanced\n  "Root": 1',
      'treemap\n  "Root": 1',
      'Treemap-beta\n  "Root": 1',
      '---\ntitle: [unterminated\n---\ntreemap-beta\n  "Root": 1',
      '%%{init: {theme: neutral}}%%\ntreemap-beta\n  "Root": 1',
      '%%{init: {"theme":"neutral"}}%%\ntreemap-beta\n  "Root": 1',
      '---\nconfig:\n  theme: neutral\n---\ntreemap-beta\n  "Root": 1',
    ]) {
      expect(isTreemapSourceRepresentable(source), source).toBe(false);
    }
    await expectTreemap('treemap\n  "Root": 1');
    await expectTreemap('treemap-beta\n  "Root":::important\n    "Leaf": 1');
  });
});
