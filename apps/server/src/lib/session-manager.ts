import {
  resolveSourceLayoutPolicy,
  type ActivityEvent,
  type Diagram,
  type DiagramNodePositions,
  type DiagramRevision,
  type DiagramRevisionAction,
  type DiagramRevisionOrigin,
  type DiagramRevisionSummary,
  type DiagramSummary,
  OVERLAY_SCENE_SCHEMA_VERSION,
  type OverlayMetadata,
  type OverlayLayerRecord,
  type OverlayObjectRecord,
  type OverlayObjectMutationOutput,
  type OverlayObjectPatch,
  type OverlayRevision,
  type OverlayRevisionSummary,
  type OverlaySceneSnapshot,
  type McpOverlayScene,
  type McpOverlayObjectList,
  type McpOverlayObjectRead,
  type Participant,
  type RestoreOverlayRevisionResult,
  type RestoreDiagramRevisionResult,
  type SessionSummary,
  type SourceLayoutPolicy,
} from '@arielcharts/shared';
import { createHash } from 'node:crypto';
import * as encoding from 'lib0/encoding';
import { Awareness, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  ACTIVITY_KEY,
  DEFAULT_SESSION_TITLE,
  DIAGRAM_MERMAID_TEXT_KEY,
  DIAGRAM_NODE_POSITIONS_KEY,
  DIAGRAM_ORDER_KEY,
  DIAGRAM_NAME_KEY,
  DIAGRAMS_KEY,
  PRESENCE_KEY,
  OVERLAYS_KEY,
} from './constants.js';
import {
  COLLABORATION_BUDGETS,
  createReservedRootDocument,
  decodePersistedYjsState,
  repairOverlayDocument,
  validateDocumentState,
  validateReservedRootTypes,
} from './document-admission.js';
import { SessionStore } from './persistence.js';
import type { CleanupOptions, DiagramHistoryMetadata, HistoryPersistenceChange, OverlayHistoryMetadata, RoomAccessRecord, SessionRecord, SessionSnapshot, SessionState } from './types.js';
import { applyWorkspacePayload, canonicalWorkspaceJson, parseWorkspaceBundle, WorkspaceImportError } from './workspace-import.js';
import type { WorkspaceBundlePayload } from '@arielcharts/shared';

const MANAGED_AWARENESS_ORIGIN = 'session-manager';
const CATALOG_REPAIR_ORIGIN = 'catalog-repair';
const WORKSPACE_IMPORT_ORIGIN = 'workspace-import';
const DEFAULT_DIAGRAM_ID = 'main';
const DEFAULT_DIAGRAM_TITLE = 'Main';
const HISTORY_PROCESSED_ACTIVITY_LIMIT = 200;
const HISTORY_RETAINED_MUTATIONS = 99;
const SYSTEM_HISTORY_ACTOR = { name: 'System', type: 'agent' as const };
const ACTIVITY_ACTIONS = new Set<ActivityEvent['action']>(['joined', 'left', 'edited', 'replaced', 'created', 'renamed', 'deleted', 'restored']);
const SUPPORTED_OVERLAY_KINDS = new Set(['foundation.card', 'annotation.text', 'annotation.sticky', 'ink.stroke', 'shape.rectangle', 'shape.ellipse', 'shape.diamond', 'shape.line', 'shape.arrow', 'connector.overlay', 'frame.section']);
const TEXT_OVERLAY_KINDS = new Set(['annotation.text', 'annotation.sticky', 'shape.rectangle', 'shape.ellipse', 'shape.diamond', 'shape.line', 'shape.arrow']);
const OVERLAY_SCENE_KEYS = new Set(['version', 'objects', 'layers']);
const OVERLAY_LAYER_KEYS = new Set(['id', 'name', 'order_key', 'visible', 'locked', 'export']);
const OVERLAY_OBJECT_KEYS = new Set(['kind', 'version', 'order_key', 'geometry', 'anchor', 'layer', 'style', 'metadata', 'payload', 'body']);
// MCP responses are intentionally narrower than the collaborative Yjs envelope.
// Keep these limits local to the projection: browser peers may retain a valid
// v1 object that a conservative MCP client must treat as opaque.
const MCP_OVERLAY_PAYLOAD_DEPTH = 24;
const MCP_OVERLAY_PAYLOAD_VALUES = 8_192;
const MCP_OVERLAY_PAYLOAD_ARRAY_ITEMS = COLLABORATION_BUDGETS.strokePointsPerObject;
const MCP_OVERLAY_PAYLOAD_RECORD_KEYS = 32;
const MCP_OVERLAY_PAYLOAD_KEY_BYTES = 128;
const MCP_OVERLAY_PAYLOAD_STRING_BYTES = 8_192;
const MCP_OVERLAY_PAYLOAD_TOTAL_BYTES = COLLABORATION_BUDGETS.textBytesPerObject;

type DiagramMap = Y.Map<unknown>;

interface DiagramHistorySnapshot {
  id: string;
  name: string;
  mermaidText: string;
  nodePositions: DiagramNodePositions;
  revision: string;
}

interface HistorySnapshot {
  diagrams: DiagramHistorySnapshot[];
  overlayScenes: OverlaySceneSnapshot[];
  activity: ActivityEvent[];
}

interface OverlayRestoreContext {
  diagramId: string;
  revisionId: string;
  actor: ActivityEvent['actor'];
}

interface PersistedRevisions {
  diagramRevisions: DiagramRevision[];
  overlayRevisions: OverlayRevision[];
}

interface PersistenceOptions {
  recovery?: boolean;
  activityOrigins?: ReadonlyMap<string, DiagramRevisionOrigin>;
  initialRoomAccess?: RoomAccessRecord;
  overlayRestore?: OverlayRestoreContext;
}

interface PendingSessionPersistence {
  snapshot: HistorySnapshot;
  record: SessionRecord;
}

function diagramsMap(doc: Y.Doc): Y.Map<DiagramMap> {
  return doc.getMap<DiagramMap>(DIAGRAMS_KEY);
}

function diagramOrder(doc: Y.Doc): Y.Array<string> {
  return doc.getArray<string>(DIAGRAM_ORDER_KEY);
}

function getMermaidText(diagram: DiagramMap): Y.Text {
  const value = diagram.get(DIAGRAM_MERMAID_TEXT_KEY);
  if (!(value instanceof Y.Text)) {
    throw new Error('Diagram is missing its Mermaid text.');
  }
  return value;
}

function getNodePositions(diagram: DiagramMap): Y.Map<unknown> {
  const value = diagram.get(DIAGRAM_NODE_POSITIONS_KEY);
  if (!(value instanceof Y.Map)) {
    throw new Error('Diagram is missing its node positions.');
  }
  return value;
}

function readRevisionNodePositions(diagram: DiagramMap): DiagramNodePositions {
  const positions = Object.create(null) as DiagramNodePositions;
  for (const [id, value] of [...getNodePositions(diagram).entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!id || !value || typeof value !== 'object') continue;
    const position = value as Partial<{ x: unknown; y: unknown }>;
    if (typeof position.x === 'number' && Number.isFinite(position.x)
      && typeof position.y === 'number' && Number.isFinite(position.y)) {
      positions[id] = { x: position.x, y: position.y };
    }
  }
  return positions;
}

function overlaysMap(doc: Y.Doc): Y.Map<Y.Map<unknown>> {
  return doc.getMap<Y.Map<unknown>>(OVERLAYS_KEY);
}

function hasOnlyKeys(map: Y.Map<unknown>, keys: ReadonlySet<string>): boolean {
  return [...map.keys()].every((key) => keys.has(key));
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isMcpBoundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0
    && Buffer.byteLength(value, 'utf8') <= COLLABORATION_BUDGETS.identifierBytes;
}

function isMcpOverlayMetadata(value: unknown): value is OverlayMetadata {
  return isPlainRecord(value) && Object.keys(value).length <= MCP_OVERLAY_PAYLOAD_RECORD_KEYS
    && Object.entries(value).every(([key, entry]) => Buffer.byteLength(key, 'utf8') <= MCP_OVERLAY_PAYLOAD_KEY_BYTES
      && (entry === null || typeof entry === 'boolean' || (typeof entry === 'number' && Number.isFinite(entry))
        || (typeof entry === 'string' && Buffer.byteLength(entry, 'utf8') <= 2_048)));
}

/**
 * The MCP transport serializes JSON, so disclose only a bounded JSON payload.
 * This deliberately differs from browser/Yjs admission, which must preserve
 * opaque future values without requiring an old client to understand them.
 */
function isMcpOverlayPayload(value: unknown): value is Record<string, unknown> {
  if (!isPlainRecord(value)) return false;
  const counters = { values: 0, arrayItems: 0, bytes: 0 };
  const active = new Set<object>();
  const visit = (entry: unknown, depth: number): boolean => {
    if (depth > MCP_OVERLAY_PAYLOAD_DEPTH || ++counters.values > MCP_OVERLAY_PAYLOAD_VALUES) return false;
    if (entry === null || typeof entry === 'boolean') return true;
    if (typeof entry === 'number') return Number.isFinite(entry);
    if (typeof entry === 'string') {
      const bytes = Buffer.byteLength(entry, 'utf8');
      counters.bytes += bytes;
      return bytes <= MCP_OVERLAY_PAYLOAD_STRING_BYTES && counters.bytes <= MCP_OVERLAY_PAYLOAD_TOTAL_BYTES;
    }
    if (Array.isArray(entry)) {
      counters.arrayItems += entry.length;
      if (entry.length > MCP_OVERLAY_PAYLOAD_ARRAY_ITEMS || counters.arrayItems > MCP_OVERLAY_PAYLOAD_ARRAY_ITEMS) return false;
      return entry.every((child) => visit(child, depth + 1));
    }
    if (!isPlainRecord(entry) || active.has(entry)) return false;
    const entries = Object.entries(entry);
    if (entries.length > MCP_OVERLAY_PAYLOAD_RECORD_KEYS) return false;
    active.add(entry);
    const valid = entries.every(([key, child]) => {
      const keyBytes = Buffer.byteLength(key, 'utf8');
      counters.bytes += keyBytes;
      return keyBytes <= MCP_OVERLAY_PAYLOAD_KEY_BYTES && counters.bytes <= MCP_OVERLAY_PAYLOAD_TOTAL_BYTES && visit(child, depth + 1);
    });
    active.delete(entry);
    return valid;
  };
  return visit(value, 0);
}

/** Inspect plain payload data without calling user getters or Yjs serializers. */
function isMcpRawJsonValue(value: unknown, depth = 0, active = new Set<object>()): boolean {
  if (depth > MCP_OVERLAY_PAYLOAD_DEPTH) return false;
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return Buffer.byteLength(value, 'utf8') <= MCP_OVERLAY_PAYLOAD_STRING_BYTES;
  if (value instanceof Y.AbstractType || typeof value !== 'object' || value === undefined) return false;
  if (active.has(value)) return false;
  active.add(value);
  try {
    if (Array.isArray(value)) {
      if (value.length > MCP_OVERLAY_PAYLOAD_ARRAY_ITEMS) return false;
      const descriptors = Object.getOwnPropertyDescriptors(value);
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor || !('value' in descriptor) || !isMcpRawJsonValue(descriptor.value, depth + 1, active)) return false;
      }
      return true;
    }
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const entries = Object.entries(descriptors).filter(([, descriptor]) => descriptor.enumerable);
    if (entries.length > MCP_OVERLAY_PAYLOAD_RECORD_KEYS) return false;
    return entries.every(([key, descriptor]) => Buffer.byteLength(key, 'utf8') <= MCP_OVERLAY_PAYLOAD_KEY_BYTES
      && 'value' in descriptor && isMcpRawJsonValue(descriptor.value, depth + 1, active));
  } finally {
    active.delete(value);
  }
}

