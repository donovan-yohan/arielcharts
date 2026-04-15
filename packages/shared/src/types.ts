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
  action: 'joined' | 'left' | 'edited' | 'replaced';
  detail?: string;
}

export interface SessionSummary {
  id: string;
  title: string;
  participants: number;
}

export interface ReadDiagramInput {
  session_id: string;
}

export interface ReadDiagramOutput {
  mermaid_text: string;
  participants: Participant[];
}

export interface WriteDiagramInput {
  session_id: string;
  mermaid_text: string;
}

export interface WriteDiagramOutput {
  success: boolean;
}

export interface ListSessionsOutput {
  sessions: SessionSummary[];
}
