import type { OverlayGeometry, OverlayWorldPoint } from '@arielcharts/shared';
import { describe, expect, it } from 'vitest';
import {
  beginOverlayTransformDraft,
  normalizeOverlayRotation,
  resizeOverlayDraft,
  resizeOverlayGeometry,
  resizeOverlayLineEndpoint,
  rotateOverlayDraft,
  rotateOverlayGeometry,
} from './overlay-transform';
import type { OverlayResizeHandle } from './overlay-transform';

const base: OverlayGeometry = { x: 100, y: 200, width: 120, height: 80, rotation: 0 };

function worldPoint(geometry: OverlayGeometry, local: OverlayWorldPoint) {
  const radians = geometry.rotation * Math.PI / 180;
  const cosine = Math.cos(radians); const sine = Math.sin(radians);
  const center = { x: geometry.x + geometry.width / 2, y: geometry.y + geometry.height / 2 };
  const vector = { x: local.x - geometry.width / 2, y: local.y - geometry.height / 2 };
  return { x: center.x + (vector.x * cosine) - (vector.y * sine), y: center.y + (vector.x * sine) + (vector.y * cosine) };
}

function expectPoint(left: OverlayWorldPoint, right: OverlayWorldPoint) {
  expect(left.x).toBeCloseTo(right.x, 8);
  expect(left.y).toBeCloseTo(right.y, 8);
}

describe('overlay transform geometry', () => {
  it('resizes all box-handle orientations while preserving each opposite world anchor', () => {
    const geometry = { ...base, rotation: 45 };
    const opposite: Record<OverlayResizeHandle, OverlayWorldPoint> = {
      nw: { x: geometry.width, y: geometry.height }, n: { x: geometry.width / 2, y: geometry.height }, ne: { x: 0, y: geometry.height },
      e: { x: 0, y: geometry.height / 2 }, se: { x: 0, y: 0 }, s: { x: geometry.width / 2, y: 0 },
      sw: { x: geometry.width, y: 0 }, w: { x: geometry.width, y: geometry.height / 2 },
    };
    for (const handle of Object.keys(opposite) as OverlayResizeHandle[]) {
      const before = worldPoint(geometry, opposite[handle]);
      const next = resizeOverlayGeometry(geometry, handle, { x: 30, y: -20 }, { zoom: 1 });
      const local = opposite[handle];
      const mapped = {
        x: local.x === geometry.width ? next.width : local.x === 0 ? 0 : next.width / 2,
        y: local.y === geometry.height ? next.height : local.y === 0 ? 0 : next.height / 2,
      };
      expectPoint(worldPoint(next, mapped), before);
      expect(next.width).toBeGreaterThanOrEqual(24);
      expect(next.height).toBeGreaterThanOrEqual(24);
    }
  });

  it('uses inverse zoom and object rotation for screen-space resize deltas', () => {
    const right = resizeOverlayGeometry(base, 'e', { x: 40, y: 0 }, { zoom: 2 });
    expect(right).toMatchObject({ x: 100, y: 200, width: 140, height: 80 });
    const turned = resizeOverlayGeometry({ ...base, rotation: 90 }, 'e', { x: 0, y: 30 }, { zoom: 1 });
    expect(turned.width).toBeCloseTo(150);
    expectPoint(worldPoint(turned, { x: 0, y: turned.height / 2 }), worldPoint({ ...base, rotation: 90 }, { x: 0, y: base.height / 2 }));
  });

  it('uses a diamond’s durable 45 degree rotation for both visual bounds and inverse resize math', () => {
    const diamond = { ...base, width: 112, height: 112, rotation: 45 };
    const fixedCorner = worldPoint(diamond, { x: 0, y: 0 });
    const resized = resizeOverlayGeometry(diamond, 'se', { x: 36, y: 0 }, { zoom: 1 });
    expect(resized.rotation).toBe(45);
    expectPoint(worldPoint(resized, { x: 0, y: 0 }), fixedCorner);
  });

  it('clamps crossing drags without flipping the handle identity', () => {
    const next = resizeOverlayGeometry(base, 'e', { x: -1000, y: 0 }, { zoom: 1, minWidth: 24 });
    expect(next.width).toBe(24);
    expectPoint(worldPoint(next, { x: 0, y: next.height / 2 }), worldPoint(base, { x: 0, y: base.height / 2 }));
  });

  it('keeps the original aspect ratio when shift is held', () => {
    const next = resizeOverlayGeometry({ ...base, width: 120, height: 60 }, 'se', { x: 60, y: 1 }, { zoom: 1, shiftKey: true });
    expect(next.width / next.height).toBeCloseTo(2);
    expect(next.width).toBeCloseTo(180);
    expectPoint(worldPoint(next, { x: 0, y: 0 }), worldPoint({ ...base, width: 120, height: 60 }, { x: 0, y: 0 }));
  });

  it('treats lines and arrows as movable endpoint vectors', () => {
    const line = { x: 10, y: 20, width: 80, height: 30, rotation: 73 };
    expect(resizeOverlayLineEndpoint(line, 'end', { x: 20, y: -10 }, 2)).toEqual({ x: 10, y: 20, width: 90, height: 25, rotation: 0 });
    expect(resizeOverlayLineEndpoint(line, 'start', { x: 20, y: -10 }, 2)).toEqual({ x: 20, y: 15, width: 70, height: 35, rotation: 0 });
  });

  it('preserves endpoint identity while crossing in every quadrant', () => {
    const line = { x: 10, y: 20, width: 80, height: 30, rotation: 0 };
    expect(resizeOverlayLineEndpoint(line, 'end', { x: -200, y: -100 }, 1)).toEqual({ x: 10, y: 20, width: -120, height: -70, rotation: 0 });
    expect(resizeOverlayLineEndpoint(line, 'start', { x: 200, y: 100 }, 1)).toEqual({ x: 210, y: 120, width: -120, height: -70, rotation: 0 });
    for (const delta of [{ x: -120, y: 80 }, { x: 120, y: -80 }, { x: -120, y: -80 }, { x: 120, y: 80 }]) {
      const resized = resizeOverlayLineEndpoint(line, 'end', delta, 1);
      expect(resized.x).toBe(line.x);
      expect(resized.y).toBe(line.y);
      expect(resized.width).toBe(line.width + delta.x);
      expect(resized.height).toBe(line.height + delta.y);
    }
  });

  it('rotates from the centre and shift-snaps to 15 degree increments', () => {
    const center = { x: 160, y: 240 };
    const quarter = rotateOverlayGeometry(base, center, { x: 160, y: 200 }, { x: 200, y: 240 });
    expect(quarter.rotation).toBe(90);
    const snapped = rotateOverlayGeometry(base, center, { x: 200, y: 240 }, { x: 198, y: 251 }, { shiftKey: true });
    expect(snapped.rotation).toBe(15);
    expect(normalizeOverlayRotation(-15)).toBe(345);
    expect(normalizeOverlayRotation(720)).toBe(0);
  });

  it('keeps local pointer drafts immutable and derived from their first pointer location', () => {
    const draft = beginOverlayTransformDraft('shape', base, { x: 40, y: 60 });
    const next = resizeOverlayDraft(draft, 'e', { x: 80, y: 60 }, { zoom: 2 });
    expect(next.width).toBe(140);
    expect(draft.expectedGeometry).toEqual(base);
    const rotationDraft = beginOverlayTransformDraft('shape', base, { x: 140, y: 100 });
    expect(rotateOverlayDraft(rotationDraft, { x: 100, y: 100 }, { x: 100, y: 140 }).rotation).toBe(90);
  });
});
