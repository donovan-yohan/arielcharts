import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { admitYjsUpdate, COLLABORATION_BUDGETS, createReservedRootDocument, repairOverlayDocument, validateDocumentState } from './document-admission.js';

function overlayScene(version = 1): Y.Map<unknown> {
  const scene = new Y.Map<unknown>();
  scene.set('version', version);
  scene.set('objects', new Y.Map<unknown>());
  return scene;
}

function setScene(doc: Y.Doc, id: string, objects: Y.Map<unknown>): void {
  const scene = overlayScene();
  scene.set('objects', objects);
  doc.getMap<Y.Map<unknown>>('overlays').set(id, scene);
}

describe('document admission', () => {
  it('authoritatively repairs an offline annotation merge over 8KiB and reconciles every replica', () => {
    const server = createReservedRootDocument();
    const scene = new Y.Map<unknown>(); scene.set('version', 1); const objects = new Y.Map<Y.Map<unknown>>(); scene.set('objects', objects);
    const note = new Y.Map<unknown>();
    note.set('kind', 'annotation.text'); note.set('version', 1); note.set('order_key', 'a');
    note.set('geometry', { x: 0, y: 0, width: 100, height: 40, rotation: 0 }); note.set('style', {}); note.set('metadata', {}); note.set('payload', {});
    objects.set('note', note); const body = new Y.Text(); note.set('body', body);
    server.getMap<Y.Map<unknown>>('overlays').set('main', scene);
    const left = new Y.Doc(); const right = new Y.Doc();
    Y.applyUpdate(left, Y.encodeStateAsUpdate(server)); Y.applyUpdate(right, Y.encodeStateAsUpdate(server));
    ((left.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('note')!.get('body') as Y.Text).insert(0, 'L'.repeat(5_000));
    ((right.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('note')!.get('body') as Y.Text).insert(0, 'R'.repeat(5_000));
    const leftUpdate = Y.encodeStateAsUpdate(left, Y.encodeStateVector(server));
    expect(admitYjsUpdate(server, leftUpdate)).toEqual({ accepted: true }); Y.applyUpdate(server, leftUpdate);
    const rightUpdate = Y.encodeStateAsUpdate(right, Y.encodeStateVector(server));
    const repaired = admitYjsUpdate(server, rightUpdate);
    expect(repaired.accepted && repaired.normalizedUpdate).toBeInstanceOf(Uint8Array);
    if (!repaired.accepted || !repaired.normalizedUpdate) throw new Error('Expected authoritative repair update.');
    Y.applyUpdate(server, repaired.normalizedUpdate); Y.applyUpdate(left, repaired.normalizedUpdate); Y.applyUpdate(right, repaired.normalizedUpdate);
    const read = (doc: Y.Doc) => (((doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('note')!.get('body')) as Y.Text).toString();
    expect(Buffer.byteLength(read(server), 'utf8')).toBe(8_192);
    expect(read(left)).toBe(read(server)); expect(read(right)).toBe(read(server));
    const reload = new Y.Doc(); Y.applyUpdate(reload, Y.encodeStateAsUpdate(server)); expect(read(reload)).toBe(read(server));
  });
  it('accepts bounded annotation Y.Text and rejects missing or oversized bodies', () => {
    const valid = createReservedRootDocument();
    const scene = new Y.Map<unknown>(); scene.set('version', 1);
    const objects = new Y.Map<Y.Map<unknown>>(); scene.set('objects', objects);
    const annotation = new Y.Map<unknown>();
    annotation.set('kind', 'annotation.text'); annotation.set('version', 1); annotation.set('order_key', 'a');
    annotation.set('geometry', { x: 0, y: 0, width: 100, height: 40, rotation: 0 });
    annotation.set('style', {}); annotation.set('metadata', {}); annotation.set('payload', {}); annotation.set('body', new Y.Text('safe text'));
    objects.set('note', annotation); valid.getMap('overlays').set('main', scene);
    expect(validateDocumentState(valid)).toEqual({ accepted: true });
    annotation.delete('body');
    expect(validateDocumentState(valid)).toEqual({ accepted: false, reason: 'invalid_overlay_schema' });
    annotation.set('body', new Y.Text('x'.repeat(8_193)));
    expect(validateDocumentState(valid)).toEqual({ accepted: false, reason: 'overlay_quota_exceeded' });
  });
  it('admits only bounded v1 shapes, connectors, frames, and layers', () => {
    const doc = createReservedRootDocument(); const objects = new Y.Map<unknown>();
    const shape = new Y.Map<unknown>();
    shape.set('kind', 'shape.rectangle'); shape.set('version', 1); shape.set('order_key', 'a'); shape.set('geometry', { x: 0, y: 0, width: 100, height: 40, rotation: 0 }); shape.set('style', {}); shape.set('metadata', {}); shape.set('payload', { shape: 'rectangle' }); shape.set('body', new Y.Text('Label')); objects.set('shape', shape);
    const connector = new Y.Map<unknown>();
    connector.set('kind', 'connector.overlay'); connector.set('version', 1); connector.set('order_key', 'b'); connector.set('geometry', { x: 0, y: 0, width: 100, height: 0, rotation: 0 }); connector.set('style', {}); connector.set('metadata', {}); connector.set('payload', { start_id: 'shape', end_id: 'missing', start_fallback: { x: 0, y: 0 }, end_fallback: { x: 100, y: 0 } }); objects.set('connector', connector);
    const frame = new Y.Map<unknown>();
    frame.set('kind', 'frame.section'); frame.set('version', 1); frame.set('order_key', 'c'); frame.set('geometry', { x: 0, y: 0, width: 100, height: 80, rotation: 0 }); frame.set('style', {}); frame.set('metadata', {}); frame.set('payload', { members: ['shape'] }); objects.set('frame', frame);
    setScene(doc, 'main', objects);
    const scene = doc.getMap<Y.Map<unknown>>('overlays').get('main')!; const layers = new Y.Map<unknown>(); const defaultLayer = new Y.Map<unknown>(); defaultLayer.set('id', 'default'); defaultLayer.set('name', 'Default'); defaultLayer.set('order_key', 'a'); defaultLayer.set('visible', true); defaultLayer.set('locked', false); defaultLayer.set('export', true); layers.set('default', defaultLayer); scene.set('layers', layers);
    expect(validateDocumentState(doc)).toEqual({ accepted: true });
    connector.set('geometry', { x: 100, y: 40, width: -100, height: -40, rotation: 0 });
    expect(validateDocumentState(doc)).toEqual({ accepted: true });
    connector.set('payload', { start_id: 'shape', end_id: 'missing' });
    expect(validateDocumentState(doc)).toEqual({ accepted: false, reason: 'invalid_overlay_schema' });
    connector.set('kind', 'shape.rectangle'); connector.set('payload', {}); connector.delete('body');
    expect(validateDocumentState(doc)).toEqual({ accepted: false, reason: 'invalid_overlay_schema' });
  });
  it('repairs a legacy v1 scene with a usable deterministic default layer', () => {
    const doc = createReservedRootDocument(); setScene(doc, 'main', new Y.Map<unknown>());
    expect(repairOverlayDocument(doc)).toBe(true);
    const scene = doc.getMap<Y.Map<unknown>>('overlays').get('main')!;
    const layer = (scene.get('layers') as Y.Map<Y.Map<unknown>>).get('default')!;
    expect(Object.fromEntries(layer.entries())).toEqual({ id: 'default', name: 'Default', order_key: '0000000000000000', visible: true, locked: false, export: true });
    expect(validateDocumentState(doc)).toEqual({ accepted: true });
  });
  it('accepts bounded immutable ink and rejects partial, oversized, or non-finite stroke payloads', () => {
    const doc = createReservedRootDocument(); const objects = new Y.Map<unknown>();
    const ink = new Y.Map<unknown>();
    ink.set('kind', 'ink.stroke'); ink.set('version', 1); ink.set('order_key', 'a');
    ink.set('geometry', { x: -1.5, y: -1.5, width: 13, height: 13, rotation: 0 });
    ink.set('style', { color: '#2563eb', width: 3, opacity: 1 }); ink.set('metadata', { export: 'composite-export' });
    ink.set('payload', { mode: 'pen', composite_export: true, points: [{ x: 0, y: 0 }, { x: 10, y: 10, pressure: 0.5 }] });
    objects.set('ink', ink); setScene(doc, 'main', objects);
    expect(validateDocumentState(doc)).toEqual({ accepted: true });
    ink.set('payload', { mode: 'pen', composite_export: true, points: [{ x: 0, y: 0 }] });
    expect(validateDocumentState(doc)).toEqual({ accepted: false, reason: 'invalid_overlay_schema' });
    ink.set('payload', { mode: 'pen', composite_export: true, points: Array.from({ length: 513 }, () => ({ x: 0, y: 0 })) });
    expect(validateDocumentState(doc)).toEqual({ accepted: false, reason: 'invalid_overlay_schema' });
    ink.set('payload', { mode: 'pen', composite_export: true, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
    ink.set('geometry', { x: 1e308, y: -1.5, width: 13, height: 13, rotation: 0 });
    expect(validateDocumentState(doc)).toEqual({ accepted: false, reason: 'invalid_overlay_schema' });
  });
  it('keeps rejected raw updates byte-identical to the live document', () => {
    const live = new Y.Doc();
    live.getMap('diagrams').set('main', new Y.Map());
    const before = Buffer.from(Y.encodeStateAsUpdate(live));
    const result = admitYjsUpdate(live, new Uint8Array([255]));

    expect(result).toEqual({ accepted: false, reason: 'malformed_yjs_update' });
    expect(Buffer.from(Y.encodeStateAsUpdate(live))).toEqual(before);
  });

  it('bounds object floods, text, stroke-like arrays, and invalid numbers', () => {
    const flood = new Y.Doc();
    const floodObjects = new Y.Map<unknown>();
    for (let index = 0; index <= COLLABORATION_BUDGETS.objectsPerScene; index += 1) floodObjects.set(`object-${index}`, new Y.Map());
    setScene(flood, 'main', floodObjects);
    expect(validateDocumentState(flood)).toEqual({ accepted: false, reason: 'overlay_quota_exceeded' });

    const text = new Y.Doc();
    const textObject = new Y.Map<unknown>();
    const body = new Y.Text();
    body.insert(0, 'x'.repeat(COLLABORATION_BUDGETS.textBytesPerObject + 1));
    textObject.set('body', body);
    const textObjects = new Y.Map<unknown>();
    textObjects.set('note', textObject);
    setScene(text, 'main', textObjects);
    expect(validateDocumentState(text)).toEqual({ accepted: false, reason: 'overlay_quota_exceeded' });

    const stroke = new Y.Doc();
    const strokeObject = new Y.Map<unknown>();
    const points = new Y.Array<unknown>();
    points.insert(0, Array.from({ length: COLLABORATION_BUDGETS.strokePointsPerObject + 1 }, () => ({ x: 1, y: 2 })));
    strokeObject.set('points', points);
    const strokeObjects = new Y.Map<unknown>();
    strokeObjects.set('ink', strokeObject);
    setScene(stroke, 'main', strokeObjects);
    expect(validateDocumentState(stroke)).toEqual({ accepted: false, reason: 'overlay_quota_exceeded' });

    const nestedStroke = new Y.Doc();
    const nestedObject = new Y.Map<unknown>();
    const nestedMetadata = new Y.Map<unknown>();
    const nestedPoints = new Y.Array<unknown>();
    nestedPoints.insert(0, Array.from({ length: COLLABORATION_BUDGETS.strokePointsPerObject + 1 }, () => ({ x: 1, y: 2 })));
    nestedMetadata.set('points', nestedPoints);
    nestedObject.set('metadata', nestedMetadata);
    const nestedObjects = new Y.Map<unknown>();
    nestedObjects.set('ink', nestedObject);
    setScene(nestedStroke, 'main', nestedObjects);
    expect(validateDocumentState(nestedStroke)).toEqual({ accepted: false, reason: 'overlay_quota_exceeded' });

    const nativeNestedStroke = new Y.Doc();
    const nativeObject = new Y.Map<unknown>();
    nativeObject.set('metadata', {
      points: Array.from({ length: COLLABORATION_BUDGETS.strokePointsPerObject + 1 }, () => ({ x: 1, y: 2 })),
    });
    const nativeObjects = new Y.Map<unknown>();
    nativeObjects.set('ink', nativeObject);
    setScene(nativeNestedStroke, 'main', nativeObjects);
    expect(validateDocumentState(nativeNestedStroke)).toEqual({ accepted: false, reason: 'overlay_quota_exceeded' });

    const invalidNumber = new Y.Doc();
    invalidNumber.getMap('future').set('coordinate', Number.NaN);
    expect(validateDocumentState(invalidNumber)).toEqual({ accepted: false, reason: 'invalid_document_value' });

    const malformedOverlay = new Y.Doc();
    const malformedScene = overlayScene(0);
    malformedOverlay.getMap<Y.Map<unknown>>('overlays').set('main', malformedScene);
    expect(validateDocumentState(malformedOverlay)).toEqual({ accepted: false, reason: 'invalid_overlay_schema' });
  });

  it('rejects malformed reserved collection roots and values', () => {
    const invalidOrder = new Y.Doc();
    invalidOrder.getArray<unknown>('diagramOrder').push([42]);
    expect(validateDocumentState(invalidOrder)).toEqual({ accepted: false, reason: 'invalid_reserved_root' });

    const invalidActivity = new Y.Doc();
    invalidActivity.getArray<unknown>('activity').push([{ id: 'activity', timestamp: 1, actor: { name: 'A', type: 'robot' }, action: 'edited' }]);
    expect(validateDocumentState(invalidActivity)).toEqual({ accepted: false, reason: 'invalid_reserved_root' });

    const invalidPresence = new Y.Doc();
    invalidPresence.getMap<unknown>('presence').set('A', { name: 'A', color: '#111111', type: 'robot' });
    expect(validateDocumentState(invalidPresence)).toEqual({ accepted: false, reason: 'invalid_reserved_root' });

    const invalidOverlays = new Y.Doc();
    invalidOverlays.getArray('overlays');
    expect(validateDocumentState(invalidOverlays)).toEqual({ accepted: false, reason: 'invalid_reserved_root' });
  });

  it('rejects raw updates that encode a reserved root as the wrong collection type', () => {
    const wrongRoots: Array<{ key: string; populate: (doc: Y.Doc, key: string) => void }> = [
      { key: 'diagrams', populate: (doc, key) => doc.getArray(key).push(['not a map']) },
      { key: 'diagramOrder', populate: (doc, key) => doc.getMap(key).set('not', 'an array') },
      { key: 'activity', populate: (doc, key) => doc.getMap(key).set('not', 'an array') },
      { key: 'presence', populate: (doc, key) => doc.getArray(key).push(['not a map']) },
      { key: 'overlays', populate: (doc, key) => doc.getArray(key).push(['not a map']) },
    ];

    for (const { key, populate } of wrongRoots) {
      const live = createReservedRootDocument();
      const attacker = new Y.Doc();
      populate(attacker, key);
      const before = Buffer.from(Y.encodeStateAsUpdate(live));
      expect(admitYjsUpdate(live, Y.encodeStateAsUpdate(attacker))).toEqual({ accepted: false, reason: 'invalid_reserved_root' });
      expect(Buffer.from(Y.encodeStateAsUpdate(live))).toEqual(before);
      live.destroy();
      attacker.destroy();
    }
  });

  it('repairs legacy v1 envelopes but leaves a newer scene byte-for-byte owned by its newer client', () => {
    const doc = new Y.Doc();
    const overlays = doc.getMap<Y.Map<unknown>>('overlays');
    const legacy = new Y.Map<unknown>();
    legacy.set('objects', new Y.Map());
    overlays.set('legacy', legacy);
    const future = overlayScene(2);
    const opaque = new Y.Map<unknown>();
    opaque.set('keep', true);
    future.set('opaque_newer_field', opaque);
    overlays.set('future', future);

    expect(repairOverlayDocument(doc)).toBe(true);
    expect(legacy.get('version')).toBe(1);
    expect(future.get('version')).toBe(2);
    expect((future.get('opaque_newer_field') as Y.Map<unknown>).get('keep')).toBe(true);
    expect(repairOverlayDocument(doc)).toBe(false);
    expect(validateDocumentState(doc)).toEqual({ accepted: true });
  });
});
