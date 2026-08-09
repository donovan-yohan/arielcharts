import type { ViewportRect } from './canvas-viewport';

export interface CanvasToolbarStackGeometry {
  bottom: number;
  left: number;
  right: number;
}

export interface CanvasToolbarVisibility {
  addNode: boolean;
  controls: boolean;
}

/** Hides bottom controls instead of letting a short unobscured viewport push them outside the canvas. */
export function getCanvasToolbarVisibility(
  viewportHeight: number,
  controlsHeight: number,
  addNodeHeight: number,
  inset = 12,
  gap = 12,
): CanvasToolbarVisibility {
  const controls = viewportHeight >= controlsHeight + (inset * 2);
  return {
    addNode: controls && viewportHeight >= controlsHeight + gap + addNodeHeight + (inset * 2),
    controls,
  };
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
