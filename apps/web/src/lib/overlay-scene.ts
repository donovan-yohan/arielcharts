import {
  OVERLAY_SCENE_SCHEMA_VERSION,
  type OverlayGeometry,
  type OverlayLayerRecord,
  type OverlayMetadata,
  type OverlayObjectRecord,
  type OverlaySceneSnapshot,
  type OverlayWorldPoint,
} from '@arielcharts/shared';
import * as Y from 'yjs';
import { validInkObject } from './freehand-ink';
import { overlayGeometryEqual } from './overlay-transform';

export const overlayOrigins = {
  localHuman: Symbol('arielcharts.local-human.overlay'),
} as const;

export interface OverlaySceneHandle {
  scene: Y.Map<unknown>;
  objects: Y.Map<Y.Map<unknown>>;
  layers: Y.Map<Y.Map<unknown>> | null;
  writable: boolean;
}

export interface OverlayTextComposition {
  base: string;
  positions: Y.RelativePosition[];
}

export interface OverlayLocalState {
  selectedIds: Set<string>;
  draft: unknown | null;
  tool: string;
}

export type OverlayTransformCommitResult = 'applied' | 'stale' | 'locked' | 'missing' | 'invalid';
/** Diamonds created before direct transforms implicitly painted at +45°. */
export const DIAMOND_ABSOLUTE_ROTATION_MODEL = 'absolute';

export function isLegacyDiamondRotation(object: Pick<OverlayObjectRecord, 'kind' | 'payload'>): boolean {
  return object.kind === 'shape.diamond' && object.payload.rotation_model !== DIAMOND_ABSOLUTE_ROTATION_MODEL;
}

export function effectiveOverlayGeometry(object: Pick<OverlayObjectRecord, 'kind' | 'payload' | 'geometry'>): OverlayGeometry {
  if (!isLegacyDiamondRotation(object)) return object.geometry;
  return { ...object.geometry, rotation: (object.geometry.rotation + 45) % 360 };
}

const MAX_METADATA_ENTRIES = 32;
const MAX_METADATA_KEY_BYTES = 128;
const MAX_METADATA_STRING_BYTES = 2_048;
export const MAX_OVERLAY_TEXT_BYTES = 8_192;
const MAX_TEXT_INSERT_BYTES = 2_048;
const MAX_OVERLAY_LAYERS = 32;
const DEFAULT_LAYER_ID = 'default';
const TEXT_OPERATION_WINDOW_MS = 10_000;
const TEXT_OPERATIONS_PER_WINDOW = 120;
const textOperationWindows = new WeakMap<Y.Doc, { startedAt: number; count: number }>();

export const overlayKinds = [
  'foundation.card', 'annotation.text', 'annotation.sticky', 'ink.stroke',
  'shape.rectangle', 'shape.ellipse', 'shape.diamond', 'shape.line', 'shape.arrow',
  'connector.overlay', 'frame.section',
] as const;

export function defaultOverlayLayer(): OverlayLayerRecord {
  return { id: DEFAULT_LAYER_ID, name: 'Default', order_key: '0000000000000000', visible: true, locked: false, export: true };
}

function layerMap(layer: OverlayLayerRecord): Y.Map<unknown> {
  const target = new Y.Map<unknown>();
  for (const [key, value] of Object.entries(layer)) target.set(key, value);
  return target;
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function validPoint(value: unknown): value is OverlayWorldPoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<OverlayWorldPoint>;
  return finite(point.x) && finite(point.y);
}

function lineGeometryKind(kind: string | undefined): boolean {
  return kind === 'shape.line' || kind === 'shape.arrow' || kind === 'connector.overlay';
}

function validGeometry(value: unknown, kind?: string): value is OverlayGeometry {
  if (!validPoint(value)) return false;
  const geometry = value as Partial<OverlayGeometry>;
  return finite(geometry.width)
    && finite(geometry.height)
    && finite(geometry.rotation)
    && (lineGeometryKind(kind) || (geometry.width >= 0 && geometry.height >= 0));
}

function validMetadata(value: unknown): value is OverlayMetadata {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  if (entries.length > MAX_METADATA_ENTRIES) return false;
  return entries.every(([key, item]) => byteLength(key) <= MAX_METADATA_KEY_BYTES
    && (item === null || typeof item === 'boolean' || finite(item)
      || (typeof item === 'string' && byteLength(item) <= MAX_METADATA_STRING_BYTES)));
}

function cloneJsonRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  try {
    return structuredClone(value as Record<string, unknown>);
  } catch {
    return null;
  }
}

