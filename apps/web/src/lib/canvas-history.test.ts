import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CanvasHistoryCoordinator, MAX_CANVAS_HISTORY_ENTRIES } from './canvas-history';
import { createSourceEditorUndoManager } from './collaboration-origins';
import { collaborationOrigins } from './collaboration-origins';
import { applyDiff } from './diagram-mutations';
import { writeNodePositions } from './diagram-layout';
import { addOverlayObject, getOverlayScene, moveOverlayObjects, readOverlayScene } from './overlay-scene';

function draw(id: string, x = 10) {
  return {
    id, kind: 'foundation.card', version: 1, order_key: id,
    geometry: { x, y: 20, width: 30, height: 40, rotation: 0 },
    style: {}, metadata: {}, payload: { text: id },
  };
}

function harness(diagramId = 'main') {
  const doc = new Y.Doc();
  const source = doc.getText(`${diagramId}-source`);
  source.insert(0, 'flowchart TD\nA');
  const positions = doc.getMap<{ x: number; y: number }>(`${diagramId}-positions`);
  getOverlayScene(doc, diagramId, true);
  return { doc, diagramId, source, positions, history: new CanvasHistoryCoordinator(doc, diagramId, source, positions) };
}

function canvasText(doc: Y.Doc, source: Y.Text, next: string) {
  const previous = source.toString();
  doc.transact(() => applyDiff(source, next, previous), collaborationOrigins.visual);
}

