import { describe, expect, it } from 'vitest';
import { beginCanvasMousePan, CanvasMousePanController } from './canvas-mouse-pan';

describe('CanvasMousePanController', () => {
  it('ignores queued movement after the releasing pointer has ended', () => {
    const controller = new CanvasMousePanController();
    controller.begin(7, { x: 100, y: 80 }, { panX: 24, panY: 24 });

    expect(controller.move(7, { x: 145, y: 112 })).toEqual({ panX: 69, panY: 56 });
    expect(controller.end(7)).toBe(true);
    expect(controller.move(7, { x: 260, y: 200 })).toBeNull();
    expect(controller.isActive).toBe(false);
  });

  it('does not let an unrelated pointer end or move steal an active pan', () => {
    const controller = new CanvasMousePanController();
    controller.begin(3, { x: 10, y: 20 }, { panX: 4, panY: 8 });

    expect(controller.end(9)).toBe(false);
    expect(controller.move(9, { x: 100, y: 100 })).toBeNull();
    expect(controller.move(3, { x: 18, y: 14 })).toEqual({ panX: 12, panY: 2 });
  });

  it('rejects a second pointer while the first pointer owns the camera', () => {
    const controller = new CanvasMousePanController();

    expect(controller.begin(3, { x: 10, y: 20 }, { panX: 4, panY: 8 })).toBe(true);
    expect(controller.begin(9, { x: 1, y: 2 }, { panX: 0, panY: 0 })).toBe(false);
    expect(controller.move(3, { x: 18, y: 14 })).toEqual({ panX: 12, panY: 2 });
  });

  it('rolls back mouse-pan ownership when pointer capture fails', () => {
    const controller = new CanvasMousePanController();

    expect(beginCanvasMousePan(
      controller,
      { setPointerCapture: () => { throw new Error('not active'); } },
      3,
      { x: 10, y: 20 },
      { panX: 4, panY: 8 },
    )).toBe(false);
    expect(controller.isActive).toBe(false);
    expect(controller.move(3, { x: 18, y: 14 })).toBeNull();
  });

  it('drops an active pan on cancellation such as lost pointer capture or window blur', () => {
    const controller = new CanvasMousePanController();
    controller.begin(2, { x: 1, y: 1 }, { panX: 0, panY: 0 });
    controller.cancel();

    expect(controller.move(2, { x: 120, y: 120 })).toBeNull();
  });
});
