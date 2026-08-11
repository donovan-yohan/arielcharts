// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addWardleyEvolution,
  addWardleyLink,
  addWardleyNode,
  addWardleyNote,
  addWardleyPipeline,
  deleteWardleyEvolution,
  deleteWardleyLink,
  deleteWardleyNode,
  deleteWardleyNote,
  deleteWardleyPipeline,
  editWardleyEvolution,
  editWardleyLink,
  editWardleyNode,
  editWardleyNote,
  getWardleyDiagramSnapshot,
  getWardleyEvolutionIdentity,
  getWardleyLinkIdentity,
  getWardleyNodeIdentity,
  getWardleyNoteIdentity,
  getWardleyPipelineIdentity,
  isWardleySourceRepresentable,
  moveWardleyLink,
  moveWardleyNode,
  moveWardleyNote,
  renameWardleyNode,
  type WardleyDiagramSnapshot,
  type WardleyEvolutionIdentity,
  type WardleyLinkIdentity,
  type WardleyNode,
  type WardleyNodeIdentity,
  type WardleyNoteIdentity,
  type WardleyPipelineIdentity,
} from './wardley-mutations';

const SOURCE = `wardley-beta
  anchor User [0.95, 0.1]
  component "Web app" [0.75, 0.35] (build) inertia
  component Platform [0.5, 0.55] (buy)
  User -> "Web app"
  "Web app" +> Platform
  evolve Platform 0.8
  pipeline Platform {
    component Compute [0.6]
    component Storage [0.75]
  }
  note "Customer need" [0.9, 0.15]`;

function snapshot(source: string): WardleyDiagramSnapshot {
  return getWardleyDiagramSnapshot(source);
}
function nodeIdentity(source: string, name: string): WardleyNodeIdentity {
  const nodes = snapshot(source).nodes;
  const node = nodes.find((candidate) => candidate.name === name);
  if (!node) throw new Error(`Missing Wardley node ${name}.`);
  return getWardleyNodeIdentity(node, nodes);
}
function linkIdentity(source: string, index: number): WardleyLinkIdentity {
  const links = snapshot(source).links;
  return getWardleyLinkIdentity(links[index]!, links);
}
function evolutionIdentity(source: string, index = 0): WardleyEvolutionIdentity {
  const values = snapshot(source).evolutions;
  return getWardleyEvolutionIdentity(values[index]!, values);
}
function noteIdentity(source: string, index = 0): WardleyNoteIdentity {
  const notes = snapshot(source).notes;
  return getWardleyNoteIdentity(notes[index]!, notes);
}
function pipelineIdentity(source: string, index = 0): WardleyPipelineIdentity {
  const pipelines = snapshot(source).pipelines;
  return getWardleyPipelineIdentity(pipelines[index]!, pipelines);
}
async function expectWardley(source: string): Promise<void> {
  await expect(mermaid.parse(source)).resolves.toMatchObject({ diagramType: 'wardley' });
}

