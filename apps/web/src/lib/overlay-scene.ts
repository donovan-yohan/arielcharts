import {
  OVERLAY_SCENE_SCHEMA_VERSION,
  type OverlayGeometry,
  type OverlayMetadata,
  type OverlayObjectRecord,
  type OverlaySceneSnapshot,
  type OverlayWorldPoint,
} from '@arielcharts/shared';
import * as Y from 'yjs';

export const overlayOrigins = {
  localHuman: Symbol('arielcharts.local-human.overlay'),
} as const;

export interface OverlaySceneHandle {
  scene: Y.Map<unknown>;
  objects: Y.Map<Y.Map<unknown>>;
  writable: boolean;
}

export interface OverlayLocalState {
  selectedIds: Set<string>;
  draft: unknown | null;
  tool: string;
}

const MAX_METADATA_ENTRIES = 32;
const MAX_METADATA_KEY_BYTES = 128;
const MAX_METADATA_STRING_BYTES = 2_048;

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

function validGeometry(value: unknown): value is OverlayGeometry {
  if (!validPoint(value)) return false;
  const geometry = value as Partial<OverlayGeometry>;
  return finite(geometry.width) && geometry.width >= 0
    && finite(geometry.height) && geometry.height >= 0
    && finite(geometry.rotation);
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

export function getOverlayScene(doc: Y.Doc, diagramId: string, create = false): OverlaySceneHandle | null {
  const root = doc.getMap<Y.Map<unknown>>('overlays');
  let scene = root.get(diagramId);
  if (!scene && create) {
    scene = new Y.Map<unknown>();
    scene.set('version', OVERLAY_SCENE_SCHEMA_VERSION);
    scene.set('objects', new Y.Map<Y.Map<unknown>>());
    root.set(diagramId, scene);
  }
  if (!(scene instanceof Y.Map)) return null;
  const version = scene.get('version');
  const objects = scene.get('objects');
  if (!Number.isInteger(version) || (version as number) < 1 || !(objects instanceof Y.Map)) return null;
  return { scene, objects: objects as Y.Map<Y.Map<unknown>>, writable: version === OVERLAY_SCENE_SCHEMA_VERSION };
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
  const layer = value.get('layer');
  const anchor = value.get('anchor');
  if (!id || typeof kind !== 'string' || !kind || !Number.isInteger(version) || (version as number) < 1
    || typeof orderKey !== 'string' || !orderKey || !validGeometry(geometry)
    || !validMetadata(style) || !validMetadata(metadata) || payload === null
    || (layer !== undefined && typeof layer !== 'string')) return null;
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
  };
}

export function isSupportedOverlayObject(object: OverlayObjectRecord): boolean {
  return object.kind === 'foundation.card' && object.version === 1;
}

export function readOverlayScene(doc: Y.Doc, diagramId: string): OverlaySceneSnapshot {
  const handle = getOverlayScene(doc, diagramId);
  if (!handle) return { version: OVERLAY_SCENE_SCHEMA_VERSION, diagram_id: diagramId, objects: [] };
  if (!handle.writable) return { version: handle.scene.get('version') as number, diagram_id: diagramId, objects: [] };
  const objects = [...handle.objects.entries()]
    .flatMap(([id, value]) => {
      const object = readOverlayObject(id, value);
      return object && isSupportedOverlayObject(object) ? [object] : [];
    })
    .sort((left, right) => left.order_key.localeCompare(right.order_key) || left.id.localeCompare(right.id));
  return { version: handle.scene.get('version') as number, diagram_id: diagramId, objects };
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
}

function validObjectRecord(object: OverlayObjectRecord): boolean {
  return Boolean(object.id && object.kind && Number.isInteger(object.version) && object.version >= 1
    && object.order_key && validGeometry(object.geometry) && validMetadata(object.style)
    && validMetadata(object.metadata) && cloneJsonRecord(object.payload) !== null
    && (object.layer === undefined || typeof object.layer === 'string')
    && (object.anchor === undefined || (object.anchor.mermaid_id
      && validPoint(object.anchor.offset) && validPoint(object.anchor.fallback))));
}

function requireWritableScene(doc: Y.Doc, diagramId: string): OverlaySceneHandle {
  const handle = getOverlayScene(doc, diagramId, true);
  if (!handle?.writable) throw new Error('This overlay scene uses a newer schema and is read-only in this client.');
  return handle;
}

export function createOverlayUndoManager(doc: Y.Doc, diagramId: string): Y.UndoManager {
  const { objects } = requireWritableScene(doc, diagramId);
  return new Y.UndoManager(objects, { trackedOrigins: new Set([overlayOrigins.localHuman]) });
}

export function addOverlayObject(doc: Y.Doc, diagramId: string, object: OverlayObjectRecord): void {
  const handle = requireWritableScene(doc, diagramId);
  if (handle.objects.has(object.id)) throw new Error(`Overlay object already exists: ${object.id}`);
  if (!validObjectRecord(object) || !isSupportedOverlayObject(object)) throw new Error('Invalid or unsupported overlay object.');
  doc.transact(() => {
    const value = new Y.Map<unknown>();
    writeObject(value, object);
    handle.objects.set(object.id, value);
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

export function copyOverlayObjects(scene: OverlaySceneSnapshot, objectIds: Iterable<string>): OverlayObjectRecord[] {
  const selected = new Set(objectIds);
  return scene.objects.filter((object) => selected.has(object.id)).map((object) => structuredClone(object));
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
  return scene.objects.map((object) => {
    const semantic = object.anchor ? semanticAnchors.get(object.anchor.mermaid_id) : undefined;
    const origin = object.anchor
      ? semantic
        ? { x: semantic.x + object.anchor.offset.x, y: semantic.y + object.anchor.offset.y }
        : object.anchor.fallback
      : { x: object.geometry.x, y: object.geometry.y };
    return {
      ...object,
      orphaned: Boolean(object.anchor && !semantic),
      screen_geometry: {
        ...object.geometry,
        x: origin.x * transform.zoom + transform.x,
        y: origin.y * transform.zoom + transform.y,
        width: object.geometry.width * transform.zoom,
        height: object.geometry.height * transform.zoom,
      },
    };
  });
}
