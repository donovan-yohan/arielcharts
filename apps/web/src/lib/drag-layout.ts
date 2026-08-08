import type { DiagramNodePositions } from './diagram-layout';

export const DRAG_LAYOUT_COMMIT_INTERVAL_MS = 120;

/** A deleted tab must not receive a final asynchronous layout write. */
export function getDragLayoutTeardownOptions(diagramStillExists: boolean): { flush: boolean } {
  return { flush: diagramStillExists };
}

function hasExactIds(positions: DiagramNodePositions, nodeIds: ReadonlySet<string>): boolean {
  const positionIds = Object.keys(positions);
  return positionIds.length === nodeIds.size && positionIds.every((nodeId) => nodeIds.has(nodeId));
}

/**
 * Batches one active drag group's durable writes. Canonical source membership is
 * an allowlist: source invalidation drops removed entries and terminates a
 * group that contains one, so delayed React Flow callbacks cannot revive it.
 */
export class DragLayoutCommitter {
  private activeNodeIds: Set<string> | null = null;
  private allowedNodeIds = new Set<string>();
  private pending: DiagramNodePositions = {};
  private timer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(
    private readonly commit: (positions: DiagramNodePositions) => void,
    private readonly intervalMs = DRAG_LAYOUT_COMMIT_INTERVAL_MS,
  ) {}

  setAllowedNodeIds(nodeIds: Iterable<string>): void {
    if (this.destroyed) {
      return;
    }

    this.allowedNodeIds = new Set(nodeIds);
    this.pending = Object.fromEntries(
      Object.entries(this.pending).filter(([nodeId]) => this.allowedNodeIds.has(nodeId)),
    );
    if (this.activeNodeIds && [...this.activeNodeIds].some((nodeId) => !this.allowedNodeIds.has(nodeId))) {
      this.activeNodeIds = null;
    }
    this.clearTimerWhenIdle();
  }

  begin(nodeIds: Iterable<string>): boolean {
    if (this.destroyed) {
      return false;
    }

    const nextNodeIds = new Set(nodeIds);
    if (nextNodeIds.size === 0 || [...nextNodeIds].some((nodeId) => !this.allowedNodeIds.has(nodeId))) {
      this.activeNodeIds = null;
      return false;
    }

    this.activeNodeIds = nextNodeIds;
    return true;
  }

  update(positions: DiagramNodePositions): boolean {
    const activeNodeIds = this.activeNodeIds;
    if (this.destroyed || !activeNodeIds || !hasExactIds(positions, activeNodeIds)) {
      return false;
    }
    if ([...activeNodeIds].some((nodeId) => !this.allowedNodeIds.has(nodeId))) {
      this.activeNodeIds = null;
      return false;
    }

    for (const [nodeId, position] of Object.entries(positions)) {
      this.pending[nodeId] = { x: position.x, y: position.y };
    }
    if (this.timer === null) {
      this.timer = setTimeout(() => { this.flush(); }, this.intervalMs);
    }
    return true;
  }

  finish(positions: DiagramNodePositions): boolean {
    const accepted = this.update(positions);
    this.activeNodeIds = null;
    if (accepted) {
      this.flush();
    }
    return accepted;
  }

  cancel(): void {
    this.activeNodeIds = null;
    this.allowedNodeIds.clear();
    this.pending = {};
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
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

  destroy(options: { flush?: boolean } = {}): void {
    if (this.destroyed) {
      return;
    }
    if (options.flush ?? true) {
      this.flush();
    } else {
      this.cancel();
    }
    this.activeNodeIds = null;
    this.destroyed = true;
  }

  private clearTimerWhenIdle(): void {
    if (Object.keys(this.pending).length === 0 && this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }
}
