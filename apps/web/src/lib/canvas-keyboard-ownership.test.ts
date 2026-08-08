import { describe, expect, it } from 'vitest';
import { shouldCanvasHandleEscape } from './canvas-keyboard-ownership';

describe('canvas Escape ownership', () => {
  it('handles Escape when either the event target or active element is inside the canvas', () => {
    expect(shouldCanvasHandleEscape(true, false)).toBe(true);
    expect(shouldCanvasHandleEscape(false, true)).toBe(true);
  });

  it('leaves Escape owned by flyouts, topbar controls, and modals', () => {
    expect(shouldCanvasHandleEscape(false, false)).toBe(false);
  });
});
