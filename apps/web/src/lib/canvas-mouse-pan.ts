export interface CanvasPanViewport {
  panX: number;
  panY: number;
}

export interface CanvasPanPoint {
  x: number;
  y: number;
}

export interface CanvasPointerCaptureTarget {
  setPointerCapture: (pointerId: number) => void;
}

interface ActiveCanvasPan {
  origin: CanvasPanPoint;
  pointerId: number;
  startViewport: CanvasPanViewport;
}

/**
 * Owns one mouse/pen canvas pan between its pointer-down and terminal event.
 * Pointer capture can still deliver a queued move after release, so movement is
 * accepted only while that exact pointer remains active.
 */
export class CanvasMousePanController {
  private active: ActiveCanvasPan | null = null;

  begin(pointerId: number, origin: CanvasPanPoint, startViewport: CanvasPanViewport): boolean {
    if (this.active) {
      return false;
    }

    this.active = { origin, pointerId, startViewport };
    return true;
  }

  move(pointerId: number, point: CanvasPanPoint): CanvasPanViewport | null {
    const active = this.active;
    if (!active || active.pointerId !== pointerId) {
      return null;
    }

    return {
      panX: active.startViewport.panX + point.x - active.origin.x,
      panY: active.startViewport.panY + point.y - active.origin.y,
    };
  }

  end(pointerId: number): boolean {
    if (!this.active || this.active.pointerId !== pointerId) {
      return false;
    }

    this.active = null;
    return true;
  }

  cancel(): void {
    this.active = null;
  }

  get isActive(): boolean {
    return this.active !== null;
  }
}

/**
 * Starts camera ownership only after capture succeeds. This keeps failed DOM
 * capture from leaving a stale gesture that a later move could apply.
 */
export function beginCanvasMousePan(
  controller: CanvasMousePanController,
  pointerCaptureTarget: CanvasPointerCaptureTarget,
  pointerId: number,
  origin: CanvasPanPoint,
  startViewport: CanvasPanViewport,
): boolean {
  if (!controller.begin(pointerId, origin, startViewport)) {
    return false;
  }

  try {
    pointerCaptureTarget.setPointerCapture(pointerId);
    return true;
  } catch {
    controller.end(pointerId);
    return false;
  }
}
