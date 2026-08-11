import * as Y from 'yjs';
import {
  ACTIVITY_KEY,
  DIAGRAM_MERMAID_TEXT_KEY,
  DIAGRAM_NAME_KEY,
  DIAGRAM_NODE_POSITIONS_KEY,
  DIAGRAM_ORDER_KEY,
  DIAGRAMS_KEY,
  OVERLAYS_KEY,
  PRESENCE_KEY,
} from './constants.js';

/**
 * These are deliberately document, not transport, limits. Keeping the
 * accepted state below one websocket frame means an empty client can always
 * bootstrap without amplifying a legacy snapshot into an unbounded response.
 */
export const COLLABORATION_BUDGETS = {
  websocketFrameBytes: 512 * 1024,
  yjsUpdateBytes: 128 * 1024,
  sessionStateBytes: 192 * 1024,
  diagramsPerSession: 64,
  objectsPerScene: 200,
  textBytesPerObject: 16 * 1024,
  strokePointsPerObject: 2_048,
  totalTextBytes: 160 * 1024,
  valuesPerDocument: 12_000,
  sharedTypesPerDocument: 4_000,
  recursionDepth: 24,
  activityEventsPerSession: 1_000,
  participantsPerSession: 256,
  identifierBytes: 256,
  activityDetailBytes: 4 * 1024,
} as const;

export type DocumentAdmissionReason =
  | 'document_state_too_large'
  | 'update_too_large'
  | 'malformed_yjs_update'
  | 'invalid_document_value'
  | 'document_too_complex'
  | 'invalid_reserved_root'
  | 'invalid_overlay_schema'
  | 'overlay_quota_exceeded';

export type DocumentAdmission =
  | { accepted: true; normalizedUpdate?: Uint8Array }
  | { accepted: false; reason: DocumentAdmissionReason };

const OVERLAY_SCHEMA_VERSION = 1;
const INK_MAX_POINTS = 512;
const INK_MAX_SERIALIZED_BYTES = 48 * 1024;
const INK_MAX_WORLD_COORDINATE = 1_000_000;
const INK_MAX_GEOMETRY_COORDINATE = INK_MAX_WORLD_COORDINATE + 32;
const INK_MAX_GEOMETRY_SIZE = (INK_MAX_WORLD_COORDINATE * 2) + 64;

function rejected(reason: DocumentAdmissionReason): Extract<DocumentAdmission, { accepted: false }> {
  return { accepted: false, reason };
}

