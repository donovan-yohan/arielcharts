import type { OverlayLayerRecord, OverlayObjectRecord, OverlaySceneSnapshot, WorkspaceBundle, WorkspaceBundleDiagram, WorkspaceBundlePayload } from '@arielcharts/shared';
export type { WorkspaceBundle, WorkspaceBundleDiagram, WorkspaceBundlePayload } from '@arielcharts/shared';
import * as Y from 'yjs';
import { isNodePosition, type DiagramNodePositions } from './diagram-layout';
import { defaultOverlayLayer, getOverlayScene, isSupportedOverlayObject, readOverlayScene } from './overlay-scene';

export const WORKSPACE_BUNDLE_VERSION = 1 as const;
export const WORKSPACE_BUNDLE_MIME = 'application/vnd.arielcharts.workspace+json';
export const WORKSPACE_BUNDLE_EXTENSION = '.arielcharts';
/** v1 deliberately uses bounded plain JSON; there is no decompressor attack surface. */
export const MAX_WORKSPACE_BUNDLE_BYTES = 192 * 1024;
const MAX_DIAGRAMS = 64;
const MAX_NAME_BYTES = 256;
const MAX_SOURCE_BYTES = 64 * 1024;
const MAX_OBJECTS_PER_SCENE = 200;
const MAX_LAYERS_PER_SCENE = 32;

export class WorkspaceBundleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WorkspaceBundleError';
  }
}

function bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
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

function canonicalize(value: unknown, depth = 0): unknown {
  if (depth > 24) throw new WorkspaceBundleError('The workspace bundle is nested too deeply.');
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new WorkspaceBundleError('The workspace bundle contains a non-finite number.');
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => canonicalize(item, depth + 1));
  if (!isPlainRecord(value)) throw new WorkspaceBundleError('The workspace bundle contains a non-JSON value.');
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key], depth + 1)])) as Record<string, unknown>;
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

async function sha256(value: string): Promise<string> {
  if (!globalThis.crypto?.subtle) throw new WorkspaceBundleError('Secure hashing is unavailable in this browser.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function clonePositions(value: Y.Map<unknown>): DiagramNodePositions {
  const positions: DiagramNodePositions = Object.create(null) as DiagramNodePositions;
  for (const [id, position] of value.entries()) {
    if (validId(id) && isNodePosition(position)) positions[id] = { x: position.x, y: position.y };
  }
  return positions;
}

/** Snapshots only the durable user-authored workspace plane; presence and journals stay out. */
export function snapshotWorkspaceBundle(doc: Y.Doc): WorkspaceBundlePayload {
  const diagrams = doc.getMap<Y.Map<unknown>>('diagrams');
  const order = doc.getArray<string>('diagramOrder').toArray().filter((id, index, ids) => validCatalogId(id) && ids.indexOf(id) === index && diagrams.has(id));
  const remaining = [...diagrams.keys()].filter((id) => validCatalogId(id) && !order.includes(id)).sort();
  const stableOrder = [...order, ...remaining];
  const result: WorkspaceBundleDiagram[] = [];
  for (const id of stableOrder) {
    const diagram = diagrams.get(id);
    const name = diagram?.get('name');
    const mermaid = diagram?.get('mermaid');
    const nodePositions = diagram?.get('nodePositions');
    if (!diagram || typeof name !== 'string' || !(mermaid instanceof Y.Text) || !(nodePositions instanceof Y.Map)) {
      throw new WorkspaceBundleError('The live diagram catalog is incomplete and cannot be exported safely.');
    }
    const sceneHandle = getOverlayScene(doc, id);
    if (sceneHandle && !sceneHandle.writable) throw new WorkspaceBundleError('A newer overlay schema is open read-only and cannot be exported as an editable workspace.');
    result.push({
      id,
      name,
      mermaid: { schema_version: 1, source: mermaid.toString() },
      layout: { schema_version: 1, positions: clonePositions(nodePositions) },
      overlay: structuredClone(readOverlayScene(doc, id)),
    });
  }
  return { diagrams: result, order: result.map(({ id }) => id), schema_version: 1 };
}

export async function encodeWorkspaceBundle(payload: WorkspaceBundlePayload): Promise<string> {
  assertWorkspacePayload(payload);
  const integrity = await sha256(canonicalJson(payload));
  const bundle: WorkspaceBundle = { format: 'arielcharts.workspace', version: WORKSPACE_BUNDLE_VERSION, payload, integrity: { algorithm: 'SHA-256', value: integrity } };
  const encoded = canonicalJson(bundle);
  if (bytes(encoded) > MAX_WORKSPACE_BUNDLE_BYTES) throw new WorkspaceBundleError('The editable workspace is too large to export safely.');
  return encoded;
}

function validMetadata(value: unknown): boolean {
  if (!isPlainRecord(value) || Object.keys(value).length > 32) return false;
  return Object.entries(value).every(([key, item]) => bytes(key) <= 128 && (item === null || typeof item === 'boolean' || (typeof item === 'number' && Number.isFinite(item)) || (typeof item === 'string' && bytes(item) <= 2_048)));
}

function validPoint(value: unknown): boolean {
  return isPlainRecord(value) && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y);
}