function validLayer(value: unknown): value is OverlayLayerRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const layer = value as Partial<OverlayLayerRecord>;
  return typeof layer.id === 'string' && layer.id.length > 0 && byteLength(layer.id) <= MAX_METADATA_KEY_BYTES
    && typeof layer.name === 'string' && byteLength(layer.name) <= MAX_METADATA_STRING_BYTES
    && typeof layer.order_key === 'string' && layer.order_key.length > 0 && byteLength(layer.order_key) <= MAX_METADATA_KEY_BYTES
    && typeof layer.visible === 'boolean' && typeof layer.locked === 'boolean' && typeof layer.export === 'boolean';
}

function readLayers(handle: OverlaySceneHandle): OverlayLayerRecord[] {
  if (!handle.layers) return [defaultOverlayLayer()];
  const layers = [...handle.layers.entries()]
    .flatMap(([id, value]) => {
      const layer = value instanceof Y.Map ? Object.fromEntries(value.entries()) : value;
      return validLayer(layer) && layer.id === id ? [structuredClone(layer)] : [];
    })
    .sort((left, right) => left.order_key.localeCompare(right.order_key) || left.id.localeCompare(right.id));
  return layers.length ? layers : [defaultOverlayLayer()];
}

function sortForLayers<T extends OverlayObjectRecord>(objects: readonly T[], layers: readonly OverlayLayerRecord[]): T[] {
  const layerOrder = new Map(layers.map((layer, index) => [layer.id, index]));
  return [...objects].sort((left, right) => (layerOrder.get(left.layer ?? DEFAULT_LAYER_ID) ?? 0) - (layerOrder.get(right.layer ?? DEFAULT_LAYER_ID) ?? 0)
    || left.order_key.localeCompare(right.order_key) || left.id.localeCompare(right.id));
}

export function getOverlayScene(doc: Y.Doc, diagramId: string, create = false): OverlaySceneHandle | null {
  const root = doc.getMap<Y.Map<unknown>>('overlays');
  let scene = root.get(diagramId);
  if (!scene && create) {
    scene = new Y.Map<unknown>();
    scene.set('version', OVERLAY_SCENE_SCHEMA_VERSION);
    scene.set('objects', new Y.Map<Y.Map<unknown>>());
    const layers = new Y.Map<Y.Map<unknown>>();
    layers.set(DEFAULT_LAYER_ID, layerMap(defaultOverlayLayer()));
    scene.set('layers', layers);
    root.set(diagramId, scene);
  }
  if (!(scene instanceof Y.Map)) return null;
  const version = scene.get('version');
  const objects = scene.get('objects');
  if (!Number.isInteger(version) || (version as number) < 1 || !(objects instanceof Y.Map)) return null;
  const layers = scene.get('layers');
  return { scene, objects: objects as Y.Map<Y.Map<unknown>>, layers: layers instanceof Y.Map ? layers as Y.Map<Y.Map<unknown>> : null, writable: version === OVERLAY_SCENE_SCHEMA_VERSION };
}

export function readOverlayObject(id: string, value: unknown): OverlayObjectRecord | null {
  if (!(value instanceof Y.Map)) return null;
  const kind = value.get('kind');
  const version = value.get('version');
  const orderKey = value.get('order_key');
  const geometry = value.get('geometry');
  const style = value.get('style');
  const metadata = value.get('metadata');
  const payload = cloneJsonRecord(value.get('payload'));
  const body = value.get('body');
  const layer = value.get('layer');
  const anchor = value.get('anchor');
  if (!id || typeof kind !== 'string' || !kind || !Number.isInteger(version) || (version as number) < 1
    || typeof orderKey !== 'string' || !orderKey || !validGeometry(geometry, kind)
    || !validMetadata(style) || !validMetadata(metadata) || payload === null
    || (layer !== undefined && typeof layer !== 'string')
    || (body !== undefined && !(body instanceof Y.Text))) return null;
  if (anchor !== undefined) {
    if (!anchor || typeof anchor !== 'object' || Array.isArray(anchor)) return null;
    const candidate = anchor as { mermaid_id?: unknown; offset?: unknown; fallback?: unknown };
    if (typeof candidate.mermaid_id !== 'string' || !candidate.mermaid_id
      || !validPoint(candidate.offset) || !validPoint(candidate.fallback)) return null;
  }
  return {
    id,
    kind,
    version: version as number,
    order_key: orderKey,
    geometry: structuredClone(geometry),
    ...(anchor === undefined ? {} : { anchor: structuredClone(anchor) }),
    ...(layer === undefined ? {} : { layer }),
    style: structuredClone(style),
    metadata: structuredClone(metadata),
    payload,
    ...(body instanceof Y.Text ? { body: body.toString() } : {}),
  };
}

export function isSupportedOverlayObject(object: OverlayObjectRecord): boolean {
  return (overlayKinds.includes(object.kind as typeof overlayKinds[number]) && object.kind !== 'ink.stroke' && object.version === 1)
    || validInkObject(object);
}

