import type { ViewportRect } from './canvas-viewport';

export interface CanvasToolbarStackGeometry {
  bottom: number;
  left: number;
  right: number;
}

/** Positions a dynamic bottom-control stack inside the currently unobscured canvas viewport. */
export function getCanvasToolbarStackGeometry(
  canvas: { height: number; width: number },
  viewport: ViewportRect,
  inset = 12,
): CanvasToolbarStackGeometry {
  return {
    bottom: Math.max(inset, canvas.height - (viewport.y + viewport.height) + inset),
    left: viewport.x + inset,
    right: Math.max(inset, canvas.width - (viewport.x + viewport.width) + inset),
  };
}
