import { describe, expect, it } from 'vitest';
import { applyCanvasWheelGesture, getCanvasWheelGesture, getSafariPinchZoomScale } from './canvas-wheel-gesture';

describe('canvas wheel gestures', () => {
  it('turns ordinary two-finger scrolling into a camera pan without changing zoom', () => {
    const gesture = getCanvasWheelGesture(
      { ctrlKey: false, deltaMode: 0, deltaX: 12, deltaY: 30 },
      { x: 140, y: 80 },
    );

    expect(gesture).toEqual({ delta: { x: -12, y: -30 }, kind: 'pan' });
    expect(applyCanvasWheelGesture(
      { panX: 24, panY: 36, zoom: 1.5 },
      gesture,
      { left: 10, top: 20 },
      0.1,
      4,
    )).toEqual({ panX: 12, panY: 6, zoom: 1.5 });
  });

  it('uses the macOS pinch ctrl-wheel signal for a bounded, practical zoom', () => {
    const gesture = getCanvasWheelGesture(
      { ctrlKey: true, deltaMode: 0, deltaX: 0, deltaY: -500 },
      { x: 150, y: 120 },
    );

    expect(gesture).toMatchObject({ client: { x: 150, y: 120 }, kind: 'zoom' });
    expect(gesture.kind === 'zoom' && gesture.scale).toBeCloseTo(Math.exp(0.24));
  });

  it('makes ordinary small pinches useful while sustained input remains bounded', () => {
    const smallPinch = getCanvasWheelGesture(
      { ctrlKey: true, deltaMode: 0, deltaX: 0, deltaY: -8 },
      { x: 150, y: 120 },
    );
    expect(smallPinch.kind === 'zoom' && smallPinch.scale).toBeGreaterThan(1.03);

    const sustainedPinch = getCanvasWheelGesture(
      { ctrlKey: true, deltaMode: 0, deltaX: 0, deltaY: -500 },
      { x: 150, y: 120 },
    );
    const next = applyCanvasWheelGesture(
      { panX: 0, panY: 0, zoom: 3.9 },
      sustainedPinch,
      { left: 0, top: 0 },
      0.1,
      4,
    );
    expect(next.zoom).toBe(4);
  });

  it('uses an equivalently practical bounded scale for Safari gesture events', () => {
    expect(getSafariPinchZoomScale(1.1, 1)).toBeCloseTo(Math.pow(1.1, 0.8));
    expect(getSafariPinchZoomScale(1, 0)).toBe(1);
    expect(getSafariPinchZoomScale(-1, 1)).toBe(1);
  });

  it('keeps the cursor canvas point anchored while zooming', () => {
    const camera = { panX: 20, panY: 30, zoom: 2 };
    const origin = { left: 10, top: 15 };
    const client = { x: 150, y: 120 };
    const anchoredCanvasPoint = {
      x: (client.x - origin.left - camera.panX) / camera.zoom,
      y: (client.y - origin.top - camera.panY) / camera.zoom,
    };
    const next = applyCanvasWheelGesture(camera, {
      client,
      kind: 'zoom',
      scale: 1.05,
    }, origin, 0.1, 4);

    expect({
      x: origin.left + next.panX + (anchoredCanvasPoint.x * next.zoom),
      y: origin.top + next.panY + (anchoredCanvasPoint.y * next.zoom),
    }).toEqual(client);
    expect(next.zoom).toBeCloseTo(2.1);
  });
});
