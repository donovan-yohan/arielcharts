// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addCynefinItem,
  addCynefinTransition,
  CYNEFIN_DOMAIN_NAMES,
  deleteCynefinItem,
  deleteCynefinTransition,
  editCynefinItem,
  editCynefinTransition,
  getCynefinDiagramSnapshot,
  getCynefinItemIdentity,
  getCynefinTransitionIdentity,
  isCynefinSourceRepresentable,
  moveCynefinItem,
  moveCynefinTransition,
  resolveCynefinItem,
  resolveCynefinTransition,
  type CynefinDomainName,
  type CynefinItem,
  type CynefinItemIdentity,
  type CynefinTransitionIdentity,
} from './cynefin-mutations';

const SOURCE = `cynefin-beta
  complex
    "Probe signals"
    "Run experiment"
  complicated
    "Expert review"
  clear
    "Known playbook"
  chaotic
    "Stop the incident"
  confusion
    "Unknown mode"
  complex --> complicated : "Pattern found"
  chaotic --> complex`;

function items(source: string): CynefinItem[] {
  return getCynefinDiagramSnapshot(source).domains.flatMap((domain) => domain.items);
}

function itemIdentity(
  source: string,
  domain: CynefinDomainName,
  label: string,
): CynefinItemIdentity {
  const all = items(source);
  const item = all.find((candidate) => candidate.domain === domain && candidate.label === label);
  if (!item) throw new Error(`Missing Cynefin item ${domain}/${label}.`);
  return getCynefinItemIdentity(item, all);
}

function transitionIdentity(source: string, index: number): CynefinTransitionIdentity {
  const transitions = getCynefinDiagramSnapshot(source).transitions;
  return getCynefinTransitionIdentity(transitions[index]!, transitions);
}

async function expectCynefin(source: string): Promise<void> {
  await expect(mermaid.parse(source)).resolves.toMatchObject({ diagramType: 'cynefin' });
}

