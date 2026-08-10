import { describe, expect, it } from 'vitest';
import {
  areCanvasAwarenessStatesEqual,
  getRemoteCanvasPresence,
  hasCanvasCursorMovedEnough,
  quantizeCanvasCursor,
} from './canvas-presence';

describe('canvas presence', () => {
  it('keeps only active-diagram, remote canvas awareness with stable client ids', () => {
    const states = new Map<number, unknown>([
      [1, { user: { name: 'Local', color: '#0af', type: 'human' }, canvas: { diagram_id: 'main', cursor: { x: 4, y: 8 } } }],
      [9, { user: { name: 'Other', color: '#f0a', type: 'human' }, canvas: { diagram_id: 'main', cursor: { x: 12, y: 16 }, selected_node_ids: ['A', 'A', 'B'] } }],
      [3, { user: { name: 'Elsewhere', color: '#0f8', type: 'human' }, canvas: { diagram_id: 'other', cursor: { x: 1, y: 2 } } }],
      [4, { user: { name: 'Malformed', color: '#0f8', type: 'human' }, canvas: { diagram_id: 'main', cursor: { x: Number.NaN, y: 2 } } }],
    ]);

    expect(getRemoteCanvasPresence(states, 1, 'main')).toEqual([{
      client_id: 9,
      participant: { name: 'Other', color: '#f0a', type: 'human' },
      canvas: { diagram_id: 'main', cursor: { x: 12, y: 16 }, selected_node_ids: ['A', 'B'] },
    }]);
  });

  it('quantizes and suppresses tiny cursor movement while keeping selection equality exact', () => {
    expect(quantizeCanvasCursor({ x: 9, y: 14 })).toEqual({ x: 8, y: 16 });
    expect(hasCanvasCursorMovedEnough({ x: 8, y: 16 }, { x: 8, y: 16 })).toBe(false);
    expect(hasCanvasCursorMovedEnough({ x: 8, y: 16 }, { x: 12, y: 16 })).toBe(true);
    expect(areCanvasAwarenessStatesEqual(
      { diagram_id: 'main', selected_node_ids: ['A'] },
      { diagram_id: 'main', selected_node_ids: ['A'] },
    )).toBe(true);
    expect(areCanvasAwarenessStatesEqual(
      { diagram_id: 'main', selected_node_ids: ['A'] },
      { diagram_id: 'main', selected_node_ids: ['B'] },
    )).toBe(false);
  });
});
