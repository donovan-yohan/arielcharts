import { describe, expect, it } from 'vitest';
import {
  SOURCE_FLYOUT_MAX_WIDTH,
  SOURCE_FLYOUT_MIN_WIDTH,
  clampSourceFlyoutWidth,
  getSourceFlyoutKeyboardWidth,
  getSourceFlyoutMaximumWidth,
  getSourceFlyoutWidthFromPointer,
} from './source-flyout-resize';

describe('source flyout resize', () => {
  it('keeps drag widths inside the desktop minimum, maximum, and viewport inset', () => {
    expect(clampSourceFlyoutWidth(1, 1440)).toBe(SOURCE_FLYOUT_MIN_WIDTH);
    expect(clampSourceFlyoutWidth(9999, 1440)).toBe(SOURCE_FLYOUT_MAX_WIDTH);
    expect(getSourceFlyoutMaximumWidth(500)).toBe(476);
    expect(clampSourceFlyoutWidth(9999, 500)).toBe(476);
    expect(clampSourceFlyoutWidth(9999, 300)).toBe(276);
  });

  it('converts a left-edge pointer position into an anchored panel width', () => {
    expect(getSourceFlyoutWidthFromPointer(1000, 1440)).toBe(440);
    expect(getSourceFlyoutWidthFromPointer(1400, 1440)).toBe(SOURCE_FLYOUT_MIN_WIDTH);
    expect(getSourceFlyoutWidthFromPointer(100, 1440)).toBe(SOURCE_FLYOUT_MAX_WIDTH);
  });

  it('provides separator keyboard controls with the expected left-edge direction', () => {
    expect(getSourceFlyoutKeyboardWidth(400, 1440, 'ArrowLeft')).toBe(424);
    expect(getSourceFlyoutKeyboardWidth(400, 1440, 'ArrowRight')).toBe(376);
    expect(getSourceFlyoutKeyboardWidth(400, 1440, 'Home')).toBe(SOURCE_FLYOUT_MIN_WIDTH);
    expect(getSourceFlyoutKeyboardWidth(400, 1440, 'End')).toBe(SOURCE_FLYOUT_MAX_WIDTH);
    expect(getSourceFlyoutKeyboardWidth(400, 1440, 'Enter')).toBeNull();
  });
});