export function readOverlayScene(doc: Y.Doc, diagramId: string): OverlaySceneSnapshot {
  const handle = getOverlayScene(doc, diagramId);
  if (!handle) return { version: OVERLAY_SCENE_SCHEMA_VERSION, diagram_id: diagramId, objects: [] };
  if (!handle.writable) return { version: handle.scene.get('version') as number, diagram_id: diagramId, objects: [] };
  const layers = readLayers(handle);
  const objects = sortForLayers([...handle.objects.entries()]
    .flatMap(([id, value]) => {
      const object = readOverlayObject(id, value);
      return object && isSupportedOverlayObject(object) ? [object] : [];
    }), layers);
  return { version: handle.scene.get('version') as number, diagram_id: diagramId, objects, layers };
}

function writeObject(target: Y.Map<unknown>, object: OverlayObjectRecord): void {
  target.set('kind', object.kind);
  target.set('version', object.version);
  target.set('order_key', object.order_key);
  target.set('geometry', structuredClone(object.geometry));
  if (object.anchor) target.set('anchor', structuredClone(object.anchor)); else target.delete('anchor');
  if (object.layer) target.set('layer', object.layer); else target.delete('layer');
  target.set('style', structuredClone(object.style));
  target.set('metadata', structuredClone(object.metadata));
  target.set('payload', structuredClone(object.payload));
  if (object.kind.startsWith('annotation.') || object.kind.startsWith('shape.')) {
    if (!target.doc) target.set('body', new Y.Text());
    else if (!(target.get('body') instanceof Y.Text)) target.set('body', new Y.Text());
  } else target.delete('body');
}

/**
 * Low-level snapshot helpers used by the canvas-history coordinator. They are
 * deliberately target-scoped: restoring one overlay must never rewrite an
 * unrelated collaborator's object or layer.
 */
export function readOverlayHistoryTargets(doc: Y.Doc, diagramId: string): {
  objects: Map<string, OverlayObjectRecord>;
  layers: Map<string, OverlayLayerRecord>;
} {
  const handle = getOverlayScene(doc, diagramId);
  if (!handle || !handle.writable) return { objects: new Map(), layers: new Map() };
  const objects = new Map<string, OverlayObjectRecord>();
  for (const [id, value] of handle.objects.entries()) {
    const object = readOverlayObject(id, value);
    if (object && isSupportedOverlayObject(object)) objects.set(id, structuredClone(object));
  }
  const layers = new Map<string, OverlayLayerRecord>();
  if (handle.layers) {
    for (const [id, value] of handle.layers.entries()) {
      const layer = value instanceof Y.Map ? Object.fromEntries(value.entries()) : value;
      if (validLayer(layer) && layer.id === id) layers.set(id, structuredClone(layer));
    }
  }
  return { objects, layers };
}

export function restoreOverlayHistoryObject(doc: Y.Doc, diagramId: string, objectId: string, object: OverlayObjectRecord | null): void {
  const handle = object ? requireWritableScene(doc, diagramId) : getOverlayScene(doc, diagramId);
  if (!handle?.writable) return;
  if (!object) {
    handle.objects.delete(objectId);
    return;
  }
  let target = handle.objects.get(objectId);
  if (!(target instanceof Y.Map)) {
    target = new Y.Map<unknown>();
    handle.objects.set(objectId, target);
  }
  writeObject(target, structuredClone(object));
  const body = target.get('body');
  if (body instanceof Y.Text) {
    body.delete(0, body.length);
    if (object.body) body.insert(0, object.body);
  }
}

export function restoreOverlayHistoryLayer(doc: Y.Doc, diagramId: string, layerId: string, layer: OverlayLayerRecord | null): void {
  const handle = layer ? requireWritableScene(doc, diagramId) : getOverlayScene(doc, diagramId);
  if (!handle?.writable) return;
  const layers = handle.layers ?? (layer ? ensureWritableLayers(handle) : null);
  if (!layers) return;
  if (!layer) {
    layers.delete(layerId);
    return;
  }
  let target = layers.get(layerId);
  if (!(target instanceof Y.Map)) {
    target = new Y.Map<unknown>();
    layers.set(layerId, target);
  }
  for (const key of Array.from(target.keys())) target.delete(key);
  for (const [key, value] of Object.entries(structuredClone(layer))) target.set(key, value);
}

