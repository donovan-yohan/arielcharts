import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { collaborationOrigins, createDiagramUndoManager, destroyDiagramUndoManager } from './collaboration-origins';

describe('collaboration transaction origins', () => {
  it('tracks only explicit local visual origins', () => {
    const doc = new Y.Doc();
    const source = doc.getText('source');
    const positions = doc.getMap<{ x: number; y: number }>('positions');
    const undoManager = createDiagramUndoManager(source, positions);

    doc.transact(() => { source.insert(0, 'flowchart TD'); }, collaborationOrigins.visual);
    doc.transact(() => { positions.set('A', { x: 12, y: 24 }); }, collaborationOrigins.visualLayout);
    doc.transact(() => { source.insert(source.length, '\nA'); }, 'mcp');
    doc.transact(() => { positions.set('B', { x: 36, y: 48 }); }, null);

    expect(undoManager.undoStack).toHaveLength(1);
    undoManager.undo();
    expect(source.toString()).toBe('\nA');
    expect([...positions.entries()]).toEqual([['B', { x: 36, y: 48 }]]);

    destroyDiagramUndoManager(undoManager);
  });

  it('keeps a manager scoped to one diagram lifecycle', () => {
    const doc = new Y.Doc();
    const first = createDiagramUndoManager(doc.getText('first'), doc.getMap('first-layout'));
    const second = createDiagramUndoManager(doc.getText('second'), doc.getMap('second-layout'));

    doc.transact(() => { doc.getText('first').insert(0, 'first'); }, collaborationOrigins.visual);
    doc.transact(() => { doc.getText('second').insert(0, 'second'); }, collaborationOrigins.visual);

    expect(first.undoStack).toHaveLength(1);
    expect(second.undoStack).toHaveLength(1);
    destroyDiagramUndoManager(first);
    destroyDiagramUndoManager(second);
  });
});