function validOverlayObject(value: unknown, layerIds: Set<string>): value is OverlayObjectRecord {
  if (!isPlainRecord(value) || !allowsKeys(value, ['id', 'kind', 'version', 'order_key', 'geometry', 'anchor', 'layer', 'style', 'metadata', 'payload', 'body'])) return false;
  const object = value as unknown as OverlayObjectRecord;
  if (!validId(object.id) || !validId(object.kind) || !Number.isInteger(object.version) || object.version < 1 || !validId(object.order_key)
    || !isPlainRecord(object.geometry) || !validPoint(object.geometry) || typeof object.geometry.width !== 'number' || !Number.isFinite(object.geometry.width) || object.geometry.width < 0 || typeof object.geometry.height !== 'number' || !Number.isFinite(object.geometry.height) || object.geometry.height < 0 || typeof object.geometry.rotation !== 'number' || !Number.isFinite(object.geometry.rotation)
    || !validMetadata(object.style) || !validMetadata(object.metadata) || !isPlainRecord(object.payload)
    || (object.layer !== undefined && (!validId(object.layer) || !layerIds.has(object.layer)))
    || (object.body !== undefined && (typeof object.body !== 'string' || bytes(object.body) > 8_192))) return false;
  if (object.anchor !== undefined && (!isPlainRecord(object.anchor) || !validId(object.anchor.mermaid_id) || !validPoint(object.anchor.offset) || !validPoint(object.anchor.fallback))) return false;
  if ((object.kind.startsWith('annotation.') || object.kind.startsWith('shape.')) && typeof object.body !== 'string') return false;
  return isSupportedOverlayObject(object);
}

function validLayer(value: unknown): value is OverlayLayerRecord {
  if (!isPlainRecord(value) || !onlyKeys(value, ['id', 'name', 'order_key', 'visible', 'locked', 'export'])) return false;
  const layer = value as unknown as OverlayLayerRecord;
  return validId(layer.id) && typeof layer.name === 'string' && bytes(layer.name) <= 2_048 && validId(layer.order_key)
    && typeof layer.visible === 'boolean' && typeof layer.locked === 'boolean' && typeof layer.export === 'boolean';
}

function validScene(value: unknown, diagramId: string): value is OverlaySceneSnapshot {
  if (!isPlainRecord(value) || !onlyKeys(value, ['version', 'diagram_id', 'objects', 'layers'])) return false;
  const scene = value as unknown as OverlaySceneSnapshot;
  if (!Number.isInteger(scene.version) || scene.version < 1 || scene.version > 1 || scene.diagram_id !== diagramId || !Array.isArray(scene.objects) || scene.objects.length > MAX_OBJECTS_PER_SCENE) return false;
  const layers = scene.layers ?? [defaultOverlayLayer()];
  if (!Array.isArray(layers) || layers.length === 0 || layers.length > MAX_LAYERS_PER_SCENE || !layers.every(validLayer)) return false;
  const ids = new Set(layers.map(({ id }) => id));
  return ids.size === layers.length && scene.objects.every((object) => validOverlayObject(object, ids));
}

