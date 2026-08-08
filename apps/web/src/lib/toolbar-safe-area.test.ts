import { describe, expect, it } from 'vitest';
import { getSafeToolbarPosition } from './toolbar-safe-area';

describe('getSafeToolbarPosition', () => {
  it('keeps a selected-node toolbar inside a 320px canvas', () => {
    expect(getSafeToolbarPosition({
      anchor: { x: 316, y: 24 },
      canvas: { height: 220, width: 320 },
      toolbar: { height: 34, width: 188 },
    })).toEqual({ left: 120, top: 32 });
  });

  it('uses the preferred above position when it is safe', () => {
    expect(getSafeToolbarPosition({
      anchor: { x: 150, y: 120 },
      canvas: { height: 220, width: 320 },
      toolbar: { height: 34, width: 100 },
    })).toEqual({ left: 100, top: 78 });
  });

  it('clamps oversized controls rather than putting their action outside the canvas', () => {
    expect(getSafeToolbarPosition({
      anchor: { x: 0, y: 0 },
      canvas: { height: 44, width: 60 },
      toolbar: { height: 80, width: 120 },
    })).toEqual({ left: 12, top: 12 });
  });

  it('clamps contextual controls before an occluded right edge', () => {
    expect(getSafeToolbarPosition({
      anchor: { x: 650, y: 120 },
      canvas: { height: 240, width: 520, x: 0, y: 0 },
      toolbar: { height: 34, width: 188 },
    })).toEqual({ left: 320, top: 78 });
  });
});
