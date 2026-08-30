/**
 * Right-click must stay native inside text entry, dialogs, and other menus,
 * and must never treat floating canvas chrome as canvas. One shared string
 * keeps the canvas handler and its harness in agreement.
 */
export const CONTEXT_MENU_EXCLUSION_SELECTOR = 'input, textarea, select, [contenteditable="true"], .cm-editor, [role="dialog"], [role="menu"], [data-testid*="toolbar"], [data-testid="overlay-controls-owner"]';

export interface ContextMenuPoint {
  x: number;
  y: number;
}

export interface ContextMenuSize {
  height: number;
  width: number;
}

export interface ContextMenuViewport {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface ContextMenuRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

export interface ContextMenuPosition {
  left: number;
  top: number;
}

interface ClampContextMenuOptions {
  anchor: ContextMenuPoint;
  inset?: number;
  menu: ContextMenuSize;
  viewport: ContextMenuViewport;
}

/**
 * Anchors a menu at the pointer, flipping left/up rather than centering, then
 * clamps so an oversized menu still starts inside the viewport.
 */
export function clampContextMenuPosition({ anchor, inset = 8, menu, viewport }: ClampContextMenuOptions): ContextMenuPosition {
  const minLeft = viewport.x + inset;
  const minTop = viewport.y + inset;
  const maxLeft = Math.max(minLeft, viewport.x + viewport.width - menu.width - inset);
  const maxTop = Math.max(minTop, viewport.y + viewport.height - menu.height - inset);
  const preferredLeft = anchor.x + menu.width + inset > viewport.x + viewport.width ? anchor.x - menu.width : anchor.x;
  const preferredTop = anchor.y + menu.height + inset > viewport.y + viewport.height ? anchor.y - menu.height : anchor.y;

  return {
    left: clamp(preferredLeft, minLeft, maxLeft),
    top: clamp(preferredTop, minTop, maxTop),
  };
}

/** The floating toolbar pill is click-through in its gaps; its rect is not. */
export function isPointInsideRect(point: ContextMenuPoint, rect: ContextMenuRect | null): boolean {
  return rect !== null
    && point.x >= rect.left && point.x <= rect.right
    && point.y >= rect.top && point.y <= rect.bottom;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
