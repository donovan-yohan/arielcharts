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

export interface AwarenessState {
  user: Participant;
  cursor?: AwarenessCursor;
}

export interface ActivityEvent {
  id: string;
  timestamp: number;
  actor: {
    name: string;
    type: ParticipantType;
  };
  action: 'joined' | 'left' | 'edited' | 'replaced' | 'created' | 'renamed' | 'deleted';
  detail?: string;
  diagram_id?: string;
  base_revision?: string;
  result_revision?: string;
}

export interface DiagramSummary {
  id: string;
  name: string;
  revision: string;
}

export interface Diagram extends DiagramSummary {
  mermaid_text: string;
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
