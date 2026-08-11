import { createHash } from 'node:crypto';
import type { DiagramNodePositions, OverlayLayerRecord, OverlayObjectRecord, OverlaySceneSnapshot, WorkspaceBundle, WorkspaceBundlePayload } from '@arielcharts/shared';
import * as Y from 'yjs';
import {
  DIAGRAM_MERMAID_TEXT_KEY,
  DIAGRAM_NAME_KEY,
  DIAGRAM_NODE_POSITIONS_KEY,
  DIAGRAM_ORDER_KEY,
  DIAGRAMS_KEY,
  OVERLAYS_KEY,
} from './constants.js';

export const MAX_WORKSPACE_BUNDLE_BYTES = 192 * 1024;
const MAX_DIAGRAMS = 64;
const MAX_NAME_BYTES = 256;
const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_OBJECTS_PER_SCENE = 200;
const MAX_LAYERS_PER_SCENE = 32;
const MAX_OBJECT_TEXT_BYTES = 8 * 1024;
const SUPPORTED_OVERLAY_KINDS = new Set([
  'foundation.card', 'annotation.text', 'annotation.sticky', 'ink.stroke',
  'shape.rectangle', 'shape.ellipse', 'shape.diamond', 'shape.line', 'shape.arrow',
  'connector.overlay', 'frame.section',
]);
const TEXT_OVERLAY_KINDS = new Set(['annotation.text', 'annotation.sticky', 'shape.rectangle', 'shape.ellipse', 'shape.diamond', 'shape.line', 'shape.arrow']);

export class WorkspaceImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceImportError';
  }
}

function bytes(value: string): number {
  return Buffer.byteLength(value, 'utf8');
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function onlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key)) && keys.every((key) => Object.hasOwn(value, key));
}

function allowsKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).every((key) => keys.includes(key));
}

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && bytes(value) <= MAX_NAME_BYTES;
}

function validCatalogId(value: unknown): value is string {
  return validId(value) && /^[A-Za-z0-9_-]+$/u.test(value);
}

function validPoint(value: unknown): value is { x: number; y: number } {
  return isPlainRecord(value) && typeof value.x === 'number' && Number.isFinite(value.x)
    && typeof value.y === 'number' && Number.isFinite(value.y);
}

function validMetadata(value: unknown): boolean {
  return isPlainRecord(value) && Object.keys(value).length <= 32 && Object.entries(value).every(([key, item]) => bytes(key) <= 128
    && (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)) || (typeof item === 'string' && bytes(item) <= 2_048)));
}

function validLayer(value: unknown): value is OverlayLayerRecord {
  if (!isPlainRecord(value) || !onlyKeys(value, ['id', 'name', 'order_key', 'visible', 'locked', 'export'])) return false;
  const layer = value as unknown as OverlayLayerRecord;
  return validId(layer.id) && typeof layer.name === 'string' && bytes(layer.name) <= 2_048 && validId(layer.order_key)
    && typeof layer.visible === 'boolean' && typeof layer.locked === 'boolean' && typeof layer.export === 'boolean';
}

function validOverlayObject(value: unknown, layerIds: Set<string>): value is OverlayObjectRecord {
  if (!isPlainRecord(value) || !allowsKeys(value, ['id', 'kind', 'version', 'order_key', 'geometry', 'anchor', 'layer', 'style', 'metadata', 'payload', 'body'])) return false;
  const object = value as unknown as OverlayObjectRecord;
  if (!validId(object.id) || !validId(object.kind) || !SUPPORTED_OVERLAY_KINDS.has(object.kind) || object.version !== 1 || !validId(object.order_key)
    || !isPlainRecord(object.geometry) || !validPoint(object.geometry) || typeof object.geometry.width !== 'number' || !Number.isFinite(object.geometry.width) || object.geometry.width < 0
    || typeof object.geometry.height !== 'number' || !Number.isFinite(object.geometry.height) || object.geometry.height < 0
    || typeof object.geometry.rotation !== 'number' || !Number.isFinite(object.geometry.rotation)
    || !validMetadata(object.style) || !validMetadata(object.metadata) || !isPlainRecord(object.payload)
    || (object.layer !== undefined && (!validId(object.layer) || !layerIds.has(object.layer)))
    || (object.body !== undefined && (typeof object.body !== 'string' || bytes(object.body) > MAX_OBJECT_TEXT_BYTES))) return false;
  if (object.anchor !== undefined && (!isPlainRecord(object.anchor) || !validId(object.anchor.mermaid_id) || !validPoint(object.anchor.offset) || !validPoint(object.anchor.fallback))) return false;
  return TEXT_OVERLAY_KINDS.has(object.kind) ? typeof object.body === 'string' : object.body === undefined;
}

