import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { LocalAwareness, LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY, areYjsStateVectorsEqual, clearLocalWorkspaceHandoff, completeLocalWorkspacePromotion, getLocalWorkspaceLoadingCopy, publishLocalWorkspace, readLocalWorkspaceHandoff, recordLocalWorkspaceHandoff } from './local-workspace';
import { addOverlayObject } from './overlay-scene';

describe('local workspace runtime', () => {
  afterEach(() => { vi.unstubAllGlobals(); });

  function workspace(): Y.Doc {
    const doc = new Y.Doc(); const diagram = new Y.Map<unknown>();
    diagram.set('name', 'Local diagram'); diagram.set('mermaid', new Y.Text('flowchart TD\n  A --> B'));
    diagram.set('nodePositions', new Y.Map<unknown>());
    doc.getMap<Y.Map<unknown>>('diagrams').set('main', diagram); doc.getArray<string>('diagramOrder').push(['main']);
    addOverlayObject(doc, 'main', { id: 'note', kind: 'annotation.sticky', version: 1, order_key: 'a', layer: 'default', geometry: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: '' });
    return doc;
  }

  it('uses truthful phased loading copy', () => {
    expect(getLocalWorkspaceLoadingCopy('restoring').title).toContain('Restoring work saved on this device');
    expect(getLocalWorkspaceLoadingCopy('preparing').title).toContain('Preparing the canvas');
    expect(getLocalWorkspaceLoadingCopy('storage-error').detail).toContain('cannot be safely saved');
  });

  it('keeps awareness inside the current browser only', () => {
    const awareness = new LocalAwareness(42);
    const changes: number[] = [];
    awareness.on('change', () => { changes.push(1); });
    awareness.setLocalState({ user: { name: 'Human' } });
    expect(awareness.getStates()).toEqual(new Map([[42, { user: { name: 'Human' } }]]));
    awareness.setLocalStateField('canvas', { diagram_id: 'local' });
    expect(awareness.getStates().get(42)).toEqual({ user: { name: 'Human' }, canvas: { diagram_id: 'local' } });
    awareness.setLocalState(null);
    expect(awareness.getStates().size).toBe(0);
    expect(changes).toHaveLength(3);
  });

  it('stores only a non-secret online handoff and leaves archived local data alone', () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, removeItem: (key: string) => { values.delete(key); }, setItem: (key: string, value: string) => { values.set(key, value); } };
    recordLocalWorkspaceHandoff('abc123de', storage);
    expect(values.get(LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY)).toBe('{"session_id":"abc123de"}');
    expect(readLocalWorkspaceHandoff(storage)).toBe('abc123de');
    clearLocalWorkspaceHandoff('other123', storage);
    expect(readLocalWorkspaceHandoff(storage)).toBe('abc123de');
    clearLocalWorkspaceHandoff('abc123de', storage);
    expect(readLocalWorkspaceHandoff(storage)).toBeNull();
  });

  it('returns no handoff during server rendering without touching browser storage', () => {
    vi.stubGlobal('window', undefined);
    expect(readLocalWorkspaceHandoff()).toBeNull();
    expect(() => recordLocalWorkspaceHandoff('abc123de')).not.toThrow();
    expect(() => recordLocalWorkspaceHandoff('bad')).toThrow('Cannot save an invalid online workspace handoff.');
    expect(() => clearLocalWorkspaceHandoff('abc123de')).not.toThrow();
  });

  it('compares promotion state vectors byte-for-byte', () => {
    expect(areYjsStateVectorsEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2]))).toBe(true);
    expect(areYjsStateVectorsEqual(new Uint8Array([1, 2]), new Uint8Array([1, 3]))).toBe(false);
  });

  it('keeps a changed local document authoritative after a delayed room response', async () => {
    const doc = workspace();
    let resolve!: (value: { sessionId: string }) => void;
    const request = new Promise<{ sessionId: string }>((nextResolve) => { resolve = nextResolve; });
    const createRoom = vi.fn(() => request);
    const promotion = publishLocalWorkspace(doc, createRoom);
    await vi.waitFor(() => { expect(createRoom).toHaveBeenCalledOnce(); });
    doc.transact(() => { (doc.getMap<Y.Map<unknown>>('diagrams').get('main')!.get('mermaid') as Y.Text).insert(0, '%% changed\n'); });
    resolve({ sessionId: 'abc123de' });

    await expect(promotion).resolves.toEqual({ status: 'changed-during-request' });
    expect(createRoom).toHaveBeenCalledOnce();
    expect((doc.getMap<Y.Map<unknown>>('diagrams').get('main')!.get('mermaid') as Y.Text).toString()).toContain('%% changed');
  });

  it('writes the non-secret handoff before navigation, including a navigation failure', () => {
    const calls: string[] = [];
    expect(() => completeLocalWorkspacePromotion(
      { sessionId: 'abc123de' },
      () => { calls.push('navigate'); throw new Error('navigation interrupted'); },
      () => { calls.push('marker'); },
    )).toThrow('navigation interrupted');
    expect(calls).toEqual(['marker', 'navigate']);
  });
});