describe('Cynefin source mutations', () => {
  it('snapshots all fixed domains in canonical order with quoted items and ordered transitions', async () => {
    mermaid.initialize({ startOnLoad: false });
    const source = `cynefin-beta
  chaotic
    "Restore \\"service\\""
  complex
    'Probe \\'signals\\''
  confusion
    "Unknown mode"
  clear
  complicated
    "Expert review"
  chaotic --> complex : "Stabilized \\"enough\\""
  complicated --> clear`;
    const snapshot = getCynefinDiagramSnapshot(source);
    expect(snapshot.domains.map((domain) => domain.name)).toEqual(CYNEFIN_DOMAIN_NAMES);
    expect(snapshot.domains.map((domain) => domain.items.map((item) => item.label))).toEqual([
      ["Probe 'signals'"],
      ['Expert review'],
      [],
      ['Restore "service"'],
      ['Unknown mode'],
    ]);
    expect(snapshot.transitions).toEqual([
      { from: 'chaotic', label: 'Stabilized "enough"', to: 'complex' },
      { from: 'complicated', label: null, to: 'clear' },
    ]);
    await expectCynefin(source);
  });

  it('adds, minimally edits, deletes, reorders, and reparents items across authored or absent domains', async () => {
    mermaid.initialize({ startOnLoad: false });
    const initial = `cynefin-beta
  complex
    "A"
    "C"
  complicated
    "Expert"
  complex --> complicated : "Learn"`;
    const added = addCynefinItem(initial, { domain: 'complex', label: 'B' }, 1);
    expect(added).toBe(`cynefin-beta
  complex
    "A"
    "B"
    "C"
  complicated
    "Expert"
  complex --> complicated : "Learn"`);
    await expectCynefin(added);

    const edited = editCynefinItem(added, itemIdentity(added, 'complex', 'B'), {
      label: 'B "quoted"',
    });
    expect(edited).toContain('    "B \\"quoted\\""');
    expect(edited.replace('    "B \\"quoted\\""', '    "B"')).toBe(added);
    await expectCynefin(edited);

    const reordered = moveCynefinItem(
      edited,
      itemIdentity(edited, 'complex', 'B "quoted"'),
      'complex',
      0,
    );
    expect(getCynefinDiagramSnapshot(reordered).domains[0]!.items.map((item) => item.label)).toEqual([
      'B "quoted"',
      'A',
      'C',
    ]);
    await expectCynefin(reordered);

    const reparented = moveCynefinItem(
      reordered,
      itemIdentity(reordered, 'complex', 'B "quoted"'),
      'confusion',
      0,
    );
    expect(reparented).toContain(`  confusion
    "B \\"quoted\\""
  complex --> complicated`);
    expect(getCynefinDiagramSnapshot(reparented).domains[4]!.items).toEqual([
      { domain: 'confusion', label: 'B "quoted"' },
    ]);
    await expectCynefin(reparented);

    const movedByEdit = editCynefinItem(reparented, itemIdentity(reparented, 'complex', 'C'), {
      domain: 'complicated',
      label: 'Codified',
    });
    expect(getCynefinDiagramSnapshot(movedByEdit).domains[1]!.items).toEqual([
      { domain: 'complicated', label: 'Expert' },
      { domain: 'complicated', label: 'Codified' },
    ]);
    await expectCynefin(movedByEdit);

    const deleted = deleteCynefinItem(
      movedByEdit,
      itemIdentity(movedByEdit, 'complicated', 'Expert'),
    );
    expect(deleted).not.toContain('"Expert"');
    expect(deleted).toContain('  complicated');
    await expectCynefin(deleted);

    const fromBlank = addCynefinItem('', { domain: 'chaotic', label: 'Act' });
    expect(fromBlank).toBe('cynefin-beta\n  chaotic\n    "Act"');
    await expectCynefin(fromBlank);
  });

  it('adds, edits, reorders, and deletes labelled or unlabelled transitions', async () => {
    mermaid.initialize({ startOnLoad: false });
    const initial = `cynefin-beta
  complex
    "Probe"
  complicated
    "Analyze"
  complex --> complicated
%% keep this comment in place
  chaotic --> complex : "Stabilize"`;
    const added = addCynefinTransition(initial, {
      from: 'complicated',
      label: 'Codify "answer"',
      to: 'clear',
    });
    expect(added).toContain('  complicated --> clear : "Codify \\"answer\\""');
    await expectCynefin(added);

    const edited = editCynefinTransition(added, transitionIdentity(added, 0), {
      from: 'confusion',
      label: 'Classified',
      to: 'complex',
    });
    expect(edited).toContain('  confusion --> complex : "Classified"');
    await expectCynefin(edited);

    const unlabelled = editCynefinTransition(edited, transitionIdentity(edited, 1), {
      label: null,
    });
    expect(unlabelled).toContain('  chaotic --> complex\n');
    await expectCynefin(unlabelled);

    const moved = moveCynefinTransition(unlabelled, transitionIdentity(unlabelled, 2), 'up');
    expect(getCynefinDiagramSnapshot(moved).transitions.map((transition) => transition.from)).toEqual([
      'confusion',
      'complicated',
      'chaotic',
    ]);
    expect(moved).toContain('%% keep this comment in place');
    await expectCynefin(moved);

    const deleted = deleteCynefinTransition(moved, transitionIdentity(moved, 1));
    expect(getCynefinDiagramSnapshot(deleted).transitions).toHaveLength(2);
    await expectCynefin(deleted);

    const fromBlank = addCynefinTransition('', { from: 'chaotic', to: 'complex' });
    expect(fromBlank).toBe('cynefin-beta\n  chaotic --> complex');
    await expectCynefin(fromBlank);
  });

  it('resolves unique identities after unrelated remote inserts and rejects stale replacements or duplicates', () => {
    const item = itemIdentity(SOURCE, 'complex', 'Run experiment');
    const prependedItem = SOURCE.replace('    "Probe signals"', '    "Remote insert"\n    "Probe signals"');
    expect(resolveCynefinItem(prependedItem, item)).toEqual({
      domain: 'complex',
      label: 'Run experiment',
    });
    expect(editCynefinItem(prependedItem, item, { label: 'Run safely' })).toContain('"Run safely"');
    const replacedItem = SOURCE.replace('"Run experiment"', '"Remote replacement"');
    expect(() => resolveCynefinItem(replacedItem, item)).toThrow('changed remotely');
    expect(() => editCynefinItem(replacedItem, item, { label: 'Local edit' })).toThrow('changed remotely');
    expect(() => deleteCynefinItem(replacedItem, item)).toThrow('changed remotely');
    expect(() => moveCynefinItem(replacedItem, item, 'clear', 0)).toThrow('changed remotely');

    const transition = transitionIdentity(SOURCE, 0);
    const prependedTransition = SOURCE.replace(
      '  complex --> complicated',
      '  confusion --> clear : "Remote"\n  complex --> complicated',
    );
    expect(resolveCynefinTransition(prependedTransition, transition)).toEqual({
      from: 'complex',
      label: 'Pattern found',
      to: 'complicated',
    });
    const replacedTransition = SOURCE.replace('"Pattern found"', '"Remote label"');
    expect(() => resolveCynefinTransition(replacedTransition, transition)).toThrow('changed remotely');
    expect(() => editCynefinTransition(replacedTransition, transition, { label: 'Local' })).toThrow('changed remotely');
    expect(() => deleteCynefinTransition(replacedTransition, transition)).toThrow('changed remotely');
    expect(() => moveCynefinTransition(replacedTransition, transition, 'down')).toThrow('changed remotely');

    const duplicateItems = 'cynefin-beta\ncomplex\n  "Same"\n  "Same"';
    const duplicateTransitions = 'cynefin-beta\ncomplex --> complicated\ncomplex --> complicated';
    expect(isCynefinSourceRepresentable(duplicateItems)).toBe(false);
    expect(isCynefinSourceRepresentable(duplicateTransitions)).toBe(false);
    expect(() => editCynefinItem(duplicateItems, item, { label: 'Unsafe' })).toThrow(
      'not a safely representable',
    );
    expect(() => editCynefinTransition(duplicateTransitions, transition, { label: 'Unsafe' })).toThrow(
      'not a safely representable',
    );

    const ambiguousItem = getCynefinItemIdentity(
      { domain: 'complex', label: 'Only' },
      [{ domain: 'complex', label: 'Only' }, { domain: 'complex', label: 'Only' }],
    );
    expect(() => resolveCynefinItem('cynefin-beta\ncomplex\n  "Only"', ambiguousItem)).toThrow(
      'changed remotely',
    );
  });

  it('edits transition token spans atomically without normalizing authored spacing, quotes, or line endings', async () => {
    mermaid.initialize({ startOnLoad: false });
    const source = "cynefin-beta\r\n\tcomplex\t-->\tcomplicated\t:\t'Learn'  \rchaotic --> clear\t\t";
    const edited = editCynefinTransition(source, transitionIdentity(source, 0), {
      from: 'confusion',
      label: "Classify 'it'",
      to: 'clear',
    });
    expect(edited).toBe("cynefin-beta\r\n\tconfusion\t-->\tclear\t:\t'Classify \\'it\\''  \rchaotic --> clear\t\t");
    expect(edited.match(/\r\n|\n|\r/gu)).toEqual(source.match(/\r\n|\n|\r/gu));
    await expectCynefin(edited);

    const removed = editCynefinTransition(edited, transitionIdentity(edited, 0), { label: null });
    expect(removed).toBe("cynefin-beta\r\n\tconfusion\t-->\tclear  \rchaotic --> clear\t\t");
    await expectCynefin(removed);
    const added = editCynefinTransition(removed, transitionIdentity(removed, 1), { label: 'Stabilize' });
    expect(added).toBe("cynefin-beta\r\n\tconfusion\t-->\tclear  \rchaotic --> clear : \"Stabilize\"\t\t");
    await expectCynefin(added);
  });

  it('rejects self-loops, unknown references, duplicate blocks, unsafe labels, and valid unfamiliar syntax', async () => {
    mermaid.initialize({ startOnLoad: false });
    const selfLoop = 'cynefin-beta\ncomplex --> complex : "Ignored"';
    expect(isCynefinSourceRepresentable(selfLoop)).toBe(false);
    expect(() => addCynefinTransition('cynefin-beta', {
      from: 'complex', label: null, to: 'complex',
    })).toThrow('different domains');
    expect(() => editCynefinTransition(SOURCE, transitionIdentity(SOURCE, 0), {
      from: 'complex', to: 'complex',
    })).toThrow('different domains');
    await expectCynefin(selfLoop);

    const duplicateBlock = 'cynefin-beta\ncomplex\n  "A"\ncomplex\n  "B"';
    expect(isCynefinSourceRepresentable(duplicateBlock)).toBe(false);
    await expectCynefin(duplicateBlock);

    const sameLabelDifferentDomains = 'cynefin-beta\ncomplex\n  "Same"\nclear\n  "Same"';
    expect(isCynefinSourceRepresentable(sameLabelDifferentDomains)).toBe(true);
    await expectCynefin(sameLabelDifferentDomains);

    for (const source of [
      'cynefin-beta:\ncomplex\n  "Alias header"',
      'cynefin-beta\ntitle Advanced title\ncomplex\n  "A"',
      "%%{init: {'cynefin': {'width': 1000}}}%%\ncynefin-beta\ncomplex\n  \"A\"",
      'cynefin-beta\ncomplex\n  "escaped\\nline"',
    ]) {
      expect(isCynefinSourceRepresentable(source), source).toBe(false);
      await expectCynefin(source);
    }

    for (const source of [
      'Cynefin-beta\ncomplex\n  "A"',
      ' cynefin-beta\ncomplex\n  "A"',
      'cynefin-beta \ncomplex\n  "A"',
      'cynefin-beta\nunknown\n  "A"',
      'cynefin-beta\ncomplex\n  unquoted',
      'cynefin-beta\ncomplex\n  ""',
      'cynefin-beta\ncomplex --> unknown',
      'cynefin-beta\ncomplex\n  "A"\nstyle complex fill:#fff',
    ]) {
      expect(isCynefinSourceRepresentable(source), source).toBe(false);
    }
    expect(() => addCynefinItem(SOURCE, { domain: 'complex', label: 'Probe signals' })).toThrow(
      'already contains',
    );
    expect(() => addCynefinItem(SOURCE, { domain: 'complex', label: '  ' })).toThrow(
      'non-empty one-line',
    );
    expect(() => addCynefinItem(SOURCE, { domain: 'not-a-domain' as CynefinDomainName, label: 'A' })).toThrow(
      'Unknown Cynefin domain',
    );
    expect(() => moveCynefinItem(SOURCE, itemIdentity(SOURCE, 'complex', 'Probe signals'), 'clear', -1)).toThrow(
      'out of range',
    );
  });

  it('preserves BOM, safe frontmatter, comments, untouched bytes, and exact no-op source', async () => {
    mermaid.initialize({ startOnLoad: false });
    const source = `\uFEFF---
title: Safe Cynefin metadata
---
%% authored before header
cynefin-beta
  complex
    'Probe'
%% authored inside block
  complicated
    "Analyze"
  complex --> complicated : 'Learn'`;
    expect(isCynefinSourceRepresentable(source)).toBe(true);
    expect(editCynefinItem(source, itemIdentity(source, 'complex', 'Probe'), { label: 'Probe' })).toBe(source);
    expect(moveCynefinItem(source, itemIdentity(source, 'complex', 'Probe'), 'complex', 0)).toBe(source);
    expect(editCynefinTransition(source, transitionIdentity(source, 0), {
      from: 'complex', label: 'Learn', to: 'complicated',
    })).toBe(source);
    expect(moveCynefinTransition(source, transitionIdentity(source, 0), 'up')).toBe(source);

    const edited = editCynefinItem(source, itemIdentity(source, 'complex', 'Probe'), {
      label: 'Probe "carefully"',
    });
    expect(edited).toBe(source.replace("'Probe'", '"Probe \\"carefully\\""'));
    expect(edited).toContain('%% authored before header');
    expect(edited).toContain('%% authored inside block');
    await expectCynefin(edited);

    const malformedFrontmatter = '---\ntitle: [unterminated\n---\ncynefin-beta\ncomplex\n  "A"';
    expect(isCynefinSourceRepresentable(malformedFrontmatter)).toBe(false);
    let attempted = malformedFrontmatter;
    expect(() => {
      attempted = addCynefinItem(malformedFrontmatter, { domain: 'clear', label: 'B' });
    }).toThrow('not a safely representable');
    expect(attempted).toBe(malformedFrontmatter);
    await expect(mermaid.parse(malformedFrontmatter)).rejects.toThrow();

    for (const configured of [
      '---\nconfig:\n  cynefin:\n    seed: 0\n---\ncynefin-beta\ncomplex\n  "A"',
      '---\nconfig: { cynefin: { seed: 10 } }\n---\ncynefin-beta\ncomplex\n  "A"',
    ]) {
      expect(isCynefinSourceRepresentable(configured)).toBe(false);
      let unchanged = configured;
      expect(() => {
        unchanged = addCynefinItem(configured, { domain: 'clear', label: 'B' });
      }).toThrow('not a safely representable');
      expect(unchanged).toBe(configured);
      await expectCynefin(configured);
    }
  });

  it('preserves LF, CRLF, CR, mixed positional terminators, and final-newline policy', async () => {
    mermaid.initialize({ startOnLoad: false });
    for (const ending of ['\n', '\r\n', '\r']) {
      const noFinal = ['cynefin-beta', 'complex', '  "A"'].join(ending);
      const added = addCynefinItem(noFinal, { domain: 'complex', label: 'B' });
      expect(added).toBe(`${noFinal}${ending}  "B"`);
      expect(added.endsWith(ending)).toBe(false);
      await expectCynefin(added);

      const moved = moveCynefinItem(added, itemIdentity(added, 'complex', 'B'), 'complex', 0);
      expect(moved).toBe(['cynefin-beta', 'complex', '  "B"', '  "A"'].join(ending));
      expect(moved.match(/\r\n|\n|\r/gu)).toEqual(added.match(/\r\n|\n|\r/gu));
      await expectCynefin(moved);

      const edited = editCynefinItem(moved, itemIdentity(moved, 'complex', 'A'), { label: 'A2' });
      expect(edited).toBe(['cynefin-beta', 'complex', '  "B"', '  "A2"'].join(ending));
      await expectCynefin(edited);

      const deleted = deleteCynefinItem(edited, itemIdentity(edited, 'complex', 'B'));
      expect(deleted).toBe(['cynefin-beta', 'complex', '  "A2"'].join(ending));
      await expectCynefin(deleted);

      const withFinal = `${noFinal}${ending}`;
      expect(addCynefinItem(withFinal, { domain: 'complex', label: 'B' })).toBe(
        `${withFinal}  "B"${ending}`,
      );
      const transition = addCynefinTransition(noFinal, {
        from: 'complex', label: 'Learn', to: 'complicated',
      });
      expect(transition).toBe(`${noFinal}${ending}  complex --> complicated : "Learn"`);
      await expectCynefin(transition);
    }

    const mixed = 'cynefin-beta\r\ncomplex\r  "A"\n  "B"\rcomplicated\r\n  "C"';
    const movedMixed = moveCynefinItem(
      mixed,
      itemIdentity(mixed, 'complex', 'B'),
      'complicated',
      0,
    );
    expect(movedMixed).toBe('cynefin-beta\r\ncomplex\r  "A"\ncomplicated\r  "B"\r\n  "C"');
    expect(movedMixed.match(/\r\n|\n|\r/gu)).toEqual(mixed.match(/\r\n|\n|\r/gu));
    expect(movedMixed.endsWith('\n')).toBe(false);
    await expectCynefin(movedMixed);

    const crFrontmatter = '\uFEFF---\rtitle: CR map\r---\rcynefin-beta\rcomplex\r  "A"';
    const addedToCrFrontmatter = addCynefinItem(
      crFrontmatter,
      { domain: 'confusion', label: 'Unknown' },
    );
    expect(addedToCrFrontmatter).toBe(`${crFrontmatter}\r  confusion\r    "Unknown"`);
    await expectCynefin(addedToCrFrontmatter);
  });
});
