import { describe, expect, it } from 'vitest';
import { CONTEXT_MENU_EXCLUSION_SELECTOR, clampContextMenuPosition, isPointInsideRect } from './context-menu-position';

const VIEWPORT = { height: 800, width: 1_000, x: 0, y: 0 };

describe('clampContextMenuPosition', () => {
  it('keeps the menu at the pointer when it fits below and right', () => {
    expect(clampContextMenuPosition({ anchor: { x: 40, y: 60 }, menu: { height: 300, width: 200 }, viewport: VIEWPORT }))
      .toEqual({ left: 40, top: 60 });
  });

  it('flips left and up instead of overflowing the bottom-right corner', () => {
    expect(clampContextMenuPosition({ anchor: { x: 960, y: 780 }, menu: { height: 300, width: 200 }, viewport: VIEWPORT }))
      .toEqual({ left: 760, top: 480 });
  });

  it('flips only the overflowing axis', () => {
    expect(clampContextMenuPosition({ anchor: { x: 960, y: 60 }, menu: { height: 300, width: 200 }, viewport: VIEWPORT }))
      .toEqual({ left: 760, top: 60 });
    expect(clampContextMenuPosition({ anchor: { x: 40, y: 780 }, menu: { height: 300, width: 200 }, viewport: VIEWPORT }))
      .toEqual({ left: 40, top: 480 });
  });

  it('clamps a flipped menu back inside the inset when the pointer sits near the origin', () => {
    expect(clampContextMenuPosition({ anchor: { x: 4, y: 790 }, menu: { height: 300, width: 200 }, viewport: VIEWPORT }))
      .toEqual({ left: 8, top: 490 });
  });

  it('starts a menu larger than the viewport at the inset instead of off-screen', () => {
    expect(clampContextMenuPosition({ anchor: { x: 500, y: 400 }, menu: { height: 900, width: 1_200 }, viewport: VIEWPORT }))
      .toEqual({ left: 8, top: 8 });
  });

  it('respects an offset viewport origin and a custom inset', () => {
    expect(clampContextMenuPosition({
      anchor: { x: 1_180, y: 640 },
      inset: 12,
      menu: { height: 200, width: 240 },
      viewport: { height: 700, width: 1_200, x: 100, y: 50 },
    })).toEqual({ left: 940, top: 440 });
  });
});

describe('isPointInsideRect', () => {
  const rect = { bottom: 120, left: 200, right: 600, top: 20 };

  it('treats a missing rect as no exclusion', () => {
    expect(isPointInsideRect({ x: 300, y: 60 }, null)).toBe(false);
  });

  it('covers the gaps between toolbar buttons, including the border', () => {
    expect(isPointInsideRect({ x: 300, y: 60 }, rect)).toBe(true);
    expect(isPointInsideRect({ x: 200, y: 20 }, rect)).toBe(true);
    expect(isPointInsideRect({ x: 600, y: 120 }, rect)).toBe(true);
  });

  it('leaves canvas points outside the rect alone', () => {
    expect(isPointInsideRect({ x: 300, y: 121 }, rect)).toBe(false);
    expect(isPointInsideRect({ x: 199, y: 60 }, rect)).toBe(false);
  });
});

describe('CONTEXT_MENU_EXCLUSION_SELECTOR', () => {
  it('covers every surface that owns its own right-click behaviour', () => {
    for (const selector of ['input', 'textarea', 'select', '[contenteditable="true"]', '.cm-editor', '[role="dialog"]', '[role="menu"]']) {
      expect(CONTEXT_MENU_EXCLUSION_SELECTOR).toContain(selector);
    }
  });

  it('treats the portalled overlay control layer and every canvas toolbar as chrome, not canvas', () => {
    expect(CONTEXT_MENU_EXCLUSION_SELECTOR).toContain('[data-testid*="toolbar"]');
    expect(CONTEXT_MENU_EXCLUSION_SELECTOR).toContain('[data-testid="overlay-controls-owner"]');
  });
});
