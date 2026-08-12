import type { StarterTemplateId } from './starter-templates.js';

export type ParticipantType = 'human' | 'agent';

export interface Participant {
  name: string;
  color: string;
  type: ParticipantType;
}

export interface AwarenessCursor {
  anchor: number;
  head: number;
}

/**
 * Ephemeral diagram-space position. This is intentionally separate from the
 * editor's `AwarenessCursor`, whose coordinates are CodeMirror offsets.
 */
export interface CanvasWorldPoint {
  x: number;
  y: number;
}

/** One bounded, ephemeral laser sample. Sequence is monotonic per browser connection. */
export interface CanvasLaserState {
  active: boolean;
  sequence: number;
  point?: CanvasWorldPoint;
}

/** A lossy, bounded in-progress ink sample. It is awareness-only, never durable. */
export interface CanvasInkPreviewState {
  active: boolean;
  sequence: number;
  mode?: 'pen' | 'highlighter';
  color?: string;
  width?: number;
  opacity?: number;
  points?: CanvasWorldPoint[];
}

export interface PresenterViewportState {
  pan_x: number;
  pan_y: number;
  zoom: number;
}

/** Bounded live presentation signal. Never persist this outside Awareness. */
export interface PresenterAwarenessState {
  active: boolean;
  sequence: number;
  diagram_id: string;
  viewport: PresenterViewportState;
  spotlight_sequence?: number;
}

/**
 * Live canvas presence. Awareness transports this field only; it is never a
 * Yjs document value, activity entry, revision, or persisted session field.
 */
export interface CanvasAwarenessState {
  diagram_id: string;
  cursor?: CanvasWorldPoint;
  laser?: CanvasLaserState;
  /** Non-authoritative preview only; finalized ink is an overlay object. */
  ink_preview?: CanvasInkPreviewState;
  selected_node_ids?: string[];
  /** A live advisory marker only; never a draft, lock, or durable value. */
  editing_node_id?: string;
}

export interface CanvasPresenceEntry {
  client_id: number;
  participant: Participant;
  canvas: CanvasAwarenessState;
}

export interface AwarenessState {
  user: Participant;
  cursor?: AwarenessCursor;
  canvas?: CanvasAwarenessState;
  presenter?: PresenterAwarenessState;
}

export interface ActivityEvent {
  id: string;
  timestamp: number;
  actor: {
    name: string;
    type: ParticipantType;
  };
  action: 'joined' | 'left' | 'edited' | 'replaced' | 'created' | 'renamed' | 'deleted' | 'restored';
  detail?: string;
  diagram_id?: string;
  base_revision?: string;
  result_revision?: string;
  restored_from_revision_id?: string;
}

export interface DiagramSummary {
  id: string;
  name: string;
  revision: string;
}

export interface Diagram extends DiagramSummary {
  mermaid_text: string;
}

export interface DiagramNodePosition {
  x: number;
  y: number;
}

export type DiagramNodePositions = Record<string, DiagramNodePosition>;

export const OVERLAY_SCENE_SCHEMA_VERSION = 1 as const;

export interface OverlayWorldPoint {
  x: number;
  y: number;
}

/** Renderer-neutral world geometry; camera transforms are never persisted here. */
export interface OverlayGeometry extends OverlayWorldPoint {
  width: number;
  height: number;
  rotation: number;
}

export interface OverlayMermaidAnchor {
  mermaid_id: string;
  offset: OverlayWorldPoint;
  /** Preserved placement used whenever the semantic Mermaid target is absent. */
  fallback: OverlayWorldPoint;
}

export type OverlayMetadataValue = string | number | boolean | null;
export type OverlayMetadata = Record<string, OverlayMetadataValue>;

export interface OverlayObjectRecord {
  id: string;
  kind: string;
  version: number;
  order_key: string;
  geometry: OverlayGeometry;
  anchor?: OverlayMermaidAnchor;
  layer?: string;
  style: OverlayMetadata;
  metadata: OverlayMetadata;
  payload: Record<string, unknown>;
  /** Plain-text projection of the durable Y.Text body for annotation kinds. */
  body?: string;
}

