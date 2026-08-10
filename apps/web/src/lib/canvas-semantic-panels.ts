import type { ViewportRect } from './canvas-viewport';

export interface SemanticPanelPlacement {
  bottom: number;
  left: number;
  width: number;
}

export interface PairedSemanticPanelPlacement {
  containment: SemanticPanelPlacement;
  editor: SemanticPanelPlacement;
}

/** Places paired semantic editors inside the measured, unobscured canvas. */
export function getPairedSemanticPanelPlacement(
  canvas: { height: number },
  viewport: ViewportRect,
  editorBottom: number,
): PairedSemanticPanelPlacement | null {
  if (viewport.width <= 0 || viewport.height <= 0) return null;
  const inset = 12;
  const gap = 12;
  const width = Math.max(0, Math.min(400, Math.floor((viewport.width - (inset * 2) - gap) / 2)));
  if (width <= 0) return null;
  const bottom = Math.max(0, canvas.height - viewport.y - viewport.height) + editorBottom;
  return {
    containment: { bottom, left: viewport.x + inset, width },
    editor: { bottom, left: viewport.x + viewport.width - inset - width, width },
  };
}
