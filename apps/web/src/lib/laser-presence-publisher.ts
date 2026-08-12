import type { CanvasLaserState, CanvasWorldPoint } from '@arielcharts/shared';
import { CANVAS_LASER_INTERVAL_MS, quantizeLaserPoint } from './canvas-presence';

export class LaserPresencePublisher {
  private sequence: number;
  private lastPublishedAt = 0;
  private pending: CanvasWorldPoint | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private inactivityTimer: ReturnType<typeof setTimeout> | null = null;
  private active = false;

  constructor(
    private readonly publish: (laser: CanvasLaserState) => void,
    initialSequence = 0,
  ) {
    this.sequence = Number.isSafeInteger(initialSequence) && initialSequence >= 0 ? initialSequence : 0;
  }

  move(point: CanvasWorldPoint): void {
    if (this.sequence >= Number.MAX_SAFE_INTEGER - 1) return;
    this.active = true;
    this.pending = quantizeLaserPoint(point);
    if (this.inactivityTimer !== null) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = setTimeout(() => this.stop(), 1_000);
    const delay = CANVAS_LASER_INTERVAL_MS - (Date.now() - this.lastPublishedAt);
    if (delay <= 0) this.flush();
    else if (this.timer === null) this.timer = setTimeout(() => this.flush(), delay);
  }

  stop(): void {
    if (!this.active && this.pending === null) return;
    this.cancelTimer();
    if (this.inactivityTimer !== null) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = null;
    this.pending = null;
    this.active = false;
    const sequence = this.nextSequence();
    if (sequence === null) return;
    this.publish({ active: false, sequence });
  }

  destroy(): void {
    this.cancelTimer();
    if (this.inactivityTimer !== null) clearTimeout(this.inactivityTimer);
    this.inactivityTimer = null;
    this.pending = null;
    this.active = false;
  }

  private flush(): void {
    this.cancelTimer();
    const point = this.pending;
    this.pending = null;
    if (!point) return;
    const sequence = this.nextSequence();
    if (sequence === null) return;
    this.lastPublishedAt = Date.now();
    this.publish({ active: true, point, sequence });
  }

  private nextSequence(): number | null {
    if (this.sequence >= Number.MAX_SAFE_INTEGER - 1) return null;
    this.sequence += 1;
    return this.sequence;
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }
}
