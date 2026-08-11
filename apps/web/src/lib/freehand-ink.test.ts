import { describe, expect, it } from 'vitest';
import { INK_MAX_DURABLE_POINTS, INK_MAX_PREVIEW_POINTS, INK_MAX_SERIALIZED_BYTES, INK_RENDER_FRAME_POINT_BUDGET, inkGeometry, simplifyInkPoints, validInkObject } from './freehand-ink';

describe('freehand ink', () => {
  it('quantizes, simplifies, and deterministically bounds a stress stroke', () => {
    const raw = Array.from({ length: 12_000 }, (_value, index) => ({ x: index / 3, y: Math.sin(index / 20) * 12, pressure: (index % 101) / 100 }));
    const first = simplifyInkPoints(raw);
    expect(first.length).toBeLessThanOrEqual(INK_MAX_DURABLE_POINTS);
    expect(first.length).toBeLessThanOrEqual(INK_RENDER_FRAME_POINT_BUDGET);
    expect(first).toEqual(simplifyInkPoints(raw));
    expect(first[0]).toMatchObject({ x: 0, y: 0 });
    expect(first.at(-1)?.x).toBe(3999.75);
    expect(simplifyInkPoints(raw, INK_MAX_PREVIEW_POINTS).length).toBeLessThanOrEqual(INK_MAX_PREVIEW_POINTS);
    expect(inkGeometry(first, 4)).toMatchObject({ rotation: 0 });
    expect(new TextEncoder().encode(JSON.stringify(first)).byteLength).toBeLessThanOrEqual(INK_MAX_SERIALIZED_BYTES);
  });

  it('accepts only finite immutable pen/highlighter records with explicit composite choice', () => {
    const object = {
      id: 'ink', kind: 'ink.stroke', version: 1, order_key: 'a',
      geometry: inkGeometry([{ x: 1, y: 2 }, { x: 4, y: 5, pressure: 0.5 }], 3),
      style: { color: '#2563eb', width: 3, opacity: 1 }, metadata: { export: 'composite-export' },
      payload: { mode: 'pen', composite_export: true, points: [{ x: 1, y: 2 }, { x: 4, y: 5, pressure: 0.5 }] },
    };
    expect(validInkObject(object)).toBe(true);
    expect(validInkObject({ ...object, payload: { ...object.payload, composite_export: undefined } })).toBe(false);
    expect(validInkObject({ ...object, payload: { ...object.payload, points: [{ x: Number.NaN, y: 2 }, { x: 4, y: 5 }] } })).toBe(false);
    expect(validInkObject({ ...object, geometry: { ...object.geometry, x: 1e308 } })).toBe(false);
    expect(validInkObject({ ...object, geometry: { ...object.geometry, width: object.geometry.width + 1 } })).toBe(false);
  });
});
