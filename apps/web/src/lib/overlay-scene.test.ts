import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  adaptOverlaySceneToViewport,
  addOverlayObject,
  addOverlayLayer,
  beginOverlayTextComposition,
  commitOverlayTextComposition,
  copyOverlayObjects,
  createOverlayLocalState,
  createOverlayUndoManager,
  deleteOverlayObjects,
  DIAMOND_ABSOLUTE_ROTATION_MODEL,
  editOverlayText,
  getOverlayScene,
  getOverlayTransformTargets,
  getCompositeExportObjects,
  getOverlayLayers,
  moveOverlayObjects,
  pasteOverlayObjects,
  readOverlayScene,
  reorderOverlayObject,
  setOverlayOrderKey,
  transformOverlayObject,
  updateOverlayLayer,
  updateOverlayObject,
} from './overlay-scene';
import { inkGeometry, simplifyInkPoints } from './freehand-ink';

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
  it('moves overlay ordering in deterministic adjacent and endpoint steps', () => {
    const doc = new Y.Doc();
    addOverlayObject(doc, 'main', object('a', 'a'));
    addOverlayObject(doc, 'main', object('b', 'b'));
    addOverlayObject(doc, 'main', object('c', 'c'));
    reorderOverlayObject(doc, 'main', 'a', 'forward');
    expect(readOverlayScene(doc, 'main').objects.map(({ id }) => id)).toEqual(['b', 'a', 'c']);
    reorderOverlayObject(doc, 'main', 'a', 'front');
    reorderOverlayObject(doc, 'main', 'c', 'backward');
    expect(readOverlayScene(doc, 'main').objects.map(({ id }) => id)).toEqual(['c', 'b', 'a']);
    reorderOverlayObject(doc, 'main', 'a', 'back');
    expect(readOverlayScene(doc, 'main').objects.map(({ id }) => id)).toEqual(['a', 'c', 'b']);
  });
  it('reorders only the selected object within its layer without rewriting locked or other-layer peers', () => {
    const doc = new Y.Doc();
    addOverlayLayer(doc, 'main', { id: 'notes', name: 'Notes', order_key: 'b', visible: true, locked: false, export: true });
    addOverlayObject(doc, 'main', { ...object('left', 'a'), layer: 'default' });
    addOverlayObject(doc, 'main', { ...object('locked', 'b'), layer: 'default', metadata: { locked: true } });
    addOverlayObject(doc, 'main', { ...object('right', 'c'), layer: 'default' });
    addOverlayObject(doc, 'main', { ...object('note', 'a'), layer: 'notes' });
    const before = new Map(readOverlayScene(doc, 'main').objects.map((item) => [item.id, item.order_key]));
    reorderOverlayObject(doc, 'main', 'left', 'front');
    const after = readOverlayScene(doc, 'main');
    expect(after.objects.filter((item) => (item.layer ?? 'default') === 'default').map(({ id }) => id)).toEqual(['locked', 'right', 'left']);
    expect(after.objects.find((item) => item.id === 'locked')?.order_key).toBe(before.get('locked'));
    expect(after.objects.find((item) => item.id === 'right')?.order_key).toBe(before.get('right'));
    expect(after.objects.find((item) => item.id === 'note')?.order_key).toBe(before.get('note'));
  });
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
  it('commits concurrent finalized immutable strokes once each without changing Mermaid source', () => {
    const left = new Y.Doc(); const source = new Y.Text('flowchart TD\nA-->B  ');
    left.getMap<unknown>('diagrams').set('main', new Y.Map([['mermaid', source]]));
    getOverlayScene(left, 'main', true);
    const right = new Y.Doc(); Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    const stroke = (id: string, offset: number) => { const points = simplifyInkPoints([{ x: offset, y: 0 }, { x: offset + 10, y: 10 }]); return { ...object(id), kind: 'ink.stroke', geometry: inkGeometry(points, 3), style: { color: '#2563eb', width: 3, opacity: 1 }, metadata: { export: 'composite-export' }, payload: { mode: 'pen', composite_export: true, points } }; };
    const before = source.toString();
    addOverlayObject(left, 'main', stroke('left-ink', 0)); addOverlayObject(right, 'main', stroke('right-ink', 20));
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right, Y.encodeStateVector(left)));
    Y.applyUpdate(right, Y.encodeStateAsUpdate(left, Y.encodeStateVector(right)));
    expect(readOverlayScene(left, 'main')).toEqual(readOverlayScene(right, 'main'));
    expect(readOverlayScene(left, 'main').objects.filter(({ kind }) => kind === 'ink.stroke')).toHaveLength(2);
    expect(source.toString()).toBe(before);
  });
  it('moves an ink stroke as one immutable whole-stroke object', () => {
    const doc = new Y.Doc();
    const points = [{ x: 10, y: 20 }, { x: 20, y: 30 }];
    addOverlayObject(doc, 'main', { ...object('ink'), kind: 'ink.stroke', geometry: inkGeometry(points, 3), style: { color: '#2563eb', width: 3, opacity: 1 }, metadata: { export: 'composite-export' }, payload: { mode: 'pen', composite_export: true, points } });
    const source = doc.getText('mermaid'); source.insert(0, 'flowchart TD\nA-->B'); const before = source.toString();
    const controller = { move: (id: string, dx: number, dy: number) => {
      const current = readOverlayScene(doc, 'main').objects.find((item) => item.id === id)!;
      updateOverlayObject(doc, 'main', id, { geometry: { ...current.geometry, x: current.geometry.x + dx, y: current.geometry.y + dy }, payload: { ...current.payload, points: (current.payload.points as Array<{ x: number; y: number }>).map((point) => ({ ...point, x: point.x + dx, y: point.y + dy })) } });
    } };
    controller.move('ink', 5, -2);
    expect(readOverlayScene(doc, 'main').objects[0]?.payload.points).toEqual([{ x: 15, y: 18 }, { x: 25, y: 28 }]);
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

  it('keeps shapes, connectors, frames, and layers in the overlay plane with deterministic fallbacks', () => {
    const doc = new Y.Doc(); const source = doc.getText('mermaid'); source.insert(0, 'flowchart TD\nA-->B  '); const before = source.toString();
    addOverlayObject(doc, 'main', { ...object('left'), kind: 'shape.rectangle', body: 'Left', layer: 'default' });
    addOverlayObject(doc, 'main', { ...object('right'), kind: 'shape.ellipse', geometry: { x: 110, y: 20, width: 30, height: 40, rotation: 0 }, body: 'Right', layer: 'default' });
    addOverlayObject(doc, 'main', { ...object('edge'), kind: 'connector.overlay', geometry: { x: 25, y: 40, width: 100, height: 0, rotation: 0 }, payload: { start_id: 'left', end_id: 'right', start_fallback: { x: 25, y: 40 }, end_fallback: { x: 125, y: 40 } } });
    addOverlayObject(doc, 'main', { ...object('frame'), kind: 'frame.section', payload: { members: ['left', 'right'] } });
    addOverlayLayer(doc, 'main', { id: 'facilitation', name: 'Facilitation', order_key: 'z', visible: true, locked: false, export: false });
    updateOverlayLayer(doc, 'main', 'facilitation', { locked: true });
    moveOverlayObjects(doc, 'main', ['frame'], 20, -5);
    const scene = readOverlayScene(doc, 'main');
    expect(scene.layers).toEqual(expect.arrayContaining([expect.objectContaining({ id: 'default' }), expect.objectContaining({ id: 'facilitation', locked: true, export: false })]));
    expect(scene.objects.find(({ id }) => id === 'left')?.geometry).toMatchObject({ x: 30, y: 15 });
    expect(getCompositeExportObjects({ ...scene, objects: [{ ...scene.objects[0]!, metadata: { export: 'composite-export' }, layer: 'facilitation' }] })).toEqual([]);
    const edge = adaptOverlaySceneToViewport(scene, { x: 0, y: 0, zoom: 1 }, new Map()).find(({ id }) => id === 'edge')!;
    expect(edge).toMatchObject({ orphaned: false, screen_geometry: { x: 45, y: 35, width: 100, height: 0 } });
    deleteOverlayObjects(doc, 'main', ['right']);
    expect(adaptOverlaySceneToViewport(readOverlayScene(doc, 'main'), { x: 0, y: 0, zoom: 1 }, new Map()).find(({ id }) => id === 'edge')?.orphaned).toBe(true);
    expect(source.toString()).toBe(before);
  });

  it('blocks a whole frame or multi-transform when any expanded member is locked', () => {
    const doc = new Y.Doc();
    addOverlayObject(doc, 'main', { ...object('left'), kind: 'shape.rectangle', body: 'Left', layer: 'default' });
    addOverlayObject(doc, 'main', { ...object('right'), kind: 'shape.rectangle', body: 'Right', layer: 'default', metadata: { locked: true } });
    addOverlayObject(doc, 'main', { ...object('frame'), kind: 'frame.section', payload: { members: ['left', 'right'] } });
    const before = readOverlayScene(doc, 'main');
    expect(getOverlayTransformTargets(before, ['frame'])).toBeNull();
    moveOverlayObjects(doc, 'main', ['frame'], 40, 20);
    expect(readOverlayScene(doc, 'main').objects.map(({ id, geometry }) => ({ id, geometry }))).toEqual(before.objects.map(({ id, geometry }) => ({ id, geometry })));
    updateOverlayObject(doc, 'main', 'right', { metadata: {} });
    expect(getOverlayTransformTargets(readOverlayScene(doc, 'main'), ['frame'])).toEqual(['frame', 'left', 'right']);
    moveOverlayObjects(doc, 'main', ['frame'], 40, 20);
    expect(readOverlayScene(doc, 'main').objects.find(({ id }) => id === 'left')?.geometry).toMatchObject({ x: 50, y: 40 });
    expect(readOverlayScene(doc, 'main').objects.find(({ id }) => id === 'right')?.geometry).toMatchObject({ x: 50, y: 40 });
  });

  it('commits direct geometry only from its expected peer-local starting geometry', () => {
    const doc = new Y.Doc();
    addOverlayObject(doc, 'main', { ...object('shape'), kind: 'shape.rectangle', body: 'Shape' });
    const start = readOverlayScene(doc, 'main').objects[0]!.geometry;
    const next = { ...start, x: 35, width: 90, rotation: 45 };
    expect(transformOverlayObject(doc, 'main', 'shape', start, next)).toBe('applied');
    expect(readOverlayScene(doc, 'main').objects[0]?.geometry).toEqual(next);

    const beforeStale = readOverlayScene(doc, 'main').objects[0]!.geometry;
    const peer = new Y.Doc();
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    updateOverlayObject(peer, 'main', 'shape', { geometry: { ...beforeStale, y: 99 } });
    Y.applyUpdate(doc, Y.encodeStateAsUpdate(peer, Y.encodeStateVector(doc)), 'remote-peer');
    expect(transformOverlayObject(doc, 'main', 'shape', beforeStale, { ...beforeStale, x: 999 })).toBe('stale');
    expect(readOverlayScene(doc, 'main').objects[0]?.geometry).toEqual({ ...beforeStale, y: 99 });

    const current = readOverlayScene(doc, 'main').objects[0]!.geometry;
    expect(transformOverlayObject(doc, 'main', 'shape', current, { ...current, width: -1 })).toBe('invalid');
    expect(readOverlayScene(doc, 'main').objects[0]?.geometry).toEqual(current);
    addOverlayObject(doc, 'main', { ...object('line'), kind: 'shape.line', geometry: { x: 10, y: 20, width: 30, height: 10, rotation: 0 } });
    const line = readOverlayScene(doc, 'main').objects.find(({ id }) => id === 'line')!;
    expect(transformOverlayObject(doc, 'main', 'line', line.geometry, { ...line.geometry, width: -30, height: -10 })).toBe('applied');
    expect(readOverlayScene(doc, 'main').objects.find(({ id }) => id === 'line')?.geometry).toMatchObject({ width: -30, height: -10 });
  });

  it('migrates a legacy diamond to an explicit absolute rotation in its first transform only', () => {
    const doc = new Y.Doc();
    addOverlayObject(doc, 'main', { ...object('legacy'), kind: 'shape.diamond', geometry: { x: 10, y: 20, width: 80, height: 80, rotation: 0 }, body: 'Legacy' });
    const legacy = readOverlayScene(doc, 'main').objects[0]!;
    // The caller compares the persisted pre-migration geometry, but submits
    // the legacy visual basis (0 + implicit 45) as the new absolute geometry.
    expect(transformOverlayObject(doc, 'main', legacy.id, legacy.geometry, { ...legacy.geometry, width: 112, rotation: 45 })).toBe('applied');
    expect(readOverlayScene(doc, 'main').objects[0]).toMatchObject({ geometry: { width: 112, rotation: 45 }, payload: { rotation_model: DIAMOND_ABSOLUTE_ROTATION_MODEL } });

    addOverlayObject(doc, 'main', { ...object('absolute'), kind: 'shape.diamond', geometry: { x: 120, y: 20, width: 80, height: 80, rotation: 0 }, payload: { rotation_model: DIAMOND_ABSOLUTE_ROTATION_MODEL }, body: 'Absolute' });
    const absolute = readOverlayScene(doc, 'main').objects.find(({ id }) => id === 'absolute')!;
    expect(transformOverlayObject(doc, 'main', absolute.id, absolute.geometry, absolute.geometry)).toBe('applied');
    expect(readOverlayScene(doc, 'main').objects.find(({ id }) => id === 'absolute')?.geometry.rotation).toBe(0);
  });

  it('does not bypass object, layer, or frame-member locks for direct transforms', () => {
    const doc = new Y.Doc();
    addOverlayObject(doc, 'main', { ...object('member'), kind: 'shape.rectangle', body: 'Member' });
    addOverlayObject(doc, 'main', { ...object('frame'), kind: 'frame.section', payload: { members: ['member'] }, metadata: { locked: true } });
    const member = readOverlayScene(doc, 'main').objects.find(({ id }) => id === 'member')!;
    expect(transformOverlayObject(doc, 'main', 'member', member.geometry, { ...member.geometry, x: 80 })).toBe('locked');
    expect(readOverlayScene(doc, 'main').objects.find(({ id }) => id === 'member')?.geometry).toEqual(member.geometry);

    addOverlayLayer(doc, 'main', { id: 'locked-layer', name: 'Locked', order_key: 'z', visible: true, locked: true, export: true });
    addOverlayObject(doc, 'main', { ...object('layer-member'), kind: 'shape.rectangle', body: 'Layer member', layer: 'locked-layer' });
    addOverlayObject(doc, 'main', { ...object('self-locked'), kind: 'shape.rectangle', body: 'Self locked', metadata: { locked: true } });
    const scene = readOverlayScene(doc, 'main');
    for (const id of ['layer-member', 'self-locked']) {
      const locked = scene.objects.find((item) => item.id === id)!;
      expect(transformOverlayObject(doc, 'main', id, locked.geometry, { ...locked.geometry, x: 80 })).toBe('locked');
    }
  });

  it('keeps layer create, edit, and reorder undo/redo peer-local without touching objects or source', () => {
    const left = new Y.Doc(); const source = left.getText('mermaid'); source.insert(0, 'flowchart TD\nA-->B');
    getOverlayScene(left, 'main', true); const right = new Y.Doc(); Y.applyUpdate(right, Y.encodeStateAsUpdate(left));
    const undo = createOverlayUndoManager(left, 'main');
    addOverlayObject(left, 'main', object('object'));
    undo.stopCapturing(); addOverlayLayer(left, 'main', { id: 'left', name: 'Left', order_key: 'm', visible: true, locked: false, export: true });
    undo.stopCapturing(); updateOverlayLayer(left, 'main', 'left', { name: 'Left updated' });
    undo.stopCapturing();
    updateOverlayLayer(left, 'main', 'left', { order_key: '~front' });
    addOverlayLayer(right, 'main', { id: 'peer', name: 'Peer', order_key: 'z', visible: true, locked: false, export: true });
    Y.applyUpdate(left, Y.encodeStateAsUpdate(right, Y.encodeStateVector(left)));
    undo.undo(); undo.undo(); undo.undo();
    expect(getOverlayLayers(left, 'main').map(({ id }) => id)).toContain('peer');
    expect(getOverlayLayers(left, 'main').some(({ id }) => id === 'left')).toBe(false);
    expect(readOverlayScene(left, 'main').objects.map(({ id }) => id)).toEqual(['object']);
    expect(source.toString()).toBe('flowchart TD\nA-->B');
    undo.redo(); undo.redo(); undo.redo();
    expect(getOverlayLayers(left, 'main').find(({ id }) => id === 'left')).toMatchObject({ name: 'Left updated', order_key: '~front' });
    expect(getOverlayLayers(left, 'main').some(({ id }) => id === 'peer')).toBe(true);
    undo.destroy();
  });

  it('exports frame-contained content only when every containing frame and layer permits it', () => {
    const base = object('child');
    const scene = {
      version: 1 as const, diagram_id: 'main',
      layers: [{ id: 'default', name: 'Default', order_key: 'a', visible: true, locked: false, export: true }],
      objects: [
        { ...base, metadata: { export: 'composite-export' } },
        { ...object('inner'), kind: 'frame.section', metadata: { export: 'composite-export' }, payload: { members: ['child'], composite_members: true } },
        { ...object('outer'), kind: 'frame.section', metadata: { export: 'composite-export' }, payload: { members: ['inner'], composite_members: true } },
      ],
    };
    expect(getCompositeExportObjects(scene).map(({ id }) => id)).toEqual(['child', 'inner', 'outer']);
    const excludedInner = { ...scene, objects: scene.objects.map((item) => item.id === 'inner' ? { ...item, payload: { ...item.payload, composite_members: false } } : item) };
    expect(getCompositeExportObjects(excludedInner).map(({ id }) => id)).toEqual(['inner', 'outer']);
    const hiddenLayer = { ...scene, layers: [{ ...scene.layers[0]!, visible: false }] };
    expect(getCompositeExportObjects(hiddenLayer)).toEqual([]);
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