function validObjectRecord(object: OverlayObjectRecord): boolean {
  return Boolean(object.id && object.kind && Number.isInteger(object.version) && object.version >= 1
    && object.order_key && validGeometry(object.geometry, object.kind) && validMetadata(object.style)
    && validMetadata(object.metadata) && cloneJsonRecord(object.payload) !== null
    && (object.layer === undefined || typeof object.layer === 'string')
    && (object.body === undefined || (typeof object.body === 'string' && byteLength(object.body) <= MAX_OVERLAY_TEXT_BYTES))
    && (object.anchor === undefined || (object.anchor.mermaid_id
      && validPoint(object.anchor.offset) && validPoint(object.anchor.fallback))));
}

function requireWritableScene(doc: Y.Doc, diagramId: string): OverlaySceneHandle {
  const handle = getOverlayScene(doc, diagramId, true);
  if (!handle?.writable) throw new Error('This overlay scene uses a newer schema and is read-only in this client.');
  return handle;
}

export function getOverlayLayers(doc: Y.Doc, diagramId: string): OverlayLayerRecord[] {
  const handle = getOverlayScene(doc, diagramId);
  return handle ? readLayers(handle) : [defaultOverlayLayer()];
}

function ensureWritableLayers(handle: OverlaySceneHandle): Y.Map<Y.Map<unknown>> {
  if (handle.layers) return handle.layers;
  const layers = new Y.Map<Y.Map<unknown>>();
  layers.set(DEFAULT_LAYER_ID, layerMap(defaultOverlayLayer()));
  handle.scene.set('layers', layers);
  handle.layers = layers;
  return layers;
}

export function addOverlayLayer(doc: Y.Doc, diagramId: string, layer: OverlayLayerRecord): void {
  const handle = requireWritableScene(doc, diagramId);
  if (!validLayer(layer)) throw new Error('Invalid or duplicate overlay layer.');
  doc.transact(() => {
    const layers = ensureWritableLayers(handle);
    if (layers.size >= MAX_OVERLAY_LAYERS || layers.has(layer.id)) throw new Error('Invalid or duplicate overlay layer.');
    layers.set(layer.id, layerMap(structuredClone(layer)));
  }, overlayOrigins.localHuman);
}

export function updateOverlayLayer(doc: Y.Doc, diagramId: string, layerId: string, patch: Partial<Omit<OverlayLayerRecord, 'id'>>): void {
  const handle = requireWritableScene(doc, diagramId);
  const current = readLayers(handle).find(({ id }) => id === layerId);
  if (!current) throw new Error('Overlay layer not found.');
  const next = { ...current, ...structuredClone(patch), id: layerId };
  if (!validLayer(next)) throw new Error('Invalid overlay layer update.');
  doc.transact(() => {
    const layers = ensureWritableLayers(handle);
    let target = layers.get(layerId);
    if (!target) {
      target = layerMap(next);
      layers.set(layerId, target);
    }
    for (const [key, value] of Object.entries(next)) target.set(key, value);
  }, overlayOrigins.localHuman);
}

export function createOverlayUndoManager(doc: Y.Doc, diagramId: string): Y.UndoManager {
  const handle = requireWritableScene(doc, diagramId);
  // Legacy v1 scenes gain their default layer before the manager attaches;
  // subsequent create/edit/reorder mutations share the same peer-local stack
  // as overlay objects.
  if (!handle.layers) doc.transact(() => { ensureWritableLayers(handle); });
  return new Y.UndoManager([handle.objects, handle.layers!], { trackedOrigins: new Set([overlayOrigins.localHuman]) });
}

export function addOverlayObject(doc: Y.Doc, diagramId: string, object: OverlayObjectRecord): void {
  const handle = requireWritableScene(doc, diagramId);
  if (handle.objects.has(object.id)) throw new Error(`Overlay object already exists: ${object.id}`);
  if (!validObjectRecord(object) || !isSupportedOverlayObject(object)) throw new Error('Invalid or unsupported overlay object.');
  doc.transact(() => {
    const value = new Y.Map<unknown>();
    writeObject(value, object);
    handle.objects.set(object.id, value);
    const body = value.get('body');
    if (body instanceof Y.Text && object.body) body.insert(0, object.body);
  }, overlayOrigins.localHuman);
}

export function updateOverlayObject(doc: Y.Doc, diagramId: string, objectId: string, patch: Partial<Omit<OverlayObjectRecord, 'id'>>): void {
  const handle = requireWritableScene(doc, diagramId);
  const current = readOverlayObject(objectId, handle.objects.get(objectId));
  if (!current || !isSupportedOverlayObject(current)) throw new Error(`Overlay object not found or unsupported: ${objectId}`);
  const next = { ...current, ...structuredClone(patch), id: objectId };
  if (!validObjectRecord(next)) throw new Error('Invalid overlay object update.');
  doc.transact(() => writeObject(handle.objects.get(objectId)!, next), overlayOrigins.localHuman);
}