/** A renderer-neutral overlay layer. Mermaid never reads this state. */
export interface OverlayLayerRecord {
  id: string;
  name: string;
  order_key: string;
  visible: boolean;
  locked: boolean;
  /** Included only when a user explicitly chooses composite export. */
  export: boolean;
}

export interface OverlaySceneSnapshot {
  version: number;
  diagram_id: string;
  objects: OverlayObjectRecord[];
  /** Older v1 scenes without layers read as one visible default layer. */
  layers?: OverlayLayerRecord[];
}

/**
 * An MCP read never projects fields from an object version it does not own.
 * Its id/kind/version remain inspectable, while the raw server-derived
 * revision still includes every durable field so opaque data cannot vanish
 * from a concurrent-write check.
 */
export interface OpaqueOverlayObject {
  id: string;
  kind: string;
  version: number;
}

/**
 * Bounded, operation-oriented MCP projection. A newer scene, or a v1 scene
 * containing an opaque object, is explicitly read-only rather than being
 * represented as an empty or partially writable v1 scene.
 */
export interface McpOverlayScene {
  version: number;
  diagram_id: string;
  overlay_revision: string;
  writable: boolean;
  objects: OverlayObjectRecord[];
  opaque_objects: OpaqueOverlayObject[];
  layers?: OverlayLayerRecord[];
}

/** A bounded discovery row; full payloads are available only through readOverlayObject. */
export interface McpOverlayObjectSummary {
  id: string;
  kind: string;
  version: number;
  opaque: boolean;
  order_key?: string;
}

export interface McpOverlayObjectList {
  version: number;
  diagram_id: string;
  overlay_revision: string;
  writable: boolean;
  objects: McpOverlayObjectSummary[];
}

export type McpOverlayObjectRead =
  | { status: 'found'; overlay_revision: string; writable: boolean; object: OverlayObjectRecord }
  | { status: 'opaque'; overlay_revision: string; writable: false; object: OpaqueOverlayObject }
  | { status: 'missing'; overlay_revision: string; writable: boolean; object_id: string };

export type OverlayObjectPatch = Partial<Omit<OverlayObjectRecord, 'id' | 'kind' | 'version' | 'order_key'>>;

export interface ReadOverlaySceneInput {
  session_id: string;
  diagram_id: string;
}

export interface ReadOverlaySceneOutput {
  scene: McpOverlayScene;
}

export interface ListOverlayObjectsInput {
  session_id: string;
  diagram_id: string;
}

export interface ListOverlayObjectsOutput {
  scene: McpOverlayObjectList;
}

export interface ReadOverlayObjectInput {
  session_id: string;
  diagram_id: string;
  object_id: string;
}

export type ReadOverlayObjectOutput = McpOverlayObjectRead;

export interface CreateOverlayObjectInput {
  session_id: string;
  diagram_id: string;
  expected_overlay_revision: string;
  object: OverlayObjectRecord;
}

export interface UpdateOverlayObjectInput {
  session_id: string;
  diagram_id: string;
  object_id: string;
  expected_overlay_revision: string;
  patch: OverlayObjectPatch;
}

export interface ReorderOverlayObjectInput {
  session_id: string;
  diagram_id: string;
  object_id: string;
  expected_overlay_revision: string;
  direction: 'front' | 'back' | 'forward' | 'backward';
}

export interface DeleteOverlayObjectInput {
  session_id: string;
  diagram_id: string;
  object_id: string;
  expected_overlay_revision: string;
}

export type OverlayObjectMutationOutput =
  | { status: 'updated'; overlay_revision: string; object?: OverlayObjectRecord; deleted_object_id?: string }
  | { status: 'stale'; scene: McpOverlayScene };

export interface ListOverlayHistoryOutput {
  revisions: OverlayRevisionSummary[];
  current_revision: string;
}

export interface OverlayRevisionSummary {
  revision_id: string;
  sequence: number;
  diagram_id: string;
  timestamp: number;
  actor: { name: string; type: ParticipantType };
  action: 'baseline' | 'checkpoint' | 'restored';
  result_revision: string;
  restored_from_revision_id?: string;
}

export interface OverlayRevision extends OverlayRevisionSummary {
  scene: OverlaySceneSnapshot;
}

export interface WorkspaceSnapshotPair {
  mermaidRevisionId: string;
  overlayRevisionId: string;
}

