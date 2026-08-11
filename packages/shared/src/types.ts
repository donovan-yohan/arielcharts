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
