export interface CanvasViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

export interface ReactFlowViewportState {
  x: number;
  y: number;
  zoom: number;
}

/**
 * React Flow reports every controlled viewport application through onMove.
 * Preserve object identity when it reports the already-owned camera so that
 * acknowledgement cannot cause another React render and onMove callback.
 */
export function reconcileReactFlowViewport(
  current: CanvasViewportState,
  reported: ReactFlowViewportState,
): CanvasViewportState {
  if (
    current.panX === reported.x
    && current.panY === reported.y
    && current.zoom === reported.zoom
  ) {
    return current;
  }
  return { panX: reported.x, panY: reported.y, zoom: reported.zoom };
}
