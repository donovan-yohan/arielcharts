import type { OverlayLayerRecord, OverlayObjectRecord } from '@arielcharts/shared';
import * as Y from 'yjs';
import { applyDiff } from './diagram-mutations';
import { writeNodePositions, type DiagramNodePosition } from './diagram-layout';
import { collaborationOrigins } from './collaboration-origins';
import {
  overlayOrigins,
  readOverlayHistoryTargets,
  restoreOverlayHistoryLayer,
  restoreOverlayHistoryObject,
} from './overlay-scene';

interface CanvasHistorySnapshot {
  source: string;
  positions: Map<string, DiagramNodePosition>;
  objects: Map<string, OverlayObjectRecord>;
  layers: Map<string, OverlayLayerRecord>;
}

interface CanvasHistoryCommand {
  before: CanvasHistorySnapshot;
  after: CanvasHistorySnapshot;
  sourceConflicted?: boolean;
}

interface CanvasHistoryActionState {
  command: CanvasHistoryCommand | null;
  sourceConflicted: boolean;
}

export interface CanvasHistoryActionLease { readonly id: symbol; }

export type CanvasHistoryResult = 'applied' | 'empty' | 'stale';

const journalOrigin = Symbol('arielcharts.local-canvas-history');
export const MAX_CANVAS_HISTORY_ENTRIES = 100;
const localCanvasOrigins = new Set<unknown>([
  collaborationOrigins.visual,
  collaborationOrigins.visualLayout,
  overlayOrigins.localHuman,
]);

function clonedMap<T>(entries: Iterable<[string, T]>): Map<string, T> {
  return new Map(Array.from(entries, ([key, value]) => [key, structuredClone(value)]));
}

function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (left === null || right === null) return false;
  if (typeof left !== 'object' || typeof right !== 'object') return false;
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key, index) => key === rightKeys[index] && sameValue(leftRecord[key], rightRecord[key]));
}

function mapsEqual<T>(left: Map<string, T>, right: Map<string, T>): boolean {
  return left.size === right.size && Array.from(left).every(([key, value]) => right.has(key) && sameValue(value, right.get(key)));
}

function changedKeys<T>(before: Map<string, T>, after: Map<string, T>): string[] {
  return [...new Set([...before.keys(), ...after.keys()])].filter((key) => !sameValue(before.get(key) ?? null, after.get(key) ?? null));
}

/**
 * Local-human canvas journal. Unlike Y.UndoManager, every entry has explicit
 * target preconditions, so an undo can never overwrite a collaborator's later
 * edit to the same source, node position, overlay object, or layer.
 */
export class CanvasHistoryCoordinator {
  private readonly undoStack: CanvasHistoryCommand[] = [];
  private readonly redoStack: CanvasHistoryCommand[] = [];
  private beforeTransaction: CanvasHistorySnapshot | null = null;
  private activeLease: CanvasHistoryActionLease | null = null;
  private readonly actions = new Map<symbol, CanvasHistoryActionState>();
  private readonly beforeListener: (transaction: Y.Transaction) => void;
  private readonly afterListener: (transaction: Y.Transaction) => void;

  constructor(
    private readonly doc: Y.Doc,
    private readonly diagramId: string,
    private readonly source: Y.Text,
    private readonly positions: Y.Map<DiagramNodePosition>,
  ) {
    this.beforeListener = (transaction) => {
      this.beforeTransaction = localCanvasOrigins.has(transaction.origin) ? this.snapshot() : null;
    };
    this.afterListener = (transaction) => {
      const before = this.beforeTransaction;
      this.beforeTransaction = null;
      const localCanvasMutation = localCanvasOrigins.has(transaction.origin);
      if (!localCanvasMutation) {
        // Never compose a canvas-source command across another writer's Y.Text
        // change. If this lease later includes source, undo consumes it stale
        // rather than restoring an old full-string snapshot over the peer.
        if (transaction.origin !== journalOrigin
          && [...transaction.changedParentTypes.keys()].some((type) => (type as unknown) === this.source)) {
          for (const action of this.actions.values()) action.sourceConflicted = true;
        }
        return;
      }
      if (!before) return;
      const after = this.snapshot();
      const lease = this.activeLease;
      if (lease) {
        const action = this.actions.get(lease.id);
        if (!action) return;
        action.command = action.command ? this.compose(action.command, before, after) : this.delta(before, after);
        return;
      }
      this.push(this.delta(before, after));
    };
    doc.on('beforeTransaction', this.beforeListener);
    doc.on('afterTransaction', this.afterListener);
  }