function isMcpRawOverlayObjectRepresentable(id: string, value: unknown): boolean {
  if (!(value instanceof Y.Map) || !isMcpBoundedIdentifier(id)) return false;
  const kind = value.get('kind'); const version = value.get('version'); const orderKey = value.get('order_key');
  const geometry = value.get('geometry'); const style = value.get('style'); const metadata = value.get('metadata'); const payload = value.get('payload');
  const anchor = value.get('anchor'); const layer = value.get('layer'); const body = value.get('body');
  return typeof kind === 'string' && SUPPORTED_OVERLAY_KINDS.has(kind) && version === 1 && isMcpBoundedIdentifier(kind)
    && isMcpBoundedIdentifier(orderKey) && isMcpRawJsonValue(geometry) && isMcpRawJsonValue(style)
    && isMcpRawJsonValue(metadata) && isMcpRawJsonValue(payload) && (anchor === undefined || isMcpRawJsonValue(anchor))
    && (layer === undefined || isMcpBoundedIdentifier(layer)) && (body === undefined || body instanceof Y.Text);
}

function isMcpOverlayObjectRepresentable(object: OverlayObjectRecord): boolean {
  const geometry = object.geometry;
  const validAnchor = object.anchor === undefined || (isMcpBoundedIdentifier(object.anchor.mermaid_id)
    && Number.isFinite(object.anchor.offset.x) && Number.isFinite(object.anchor.offset.y)
    && Number.isFinite(object.anchor.fallback.x) && Number.isFinite(object.anchor.fallback.y));
  return isMcpBoundedIdentifier(object.id) && isMcpBoundedIdentifier(object.kind)
    && Number.isInteger(object.version) && object.version > 0 && isMcpBoundedIdentifier(object.order_key)
    && Number.isFinite(geometry.x) && Number.isFinite(geometry.y) && Number.isFinite(geometry.width) && geometry.width >= 0
    && Number.isFinite(geometry.height) && geometry.height >= 0 && Number.isFinite(geometry.rotation)
    && validAnchor && (object.layer === undefined || isMcpBoundedIdentifier(object.layer))
    && isMcpOverlayMetadata(object.style) && isMcpOverlayMetadata(object.metadata)
    && isMcpOverlayPayload(object.payload)
    && (object.body === undefined || (typeof object.body === 'string' && Buffer.byteLength(object.body, 'utf8') <= 8_192));
}

function opaqueMcpObject(id: string, value: unknown, occupiedIds: Set<string>): import('@arielcharts/shared').OpaqueOverlayObject {
  const raw = value instanceof Y.Map ? value : undefined;
  const rawKind = raw?.get('kind'); const rawVersion = raw?.get('version');
  let handle = `opaque-${createHash('sha256').update(id).digest('base64url').slice(0, 24)}`;
  for (let attempt = 1; occupiedIds.has(handle); attempt += 1) {
    handle = `opaque-${createHash('sha256').update(`${id}:${attempt}`).digest('base64url').slice(0, 24)}`;
  }
  occupiedIds.add(handle);
  return {
    id: isMcpBoundedIdentifier(id) ? id : handle,
    kind: isMcpBoundedIdentifier(rawKind) ? rawKind : 'opaque',
    version: typeof rawVersion === 'number' && Number.isInteger(rawVersion) ? rawVersion : 0,
  };
}

function overlayRevisionValue(value: unknown, depth = 0): unknown {
  if (depth > 32) return { type: 'depth-limit' };
  if (value instanceof Y.Text) return { type: 'y-text', text: value.toString() };
  if (value instanceof Y.Map) return { type: 'y-map', entries: [...value.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([key, entry]) => [key, overlayRevisionValue(entry, depth + 1)]) };
  if (value instanceof Y.Array) return { type: 'y-array', entries: value.toArray().map((entry) => overlayRevisionValue(entry, depth + 1)) };
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : { type: 'non-finite' };
  if (Array.isArray(value)) return value.map((entry) => overlayRevisionValue(entry, depth + 1));
  if (isPlainRecord(value)) return Object.fromEntries(Object.keys(value).sort().map((key) => [key, overlayRevisionValue(value[key], depth + 1)]));
  return { type: 'unsupported', value: Object.prototype.toString.call(value) };
}

/** Include every raw overlay cell so opaque future data never shares a workspace revision. */
function rawOverlayRevisionValue(doc: Y.Doc): unknown {
  return [...overlaysMap(doc).entries()].sort(([left], [right]) => left.localeCompare(right))
    .map(([id, scene]) => [id, overlayRevisionValue(scene)]);
}

/**
 * MCP revisions use the complete raw scene cell, rather than the v1 reader's
 * projection. That makes an opaque object or a newer scene a real concurrent
 * write, even though an older MCP client cannot edit its fields.
 */
function mcpOverlayRevisionForScene(doc: Y.Doc, diagramId: string): string {
  const rawScene = overlaysMap(doc).get(diagramId);
  const canonical = new Y.Doc({ guid: 'arielcharts:mcp-overlay-revision:v1' });
  try {
    // clone() preserves every nested Y shared type. With a fixed client id,
    // Yjs emits deterministic raw scene bytes without including Mermaid,
    // presence, awareness, or another diagram's overlay state.
    canonical.clientID = 1;
    canonical.getMap<unknown>('overlay').set('scene', rawScene instanceof Y.AbstractType ? rawScene.clone() : rawScene ?? null);
    return createHash('sha256')
      .update(diagramId)
      .update(Y.encodeStateAsUpdate(canonical))
      .digest('base64url');
  } finally {
    canonical.destroy();
  }
}

/**
 * Imports replace overlay roots. Refuse rather than erase data that the v1
 * writer cannot reproduce exactly, including future scene/object/layer forms.
 */
function assertOverlayRootsLosslesslyReplaceable(doc: Y.Doc): void {
  for (const [diagramId, scene] of overlaysMap(doc).entries()) {
    if (!(scene instanceof Y.Map) || !hasOnlyKeys(scene, OVERLAY_SCENE_KEYS) || scene.get('version') !== OVERLAY_SCENE_SCHEMA_VERSION) {
      throw new WorkspaceImportError(`Workspace import cannot replace unsupported overlay scene ${diagramId}.`);
    }
    const objects = scene.get('objects'); const layers = scene.get('layers');
    if (!(objects instanceof Y.Map) || !(layers instanceof Y.Map) || layers.size === 0) {
      throw new WorkspaceImportError(`Workspace import cannot replace opaque overlay schema ${diagramId}.`);
    }
    const layerIds = new Set<string>();
    for (const [layerId, layer] of layers.entries()) {
      if (!(layer instanceof Y.Map) || !hasOnlyKeys(layer, OVERLAY_LAYER_KEYS) || layer.get('id') !== layerId
        || typeof layer.get('name') !== 'string' || typeof layer.get('order_key') !== 'string'
        || typeof layer.get('visible') !== 'boolean' || typeof layer.get('locked') !== 'boolean' || typeof layer.get('export') !== 'boolean') {
        throw new WorkspaceImportError(`Workspace import cannot replace unsupported overlay layer ${diagramId}.`);
      }
      layerIds.add(layerId);
    }
    for (const [objectId, object] of objects.entries()) {
      if (!(object instanceof Y.Map) || !hasOnlyKeys(object, OVERLAY_OBJECT_KEYS)) {
        throw new WorkspaceImportError(`Workspace import cannot replace opaque overlay object ${diagramId}.`);
      }
      const kind = object.get('kind'); const version = object.get('version'); const layer = object.get('layer'); const body = object.get('body');
      if (typeof objectId !== 'string' || !objectId || typeof kind !== 'string' || !SUPPORTED_OVERLAY_KINDS.has(kind) || version !== 1
        || typeof object.get('order_key') !== 'string' || !isPlainRecord(object.get('geometry')) || !isPlainRecord(object.get('style'))
        || !isPlainRecord(object.get('metadata')) || !isPlainRecord(object.get('payload'))
        || (layer !== undefined && (typeof layer !== 'string' || !layerIds.has(layer)))
        || (object.get('anchor') !== undefined && !isPlainRecord(object.get('anchor')))
        || (TEXT_OVERLAY_KINDS.has(kind) ? !(body instanceof Y.Text) : body !== undefined)) {
        throw new WorkspaceImportError(`Workspace import cannot replace unsupported overlay object ${diagramId}.`);
      }
    }
  }
}

function createEmptyOverlayScene(): Y.Map<unknown> {
  const scene = new Y.Map<unknown>();
  scene.set('version', OVERLAY_SCENE_SCHEMA_VERSION);
  scene.set('objects', new Y.Map<Y.Map<unknown>>());
  const layers = new Y.Map<Y.Map<unknown>>();
  const layer = new Y.Map<unknown>();
  layer.set('id', 'default'); layer.set('name', 'Default'); layer.set('order_key', '0000000000000000'); layer.set('visible', true); layer.set('locked', false); layer.set('export', true);
  layers.set('default', layer); scene.set('layers', layers);
  return scene;
}

function readOverlayLayers(scene: Y.Map<unknown>): OverlayLayerRecord[] {
  const raw = scene.get('layers');
  if (!(raw instanceof Y.Map)) return [{ id: 'default', name: 'Default', order_key: '0000000000000000', visible: true, locked: false, export: true }];
  const layers = [...raw.entries()].flatMap(([id, value]) => {
    if (!(value instanceof Y.Map)) return [];
    const candidate = Object.fromEntries(value.entries()) as Partial<OverlayLayerRecord>;
    return candidate.id === id && typeof candidate.name === 'string' && typeof candidate.order_key === 'string'
      && typeof candidate.visible === 'boolean' && typeof candidate.locked === 'boolean' && typeof candidate.export === 'boolean'
      ? [candidate as OverlayLayerRecord] : [];
  }).sort((left, right) => left.order_key.localeCompare(right.order_key) || left.id.localeCompare(right.id));
  return layers.length ? layers : [{ id: 'default', name: 'Default', order_key: '0000000000000000', visible: true, locked: false, export: true }];
}

function readOverlayScene(doc: Y.Doc, diagramId: string): OverlaySceneSnapshot {
  const scene = overlaysMap(doc).get(diagramId);
  if (!(scene instanceof Y.Map)) return { version: OVERLAY_SCENE_SCHEMA_VERSION, diagram_id: diagramId, objects: [] };
  const version = scene.get('version');
  const objects = scene.get('objects');
  const result: OverlayObjectRecord[] = [];
  if (version !== OVERLAY_SCENE_SCHEMA_VERSION) {
    return { version: typeof version === 'number' ? version : 0, diagram_id: diagramId, objects: [] };
  }
  if (objects instanceof Y.Map) {
    for (const [id, value] of objects.entries()) {
      if (!(value instanceof Y.Map)) continue;
      const kind = value.get('kind');
      const objectVersion = value.get('version');
      const orderKey = value.get('order_key');
      const geometry = value.get('geometry');
      const style = value.get('style');
      const metadata = value.get('metadata');
      const payload = value.get('payload');
      const anchor = value.get('anchor');
      const layer = value.get('layer');
      const body = value.get('body');
      if (typeof kind !== 'string' || typeof objectVersion !== 'number' || typeof orderKey !== 'string'
        || !geometry || typeof geometry !== 'object' || !style || typeof style !== 'object'
        || !metadata || typeof metadata !== 'object' || !payload || typeof payload !== 'object') continue;
      result.push({
        id,
        kind,
        version: objectVersion,
        order_key: orderKey,
        geometry: structuredClone(geometry) as OverlayObjectRecord['geometry'],
        ...(anchor === undefined ? {} : { anchor: structuredClone(anchor) as OverlayObjectRecord['anchor'] }),
        ...(typeof layer === 'string' ? { layer } : {}),
        style: structuredClone(style) as OverlayMetadata,
        metadata: structuredClone(metadata) as OverlayMetadata,
        payload: structuredClone(payload) as Record<string, unknown>,
        ...(body instanceof Y.Text ? { body: body.toString() } : {}),
      });
    }
  }
  const layers = readOverlayLayers(scene);
  const layerOrder = new Map(layers.map((layer, index) => [layer.id, index]));
  result.sort((left, right) => (layerOrder.get(left.layer ?? 'default') ?? 0) - (layerOrder.get(right.layer ?? 'default') ?? 0)
    || left.order_key.localeCompare(right.order_key) || left.id.localeCompare(right.id));
  return { version: typeof version === 'number' ? version : OVERLAY_SCENE_SCHEMA_VERSION, diagram_id: diagramId, objects: result, layers };
}