function byteLength(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return isRecord(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function isBoundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && byteLength(value) <= COLLABORATION_BUDGETS.identifierBytes;
}

// Shared Yjs values can cross workspace module identities. Use their stable
// collection operations instead of rejecting a valid persisted document by
// realm identity.
function isYMap(value: unknown): value is Y.Map<unknown> {
  return value instanceof Y.Map || (isRecord(value)
    && typeof value.entries === 'function'
    && typeof value.set === 'function'
    && typeof value.delete === 'function'
    && typeof value.size === 'number');
}

function isYArray(value: unknown): value is Y.Array<unknown> {
  return value instanceof Y.Array || (isRecord(value)
    && typeof value.toArray === 'function'
    && typeof value.insert === 'function'
    && typeof value.length === 'number');
}

function isYText(value: unknown): value is Y.Text {
  return value instanceof Y.Text || (isRecord(value)
    && typeof value.toString === 'function'
    && typeof value.insert === 'function'
    && typeof value.length === 'number'
    && !isYArray(value));
}

// Yjs updates intentionally omit the identity of top-level collection types.
// Hydrating the reserved roots before decoding gives candidate documents the
// same collection contract as a live session, while incompatible list/map
// content remains observable in the internal root representation below.
export function createReservedRootDocument(): Y.Doc {
  const doc = new Y.Doc();
  doc.getMap(DIAGRAMS_KEY);
  doc.getArray(DIAGRAM_ORDER_KEY);
  doc.getArray(ACTIVITY_KEY);
  doc.getMap(PRESENCE_KEY);
  doc.getMap(OVERLAYS_KEY);
  return doc;
}

function isReservedMapRoot(value: unknown): boolean {
  return isYMap(value) && (value as { _start?: unknown })._start === null;
}

function isReservedArrayRoot(value: unknown): boolean {
  return isYArray(value) && (value as { _map?: unknown })._map instanceof Map && (value as { _map: Map<unknown, unknown> })._map.size === 0;
}

interface ValidationCounters {
  textBytes: number;
  values: number;
  sharedTypes: number;
}

function validatePlainValue(value: unknown, counters: ValidationCounters, depth: number): DocumentAdmissionReason | undefined {
  if (depth > COLLABORATION_BUDGETS.recursionDepth) return 'document_too_complex';
  counters.values += 1;
  if (counters.values > COLLABORATION_BUDGETS.valuesPerDocument) return 'document_too_complex';

  if (value === null || value === undefined || typeof value === 'boolean') return undefined;
  if (typeof value === 'number') return Number.isFinite(value) ? undefined : 'invalid_document_value';
  if (typeof value === 'string') {
    counters.textBytes += byteLength(value);
    return counters.textBytes > COLLABORATION_BUDGETS.totalTextBytes ? 'document_too_complex' : undefined;
  }
  if (value instanceof Uint8Array) {
    counters.textBytes += value.byteLength;
    return counters.textBytes > COLLABORATION_BUDGETS.totalTextBytes ? 'document_too_complex' : undefined;
  }
  if (Array.isArray(value)) {
    for (const child of value) {
      const reason = validatePlainValue(child, counters, depth + 1);
      if (reason) return reason;
    }
    return undefined;
  }
  if (!isRecord(value)) return 'invalid_document_value';
  const prototype = Object.getPrototypeOf(value);
  // Yjs may carry a subdocument or another future shared type as an opaque
  // value. It remains bounded by encoded state; only JSON-like records are
  // recursively inspected for invalid numbers and value floods.
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  for (const [key, child] of Object.entries(value)) {
    counters.textBytes += byteLength(key);
    if (counters.textBytes > COLLABORATION_BUDGETS.totalTextBytes) return 'document_too_complex';
    const reason = validatePlainValue(child, counters, depth + 1);
    if (reason) return reason;
  }
  return undefined;
}

function validateYType(value: unknown, counters: ValidationCounters, seen: Set<object>, depth: number): DocumentAdmissionReason | undefined {
  if (isYText(value)) {
    counters.sharedTypes += 1;
    counters.textBytes += byteLength(value.toString());
    if (counters.sharedTypes > COLLABORATION_BUDGETS.sharedTypesPerDocument || counters.textBytes > COLLABORATION_BUDGETS.totalTextBytes) {
      return 'document_too_complex';
    }
    return undefined;
  }
  if (isYMap(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    counters.sharedTypes += 1;
    if (counters.sharedTypes > COLLABORATION_BUDGETS.sharedTypesPerDocument) return 'document_too_complex';
    for (const [key, child] of value.entries()) {
      const keyReason = validatePlainValue(key, counters, depth + 1);
      if (keyReason) return keyReason;
      const childReason = validateYType(child, counters, seen, depth + 1);
      if (childReason) return childReason;
    }
    return undefined;
  }
  if (isYArray(value)) {
    if (seen.has(value)) return undefined;
    seen.add(value);
    counters.sharedTypes += 1;
    if (counters.sharedTypes > COLLABORATION_BUDGETS.sharedTypesPerDocument) return 'document_too_complex';
    for (const child of value.toArray()) {
      const childReason = validateYType(child, counters, seen, depth + 1);
      if (childReason) return childReason;
    }
    return undefined;
  }
  return validatePlainValue(value, counters, depth);
}

function validateOverlayObject(object: unknown): DocumentAdmissionReason | undefined {
  if (!isYMap(object)) return 'invalid_overlay_schema';
  const counters: ValidationCounters = { textBytes: 0, values: 0, sharedTypes: 0 };
  const reason = validateYType(object, counters, new Set<object>(), 0);
  if (reason) return reason;
  if (counters.textBytes > COLLABORATION_BUDGETS.textBytesPerObject) return 'overlay_quota_exceeded';
  // This is an envelope limit, not a stroke schema. #69 owns point shape and
  // renderer semantics; recursively count nested arrays so wrapping a point
  // list in maps/arrays cannot bypass the per-object collaboration budget.
  if (countOverlayArrayItems(object, new Set<object>()) > COLLABORATION_BUDGETS.strokePointsPerObject) return 'overlay_quota_exceeded';
  const kind = object.get('kind');
  const version = object.get('version');
  const orderKey = object.get('order_key');
  const geometry = object.get('geometry');
  const anchor = object.get('anchor');
  const layer = object.get('layer');
  const body = object.get('body');
  if (!isBoundedIdentifier(kind) || !Number.isInteger(version) || (version as number) < 1
    || !isBoundedIdentifier(orderKey) || !isOverlayGeometry(geometry)
    || (layer !== undefined && (typeof layer !== 'string' || byteLength(layer) > COLLABORATION_BUDGETS.identifierBytes))
    || !isOverlayMetadata(object.get('style')) || !isOverlayMetadata(object.get('metadata'))
    || !isPlainRecord(object.get('payload')) || (anchor !== undefined && !isOverlayAnchor(anchor))
    || (body !== undefined && !isYText(body))) {
    return 'invalid_overlay_schema';
  }
  if ((kind === 'annotation.text' || kind === 'annotation.sticky') && !isYText(body)) return 'invalid_overlay_schema';
  if (isYText(body) && byteLength(body.toString()) > 8_192) return 'overlay_quota_exceeded';
  if (kind === 'ink.stroke' && !isValidInkStroke(object)) return 'invalid_overlay_schema';
  return undefined;
}

function isOverlayPoint(value: unknown): boolean {
  return isPlainRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function isOverlayGeometry(value: unknown): boolean {
  if (!isOverlayPoint(value)) return false;
  const geometry = value as Record<string, unknown>;
  return Number.isFinite(geometry.width) && (geometry.width as number) >= 0
    && Number.isFinite(geometry.height) && (geometry.height as number) >= 0 && Number.isFinite(geometry.rotation);
}

/** The immutable final-stroke envelope; previews are awareness-only and never reach this path. */
function isValidInkStroke(object: Y.Map<unknown>): boolean {
  if (object.get('body') !== undefined) return false;
  const payload = object.get('payload');
  const style = object.get('style');
  if (!isPlainRecord(payload) || !isPlainRecord(style) || !isOverlayMetadata(style)
    || (payload.mode !== 'pen' && payload.mode !== 'highlighter')
    || typeof payload.composite_export !== 'boolean'
    || !Array.isArray(payload.points) || payload.points.length < 2 || payload.points.length > INK_MAX_POINTS
    || typeof style.color !== 'string' || byteLength(style.color) > 32
    || typeof style.width !== 'number' || !Number.isFinite(style.width) || style.width <= 0 || style.width > 64
    || typeof style.opacity !== 'number' || !Number.isFinite(style.opacity) || style.opacity < 0 || style.opacity > 1) return false;
  if (!payload.points.every((point) => isPlainRecord(point)
    && Number.isFinite(point.x) && Math.abs(point.x as number) <= INK_MAX_WORLD_COORDINATE
    && Number.isFinite(point.y) && Math.abs(point.y as number) <= INK_MAX_WORLD_COORDINATE
    && (point.pressure === undefined || (typeof point.pressure === 'number' && Number.isFinite(point.pressure) && point.pressure >= 0 && point.pressure <= 1)))) return false;
  const geometry = object.get('geometry');
  if (!isPlainRecord(geometry) || Math.abs(geometry.x as number) > INK_MAX_GEOMETRY_COORDINATE
    || Math.abs(geometry.y as number) > INK_MAX_GEOMETRY_COORDINATE
    || (geometry.width as number) > INK_MAX_GEOMETRY_SIZE || (geometry.height as number) > INK_MAX_GEOMETRY_SIZE
    || geometry.rotation !== 0) return false;
  const points = payload.points as Array<Record<string, number>>;
  const padding = Math.max(1, (style.width as number) / 2);
  const minX = Math.min(...points.map((point) => point.x)) - padding;
  const maxX = Math.max(...points.map((point) => point.x)) + padding;
  const minY = Math.min(...points.map((point) => point.y)) - padding;
  const maxY = Math.max(...points.map((point) => point.y)) + padding;
  const epsilon = 0.001;
  return Buffer.byteLength(JSON.stringify({ geometry, style, payload }), 'utf8') <= INK_MAX_SERIALIZED_BYTES
    && Math.abs((geometry.x as number) - minX) <= epsilon
    && Math.abs((geometry.y as number) - minY) <= epsilon
    && Math.abs((geometry.width as number) - (maxX - minX)) <= epsilon
    && Math.abs((geometry.height as number) - (maxY - minY)) <= epsilon;
}

function isOverlayAnchor(value: unknown): boolean {
  return isPlainRecord(value) && isBoundedIdentifier(value.mermaid_id)
    && isOverlayPoint(value.offset) && isOverlayPoint(value.fallback);
}

function isOverlayMetadata(value: unknown): boolean {
  if (!isPlainRecord(value) || Object.keys(value).length > 32) return false;
  return Object.entries(value).every(([key, item]) => byteLength(key) <= 128
    && (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item))
      || (typeof item === 'string' && byteLength(item) <= 2_048)));
}

function countOverlayArrayItems(value: unknown, seen: Set<object>): number {
  if (isYMap(value)) {
    if (seen.has(value)) return 0;
    seen.add(value);
    return [...value.values()].reduce<number>((total, child) => total + countOverlayArrayItems(child, seen), 0);
  }
  if (isYArray(value)) {
    if (seen.has(value)) return 0;
    seen.add(value);
    return value.length + value.toArray().reduce<number>((total, child) => total + countOverlayArrayItems(child, seen), 0);
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) return 0;
    seen.add(value);
    return value.length + value.reduce<number>((total, child) => total + countOverlayArrayItems(child, seen), 0);
  }
  if (isPlainRecord(value)) {
    if (seen.has(value)) return 0;
    seen.add(value);
    return Object.values(value).reduce<number>((total, child) => total + countOverlayArrayItems(child, seen), 0);
  }
  return 0;
}

