import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  adaptOverlaySceneToViewport,
  addOverlayObject,
  beginOverlayTextComposition,
  commitOverlayTextComposition,
  copyOverlayObjects,
  createOverlayLocalState,
  createOverlayUndoManager,
  deleteOverlayObjects,
  editOverlayText,
  getOverlayScene,
  pasteOverlayObjects,
  readOverlayScene,
  setOverlayOrderKey,
  updateOverlayObject,
} from './overlay-scene';

function object(id: string, orderKey = 'm') {
  return {
    id,
    kind: 'foundation.card',
    version: 1,
    order_key: orderKey,
    geometry: { x: 10, y: 20, width: 30, height: 40, rotation: 0 },
    style: {}, metadata: {}, payload: { text: id },
  };
}

describe('overlay scene', () => {
  it('converges same-note character edits and keeps undo peer-local', () => {
    const left = new Y.Doc();
    addOverlayObject(left, 'main', { ...object('note'), kind: 'annotation.sticky', body: 'start' });
    const right = new Y.Doc();
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    const leftUndo = createOverlayUndoManager(left, 'main');
    const rightUndo = createOverlayUndoManager(right, 'main');
    editOverlayText(left, 'main', 'note', 0, 0, 'left ');
    editOverlayText(right, 'main', 'note', 5, 0, ' right');
    const leftDelta = Y.encodeStateAsUpdate(left, Y.encodeStateVector(right));
    const rightDelta = Y.encodeStateAsUpdate(right, Y.encodeStateVector(left));
    Y.applyUpdate(left, rightDelta);
    Y.applyUpdate(right, leftDelta);
    expect(readOverlayScene(left, 'main').objects[0]?.body).toBe(readOverlayScene(right, 'main').objects[0]?.body);
    expect(readOverlayScene(left, 'main').objects[0]?.body).toContain('left ');
    expect(readOverlayScene(left, 'main').objects[0]?.body).toContain(' right');
    leftUndo.undo();
    expect(readOverlayScene(left, 'main').objects[0]?.body).not.toContain('left ');
    expect(readOverlayScene(left, 'main').objects[0]?.body).toContain(' right');
    leftUndo.destroy(); rightUndo.destroy();
  });

  it('keeps an IME draft local and preserves a same-note remote insertion at commit', () => {
    const left = new Y.Doc(); addOverlayObject(left, 'main', { ...object('note'), kind: 'annotation.text', body: 'start' });
    const right = new Y.Doc(); Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    const composition = beginOverlayTextComposition(left, 'main', 'note');
    const localDraft = 'start漢';
    editOverlayText(right, 'main', 'note', 2, 0, '[peer]');
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right, Y.encodeStateVector(left)));
    expect(composition.base).toBe('start');
    expect(localDraft).toBe('start漢');
    expect(readOverlayScene(left, 'main').objects[0]?.body).toContain('[peer]');
    commitOverlayTextComposition(left, 'main', 'note', composition, localDraft);
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left, Y.encodeStateVector(right)));
    expect(readOverlayScene(left, 'main').objects[0]?.body).toBe(readOverlayScene(right, 'main').objects[0]?.body);
    expect(readOverlayScene(left, 'main').objects[0]?.body).toContain('[peer]');
    expect(readOverlayScene(left, 'main').objects[0]?.body).toContain('漢');
  });

  it('rejects whole-string overflow and invalid incremental ranges', () => {
    const doc = new Y.Doc();
    addOverlayObject(doc, 'main', { ...object('note'), kind: 'annotation.text', body: '' });
    expect(() => editOverlayText(doc, 'main', 'note', 1, 0, 'x')).toThrow(/Invalid/u);
    expect(() => editOverlayText(doc, 'main', 'note', 0, 0, 'x'.repeat(2_049))).toThrow(/operation is too large/u);
    expect(readOverlayScene(doc, 'main').objects[0]?.body).toBe('');
  });

  it('keeps Mermaid source byte-identical through annotation lifecycle', () => {
    const doc = new Y.Doc();
    const source = new Y.Text('sequenceDiagram\n  Alice->>Bob: hello  ');
    doc.getMap<unknown>('diagrams').set('main', new Y.Map([['mermaid', source]]));
    const before = source.toString();
    addOverlayObject(doc, 'main', { ...object('note'), kind: 'annotation.sticky', body: 'review' });
    editOverlayText(doc, 'main', 'note', 6, 0, ' me');
    updateOverlayObject(doc, 'main', 'note', { geometry: { x: 30, y: 40, width: 220, height: 120, rotation: 0 } });
    deleteOverlayObjects(doc, 'main', ['note']);
    expect(source.toString()).toBe(before);
  });
  it('converges concurrent inserts, field updates, reorder, and delete with deterministic order', () => {
    const left = new Y.Doc();
    getOverlayScene(left, 'main', true);
    const right = new Y.Doc();
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    addOverlayObject(left, 'main', object('b'));
    addOverlayObject(right, 'main', object('a'));
    const leftDelta = Y.encodeStateAsUpdate(left, Y.encodeStateVector(right));
    const rightDelta = Y.encodeStateAsUpdate(right, Y.encodeStateVector(left));
    Y.applyUpdate(left, rightDelta);
    Y.applyUpdate(right, leftDelta);
    expect(readOverlayScene(left, 'main').objects.map(({ id }) => id)).toEqual(['a', 'b']);
    expect(readOverlayScene(right, 'main')).toEqual(readOverlayScene(left, 'main'));

    updateOverlayObject(left, 'main', 'a', { metadata: { owner: 'left' } });
    setOverlayOrderKey(right, 'main', 'b', 'a');
    deleteOverlayObjects(right, 'main', ['a']);
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right, Y.encodeStateVector(left)));
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left, Y.encodeStateVector(right)));
    expect(readOverlayScene(left, 'main')).toEqual(readOverlayScene(right, 'main'));
    expect(readOverlayScene(left, 'main').objects.map(({ id }) => id)).toEqual(['b']);
  });

  it('keeps selection and drafts local while local-human changes are undoable', () => {
    const doc = new Y.Doc();
    const state = createOverlayLocalState();
    state.selectedIds.add('note');
    state.draft = { text: 'private' };
    const undo = createOverlayUndoManager(doc, 'main');
    addOverlayObject(doc, 'main', object('note'));
    expect(readOverlayScene(doc, 'main').objects).toHaveLength(1);
    undo.undo();
    expect(readOverlayScene(doc, 'main').objects).toHaveLength(0);
    expect([...state.selectedIds]).toEqual(['note']);
    expect(state.draft).toEqual({ text: 'private' });
    undo.destroy();
  });

  it('copies and pastes bounded records without sharing identity', () => {
    const doc = new Y.Doc();
    addOverlayObject(doc, 'main', object('note'));
    const copied = copyOverlayObjects(readOverlayScene(doc, 'main'), ['note']);
    expect(pasteOverlayObjects(doc, 'main', copied, () => 'copy')).toEqual(['copy']);
    expect(readOverlayScene(doc, 'main').objects.map(({ id }) => id)).toEqual(['note', 'copy']);
  });

  it('uses renderer-neutral world geometry and exposes missing anchors as orphans', () => {
    const scene = { version: 1, diagram_id: 'main', objects: [
      { ...object('anchored'), anchor: { mermaid_id: 'node-a', offset: { x: 2, y: 3 }, fallback: { x: 50, y: 60 } } },
    ] };
    const live = adaptOverlaySceneToViewport(scene, { x: 5, y: 7, zoom: 2 }, new Map([['node-a', { x: 100, y: 200 }]]));
    expect(live[0]).toMatchObject({ orphaned: false, screen_geometry: { x: 209, y: 413, width: 60, height: 80 } });
    const orphan = adaptOverlaySceneToViewport(scene, { x: -5, y: 10, zoom: 0.5 }, new Map());
    expect(orphan[0]).toMatchObject({ orphaned: true, screen_geometry: { x: 20, y: 40, width: 15, height: 20 } });
  });

  it('keeps one world contract through SVG/React Flow Fit, pan, zoom, tab, and renderer switches', () => {
    const main = { version: 1, diagram_id: 'main', objects: [object('main-object')] };
    const other = { version: 1, diagram_id: 'other', objects: [{ ...object('other-object'), geometry: { x: 200, y: 100, width: 20, height: 10, rotation: 0 } }] };
    const svgFit = adaptOverlaySceneToViewport(main, { x: 40, y: 20, zoom: 0.5 }, new Map());
    const reactFlowFit = adaptOverlaySceneToViewport(main, { x: 40, y: 20, zoom: 0.5 }, new Map());
    expect(reactFlowFit).toEqual(svgFit);
    expect(adaptOverlaySceneToViewport(main, { x: -20, y: 60, zoom: 2 }, new Map())[0]!.geometry).toEqual(main.objects[0]!.geometry);
    expect(adaptOverlaySceneToViewport(other, { x: 0, y: 0, zoom: 1 }, new Map())[0]!.id).toBe('other-object');
    expect(adaptOverlaySceneToViewport(main, { x: 40, y: 20, zoom: 0.5 }, new Map())).toEqual(svgFit);
  });

  it('preserves newer scenes as recoverable read-only content', () => {
    const doc = new Y.Doc();
    const scene = new Y.Map<unknown>();
    scene.set('version', 2);
    const objects = new Y.Map<Y.Map<unknown>>();
    const future = new Y.Map<unknown>();
    future.set('kind', 'future.card');
    future.set('version', 1);
    future.set('order_key', 'a');
    future.set('geometry', { x: 1, y: 2, width: 3, height: 4, rotation: 0 });
    future.set('style', {}); future.set('metadata', {}); future.set('payload', { opaque: true });
    objects.set('future', future);
    scene.set('objects', objects);
    scene.set('opaque_field', { retained: true });
    doc.getMap('overlays').set('main', scene);
    expect(readOverlayScene(doc, 'main')).toEqual({ version: 2, diagram_id: 'main', objects: [] });
    expect(() => addOverlayObject(doc, 'main', object('blocked'))).toThrow(/newer schema/u);
    expect((objects.get('future')?.get('payload') as { opaque: boolean }).opaque).toBe(true);
    expect(scene.get('opaque_field')).toEqual({ retained: true });
  });

  it('omits unsupported v1 kinds and versions and refuses every mutation without touching raw records', () => {
    const doc = new Y.Doc();
    getOverlayScene(doc, 'main', true);
    const objects = getOverlayScene(doc, 'main')!.objects;
    const unknown = new Y.Map<unknown>();
    unknown.set('kind', 'future.tool'); unknown.set('version', 1); unknown.set('order_key', 'a');
    unknown.set('geometry', { x: 1, y: 2, width: 3, height: 4, rotation: 0 });
    unknown.set('style', {}); unknown.set('metadata', {}); unknown.set('payload', { opaque: 'keep' });
    objects.set('unknown', unknown);
    const newer = new Y.Map<unknown>();
    newer.set('kind', 'foundation.card'); newer.set('version', 2); newer.set('order_key', 'b');
    newer.set('geometry', { x: 5, y: 6, width: 7, height: 8, rotation: 0 });
    newer.set('style', {}); newer.set('metadata', {}); newer.set('payload', { opaque: 'newer' });
    objects.set('newer', newer);
    const before = Buffer.from(Y.encodeStateAsUpdate(doc));
    expect(readOverlayScene(doc, 'main').objects).toEqual([]);
    expect(() => updateOverlayObject(doc, 'main', 'unknown', { order_key: 'z' })).toThrow(/unsupported/u);
    expect(() => setOverlayOrderKey(doc, 'main', 'newer', 'z')).toThrow(/unsupported/u);
    deleteOverlayObjects(doc, 'main', ['unknown', 'newer']);
    expect(copyOverlayObjects(readOverlayScene(doc, 'main'), ['unknown', 'newer'])).toEqual([]);
    expect(Buffer.from(Y.encodeStateAsUpdate(doc))).toEqual(before);
    expect((unknown.get('payload') as { opaque: string }).opaque).toBe('keep');
    expect((newer.get('payload') as { opaque: string }).opaque).toBe('newer');
  });
});