function assertPayload(value: unknown): asserts value is WorkspaceBundlePayload {
  if (!isPlainRecord(value) || !onlyKeys(value, ['schema_version', 'order', 'diagrams']) || value.schema_version !== 1 || !Array.isArray(value.order) || !Array.isArray(value.diagrams)
    || value.diagrams.length === 0 || value.diagrams.length > MAX_DIAGRAMS) {
    throw new WorkspaceImportError('This is not a supported ArielCharts workspace bundle.');
  }
  const ids = new Set<string>();
  for (const candidate of value.diagrams) {
    if (!isPlainRecord(candidate) || !onlyKeys(candidate, ['id', 'name', 'mermaid', 'layout', 'overlay']) || !validCatalogId(candidate.id) || ids.has(candidate.id)
      || typeof candidate.name !== 'string' || !candidate.name.trim() || bytes(candidate.name) > MAX_NAME_BYTES) {
      throw new WorkspaceImportError('The workspace bundle has an invalid diagram catalog.');
    }
    ids.add(candidate.id);
    if (!isPlainRecord(candidate.mermaid) || !onlyKeys(candidate.mermaid, ['schema_version', 'source']) || candidate.mermaid.schema_version !== 1
      || typeof candidate.mermaid.source !== 'string' || bytes(candidate.mermaid.source) > MAX_SOURCE_BYTES) {
      throw new WorkspaceImportError('The workspace bundle has invalid Mermaid source.');
    }
    if (!isPlainRecord(candidate.layout) || !onlyKeys(candidate.layout, ['schema_version', 'positions']) || candidate.layout.schema_version !== 1 || !isPlainRecord(candidate.layout.positions)
      || !Object.entries(candidate.layout.positions).every(([id, position]) => validId(id) && validPoint(position))) {
      throw new WorkspaceImportError('The workspace bundle has invalid layout data.');
    }
    if (!isPlainRecord(candidate.overlay) || !onlyKeys(candidate.overlay, ['version', 'diagram_id', 'objects', 'layers']) || candidate.overlay.version !== 1
      || candidate.overlay.diagram_id !== candidate.id || !Array.isArray(candidate.overlay.objects) || candidate.overlay.objects.length > MAX_OBJECTS_PER_SCENE
      || !Array.isArray(candidate.overlay.layers) || candidate.overlay.layers.length === 0 || candidate.overlay.layers.length > MAX_LAYERS_PER_SCENE || !candidate.overlay.layers.every(validLayer)) {
      throw new WorkspaceImportError('The workspace bundle has invalid overlay data.');
    }
    const layerIds = new Set(candidate.overlay.layers.map((layer) => layer.id));
    const objectIds = new Set<string>();
    if (layerIds.size !== candidate.overlay.layers.length || !candidate.overlay.objects.every((object) => validOverlayObject(object, layerIds) && !objectIds.has(object.id) && (objectIds.add(object.id), true))) {
      throw new WorkspaceImportError('The workspace bundle has invalid overlay data.');
    }
  }
  if (value.order.length !== value.diagrams.length || new Set(value.order).size !== value.order.length || !value.order.every((id) => validCatalogId(id) && ids.has(id))) {
    throw new WorkspaceImportError('The workspace bundle has an invalid diagram order.');
  }
}

function canonicalize(value: unknown, depth = 0): unknown {
  if (depth > 24) throw new WorkspaceImportError('The workspace bundle is nested too deeply.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new WorkspaceImportError('The workspace bundle contains a non-finite number.');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, depth + 1));
  if (!isPlainRecord(value)) throw new WorkspaceImportError('The workspace bundle contains a non-JSON value.');
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key], depth + 1)]));
}

