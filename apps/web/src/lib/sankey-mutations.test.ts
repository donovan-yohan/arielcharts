// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addSankeyLink,
  deleteSankeyLink,
  editSankeyLink,
  getSankeyDiagramSnapshot,
  getSankeyLinkIdentity,
  getSankeyNodeIdentity,
  isSankeySourceRepresentable,
  moveSankeyLink,
  renameSankeyNode,
  resolveSankeyLink,
  resolveSankeyNode,
} from './sankey-mutations';

const SOURCE = `sankey-beta
Source,Middle,2
Middle,Target,1.5
Source,Target,0.5`;

function linkIdentity(source: string, index: number) {
  const snapshot = getSankeyDiagramSnapshot(source);
  return getSankeyLinkIdentity(snapshot.links[index]!, snapshot.links);
}

function nodeIdentity(source: string, label: string) {
  const snapshot = getSankeyDiagramSnapshot(source);
  const node = snapshot.nodes.find((candidate) => candidate.label === label);
  if (!node) throw new Error(`Missing Sankey node ${label}.`);
  return getSankeyNodeIdentity(node, snapshot.links);
}

async function expectSankey(source: string): Promise<void> {
  await expect(mermaid.parse(source)).resolves.toMatchObject({ diagramType: 'sankey' });
}

