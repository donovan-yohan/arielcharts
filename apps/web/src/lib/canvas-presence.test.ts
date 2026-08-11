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
      [9, { user: { name: 'Other', color: '#f0a', type: 'human' }, canvas: { diagram_id: 'main', cursor: { x: 12, y: 16 }, selected_node_ids: ['A', 'A', 'B'], editing_node_id: 'A' } }],
      [3, { user: { name: 'Elsewhere', color: '#0f8', type: 'human' }, canvas: { diagram_id: 'other', cursor: { x: 1, y: 2 } } }],
      [4, { user: { name: 'Malformed', color: '#0f8', type: 'human' }, canvas: { diagram_id: 'main', cursor: { x: Number.NaN, y: 2 } } }],
    ]);

    expect(getRemoteCanvasPresence(states, 1, 'main')).toEqual([{
      client_id: 9,
      participant: { name: 'Other', color: '#f0a', type: 'human' },
      canvas: { diagram_id: 'main', cursor: { x: 12, y: 16 }, selected_node_ids: ['A', 'B'], editing_node_id: 'A' },
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
    expect(areCanvasAwarenessStatesEqual(
      { diagram_id: 'main', editing_node_id: 'A' },
      { diagram_id: 'main', editing_node_id: 'B' },
    )).toBe(false);
    expect(areCanvasAwarenessStatesEqual(
      { diagram_id: 'main', laser: { active: true, sequence: 1, point: { x: 2, y: 4 } } },
      { diagram_id: 'main', laser: { active: true, sequence: 2, point: { x: 2, y: 4 } } },
    )).toBe(false);
  });

  it('accepts bounded laser samples and rejects malformed laser state atomically', () => {
    const participant = { name: 'Other', color: '#f0a', type: 'human' as const };
    expect(getRemoteCanvasPresence(new Map([
      [9, { user: participant, canvas: { diagram_id: 'main', laser: { active: true, sequence: 4, point: { x: 12, y: 16 } } } }],
    ]), 1, 'main')[0]?.canvas.laser).toEqual({ active: true, sequence: 4, point: { x: 12, y: 16 } });
    expect(getRemoteCanvasPresence(new Map([
      [9, { user: participant, canvas: { diagram_id: 'main', laser: { active: true, sequence: 5, point: { x: Number.NaN, y: 16 } } } }],
    ]), 1, 'main')).toEqual([]);
    expect(getRemoteCanvasPresence(new Map([
      [9, { user: participant, canvas: { diagram_id: 'main', laser: { active: false, sequence: 6, point: { x: 1, y: 2 } } } }],
    ]), 1, 'main')).toEqual([]);
  });

  it('drops malformed editing awareness with the same all-or-nothing policy as other canvas fields', () => {
    const states = new Map<number, unknown>([
      [9, { user: { name: 'Other', color: '#f0a', type: 'human' }, canvas: { diagram_id: 'main', editing_node_id: '' } }],
    ]);
    expect(getRemoteCanvasPresence(states, 1, 'main')).toEqual([]);
  });
});