function readMcpOverlayScene(doc: Y.Doc, diagramId: string): McpOverlayScene {
  const raw = overlaysMap(doc).get(diagramId);
  const rawScene = raw instanceof Y.Map ? raw : null;
  const rawVersion = rawScene?.get('version');
  const version = typeof rawVersion === 'number' ? rawVersion : 0;
  const overlayRevision = mcpOverlayRevisionForScene(doc, diagramId);
  if (version !== OVERLAY_SCENE_SCHEMA_VERSION) {
    const rawObjects = rawScene?.get('objects');
    return {
      version,
      diagram_id: diagramId,
      overlay_revision: overlayRevision,
      writable: false,
      objects: [],
      opaque_objects: rawObjects instanceof Y.Map ? (() => {
        const occupied = new Set([...rawObjects.keys()].filter(isMcpBoundedIdentifier));
        return [...rawObjects.entries()].sort(([left], [right]) => left.localeCompare(right))
          .map(([id, value]) => opaqueMcpObject(id, value, occupied));
      })() : [],
    };
  }

  const rawObjects = rawScene?.get('objects');
  const rawSafeIds = rawObjects instanceof Y.Map
    ? new Set([...rawObjects.entries()].flatMap(([id, value]) => isMcpRawOverlayObjectRepresentable(id, value) ? [id] : []))
    : new Set<string>();
  // Never call readOverlayScene (which clones browser data) until the raw
  // projection has proven every candidate free of nested shared/opaque values.
  if (rawObjects instanceof Y.Map && rawSafeIds.size !== rawObjects.size) {
    const occupied = new Set([...rawObjects.keys()].filter(isMcpBoundedIdentifier));
    return {
      version,
      diagram_id: diagramId,
      overlay_revision: overlayRevision,
      writable: false,
      objects: [],
      opaque_objects: [...rawObjects.entries()].sort(([left], [right]) => left.localeCompare(right))
        .map(([id, value]) => opaqueMcpObject(id, value, occupied)),
      layers: undefined,
    };
  }
  const scene = readOverlayScene(doc, diagramId);
  const supported = scene.objects.filter((object) => rawSafeIds.has(object.id) && isMcpOverlayObjectRepresentable(object));
  const knownIds = new Set(supported.map(({ id }) => id));
  const opaqueObjects = rawObjects instanceof Y.Map
    ? (() => {
      const occupied = new Set([...rawObjects.keys()].filter(isMcpBoundedIdentifier));
      return [...rawObjects.entries()].sort(([left], [right]) => left.localeCompare(right))
        .flatMap(([id, value]) => knownIds.has(id) ? [] : [opaqueMcpObject(id, value, occupied)]);
    })()
    : [];
  return {
    version,
    diagram_id: diagramId,
    overlay_revision: overlayRevision,
    writable: opaqueObjects.length === 0,
    objects: supported,
    opaque_objects: opaqueObjects,
    layers: scene.layers,
  };
}

function listMcpOverlayObjects(doc: Y.Doc, diagramId: string): McpOverlayObjectList {
  const scene = readMcpOverlayScene(doc, diagramId);
  return {
    version: scene.version,
    diagram_id: scene.diagram_id,
    overlay_revision: scene.overlay_revision,
    writable: scene.writable,
    objects: [
      ...scene.objects.map((object) => ({ id: object.id, kind: object.kind, version: object.version, opaque: false, order_key: object.order_key })),
      ...scene.opaque_objects.map((object) => ({ ...object, opaque: true })),
    ].sort((left, right) => left.id.localeCompare(right.id)),
  };
}

function readMcpOverlayObject(doc: Y.Doc, diagramId: string, objectId: string): McpOverlayObjectRead {
  const scene = readMcpOverlayScene(doc, diagramId);
  const object = scene.objects.find(({ id }) => id === objectId);
  if (object) return { status: 'found', overlay_revision: scene.overlay_revision, writable: scene.writable, object };
  const opaque = scene.opaque_objects.find(({ id }) => id === objectId);
  if (opaque) return { status: 'opaque', overlay_revision: scene.overlay_revision, writable: false, object: opaque };
  return { status: 'missing', overlay_revision: scene.overlay_revision, writable: scene.writable, object_id: objectId };
}

function writeMcpOverlayObject(target: Y.Map<unknown>, object: OverlayObjectRecord): void {
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
    const body = new Y.Text();
    if (object.body) body.insert(0, object.body);
    target.set('body', body);
  } else {
    target.delete('body');
  }
}

/** Write only fields named by the operation so a future field on a known v1 record survives. */
function patchMcpOverlayObject(target: Y.Map<unknown>, patch: OverlayObjectPatch): void {
  if ('geometry' in patch) target.set('geometry', structuredClone(patch.geometry));
  if ('anchor' in patch) {
    if (patch.anchor === undefined) target.delete('anchor'); else target.set('anchor', structuredClone(patch.anchor));
  }
  if ('layer' in patch) {
    if (patch.layer === undefined) target.delete('layer'); else target.set('layer', patch.layer);
  }
  if ('style' in patch) target.set('style', structuredClone(patch.style));
  if ('metadata' in patch) target.set('metadata', structuredClone(patch.metadata));
  if ('payload' in patch) target.set('payload', structuredClone(patch.payload));
  if ('body' in patch) {
    const body = target.get('body');
    if (!(body instanceof Y.Text) || typeof patch.body !== 'string') throw new Error('Overlay object body is not editable.');
    body.delete(0, body.length);
    if (patch.body) body.insert(0, patch.body);
  }
}

function overlayOrderKeyBetween(lower: string | null, upper: string | null): string {
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
    if (lowerCode === upperCode) { prefix += String.fromCharCode(lowerCode); continue; }
    if (upperCode - lowerCode > 1) return `${prefix}${String.fromCharCode(Math.floor((lowerCode + upperCode) / 2))}`;
    prefix += String.fromCharCode(lowerCode);
  }
  return `${lower}~`;
}

function assertSupportedOverlayScene(scene: OverlaySceneSnapshot): void {
  if (scene.version !== OVERLAY_SCENE_SCHEMA_VERSION) {
    throw new Error(`Unsupported overlay scene version: ${scene.version}`);
  }
  const unsupported = scene.objects.find((object) => !SUPPORTED_OVERLAY_KINDS.has(object.kind) || object.version !== 1);
  if (unsupported) {
    throw new Error(`Unsupported overlay object: ${unsupported.kind}@${unsupported.version}`);
  }
}

function isSupportedOverlayScene(scene: OverlaySceneSnapshot): boolean {
  try { assertSupportedOverlayScene(scene); return true; } catch { return false; }
}

function isMcpOverlayObjectLocked(scene: OverlaySceneSnapshot, objectId: string): boolean {
  const byId = new Map(scene.objects.map((object) => [object.id, object]));
  const layers = new Map((scene.layers ?? []).map((layer) => [layer.id, layer]));
  const visit = (id: string, visited: Set<string>): boolean => {
    const object = byId.get(id);
    if (!object) return true;
    if (object.metadata.locked === true || layers.get(object.layer ?? 'default')?.locked === true) return true;
    return scene.objects.some((frame) => {
      if (frame.kind !== 'frame.section' || !Array.isArray(frame.payload.members) || !frame.payload.members.includes(id)) return false;
      if (visited.has(frame.id)) return true;
      const next = new Set(visited); next.add(frame.id);
      return visit(frame.id, next);
    });
  };
  return visit(objectId, new Set([objectId]));
}

function assertBoundedOverlayActor(actor: ActivityEvent['actor']): void {
  if (!actor.name.trim() || Buffer.byteLength(actor.name, 'utf8') > COLLABORATION_BUDGETS.identifierBytes) {
    throw new Error('Overlay actor name exceeds the collaboration identifier budget.');
  }
}

function overlayRevisionForScene(scene: OverlaySceneSnapshot): string {
  return createHash('sha256').update(JSON.stringify(scene)).digest('base64url');
}

function replaceOverlayScene(doc: Y.Doc, snapshot: OverlaySceneSnapshot): void {
  const scene = new Y.Map<unknown>();
  scene.set('version', snapshot.version);
  const objects = new Y.Map<Y.Map<unknown>>();
  for (const object of snapshot.objects) {
    const value = new Y.Map<unknown>();
    value.set('kind', object.kind);
    value.set('version', object.version);
    value.set('order_key', object.order_key);
    value.set('geometry', structuredClone(object.geometry));
    if (object.anchor) value.set('anchor', structuredClone(object.anchor));
    if (object.layer) value.set('layer', object.layer);
    value.set('style', structuredClone(object.style));
    value.set('metadata', structuredClone(object.metadata));
    value.set('payload', structuredClone(object.payload));
    objects.set(object.id, value);
    if (object.kind === 'annotation.text' || object.kind === 'annotation.sticky' || object.kind.startsWith('shape.')) {
      const body = new Y.Text();
      value.set('body', body);
      if (object.body) body.insert(0, object.body);
    }
  }
  scene.set('objects', objects);
  const layers = new Y.Map<Y.Map<unknown>>();
  for (const layer of snapshot.layers ?? [{ id: 'default', name: 'Default', order_key: '0000000000000000', visible: true, locked: false, export: true }]) {
    const value = new Y.Map<unknown>();
    for (const [key, entry] of Object.entries(layer)) value.set(key, entry);
    layers.set(layer.id, value);
  }
  scene.set('layers', layers);
  overlaysMap(doc).set(snapshot.diagram_id, scene);
}

/** Source is canonical: only accepted blank/generic/flowchart source can prune layout. */
function reconcileNodePositionsForSource(diagram: DiagramMap, policy: SourceLayoutPolicy): void {
  if (!policy.pruneDurablePositions) {
    return;
  }

  const positions = getNodePositions(diagram);
  for (const nodeId of positions.keys()) {
    if (!policy.nodeIds.has(nodeId)) {
      positions.delete(nodeId);
    }
  }
}

function replaceNodePositions(diagram: DiagramMap, positions: DiagramNodePositions): void {
  const durablePositions = getNodePositions(diagram);
  for (const id of [...durablePositions.keys()]) {
    durablePositions.delete(id);
  }
  for (const [id, position] of Object.entries(positions)) {
    durablePositions.set(id, { x: position.x, y: position.y });
  }
}

function getDiagramName(diagram: DiagramMap, id: string): string {
  const name = diagram.get(DIAGRAM_NAME_KEY);
  return typeof name === 'string' && name.trim().length > 0 ? name : `Diagram ${id}`;
}

function createDiagram(id: string, name: string, mermaidText: string): DiagramMap {
  const diagram = new Y.Map<unknown>();
  diagram.set(DIAGRAM_NAME_KEY, name);
  diagram.set(DIAGRAM_MERMAID_TEXT_KEY, new Y.Text(mermaidText));
  diagram.set(DIAGRAM_NODE_POSITIONS_KEY, new Y.Map());
  return diagram;
}

function isDiagramMap(value: unknown): value is DiagramMap {
  return value instanceof Y.Map;
}

function normalizeDiagramName(name: string): string {
  const normalized = name.trim().replace(/\s+/gu, ' ');
  if (!normalized) {
    throw new Error('Diagram name must not be empty.');
  }
  return normalized.slice(0, 120);
}

