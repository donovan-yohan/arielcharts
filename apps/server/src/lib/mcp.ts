import type {
  CreateDiagramInput,
  CreateDiagramOutput,
  DeleteDiagramOutput,
  GetSessionOutput,
  ListDiagramsOutput,
  OverlayObjectPatch,
  OverlayObjectRecord,
  Participant,
  ReadDiagramOutput,
  RenameDiagramOutput,
  WriteDiagramOutput,
} from '@arielcharts/shared';
import { ALL_STARTER_TEMPLATES, getStarterTemplate } from '@arielcharts/shared';
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

function readFiniteNumber(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`Expected finite number field: ${field}`);
  return value;
}

function readRecord(value: unknown, field: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`Expected object field: ${field}`);
  return structuredClone(value);
}

function readOverlayObject(value: unknown, field: string): OverlayObjectRecord {
  const object = readRecord(value, field);
  const geometry = readRecord(object.geometry, `${field}.geometry`);
  const record: OverlayObjectRecord = {
    id: readNonEmptyString(object.id, `${field}.id`),
    kind: readNonEmptyString(object.kind, `${field}.kind`),
    version: readFiniteNumber(object.version, `${field}.version`),
    order_key: readNonEmptyString(object.order_key, `${field}.order_key`),
    geometry: {
      x: readFiniteNumber(geometry.x, `${field}.geometry.x`),
      y: readFiniteNumber(geometry.y, `${field}.geometry.y`),
      width: readFiniteNumber(geometry.width, `${field}.geometry.width`),
      height: readFiniteNumber(geometry.height, `${field}.geometry.height`),
      rotation: readFiniteNumber(geometry.rotation, `${field}.geometry.rotation`),
    },
    style: readRecord(object.style, `${field}.style`) as OverlayObjectRecord['style'],
    metadata: readRecord(object.metadata, `${field}.metadata`) as OverlayObjectRecord['metadata'],
    payload: readRecord(object.payload, `${field}.payload`),
  };
  if (object.anchor !== undefined) {
    const anchor = readRecord(object.anchor, `${field}.anchor`);
    const offset = readRecord(anchor.offset, `${field}.anchor.offset`); const fallback = readRecord(anchor.fallback, `${field}.anchor.fallback`);
    record.anchor = {
      mermaid_id: readNonEmptyString(anchor.mermaid_id, `${field}.anchor.mermaid_id`),
      offset: { x: readFiniteNumber(offset.x, `${field}.anchor.offset.x`), y: readFiniteNumber(offset.y, `${field}.anchor.offset.y`) },
      fallback: { x: readFiniteNumber(fallback.x, `${field}.anchor.fallback.x`), y: readFiniteNumber(fallback.y, `${field}.anchor.fallback.y`) },
    };
  }
  if (object.layer !== undefined) record.layer = readNonEmptyString(object.layer, `${field}.layer`);
  if (object.body !== undefined) record.body = readString(object.body, `${field}.body`);
  return record;
}

const OVERLAY_PATCH_KEYS = new Set(['geometry', 'anchor', 'layer', 'style', 'metadata', 'payload', 'body']);