/** A frame lock applies transitively through frame membership, including cyclic input. */
export function hasLockedFrameAncestor(scene: OverlaySceneSnapshot, objectId: string, ignoredFrameId?: string): boolean {
  const visit = (memberId: string, visited: Set<string>): boolean => scene.objects.some((frame) => {
    if (frame.id === ignoredFrameId || frame.kind !== 'frame.section' || !Array.isArray(frame.payload.members) || !frame.payload.members.includes(memberId)) return false;
    if (frame.metadata.locked === true) return true;
    if (visited.has(frame.id)) return false;
    const nextVisited = new Set(visited); nextVisited.add(frame.id);
    return visit(frame.id, nextVisited);
  });
  return visit(objectId, new Set([objectId]));
}

export function isOverlayObjectLocked(scene: OverlaySceneSnapshot, object: OverlayObjectRecord): boolean {
  return object.metadata.locked === true
    || scene.layers?.find(({ id }) => id === (object.layer ?? DEFAULT_LAYER_ID))?.locked === true
    || hasLockedFrameAncestor(scene, object.id, object.id);
}

/**
 * A transform is all-or-nothing: moving a frame never silently moves a locked
 * child. Nested frames are expanded deterministically, and every selected or
 * inherited member must be editable before the one Yjs transaction begins.
 */
export function getOverlayTransformTargets(scene: OverlaySceneSnapshot, objectIds: Iterable<string>): string[] | null {
  const byId = new Map(scene.objects.map((object) => [object.id, object]));
  const targets = new Set<string>();
  const visit = (id: string) => {
    if (targets.has(id)) return;
    const object = byId.get(id); if (!object) return;
    targets.add(id);
    if (object.kind === 'frame.section' && Array.isArray(object.payload.members)) {
      for (const member of object.payload.members) if (typeof member === 'string') visit(member);
    }
  };
  for (const id of objectIds) visit(id);
  for (const id of targets) {
    const object = byId.get(id)!;
    if (isOverlayObjectLocked(scene, object)) return null;
  }
  return [...targets].sort();
}

/** Moves a selection and contained frame members in one local-human transaction. */
export function moveOverlayObjects(doc: Y.Doc, diagramId: string, objectIds: Iterable<string>, dx: number, dy: number): void {
  if (!finite(dx) || !finite(dy)) throw new Error('Invalid overlay movement.');
  const handle = requireWritableScene(doc, diagramId);
  const ids = getOverlayTransformTargets(readOverlayScene(doc, diagramId), objectIds);
  if (!ids) return;
  doc.transact(() => {
    for (const id of ids) {
      const current = readOverlayObject(id, handle.objects.get(id));
      if (!current || !isSupportedOverlayObject(current)) continue;
      const next: OverlayObjectRecord = { ...current, geometry: { ...current.geometry, x: current.geometry.x + dx, y: current.geometry.y + dy } };
      if (current.anchor) next.anchor = { ...current.anchor, offset: { x: current.anchor.offset.x + dx, y: current.anchor.offset.y + dy }, fallback: { x: current.anchor.fallback.x + dx, y: current.anchor.fallback.y + dy } };
      if (current.kind === 'ink.stroke' && Array.isArray(current.payload.points)) {
        next.payload = { ...current.payload, points: current.payload.points.map((point) => ({ ...(point as Record<string, unknown>), x: Number((point as { x: number }).x) + dx, y: Number((point as { y: number }).y) + dy })) };
      }
      writeObject(handle.objects.get(id)!, next);
    }
  }, overlayOrigins.localHuman);
}

/**
 * Commits one direct-manipulation geometry at most once. A pointer draft is
 * based on the geometry it began with; if a peer changed that object before
 * pointer-up, this is deliberately a no-write rather than a last-writer-wins
 * overwrite. Frame selection policy is evaluated before the transaction so a
 * transform never bypasses a locked descendant or ancestor.
 */
