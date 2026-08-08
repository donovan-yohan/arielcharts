export function shouldCanvasHandleEscape(
  eventTargetInsideCanvas: boolean,
  activeElementInsideCanvas: boolean,
): boolean {
  return eventTargetInsideCanvas || activeElementInsideCanvas;
}
