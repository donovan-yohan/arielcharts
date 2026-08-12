import * as Y from 'yjs';

/** Explicit local-human origins. Remote, MCP, bootstrap, and reconcile writes use different origins. */
export const collaborationOrigins = {
  visual: Symbol('arielcharts.local-human.visual'),
  visualLayout: Symbol('arielcharts.local-human.visual-layout'),
  reconciliation: Symbol('arielcharts.source-layout.reconciliation'),
} as const;

/** CodeMirror owns source-only undo while its editor has focus. */
export function createSourceEditorUndoManager(yText: Y.Text): Y.UndoManager {
  return new Y.UndoManager(yText, { trackedOrigins: new Set() });
}

export function createDiagramUndoManager<T>(yText: Y.Text, nodePositions: Y.Map<T>): Y.UndoManager {
  return new Y.UndoManager([yText, nodePositions], {
    trackedOrigins: new Set([collaborationOrigins.visual, collaborationOrigins.visualLayout]),
  });
}

export function destroyDiagramUndoManager(undoManager: Y.UndoManager): void {
  undoManager.destroy();
}