describe('CanvasHistoryCoordinator', () => {
  it('undoes draw, node move, draw, and semantic canvas replacement in exact reverse chronological order', () => {
    const { doc, diagramId, source, positions, history } = harness();
    addOverlayObject(doc, diagramId, draw('first'));
    doc.transact(() => writeNodePositions(positions, { A: { x: 40, y: 60 } }), collaborationOrigins.visualLayout);
    addOverlayObject(doc, diagramId, draw('second', 80));
    canvasText(doc, source, 'flowchart TD\nA --> B');

    expect(history.depths).toEqual({ undo: 4, redo: 0 });
    expect(history.undo()).toBe('applied');
    expect(source.toString()).toBe('flowchart TD\nA');
    expect(history.undo()).toBe('applied');
    expect(readOverlayScene(doc, diagramId).objects.map(({ id }) => id)).toEqual(['first']);
    expect(history.undo()).toBe('applied');
    expect(positions.has('A')).toBe(false);
    expect(history.undo()).toBe('applied');
    expect(readOverlayScene(doc, diagramId).objects).toEqual([]);

    expect(history.redo()).toBe('applied');
    expect(history.redo()).toBe('applied');
    expect(history.redo()).toBe('applied');
    expect(history.redo()).toBe('applied');
    expect(source.toString()).toBe('flowchart TD\nA --> B');
    expect(positions.get('A')).toEqual({ x: 40, y: 60 });
    expect(readOverlayScene(doc, diagramId).objects.map(({ id }) => id)).toEqual(['first', 'second']);
    history.destroy();
  });

  it('consumes a same-target remote divergence without overwriting it, then reaches the next own command', () => {
    const { doc, diagramId, source, positions, history } = harness();
    addOverlayObject(doc, diagramId, draw('safe'));
    doc.transact(() => writeNodePositions(positions, { A: { x: 40, y: 60 } }), collaborationOrigins.visualLayout);
    doc.transact(() => writeNodePositions(positions, { A: { x: 99, y: 88 } }), 'remote-peer');

    expect(history.undo()).toBe('stale');
    expect(positions.get('A')).toEqual({ x: 99, y: 88 });
    expect(history.depths).toEqual({ undo: 1, redo: 0 });
    expect(history.undo()).toBe('applied');
    expect(readOverlayScene(doc, diagramId).objects).toEqual([]);
    history.destroy();
  });

  it('allows undo when a peer changes an unrelated target and invalidates redo on divergence', () => {
    const { doc, diagramId, source, positions, history } = harness();
    addOverlayObject(doc, diagramId, draw('local'));
    doc.transact(() => writeNodePositions(positions, { remote: { x: 9, y: 9 } }), 'remote-peer');
    expect(history.undo()).toBe('applied');
    expect(positions.get('remote')).toEqual({ x: 9, y: 9 });
    canvasText(doc, source, 'flowchart TD\nA --> B');
    expect(history.undo()).toBe('applied');
    doc.transact(() => source.insert(source.length, '\nremote'), 'remote-peer');
    expect(history.redo()).toBe('stale');
    expect(source.toString()).toContain('remote');
    expect(history.depths).toEqual({ undo: 0, redo: 0 });
    history.destroy();
  });

  it('records only explicit local canvas origins and clears on diagram or imported scene replacement', () => {
    const first = harness('first');
    const second = harness('second');
    first.doc.transact(() => first.source.insert(first.source.length, '\nlocal'), collaborationOrigins.visual);
    second.doc.transact(() => second.source.insert(second.source.length, '\nremote'), 'remote-peer');
    expect(first.history.depths).toEqual({ undo: 1, redo: 0 });
    expect(second.history.depths).toEqual({ undo: 0, redo: 0 });
    first.history.destroy();
    const overlays = first.doc.getMap<Y.Map<unknown>>('overlays');
    first.doc.transact(() => overlays.delete('first'), 'import');
    getOverlayScene(first.doc, 'first', true);
    const rebound = new CanvasHistoryCoordinator(first.doc, 'first', first.source, first.positions);
    expect(rebound.depths).toEqual({ undo: 0, redo: 0 });
    addOverlayObject(first.doc, 'first', draw('replacement'));
    expect(rebound.undo()).toBe('applied');
    expect(readOverlayScene(first.doc, 'first').objects).toEqual([]);
    rebound.destroy();
    second.history.destroy();
  });

  it('does not snapshot remote or activity transactions, but still snapshots a local canvas mutation', () => {
    const { doc, positions, history } = harness();
    const activity = doc.getArray('activity');
    const clone = vi.spyOn(globalThis, 'structuredClone');
    try {
      clone.mockClear();
      for (let index = 0; index < 200; index += 1) {
        doc.transact(() => positions.set('remote', { x: index, y: index }), 'remote-peer');
        doc.transact(() => activity.push([{ action: 'observed', index }]), 'activity');
      }

      expect(clone).not.toHaveBeenCalled();
      expect(history.depths).toEqual({ undo: 0, redo: 0 });

      doc.transact(() => writeNodePositions(positions, { local: { x: 40, y: 60 } }), collaborationOrigins.visualLayout);
      expect(clone).toHaveBeenCalled();
      expect(history.depths).toEqual({ undo: 1, redo: 0 });
    } finally {
      clone.mockRestore();
      history.destroy();
    }
  });

  it('bounds local history and clears redo when a new command is recorded', () => {
    const { doc, source, history } = harness();
    for (let index = 0; index < MAX_CANVAS_HISTORY_ENTRIES + 2; index += 1) canvasText(doc, source, `flowchart TD\nA${index}`);
    expect(history.depths.undo).toBe(MAX_CANVAS_HISTORY_ENTRIES);
    expect(history.undo()).toBe('applied');
    expect(history.depths.redo).toBe(1);
    canvasText(doc, source, 'flowchart TD\nnew');
    expect(history.depths.redo).toBe(0);
    history.destroy();
  });

  it('keeps an overlay move target-scoped', () => {
    const { doc, diagramId, history } = harness();
    addOverlayObject(doc, diagramId, draw('move'));
    moveOverlayObjects(doc, diagramId, ['move'], 10, 0);
    expect(history.undo()).toBe('applied');
    expect(readOverlayScene(doc, diagramId).objects[0]?.geometry.x).toBe(10);
    history.destroy();
  });

  it('groups long drag and multi-object actions at explicit boundaries, not by time', () => {
    const { doc, diagramId, positions, history } = harness();
    addOverlayObject(doc, diagramId, draw('left'));
    addOverlayObject(doc, diagramId, draw('right', 80));
    history.clear();
    const drag = history.beginAction();
    history.runAction(drag, () => doc.transact(() => writeNodePositions(positions, { A: { x: 10, y: 10 } }), collaborationOrigins.visualLayout));
    history.runAction(drag, () => doc.transact(() => writeNodePositions(positions, { A: { x: 30, y: 40 } }), collaborationOrigins.visualLayout));
    history.endAction(drag);
    history.withAction(() => {
      moveOverlayObjects(doc, diagramId, ['left'], 12, 0);
      moveOverlayObjects(doc, diagramId, ['right'], 12, 0);
    });
    expect(history.depths).toEqual({ undo: 2, redo: 0 });
    expect(history.undo()).toBe('applied');
    expect(readOverlayScene(doc, diagramId).objects.map((item) => item.geometry.x)).toEqual([10, 80]);
    expect(history.undo()).toBe('applied');
    expect(positions.has('A')).toBe(false);
    history.destroy();
  });

  it('invalidates an entire multi-target action when one target diverges remotely', () => {
    const { doc, diagramId, history } = harness();
    addOverlayObject(doc, diagramId, draw('left'));
    addOverlayObject(doc, diagramId, draw('right', 80));
    history.clear();
    history.withAction(() => {
      moveOverlayObjects(doc, diagramId, ['left'], 10, 0);
      moveOverlayObjects(doc, diagramId, ['right'], 10, 0);
    });
    doc.transact(() => moveOverlayObjects(doc, diagramId, ['right'], 7, 0), 'remote-peer');
    expect(history.undo()).toBe('stale');
    expect(readOverlayScene(doc, diagramId).objects.map((item) => item.geometry.x)).toEqual([20, 97]);
    history.destroy();
  });

  it('keeps a remote interleaving target out of a local leased action', () => {
    const { doc, diagramId, history } = harness();
    addOverlayObject(doc, diagramId, draw('local'));
    addOverlayObject(doc, diagramId, draw('remote', 80));
    history.clear();
    const action = history.beginAction();
    history.runAction(action, () => moveOverlayObjects(doc, diagramId, ['local'], 10, 0));
    doc.transact(() => moveOverlayObjects(doc, diagramId, ['remote'], 20, 0), 'remote-peer');
    history.runAction(action, () => moveOverlayObjects(doc, diagramId, ['local'], 10, 0));
    history.endAction(action);
    expect(history.undo()).toBe('applied');
    expect(readOverlayScene(doc, diagramId).objects.map((item) => item.geometry.x)).toEqual([10, 100]);
    history.destroy();
  });

  it('consumes a source-bearing action when a peer edits that source mid-lease', () => {
    const { doc, diagramId, source, positions, history } = harness();
    addOverlayObject(doc, diagramId, draw('earlier'));
    const action = history.beginAction();
    history.runAction(action, () => canvasText(doc, source, 'flowchart TD\nA --> B'));
    doc.transact(() => source.insert(source.length, '\npeer'), 'remote-peer');
    history.runAction(action, () => doc.transact(() => {
      source.insert(source.length, '\nlocal');
      writeNodePositions(positions, { B: { x: 80, y: 40 } });
    }, collaborationOrigins.visual));
    history.endAction(action);
    const after = source.toString();

    expect(history.undo()).toBe('stale');
    expect(source.toString()).toBe(after);
    expect(source.toString()).toContain('peer');
    expect(positions.get('B')).toEqual({ x: 80, y: 40 });
    expect(history.depths).toEqual({ undo: 1, redo: 0 });
    expect(history.undo()).toBe('applied');
    expect(readOverlayScene(doc, diagramId).objects).toEqual([]);
    history.destroy();
  });

  it('does not conflict an open lease when this coordinator replays its own source journal', () => {
    const { doc, source, history } = harness();
    canvasText(doc, source, 'flowchart TD\nA --> B');
    const action = history.beginAction();
    expect(history.undo()).toBe('applied');
    history.runAction(action, () => canvasText(doc, source, 'flowchart TD\nA --> C'));
    history.endAction(action);

    expect(history.undo()).toBe('applied');
    expect(source.toString()).toBe('flowchart TD\nA');
    history.destroy();
  });

  it('keeps overlapping action leases independent and ignores cancelled leases', () => {
    const { doc, diagramId, history } = harness();
    addOverlayObject(doc, diagramId, draw('first'));
    addOverlayObject(doc, diagramId, draw('second', 80));
    history.clear();
    const first = history.beginAction(); const second = history.beginAction();
    history.runAction(first, () => moveOverlayObjects(doc, diagramId, ['first'], 10, 0));
    history.runAction(second, () => moveOverlayObjects(doc, diagramId, ['second'], 10, 0));
    history.cancelAction(first);
    history.endAction(second);
    expect(history.depths).toEqual({ undo: 1, redo: 0 });
    expect(history.undo()).toBe('applied');
    expect(readOverlayScene(doc, diagramId).objects.map((item) => item.geometry.x)).toEqual([20, 80]);
    history.destroy();
  });

  it('commits overlapping drag and resize leases in their own completion order', () => {
    const { doc, diagramId, positions, history } = harness();
    addOverlayObject(doc, diagramId, draw('resize'));
    history.clear();
    const drag = history.beginAction();
    const resize = history.beginAction();
    history.runAction(drag, () => doc.transact(
      () => writeNodePositions(positions, { A: { x: 20, y: 30 } }),
      collaborationOrigins.visualLayout,
    ));
    history.runAction(resize, () => moveOverlayObjects(doc, diagramId, ['resize'], 10, 0));
    history.endAction(drag);
    history.endAction(resize);
    expect(history.depths).toEqual({ undo: 2, redo: 0 });
    expect(history.undo()).toBe('applied');
    expect(readOverlayScene(doc, diagramId).objects[0]?.geometry.x).toBe(10);
    expect(history.undo()).toBe('applied');
    expect(positions.has('A')).toBe(false);
    history.destroy();
  });

  it('drops an in-flight drag lease when its diagram scene is replaced', () => {
    const { doc, diagramId, source, positions, history } = harness();
    const drag = history.beginAction();
    history.runAction(drag, () => doc.transact(
      () => writeNodePositions(positions, { A: { x: 20, y: 30 } }),
      collaborationOrigins.visualLayout,
    ));
    history.cancelAction(drag);
    history.destroy();
    doc.transact(() => doc.getMap('overlays').delete(diagramId), 'authoritative-import');
    getOverlayScene(doc, diagramId, true);
    const rebound = new CanvasHistoryCoordinator(doc, diagramId, source, positions);
    expect(rebound.depths).toEqual({ undo: 0, redo: 0 });
    rebound.destroy();
  });

  it('finalizes a lease after an action error without retaining its partial mutation', () => {
    const { doc, diagramId, history } = harness();
    addOverlayObject(doc, diagramId, draw('safe'));
    history.clear();
    const failed = history.beginAction();
    try {
      history.runAction(failed, () => moveOverlayObjects(doc, diagramId, ['safe'], 10, 0));
      throw new Error('pointer pipeline failed');
    } catch {
      history.cancelAction(failed);
    }
    const next = history.beginAction();
    history.runAction(next, () => moveOverlayObjects(doc, diagramId, ['safe'], 10, 0));
    history.endAction(next);
    expect(history.undo()).toBe('applied');
    expect(readOverlayScene(doc, diagramId).objects[0]?.geometry.x).toBe(20);
    history.destroy();
  });

  it('keeps source-editor history alive through an overlay root replacement', () => {
    const { doc, source } = harness();
    const sourceUndo = createSourceEditorUndoManager(source);
    doc.transact(() => source.insert(source.length, '\nTyped'), sourceUndo);
    doc.transact(() => doc.getMap('overlays').delete('main'), 'authoritative-import');
    getOverlayScene(doc, 'main', true);
    sourceUndo.undo();
    expect(source.toString()).toBe('flowchart TD\nA');
    sourceUndo.destroy();
  });
});