  destroy(): void {
    this.doc.off('beforeTransaction', this.beforeListener);
    this.doc.off('afterTransaction', this.afterListener);
    this.clear();
  }

  clear(): void {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.beforeTransaction = null;
    this.activeLease = null;
    this.actions.clear();
  }

  undo(): CanvasHistoryResult {
    return this.apply('undo');
  }

  redo(): CanvasHistoryResult {
    return this.apply('redo');
  }

  get depths(): Readonly<{ undo: number; redo: number }> {
    return { undo: this.undoStack.length, redo: this.redoStack.length };
  }

  beginAction(): CanvasHistoryActionLease {
    const lease = { id: Symbol('arielcharts.local-canvas-action') };
    // Mark ownership without snapshotting: the first wrapped local transaction
    // supplies its exact target-level before state, so unrelated remote work
    // between lease creation and that transaction is never absorbed.
    this.actions.set(lease.id, { command: null, sourceConflicted: false });
    return lease;
  }

  endAction(lease: CanvasHistoryActionLease): void {
    const action = this.actions.get(lease.id);
    if (!action?.command) { this.actions.delete(lease.id); return; }
    this.actions.delete(lease.id);
    const command = action.sourceConflicted && action.command.before.source !== action.command.after.source
      ? { ...action.command, sourceConflicted: true }
      : action.command;
    this.push(command);
  }

  cancelAction(lease: CanvasHistoryActionLease): void {
    this.actions.delete(lease.id);
  }

  runAction<T>(lease: CanvasHistoryActionLease, run: () => T): T {
    if (!this.actions.has(lease.id)) return run();
    const previous = this.activeLease;
    this.activeLease = lease;
    try { return run(); } finally { this.activeLease = previous; }
  }

  withAction<T>(run: () => T): T {
    const lease = this.beginAction();
    try { return this.runAction(lease, run); } finally { this.endAction(lease); }
  }

  private snapshot(): CanvasHistorySnapshot {
    const overlay = readOverlayHistoryTargets(this.doc, this.diagramId);
    return {
      source: this.source.toString(),
      positions: clonedMap(this.positions.entries()),
      objects: clonedMap(overlay.objects.entries()),
      layers: clonedMap(overlay.layers.entries()),
    };
  }


  private sameSnapshot(left: CanvasHistorySnapshot, right: CanvasHistorySnapshot): boolean {
    return left.source === right.source
      && mapsEqual(left.positions, right.positions)
      && mapsEqual(left.objects, right.objects)
      && mapsEqual(left.layers, right.layers);
  }

  private push(command: CanvasHistoryCommand): void {
    if (this.sameSnapshot(command.before, command.after)) return;
    this.undoStack.push(command);
    if (this.undoStack.length > MAX_CANVAS_HISTORY_ENTRIES) this.undoStack.splice(0, this.undoStack.length - MAX_CANVAS_HISTORY_ENTRIES);
    this.redoStack.length = 0;
  }

  private delta(before: CanvasHistorySnapshot, after: CanvasHistorySnapshot): CanvasHistoryCommand {
    const sourceChanged = before.source !== after.source;
    const select = <T>(left: Map<string, T>, right: Map<string, T>) => {
      const keys = changedKeys(left, right);
      const prior = new Map<string, T>(); const next = new Map<string, T>();
      for (const key of keys) {
        const leftValue = left.get(key); if (leftValue !== undefined) prior.set(key, structuredClone(leftValue));
        const rightValue = right.get(key); if (rightValue !== undefined) next.set(key, structuredClone(rightValue));
      }
      return [prior, next] as const;
    };
    const [beforePositions, afterPositions] = select(before.positions, after.positions);
    const [beforeObjects, afterObjects] = select(before.objects, after.objects);
    const [beforeLayers, afterLayers] = select(before.layers, after.layers);
    return {
      before: { source: sourceChanged ? before.source : after.source, positions: beforePositions, objects: beforeObjects, layers: beforeLayers },
      after: { source: after.source, positions: afterPositions, objects: afterObjects, layers: afterLayers },
    };
  }