function validateOverlays(doc: Y.Doc): DocumentAdmissionReason | undefined {
  const overlays = doc.share.get(OVERLAYS_KEY);
  if (overlays === undefined) return undefined;
  if (!isYMap(overlays)) return 'invalid_reserved_root';
  if (overlays.size > COLLABORATION_BUDGETS.diagramsPerSession) return 'overlay_quota_exceeded';

  for (const [sceneId, scene] of overlays.entries()) {
    if (typeof sceneId !== 'string' || sceneId.length === 0 || !isYMap(scene)) return 'invalid_overlay_schema';
    const version = scene.get('version');
    if (!Number.isInteger(version) || (version as number) < 1) return 'invalid_overlay_schema';
    // A client built against this schema must not reinterpret, rewrite, or
    // delete a newer scene. Its total document budget is still enforced above.
    if ((version as number) > OVERLAY_SCHEMA_VERSION) continue;
    const objects = scene.get('objects');
    if (!isYMap(objects)) return 'invalid_overlay_schema';
    if (objects.size > COLLABORATION_BUDGETS.objectsPerScene) return 'overlay_quota_exceeded';
    for (const [objectId, object] of objects.entries()) {
      if (typeof objectId !== 'string' || objectId.length === 0) return 'invalid_overlay_schema';
      const reason = validateOverlayObject(object);
      if (reason) return reason;
    }
  }
  return undefined;
}