function readOverlayPatch(value: unknown, field: string): OverlayObjectPatch {
  const raw = readRecord(value, field);
  const keys = Object.keys(raw);
  if (keys.length === 0 || keys.some((key) => !OVERLAY_PATCH_KEYS.has(key))) throw new Error(`Invalid overlay patch fields: ${field}`);
  const patch: OverlayObjectPatch = {};
  if ('geometry' in raw) {
    const geometry = readRecord(raw.geometry, `${field}.geometry`);
    patch.geometry = {
      x: readFiniteNumber(geometry.x, `${field}.geometry.x`), y: readFiniteNumber(geometry.y, `${field}.geometry.y`),
      width: readFiniteNumber(geometry.width, `${field}.geometry.width`), height: readFiniteNumber(geometry.height, `${field}.geometry.height`),
      rotation: readFiniteNumber(geometry.rotation, `${field}.geometry.rotation`),
    };
  }
  if ('anchor' in raw) {
    const anchor = readRecord(raw.anchor, `${field}.anchor`);
    const offset = readRecord(anchor.offset, `${field}.anchor.offset`); const fallback = readRecord(anchor.fallback, `${field}.anchor.fallback`);
    patch.anchor = {
      mermaid_id: readNonEmptyString(anchor.mermaid_id, `${field}.anchor.mermaid_id`),
      offset: { x: readFiniteNumber(offset.x, `${field}.anchor.offset.x`), y: readFiniteNumber(offset.y, `${field}.anchor.offset.y`) },
      fallback: { x: readFiniteNumber(fallback.x, `${field}.anchor.fallback.x`), y: readFiniteNumber(fallback.y, `${field}.anchor.fallback.y`) },
    };
  }
  if ('layer' in raw) patch.layer = readNonEmptyString(raw.layer, `${field}.layer`);
  if ('style' in raw) patch.style = readRecord(raw.style, `${field}.style`) as OverlayObjectRecord['style'];
  if ('metadata' in raw) patch.metadata = readRecord(raw.metadata, `${field}.metadata`) as OverlayObjectRecord['metadata'];
  if ('payload' in raw) patch.payload = readRecord(raw.payload, `${field}.payload`);
  if ('body' in raw) patch.body = readString(raw.body, `${field}.body`);
  return patch;
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

function event(input: Record<string, unknown>, action: 'created' | 'replaced' | 'renamed' | 'deleted' | 'restored', diagramId: string) {
  const value = metadata(input);
  return {
    meta: value,
    event: { ...createActivityEvent({ action, actorName: value.actorName, actorType: value.actorType, detail: value.detail }), diagram_id: diagramId },
  };
}

function assertAuthorizedSession(sessionId: string, authorizedSessionId: string): void {
  if (sessionId !== authorizedSessionId) throw new Error('Room access denied.');
}

function readSessionAndDiagram(input: Record<string, unknown>, authorizedSessionId: string) {
  const sessionId = readNonEmptyString(input.session_id, 'session_id');
  const diagramId = readNonEmptyString(input.diagram_id, 'diagram_id');
  assertValidSessionId(sessionId);
  assertAuthorizedSession(sessionId, authorizedSessionId);
  return { sessionId, diagramId };
}

function readHistoryTarget(input: Record<string, unknown>, authorizedSessionId: string) {
  const { sessionId, diagramId } = readSessionAndDiagram(input, authorizedSessionId);
  const revisionId = readNonEmptyString(input.revision_id, 'revision_id');
  return { sessionId, diagramId, revisionId };
}

const STARTER_TEMPLATE_IDS = ALL_STARTER_TEMPLATES.map((template) => template.id).join(', ');

function readCreateDiagramSource(input: Record<string, unknown>): string {
  const hasMermaidText = input.mermaid_text !== undefined;
  const hasTemplateId = input.template_id !== undefined;
  if (hasMermaidText === hasTemplateId) {
    throw new Error('Expected exactly one of mermaid_text or template_id.');
  }

  if (hasMermaidText) {
    return readString(input.mermaid_text, 'mermaid_text');
  }

  const templateId = readString(input.template_id, 'template_id');
  const template = getStarterTemplate(templateId);
  if (!template) {
    throw new Error(`Invalid template_id "${templateId}". Expected one of: ${STARTER_TEMPLATE_IDS}.`);
  }
  return template.source;
}

export async function handleMcpToolCall(manager: SessionManager, payload: unknown, authorizedSessionId: string): Promise<unknown> {
  if (!isRecord(payload)) throw new Error('Expected JSON object payload.');
  const tool = readNonEmptyString(payload.tool, 'tool');
  const input = payload.input === undefined ? {} : payload.input;
  if (!isRecord(input)) throw new Error('Expected object field: input');

  switch (tool) {
    case 'get_session': {
      const sessionId = readNonEmptyString(input.session_id, 'session_id');
      assertValidSessionId(sessionId);
      assertAuthorizedSession(sessionId, authorizedSessionId);
      return manager.getSession(sessionId) satisfies Promise<GetSessionOutput>;
    }
    case 'list_diagrams': {
      const sessionId = readNonEmptyString(input.session_id, 'session_id');
      assertValidSessionId(sessionId);
      assertAuthorizedSession(sessionId, authorizedSessionId);
      return manager.listDiagrams(sessionId) satisfies Promise<ListDiagramsOutput>;
    }
    case 'read_diagram': {
      const { sessionId, diagramId } = readSessionAndDiagram(input, authorizedSessionId);
      return manager.readDiagram(sessionId, diagramId) satisfies Promise<ReadDiagramOutput>;
    }
    case 'read_overlay_scene': {
      const { sessionId, diagramId } = readSessionAndDiagram(input, authorizedSessionId);
      return manager.readMcpOverlayScene(sessionId, diagramId);
    }
    case 'list_overlay_scene': {
      const { sessionId, diagramId } = readSessionAndDiagram(input, authorizedSessionId);
      return manager.listMcpOverlayObjects(sessionId, diagramId);
    }
    case 'read_overlay_object': {
      const { sessionId, diagramId } = readSessionAndDiagram(input, authorizedSessionId);
      const objectId = readNonEmptyString(input.object_id, 'object_id');
      return manager.readMcpOverlayObject(sessionId, diagramId, objectId);
    }
    case 'create_overlay_object': {
      const { sessionId, diagramId } = readSessionAndDiagram(input, authorizedSessionId);
      const expectedRevision = readNonEmptyString(input.expected_overlay_revision, 'expected_overlay_revision');
      const object = readOverlayObject(input.object, 'object');
      const { meta } = event(input, 'replaced', diagramId);
      return manager.createMcpOverlayObject(sessionId, diagramId, expectedRevision, object, meta.participants);
    }
    case 'update_overlay_object': {
      const { sessionId, diagramId } = readSessionAndDiagram(input, authorizedSessionId);
      const objectId = readNonEmptyString(input.object_id, 'object_id');
      const expectedRevision = readNonEmptyString(input.expected_overlay_revision, 'expected_overlay_revision');
      const patch = readOverlayPatch(input.patch, 'patch');
      const { meta } = event(input, 'replaced', diagramId);
      return manager.updateMcpOverlayObject(sessionId, diagramId, objectId, expectedRevision, patch, meta.participants);
    }
    case 'reorder_overlay_object': {
      const { sessionId, diagramId } = readSessionAndDiagram(input, authorizedSessionId);
      const objectId = readNonEmptyString(input.object_id, 'object_id');
      const expectedRevision = readNonEmptyString(input.expected_overlay_revision, 'expected_overlay_revision');
      if (input.direction !== 'front' && input.direction !== 'back' && input.direction !== 'forward' && input.direction !== 'backward') {
        throw new Error('Invalid overlay reorder direction.');
      }
      const { meta } = event(input, 'replaced', diagramId);
      return manager.reorderMcpOverlayObject(sessionId, diagramId, objectId, expectedRevision, input.direction, meta.participants);
    }
    case 'delete_overlay_object': {
      const { sessionId, diagramId } = readSessionAndDiagram(input, authorizedSessionId);
      const objectId = readNonEmptyString(input.object_id, 'object_id');
      const expectedRevision = readNonEmptyString(input.expected_overlay_revision, 'expected_overlay_revision');
      const { meta } = event(input, 'replaced', diagramId);
      return manager.deleteMcpOverlayObject(sessionId, diagramId, objectId, expectedRevision, meta.participants);
    }
    case 'list_diagram_history': {
      const { sessionId, diagramId } = readSessionAndDiagram(input, authorizedSessionId);
      return manager.listDiagramHistory(sessionId, diagramId);
    }
    case 'read_diagram_revision': {
      const { sessionId, diagramId, revisionId } = readHistoryTarget(input, authorizedSessionId);
      return manager.readDiagramRevision(sessionId, diagramId, revisionId);
    }
    case 'create_diagram': {
      const mermaidText = readCreateDiagramSource(input);
      const sessionId = readNonEmptyString(input.session_id, 'session_id');
      const name = readNonEmptyString(input.name, 'name');
      const revision = readNonEmptyString(input.revision, 'revision');
      assertValidSessionId(sessionId);
      assertAuthorizedSession(sessionId, authorizedSessionId);
      const { meta, event: activityEvent } = event(input, 'created', 'pending');
      const diagram = await manager.createDiagram(sessionId, name, mermaidText, revision, activityEvent, meta.participants);
      return { diagram } satisfies CreateDiagramOutput;
    }
    case 'write_diagram': {
      const { sessionId, diagramId } = readSessionAndDiagram(input, authorizedSessionId);
      const mermaidText = readString(input.mermaid_text, 'mermaid_text');
      const revision = readNonEmptyString(input.revision, 'revision');
      const name = input.name === undefined ? undefined : readNonEmptyString(input.name, 'name');
      const { meta, event: activityEvent } = event(input, 'replaced', diagramId);
      const diagram = await manager.writeDiagram(sessionId, diagramId, mermaidText, revision, activityEvent, meta.participants, name);
      return { diagram } satisfies WriteDiagramOutput;
    }
    case 'rename_diagram': {
      const { sessionId, diagramId } = readSessionAndDiagram(input, authorizedSessionId);
      const name = readNonEmptyString(input.name, 'name');
      const revision = readNonEmptyString(input.revision, 'revision');
      const { meta, event: activityEvent } = event(input, 'renamed', diagramId);
      const diagram = await manager.renameDiagram(sessionId, diagramId, name, revision, activityEvent, meta.participants);
      return { diagram } satisfies RenameDiagramOutput;
    }
    case 'delete_diagram': {
      const { sessionId, diagramId } = readSessionAndDiagram(input, authorizedSessionId);
      const revision = readNonEmptyString(input.revision, 'revision');
      const { meta, event: activityEvent } = event(input, 'deleted', diagramId);
      const nextRevision = await manager.deleteDiagram(sessionId, diagramId, revision, activityEvent, meta.participants);
      return { deleted: { id: diagramId }, revision: nextRevision } satisfies DeleteDiagramOutput;
    }
    case 'restore_diagram_revision': {
      const { sessionId, diagramId, revisionId } = readHistoryTarget(input, authorizedSessionId);
      const expectedRevision = readNonEmptyString(input.expected_revision, 'expected_revision');
      const { meta, event: activityEvent } = event(input, 'restored', diagramId);
      return manager.restoreDiagramRevision(sessionId, diagramId, revisionId, expectedRevision, activityEvent, meta.participants, 'mcp');
    }
    default:
      throw new Error(`Unsupported MCP tool: ${tool}`);
  }
}

export type McpToolPayload =
  | { tool: 'get_session'; input: { session_id: string } }
  | { tool: 'list_diagrams'; input: { session_id: string } }
  | { tool: 'read_diagram'; input: { session_id: string; diagram_id: string } }
  | { tool: 'read_overlay_scene'; input: { session_id: string; diagram_id: string } }
  | { tool: 'list_overlay_scene'; input: { session_id: string; diagram_id: string } }
  | { tool: 'read_overlay_object'; input: { session_id: string; diagram_id: string; object_id: string } }
  | { tool: 'create_overlay_object'; input: { session_id: string; diagram_id: string; expected_overlay_revision: string; object: OverlayObjectRecord } }
  | { tool: 'update_overlay_object'; input: { session_id: string; diagram_id: string; object_id: string; expected_overlay_revision: string; patch: OverlayObjectPatch } }
  | { tool: 'reorder_overlay_object'; input: { session_id: string; diagram_id: string; object_id: string; expected_overlay_revision: string; direction: 'front' | 'back' | 'forward' | 'backward' } }
  | { tool: 'delete_overlay_object'; input: { session_id: string; diagram_id: string; object_id: string; expected_overlay_revision: string } }
  | { tool: 'list_diagram_history'; input: { session_id: string; diagram_id: string } }
  | { tool: 'read_diagram_revision'; input: { session_id: string; diagram_id: string; revision_id: string } }
  | { tool: 'create_diagram'; input: CreateDiagramInput }
  | { tool: 'write_diagram'; input: { session_id: string; diagram_id: string; mermaid_text: string; revision: string; name?: string } }
  | { tool: 'rename_diagram'; input: { session_id: string; diagram_id: string; name: string; revision: string } }
  | { tool: 'delete_diagram'; input: { session_id: string; diagram_id: string; revision: string } }
  | { tool: 'restore_diagram_revision'; input: { session_id: string; diagram_id: string; revision_id: string; expected_revision: string } };