describe('Wardley source mutations', () => {
  it('snapshots the pinned safe grammar and preserves unchanged source', async () => {
    mermaid.initialize({ startOnLoad: false });
    expect(snapshot(SOURCE)).toEqual({
      evolutions: [{ component: 'Platform', target: 0.8 }],
      links: [
        { from: 'User', kind: '->', to: 'Web app' },
        { from: 'Web app', kind: '+>', to: 'Platform' },
      ],
      nodes: [
        { evolution: 0.1, inertia: false, kind: 'anchor', name: 'User', pipelineParent: null, strategy: null, visibility: 0.95 },
        { evolution: 0.35, inertia: true, kind: 'component', name: 'Web app', pipelineParent: null, strategy: 'build', visibility: 0.75 },
        { evolution: 0.55, inertia: false, kind: 'component', name: 'Platform', pipelineParent: null, strategy: 'buy', visibility: 0.5 },
        { evolution: 0.6, inertia: false, kind: 'pipeline-component', name: 'Compute', pipelineParent: 'Platform', strategy: null, visibility: null },
        { evolution: 0.75, inertia: false, kind: 'pipeline-component', name: 'Storage', pipelineParent: 'Platform', strategy: null, visibility: null },
      ],
      notes: [{ evolution: 0.15, text: 'Customer need', visibility: 0.9 }],
      pipelines: [{ parent: 'Platform' }],
    });
    expect(editWardleyNode(SOURCE, nodeIdentity(SOURCE, 'Web app'), { name: 'Web app' })).toBe(SOURCE);
    await expectWardley(SOURCE);
  });

  it('adds, edits, reorders, and deletes nodes with numeric and strategy validation', async () => {
    mermaid.initialize({ startOnLoad: false });
    const added = addWardleyNode(SOURCE, {
      evolution: 0.45,
      inertia: false,
      kind: 'component',
      name: 'API gateway',
      pipelineParent: null,
      strategy: 'outsource',
      visibility: 0.65,
    });
    await expectWardley(added);
    const edited = editWardleyNode(added, nodeIdentity(added, 'API gateway'), {
      evolution: 0.5,
      inertia: true,
      strategy: 'market',
      visibility: 0.7,
    });
    expect(edited).toContain('component "API gateway" [0.7, 0.5] (market) inertia');
    await expectWardley(edited);
    const moved = moveWardleyNode(edited, nodeIdentity(edited, 'API gateway'), 'up');
    expect(snapshot(moved).nodes.filter((node) => node.kind === 'component' && !node.pipelineParent).map((node) => node.name)).toEqual([
      'Web app', 'API gateway', 'Platform',
    ]);
    await expectWardley(moved);
    const deleted = deleteWardleyNode(moved, nodeIdentity(moved, 'API gateway'));
    expect(deleted).not.toContain('API gateway');
    await expectWardley(deleted);
    expect(() => addWardleyNode(SOURCE, { ...snapshot(SOURCE).nodes[1]!, name: 'Bad', visibility: Number.NaN })).toThrow(/finite numbers from 0 to 1/u);
    expect(() => addWardleyNode(SOURCE, { ...snapshot(SOURCE).nodes[1]!, name: 'Bad', evolution: 1.01 })).toThrow(/finite numbers from 0 to 1/u);
    expect(() => addWardleyNode(SOURCE, { ...snapshot(SOURCE).nodes[1]!, name: 'User' })).toThrow(/already exists/u);
    const precise = addWardleyNode(SOURCE, {
      ...snapshot(SOURCE).nodes[1]!, evolution: 1e-7, name: 'Precise', visibility: 1e-7,
    });
    expect(precise).toContain('component Precise [0.0000001, 0.0000001]');
    expect(precise).not.toMatch(/[eE]-[0-9]/u);
    await expectWardley(precise);
  });

  it('atomically renames every declared-node reference and rejects stale identities', async () => {
    mermaid.initialize({ startOnLoad: false });
    const identity = nodeIdentity(SOURCE, 'Platform');
    const renamed = renameWardleyNode(SOURCE, identity, 'Core platform');
    expect(renamed).toContain('component "Core platform" [0.5, 0.55]');
    expect(renamed).toContain('"Web app" +> "Core platform"');
    expect(renamed).toContain('evolve "Core platform" 0.8');
    expect(renamed).toContain('pipeline "Core platform" {');
    expect(snapshot(renamed).nodes.find((node) => node.name === 'Compute')?.pipelineParent).toBe('Core platform');
    await expectWardley(renamed);
    expect(renameWardleyNode(`%% remote prepend\n${SOURCE}`, identity, 'Safe prepend')).toContain('component "Safe prepend"');
    expect(() => renameWardleyNode(SOURCE.replace('component Platform [0.5, 0.55]', 'component Platform [0.5, 0.6]'), identity, 'Unsafe')).toThrow(/changed remotely/u);
    expect(() => deleteWardleyNode(renamed, identity)).toThrow(/changed remotely/u);
  });

  it('supports declared links and flows with exact ordered lifecycle', async () => {
    mermaid.initialize({ startOnLoad: false });
    const added = addWardleyLink(SOURCE, { from: 'User', kind: '-->', to: 'Platform' });
    await expectWardley(added);
    const edited = editWardleyLink(added, linkIdentity(added, 2), { kind: '-.->', to: 'Web app' });
    await expectWardley(edited);
    const moved = moveWardleyLink(edited, linkIdentity(edited, 2), 'up');
    expect(snapshot(moved).links[1]).toEqual({ from: 'User', kind: '-.->', to: 'Web app' });
    await expectWardley(moved);
    const deleted = deleteWardleyLink(moved, linkIdentity(moved, 1));
    await expectWardley(deleted);
    expect(() => addWardleyLink(SOURCE, { from: 'Missing', kind: '->', to: 'Platform' })).toThrow(/declared top-level/u);
    expect(() => addWardleyLink(SOURCE, { from: 'User', kind: '->', to: 'User' })).toThrow(/different nodes/u);
  });

  it('supports evolve, notes, and one-level pipelines', async () => {
    mermaid.initialize({ startOnLoad: false });
    let source = editWardleyEvolution(SOURCE, evolutionIdentity(SOURCE), { target: 0.9 });
    source = deleteWardleyEvolution(source, evolutionIdentity(source));
    source = addWardleyEvolution(source, { component: 'Web app', target: 0.7 });
    await expectWardley(source);
    source = addWardleyNote(source, { evolution: 0.25, text: 'Second note', visibility: 0.8 });
    source = editWardleyNote(source, noteIdentity(source, 1), { text: 'Updated note' });
    source = moveWardleyNote(source, noteIdentity(source, 1), 'up');
    source = deleteWardleyNote(source, noteIdentity(source, 1));
    await expectWardley(source);
    source = addWardleyNode(source, {
      evolution: 0.85, inertia: false, kind: 'pipeline-component', name: 'Database', pipelineParent: 'Platform', strategy: null, visibility: null,
    });
    expect(snapshot(source).nodes.find((node) => node.name === 'Database')?.pipelineParent).toBe('Platform');
    await expectWardley(source);
    const withoutPipeline = deleteWardleyPipeline(source, pipelineIdentity(source));
    expect(snapshot(withoutPipeline).nodes.some((node) => node.pipelineParent === 'Platform')).toBe(false);
    await expectWardley(withoutPipeline);
    const newPipeline = addWardleyPipeline(withoutPipeline, { componentEvolution: 0.5, componentName: 'Runtime', parent: 'Platform' });
    await expectWardley(newPipeline);
    expect(() => deleteWardleyNode(newPipeline, nodeIdentity(newPipeline, 'Runtime'))).toThrow(/must retain at least one component/u);
    expect(deleteWardleyPipeline(newPipeline, pipelineIdentity(newPipeline))).toBe(withoutPipeline);
  });

  it('preserves BOM, safe frontmatter, comments, mixed endings, and no-final-newline slots', async () => {
    mermaid.initialize({ startOnLoad: false });
    const source = '\uFEFF---\r\ntitle: Delivery\r\n---\n%% keep\r\nwardley-beta\r\n  component A [0.5, 0.5]\n  component B [0.4, 0.7]';
    expect(isWardleySourceRepresentable(source)).toBe(true);
    const edited = editWardleyNode(source, nodeIdentity(source, 'A'), { evolution: 0.6 });
    expect(edited.replace('[0.5, 0.6]', '[0.5, 0.5]')).toBe(source);
    const added = addWardleyLink(edited, { from: 'A', kind: '->', to: 'B' });
    expect(added.endsWith('\n')).toBe(false);
    await expectWardley(added);
    const deleted = deleteWardleyLink(added, linkIdentity(added, 0));
    expect(deleted.endsWith('\n')).toBe(false);
    await expectWardley(deleted);
  });

  it('patches only changed tokens while preserving authored spacing, quotes, comments, and line endings', async () => {
    mermaid.initialize({ startOnLoad: false });
    const source = `wardley-beta\r\n  component  'App' [ 0.75 , 0.35 ]   (build)   inertia  \n  component Platform [0.5,0.55]\r\n  'App'   +>   Platform\n  evolve   Platform   0.8\r\n  note  'Need' [ 0.9 , 0.15 ]`;
    let next = editWardleyNode(source, nodeIdentity(source, 'App'), { evolution: 0.4 });
    expect(next.replace('0.4 ]', '0.35 ]')).toBe(source);
    next = editWardleyLink(next, linkIdentity(next, 0), { kind: '+<>' });
    expect(next).toContain("'App'   +<>   Platform");
    next = editWardleyEvolution(next, evolutionIdentity(next), { target: 0.9 });
    expect(next).toContain('evolve   Platform   0.9\r\n');
    next = editWardleyNote(next, noteIdentity(next), { text: 'Need now' });
    expect(next).toContain("note  'Need now' [ 0.9 , 0.15 ]");
    await expectWardley(next);
  });

  it('fails closed for advanced, ambiguous, invalid-reference, and nested syntax without writes', async () => {
    mermaid.initialize({ startOnLoad: false });
    const advanced = [
      'wardley-beta\n  title Advanced\n  component A [0.5, 0.5]',
      'wardley-beta\n  size [800, 600]\n  component A [0.5, 0.5]',
      'wardley-beta\n  component A [0.5, 0.5] label [1, 2]',
      '%%{init: {"theme":"dark"}}%%\nwardley-beta\n  component A [0.5, 0.5]',
      '---\nconfig:\n  wardley:\n    seed: 0\n---\nwardley-beta\n  component A [0.5, 0.5]',
      'wardley-beta\n  component A [0.5, 0.5]\n  component A [0.4, 0.4]',
      'wardley-beta\n  anchor A [0.5, 0.5] (build)',
      'wardley-beta\n  component A [0.5, 0.5]\n  A -> Missing',
      'wardley-beta\n  component A [0.5, 0.5]\n  pipeline A {\n    pipeline Nested {\n    }\n  }',
      'wardley-beta\n  component A [0.5, 0.5]\n  pipeline A {\n  }',
    ];
    for (const source of advanced) {
      expect(isWardleySourceRepresentable(source)).toBe(false);
      expect(() => addWardleyNote(source, { evolution: 0.5, text: 'No write', visibility: 0.5 })).toThrow(/not a safely representable/u);
    }
    await expectWardley(advanced[0]!);
  });
});