function isParticipant(value: unknown): value is { name: string; color: string; type: 'human' | 'agent' } {
  if (!isPlainRecord(value)) return false;
  return isBoundedIdentifier(value.name)
    && typeof value.color === 'string'
    && byteLength(value.color) <= COLLABORATION_BUDGETS.identifierBytes
    && (value.type === 'human' || value.type === 'agent');
}

function isActivityEvent(value: unknown): boolean {
  if (!isPlainRecord(value) || !isBoundedIdentifier(value.id) || !Number.isFinite(value.timestamp)) return false;
  if (!isPlainRecord(value.actor) || !isBoundedIdentifier(value.actor.name) || (value.actor.type !== 'human' && value.actor.type !== 'agent')) return false;
  if (typeof value.action !== 'string' || !['joined', 'left', 'edited', 'replaced', 'created', 'renamed', 'deleted', 'restored'].includes(value.action)) return false;
  for (const key of ['diagram_id', 'base_revision', 'result_revision', 'restored_from_revision_id'] as const) {
    if (value[key] !== undefined && !isBoundedIdentifier(value[key])) return false;
  }
  return value.detail === undefined || (typeof value.detail === 'string' && byteLength(value.detail) <= COLLABORATION_BUDGETS.activityDetailBytes);
}

function isDiagramPosition(value: unknown): boolean {
  return isPlainRecord(value) && Number.isFinite(value.x) && Number.isFinite(value.y);
}

