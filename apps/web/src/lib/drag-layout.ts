import type { DiagramNodePosition, DiagramNodePositions } from './diagram-layout';

export const DRAG_LAYOUT_COMMIT_INTERVAL_MS = 120;

/** Batches a human drag's durable writes while leaving the canvas free to render its local overlay. */
export class DragLayoutCommitter {
  private pending: DiagramNodePositions = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    private readonly commit: (positions: DiagramNodePositions) => void,
    private readonly intervalMs = DRAG_LAYOUT_COMMIT_INTERVAL_MS,
  ) {}

  update(nodeId: string, position: DiagramNodePosition): void {
    if (this.destroyed) {
      return;
    }
    this.pending[nodeId] = { x: position.x, y: position.y };
    if (this.timer === null) {
      this.timer = setTimeout(() => { this.flush(); }, this.intervalMs);
    }
  }

  flush(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (Object.keys(this.pending).length === 0) {
      return;
    }
    const pending = this.pending;
    this.pending = {};
    this.commit(pending);
  }

  destroy(): void {
    if (this.destroyed) {
      return;
    }
    this.flush();
    this.destroyed = true;
  }
}
