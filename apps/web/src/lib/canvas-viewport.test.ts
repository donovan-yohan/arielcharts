import { describe, expect, it } from 'vitest';
import { getUnobscuredCanvasViewport } from './canvas-viewport';

const canvas = { bottom: 600, height: 600, left: 100, right: 1000, top: 0, width: 900 };

describe('getUnobscuredCanvasViewport', () => {
  it('subtracts a right-side flyout in canvas-local coordinates', () => {
    expect(getUnobscuredCanvasViewport(canvas, [
      { bottom: 600, height: 600, left: 620, right: 1000, top: 0, width: 380 },
    ])).toEqual({ height: 600, width: 520, x: 0, y: 0 });
  });

  it('keeps the largest usable region for a partial overlay', () => {
    expect(getUnobscuredCanvasViewport(canvas, [
      { bottom: 600, height: 300, left: 100, right: 1000, top: 300, width: 900 },
    ])).toEqual({ height: 300, width: 900, x: 0, y: 0 });
  });

  it('ignores overlays outside the canvas', () => {
    expect(getUnobscuredCanvasViewport(canvas, [
      { bottom: 200, height: 100, left: 1100, right: 1200, top: 100, width: 100 },
    ])).toEqual({ height: 600, width: 900, x: 0, y: 0 });
  });
});
