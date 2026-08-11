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