export function assertWorkspacePayload(value: unknown): asserts value is WorkspaceBundlePayload {
  if (!isPlainRecord(value) || !onlyKeys(value, ['schema_version', 'order', 'diagrams']) || value.schema_version !== 1 || !Array.isArray(value.order) || !Array.isArray(value.diagrams) || value.diagrams.length > MAX_DIAGRAMS) throw new WorkspaceBundleError('This is not a supported ArielCharts workspace bundle.');
  const ids = new Set<string>();
  for (const diagram of value.diagrams) {
    if (!isPlainRecord(diagram) || !onlyKeys(diagram, ['id', 'name', 'mermaid', 'layout', 'overlay']) || !validCatalogId(diagram.id) || ids.has(diagram.id) || typeof diagram.name !== 'string' || bytes(diagram.name) > MAX_NAME_BYTES) throw new WorkspaceBundleError('The workspace bundle has an invalid diagram catalog.');
    ids.add(diagram.id);
    if (!isPlainRecord(diagram.mermaid) || !onlyKeys(diagram.mermaid, ['schema_version', 'source']) || diagram.mermaid.schema_version !== 1 || typeof diagram.mermaid.source !== 'string' || bytes(diagram.mermaid.source) > MAX_SOURCE_BYTES) throw new WorkspaceBundleError('The workspace bundle has invalid Mermaid source.');
    if (!isPlainRecord(diagram.layout) || !onlyKeys(diagram.layout, ['schema_version', 'positions']) || diagram.layout.schema_version !== 1 || !isPlainRecord(diagram.layout.positions) || !Object.entries(diagram.layout.positions).every(([id, position]) => validId(id) && isNodePosition(position))) throw new WorkspaceBundleError('The workspace bundle has invalid layout data.');
    if (!validScene(diagram.overlay, diagram.id)) throw new WorkspaceBundleError('The workspace bundle has invalid overlay data.');
  }
  if (value.order.length !== value.diagrams.length || new Set(value.order).size !== value.order.length || !value.order.every((id) => validCatalogId(id) && ids.has(id))) throw new WorkspaceBundleError('The workspace bundle has an invalid diagram order.');
}

export async function decodeWorkspaceBundleEnvelope(encoded: string): Promise<WorkspaceBundle> {
  if (bytes(encoded) > MAX_WORKSPACE_BUNDLE_BYTES) throw new WorkspaceBundleError('The selected workspace bundle is too large.');
  let raw: unknown;
  try { raw = JSON.parse(encoded); } catch { throw new WorkspaceBundleError('The selected file is not valid JSON.'); }
  if (!isPlainRecord(raw) || !onlyKeys(raw, ['format', 'version', 'payload', 'integrity']) || raw.format !== 'arielcharts.workspace') throw new WorkspaceBundleError('This file is not an ArielCharts workspace bundle.');
  if (raw.version !== WORKSPACE_BUNDLE_VERSION) throw new WorkspaceBundleError('This workspace bundle was created by a newer ArielCharts version and was not imported.');
  if (!isPlainRecord(raw.integrity) || !onlyKeys(raw.integrity, ['algorithm', 'value']) || raw.integrity.algorithm !== 'SHA-256' || typeof raw.integrity.value !== 'string' || !/^[a-f0-9]{64}$/u.test(raw.integrity.value)) throw new WorkspaceBundleError('The workspace bundle integrity metadata is invalid.');
  assertWorkspacePayload(raw.payload);
  if (await sha256(canonicalJson(raw.payload)) !== raw.integrity.value) throw new WorkspaceBundleError('The workspace bundle integrity check failed.');
  return structuredClone(raw) as unknown as WorkspaceBundle;
}

export async function decodeWorkspaceBundle(encoded: string): Promise<WorkspaceBundlePayload> {
  return (await decodeWorkspaceBundleEnvelope(encoded)).payload;
}

export function safeDownloadStem(name: string): string {
  const stem = name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/gu, '-').replace(/^-+|-+$/gu, '').slice(0, 80).toLowerCase();
  return stem || 'arielcharts-workspace';
}

export function downloadText(filename: string, type: string, content: string): void {
  downloadBlob(filename, new Blob([content], { type }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.rel = 'noopener';
  document.body.append(anchor); anchor.click();
  window.setTimeout(() => {
    anchor.remove();
    URL.revokeObjectURL(url);
  }, 1_000);
}

export function sourceDownload(name: string, source: string): void {
  downloadText(`${safeDownloadStem(name)}.mmd`, 'text/vnd.mermaid; charset=utf-8', source);
}