function diagramId(): string {
  return `diagram_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

function revisionFromDoc(doc: Y.Doc): string {
  const diagrams = diagramsMap(doc);
  const catalog = orderedDiagramIds(doc).flatMap((id) => {
    const diagram = diagrams.get(id);
    return diagram ? [{ id, revision: revisionForDiagram(diagram, id) }] : [];
  });
  return createHash('sha256').update(JSON.stringify(catalog)).digest('base64url');
}

/** Unlike the catalog revision, this includes overlay scenes because import replaces both planes. */
function workspaceRevisionFromDoc(doc: Y.Doc): string {
  return createHash('sha256').update(canonicalWorkspaceJson({
    diagrams: orderedDiagramIds(doc).flatMap((id) => {
      const diagram = diagramsMap(doc).get(id);
      return diagram ? [{
        id,
        name: getDiagramName(diagram, id),
        source: getMermaidText(diagram).toString(),
        positions: readRevisionNodePositions(diagram),
      }] : [];
    }),
    order: orderedDiagramIds(doc),
    overlays: rawOverlayRevisionValue(doc),
  })).digest('base64url');
}

function revisionForDiagram(diagram: DiagramMap, id: string): string {
  const name = normalizeDiagramName(getDiagramName(diagram, id));
  const source = getMermaidText(diagram).toString();
  const positions = readRevisionNodePositions(diagram);
  return createHash('sha256')
    .update(JSON.stringify({ id, name, source, positions }))
    .digest('base64url');
}

function orderedDiagramIds(doc: Y.Doc): string[] {
  const diagrams = diagramsMap(doc);
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const id of diagramOrder(doc).toArray()) {
    if (diagrams.has(id) && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }

  for (const id of diagrams.keys()) {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }

  return ordered;
}

function readDiagrams(doc: Y.Doc): Diagram[] {
  const diagrams = diagramsMap(doc);
  return orderedDiagramIds(doc).flatMap((id) => {
    const diagram = diagrams.get(id);
    if (!diagram) {
      return [];
    }
    return [{
      id,
      name: getDiagramName(diagram, id),
      mermaid_text: getMermaidText(diagram).toString(),
      revision: revisionForDiagram(diagram, id),
    }];
  });
}

function readDiagram(doc: Y.Doc, id: string): Diagram {
  const diagram = diagramsMap(doc).get(id);
  if (!diagram) {
    throw new Error(`Diagram not found: ${id}`);
  }
  return {
    id,
    name: getDiagramName(diagram, id),
    mermaid_text: getMermaidText(diagram).toString(),
    revision: revisionForDiagram(diagram, id),
  };
}

function repairDiagramCatalog(doc: Y.Doc): boolean {
  const diagrams = diagramsMap(doc);
  const order = diagramOrder(doc);
  let repairedEntry = false;

  for (const id of [...diagrams.keys()].sort((left, right) => left.localeCompare(right))) {
    const diagram = diagrams.get(id);
    if (!isDiagramMap(diagram)) {
      diagrams.delete(id);
      repairedEntry = true;
      continue;
    }

    const mermaid = diagram.get(DIAGRAM_MERMAID_TEXT_KEY);
    if (!(mermaid instanceof Y.Text)) {
      const text = new Y.Text();
      if (typeof mermaid === 'string') text.insert(0, mermaid);
      diagram.set(DIAGRAM_MERMAID_TEXT_KEY, text);
      repairedEntry = true;
    }
    if (!(diagram.get(DIAGRAM_NODE_POSITIONS_KEY) instanceof Y.Map)) {
      diagram.set(DIAGRAM_NODE_POSITIONS_KEY, new Y.Map());
      repairedEntry = true;
    }
    const positions = diagram.get(DIAGRAM_NODE_POSITIONS_KEY) as Y.Map<unknown>;
    for (const [nodeId, rawPosition] of positions.entries()) {
      const position = rawPosition as Partial<{ x: unknown; y: unknown }> | null;
      if (!nodeId || !position || typeof position !== 'object'
        || typeof position.x !== 'number' || !Number.isFinite(position.x)
        || typeof position.y !== 'number' || !Number.isFinite(position.y)) {
        positions.delete(nodeId);
        repairedEntry = true;
      }
    }
  }

  const currentOrder = order.toArray();
  const canonicalOrder: string[] = [];
  const seen = new Set<string>();
  let seeded = false;

  for (const id of currentOrder) {
    if (diagrams.has(id) && !seen.has(id)) {
      seen.add(id);
      canonicalOrder.push(id);
    }
  }

  if (diagrams.size === 0) {
    diagrams.set(DEFAULT_DIAGRAM_ID, createDiagram(DEFAULT_DIAGRAM_ID, DEFAULT_DIAGRAM_TITLE, ''));
    canonicalOrder.push(DEFAULT_DIAGRAM_ID);
    seeded = true;
  } else {
    for (const id of [...diagrams.keys()].sort((left, right) => left.localeCompare(right))) {
      if (!seen.has(id)) {
        seen.add(id);
        canonicalOrder.push(id);
      }
    }
  }

  const orderChanged = currentOrder.length !== canonicalOrder.length
    || currentOrder.some((id, index) => id !== canonicalOrder[index]);
  if (orderChanged) {
    if (order.length > 0) order.delete(0, order.length);
    if (canonicalOrder.length > 0) order.insert(0, canonicalOrder);
  }

  return repairedEntry || seeded || orderChanged;
}

/**
 * Browser clients can mutate the Yjs document directly, bypassing the MCP
 * command validation. Resolve colliding raw names deterministically on the
 * authoritative document so an agent can safely identify a diagram by name.
 */
function reconcileDiagramNames(doc: Y.Doc): boolean {
  const diagrams = diagramsMap(doc);
  const claimedNames = new Set<string>();
  let changed = false;

  for (const id of [...diagrams.keys()].sort((left, right) => left.localeCompare(right))) {
    const diagram = diagrams.get(id);
    if (!diagram) continue;

    let baseName: string;
    try {
      baseName = normalizeDiagramName(getDiagramName(diagram, id));
    } catch {
      baseName = `Diagram ${id}`;
    }

    let candidate = baseName;
    let suffix = 1;
    while (claimedNames.has(candidate.toLocaleLowerCase())) {
      candidate = `${baseName} (${id.slice(-4)}${suffix === 1 ? '' : `-${suffix}`})`;
      suffix += 1;
    }

    claimedNames.add(candidate.toLocaleLowerCase());
    if (diagram.get(DIAGRAM_NAME_KEY) !== candidate) {
      diagram.set(DIAGRAM_NAME_KEY, candidate);
      changed = true;
    }
  }
  return changed;
}

function repairDocument(doc: Y.Doc): boolean {
  let changed = false;
  doc.transact(() => {
    const catalogChanged = repairDiagramCatalog(doc);
    const namesChanged = reconcileDiagramNames(doc);
    const overlaysChanged = repairOverlayDocument(doc);
    changed = catalogChanged || namesChanged || overlaysChanged;
  }, CATALOG_REPAIR_ORIGIN);
  return changed;
}

function readActivity(doc: Y.Doc): ActivityEvent[] {
  return doc.getArray<ActivityEvent>(ACTIVITY_KEY).toArray();
}

function isDiagramActivityEvent(value: unknown, diagramId: string): value is ActivityEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<ActivityEvent>;
  return event.diagram_id === diagramId
    && typeof event.id === 'string'
    && event.id.length > 0
    && typeof event.timestamp === 'number'
    && Number.isFinite(event.timestamp)
    && typeof event.action === 'string'
    && ACTIVITY_ACTIONS.has(event.action as ActivityEvent['action'])
    && !!event.actor
    && typeof event.actor.name === 'string'
    && (event.actor.type === 'human' || event.actor.type === 'agent');
}

function isParticipant(value: unknown): value is Participant {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const participant = value as Record<string, unknown>;
  return typeof participant.name === 'string'
    && typeof participant.color === 'string'
    && (participant.type === 'human' || participant.type === 'agent');
}

function readParticipants(doc: Y.Doc): Participant[] {
  return [...doc.getMap<Participant>(PRESENCE_KEY).values()].sort((left, right) => left.name.localeCompare(right.name));
}

function writeParticipants(doc: Y.Doc, participants: Participant[]): void {
  const map = doc.getMap<Participant>(PRESENCE_KEY);
  for (const key of [...map.keys()]) {
    map.delete(key);
  }
  for (const participant of participants) {
    map.set(participant.name, participant);
  }
}

function ensureParticipants(doc: Y.Doc, participants: readonly Participant[]): Participant[] {
  const map = doc.getMap<Participant>(PRESENCE_KEY);
  const ensured: Participant[] = [];

  for (const participant of participants) {
    const existing = map.get(participant.name);
    if (isParticipant(existing)) {
      ensured.push(existing);
      continue;
    }
    map.set(participant.name, participant);
    ensured.push(participant);
  }

  return ensured;
}

function readParticipantsFromAwareness(awareness: Awareness): Participant[] {
  const participants: Participant[] = [];

  for (const state of awareness.getStates().values()) {
    const awarenessState = state as { user?: unknown } | Record<string, unknown>;
    const participant = awarenessState.user;
    if (isParticipant(participant)) {
      participants.push(participant);
    }
  }

  return participants.sort((left, right) => left.name.localeCompare(right.name));
}

function readCollaborators(doc: Y.Doc, awareness: Awareness): Participant[] {
  const collaborators = new Map<string, Participant>();
  for (const participant of readParticipants(doc)) {
    if (participant.type === 'agent') {
      collaborators.set(participant.name, participant);
    }
  }
  for (const participant of readParticipantsFromAwareness(awareness)) {
    if (!collaborators.has(participant.name)) {
      collaborators.set(participant.name, participant);
    }
  }
  return [...collaborators.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function readParticipantMirror(doc: Y.Doc, awareness: Awareness): Participant[] {
  const participants = new Map<string, Participant>();
  for (const participant of readParticipants(doc)) {
    if (participant.type === 'agent') {
      participants.set(participant.name, participant);
    }
  }
  for (const participant of readParticipantsFromAwareness(awareness)) {
    if (participant.type === 'human' && !participants.has(participant.name)) {
      participants.set(participant.name, participant);
    }
  }
  return [...participants.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function areParticipantsEqual(left: readonly Participant[], right: readonly Participant[]): boolean {
  return left.length === right.length && left.every((participant, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && participant.name === candidate.name
      && participant.color === candidate.color
      && participant.type === candidate.type;
  });
}

function syncParticipantsFromAwareness(session: SessionState): void {
  const participants = readParticipantMirror(session.doc, session.awareness);
  const currentParticipants = readParticipants(session.doc);
  // Cursor and canvas-selection awareness updates must not create a document
  // transaction when the durable participant mirror is already current.
  if (areParticipantsEqual(currentParticipants, participants)) {
    return;
  }
  session.doc.transact(() => {
    writeParticipants(session.doc, participants);
  }, MANAGED_AWARENESS_ORIGIN);
}

function titleFromDiagrams(diagrams: DiagramSummary[]): string {
  return diagrams[0]?.name ?? DEFAULT_SESSION_TITLE;
}

function stableParticipantClientId(participant: Participant): number {
  let hash = 2_166_136_261;
  const input = `managed:${participant.type}:${participant.name}`;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0) % 2_147_483_646 + 1;
}

function encodeAwarenessStateUpdate(entries: Array<{ clientId: number; clock: number; state: Record<string, unknown> | null }>): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, entries.length);
  for (const entry of entries) {
    encoding.writeVarUint(encoder, entry.clientId);
    encoding.writeVarUint(encoder, entry.clock);
    encoding.writeVarString(encoder, JSON.stringify(entry.state));
  }
  return encoding.toUint8Array(encoder);
}

export class SessionManager {
  private readonly store: SessionStore;
  private readonly sessions = new Map<string, SessionState>();
  private readonly loadingSessions = new Map<string, Promise<SessionState>>();
  private readonly persistenceQueues = new Map<string, Promise<void>>();

  constructor(store: SessionStore) {
    this.store = store;
  }

  async getOrCreateSession(sessionId: string): Promise<SessionState> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastAccessedAt = Date.now();
      return existing;
    }

    const loading = this.loadingSessions.get(sessionId);
    if (loading) {
      return loading;
    }

    const next = this.loadSession(sessionId).then((state) => {
      this.sessions.set(sessionId, state);
      this.loadingSessions.delete(sessionId);
      return state;
    }, (error) => {
      this.loadingSessions.delete(sessionId);
      throw error;
    });
    this.loadingSessions.set(sessionId, next);
    return next;
  }

  /** Explicit protected-room creation. Network ingress must use requireSession instead. */
  async createProtectedSession(sessionId: string, access: RoomAccessRecord, initialWorkspace?: unknown): Promise<SessionState> {
    // Parse and admit the candidate before checking or writing any durable
    // protected-room state. The resulting payload is a detached clone, so the
    // request body cannot change between admission and persistence.
    const initialWorkspacePayload = initialWorkspace === undefined ? undefined : this.prepareInitialWorkspace(initialWorkspace);
    if (this.sessions.has(sessionId) || await this.store.get(sessionId)) {
      throw new Error(`Session already exists: ${sessionId}`);
    }
    const loading = this.loadingSessions.get(sessionId);
    if (loading) {
      await loading;
      throw new Error(`Session already exists: ${sessionId}`);
    }
    const next = this.loadSession(sessionId, { allowCreate: true, initialRoomAccess: access, initialWorkspacePayload }).then((state) => {
      this.sessions.set(sessionId, state);
      this.loadingSessions.delete(sessionId);
      return state;
    }, (error) => {
      this.loadingSessions.delete(sessionId);
      throw error;
    });
    this.loadingSessions.set(sessionId, next);
    return next;
  }

  /** Loads an existing persisted/live room without creating state as a side effect. */
  async requireSession(sessionId: string): Promise<SessionState> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastAccessedAt = Date.now();
      return existing;
    }
    const loading = this.loadingSessions.get(sessionId);
    if (loading) return loading;
    const next = this.loadSession(sessionId, { allowCreate: false }).then((state) => {
      this.sessions.set(sessionId, state);
      this.loadingSessions.delete(sessionId);
      return state;
    }, (error) => {
      this.loadingSessions.delete(sessionId);
      throw error;
    });
    this.loadingSessions.set(sessionId, next);
    return next;
  }

  async readSession(sessionId: string): Promise<SessionSnapshot | null> {
    const live = this.sessions.get(sessionId);
    if (live) {
      live.lastAccessedAt = Date.now();
      return this.snapshot(live);
    }

    const persisted = await this.store.get(sessionId);
    if (!persisted) {
      return null;
    }

    const { doc, repaired } = this.documentFromPersistedRecord(persisted);
    try {
      const updatedAt = repaired ? Date.now() : persisted.updatedAt;
      const snapshot = this.snapshotFromDoc({
        id: persisted.id,
        doc,
        updatedAt,
        participants: readParticipants(doc),
      });
      if (repaired) {
        await this.runSessionPersistence(sessionId, () => this.store.set({
          id: snapshot.id,
          title: snapshot.title,
          activity: snapshot.activity,
          participants: snapshot.participants,
          encodedState: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
          updatedAt,
        }));
      }
      return snapshot;
    } finally {
      doc.destroy();
    }
  }

  async getSession(sessionId: string): Promise<{ session_id: string; diagrams: DiagramSummary[]; participants: Participant[]; revision: string }> {
    const snapshot = await this.readSession(sessionId);
    if (!snapshot) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return {
      session_id: sessionId,
      diagrams: snapshot.diagrams.map(({ id, name, revision }) => ({ id, name, revision })),
      participants: snapshot.participants,
      revision: snapshot.revision,
    };
  }

  /** Read the revision for the complete user-authored workspace plane. */
  async readWorkspaceRevision(sessionId: string): Promise<{ revision: string }> {
    const session = await this.requireSession(sessionId);
    return { revision: workspaceRevisionFromDoc(session.doc) };
  }

  /**
   * Validate in a detached full-session clone, then replace just catalog and
   * overlay roots in one live transaction. Activity and presence stay intact.
   */
  async importWorkspace(
    sessionId: string,
    expectedRevision: string,
    bundle: unknown,
  ): Promise<{ status: 'imported'; revision: string } | { status: 'stale'; revision: string }> {
    const session = await this.requireSession(sessionId);
    const payload = parseWorkspaceBundle(bundle);
    assertOverlayRootsLosslesslyReplaceable(session.doc);
    const currentRevision = workspaceRevisionFromDoc(session.doc);
    if (expectedRevision !== currentRevision) return { status: 'stale', revision: currentRevision };

    // Build the exact prospective state before touching the authoritative
    // document, so every rejected import is side-effect free.
    const candidate = createReservedRootDocument();
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(session.doc));
      candidate.transact(() => applyWorkspacePayload(candidate, payload), WORKSPACE_IMPORT_ORIGIN);
      const admission = validateDocumentState(candidate);
      if (!admission.accepted) throw new WorkspaceImportError(`The workspace bundle exceeds collaboration limits: ${admission.reason}.`);
    } finally {
      candidate.destroy();
    }

    // No await occurs between the precondition and transaction. Websocket
    // writers therefore cannot interleave a stale replacement here.
    session.doc.transact(() => applyWorkspacePayload(session.doc, payload), WORKSPACE_IMPORT_ORIGIN);
    session.lastAccessedAt = Date.now();
    session.updatedAt = Date.now();
    await this.persistSession(session);
    return { status: 'imported', revision: workspaceRevisionFromDoc(session.doc) };
  }

  async listDiagrams(sessionId: string): Promise<{ diagrams: DiagramSummary[]; participants: Participant[]; revision: string }> {
    const { session_id: _sessionId, ...result } = await this.getSession(sessionId);
    return result;
  }

  async readDiagram(sessionId: string, diagramId: string): Promise<{ diagram: Diagram; participants: Participant[] }> {
    const live = this.sessions.get(sessionId);
    if (live) {
      live.lastAccessedAt = Date.now();
      return { diagram: readDiagram(live.doc, diagramId), participants: readCollaborators(live.doc, live.awareness) };
    }
    const snapshot = await this.readSession(sessionId);
    if (!snapshot) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const diagram = snapshot.diagrams.find((candidate) => candidate.id === diagramId);
    if (!diagram) {
      throw new Error(`Diagram not found: ${diagramId}`);
    }
    return { diagram, participants: snapshot.participants };
  }

  async listDiagramHistory(sessionId: string, diagramId: string): Promise<{ revisions: DiagramRevisionSummary[]; current_revision: string }> {
    const session = await this.requireSession(sessionId);
    const diagram = readDiagram(session.doc, diagramId);
    const revisions = await this.store.listDiagramHistory(sessionId, diagramId);
    return {
      revisions: revisions.map(({ mermaid_text: _source, node_positions: _positions, ...summary }) => summary),
      current_revision: diagram.revision,
    };
  }

  async readDiagramRevision(sessionId: string, diagramId: string, revisionId: string): Promise<DiagramRevision> {
    const session = await this.requireSession(sessionId);
    readDiagram(session.doc, diagramId);
    const revision = await this.store.getDiagramRevision(sessionId, diagramId, revisionId);
    if (!revision) {
      throw new Error(`Diagram revision not found: ${revisionId}`);
    }
    return revision;
  }

  async readOverlayScene(sessionId: string, diagramId: string): Promise<{ scene: OverlaySceneSnapshot; revision: string }> {
    const session = await this.requireSession(sessionId);
    readDiagram(session.doc, diagramId);
    const scene = readOverlayScene(session.doc, diagramId);
    assertSupportedOverlayScene(scene);
    return { scene, revision: overlayRevisionForScene(scene) };
  }

  /** MCP gets an explicit opaque/read-only projection instead of a lossy v1 scene. */
  async readMcpOverlayScene(sessionId: string, diagramId: string): Promise<McpOverlayScene> {
    const session = await this.requireSession(sessionId);
    readDiagram(session.doc, diagramId);
    return readMcpOverlayScene(session.doc, diagramId);
  }

  async listMcpOverlayObjects(sessionId: string, diagramId: string): Promise<McpOverlayObjectList> {
    const session = await this.requireSession(sessionId);
    readDiagram(session.doc, diagramId);
    return listMcpOverlayObjects(session.doc, diagramId);
  }

  async readMcpOverlayObject(sessionId: string, diagramId: string, objectId: string): Promise<McpOverlayObjectRead> {
    const session = await this.requireSession(sessionId);
    readDiagram(session.doc, diagramId);
    return readMcpOverlayObject(session.doc, diagramId, objectId);
  }

  async createMcpOverlayObject(
    sessionId: string,
    diagramId: string,
    expectedRevision: string,
    object: OverlayObjectRecord,
    participants?: Participant[],
  ): Promise<OverlayObjectMutationOutput> {
    if (!SUPPORTED_OVERLAY_KINDS.has(object.kind) || object.version !== 1) {
      throw new Error(`Unsupported overlay object: ${object.kind}@${object.version}`);
    }
    return this.mutateMcpOverlayScene(sessionId, diagramId, expectedRevision, participants, (doc) => {
      const scene = this.requireMcpWritableOverlayScene(doc, diagramId);
      this.assertMcpOverlayLayerWritable(doc, diagramId, object.layer ?? 'default');
      const objects = scene.get('objects') as Y.Map<Y.Map<unknown>>;
      if (objects.has(object.id)) throw new Error(`Overlay object already exists: ${object.id}`);
      const next = new Y.Map<unknown>();
      writeMcpOverlayObject(next, object);
      objects.set(object.id, next);
    }, (scene) => {
      const created = scene.objects.find(({ id }) => id === object.id);
      if (!created) throw new Error('Overlay object was not persisted.');
      return { object: created };
    });
  }

  async updateMcpOverlayObject(
    sessionId: string,
    diagramId: string,
    objectId: string,
    expectedRevision: string,
    patch: OverlayObjectPatch,
    participants?: Participant[],
  ): Promise<OverlayObjectMutationOutput> {
    return this.mutateMcpOverlayScene(sessionId, diagramId, expectedRevision, participants, (doc) => {
      const scene = this.requireMcpWritableOverlayScene(doc, diagramId);
      const target = (scene.get('objects') as Y.Map<Y.Map<unknown>>).get(objectId);
      this.assertMcpEditableOverlayObject(target, objectId);
      this.assertMcpOverlayObjectUnlocked(doc, diagramId, objectId);
      patchMcpOverlayObject(target, patch);
    }, (scene) => {
      const updated = scene.objects.find(({ id }) => id === objectId);
      if (!updated) throw new Error('Overlay object was not persisted.');
      return { object: updated };
    });
  }

  async reorderMcpOverlayObject(
    sessionId: string,
    diagramId: string,
    objectId: string,
    expectedRevision: string,
    direction: 'front' | 'back' | 'forward' | 'backward',
    participants?: Participant[],
  ): Promise<OverlayObjectMutationOutput> {
    return this.mutateMcpOverlayScene(sessionId, diagramId, expectedRevision, participants, (doc) => {
      const scene = this.requireMcpWritableOverlayScene(doc, diagramId);
      const objects = scene.get('objects') as Y.Map<Y.Map<unknown>>;
      const target = objects.get(objectId);
      this.assertMcpEditableOverlayObject(target, objectId);
      this.assertMcpOverlayObjectUnlocked(doc, diagramId, objectId);
      const targetLayer = typeof target.get('layer') === 'string' ? target.get('layer') as string : 'default';
      // Include opaque peers in the ordering calculation: their fields stay
      // untouched, but an agent's order change must still land around them.
      const sameLayer = [...objects.entries()].flatMap(([id, value]) => {
        if (!(value instanceof Y.Map) || (typeof value.get('layer') === 'string' ? value.get('layer') : 'default') !== targetLayer) return [];
        const orderKey = value.get('order_key');
        return typeof orderKey === 'string' ? [{ id, order_key: orderKey }] : [];
      }).sort((left, right) => left.order_key.localeCompare(right.order_key) || left.id.localeCompare(right.id));
      const from = sameLayer.findIndex(({ id }) => id === objectId);
      const to = direction === 'front' ? sameLayer.length - 1 : direction === 'back' ? 0
        : direction === 'forward' ? Math.min(sameLayer.length - 1, from + 1) : Math.max(0, from - 1);
      if (to === from) return;
      const ordered = [...sameLayer]; const [item] = ordered.splice(from, 1); if (!item) return;
      ordered.splice(to, 0, item);
      const lower = ordered[to - 1]?.order_key ?? null;
      const upper = ordered[to + 1]?.order_key ?? null;
      target.set('order_key', overlayOrderKeyBetween(lower, upper));
    }, (scene) => {
      const updated = scene.objects.find(({ id }) => id === objectId);
      if (!updated) throw new Error('Overlay object was not persisted.');
      return { object: updated };
    });
  }

  async deleteMcpOverlayObject(
    sessionId: string,
    diagramId: string,
    objectId: string,
    expectedRevision: string,
    participants?: Participant[],
  ): Promise<OverlayObjectMutationOutput> {
    return this.mutateMcpOverlayScene(sessionId, diagramId, expectedRevision, participants, (doc) => {
      const scene = this.requireMcpWritableOverlayScene(doc, diagramId);
      const objects = scene.get('objects') as Y.Map<Y.Map<unknown>>;
      this.assertMcpEditableOverlayObject(objects.get(objectId), objectId);
      this.assertMcpOverlayObjectUnlocked(doc, diagramId, objectId);
      objects.delete(objectId);
    }, () => ({ deleted_object_id: objectId }));
  }

  async listOverlayHistory(sessionId: string, diagramId: string): Promise<{ revisions: OverlayRevisionSummary[]; current_revision: string }> {
    const current = await this.readOverlayScene(sessionId, diagramId);
    const revisions = await this.store.listOverlayHistory(sessionId, diagramId);
    return {
      revisions: revisions.map(({ scene: _scene, ...summary }) => summary),
      current_revision: current.revision,
    };
  }

  async readOverlayRevision(sessionId: string, diagramId: string, revisionId: string): Promise<OverlayRevision> {
    await this.readOverlayScene(sessionId, diagramId);
    const revision = await this.store.getOverlayRevision(sessionId, diagramId, revisionId);
    if (!revision) throw new Error(`Overlay revision not found: ${revisionId}`);
    return revision;
  }

  async restoreOverlayRevision(
    sessionId: string,
    diagramId: string,
    revisionId: string,
    expectedRevision: string,
    actor: ActivityEvent['actor'],
  ): Promise<RestoreOverlayRevisionResult> {
    const session = await this.requireSession(sessionId);
    assertBoundedOverlayActor(actor);
    readDiagram(session.doc, diagramId);
    const current = readOverlayScene(session.doc, diagramId);
    assertSupportedOverlayScene(current);
    const currentRevision = overlayRevisionForScene(current);
    if (expectedRevision !== currentRevision) return { status: 'stale', scene: current, current_revision: currentRevision };
    const target = await this.store.getOverlayRevision(sessionId, diagramId, revisionId);
    readDiagram(session.doc, diagramId);
    if (!target) throw new Error(`Overlay revision not found: ${revisionId}`);
    const beforeRestore = readOverlayScene(session.doc, diagramId);
    assertSupportedOverlayScene(beforeRestore);
    const beforeRevision = overlayRevisionForScene(beforeRestore);
    if (expectedRevision !== beforeRevision) return { status: 'stale', scene: beforeRestore, current_revision: beforeRevision };
    assertSupportedOverlayScene(target.scene);
    session.doc.transact(() => replaceOverlayScene(session.doc, target.scene), CATALOG_REPAIR_ORIGIN);
    const now = Date.now();
    session.lastAccessedAt = now;
    session.updatedAt = now;
    const revisions = await this.persistSession(session, { overlayRestore: { diagramId, revisionId, actor } });
    const restored = revisions.overlayRevisions.find((revision) => revision.restored_from_revision_id === revisionId);
    if (!restored) throw new Error('Overlay restore checkpoint was not persisted.');
    const scene = readOverlayScene(session.doc, diagramId);
    const { scene: _scene, ...summary } = restored;
    return { status: 'restored', scene, revision: summary };
  }

  async restoreDiagramRevision(
    sessionId: string,
    diagramId: string,
    revisionId: string,
    expectedRevision: string,
    event: ActivityEvent,
    participants?: Participant[],
    origin: Extract<DiagramRevisionOrigin, 'browser' | 'mcp'> = 'mcp',
  ): Promise<RestoreDiagramRevisionResult> {
    const session = await this.requireSession(sessionId);
    const current = readDiagram(session.doc, diagramId);
    if (expectedRevision !== current.revision) {
      return { status: 'stale', current, current_revision: current.revision };
    }

    const target = await this.store.getDiagramRevision(sessionId, diagramId, revisionId);
    if (!target) {
      throw new Error(`Diagram revision not found: ${revisionId}`);
    }

    const currentAfterTargetRead = readDiagram(session.doc, diagramId);
    if (expectedRevision !== currentAfterTargetRead.revision) {
      return { status: 'stale', current: currentAfterTargetRead, current_revision: currentAfterTargetRead.revision };
    }

    const diagram = diagramsMap(session.doc).get(diagramId);
    if (!diagram) {
      throw new Error(`Diagram not found: ${diagramId}`);
    }
    this.assertProjectedSourceBudget(session.doc, getMermaidText(diagram).toString(), target.mermaid_text);

    const restoreEvent: ActivityEvent = {
      ...event,
      action: 'restored',
      diagram_id: diagramId,
      base_revision: expectedRevision,
      restored_from_revision_id: revisionId,
    };
    const currentBeforeRestore = readDiagram(session.doc, diagramId);
    if (expectedRevision !== currentBeforeRestore.revision) {
      return { status: 'stale', current: currentBeforeRestore, current_revision: currentBeforeRestore.revision };
    }

    const ensuredParticipants = this.mutateWithParticipants(session, participants, () => {
      const text = getMermaidText(diagram);
      text.delete(0, text.length);
      text.insert(0, target.mermaid_text);
      replaceNodePositions(diagram, target.node_positions);
      this.appendActivity(session.doc, {
        ...restoreEvent,
        result_revision: revisionForDiagram(diagram, diagramId),
      });
    });
    const revisions = await this.afterMutation(session, ensuredParticipants, restoreEvent.id, origin);
    const revision = revisions.diagramRevisions.find((candidate) => candidate.activity_id === restoreEvent.id);
    if (!revision) {
      throw new Error('Restore history checkpoint was not persisted.');
    }
    return { status: 'restored', diagram: readDiagram(session.doc, diagramId), revision: this.revisionSummary(revision) };
  }

  async createDiagram(sessionId: string, name: string, mermaidText: string, revision: string, event: ActivityEvent, participants?: Participant[]): Promise<Diagram> {
    const session = await this.requireSession(sessionId);
    this.assertRevision(session.doc, revision);
    this.assertProjectedSourceBudget(session.doc, '', mermaidText, { creatingDiagram: true });
    const id = diagramId();
    const normalizedName = normalizeDiagramName(name);
    this.assertUniqueDiagramName(session.doc, normalizedName);
    const ensuredParticipants = this.mutateWithParticipants(session, participants, () => {
      diagramsMap(session.doc).set(id, createDiagram(id, normalizedName, mermaidText));
      overlaysMap(session.doc).set(id, createEmptyOverlayScene());
      diagramOrder(session.doc).push([id]);
      this.appendActivity(session.doc, {
        ...event,
        diagram_id: id,
        base_revision: revision,
        result_revision: revisionForDiagram(diagramsMap(session.doc).get(id)!, id),
      });
    });
    await this.afterMutation(session, ensuredParticipants, event.id);
    return readDiagram(session.doc, id);
  }

  async writeDiagram(sessionId: string, diagramId: string, mermaidText: string, revision: string, event: ActivityEvent, participants?: Participant[], name?: string): Promise<Diagram> {
    const sourceLayoutPolicy = await resolveSourceLayoutPolicy(mermaidText);
    const session = await this.requireSession(sessionId);
    const diagram = diagramsMap(session.doc).get(diagramId);
    if (!diagram) {
      throw new Error(`Diagram not found: ${diagramId}`);
    }
    this.assertDiagramRevision(diagram, diagramId, revision);
    this.assertProjectedSourceBudget(session.doc, getMermaidText(diagram).toString(), mermaidText);
    const nextName = name === undefined ? undefined : normalizeDiagramName(name);
    if (nextName !== undefined) {
      this.assertUniqueDiagramName(session.doc, nextName, diagramId);
    }
    const ensuredParticipants = this.mutateWithParticipants(session, participants, () => {
      const text = getMermaidText(diagram);
      text.delete(0, text.length);
      text.insert(0, mermaidText);
      reconcileNodePositionsForSource(diagram, sourceLayoutPolicy);
      if (nextName !== undefined) {
        diagram.set(DIAGRAM_NAME_KEY, nextName);
      }
      this.appendActivity(session.doc, {
        ...event,
        diagram_id: diagramId,
        base_revision: revision,
        result_revision: revisionForDiagram(diagram, diagramId),
      });
    });
    await this.afterMutation(session, ensuredParticipants, event.id);
    return readDiagram(session.doc, diagramId);
  }

  async renameDiagram(sessionId: string, diagramId: string, name: string, revision: string, event: ActivityEvent, participants?: Participant[]): Promise<Diagram> {
    const session = await this.requireSession(sessionId);
    const diagram = diagramsMap(session.doc).get(diagramId);
    if (!diagram) {
      throw new Error(`Diagram not found: ${diagramId}`);
    }
    this.assertDiagramRevision(diagram, diagramId, revision);
    const normalizedName = normalizeDiagramName(name);
    this.assertUniqueDiagramName(session.doc, normalizedName, diagramId);
    const ensuredParticipants = this.mutateWithParticipants(session, participants, () => {
      diagram.set(DIAGRAM_NAME_KEY, normalizedName);
      this.appendActivity(session.doc, {
        ...event,
        diagram_id: diagramId,
        base_revision: revision,
        result_revision: revisionForDiagram(diagram, diagramId),
      });
    });
    await this.afterMutation(session, ensuredParticipants, event.id);
    return readDiagram(session.doc, diagramId);
  }

  async deleteDiagram(sessionId: string, diagramId: string, revision: string, event: ActivityEvent, participants?: Participant[]): Promise<string> {
    const session = await this.requireSession(sessionId);
    const diagrams = diagramsMap(session.doc);
    if (!diagrams.has(diagramId)) {
      throw new Error(`Diagram not found: ${diagramId}`);
    }
    this.assertDiagramRevision(diagrams.get(diagramId)!, diagramId, revision);
    if (diagrams.size <= 1) {
      throw new Error('A session must retain at least one diagram.');
    }
    const ensuredParticipants = this.mutateWithParticipants(session, participants, () => {
      diagrams.delete(diagramId);
      overlaysMap(session.doc).delete(diagramId);
      const order = diagramOrder(session.doc);
      const index = order.toArray().indexOf(diagramId);
      if (index >= 0) {
        order.delete(index, 1);
      }
      this.appendActivity(session.doc, { ...event, diagram_id: diagramId, base_revision: revision });
    });
    await this.afterMutation(session, ensuredParticipants, event.id);
    return revisionFromDoc(session.doc);
  }

  async cleanupExpiredSessions(options: CleanupOptions): Promise<string[]> {
    const now = options.now ?? Date.now();
    const removed: string[] = [];
    for (const [sessionId, state] of this.sessions.entries()) {
      if (state.sockets.size > 0 || now - state.lastAccessedAt < options.ttlMs) continue;
      await this.persistSession(state);
      state.doc.destroy();
      this.sessions.delete(sessionId);
      removed.push(sessionId);
    }
    if (Number.isFinite(options.diskTtlMs)) {
      for (const record of await this.store.list()) {
        if (!this.sessions.has(record.id) && now - record.updatedAt >= options.diskTtlMs) {
          const deleted = await this.runSessionPersistence(record.id, async () => {
            if (!this.sessions.has(record.id)) {
              await this.store.delete(record.id);
              return true;
            }
            return false;
          });
          if (deleted) removed.push(record.id);
        }
      }
    }
    return removed;
  }

  async persistSession(session: SessionState, options: PersistenceOptions = {}): Promise<PersistedRevisions> {
    const pending = this.capturePendingPersistence(session);
    return this.runSessionPersistence(session.id, () => this.persistSessionLocked(session, pending, options));
  }

  private async persistSessionLocked(
    session: SessionState,
    pending: PendingSessionPersistence,
    options: PersistenceOptions,
  ): Promise<PersistedRevisions> {
    const history = await this.historyChanges(session.id, pending.snapshot, options);
    const persisted = await this.store.persistWithHistory(pending.record, history, { initialRoomAccess: options.initialRoomAccess });
    if (persisted === false) throw new Error(`Session already exists: ${session.id}`);
    session.lastPersistedAt = Math.max(session.lastPersistedAt, pending.record.updatedAt);
    return { diagramRevisions: history.revisions, overlayRevisions: history.overlayRevisions };
  }

  async close(): Promise<void> {
    for (const state of this.sessions.values()) {
      const activeClientIds = [...state.socketClientIds.values()].flatMap((clientIds) => [...clientIds]);
      if (activeClientIds.length > 0) removeAwarenessStates(state.awareness, activeClientIds, MANAGED_AWARENESS_ORIGIN);
      await this.persistSession(state);
      state.doc.destroy();
    }
    this.sessions.clear();
    await this.store.close();
  }

  toSessionSummary(snapshot: SessionSnapshot): SessionSummary {
    return { id: snapshot.id, title: snapshot.title, participants: snapshot.participants.length };
  }

  private async loadSession(
    sessionId: string,
    options: { allowCreate?: boolean; initialRoomAccess?: RoomAccessRecord; initialWorkspacePayload?: WorkspaceBundlePayload } = {},
  ): Promise<SessionState> {
    const persisted = await this.store.get(sessionId);
    if (persisted && options.initialRoomAccess) {
      throw new Error(`Session already exists: ${sessionId}`);
    }
    if (!persisted && options.allowCreate === false) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const loaded = persisted ? this.documentFromPersistedRecord(persisted) : { doc: createReservedRootDocument(), repaired: false };
    const doc = loaded.doc;
    const initialWorkspacePayload = options.initialWorkspacePayload;
    try {
      if (!persisted && initialWorkspacePayload) {
        doc.transact(() => applyWorkspacePayload(doc, initialWorkspacePayload), WORKSPACE_IMPORT_ORIGIN);
      }
      const repairedOnLoad = repairDocument(doc) || loaded.repaired;
      const admission = validateDocumentState(doc);
      if (!admission.accepted) {
        throw new Error(`Session document rejected: ${admission.reason}`);
      }
      const awareness = new Awareness(doc);
      awareness.setLocalState(null);
      const now = Date.now();
      const state: SessionState = {
        id: sessionId, doc, awareness, sockets: new Set(), socketClientIds: new Map(), managedAwarenessClientIds: new Set(),
        lastAccessedAt: now, lastPersistedAt: persisted?.updatedAt ?? 0, updatedAt: persisted?.updatedAt ?? now,
      };
      awareness.on('update', () => {
        syncParticipantsFromAwareness(state);
        state.lastAccessedAt = Date.now();
      });
      doc.on('afterTransaction', (transaction) => {
        if (transaction.origin === MANAGED_AWARENESS_ORIGIN || transaction.origin === CATALOG_REPAIR_ORIGIN) {
          return;
        }
        repairDocument(doc);
      });
      if (repairedOnLoad) {
        state.updatedAt = Date.now();
      }
      if (repairedOnLoad || persisted || options.initialRoomAccess) {
        await this.persistSession(state, { recovery: true, initialRoomAccess: options.initialRoomAccess });
      }
      return state;
    } catch (error) {
      doc.destroy();
      throw error;
    }
  }

  /** Fully admit a promotion payload before room or capability persistence begins. */
  private prepareInitialWorkspace(bundle: unknown): WorkspaceBundlePayload {
    const payload = parseWorkspaceBundle(bundle);
    const candidate = createReservedRootDocument();
    try {
      candidate.transact(() => applyWorkspacePayload(candidate, payload), WORKSPACE_IMPORT_ORIGIN);
      repairDocument(candidate);
      const admission = validateDocumentState(candidate);
      if (!admission.accepted) {
        throw new WorkspaceImportError(`The workspace bundle exceeds collaboration limits: ${admission.reason}.`);
      }
      return payload;
    } finally {
      candidate.destroy();
    }
  }

  /** Builds and validates a detached persisted candidate before it becomes live. */
  private documentFromPersistedRecord(record: SessionRecord): { doc: Y.Doc; repaired: boolean } {
    const encoded = decodePersistedYjsState(record.encodedState);
    if (!(encoded instanceof Uint8Array)) {
      throw new Error(`Persisted session rejected: ${encoded.reason}`);
    }
    const doc = createReservedRootDocument();
    try {
      Y.applyUpdate(doc, new Uint8Array(encoded));
      // Root collection identities are not repairable without changing the
      // document contract. Refuse them before typed catalog repair executes.
      const rootTypes = validateReservedRootTypes(doc);
      if (!rootTypes.accepted) throw new Error(`Persisted session rejected: ${rootTypes.reason}`);
      const repaired = repairDocument(doc);
      const admission = validateDocumentState(doc);
      if (!admission.accepted) throw new Error(`Persisted session rejected: ${admission.reason}`);
      return { doc, repaired };
    } catch (error) {
      doc.destroy();
      if (error instanceof Error && error.message.startsWith('Persisted session rejected:')) throw error;
      throw new Error('Persisted session rejected: malformed_yjs_update');
    }
  }

  private snapshot(session: SessionState): SessionSnapshot {
    return this.snapshotFromDoc({ id: session.id, doc: session.doc, updatedAt: session.updatedAt, participants: readCollaborators(session.doc, session.awareness) });
  }

  private snapshotFromDoc(options: { id: string; doc: Y.Doc; updatedAt: number; participants: Participant[] }): SessionSnapshot {
    const diagrams = readDiagrams(options.doc);
    return { id: options.id, title: titleFromDiagrams(diagrams), diagrams, revision: revisionFromDoc(options.doc), activity: readActivity(options.doc), participants: options.participants, updatedAt: options.updatedAt };
  }

  private async historyChanges(
    sessionId: string,
    snapshot: HistorySnapshot,
    options: PersistenceOptions,
  ): Promise<HistoryPersistenceChange> {
    const revisions: DiagramRevision[] = [];
    const metadataUpdates: DiagramHistoryMetadata[] = [];
    const deleteSequences = new Map<string, { sessionId: string; diagramId: string; sequence: number }>();
    const diagramIds = snapshot.diagrams.map((diagram) => diagram.id);
    const storedMetadata = await this.store.listSessionHistoryMetadata(sessionId);
    const metadataByDiagram = new Map(storedMetadata.map((metadata) => [metadata.diagramId, metadata]));
    const sessionHasHistory = storedMetadata.length > 0;
    const storedOverlayMetadata = await this.store.listOverlayHistoryMetadata(sessionId);

    for (const id of diagramIds) {
      const diagram = snapshot.diagrams.find((candidate) => candidate.id === id);
      if (!diagram) continue;

      const prior = metadataByDiagram.get(id) ?? null;
      const events = snapshot.activity.filter((event) => isDiagramActivityEvent(event, id));
      const processed = new Set(prior?.processedActivityIds ?? []);
      const unseen = events.filter((event) => !processed.has(event.id));
      let nextSequence = prior?.nextSequence ?? 0;
      let latestRevision = prior?.latestRevision ?? '';
      const previousFirstRetainedMutation = prior?.firstRetainedMutationSequence ?? 1;
      const captured: DiagramRevision[] = [];

      if (!prior) {
        const creationIndex = sessionHasHistory ? unseen.findIndex((event) => event.action === 'created') : -1;
        if (creationIndex < 0) {
          captured.push(this.captureRevision(diagram, nextSequence, {
            action: 'baseline',
            actor: SYSTEM_HISTORY_ACTOR,
            origin: 'system',
          }));
          nextSequence += 1;
        }

        for (const event of creationIndex < 0 ? [] : unseen.slice(creationIndex)) {
          captured.push(this.captureRevision(diagram, nextSequence, {
            action: event.action,
            activity: event,
            origin: options.activityOrigins?.get(event.id) ?? 'browser',
          }));
          nextSequence += 1;
        }
      } else {
        for (const event of unseen) {
          captured.push(this.captureRevision(diagram, nextSequence, {
            action: event.action,
            activity: event,
            origin: options.activityOrigins?.get(event.id) ?? 'browser',
          }));
          nextSequence += 1;
        }
        if (captured.length === 0 && options.recovery && latestRevision !== diagram.revision) {
          captured.push(this.captureRevision(diagram, nextSequence, {
            action: 'checkpoint',
            actor: SYSTEM_HISTORY_ACTOR,
            origin: 'system',
          }));
          nextSequence += 1;
        }
      }

      if (captured.length === 0) continue;
      revisions.push(...captured);
      latestRevision = captured.at(-1)!.result_revision!;
      for (const event of unseen) processed.add(event.id);
      const processedActivityIds = [...processed].slice(-HISTORY_PROCESSED_ACTIVITY_LIMIT);
      const firstRetainedMutation = Math.max(1, nextSequence - HISTORY_RETAINED_MUTATIONS);
      metadataUpdates.push({
        sessionId,
        diagramId: id,
        firstRetainedMutationSequence: firstRetainedMutation,
        nextSequence,
        processedActivityIds,
        latestRevision,
      });

      for (let sequence = previousFirstRetainedMutation; sequence < firstRetainedMutation; sequence += 1) {
        deleteSequences.set(`${sessionId}:${id}:${sequence}`, { sessionId, diagramId: id, sequence });
      }
    }

    const overlayRevisions: OverlayRevision[] = [];
    const overlayMetadata: OverlayHistoryMetadata[] = [];
    const deleteOverlaySequences: Array<{ sessionId: string; diagramId: string; sequence: number }> = [];
    for (const scene of snapshot.overlayScenes) {
      if (!isSupportedOverlayScene(scene)) continue;
      const prior = storedOverlayMetadata.find((metadata) => metadata.diagramId === scene.diagram_id) ?? null;
      const currentRevision = overlayRevisionForScene(scene);
      const restore = options.overlayRestore?.diagramId === scene.diagram_id ? options.overlayRestore : undefined;
      if (prior?.latestRevision === currentRevision && !restore) continue;
      const sequence = prior?.nextSequence ?? 0;
      const action = restore ? 'restored' : prior ? 'checkpoint' : 'baseline';
      overlayRevisions.push({
        revision_id: `overlay_revision_${sequence.toString().padStart(16, '0')}`,
        sequence,
        diagram_id: scene.diagram_id,
        timestamp: Date.now(),
        actor: restore?.actor ?? SYSTEM_HISTORY_ACTOR,
        action,
        result_revision: currentRevision,
        ...(restore ? { restored_from_revision_id: restore.revisionId } : {}),
        scene,
      });
      const nextSequence = sequence + 1;
      const firstRetainedSequence = Math.max(1, nextSequence - HISTORY_RETAINED_MUTATIONS);
      overlayMetadata.push({
        sessionId,
        diagramId: scene.diagram_id,
        firstRetainedSequence,
        nextSequence,
        latestRevision: currentRevision,
      });
      for (let retained = prior?.firstRetainedSequence ?? 1; retained < firstRetainedSequence; retained += 1) {
        deleteOverlaySequences.push({ sessionId, diagramId: scene.diagram_id, sequence: retained });
      }
    }

    const overlayDiagramIds = new Set(snapshot.overlayScenes.map((scene) => scene.diagram_id));
    return {
      revisions,
      metadata: metadataUpdates,
      deleteSequences: [...deleteSequences.values()],
      deleteDiagramHistory: storedMetadata
        .filter((metadata) => !diagramIds.includes(metadata.diagramId))
        .map((metadata) => ({ sessionId, diagramId: metadata.diagramId })),
      overlayRevisions,
      overlayMetadata,
      deleteOverlaySequences,
      deleteOverlayHistory: storedOverlayMetadata
        .filter((metadata) => !overlayDiagramIds.has(metadata.diagramId))
        .map((metadata) => ({ sessionId, diagramId: metadata.diagramId })),
    };
  }

  private captureRevision(
    diagram: DiagramHistorySnapshot,
    sequence: number,
    input: {
      action: DiagramRevisionAction;
      actor?: ActivityEvent['actor'];
      origin: DiagramRevisionOrigin;
      activity?: ActivityEvent;
    },
  ): DiagramRevision {
    const activity = input.activity;
    return {
      revision_id: `revision_${sequence.toString().padStart(16, '0')}`,
      sequence,
      diagram_id: diagram.id,
      name: diagram.name,
      timestamp: activity?.timestamp ?? Date.now(),
      actor: input.actor ?? activity?.actor ?? SYSTEM_HISTORY_ACTOR,
      origin: input.origin,
      action: input.action,
      ...(activity === undefined ? {} : {
        activity_id: activity.id,
        base_revision: activity.base_revision,
        restored_from_revision_id: activity.restored_from_revision_id,
      }),
      result_revision: activity?.result_revision ?? diagram.revision,
      mermaid_text: diagram.mermaidText,
      node_positions: diagram.nodePositions,
    };
  }

  private revisionSummary(revision: DiagramRevision): DiagramRevisionSummary {
    const { mermaid_text: _source, node_positions: _positions, ...summary } = revision;
    return summary;
  }

  private assertRevision(doc: Y.Doc, revision: string): void {
    if (revision !== revisionFromDoc(doc)) throw new Error('Stale diagram revision. Read or list diagrams and retry.');
  }

  private assertDiagramRevision(diagram: DiagramMap, diagramId: string, revision: string): void {
    if (revision !== revisionForDiagram(diagram, diagramId)) {
      throw new Error('Stale diagram revision. Read or list diagrams and retry.');
    }
  }

  private assertUniqueDiagramName(doc: Y.Doc, name: string, exceptId?: string): void {
    const normalized = name.toLocaleLowerCase();
    for (const id of orderedDiagramIds(doc)) {
      if (id !== exceptId && getDiagramName(diagramsMap(doc).get(id)!, id).toLocaleLowerCase() === normalized) {
        throw new Error(`Diagram name already exists: ${name}`);
      }
    }
  }

  private requireMcpWritableOverlayScene(doc: Y.Doc, diagramId: string): Y.Map<unknown> {
    const scene = overlaysMap(doc).get(diagramId);
    if (!(scene instanceof Y.Map) || scene.get('version') !== OVERLAY_SCENE_SCHEMA_VERSION || !(scene.get('objects') instanceof Y.Map)) {
      throw new Error('This overlay scene uses a newer or unsupported schema and is read-only through MCP.');
    }
    return scene;
  }

  private assertMcpEditableOverlayObject(value: unknown, objectId: string): asserts value is Y.Map<unknown> {
    if (!(value instanceof Y.Map) || !SUPPORTED_OVERLAY_KINDS.has(value.get('kind') as string) || value.get('version') !== 1) {
      throw new Error(`Overlay object not found or opaque: ${objectId}`);
    }
  }

  private assertMcpOverlayObjectUnlocked(doc: Y.Doc, diagramId: string, objectId: string): void {
    if (isMcpOverlayObjectLocked(readOverlayScene(doc, diagramId), objectId)) {
      throw new Error(`Overlay object is locked: ${objectId}`);
    }
  }

  private assertMcpOverlayLayerWritable(doc: Y.Doc, diagramId: string, layerId: string): void {
    const layer = readOverlayScene(doc, diagramId).layers?.find(({ id }) => id === layerId);
    if (!layer) throw new Error(`Overlay layer not found: ${layerId}`);
    if (layer.locked) throw new Error(`Overlay layer is locked: ${layerId}`);
  }

  /** Reject a malformed/over-budget operation before the authoritative Yjs document changes. */
  private assertMcpOverlayMutationAdmitted(
    doc: Y.Doc,
    diagramId: string,
    participants: readonly Participant[] | undefined,
    mutation: (candidate: Y.Doc) => void,
  ): void {
    const candidate = createReservedRootDocument();
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(doc));
      candidate.transact(() => {
        if (participants !== undefined) ensureParticipants(candidate, participants);
        mutation(candidate);
      }, CATALOG_REPAIR_ORIGIN);
      const admission = validateDocumentState(candidate);
      if (!admission.accepted) throw new Error(`Overlay mutation exceeds collaboration limits: ${admission.reason}.`);
      if (!readMcpOverlayScene(candidate, diagramId).writable) {
        throw new Error('Overlay mutation would create a non-representable MCP object.');
      }
    } finally {
      candidate.destroy();
    }
  }

  private async mutateMcpOverlayScene(
    sessionId: string,
    diagramId: string,
    expectedRevision: string,
    participants: Participant[] | undefined,
    mutation: (doc: Y.Doc) => void,
    result: (scene: McpOverlayScene) => { object?: OverlayObjectRecord; deleted_object_id?: string },
  ): Promise<OverlayObjectMutationOutput> {
    const session = await this.requireSession(sessionId);
    readDiagram(session.doc, diagramId);
    const current = readMcpOverlayScene(session.doc, diagramId);
    if (!current.writable) throw new Error('This overlay scene uses a newer or unsupported schema and is read-only through MCP.');
    if (expectedRevision !== current.overlay_revision) return { status: 'stale', scene: current };

    // No await follows this check. Candidate validation and the live Yjs
    // transaction are synchronous, so a websocket update cannot interleave a
    // stale operation between them on the server event loop.
    this.assertMcpOverlayMutationAdmitted(session.doc, diagramId, participants, mutation);
    const committedRef: { value?: { overlay_revision: string; result: { object?: OverlayObjectRecord; deleted_object_id?: string } } } = {};
    const ensuredParticipants = this.mutateWithParticipants(session, participants, () => {
      mutation(session.doc);
      const scene = readMcpOverlayScene(session.doc, diagramId);
      committedRef.value = { overlay_revision: scene.overlay_revision, result: result(scene) };
    });
    const committed = committedRef.value;
    if (!committed) throw new Error('Overlay mutation did not commit.');
    await this.afterMutation(session, ensuredParticipants);
    return { status: 'updated', overlay_revision: committed.overlay_revision, ...committed.result };
  }

  /** MCP and server-owned source writes use the same bounded durable envelope as raw Yjs ingress. */
  private assertProjectedSourceBudget(
    doc: Y.Doc,
    previousSource: string,
    nextSource: string,
    options: { creatingDiagram?: boolean } = {},
  ): void {
    const nextBytes = Buffer.byteLength(nextSource, 'utf8');
    if (nextBytes > COLLABORATION_BUDGETS.totalTextBytes) {
      throw new Error('Mermaid source exceeds the collaborative document text budget.');
    }
    const currentBytes = Y.encodeStateAsUpdate(doc).byteLength;
    const previousBytes = Buffer.byteLength(previousSource, 'utf8');
    const structureAllowance = options.creatingDiagram ? 2_048 : 256;
    if (currentBytes - previousBytes + nextBytes + structureAllowance > COLLABORATION_BUDGETS.sessionStateBytes) {
      throw new Error('Mermaid source exceeds the collaborative document state budget.');
    }
  }

  private appendActivity(doc: Y.Doc, event: ActivityEvent): void {
    const activity = doc.getArray<ActivityEvent>(ACTIVITY_KEY);
    activity.push([event]);
    const overflow = activity.length - 100;
    if (overflow > 0) {
      activity.delete(0, overflow);
    }
  }

  private async afterMutation(
    session: SessionState,
    participants?: Participant[],
    activityId?: string,
    origin: Extract<DiagramRevisionOrigin, 'browser' | 'mcp'> = 'mcp',
  ): Promise<PersistedRevisions> {
    const now = Date.now();
    session.lastAccessedAt = now;
    session.updatedAt = now;
    if (participants !== undefined) this.setManagedParticipants(session, participants);
    return this.persistSession(session, {
      activityOrigins: activityId === undefined ? undefined : new Map([[activityId, origin]]),
    });
  }

  private historySnapshot(doc: Y.Doc, activity: ActivityEvent[]): HistorySnapshot {
    return {
      diagrams: orderedDiagramIds(doc).flatMap((id) => {
        const diagram = diagramsMap(doc).get(id);
        if (!diagram) return [];
        return [{
          id,
          name: normalizeDiagramName(getDiagramName(diagram, id)),
          mermaidText: getMermaidText(diagram).toString(),
          nodePositions: readRevisionNodePositions(diagram),
          revision: revisionForDiagram(diagram, id),
        }];
      }),
      overlayScenes: orderedDiagramIds(doc).map((id) => readOverlayScene(doc, id)),
      activity,
    };
  }

  private capturePendingPersistence(session: SessionState): PendingSessionPersistence {
    syncParticipantsFromAwareness(session);
    const snapshot = this.snapshot(session);
    return {
      snapshot: this.historySnapshot(session.doc, snapshot.activity),
      record: {
        id: snapshot.id,
        title: snapshot.title,
        activity: snapshot.activity,
        participants: snapshot.participants,
        encodedState: Buffer.from(Y.encodeStateAsUpdate(session.doc)).toString('base64'),
        updatedAt: snapshot.updatedAt,
      },
    };
  }

  private runSessionPersistence<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.persistenceQueues.get(sessionId);
    const result = previous === undefined
      ? operation()
      : previous.catch(() => undefined).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.persistenceQueues.set(sessionId, tail);
    void tail.then(() => {
      if (this.persistenceQueues.get(sessionId) === tail) {
        this.persistenceQueues.delete(sessionId);
      }
    });
    return result;
  }

  private mutateWithParticipants(
    session: SessionState,
    participants: readonly Participant[] | undefined,
    mutation: () => void,
  ): Participant[] | undefined {
    let ensuredParticipants: Participant[] | undefined;
    session.doc.transact(() => {
      ensuredParticipants = participants === undefined ? undefined : ensureParticipants(session.doc, participants);
      mutation();
    }, MANAGED_AWARENESS_ORIGIN);
    return ensuredParticipants;
  }

  private setManagedParticipants(session: SessionState, participants: Participant[]): void {
    const updates: Array<{ clientId: number; clock: number; state: Record<string, unknown> | null }> = [];
    for (const participant of participants) {
      const clientId = stableParticipantClientId(participant);
      const existing = session.awareness.getStates().get(clientId) as { user?: unknown } | undefined;
      if (isParticipant(existing?.user)
        && existing.user.name === participant.name
        && existing.user.color === participant.color
        && existing.user.type === participant.type) {
        session.managedAwarenessClientIds.add(clientId);
        continue;
      }
      updates.push({ clientId, clock: (session.awareness.meta.get(clientId)?.clock ?? 0) + 1, state: { user: participant } });
      session.managedAwarenessClientIds.add(clientId);
    }
    if (updates.length > 0) applyAwarenessUpdate(session.awareness, encodeAwarenessStateUpdate(updates), MANAGED_AWARENESS_ORIGIN);
  }
}