export function transformOverlayObject(
  doc: Y.Doc,
  diagramId: string,
  objectId: string,
  expectedGeometry: OverlayGeometry,
  geometry: OverlayGeometry,
): OverlayTransformCommitResult {
  // Pointer-derived previews are not trusted: reject an invalid pointer-up as
  // a no-write result instead of turning a transient UI calculation into a
  // thrown event-handler failure.
  // Pointer-up on a scene removed by a collaborator is a harmless no-write;
  // direct manipulation must never recreate that deleted scene.
  const handle = getOverlayScene(doc, diagramId);
  if (!handle?.writable) return 'missing';
  const scene = readOverlayScene(doc, diagramId);
  const object = scene.objects.find((item) => item.id === objectId);
  if (!object) return 'missing';
  if (!validGeometry(expectedGeometry, object.kind) || !validGeometry(geometry, object.kind)) return 'invalid';
  if (!overlayGeometryEqual(object.geometry, expectedGeometry)) return 'stale';
  if (!getOverlayTransformTargets(scene, [objectId])) return 'locked';
  const needsDiamondMigration = isLegacyDiamondRotation(object);
  if (overlayGeometryEqual(object.geometry, geometry) && !needsDiamondMigration) return 'applied';
  let result: OverlayTransformCommitResult = 'applied';
  doc.transact(() => {
    const current = readOverlayObject(objectId, handle.objects.get(objectId));
    // A synchronous Yjs transaction is atomic locally, but retain this check
    // at the write boundary so replacing a scene/map cannot create an unsafe
    // last-writer-wins geometry update.
    if (!current) { result = 'missing'; return; }
    if (!overlayGeometryEqual(current.geometry, expectedGeometry)) { result = 'stale'; return; }
    const latestScene = readOverlayScene(doc, diagramId);
    if (!getOverlayTransformTargets(latestScene, [objectId])) { result = 'locked'; return; }
    const next: OverlayObjectRecord = {
      ...current,
      geometry: structuredClone(geometry),
      ...(isLegacyDiamondRotation(current) ? { payload: { ...current.payload, rotation_model: DIAMOND_ABSOLUTE_ROTATION_MODEL } } : {}),
    };
    if (current.anchor) {
      const dx = geometry.x - current.geometry.x; const dy = geometry.y - current.geometry.y;
      next.anchor = {
        ...current.anchor,
        offset: { x: current.anchor.offset.x + dx, y: current.anchor.offset.y + dy },
        fallback: { x: current.anchor.fallback.x + dx, y: current.anchor.fallback.y + dy },
      };
    }
    writeObject(handle.objects.get(objectId)!, next);
  }, overlayOrigins.localHuman);
  return result;
}

function consumeTextOperation(doc: Y.Doc): void {
  const now = Date.now();
  let window = textOperationWindows.get(doc);
  if (!window || now - window.startedAt >= TEXT_OPERATION_WINDOW_MS) {
    window = { startedAt: now, count: 0 };
    textOperationWindows.set(doc, window);
  }
  if (window.count >= TEXT_OPERATIONS_PER_WINDOW) throw new Error('Annotation editing is temporarily rate limited.');
  window.count += 1;
}

/** Applies a bounded incremental human edit; composition drafts stay in the component until committed. */
export function editOverlayText(doc: Y.Doc, diagramId: string, objectId: string, index: number, deleteCount: number, insert: string): void {
  const handle = requireWritableScene(doc, diagramId);
  const value = handle.objects.get(objectId);
  const current = readOverlayObject(objectId, value);
  const body = value?.get('body');
  if (!current || !(current.kind.startsWith('annotation.') || current.kind.startsWith('shape.')) || !(body instanceof Y.Text)) throw new Error('Overlay text object not found.');
  if (![index, deleteCount].every(Number.isInteger) || index < 0 || deleteCount < 0 || index + deleteCount > body.length) throw new Error('Invalid annotation text edit.');
  if (byteLength(insert) > MAX_TEXT_INSERT_BYTES) throw new Error('Annotation text operation is too large.');
  if (deleteCount === 0 && insert.length === 0) return;
  const next = body.toString().slice(0, index) + insert + body.toString().slice(index + deleteCount);
  if (byteLength(next) > MAX_OVERLAY_TEXT_BYTES) throw new Error('Annotation text is too long.');
  consumeTextOperation(doc);
  doc.transact(() => {
    if (deleteCount) body.delete(index, deleteCount);
    if (insert) body.insert(index, insert);
  }, overlayOrigins.localHuman);
}

export function beginOverlayTextComposition(doc: Y.Doc, diagramId: string, objectId: string): OverlayTextComposition {
  const value = requireWritableScene(doc, diagramId).objects.get(objectId);
  const body = value?.get('body');
  if (!(body instanceof Y.Text)) throw new Error('Overlay text object not found.');
  return { base: body.toString(), positions: Array.from({ length: body.length + 1 }, (_, index) => Y.createRelativePositionFromTypeIndex(body, index, -1)) };
}

