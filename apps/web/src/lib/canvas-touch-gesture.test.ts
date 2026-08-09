import { describe, expect, it } from 'vitest';
import { applyCanvasTouchGesture, CanvasTouchGestureController } from './canvas-touch-gesture';

describe('CanvasTouchGestureController', () => {
  it('reports one-pointer pan deltas only for accepted pointer starts', () => {
    const controller = new CanvasTouchGestureController();

    expect(controller.move(1, { x: 20, y: 10 })).toBeNull();
    expect(controller.begin(1, { x: 12, y: 8 })).toBe(true);
    expect(controller.move(1, { x: 20, y: 10 })).toEqual({
      center: { x: 20, y: 10 },
      delta: { x: 8, y: 2 },
      kind: 'pan',
    });
  });

  it('reports a two-pointer pinch scale and midpoint translation', () => {
    const controller = new CanvasTouchGestureController();
    controller.begin(1, { x: 10, y: 10 });
    controller.begin(2, { x: 30, y: 10 });

    expect(controller.move(2, { x: 50, y: 10 })).toEqual({
      center: { x: 30, y: 10 },
      delta: { x: 10, y: 0 },
      kind: 'pinch',
      scale: 2,
    });
  });

  it('returns to a pan after one pointer ends', () => {
    const controller = new CanvasTouchGestureController();
    controller.begin(1, { x: 10, y: 10 });
    controller.begin(2, { x: 30, y: 10 });
    controller.end(2);

    expect(controller.move(1, { x: 14, y: 7 })).toMatchObject({
      delta: { x: 4, y: -3 },
      kind: 'pan',
    });
  });

  it('limits an interaction to two pointers', () => {
    const controller = new CanvasTouchGestureController();
    expect(controller.begin(1, { x: 0, y: 0 })).toBe(true);
    expect(controller.begin(2, { x: 10, y: 0 })).toBe(true);
    expect(controller.begin(3, { x: 20, y: 0 })).toBe(false);
  });

  it('keeps the same canvas point under a translated pinch midpoint', () => {
    const camera = { panX: 20, panY: 30, zoom: 2 };
    const origin = { left: 10, top: 15 };
    const gesture = {
      center: { x: 150, y: 120 },
      delta: { x: 10, y: -5 },
      kind: 'pinch' as const,
      scale: 1.5,
    };
    const previousCenter = {
      x: gesture.center.x - gesture.delta.x - origin.left,
      y: gesture.center.y - gesture.delta.y - origin.top,
    };
    const anchoredCanvasPoint = {
      x: (previousCenter.x - camera.panX) / camera.zoom,
      y: (previousCenter.y - camera.panY) / camera.zoom,
    };

    const next = applyCanvasTouchGesture(camera, gesture, origin, 0.1, 4);

    expect({
      x: origin.left + next.panX + (anchoredCanvasPoint.x * next.zoom),
      y: origin.top + next.panY + (anchoredCanvasPoint.y * next.zoom),
    }).toEqual(gesture.center);
    expect(next.zoom).toBe(3);
  });
});
