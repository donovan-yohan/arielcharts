import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { readNodePositions, writeNodePositions } from './diagram-layout';

describe('collaborative node position writes', () => {
  it('merges a single position without deleting concurrent collaborator positions', () => {
    const doc = new Y.Doc();
    const positions = doc.getMap<{ x: number; y: number }>('nodePositions');
    positions.set('A', { x: 1, y: 2 });
    positions.set('B', { x: 3, y: 4 });

    writeNodePositions(positions, { C: { x: 5, y: 6 } }, 'merge');

    expect(readNodePositions(positions)).toEqual({
      A: { x: 1, y: 2 },
      B: { x: 3, y: 4 },
      C: { x: 5, y: 6 },
    });
  });

  it('only deletes missing positions for explicit replace/reset writes', () => {
    const doc = new Y.Doc();
    const positions = doc.getMap<{ x: number; y: number }>('nodePositions');
    positions.set('A', { x: 1, y: 2 });
    positions.set('B', { x: 3, y: 4 });

    writeNodePositions(positions, { A: { x: 10, y: 20 } }, 'replace');

    expect(readNodePositions(positions)).toEqual({
      A: { x: 10, y: 20 },
    });
  });
});