export function canonicalWorkspaceJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

/** Validates the full signed envelope before its payload can reach a live document. */
export function parseWorkspaceBundle(value: unknown): WorkspaceBundlePayload {
  if (!isPlainRecord(value) || !onlyKeys(value, ['format', 'version', 'payload', 'integrity']) || value.format !== 'arielcharts.workspace' || value.version !== 1) {
    throw new WorkspaceImportError('This file is not an ArielCharts workspace bundle.');
  }
  if (!isPlainRecord(value.integrity) || !onlyKeys(value.integrity, ['algorithm', 'value']) || value.integrity.algorithm !== 'SHA-256'
    || typeof value.integrity.value !== 'string' || !/^[a-f0-9]{64}$/u.test(value.integrity.value)) {
    throw new WorkspaceImportError('The workspace bundle integrity metadata is invalid.');
  }
  if (bytes(canonicalWorkspaceJson(value)) > MAX_WORKSPACE_BUNDLE_BYTES) {
    throw new WorkspaceImportError('The selected workspace bundle is too large.');
  }
  assertPayload(value.payload);
  const expected = createHash('sha256').update(canonicalWorkspaceJson(value.payload)).digest('hex');
  if (expected !== value.integrity.value) throw new WorkspaceImportError('The workspace bundle integrity check failed.');
  return structuredClone(value.payload);
}

/** Replaces only durable workspace roots. Callers preserve activity and presence roots. */
export function applyWorkspacePayload(doc: Y.Doc, payload: WorkspaceBundlePayload): void {
  const diagrams = doc.getMap<Y.Map<unknown>>(DIAGRAMS_KEY);
  const order = doc.getArray<string>(DIAGRAM_ORDER_KEY);
  const overlays = doc.getMap<Y.Map<unknown>>(OVERLAYS_KEY);
  for (const id of [...diagrams.keys()]) diagrams.delete(id);
  if (order.length) order.delete(0, order.length);
  for (const id of [...overlays.keys()]) overlays.delete(id);
  for (const snapshot of payload.diagrams) {
    const diagram = new Y.Map<unknown>();
    diagram.set(DIAGRAM_NAME_KEY, snapshot.name.trim().replace(/\s+/gu, ' ').slice(0, 120));
    diagram.set(DIAGRAM_MERMAID_TEXT_KEY, new Y.Text(snapshot.mermaid.source));
    const positions = new Y.Map<unknown>();
    for (const [id, position] of Object.entries(snapshot.layout.positions as DiagramNodePositions)) positions.set(id, { x: position.x, y: position.y });
    diagram.set(DIAGRAM_NODE_POSITIONS_KEY, positions);
    diagrams.set(snapshot.id, diagram);

    const scene = new Y.Map<unknown>();
    scene.set('version', snapshot.overlay.version);
    const objects = new Y.Map<Y.Map<unknown>>();
    for (const object of snapshot.overlay.objects) {
      const target = new Y.Map<unknown>();
      target.set('kind', object.kind); target.set('version', object.version); target.set('order_key', object.order_key);
      target.set('geometry', structuredClone(object.geometry)); if (object.anchor) target.set('anchor', structuredClone(object.anchor)); if (object.layer) target.set('layer', object.layer);
      target.set('style', structuredClone(object.style)); target.set('metadata', structuredClone(object.metadata)); target.set('payload', structuredClone(object.payload));
      if (object.body !== undefined) target.set('body', new Y.Text(object.body));
      objects.set(object.id, target);
    }
    scene.set('objects', objects);
    const layers = new Y.Map<Y.Map<unknown>>();
    for (const layer of snapshot.overlay.layers!) {
      const target = new Y.Map<unknown>();
      for (const [key, entry] of Object.entries(layer)) target.set(key, entry);
      layers.set(layer.id, target);
    }
    scene.set('layers', layers); overlays.set(snapshot.id, scene);
  }
  order.insert(0, payload.order);
}
