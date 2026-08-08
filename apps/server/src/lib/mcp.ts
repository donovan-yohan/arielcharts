import type {
  CreateDiagramOutput,
  DeleteDiagramOutput,
  GetSessionOutput,
  ListDiagramsOutput,
  ListSessionsOutput,
  Participant,
  ReadDiagramOutput,
  RenameDiagramOutput,
  WriteDiagramOutput,
} from '@arielcharts/shared';
import { createActivityEvent } from './activity.js';
import { assertValidSessionId } from './session-id.js';
import type { SessionManager } from './session-manager.js';

const DEFAULT_AGENT_COLOR = '#7c3aed';
const DEFAULT_HUMAN_COLOR = '#2563eb';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`Expected non-empty string field: ${field}`);
  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') throw new Error(`Expected string field: ${field}`);
  return value;
}

function readParticipant(value: unknown): Participant {
  if (!isRecord(value)) throw new Error('Invalid participant payload.');
  const name = readNonEmptyString(value.name, 'participant.name');
  const color = readNonEmptyString(value.color, 'participant.color');
  if (value.type !== 'human' && value.type !== 'agent') throw new Error('Invalid participant type.');
  return { name, color, type: value.type };
}

function defaultParticipant(name: string, type: Participant['type']): Participant {
  return { name, color: type === 'agent' ? DEFAULT_AGENT_COLOR : DEFAULT_HUMAN_COLOR, type };
}

function metadata(input: Record<string, unknown>): { actorName: string; actorType: Participant['type']; detail: string; participants: Participant[] } {
  const actorName = typeof input.actor_name === 'string' && input.actor_name.trim() ? input.actor_name : 'mcp-agent';
  const actorType = input.actor_type === 'human' ? 'human' : 'agent';
  return {
    actorName,
    actorType,
    detail: typeof input.detail === 'string' ? input.detail : 'updated diagram',
    participants: Array.isArray(input.participants) ? input.participants.map(readParticipant) : [defaultParticipant(actorName, actorType)],
  };
}

function event(input: Record<string, unknown>, action: 'created' | 'replaced' | 'renamed' | 'deleted', diagramId: string) {
  const value = metadata(input);
  return {
    meta: value,
    event: { ...createActivityEvent({ action, actorName: value.actorName, actorType: value.actorType, detail: value.detail }), diagram_id: diagramId },
  };
}

function readSessionAndDiagram(input: Record<string, unknown>) {
  const sessionId = readNonEmptyString(input.session_id, 'session_id');
  const diagramId = readNonEmptyString(input.diagram_id, 'diagram_id');
  assertValidSessionId(sessionId);
  return { sessionId, diagramId };
}

export async function handleMcpToolCall(manager: SessionManager, payload: unknown): Promise<unknown> {
  if (!isRecord(payload)) throw new Error('Expected JSON object payload.');
  const tool = readNonEmptyString(payload.tool, 'tool');
  const input = payload.input === undefined ? {} : payload.input;
  if (!isRecord(input)) throw new Error('Expected object field: input');

  switch (tool) {
    case 'get_session': {
      const sessionId = readNonEmptyString(input.session_id, 'session_id');
      assertValidSessionId(sessionId);
      return manager.getSession(sessionId) satisfies Promise<GetSessionOutput>;
    }
    case 'list_diagrams': {
      const sessionId = readNonEmptyString(input.session_id, 'session_id');
      assertValidSessionId(sessionId);
      return manager.listDiagrams(sessionId) satisfies Promise<ListDiagramsOutput>;
    }
    case 'read_diagram': {
      const { sessionId, diagramId } = readSessionAndDiagram(input);
      return manager.readDiagram(sessionId, diagramId) satisfies Promise<ReadDiagramOutput>;
    }
    case 'create_diagram': {
      const sessionId = readNonEmptyString(input.session_id, 'session_id');
      const name = readNonEmptyString(input.name, 'name');
      const revision = readNonEmptyString(input.revision, 'revision');
      const mermaidText = input.mermaid_text === undefined ? '' : readString(input.mermaid_text, 'mermaid_text');
      assertValidSessionId(sessionId);
      const { meta, event: activityEvent } = event(input, 'created', 'pending');
      const diagram = await manager.createDiagram(sessionId, name, mermaidText, revision, activityEvent, meta.participants);
      return { diagram } satisfies CreateDiagramOutput;
    }
    case 'write_diagram': {
      const { sessionId, diagramId } = readSessionAndDiagram(input);
      const mermaidText = readString(input.mermaid_text, 'mermaid_text');
      const revision = readNonEmptyString(input.revision, 'revision');
      const name = input.name === undefined ? undefined : readNonEmptyString(input.name, 'name');
      const { meta, event: activityEvent } = event(input, 'replaced', diagramId);
      const diagram = await manager.writeDiagram(sessionId, diagramId, mermaidText, revision, activityEvent, meta.participants, name);
      return { diagram } satisfies WriteDiagramOutput;
    }
    case 'rename_diagram': {
      const { sessionId, diagramId } = readSessionAndDiagram(input);
      const name = readNonEmptyString(input.name, 'name');
      const revision = readNonEmptyString(input.revision, 'revision');
      const { meta, event: activityEvent } = event(input, 'renamed', diagramId);
      const diagram = await manager.renameDiagram(sessionId, diagramId, name, revision, activityEvent, meta.participants);
      return { diagram } satisfies RenameDiagramOutput;
    }
    case 'delete_diagram': {
      const { sessionId, diagramId } = readSessionAndDiagram(input);
      const revision = readNonEmptyString(input.revision, 'revision');
      const { meta, event: activityEvent } = event(input, 'deleted', diagramId);
      const nextRevision = await manager.deleteDiagram(sessionId, diagramId, revision, activityEvent, meta.participants);
      return { deleted: { id: diagramId }, revision: nextRevision } satisfies DeleteDiagramOutput;
    }
    case 'list_sessions': {
      const sessions = await manager.listSessions();
      return { sessions: sessions.map(({ id, title, participants }) => ({ id, title, participants })) } satisfies ListSessionsOutput;
    }
    default:
      throw new Error(`Unsupported MCP tool: ${tool}`);
  }
}

export type McpToolPayload =
  | { tool: 'get_session'; input: { session_id: string } }
  | { tool: 'list_diagrams'; input: { session_id: string } }
  | { tool: 'read_diagram'; input: { session_id: string; diagram_id: string } }
  | { tool: 'create_diagram'; input: { session_id: string; name: string; mermaid_text?: string; revision: string } }
  | { tool: 'write_diagram'; input: { session_id: string; diagram_id: string; mermaid_text: string; revision: string; name?: string } }
  | { tool: 'rename_diagram'; input: { session_id: string; diagram_id: string; name: string; revision: string } }
  | { tool: 'delete_diagram'; input: { session_id: string; diagram_id: string; revision: string } }
  | { tool: 'list_sessions'; input?: Record<string, never> };