describe('Sankey source mutations', () => {
  it('snapshots ordered weighted links and first-appearance nodes from exact RFC-style CSV', async () => {
    mermaid.initialize({ startOnLoad: false });
    const source = `sankey-beta
"Source, east","Middle ""quoted""",2
"Middle ""quoted""",Target,1.5`;
    expect(getSankeyDiagramSnapshot(source)).toEqual({
      links: [
        { source: 'Source, east', target: 'Middle "quoted"', value: 2 },
        { source: 'Middle "quoted"', target: 'Target', value: 1.5 },
      ],
      nodes: [
        { label: 'Source, east' },
        { label: 'Middle "quoted"' },
        { label: 'Target' },
      ],
    });
    await expectSankey(source);
  });

  it('adds, minimally edits, reorders, and deletes links through semantic identities', async () => {
    mermaid.initialize({ startOnLoad: false });
    const added = addSankeyLink(SOURCE, { source: 'Target', target: 'Archive, "cold"', value: 4 });
    expect(added).toContain('Target,"Archive, ""cold""",4');
    await expectSankey(added);

    const edited = editSankeyLink(added, linkIdentity(added, 1), {
      target: 'Delivery, final',
      value: 2.25,
    });
    expect(edited).toContain('Middle,"Delivery, final",2.25');
    await expectSankey(edited);

    const moved = moveSankeyLink(edited, linkIdentity(edited, 3), 'up');
    expect(getSankeyDiagramSnapshot(moved).links.map((link) => link.target)).toEqual([
      'Middle',
      'Delivery, final',
      'Archive, "cold"',
      'Target',
    ]);
    await expectSankey(moved);

    const deleted = deleteSankeyLink(moved, linkIdentity(moved, 2));
    expect(getSankeyDiagramSnapshot(deleted).links).toHaveLength(3);
    await expectSankey(deleted);
  });

  it('renames every parsed endpoint atomically while preserving unrelated bytes', async () => {
    mermaid.initialize({ startOnLoad: false });
    const source = `sankey-beta
  Source  ,  Middle  ,2
%% keep Middle and commas, exactly
  Middle  ,  Target  ,1.5
  Source  ,  Target  ,0.5`;
    const renamed = renameSankeyNode(source, nodeIdentity(source, 'Middle'), 'Hub, "central"');
    expect(renamed).toBe(`sankey-beta
  Source  ,"Hub, ""central""",2
%% keep Middle and commas, exactly
"Hub, ""central""",  Target  ,1.5
  Source  ,  Target  ,0.5`);
    expect(getSankeyDiagramSnapshot(renamed).nodes).toContainEqual({ label: 'Hub, "central"' });
    await expectSankey(renamed);
  });

  it('keeps identities stable across unrelated remote prepends and rejects stale replacements', () => {
    const link = linkIdentity(SOURCE, 1);
    const prepended = SOURCE.replace('Source,Middle,2', 'Remote,Other,3\nSource,Middle,2');
    expect(resolveSankeyLink(prepended, link)).toEqual({ source: 'Middle', target: 'Target', value: 1.5 });
    expect(editSankeyLink(prepended, link, { value: 2.5 })).toContain('Middle,Target,2.5');

    const replaced = SOURCE.replace('Middle,Target,1.5', 'Middle,Target,9');
    expect(() => resolveSankeyLink(replaced, link)).toThrow('changed remotely');
    expect(() => editSankeyLink(replaced, link, { value: 2.5 })).toThrow('changed remotely');
    expect(() => deleteSankeyLink(replaced, link)).toThrow('changed remotely');
    expect(() => moveSankeyLink(replaced, link, 'up')).toThrow('changed remotely');

    const node = nodeIdentity(SOURCE, 'Middle');
    expect(resolveSankeyNode(prepended, node)).toEqual({ label: 'Middle' });
    expect(renameSankeyNode(prepended, node, 'Hub')).toContain('Source,Hub,2');
    const relocated = SOURCE.replace('Middle,Target,1.5', 'Other,Target,1.5');
    expect(() => resolveSankeyNode(relocated, node)).toThrow('changed remotely');
    expect(() => renameSankeyNode(relocated, node, 'Hub')).toThrow('changed remotely');
  });

  it('accepts positive finite numeric boundaries and rejects every nonpositive or nonfinite write', async () => {
    mermaid.initialize({ startOnLoad: false });
    const tiny = addSankeyLink(SOURCE, {
      source: 'Target',
      target: 'Tiny',
      value: Number.MIN_VALUE,
    });
    expect(tiny).toContain('Target,Tiny,5e-324');
    await expectSankey(tiny);
    const huge = addSankeyLink(tiny, {
      source: 'Tiny',
      target: 'Huge',
      value: Number.MAX_VALUE,
    });
    expect(huge).toContain('Tiny,Huge,1.7976931348623157e+308');
    await expectSankey(huge);

    for (const value of [0, -0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
      expect(() => addSankeyLink(SOURCE, { source: 'Target', target: 'Bad', value })).toThrow(
        'finite numbers greater than zero',
      );
      expect(() => editSankeyLink(SOURCE, linkIdentity(SOURCE, 0), { value })).toThrow(
        'finite numbers greater than zero',
      );
    }
    expect(isSankeySourceRepresentable('sankey-beta\nA,B,0')).toBe(false);
    expect(isSankeySourceRepresentable('sankey-beta\nA,B,-1')).toBe(false);
    expect(isSankeySourceRepresentable('sankey-beta\nA,B,Infinity')).toBe(false);
    expect(isSankeySourceRepresentable('sankey-beta\nA,B,1tail')).toBe(false);
    expect(isSankeySourceRepresentable('sankey-beta\nA,B,"1.25"')).toBe(true);
    await expectSankey('sankey-beta\nA,B,"1.25"');
  });

  it('preserves BOM, frontmatter, comments, directives, untouched records, and no-op bytes', async () => {
    mermaid.initialize({ startOnLoad: false });
    const source = '\uFEFF---\nconfig:\n  theme: neutral\n---\n%%{init: {}}%%\n%% authored\nsankey-beta\n  A  ,  B  ,1.00\n  B  ,  C  ,2';
    const edited = editSankeyLink(source, linkIdentity(source, 0), { value: 1.5 });
    expect(edited).toBe('\uFEFF---\nconfig:\n  theme: neutral\n---\n%%{init: {}}%%\n%% authored\nsankey-beta\n  A  ,  B  ,1.5\n  B  ,  C  ,2');
    expect(editSankeyLink(source, linkIdentity(source, 0), { source: 'A', target: 'B', value: 1 })).toBe(source);
    expect(renameSankeyNode(source, nodeIdentity(source, 'A'), 'A')).toBe(source);
    expect(moveSankeyLink(source, linkIdentity(source, 0), 'up')).toBe(source);
    await expectSankey(edited);
  });

  it('keeps LF, CRLF, CR, mixed terminators, and final-newline policy at physical positions', async () => {
    mermaid.initialize({ startOnLoad: false });
    for (const ending of ['\n', '\r\n', '\r']) {
      const source = `sankey-beta${ending}A,B,1`;
      const added = addSankeyLink(source, { source: 'B', target: 'C', value: 2 });
      expect(added).toBe(`${source}${ending}B,C,2`);
      const moved = moveSankeyLink(added, linkIdentity(added, 1), 'up');
      expect(moved).toBe(`sankey-beta${ending}B,C,2${ending}A,B,1`);
      expect(deleteSankeyLink(moved, linkIdentity(moved, 0))).toBe(source);
      await expectSankey(added);
      await expectSankey(moved);

      const withFinal = `${source}${ending}`;
      expect(addSankeyLink(withFinal, { source: 'B', target: 'C', value: 2 })).toBe(
        `${withFinal}B,C,2${ending}`,
      );
    }
    const mixed = 'sankey-beta\r\nA,B,1\rB,C,2\n';
    const addedMixed = addSankeyLink(mixed, { source: 'C', target: 'D', value: 3 });
    expect(addedMixed).toBe('sankey-beta\r\nA,B,1\rB,C,2\nC,D,3\n');
    const movedMixed = moveSankeyLink(addedMixed, linkIdentity(addedMixed, 1), 'up');
    expect(movedMixed.match(/\r\n|\n|\r/g)).toEqual(addedMixed.match(/\r\n|\n|\r/g));
    await expectSankey(addedMixed);
    await expectSankey(movedMixed);

    const crFrontmatter = '\uFEFF---\rtitle: CR Sankey\r---\rsankey-beta\rA,B,1';
    const addedToCrFrontmatter = addSankeyLink(crFrontmatter, { source: 'B', target: 'C', value: 2 });
    expect(addedToCrFrontmatter).toBe(`${crFrontmatter}\rB,C,2`);
    expect(moveSankeyLink(addedToCrFrontmatter, linkIdentity(addedToCrFrontmatter, 1), 'up')).toBe(
      '\uFEFF---\rtitle: CR Sankey\r---\rsankey-beta\rB,C,2\rA,B,1',
    );
    await expectSankey(addedToCrFrontmatter);
  });

  it('fails closed for duplicate, ambiguous, cyclic, malformed, and valid advanced source', async () => {
    mermaid.initialize({ startOnLoad: false });
    const duplicate = 'sankey-beta\nA,B,1\n"A","B",1';
    expect(isSankeySourceRepresentable(duplicate)).toBe(false);
    expect(() => getSankeyDiagramSnapshot(duplicate)).toThrow('not a safely representable');
    expect(() => editSankeyLink(duplicate, linkIdentity('sankey-beta\nA,B,1', 0), { value: 2 })).toThrow(
      'not a safely representable',
    );
    expect(() => addSankeyLink(SOURCE, { source: 'Source', target: 'Middle', value: 2 })).toThrow(
      'identical Sankey link',
    );
    const ambiguous = getSankeyLinkIdentity(
      { source: 'A', target: 'B', value: 1 },
      [{ source: 'A', target: 'B', value: 1 }, { source: 'A', target: 'B', value: 1 }],
    );
    expect(() => resolveSankeyLink('sankey-beta\nA,B,1', ambiguous)).toThrow('changed remotely');

    expect(isSankeySourceRepresentable('sankey-beta\nA,A,1')).toBe(false);
    expect(isSankeySourceRepresentable('sankey-beta\nA,B,1\nB,A,1')).toBe(false);
    expect(() => addSankeyLink(SOURCE, { source: 'Target', target: 'Source', value: 1 })).toThrow(
      'cannot form cycles',
    );
    expect(() => editSankeyLink(SOURCE, linkIdentity(SOURCE, 1), { target: 'Source' })).toThrow(
      'cannot form cycles',
    );
    expect(() => deleteSankeyLink('sankey-beta\nA,B,1', linkIdentity('sankey-beta\nA,B,1', 0))).toThrow(
      'at least one link',
    );

    for (const source of [
      'Sankey-beta\nA,B,1',
      ' sankey-beta\nA,B,1',
      'sankey-beta \nA,B,1',
      'sankey-beta',
      'sankey-beta\nA,B',
      'sankey-beta\nA,B,1,C',
      'sankey-beta\n,A,1',
      'sankey-beta\nA,,1',
      'sankey-beta\nA\t,B,1',
      'sankey-beta\nÅ,B,1',
      'sankey-beta\nA,B,1\nstyle A fill:#fff',
      '  ---\nconfig: {}\n  ---\nsankey-beta\nA,B,1',
    ]) {
      expect(isSankeySourceRepresentable(source), source).toBe(false);
    }

    const stableHeader = 'sankey\nA,B,1';
    const multilineQuoted = 'sankey-beta\n"Source\ncontinued",Target,1';
    expect(isSankeySourceRepresentable(stableHeader)).toBe(false);
    expect(isSankeySourceRepresentable(multilineQuoted)).toBe(false);
    await expectSankey(stableHeader);
    await expectSankey(multilineQuoted);

    for (const malformedFrontmatter of [
      '---\ntitle: [unterminated\n---\nsankey-beta\nA,B,1',
      '---\ntitle: ,leading comma\n---\nsankey-beta\nA,B,1',
      '---\ntitle: %leading percent\n---\nsankey-beta\nA,B,1',
      '---\ntitle: - leading dash\n---\nsankey-beta\nA,B,1',
      '---\ntitle: ? leading question\n---\nsankey-beta\nA,B,1',
      '---\ntitle: : leading colon\n---\nsankey-beta\nA,B,1',
    ]) {
      expect(isSankeySourceRepresentable(malformedFrontmatter)).toBe(false);
      let attempted = malformedFrontmatter;
      expect(() => {
        attempted = addSankeyLink(malformedFrontmatter, { source: 'B', target: 'C', value: 2 });
      }).toThrow('not a safely representable');
      expect(attempted).toBe(malformedFrontmatter);
      await expect(mermaid.parse(malformedFrontmatter)).rejects.toThrow();
    }
  });

  it('rejects node-name collisions and preserves source when validation fails', () => {
    const original = SOURCE;
    expect(() => renameSankeyNode(original, nodeIdentity(original, 'Middle'), 'Target')).toThrow(
      'already exists',
    );
    expect(() => renameSankeyNode(original, nodeIdentity(original, 'Middle'), '   ')).toThrow(
      'non-empty single-line',
    );
    expect(() => addSankeyLink(original, { source: 'Target', target: 'Bad\nnode', value: 1 })).toThrow(
      'non-empty single-line',
    );
    expect(original).toBe(SOURCE);
  });
});
