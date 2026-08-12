import type { CanvasCamera, CanvasClientOrigin } from './canvas-touch-gesture';

export interface CanvasWheelInput {
  ctrlKey: boolean;
  deltaMode: number;
  deltaX: number;
  deltaY: number;
}

export type CanvasWheelGesture =
  | { delta: { x: number; y: number }; kind: 'pan' }
  | { client: { x: number; y: number }; kind: 'zoom'; scale: number };

const LINE_SCROLL_PIXELS = 16;
const PAGE_SCROLL_PIXELS = 800;
/**
 * macOS reports a trackpad pinch as a sequence of small ctrl-wheel deltas.
 * A 20px sample should make a visible change without needing a prolonged
 * gesture, while the per-event clamp and camera bounds still cap spikes.
 */
const PINCH_ZOOM_SENSITIVITY = 0.004;
const MAX_PINCH_DELTA = 60;

export function getSafariPinchZoomScale(currentScale: number, previousScale: number): number {
  if (!Number.isFinite(currentScale) || currentScale <= 0 || !Number.isFinite(previousScale) || previousScale <= 0) {
    return 1;
  }

  return Math.pow(currentScale / previousScale, 0.8);
}

export function getCanvasWheelGesture(
  event: CanvasWheelInput,
  client: { x: number; y: number },
): CanvasWheelGesture {
  const multiplier = getWheelDeltaMultiplier(event.deltaMode);
  const deltaX = event.deltaX * multiplier;
  const deltaY = event.deltaY * multiplier;

  if (!event.ctrlKey) {
    return { delta: { x: -deltaX, y: -deltaY }, kind: 'pan' };
  }

  return {
    client,
    kind: 'zoom',
    scale: Math.exp(-clamp(deltaY, -MAX_PINCH_DELTA, MAX_PINCH_DELTA) * PINCH_ZOOM_SENSITIVITY),
  };
}

export function applyCanvasWheelGesture(
  camera: CanvasCamera,
  gesture: CanvasWheelGesture,
  clientOrigin: CanvasClientOrigin,
  minZoom: number,
  maxZoom: number,
): CanvasCamera {
  if (gesture.kind === 'pan') {
    return {
      ...camera,
      panX: camera.panX + gesture.delta.x,
      panY: camera.panY + gesture.delta.y,
    };
  }

  const clientX = gesture.client.x - clientOrigin.left;
  const clientY = gesture.client.y - clientOrigin.top;
  const canvasX = (clientX - camera.panX) / camera.zoom;
  const canvasY = (clientY - camera.panY) / camera.zoom;
  const zoom = clamp(camera.zoom * gesture.scale, minZoom, maxZoom);

  return {
    panX: clientX - (canvasX * zoom),
    panY: clientY - (canvasY * zoom),
    zoom,
  };
}

function getWheelDeltaMultiplier(deltaMode: number): number {
  if (deltaMode === 1) return LINE_SCROLL_PIXELS;
  if (deltaMode === 2) return PAGE_SCROLL_PIXELS;
  return 1;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