/** Portable, signed workspace export. Activity, presence, and journals are deliberately excluded. */
export interface WorkspaceBundleDiagram {
  id: string;
  name: string;
  mermaid: { schema_version: 1; source: string };
  layout: { schema_version: 1; positions: DiagramNodePositions };
  overlay: OverlaySceneSnapshot;
}

export interface WorkspaceBundlePayload {
  schema_version: 1;
  order: string[];
  diagrams: WorkspaceBundleDiagram[];
}

export interface WorkspaceBundle {
  format: 'arielcharts.workspace';
  version: 1;
  payload: WorkspaceBundlePayload;
  integrity: { algorithm: 'SHA-256'; value: string };
}

/** The server-derived revision required to replace the complete workspace plane. */
export interface WorkspaceImportRevision {
  revision: string;
}

export type RestoreOverlayRevisionResult =
  | { status: 'restored'; scene: OverlaySceneSnapshot; revision: OverlayRevisionSummary }
  | { status: 'stale'; scene: OverlaySceneSnapshot; current_revision: string };

export type DiagramRevisionOrigin = 'browser' | 'mcp' | 'system';

export type DiagramRevisionAction = ActivityEvent['action'] | 'baseline' | 'checkpoint';

export interface DiagramRevisionSummary {
  revision_id: string;
  sequence: number;
  diagram_id: string;
  name: string;
  timestamp: number;
  actor: {
    name: string;
    type: ParticipantType;
  };
  origin: DiagramRevisionOrigin;
  action: DiagramRevisionAction;
  activity_id?: string;
  base_revision?: string;
  result_revision?: string;
  restored_from_revision_id?: string;
}

export interface DiagramRevision extends DiagramRevisionSummary {
  mermaid_text: string;
  node_positions: DiagramNodePositions;
}

export interface SessionSummary {
  id: string;
  title: string;
  participants: number;
}

export interface ReadDiagramInput {
  session_id: string;
  diagram_id: string;
}

export interface ReadDiagramOutput {
  diagram: Diagram;
  participants: Participant[];
}

export interface WriteDiagramInput {
  session_id: string;
  diagram_id: string;
  mermaid_text: string;
  revision: string;
  name?: string;
}

export interface WriteDiagramOutput {
  diagram: Diagram;
}

export interface ListDiagramsInput {
  session_id: string;
}

export interface ListDiagramsOutput {
  diagrams: DiagramSummary[];
  participants: Participant[];
  revision: string;
}

export interface ListDiagramHistoryInput {
  session_id: string;
  diagram_id: string;
}

export interface ListDiagramHistoryOutput {
  revisions: DiagramRevisionSummary[];
  current_revision: string;
}

export interface ReadDiagramRevisionInput {
  session_id: string;
  diagram_id: string;
  revision_id: string;
}

export type ReadDiagramRevisionOutput = DiagramRevision;

export interface RestoreDiagramRevisionInput {
  session_id: string;
  diagram_id: string;
  revision_id: string;
  expected_revision: string;
}

export type RestoreDiagramRevisionResult =
  | {
    status: 'restored';
    diagram: Diagram;
    revision: DiagramRevisionSummary;
  }
  | {
    status: 'stale';
    current: Diagram;
    current_revision: string;
  };

export type CreateDiagramInput = {
  session_id: string;
  name: string;
  revision: string;
} & (
  | { mermaid_text: string; template_id?: never }
  | { template_id: StarterTemplateId; mermaid_text?: never }
);

export interface CreateDiagramOutput {
  diagram: Diagram;
}

export interface RenameDiagramInput {
  session_id: string;
  diagram_id: string;
  name: string;
  revision: string;
}

export interface RenameDiagramOutput {
  diagram: Diagram;
}

export interface DeleteDiagramInput {
  session_id: string;
  diagram_id: string;
  revision: string;
}

export interface DeleteDiagramOutput {
  deleted: { id: string };
  revision: string;
}

export interface GetSessionInput {
  session_id: string;
}

export interface GetSessionOutput {
  session_id: string;
  diagrams: DiagramSummary[];
  participants: Participant[];
  revision: string;
}

export interface ListSessionsOutput {
  sessions: SessionSummary[];
}
