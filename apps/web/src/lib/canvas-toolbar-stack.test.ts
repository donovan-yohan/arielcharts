import { describe, expect, it } from 'vitest';
import { getCanvasToolbarStackGeometry } from './canvas-toolbar-stack';

describe('getCanvasToolbarStackGeometry', () => {
  it('keeps the stack inside the measured viewport beside a flyout', () => {
    expect(getCanvasToolbarStackGeometry(
      { height: 600, width: 900 },
      { height: 600, width: 520, x: 0, y: 0 },
    )).toEqual({ bottom: 12, left: 12, right: 392 });
  });

  it('uses the measured lower edge when an overlay obscures the canvas bottom', () => {
    expect(getCanvasToolbarStackGeometry(
      { height: 600, width: 320 },
      { height: 420, width: 320, x: 0, y: 0 },
    )).toEqual({ bottom: 192, left: 12, right: 12 });
  });
});
