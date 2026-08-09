export interface TouchPoint {
  x: number;
  y: number;
}

export type CanvasTouchGesture =
  | {
    center: TouchPoint;
    delta: TouchPoint;
    kind: 'pan';
  }
  | {
    center: TouchPoint;
    delta: TouchPoint;
    kind: 'pinch';
    scale: number;
  };

export interface CanvasCamera {
  panX: number;
  panY: number;
  zoom: number;
}

export interface CanvasClientOrigin {
  left: number;
  top: number;
}

export function applyCanvasTouchGesture(
  camera: CanvasCamera,
  gesture: CanvasTouchGesture,
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

  const previousClientX = gesture.center.x - gesture.delta.x - clientOrigin.left;
  const previousClientY = gesture.center.y - gesture.delta.y - clientOrigin.top;
  const currentClientX = gesture.center.x - clientOrigin.left;
  const currentClientY = gesture.center.y - clientOrigin.top;
  const canvasX = (previousClientX - camera.panX) / camera.zoom;
  const canvasY = (previousClientY - camera.panY) / camera.zoom;
  const zoom = Math.min(maxZoom, Math.max(minZoom, camera.zoom * gesture.scale));

  return {
    panX: currentClientX - (canvasX * zoom),
    panY: currentClientY - (canvasY * zoom),
    zoom,
  };
}

/**
 * Keeps touch-camera math independent from a particular diagram renderer.
 * Callers decide which pointer-down targets may begin a canvas gesture, so a
 * node's own editing and connection interactions retain ownership.
 */
export class CanvasTouchGestureController {
  private readonly points = new Map<number, TouchPoint>();

  begin(pointerId: number, point: TouchPoint): boolean {
    if (this.points.size >= 2 || this.points.has(pointerId)) {
      return false;
    }

    this.points.set(pointerId, point);
    return true;
  }

  move(pointerId: number, point: TouchPoint): CanvasTouchGesture | null {
    const previous = this.points.get(pointerId);
    if (!previous) {
      return null;
    }

    const activePoints = [...this.points.entries()];
    this.points.set(pointerId, point);

    if (activePoints.length === 1) {
      return {
        center: point,
        delta: { x: point.x - previous.x, y: point.y - previous.y },
        kind: 'pan',
      };
    }

    const [[firstId, firstPrevious], [secondId, secondPrevious]] = activePoints;
    const firstCurrent = firstId === pointerId ? point : firstPrevious;
    const secondCurrent = secondId === pointerId ? point : secondPrevious;
    const previousCenter = midpoint(firstPrevious, secondPrevious);
    const center = midpoint(firstCurrent, secondCurrent);
    const previousDistance = distance(firstPrevious, secondPrevious);

    return {
      center,
      delta: { x: center.x - previousCenter.x, y: center.y - previousCenter.y },
      kind: 'pinch',
      scale: previousDistance === 0 ? 1 : distance(firstCurrent, secondCurrent) / previousDistance,
    };
  }

  end(pointerId: number): number {
    this.points.delete(pointerId);
    return this.points.size;
  }

  reset(): void {
    this.points.clear();
  }
}

function midpoint(first: TouchPoint, second: TouchPoint): TouchPoint {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

function distance(first: TouchPoint, second: TouchPoint): number {
  return Math.hypot(second.x - first.x, second.y - first.y);
}