function validateDiagramCatalog(diagrams: Y.Map<unknown>): DocumentAdmissionReason | undefined {
  if (diagrams.size > COLLABORATION_BUDGETS.diagramsPerSession) return 'overlay_quota_exceeded';
  for (const [diagramId, diagram] of diagrams.entries()) {
    if (!isBoundedIdentifier(diagramId) || !isYMap(diagram)) return 'invalid_reserved_root';
    const name = diagram.get(DIAGRAM_NAME_KEY);
    const mermaid = diagram.get(DIAGRAM_MERMAID_TEXT_KEY);
    const positions = diagram.get(DIAGRAM_NODE_POSITIONS_KEY);
    if (!isBoundedIdentifier(name) || !isYText(mermaid) || !isYMap(positions)) return 'invalid_reserved_root';
    for (const [nodeId, position] of positions.entries()) {
      if (!isBoundedIdentifier(nodeId) || !isDiagramPosition(position)) return 'invalid_reserved_root';
    }
  }
  return undefined;
}

/** Checks root collection identities before repair can invoke typed Yjs accessors. */
export function validateReservedRootTypes(doc: Y.Doc): DocumentAdmission {
  const expected = [
    [DIAGRAMS_KEY, isReservedMapRoot],
    [DIAGRAM_ORDER_KEY, isReservedArrayRoot],
    [ACTIVITY_KEY, isReservedArrayRoot],
    [PRESENCE_KEY, isReservedMapRoot],
    [OVERLAYS_KEY, isReservedMapRoot],
  ] as const;
  for (const [key, validator] of expected) {
    const value = doc.share.get(key);
    if (value !== undefined && !validator(value)) return rejected('invalid_reserved_root');
  }
  return { accepted: true };
}

