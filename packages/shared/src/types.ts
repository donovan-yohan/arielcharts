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

/**
 * Live canvas presence. Awareness transports this field only; it is never a
 * Yjs document value, activity entry, revision, or persisted session field.
 */
export interface CanvasAwarenessState {
  diagram_id: string;
  cursor?: CanvasWorldPoint;
  selected_node_ids?: string[];
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
