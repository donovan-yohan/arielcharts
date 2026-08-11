// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { addGitGraphBranch, addGitGraphCherryPick, addGitGraphCommit, addGitGraphMerge, addGitGraphCheckout, deleteGitGraphOperation, editGitGraphBranch, editGitGraphCheckout, editGitGraphCommit, editGitGraphMerge, getGitGraphDiagramSnapshot, getGitGraphOperationIdentity, isGitGraphSourceRepresentable, moveGitGraphOperation } from './gitgraph-mutations';

const SOURCE = `%% ordered history\ngitGraph LR:\n  commit id: "base"\n  branch feature order: 2\n  commit id: "feature" tag: "v1"\n  checkout main\n  commit id: "main"\n  merge feature id: "merge" type: HIGHLIGHT`;

describe('GitGraph source mutations', () => {
  it('keeps the supported history accepted by Mermaid 11.16.1', async () => {
    mermaid.initialize({ startOnLoad: false });
    await expect(mermaid.parse(SOURCE)).resolves.toMatchObject({ diagramType: 'gitGraph' });
  });
  it('models an ordered branch history and preserves unrelated source bytes', () => {
    expect(getGitGraphDiagramSnapshot(SOURCE)).toMatchObject({ direction: 'LR', operations: [{ kind: 'commit' }, { kind: 'branch' }, { kind: 'commit' }, { kind: 'checkout' }, { kind: 'commit' }, { kind: 'merge' }] });
    expect(addGitGraphCommit(SOURCE, { id: 'release', tags: ['v2'] })).toContain('%% ordered history');
  });
  it('rejects invalid branch, merge, cherry-pick, and unsafe syntax changes', () => {
    expect(isGitGraphSourceRepresentable('gitGraph\n  checkout missing')).toBe(false);
    expect(isGitGraphSourceRepresentable('gitGraph\n  commit id: "a"\n  merge main')).toBe(false);
    expect(isGitGraphSourceRepresentable('gitGraph\n  commit id: "a"\n  cherry-pick id: "a"')).toBe(false);
    expect(isGitGraphSourceRepresentable('gitGraph\n  commit id: "a"\n  commit id: "a"')).toBe(false);
    expect(isGitGraphSourceRepresentable('gitGraph\n  commit type: GLOW')).toBe(false);
    expect(isGitGraphSourceRepresentable('gitGraph\n  commit id: "a"\n  branch "unsafe branch"')).toBe(false);
    expect(() => addGitGraphMerge('gitGraph\n  commit', { branch: 'missing', tags: [] })).toThrow('representable');
  });
  it('validates cherry-pick source/parent semantics and ordered mutations', () => {
    const pickable = SOURCE.replace('\n  merge feature id: "merge" type: HIGHLIGHT', '');
    const picked = addGitGraphCherryPick(pickable, { id: 'feature', tags: ['picked'] });
    expect(picked).toContain('cherry-pick id: "feature" tag: "picked"');
    const operations = getGitGraphDiagramSnapshot(SOURCE).operations;
    expect(() => moveGitGraphOperation(SOURCE, getGitGraphOperationIdentity(operations[1]!, operations), 'up')).toThrow('representable');
    const withBranch = addGitGraphBranch('gitGraph\n  commit', { name: 'work' });
    const switched = addGitGraphCheckout(withBranch, { branch: 'main', keyword: 'switch' });
    expect(switched).toContain('switch main');
    const switchedOperations = getGitGraphDiagramSnapshot(switched).operations;
    expect(editGitGraphCheckout(switched, getGitGraphOperationIdentity(switchedOperations[2]!, switchedOperations), { keyword: 'checkout' })).toContain('checkout main');
    const sourceOperations = getGitGraphDiagramSnapshot(SOURCE).operations;
    expect(editGitGraphMerge(SOURCE, getGitGraphOperationIdentity(sourceOperations[5]!, sourceOperations), { type: 'REVERSE', tags: ['v2'] })).toContain('merge feature id: "merge" type: REVERSE tag: "v2"');
  });
  it('resolves unique operation fingerprints after remote prepends and fails closed for duplicates', () => {
    const operations = getGitGraphDiagramSnapshot(SOURCE).operations;
    const identity = getGitGraphOperationIdentity(operations[5]!, operations);
    const remotelyPrepended = SOURCE.replace('  commit id: "base"', '  commit id: "root"\n  commit id: "base"');
    expect(deleteGitGraphOperation(remotelyPrepended, identity)).not.toContain('merge feature');
    const linear = 'gitGraph\n  commit id: "base"\n  commit id: "first"\n  commit id: "second"';
    const linearOperations = getGitGraphDiagramSnapshot(linear).operations;
    const second = getGitGraphOperationIdentity(linearOperations[2]!, linearOperations);
    const remotelyPrependedLinear = linear.replace('  commit id: "base"', '  commit id: "root"\n  commit id: "base"');
    expect(editGitGraphCommit(remotelyPrependedLinear, second, { tags: ['edited'] })).toContain('commit id: "second" tag: "edited"');
    expect(moveGitGraphOperation(remotelyPrependedLinear, second, 'up')).toContain('commit id: "second"\n  commit id: "first"');
    const duplicated = 'gitGraph\n  commit\n  commit';
    const duplicateOperations = getGitGraphDiagramSnapshot(duplicated).operations;
    expect(() => deleteGitGraphOperation(duplicated, getGitGraphOperationIdentity(duplicateOperations[0]!, duplicateOperations))).toThrow('changed remotely');
    const ambiguous = getGitGraphOperationIdentity(duplicateOperations[0]!, duplicateOperations);
    expect(() => editGitGraphCommit(duplicated, ambiguous, { tags: ['nope'] })).toThrow('changed remotely');
    expect(() => moveGitGraphOperation(duplicated, ambiguous, 'down')).toThrow('changed remotely');
  });
  it('rejects a same-head merge pinned Mermaid rejects', async () => {
    const source = 'gitGraph\n  commit id: "base"\n  branch feature\n  checkout main\n  merge feature';
    mermaid.initialize({ startOnLoad: false });
    await expect(mermaid.parse(source)).rejects.toThrow();
    expect(isGitGraphSourceRepresentable(source)).toBe(false);
  });
  it('preserves physical terminators when moving operations', () => {
    for (const ending of ['\n', '\r\n', '\r']) {
      const source = ['gitGraph', '  commit id: "base"', '  commit id: "first"', '  commit id: "second"'].join(ending);
      const operations = getGitGraphDiagramSnapshot(source).operations;
      const moved = moveGitGraphOperation(source, getGitGraphOperationIdentity(operations[2]!, operations), 'up');
      expect(moved.match(/\r\n|\n|\r/g)).toEqual(source.match(/\r\n|\n|\r/g));
      expect(moved.endsWith(ending)).toBe(false);
    }
    const mixed = 'gitGraph\r\n  commit id: "base"\n  commit id: "first"\r  commit id: "second"';
    const operations = getGitGraphDiagramSnapshot(mixed).operations;
    expect(moveGitGraphOperation(mixed, getGitGraphOperationIdentity(operations[2]!, operations), 'up').match(/\r\n|\n|\r/g)).toEqual(mixed.match(/\r\n|\n|\r/g));
  });
  it('renames a branch and all original-document references atomically', () => {
    const source = `${SOURCE}\n  checkout feature`;
    const operations = getGitGraphDiagramSnapshot(source).operations;
    const renamed = editGitGraphBranch(source, getGitGraphOperationIdentity(operations[1]!, operations), { name: 'release' });
    expect(renamed).toContain('branch release order: 2');
    expect(renamed).toContain('merge release id: "merge"');
    expect(renamed).toContain('checkout release');
    expect(renamed).not.toContain('branch feature');
  });
});
