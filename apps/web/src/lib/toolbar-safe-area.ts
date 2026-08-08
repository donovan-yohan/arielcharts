export interface CanvasSize {
  height: number;
  width: number;
  x?: number;
  y?: number;
}

export interface ToolbarSize {
  height: number;
  width: number;
}

export interface ToolbarAnchor {
  x: number;
  y: number;
}

export interface SafeToolbarPosition {
  left: number;
  top: number;
}

interface SafeToolbarOptions {
  anchor: ToolbarAnchor;
  canvas: CanvasSize;
  gap?: number;
  inset?: number;
  preferAbove?: boolean;
  toolbar: ToolbarSize;
}

/** Keeps canvas controls reachable without letting overlays resize the canvas. */
export function getSafeToolbarPosition({
  anchor,
  canvas,
  gap = 8,
  inset = 12,
  preferAbove = true,
  toolbar,
}: SafeToolbarOptions): SafeToolbarPosition {
  const canvasX = canvas.x ?? 0;
  const canvasY = canvas.y ?? 0;
  const minLeft = canvasX + inset;
  const minTop = canvasY + inset;
  const maxLeft = Math.max(minLeft, canvasX + canvas.width - toolbar.width - inset);
  const maxTop = Math.max(minTop, canvasY + canvas.height - toolbar.height - inset);
  const above = anchor.y - toolbar.height - gap;
  const below = anchor.y + gap;
  const preferredTop = preferAbove
    ? (above >= minTop ? above : below)
    : (below + toolbar.height <= canvasY + canvas.height - inset ? below : above);

  return {
    left: clamp(anchor.x - (toolbar.width / 2), minLeft, maxLeft),
    top: clamp(preferredTop, minTop, maxTop),
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
