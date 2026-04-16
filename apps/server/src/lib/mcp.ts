import type { ListSessionsOutput, Participant, ReadDiagramInput, ReadDiagramOutput, WriteDiagramInput, WriteDiagramOutput } from '@mermaidflow/shared';
import { createActivityEvent } from './activity.js';
import { assertValidSessionId } from './session-id.js';
import type { SessionManager } from './session-manager.js';

const DEFAULT_AGENT_COLOR = '#7c3aed';
const DEFAULT_HUMAN_COLOR = '#2563eb';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readNonEmptyString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new Error(`Expected non-empty string field: ${field}`);
  }

  return value;
}

function readString(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new Error(`Expected string field: ${field}`);
  }

  return value;
}

function readParticipant(value: unknown): Participant {
  if (!isRecord(value)) {
    throw new Error('Invalid participant payload.');
  }

  const name = readNonEmptyString(value.name, 'participant.name');
  const color = readNonEmptyString(value.color, 'participant.color');
  const type = value.type;

  if (type !== 'human' && type !== 'agent') {
    throw new Error('Invalid participant type.');
  }

  return { name, color, type };
}

function defaultParticipant(name: string, type: Participant['type']): Participant {
  return {
    name,
    color: type === 'agent' ? DEFAULT_AGENT_COLOR : DEFAULT_HUMAN_COLOR,
    type,
  };
}

export async function handleMcpToolCall(manager: SessionManager, payload: unknown): Promise<unknown> {
  if (!isRecord(payload)) {
    throw new Error('Expected JSON object payload.');
  }

  const tool = readNonEmptyString(payload.tool, 'tool');
  const input = payload.input === undefined ? {} : payload.input;

  if (!isRecord(input)) {
    throw new Error('Expected object field: input');
  }

  switch (tool) {
    case 'read_diagram': {
      const sessionId = readNonEmptyString(input.session_id, 'session_id');
      assertValidSessionId(sessionId);
      const snapshot = await manager.readSession(sessionId);
      if (!snapshot) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      const output: ReadDiagramOutput = {
        mermaid_text: snapshot.mermaidText,
        participants: snapshot.participants,
      };
      return output;
    }

    case 'write_diagram': {
      const sessionId = readNonEmptyString(input.session_id, 'session_id');
      const mermaidText = readString(input.mermaid_text, 'mermaid_text');
      const actorName = typeof input.actor_name === 'string' && input.actor_name.trim().length > 0 ? input.actor_name : 'mcp-agent';
      const actorType = input.actor_type === 'human' ? 'human' : 'agent';
      const detail = typeof input.detail === 'string' ? input.detail : 'updated diagram text';
      const participants = Array.isArray(input.participants)
        ? input.participants.map(readParticipant)
        : [defaultParticipant(actorName, actorType)];

      assertValidSessionId(sessionId);
      const event = createActivityEvent({
        action: 'replaced',
        actorName,
        actorType,
        detail,
      });

      await manager.writeDiagram(sessionId, mermaidText, event, participants);
      const output: WriteDiagramOutput = { success: true };
      return output;
    }

    case 'list_sessions': {
      const sessions = await manager.listSessions();
      const output: ListSessionsOutput = {
        sessions: sessions.map(({ id, title, participants }) => ({ id, title, participants })),
      };
      return output;
    }

    default:
      throw new Error(`Unsupported MCP tool: ${tool}`);
  }
}

export type McpToolPayload =
  | { tool: 'read_diagram'; input: ReadDiagramInput }
  | { tool: 'write_diagram'; input: WriteDiagramInput & { actor_name?: string; actor_type?: 'human' | 'agent'; detail?: string; participants?: Participant[] } }
  | { tool: 'list_sessions'; input?: Record<string, never> };