  private compose(command: CanvasHistoryCommand, before: CanvasHistorySnapshot, after: CanvasHistorySnapshot): CanvasHistoryCommand {
    const delta = this.delta(before, after);
    const merge = <T>(first: Map<string, T>, latest: Map<string, T>, previous: Map<string, T>, next: Map<string, T>) => {
      const keys = new Set([...previous.keys(), ...next.keys()]);
      const beforeResult = new Map(first); const afterResult = new Map(latest);
      for (const key of keys) {
        // A key already present in either half was touched by an earlier local
        // transaction; retain its earliest state even when that state was an
        // absence (object/node creation).
        if (!beforeResult.has(key) && !afterResult.has(key) && previous.has(key)) beforeResult.set(key, structuredClone(previous.get(key)!));
        if (next.has(key)) afterResult.set(key, structuredClone(next.get(key)!)); else afterResult.delete(key);
      }
      return [beforeResult, afterResult] as const;
    };
    const [positionsBefore, positionsAfter] = merge(command.before.positions, command.after.positions, delta.before.positions, delta.after.positions);
    const [objectsBefore, objectsAfter] = merge(command.before.objects, command.after.objects, delta.before.objects, delta.after.objects);
    const [layersBefore, layersAfter] = merge(command.before.layers, command.after.layers, delta.before.layers, delta.after.layers);
    return {
      before: { source: command.before.source, positions: positionsBefore, objects: objectsBefore, layers: layersBefore },
      after: { source: delta.before.source !== delta.after.source ? delta.after.source : command.after.source, positions: positionsAfter, objects: objectsAfter, layers: layersAfter },
    };
  }

  private matches(expected: CanvasHistorySnapshot, keys: ReturnType<CanvasHistoryCoordinator['changedTargets']>): boolean {
    const current = this.snapshot();
    return (!keys.source || current.source === expected.source)
      && keys.positions.every((key) => sameValue(current.positions.get(key) ?? null, expected.positions.get(key) ?? null))
      && keys.objects.every((key) => sameValue(current.objects.get(key) ?? null, expected.objects.get(key) ?? null))
      && keys.layers.every((key) => sameValue(current.layers.get(key) ?? null, expected.layers.get(key) ?? null));
  }

  private changedTargets(command: CanvasHistoryCommand) {
    return {
      source: command.before.source !== command.after.source,
      positions: changedKeys(command.before.positions, command.after.positions),
      objects: changedKeys(command.before.objects, command.after.objects),
      layers: changedKeys(command.before.layers, command.after.layers),
    };
  }

  private restore(target: CanvasHistorySnapshot, keys: ReturnType<CanvasHistoryCoordinator['changedTargets']>): void {
    const currentSource = this.source.toString();
    if (keys.source && currentSource !== target.source) applyDiff(this.source, target.source, currentSource);
    for (const key of keys.positions) {
      const value = target.positions.get(key) ?? null;
      if (value) writeNodePositions(this.positions, { [key]: value }); else this.positions.delete(key);
    }
    for (const key of keys.layers) restoreOverlayHistoryLayer(this.doc, this.diagramId, key, target.layers.get(key) ?? null);
    for (const key of keys.objects) restoreOverlayHistoryObject(this.doc, this.diagramId, key, target.objects.get(key) ?? null);
  }

  private apply(direction: 'undo' | 'redo'): CanvasHistoryResult {
    const from = direction === 'undo' ? this.undoStack : this.redoStack;
    const to = direction === 'undo' ? this.redoStack : this.undoStack;
    const command = from.pop();
    if (!command) return 'empty';
    const expected = direction === 'undo' ? command.after : command.before;
    const target = direction === 'undo' ? command.before : command.after;
    const keys = this.changedTargets(command);
    // A stale entry is consumed once. The next shortcut reaches the next local
    // command without ever retrying or overwriting a collaborator's change.
    if (command.sourceConflicted || !this.matches(expected, keys)) return 'stale';
    this.doc.transact(() => this.restore(target, keys), journalOrigin);
    to.push(command);
    return 'applied';
  }
}
