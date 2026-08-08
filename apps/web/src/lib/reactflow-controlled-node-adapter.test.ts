import type { Node, NodeChange } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import {
  applyControlledNodeChanges,
  applyControlledSelectionChanges,
  composeControlledNodes,
  createControlledNodeComposer,
  releaseControlledNodeRuntime,
  type ControlledNodeRuntime,
} from './reactflow-controlled-node-adapter';

type TestNode = Node<{ label: string }, 'test'>;

function node(id: string, x: number, y: number, label = id): TestNode {
  return {
    data: { label },
    id,
    position: { x, y },
    selected: false,
    style: { height: 40, width: 80 },
    type: 'test',
  };
}

function positionChange(id: string, x: number, y: number, dragging: boolean): NodeChange<TestNode> {
  return { dragging, id, position: { x, y }, type: 'position' };
}

describe('controlled React Flow node adapter', () => {
  it('routes React Flow select changes into app-owned Shift and ordinary click selection', () => {
    const selectedA = applyControlledSelectionChanges([], [{ id: 'A', selected: true, type: 'select' }]);
    const selectedAAndB = applyControlledSelectionChanges(selectedA, [{ id: 'B', selected: true, type: 'select' }]);
    const selectedOnlyB = applyControlledSelectionChanges(selectedA, [
      { id: 'A', selected: false, type: 'select' },
      { id: 'B', selected: true, type: 'select' },
    ]);

    expect(selectedAAndB).toEqual(['A', 'B']);
    expect(selectedOnlyB).toEqual(['B']);
    expect(applyControlledSelectionChanges(selectedA, [{ id: 'A', selected: true, type: 'select' }])).toBe(selectedA);
    expect(applyControlledSelectionChanges(selectedA, [positionChange('A', 8, 9, true)])).toBe(selectedA);
  });

  it('preserves measured and active positions across canonical rerenders while canonical fields win', () => {
    const canonical = [node('A', 10, 20, 'canonical')];
    const activeIds = new Set(['A']);
    const runtime = applyControlledNodeChanges(canonical, {}, [
      { dimensions: { height: 44, width: 88 }, id: 'A', type: 'dimensions' },
      positionChange('A', 40, 60, true),
      { id: 'A', selected: true, type: 'select' },
      { id: 'A', item: node('A', 0, 0, 'replacement'), type: 'replace' },
    ], activeIds);
    const rerendered = [node('A', 12, 24, 'new canonical')];
    const effective = composeControlledNodes(rerendered, runtime);

    expect(effective).toMatchObject([{
      data: { label: 'new canonical' },
      position: { x: 40, y: 60 },
      selected: false,
      style: { height: 40, width: 80 },
      type: 'test',
    }]);
    expect(effective[0]?.measured).toEqual({ height: 44, width: 88 });
    expect(applyControlledNodeChanges(rerendered, runtime, [], activeIds)).toBe(runtime);

    const measuredOnly = applyControlledNodeChanges(canonical, {}, [
      { dimensions: { height: 44, width: 88 }, id: 'A', type: 'dimensions' },
    ], activeIds);
    expect(applyControlledNodeChanges(canonical, measuredOnly, [], activeIds)).toBe(measuredOnly);
  });

  it('releases local ownership after the durable flush so a canonical winner cannot be masked', () => {
    const activeIds = new Set(['A']);
    const initial = [node('A', 10, 20)];
    const duringDrag = applyControlledNodeChanges(initial, {}, [
      { dimensions: { height: 44, width: 88 }, id: 'A', type: 'dimensions' },
      positionChange('A', 50, 70, true),
    ], activeIds);
    const released = releaseControlledNodeRuntime(duringDrag, ['A']);
    const canonicalWinner = [node('A', 90, 110, 'canonical winner')];
    const afterQueuedStop = applyControlledNodeChanges(
      canonicalWinner,
      released,
      [positionChange('A', 50, 70, false)],
      new Set(),
    );

    expect(composeControlledNodes(canonicalWinner, afterQueuedStop)[0]).toMatchObject({
      data: { label: 'canonical winner' },
      position: { x: 90, y: 110 },
    });
    expect(afterQueuedStop).toEqual({ A: { measured: { height: 44, width: 88 } } });
  });

  it('updates every position in a multi-node drag batch without admitting structural changes', () => {
    const canonical = [node('A', 0, 0), node('B', 20, 20)];
    const runtime: ControlledNodeRuntime = applyControlledNodeChanges(canonical, {}, [
      positionChange('A', 8, 9, true),
      positionChange('B', 28, 29, true),
      { id: 'A', type: 'remove' },
      { item: node('C', 1, 1), type: 'add' },
    ], new Set(['A', 'B']));

    expect(composeControlledNodes(canonical, runtime).map((value) => value.position)).toEqual([
      { x: 8, y: 9 },
      { x: 28, y: 29 },
    ]);
    expect(Object.keys(runtime)).toEqual(['A', 'B']);
  });

  it('prunes runtime state only for canonical ids that disappear', () => {
    const canonical = [node('A', 0, 0), node('B', 20, 20)];
    const runtime = applyControlledNodeChanges(canonical, {}, [
      { dimensions: { height: 44, width: 88 }, id: 'A', type: 'dimensions' },
      positionChange('A', 8, 9, true),
      { dimensions: { height: 45, width: 89 }, id: 'B', type: 'dimensions' },
      positionChange('B', 28, 29, true),
    ], new Set(['A', 'B']));
    const canonicalWithoutB = [node('A', 0, 0)];
    const pruned = applyControlledNodeChanges(canonicalWithoutB, runtime, [
      { id: 'B', type: 'remove' },
      { item: node('C', 1, 1), type: 'add' },
    ], new Set());

    expect(pruned).toMatchObject({
      A: {
        measured: { height: 44, width: 88 },
        position: { x: 8, y: 9 },
      },
    });
    expect(pruned.B).toBeUndefined();
    expect(pruned.C).toBeUndefined();
  });

  it('keeps an unaffected stable-id composed node when another node runtime changes', () => {
    const composer = createControlledNodeComposer<TestNode>();
    const canonical = [node('A', 0, 0), node('B', 20, 20)];
    const first = composer.compose(canonical, {});
    const nextCanonical = canonical.map((value) => ({
      ...value,
      data: { ...value.data },
      position: { ...value.position },
      style: { ...value.style },
    }));
    const runtime = applyControlledNodeChanges(nextCanonical, {}, [positionChange('A', 8, 9, true)], new Set(['A']));
    const second = composer.compose(nextCanonical, runtime);

    expect(second[0]).not.toBe(first[0]);
    expect(second[1]).toBe(first[1]);
  });
});