export function commitOverlayTextComposition(doc: Y.Doc, diagramId: string, objectId: string, composition: OverlayTextComposition, draft: string): void {
  const change = textChange(composition.base, draft);
  if (!change.deleteCount && !change.insert) return;
  const value = requireWritableScene(doc, diagramId).objects.get(objectId);
  const body = value?.get('body');
  if (!(body instanceof Y.Text)) throw new Error('Overlay text object not found.');
  const start = Y.createAbsolutePositionFromRelativePosition(composition.positions[change.index]!, doc);
  const end = Y.createAbsolutePositionFromRelativePosition(composition.positions[change.index + change.deleteCount]!, doc);
  if (!start || !end || start.type !== body || end.type !== body) throw new Error('Annotation changed before composition could be committed.');
  const originalDeleted = composition.base.slice(change.index, change.index + change.deleteCount);
  const currentDeleted = body.toString().slice(start.index, end.index);
  const safeDelete = currentDeleted === originalDeleted ? end.index - start.index : 0;
  editOverlayText(doc, diagramId, objectId, start.index, safeDelete, change.insert);
}

function textChange(previous: string, next: string): { index: number; deleteCount: number; insert: string } {
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < previous.length - prefix && suffix < next.length - prefix
    && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1;
  return { index: prefix, deleteCount: previous.length - prefix - suffix, insert: next.slice(prefix, next.length - suffix) };
}

export function deleteOverlayObjects(doc: Y.Doc, diagramId: string, objectIds: Iterable<string>): void {
  const handle = requireWritableScene(doc, diagramId);
  const supportedIds = [...objectIds].filter((id) => {
    const object = readOverlayObject(id, handle.objects.get(id));
    return object !== null && isSupportedOverlayObject(object);
  });
  doc.transact(() => { for (const id of supportedIds) handle.objects.delete(id); }, overlayOrigins.localHuman);
}

export function setOverlayOrderKey(doc: Y.Doc, diagramId: string, objectId: string, orderKey: string): void {
  if (!orderKey) throw new Error('Overlay order key must not be empty.');
  updateOverlayObject(doc, diagramId, objectId, { order_key: orderKey });
}

function orderKeyBetween(lower: string | null, upper: string | null): string {
  if (lower === null && upper === null) return 'o';
  if (lower === null) {
    const first = upper!.charCodeAt(0);
    return first > 1 ? String.fromCharCode(Math.floor(first / 2)) : `\u0001${upper}`;
  }
  if (upper === null) return `${lower}~`;
  let prefix = '';
  for (let index = 0; index <= Math.max(lower.length, upper.length); index += 1) {
    const lowerCode = index < lower.length ? lower.charCodeAt(index) : 1;
    const upperCode = index < upper.length ? upper.charCodeAt(index) : 126;
    if (lowerCode === upperCode) {
      prefix += String.fromCharCode(lowerCode);
      continue;
    }
    if (upperCode - lowerCode > 1) return `${prefix}${String.fromCharCode(Math.floor((lowerCode + upperCode) / 2))}`;
    prefix += String.fromCharCode(lowerCode);
  }
  return `${lower}~`;
}

/** Rewrites only supported object ordering in one Yjs transaction so adjacent
 * moves converge deterministically even when peers apply them in different turns. */
export function reorderOverlayObject(doc: Y.Doc, diagramId: string, objectId: string, direction: 'front' | 'back' | 'forward' | 'backward'): void {
  const handle = requireWritableScene(doc, diagramId);
  const scene = readOverlayScene(doc, diagramId);
  const target = scene.objects.find(({ id }) => id === objectId);
  if (!target) return;
  const targetLayer = target.layer ?? DEFAULT_LAYER_ID;
  const ordered = sortForLayers(scene.objects.filter((object) => (object.layer ?? DEFAULT_LAYER_ID) === targetLayer), scene.layers ?? [defaultOverlayLayer()]);
  const from = ordered.findIndex(({ id }) => id === objectId);
  if (from < 0) return;
  const to = direction === 'front' ? ordered.length - 1 : direction === 'back' ? 0 : direction === 'forward' ? Math.min(ordered.length - 1, from + 1) : Math.max(0, from - 1);
  if (to === from) return;
  const [item] = ordered.splice(from, 1);
  if (!item) return;
  ordered.splice(to, 0, item);
  const lower = ordered[to - 1]?.order_key ?? null;
  const upper = ordered[to + 1]?.order_key ?? null;
  doc.transact(() => {
    const map = handle.objects.get(objectId);
    if (map instanceof Y.Map) map.set('order_key', orderKeyBetween(lower, upper));
  }, overlayOrigins.localHuman);
}

export function copyOverlayObjects(scene: OverlaySceneSnapshot, objectIds: Iterable<string>): OverlayObjectRecord[] {
  const selected = new Set(objectIds);
  return scene.objects.filter((object) => selected.has(object.id)).map((object) => structuredClone(object));
}

