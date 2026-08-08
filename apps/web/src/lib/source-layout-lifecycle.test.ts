import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { DragLayoutCommitter } from './drag-layout';
import { readNodePositions, writeNodePositions } from './diagram-layout';
import {
  getAcceptedGenericSourceLayoutPolicy,
  getSourceLayoutPolicy,
  pruneNodePositions,
} from './source-layout-lifecycle';

describe('source layout lifecycle', () => {
  it('synchronously allows only canonical flowchart node ids', () => {
    const policy = getSourceLayoutPolicy('flowchart LR\n  A --> B\n  B --> C\n  C --> D');

    expect(policy).toMatchObject({ kind: 'flowchart', pruneDurablePositions: true });
    expect([...policy.nodeIds].sort()).toEqual(['A', 'B', 'C', 'D']);
  });

  it('prunes durable layout for blank or accepted generic source but preserves it during parse failure', () => {
    const settled = { A: { x: 10, y: 20 } };
    expect(getSourceLayoutPolicy('   ')).toMatchObject({ kind: 'blank', pruneDurablePositions: true });
    expect(getSourceLayoutPolicy('not valid Mermaid')).toMatchObject({ kind: 'indeterminate', pruneDurablePositions: false });
    expect(getAcceptedGenericSourceLayoutPolicy()).toMatchObject({ kind: 'generic', pruneDurablePositions: true });
    expect(pruneNodePositions(settled, getSourceLayoutPolicy('   ').nodeIds).removed).toEqual(settled);
    expect(pruneNodePositions(settled, getAcceptedGenericSourceLayoutPolicy().nodeIds).removed).toEqual(settled);
  });

  it('drops removed ids so a later Mermaid id reuse has no stale coordinate', () => {
    const positions = {
      A: { x: 10, y: 20 },
      B: { x: 30, y: 40 },
    };
    const removedA = pruneNodePositions(positions, new Set(['B']));
    const reintroducedA = pruneNodePositions(removedA.retained, new Set(['A', 'B']));

    expect(removedA).toEqual({
      removed: { A: { x: 10, y: 20 } },
      retained: { B: { x: 30, y: 40 } },
    });
    expect(reintroducedA.retained).toEqual({ B: { x: 30, y: 40 } });
  });

  it('cancels a removed node pending drag before a reused Mermaid id can receive it', () => {
    vi.useFakeTimers();
    const doc = new Y.Doc();
    const positions = doc.getMap<{ x: number; y: number }>('positions');
    writeNodePositions(positions, { A: { x: 1, y: 2 } });
    const committer = new DragLayoutCommitter((pending) => writeNodePositions(positions, pending), 120);
    const initialPolicy = getSourceLayoutPolicy('flowchart LR\n  A --> B');
    committer.setAllowedNodeIds(initialPolicy.nodeIds);
    committer.begin(['A']);
    committer.update({ A: { x: 50, y: 60 } });

    const removedPolicy = getSourceLayoutPolicy('flowchart LR\n  B --> C');
    committer.setAllowedNodeIds(removedPolicy.nodeIds);
    const removed = pruneNodePositions(readNodePositions(positions), removedPolicy.nodeIds);
    writeNodePositions(positions, removed.removed, 'remove');
    vi.advanceTimersByTime(120);

    const reintroducedPolicy = getSourceLayoutPolicy('flowchart LR\n  A --> B');
    committer.setAllowedNodeIds(reintroducedPolicy.nodeIds);
    expect(readNodePositions(positions)).toEqual({});
    expect(readNodePositions(positions).A).toBeUndefined();
    vi.useRealTimers();
    doc.destroy();
  });
});