function validateReservedRootValues(doc: Y.Doc): DocumentAdmissionReason | undefined {
  const diagrams = doc.share.get(DIAGRAMS_KEY);
  if (diagrams !== undefined) {
    if (!isYMap(diagrams)) return 'invalid_reserved_root';
    const reason = validateDiagramCatalog(diagrams);
    if (reason) return reason;
  }
  const order = doc.share.get(DIAGRAM_ORDER_KEY);
  if (order !== undefined) {
    if (!isYArray(order) || order.length > COLLABORATION_BUDGETS.diagramsPerSession || order.toArray().some((id) => !isBoundedIdentifier(id))) return 'invalid_reserved_root';
  }
  const activity = doc.share.get(ACTIVITY_KEY);
  if (activity !== undefined) {
    if (!isYArray(activity) || activity.length > COLLABORATION_BUDGETS.activityEventsPerSession || activity.toArray().some((event) => !isActivityEvent(event))) return 'invalid_reserved_root';
  }
  const presence = doc.share.get(PRESENCE_KEY);
  if (presence !== undefined) {
    if (!isYMap(presence) || presence.size > COLLABORATION_BUDGETS.participantsPerSession) return 'invalid_reserved_root';
    for (const [name, participant] of presence.entries()) {
      if (!isBoundedIdentifier(name) || !isParticipant(participant) || participant.name !== name) return 'invalid_reserved_root';
    }
  }
  return undefined;
}

/**
 * Repairs only legacy/malformed v1 overlay entries while deliberately leaving
 * a newer version untouched. This runs on persisted load and after accepted
 * raw updates; admission itself always validates before the live document is
 * changed.
 */
export function repairOverlayDocument(doc: Y.Doc): boolean {
  const overlays = doc.share.get(OVERLAYS_KEY);
  if (overlays === undefined || !isYMap(overlays)) return false;
  let changed = false;
  const diagrams = doc.share.get(DIAGRAMS_KEY);
  const diagramIds = isYMap(diagrams) ? new Set(diagrams.keys()) : new Set<string>();
  for (const diagramId of [...diagramIds].sort()) {
    if (overlays.has(diagramId)) continue;
    const scene = new Y.Map<unknown>();
    scene.set('version', OVERLAY_SCHEMA_VERSION);
    scene.set('objects', new Y.Map<unknown>());
    overlays.set(diagramId, scene);
    changed = true;
  }
  const sceneEntries = [...overlays.entries()].sort(([left], [right]) => left.localeCompare(right));
  for (const [sceneId, rawScene] of sceneEntries) {
    if (diagramIds.size > 0 && !diagramIds.has(sceneId)) {
      overlays.delete(sceneId);
      changed = true;
      continue;
    }
    if (!isYMap(rawScene)) {
      overlays.delete(sceneId);
      changed = true;
      continue;
    }
    const version = rawScene.get('version');
    if (version === undefined) {
      rawScene.set('version', OVERLAY_SCHEMA_VERSION);
      changed = true;
    } else if (!Number.isInteger(version) || (version as number) < 1) {
      overlays.delete(sceneId);
      changed = true;
      continue;
    } else if ((version as number) > OVERLAY_SCHEMA_VERSION) {
      continue;
    }

    const existingObjects = rawScene.get('objects');
    const objects = isYMap(existingObjects) ? existingObjects : new Y.Map<unknown>();
    if (!isYMap(existingObjects)) {
      rawScene.set('objects', objects);
      changed = true;
    }
    const objectEntries = [...objects.entries()].sort(([left], [right]) => left.localeCompare(right));
    for (const [index, [objectId, object]] of objectEntries.entries()) {
      if (index >= COLLABORATION_BUDGETS.objectsPerScene || !objectId || validateOverlayObject(object)) {
        objects.delete(objectId);
        changed = true;
      }
    }
  }
  const retainedScenes = [...overlays.keys()].sort((left, right) => left.localeCompare(right));
  for (const sceneId of retainedScenes.slice(COLLABORATION_BUDGETS.diagramsPerSession)) {
    overlays.delete(sceneId);
    changed = true;
  }
  return changed;
}