/** The explicit, deterministic policy for a future composite renderer/exporter. */
export function getCompositeExportObjects(scene: OverlaySceneSnapshot): OverlayObjectRecord[] {
  const layers = new Map((scene.layers ?? [defaultOverlayLayer()]).map((layer) => [layer.id, layer]));
  const frames = scene.objects.filter((object) => object.kind === 'frame.section');
  const frameAllowsMember = (memberId: string, visited = new Set<string>()): boolean => frames.every((frame) => {
    if (!Array.isArray(frame.payload.members) || !frame.payload.members.includes(memberId)) return true;
    if (visited.has(frame.id)) return false;
    visited.add(frame.id);
    const frameLayer = layers.get(frame.layer ?? DEFAULT_LAYER_ID) ?? defaultOverlayLayer();
    return frameLayer.visible && frameLayer.export && frame.metadata.hidden !== true
      && frame.metadata.export !== 'arielcharts-only' && frame.payload.composite_members !== false
      && frameAllowsMember(frame.id, visited);
  });
  return sortForLayers(scene.objects, scene.layers ?? [defaultOverlayLayer()]).filter((object) => {
    const layer = layers.get(object.layer ?? DEFAULT_LAYER_ID) ?? defaultOverlayLayer();
    return layer.visible && layer.export && object.metadata.export === 'composite-export' && frameAllowsMember(object.id);
  });
}

export function pasteOverlayObjects(doc: Y.Doc, diagramId: string, objects: readonly OverlayObjectRecord[], idFactory: () => string): string[] {
  const ids: string[] = [];
  for (const [index, object] of objects.entries()) {
    const id = idFactory();
    addOverlayObject(doc, diagramId, {
      ...structuredClone(object),
      id,
      order_key: `${object.order_key}~paste-${index.toString().padStart(4, '0')}-${id}`,
      geometry: { ...object.geometry, x: object.geometry.x + 16, y: object.geometry.y + 16 },
      ...(object.kind === 'frame.section' ? { payload: { ...object.payload, members: [] } } : {}),
    });
    ids.push(id);
  }
  return ids;
}

export function createOverlayLocalState(): OverlayLocalState {
  return { selectedIds: new Set(), draft: null, tool: 'select' };
}

export interface OverlayViewportTransform { x: number; y: number; zoom: number }
export interface OverlayRenderObject extends OverlayObjectRecord { screen_geometry: OverlayGeometry; orphaned: boolean }

/** One tested world-to-screen contract shared by SVG and React Flow families. */
export function adaptOverlaySceneToViewport(
  scene: OverlaySceneSnapshot,
  transform: OverlayViewportTransform,
  semanticAnchors: ReadonlyMap<string, OverlayWorldPoint>,
): OverlayRenderObject[] {
  if (![transform.x, transform.y, transform.zoom].every(finite) || transform.zoom <= 0) throw new Error('Invalid viewport transform.');
  const source = new Map(scene.objects.map((object) => [object.id, object]));
  return sortForLayers(scene.objects, scene.layers ?? [defaultOverlayLayer()]).map((object) => {
    const connector = object.kind === 'connector.overlay' ? object.payload : null;
    const start = connector && typeof connector.start_id === 'string' ? source.get(connector.start_id) : undefined;
    const end = connector && typeof connector.end_id === 'string' ? source.get(connector.end_id) : undefined;
    const startFallback = connector && validPoint(connector.start_fallback) ? connector.start_fallback : { x: object.geometry.x, y: object.geometry.y };
    const endFallback = connector && validPoint(connector.end_fallback) ? connector.end_fallback : { x: object.geometry.x + object.geometry.width, y: object.geometry.y + object.geometry.height };
    const connectorStart = start ? { x: start.geometry.x + start.geometry.width / 2, y: start.geometry.y + start.geometry.height / 2 } : startFallback;
    const connectorEnd = end ? { x: end.geometry.x + end.geometry.width / 2, y: end.geometry.y + end.geometry.height / 2 } : endFallback;
    const connectorGeometry = connector ? { ...object.geometry, x: connectorStart.x, y: connectorStart.y, width: connectorEnd.x - connectorStart.x, height: connectorEnd.y - connectorStart.y } : object.geometry;
    const semantic = object.anchor ? semanticAnchors.get(object.anchor.mermaid_id) : undefined;
    const origin = connector ? { x: connectorGeometry.x, y: connectorGeometry.y } : object.anchor
      ? semantic
        ? { x: semantic.x + object.anchor.offset.x, y: semantic.y + object.anchor.offset.y }
        : object.anchor.fallback
      : { x: object.geometry.x, y: object.geometry.y };
    return {
      ...object,
      orphaned: Boolean((object.anchor && !semantic) || (connector && (!start || !end))),
      screen_geometry: {
        ...connectorGeometry,
        x: origin.x * transform.zoom + transform.x,
        y: origin.y * transform.zoom + transform.y,
        width: connectorGeometry.width * transform.zoom,
        height: connectorGeometry.height * transform.zoom,
      },
    };
  });
}
