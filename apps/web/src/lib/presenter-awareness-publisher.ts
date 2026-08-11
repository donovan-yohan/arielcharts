import type { PresenterAwarenessState } from '@arielcharts/shared';
import type { CanvasCameraState } from '../components/diagram-canvas';

const PUBLISH_INTERVAL_MS = 125;

export class PresenterAwarenessPublisher {
  private active = false;
  private camera: CanvasCameraState = { panX: 24, panY: 24, zoom: 1 };
  private diagramId: string | null = null;
  private lastPublishedAt = 0;
  private sequence = 0;
  private spotlightSequence = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly send: (state: PresenterAwarenessState | null) => void,
    private readonly now: () => number = Date.now,
  ) {}

  start(diagramId: string, camera: CanvasCameraState): void {
    this.active = true;
    this.diagramId = diagramId;
    this.camera = camera;
    this.publish();
  }

  update(diagramId: string, camera: CanvasCameraState): void {
    this.diagramId = diagramId;
    this.camera = camera;
    if (!this.active) return;
    const delay = PUBLISH_INTERVAL_MS - (this.now() - this.lastPublishedAt);
    if (delay <= 0) this.publish();
    else if (this.timer === null) this.timer = setTimeout(() => {
      this.timer = null;
      // Read current fields at execution time. A queued camera update must not
      // overwrite a newer spotlight request with a stale closure.
      this.publish();
    }, delay);
  }

  spotlight(): void {
    if (!this.active) return;
    this.spotlightSequence += 1;
    this.publish();
  }

  stop(): void {
    this.active = false;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.send(null);
  }

  destroy(): void { this.stop(); }

  private publish(): void {
    if (!this.active || !this.diagramId) return;
    this.sequence += 1;
    this.lastPublishedAt = this.now();
    this.send({
      active: true,
      sequence: this.sequence,
      diagram_id: this.diagramId,
      viewport: { pan_x: this.camera.panX, pan_y: this.camera.panY, zoom: this.camera.zoom },
      ...(this.spotlightSequence > 0 ? { spotlight_sequence: this.spotlightSequence } : {}),
    });
  }
}