/** Validates a complete candidate document without mutating it. */
export function validateDocumentState(doc: Y.Doc): DocumentAdmission {
  if (Y.encodeStateAsUpdate(doc).byteLength > COLLABORATION_BUDGETS.sessionStateBytes) {
    return rejected('document_state_too_large');
  }
  const rootTypes = validateReservedRootTypes(doc);
  if (!rootTypes.accepted) return rootTypes;
  const reservedRootReason = validateReservedRootValues(doc);
  if (reservedRootReason) return rejected(reservedRootReason);
  const counters: ValidationCounters = { textBytes: 0, values: 0, sharedTypes: 0 };
  const seen = new Set<object>();
  for (const root of doc.share.values()) {
    const reason = validateYType(root, counters, seen, 0);
    if (reason) return rejected(reason);
  }
  const overlayReason = validateOverlays(doc);
  return overlayReason ? rejected(overlayReason) : { accepted: true };
}

function truncateUtf8(text: string, maxBytes: number): number {
  let bytes = 0;
  let index = 0;
  for (const character of text) {
    const next = byteLength(character);
    if (bytes + next > maxBytes) break;
    bytes += next;
    index += character.length;
  }
  return index;
}

/** Deterministic authoritative normalization for valid offline edits whose CRDT merge exceeds the per-note bound. */
function repairMergedAnnotationBodies(doc: Y.Doc): boolean {
  const overlays = doc.share.get(OVERLAYS_KEY);
  if (!isYMap(overlays)) return false;
  let changed = false;
  for (const scene of overlays.values()) {
    if (!isYMap(scene) || scene.get('version') !== OVERLAY_SCHEMA_VERSION) continue;
    const objects = scene.get('objects');
    if (!isYMap(objects)) continue;
    for (const object of objects.values()) {
      if (!isYMap(object) || !['annotation.text', 'annotation.sticky'].includes(String(object.get('kind')))) continue;
      const body = object.get('body');
      if (!isYText(body)) continue;
      const text = body.toString();
      const keep = truncateUtf8(text, 8_192);
      if (keep < text.length) { body.delete(keep, text.length - keep); changed = true; }
    }
  }
  return changed;
}

/**
 * Applies an untrusted raw update to a disposable copy of the current state.
 * The caller may apply it to the live document only after this returns accepted.
 */
export function admitYjsUpdate(doc: Y.Doc, update: Uint8Array): DocumentAdmission {
  if (update.byteLength > COLLABORATION_BUDGETS.yjsUpdateBytes) return rejected('update_too_large');
  const current = Y.encodeStateAsUpdate(doc);
  if (current.byteLength > COLLABORATION_BUDGETS.sessionStateBytes) return rejected('document_state_too_large');
  const candidate = createReservedRootDocument();
  try {
    Y.applyUpdate(candidate, current);
    Y.applyUpdate(candidate, update);
    const repaired = repairMergedAnnotationBodies(candidate);
    const result = validateDocumentState(candidate);
    if (!result.accepted || !repaired) return result;
    // Full repaired state is intentional: an offline sender may not possess
    // structs already accepted from another peer, so a delta from server head
    // would leave that sender divergent even though it receives the deletion.
    return { accepted: true, normalizedUpdate: Y.encodeStateAsUpdate(candidate) };
  } catch {
    return rejected('malformed_yjs_update');
  } finally {
    candidate.destroy();
  }
}

/** Decodes persisted state only after the base64 and decoded byte budget agree. */
export function decodePersistedYjsState(encodedState: string): Uint8Array | Extract<DocumentAdmission, { accepted: false }> {
  if (typeof encodedState !== 'string') return rejected('malformed_yjs_update');
  const update = Buffer.from(encodedState, 'base64');
  if (update.byteLength > COLLABORATION_BUDGETS.sessionStateBytes) return rejected('document_state_too_large');
  if (update.toString('base64') !== encodedState) return rejected('malformed_yjs_update');
  return update;
}
