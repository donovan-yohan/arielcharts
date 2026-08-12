import {
  APP_NAME,
  ALL_STARTER_TEMPLATES,
  type DiagramRevision,
  type DiagramRevisionSummary,
  type McpOverlayScene,
  type McpOverlayObjectList,
  type McpOverlayObjectRead,
  type OverlayObjectMutationOutput,
  type OverlayObjectRecord,
  type RestoreDiagramRevisionResult,
  type StarterTemplateId,
} from '@arielcharts/shared';
import { toNodeHandler, type NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod/v4';
import { handleMcpToolCall } from './mcp.js';
import { COLLABORATION_BUDGETS } from './document-admission.js';
import type { SessionManager } from './session-manager.js';

const participantSchema = z.object({
  name: z.string(),
  color: z.string(),
  type: z.enum(['human', 'agent']),
});

const diagramSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  revision: z.string(),
});

const diagramSchema = diagramSummarySchema.extend({
  mermaidText: z.string(),
});

const revisionActorSchema = z.object({
  name: z.string(),
  type: z.enum(['human', 'agent']),
});

const diagramRevisionSummarySchema = z.object({
  id: z.string(),
  sequence: z.number().int().nonnegative(),
  diagramId: z.string(),
  diagramName: z.string(),
  timestamp: z.number(),
  actor: revisionActorSchema,
  origin: z.enum(['browser', 'mcp', 'system']),
  action: z.string(),
  baseRevision: z.string().optional(),
  resultRevision: z.string().optional(),
  restoredFromRevisionId: z.string().optional(),
});

const diagramRevisionSchema = diagramRevisionSummarySchema.extend({
  mermaidText: z.string(),
  nodePositions: z.record(z.string(), z.object({ x: z.number(), y: z.number() })),
});

const utf8String = (maximumBytes: number) => z.string().refine((value) => Buffer.byteLength(value, 'utf8') <= maximumBytes, { message: `Must be at most ${maximumBytes} UTF-8 bytes.` });
const boundedOverlayIdentifier = z.string().min(1).refine((value) => Buffer.byteLength(value, 'utf8') <= COLLABORATION_BUDGETS.identifierBytes, { message: `Must be at most ${COLLABORATION_BUDGETS.identifierBytes} UTF-8 bytes.` });
const overlayGeometrySchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite().nonnegative(), height: z.number().finite().nonnegative(), rotation: z.number().finite() });
const overlayPointSchema = z.object({ x: z.number().finite(), y: z.number().finite() });
const overlayMetadataSchema = z.record(utf8String(128), z.union([utf8String(2_048), z.number().finite(), z.boolean(), z.null()])).refine((value) => Object.keys(value).length <= 32, { message: 'Overlay metadata has too many entries.' });
function isBoundedOverlayPayload(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) return false;
  const counters = { values: 0, arrayItems: 0, bytes: 0 };
  const active = new Set<object>();
  const visit = (entry: unknown, depth: number): boolean => {
    if (depth > 24 || ++counters.values > 8_192) return false;
    if (entry === null || typeof entry === 'boolean') return true;
    if (typeof entry === 'number') return Number.isFinite(entry);
    if (typeof entry === 'string') {
      const bytes = Buffer.byteLength(entry, 'utf8'); counters.bytes += bytes;
      return bytes <= 8_192 && counters.bytes <= COLLABORATION_BUDGETS.textBytesPerObject;
    }
    if (Array.isArray(entry)) {
      counters.arrayItems += entry.length;
      return entry.length <= COLLABORATION_BUDGETS.strokePointsPerObject && counters.arrayItems <= COLLABORATION_BUDGETS.strokePointsPerObject
        && entry.every((child) => visit(child, depth + 1));
    }
    if (!entry || typeof entry !== 'object' || (Object.getPrototypeOf(entry) !== Object.prototype && Object.getPrototypeOf(entry) !== null) || active.has(entry)) return false;
    const entries = Object.entries(entry);
    if (entries.length > 32) return false;
    active.add(entry);
    const valid = entries.every(([key, child]) => {
      const bytes = Buffer.byteLength(key, 'utf8'); counters.bytes += bytes;
      return bytes <= 128 && counters.bytes <= COLLABORATION_BUDGETS.textBytesPerObject && visit(child, depth + 1);
    });
    active.delete(entry);
    return valid;
  };
  return visit(value, 0);
}
const overlayPayloadSchema = z.record(utf8String(128), z.unknown())
  .refine(isBoundedOverlayPayload, { message: 'Overlay payload is not a bounded JSON value.' });
const overlayAnchorSchema = z.object({ mermaidId: boundedOverlayIdentifier, offset: overlayPointSchema, fallback: overlayPointSchema });
const overlayObjectInputSchema = z.object({
  id: boundedOverlayIdentifier, kind: boundedOverlayIdentifier, version: z.number().int().positive(), orderKey: boundedOverlayIdentifier, geometry: overlayGeometrySchema,
  anchor: overlayAnchorSchema.optional(), layer: boundedOverlayIdentifier.optional(), style: overlayMetadataSchema,
  metadata: overlayMetadataSchema, payload: overlayPayloadSchema, body: utf8String(8_192).optional(),
});
const overlayObjectSchema = overlayObjectInputSchema;
const overlayObjectPatchInputSchema = z.object({
  geometry: overlayGeometrySchema.optional(), anchor: overlayAnchorSchema.optional(), layer: boundedOverlayIdentifier.optional(),
  style: overlayMetadataSchema.optional(), metadata: overlayMetadataSchema.optional(), payload: overlayPayloadSchema.optional(), body: utf8String(8_192).optional(),
}).refine((patch) => Object.keys(patch).length > 0, { message: 'Supply at least one overlay patch field.' });
const opaqueOverlayObjectSchema = z.object({ id: boundedOverlayIdentifier, kind: boundedOverlayIdentifier, version: z.number().int() });
const overlayLayerSchema = z.object({ id: boundedOverlayIdentifier, name: utf8String(2_048), orderKey: boundedOverlayIdentifier, visible: z.boolean(), locked: z.boolean(), export: z.boolean() });
const mcpOverlaySceneSchema = z.object({
  version: z.number().int(), diagramId: z.string(), overlayRevision: z.string(), writable: z.boolean(),
  objects: z.array(overlayObjectSchema).max(COLLABORATION_BUDGETS.objectsPerScene), opaqueObjects: z.array(opaqueOverlayObjectSchema).max(COLLABORATION_BUDGETS.objectsPerScene), layers: z.array(overlayLayerSchema).max(COLLABORATION_BUDGETS.layersPerScene).optional(),
});
const mcpOverlayObjectSummarySchema = z.object({ id: boundedOverlayIdentifier, kind: boundedOverlayIdentifier, version: z.number().int(), opaque: z.boolean(), orderKey: boundedOverlayIdentifier.optional() });
const mcpOverlayObjectListSchema = z.object({ version: z.number().int(), diagramId: z.string(), overlayRevision: z.string(), writable: z.boolean(), objects: z.array(mcpOverlayObjectSummarySchema).max(COLLABORATION_BUDGETS.objectsPerScene) });
const mcpOverlayObjectReadSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('found'), overlayRevision: z.string(), writable: z.boolean(), object: overlayObjectSchema }),
  z.object({ status: z.literal('opaque'), overlayRevision: z.string(), writable: z.literal(false), object: opaqueOverlayObjectSchema }),
  z.object({ status: z.literal('missing'), overlayRevision: z.string(), writable: z.boolean(), objectId: boundedOverlayIdentifier }),
]);

const actorInputSchema = {
  actorName: z.string().max(COLLABORATION_BUDGETS.identifierBytes).optional().describe('Optional display name recorded in the ArielCharts activity feed.'),
  actorType: z.enum(['human', 'agent']).optional().describe('Optional activity-feed actor type. Defaults to agent.'),
  detail: z.string().max(2_048).optional().describe('Optional concise activity-feed description of the change.'),
};

const overlayActorInputSchema = {
  actorName: z.string().max(COLLABORATION_BUDGETS.identifierBytes).optional().describe('Optional durable agent display name. A successful overlay mutation materializes this participant without adding an activity event.'),
  actorType: z.enum(['human', 'agent']).optional().describe('Optional durable participant type. Defaults to agent.'),
};

const starterTemplateIds = ALL_STARTER_TEMPLATES.map((template) => template.id) as [StarterTemplateId, ...StarterTemplateId[]];
const starterTemplateIdSchema = z.enum(starterTemplateIds);
const starterTemplateDescription = ALL_STARTER_TEMPLATES
  .map((template) => `${template.id}: ${template.description}`)
  .join(' ');

function createToolResult(payload: Record<string, unknown>) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
  };
}

function mapDiagram(diagram: { id: string; name: string; revision: string; mermaid_text?: string }) {
  return {
    id: diagram.id,
    name: diagram.name,
    revision: diagram.revision,
    ...(diagram.mermaid_text === undefined ? {} : { mermaidText: diagram.mermaid_text }),
  };
}

function mapOverlayObject(object: OverlayObjectRecord) {
  return {
    id: object.id,
    kind: object.kind,
    version: object.version,
    orderKey: object.order_key,
    geometry: object.geometry,
    ...(object.anchor === undefined ? {} : {
      anchor: { mermaidId: object.anchor.mermaid_id, offset: object.anchor.offset, fallback: object.anchor.fallback },
    }),
    ...(object.layer === undefined ? {} : { layer: object.layer }),
    style: object.style,
    metadata: object.metadata,
    payload: object.payload,
    ...(object.body === undefined ? {} : { body: object.body }),
  };
}

function mapOverlayObjectInput(object: z.infer<typeof overlayObjectInputSchema>): OverlayObjectRecord {
  return {
    id: object.id, kind: object.kind, version: object.version, order_key: object.orderKey, geometry: object.geometry,
    ...(object.anchor === undefined ? {} : { anchor: { mermaid_id: object.anchor.mermaidId, offset: object.anchor.offset, fallback: object.anchor.fallback } }),
    ...(object.layer === undefined ? {} : { layer: object.layer }),
    style: object.style, metadata: object.metadata, payload: object.payload,
    ...(object.body === undefined ? {} : { body: object.body }),
  };
}

function mapOverlayPatchInput(patch: z.infer<typeof overlayObjectPatchInputSchema>) {
  return {
    ...(patch.geometry === undefined ? {} : { geometry: patch.geometry }),
    ...(patch.anchor === undefined ? {} : { anchor: { mermaid_id: patch.anchor.mermaidId, offset: patch.anchor.offset, fallback: patch.anchor.fallback } }),
    ...(patch.layer === undefined ? {} : { layer: patch.layer }),
    ...(patch.style === undefined ? {} : { style: patch.style }),
    ...(patch.metadata === undefined ? {} : { metadata: patch.metadata }),
    ...(patch.payload === undefined ? {} : { payload: patch.payload }),
    ...(patch.body === undefined ? {} : { body: patch.body }),
  };
}

function mapMcpOverlayScene(scene: McpOverlayScene) {
  return {
    version: scene.version,
    diagramId: scene.diagram_id,
    overlayRevision: scene.overlay_revision,
    writable: scene.writable,
    objects: scene.objects.map(mapOverlayObject),
    opaqueObjects: scene.opaque_objects,
    ...(scene.layers === undefined ? {} : {
      layers: scene.layers.map((layer) => ({ id: layer.id, name: layer.name, orderKey: layer.order_key, visible: layer.visible, locked: layer.locked, export: layer.export })),
    }),
  };
}

function mapMcpOverlayObjectList(scene: McpOverlayObjectList) {
  return {
    version: scene.version,
    diagramId: scene.diagram_id,
    overlayRevision: scene.overlay_revision,
    writable: scene.writable,
    objects: scene.objects.map((object) => ({
      id: object.id, kind: object.kind, version: object.version, opaque: object.opaque,
      ...(object.order_key === undefined ? {} : { orderKey: object.order_key }),
    })),
  };
}

function mapMcpOverlayObjectRead(output: McpOverlayObjectRead) {
  if (output.status === 'found') return { status: output.status, overlayRevision: output.overlay_revision, writable: output.writable, object: mapOverlayObject(output.object) };
  if (output.status === 'opaque') return { status: output.status, overlayRevision: output.overlay_revision, writable: false as const, object: output.object };
  return { status: output.status, overlayRevision: output.overlay_revision, writable: output.writable, objectId: output.object_id };
}

function mapActorInput(input: { actorName?: string; actorType?: 'human' | 'agent'; detail?: string }) {
  return {
    ...(input.actorName === undefined ? {} : { actor_name: input.actorName }),
    ...(input.actorType === undefined ? {} : { actor_type: input.actorType }),
    ...(input.detail === undefined ? {} : { detail: input.detail }),
  };
}

type RawDiagramRevisionSummary = DiagramRevisionSummary;
type RawDiagramRevision = DiagramRevision;

function mapDiagramRevisionSummary(revision: RawDiagramRevisionSummary) {
  return {
    id: revision.revision_id,
    sequence: revision.sequence,
    diagramId: revision.diagram_id,
    diagramName: revision.name,
    timestamp: revision.timestamp,
    actor: revision.actor,
    origin: revision.origin,
    action: revision.action,
    ...(revision.base_revision === undefined ? {} : { baseRevision: revision.base_revision }),
    resultRevision: revision.result_revision,
    ...(revision.restored_from_revision_id === undefined ? {} : { restoredFromRevisionId: revision.restored_from_revision_id }),
  };
}

function mapDiagramRevision(revision: RawDiagramRevision) {
  return {
    ...mapDiagramRevisionSummary(revision),
    mermaidText: revision.mermaid_text,
    nodePositions: revision.node_positions,
  };
}

function createStaleToolResult(current: { id: string; name: string; revision: string }) {
  const payload = {
    error: {
      code: 'STALE_DIAGRAM_REVISION',
      message: 'The diagram changed before the restore could be applied. Read the current diagram and deliberately reconfirm before retrying.',
      currentDiagram: mapDiagram(current),
    },
  };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  };
}

function createStaleOverlayToolResult(scene: McpOverlayScene) {
  const payload = {
    error: {
      code: 'STALE_OVERLAY_REVISION',
      message: 'The overlay scene changed before this operation could be applied. Read the current overlay scene, merge deliberately, and retry once.',
      currentOverlayScene: mapMcpOverlayScene(scene),
    },
  };
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    structuredContent: payload,
    isError: true,
  };
}

function createMcpServer(manager: SessionManager, authorizedSessionId: string): McpServer {
  const server = new McpServer(
    { name: APP_NAME, version: '0.1.0' },
    { capabilities: { prompts: {}, tools: {} } },
  );

  server.registerTool(
    'getSession',
    {
      title: 'Get a session and its diagram tabs',
      description: 'Non-mutating. Read a session before creating, replacing, renaming, or deleting a diagram. Returns ordered tab IDs and the latest session revision required by createDiagram.',
      inputSchema: z.object({ sessionId: z.string().describe('ArielCharts application session ID, not an MCP transport session.') }),
      outputSchema: z.object({
        sessionId: z.string(),
        diagrams: z.array(diagramSummarySchema),
        participants: z.array(participantSchema),
        revision: z.string(),
      }),
    },
    async ({ sessionId }) => {
      const output = await handleMcpToolCall(manager, { tool: 'get_session', input: { session_id: sessionId } }, authorizedSessionId) as {
        session_id: string;
        diagrams: Array<{ id: string; name: string; revision: string }>;
        participants: Array<{ name: string; color: string; type: 'human' | 'agent' }>;
        revision: string;
      };
      return createToolResult({
        sessionId: output.session_id,
        diagrams: output.diagrams.map(mapDiagram),
        participants: output.participants,
        revision: output.revision,
      });
    },
  );

  server.registerTool(
    'createDiagram',
    {
      title: 'Create a named Mermaid diagram tab',
      description: 'Create one new named Mermaid diagram tab in a session. First call getSession and pass its latest revision as expectedRevision. Supply exactly one catalog templateId or ordinary mermaidText; do not create a duplicate topic or alter another tab.',
      inputSchema: z.object({
        sessionId: z.string(),
        name: z.string().describe('Unique human-readable tab name within the session.'),
        templateId: starterTemplateIdSchema.optional().describe(`Catalog starter ID (legacy aliases remain accepted). Supply exactly one of templateId or mermaidText. ${starterTemplateDescription}`),
        mermaidText: z.string().optional().describe('Initial full Mermaid source. Supply exactly one of mermaidText or templateId.'),
        expectedRevision: z.string().describe('Latest session revision returned by getSession.'),
        ...actorInputSchema,
      }).refine(
        ({ templateId, mermaidText }) => (templateId === undefined) !== (mermaidText === undefined),
        { message: 'Supply exactly one of templateId or mermaidText.' },
      ),
      outputSchema: z.object({ diagram: diagramSchema }),
    },
    async ({ sessionId, name, templateId, mermaidText, expectedRevision, actorName, actorType, detail }) => {
      const output = await handleMcpToolCall(manager, {
        tool: 'create_diagram',
        input: {
          session_id: sessionId,
          name,
          ...(templateId === undefined ? {} : { template_id: templateId }),
          ...(mermaidText === undefined ? {} : { mermaid_text: mermaidText }),
          revision: expectedRevision,
          ...mapActorInput({ actorName, actorType, detail }),
        },
      }, authorizedSessionId) as { diagram: { id: string; name: string; revision: string; mermaid_text: string } };
      return createToolResult({ diagram: mapDiagram(output.diagram) });
    },
  );

  server.registerTool(
    'readDiagram',
    {
      title: 'Read one named Mermaid diagram tab',
      description: 'Non-mutating. Read the canonical Mermaid source and latest revision for one exact diagram ID before writeDiagram or renameDiagram. If a mutation reports a stale revision, read again and merge before retrying.',
      inputSchema: z.object({ sessionId: z.string(), diagramId: z.string() }),
      outputSchema: z.object({ diagram: diagramSchema, participants: z.array(participantSchema) }),
    },
    async ({ sessionId, diagramId }) => {
      const output = await handleMcpToolCall(manager, {
        tool: 'read_diagram',
        input: { session_id: sessionId, diagram_id: diagramId },
      }, authorizedSessionId) as {
        diagram: { id: string; name: string; revision: string; mermaid_text: string };
        participants: Array<{ name: string; color: string; type: 'human' | 'agent' }>;
      };
      return createToolResult({ diagram: mapDiagram(output.diagram), participants: output.participants });
    },
  );

  server.registerTool(
    'readOverlayScene',
    {
      title: 'Read one diagram overlay scene',
      description: 'Non-mutating. Read the current overlayRevision and bounded canvas-only objects for one exact diagram before an overlay operation. Newer scenes, and v1 scenes containing opaque objects, are explicitly read-only; opaque object markers are retained in the revision and never silently discarded.',
      inputSchema: z.object({ sessionId: z.string(), diagramId: z.string() }),
      outputSchema: z.object({ scene: mcpOverlaySceneSchema }),
    },
    async ({ sessionId, diagramId }) => {
      const output = await handleMcpToolCall(manager, {
        tool: 'read_overlay_scene', input: { session_id: sessionId, diagram_id: diagramId },
      }, authorizedSessionId) as McpOverlayScene;
      return createToolResult({ scene: mapMcpOverlayScene(output) });
    },
  );

  server.registerTool(
    'listOverlayObjects',
    {
      title: 'List bounded overlay objects',
      description: 'Non-mutating. Lists bounded object identities and ordering for one diagram without returning object payloads. Opaque markers and a read-only flag make unsupported data explicit; call readOverlayObject for one supported object.',
      inputSchema: z.object({ sessionId: z.string(), diagramId: z.string() }),
      outputSchema: z.object({ scene: mcpOverlayObjectListSchema }),
    },
    async ({ sessionId, diagramId }) => {
      const output = await handleMcpToolCall(manager, {
        tool: 'list_overlay_scene', input: { session_id: sessionId, diagram_id: diagramId },
      }, authorizedSessionId) as McpOverlayObjectList;
      return createToolResult({ scene: mapMcpOverlayObjectList(output) });
    },
  );

  server.registerTool(
    'readOverlayObject',
    {
      title: 'Read one overlay object',
      description: 'Non-mutating. Returns one bounded object record, an explicit opaque marker, or an explicit missing result. It never replaces or reinterprets a whole overlay scene.',
      inputSchema: z.object({ sessionId: z.string(), diagramId: z.string(), objectId: boundedOverlayIdentifier }),
      outputSchema: mcpOverlayObjectReadSchema,
    },
    async ({ sessionId, diagramId, objectId }) => {
      const output = await handleMcpToolCall(manager, {
        tool: 'read_overlay_object', input: { session_id: sessionId, diagram_id: diagramId, object_id: objectId },
      }, authorizedSessionId) as McpOverlayObjectRead;
      return createToolResult(mapMcpOverlayObjectRead(output));
    },
  );

  const overlayMutationResultSchema = z.object({ overlayRevision: z.string(), object: overlayObjectSchema.optional(), deletedObjectId: z.string().optional() });
  const overlayMutation = async (output: OverlayObjectMutationOutput) => {
    if (output.status === 'stale') return createStaleOverlayToolResult(output.scene);
    return createToolResult({
      overlayRevision: output.overlay_revision,
      ...(output.object === undefined ? {} : { object: mapOverlayObject(output.object) }),
      ...(output.deleted_object_id === undefined ? {} : { deletedObjectId: output.deleted_object_id }),
    });
  };

  server.registerTool(
    'createOverlayObject',
    {
      title: 'Create one overlay object',
      description: 'Create one bounded canvas-only overlay object. First call readOverlayScene and pass its exact overlayRevision as expectedOverlayRevision. This never replaces a whole scene or Mermaid source.',
      inputSchema: z.object({ sessionId: z.string(), diagramId: z.string(), expectedOverlayRevision: z.string(), object: overlayObjectInputSchema, ...overlayActorInputSchema }),
      outputSchema: overlayMutationResultSchema,
    },
    async ({ sessionId, diagramId, expectedOverlayRevision, object, actorName, actorType }) => overlayMutation(
      await handleMcpToolCall(manager, {
        tool: 'create_overlay_object',
        input: { session_id: sessionId, diagram_id: diagramId, expected_overlay_revision: expectedOverlayRevision, object: mapOverlayObjectInput(object), ...mapActorInput({ actorName, actorType }) },
      }, authorizedSessionId) as OverlayObjectMutationOutput,
    ),
  );

  server.registerTool(
    'updateOverlayObject',
    {
      title: 'Update one overlay object',
      description: 'Update named fields of one existing canvas-only object. Read the scene first and pass expectedOverlayRevision. On a stale result, use currentOverlayScene to merge and retry deliberately; never replace the scene.',
      inputSchema: z.object({ sessionId: z.string(), diagramId: z.string(), objectId: boundedOverlayIdentifier, expectedOverlayRevision: z.string(), patch: overlayObjectPatchInputSchema, ...overlayActorInputSchema }),
      outputSchema: overlayMutationResultSchema,
    },
    async ({ sessionId, diagramId, objectId, expectedOverlayRevision, patch, actorName, actorType }) => overlayMutation(
      await handleMcpToolCall(manager, {
        tool: 'update_overlay_object',
        input: { session_id: sessionId, diagram_id: diagramId, object_id: objectId, expected_overlay_revision: expectedOverlayRevision, patch: mapOverlayPatchInput(patch), ...mapActorInput({ actorName, actorType }) },
      }, authorizedSessionId) as OverlayObjectMutationOutput,
    ),
  );

  server.registerTool(
    'reorderOverlayObject',
    {
      title: 'Reorder one overlay object',
      description: 'Move one overlay object within its layer. Read the current scene first and pass expectedOverlayRevision; this changes only the selected object order key.',
      inputSchema: z.object({ sessionId: z.string(), diagramId: z.string(), objectId: boundedOverlayIdentifier, expectedOverlayRevision: z.string(), direction: z.enum(['front', 'back', 'forward', 'backward']), ...overlayActorInputSchema }),
      outputSchema: overlayMutationResultSchema,
    },
    async ({ sessionId, diagramId, objectId, expectedOverlayRevision, direction, actorName, actorType }) => overlayMutation(
      await handleMcpToolCall(manager, {
        tool: 'reorder_overlay_object',
        input: { session_id: sessionId, diagram_id: diagramId, object_id: objectId, expected_overlay_revision: expectedOverlayRevision, direction, ...mapActorInput({ actorName, actorType }) },
      }, authorizedSessionId) as OverlayObjectMutationOutput,
    ),
  );

  server.registerTool(
    'deleteOverlayObject',
    {
      title: 'Delete one overlay object',
      description: 'Delete one exact canvas-only object only when explicitly requested. Read the current scene and pass expectedOverlayRevision; locked and opaque objects cannot be deleted through MCP.',
      inputSchema: z.object({ sessionId: z.string(), diagramId: z.string(), objectId: boundedOverlayIdentifier, expectedOverlayRevision: z.string(), ...overlayActorInputSchema }),
      outputSchema: overlayMutationResultSchema,
    },
    async ({ sessionId, diagramId, objectId, expectedOverlayRevision, actorName, actorType }) => overlayMutation(
      await handleMcpToolCall(manager, {
        tool: 'delete_overlay_object',
        input: { session_id: sessionId, diagram_id: diagramId, object_id: objectId, expected_overlay_revision: expectedOverlayRevision, ...mapActorInput({ actorName, actorType }) },
      }, authorizedSessionId) as OverlayObjectMutationOutput,
    ),
  );

  server.registerTool(
    'listDiagramHistory',
    {
      title: 'List immutable history for one named diagram tab',
      description: 'Non-mutating. After getSession and readDiagram identify the current named tab, list its immutable checkpoints. The response identifies the current live revision; readDiagram immediately before any restore.',
      inputSchema: z.object({ sessionId: z.string(), diagramId: z.string() }),
      outputSchema: z.object({ currentRevision: z.string(), revisions: z.array(diagramRevisionSummarySchema) }),
    },
    async ({ sessionId, diagramId }) => {
      const output = await handleMcpToolCall(manager, {
        tool: 'list_diagram_history',
        input: { session_id: sessionId, diagram_id: diagramId },
      }, authorizedSessionId) as { current_revision: string; revisions: RawDiagramRevisionSummary[] };
      return createToolResult({
        currentRevision: output.current_revision,
        revisions: output.revisions.map(mapDiagramRevisionSummary),
      });
    },
  );

  server.registerTool(
    'readDiagramRevision',
    {
      title: 'Read one immutable Mermaid diagram revision',
      description: 'Non-mutating. Read the exact immutable source and layout for a revision returned by listDiagramHistory. This is safe for local preview and never changes the live diagram.',
      inputSchema: z.object({ sessionId: z.string(), diagramId: z.string(), revisionId: z.string() }),
      outputSchema: z.object({ revision: diagramRevisionSchema }),
    },
    async ({ sessionId, diagramId, revisionId }) => {
      const output = await handleMcpToolCall(manager, {
        tool: 'read_diagram_revision',
        input: { session_id: sessionId, diagram_id: diagramId, revision_id: revisionId },
      }, authorizedSessionId) as RawDiagramRevision;
      return createToolResult({ revision: mapDiagramRevision(output) });
    },
  );

  server.registerTool(
    'writeDiagram',
    {
      title: 'Replace one Mermaid diagram tab',
      description: 'Replace the full Mermaid source for exactly one diagram tab. You MUST use the latest revision from readDiagram as expectedRevision. On a stale-revision error, re-read the tab, merge the concurrent change, and retry; never overwrite another tab.',
      inputSchema: z.object({
        sessionId: z.string(),
        diagramId: z.string(),
        mermaidText: z.string().describe('Complete replacement Mermaid source.'),
        expectedRevision: z.string().describe('Latest revision returned by readDiagram.'),
        name: z.string().optional().describe('Optional replacement tab name.'),
        ...actorInputSchema,
      }),
      outputSchema: z.object({ diagram: diagramSchema }),
    },
    async ({ sessionId, diagramId, mermaidText, expectedRevision, name, actorName, actorType, detail }) => {
      const output = await handleMcpToolCall(manager, {
        tool: 'write_diagram',
        input: {
          session_id: sessionId,
          diagram_id: diagramId,
          mermaid_text: mermaidText,
          revision: expectedRevision,
          ...(name === undefined ? {} : { name }),
          ...mapActorInput({ actorName, actorType, detail }),
        },
      }, authorizedSessionId) as { diagram: { id: string; name: string; revision: string; mermaid_text: string } };
      return createToolResult({ diagram: mapDiagram(output.diagram) });
    },
  );

  server.registerTool(
    'renameDiagram',
    {
      title: 'Rename one diagram tab',
      description: 'Rename exactly one tab. Read the tab first and pass its latest revision as expectedRevision. If it is stale, re-read before retrying.',
      inputSchema: z.object({ sessionId: z.string(), diagramId: z.string(), name: z.string(), expectedRevision: z.string(), ...actorInputSchema }),
      outputSchema: z.object({ diagram: diagramSchema }),
    },
    async ({ sessionId, diagramId, name, expectedRevision, actorName, actorType, detail }) => {
      const output = await handleMcpToolCall(manager, {
        tool: 'rename_diagram',
        input: { session_id: sessionId, diagram_id: diagramId, name, revision: expectedRevision, ...mapActorInput({ actorName, actorType, detail }) },
      }, authorizedSessionId) as { diagram: { id: string; name: string; revision: string; mermaid_text: string } };
      return createToolResult({ diagram: mapDiagram(output.diagram) });
    },
  );

  server.registerTool(
    'deleteDiagram',
    {
      title: 'Delete one diagram tab',
      description: 'Delete exactly one named tab only when explicitly requested. Read the current session or diagram first and pass the latest revision as expectedRevision. The last tab cannot be deleted.',
      inputSchema: z.object({ sessionId: z.string(), diagramId: z.string(), expectedRevision: z.string(), ...actorInputSchema }),
      outputSchema: z.object({ deleted: z.object({ id: z.string() }), revision: z.string() }),
    },
    async ({ sessionId, diagramId, expectedRevision, actorName, actorType, detail }) => {
      const output = await handleMcpToolCall(manager, {
        tool: 'delete_diagram',
        input: { session_id: sessionId, diagram_id: diagramId, revision: expectedRevision, ...mapActorInput({ actorName, actorType, detail }) },
      }, authorizedSessionId) as { deleted: { id: string }; revision: string };
      return createToolResult(output);
    },
  );

  server.registerTool(
    'restoreDiagramRevision',
    {
      title: 'Restore an immutable revision as a new live revision',
      description: 'Restore one previously read revision without deleting history. You MUST call readDiagram immediately before this tool and pass that exact latest revision as expectedRevision. A stale restore is a no-op: read the current diagram, review the new state, and deliberately reconfirm. Never blindly retry.',
      inputSchema: z.object({
        sessionId: z.string(),
        diagramId: z.string(),
        revisionId: z.string().describe('Immutable revision ID returned by listDiagramHistory.'),
        expectedRevision: z.string().describe('Exact latest diagram revision from a readDiagram call made immediately before restore.'),
        ...actorInputSchema,
      }),
      outputSchema: z.object({ diagram: diagramSchema, revision: diagramRevisionSummarySchema }),
    },
    async ({ sessionId, diagramId, revisionId, expectedRevision, actorName, actorType, detail }) => {
      const output = await handleMcpToolCall(manager, {
        tool: 'restore_diagram_revision',
        input: {
          session_id: sessionId,
          diagram_id: diagramId,
          revision_id: revisionId,
          expected_revision: expectedRevision,
          ...mapActorInput({ actorName, actorType, detail }),
        },
      }, authorizedSessionId) as RestoreDiagramRevisionResult;
      if (output.status === 'stale') {
        return createStaleToolResult(output.current);
      }
      return createToolResult({ diagram: mapDiagram(output.diagram), revision: mapDiagramRevisionSummary(output.revision) });
    },
  );

  server.registerPrompt(
    'diagrammingWorkflow',
    {
      title: 'ArielCharts diagramming workflow',
      description: 'Instructions for safely creating and updating live Mermaid diagram tabs during research or coding work.',
    },
    async () => ({
      messages: [{
        role: 'user' as const,
        content: {
          type: 'text' as const,
          text: 'When asked to scaffold or update an ArielCharts diagram: use the supplied sessionId, then call getSession to choose a named tab by its stable ID. Create a named tab only when the topic is new. For end-to-end API calls, use Mermaid sequenceDiagram with explicit actors/participants, request and response arrows, and alt/error paths when relevant. Before changing an existing tab, call readDiagram and pass its latest revision as expectedRevision to writeDiagram or renameDiagram. If a stale write occurs, re-read, merge the concurrent edit, and retry deliberately. To inspect prior work, use getSession -> readDiagram -> listDiagramHistory -> readDiagramRevision. Before restoring, call readDiagram immediately again, then call restoreDiagramRevision with that exact expectedRevision. A stale restore is a no-op: re-read, review the new state, and deliberately reconfirm; never blindly retry it. Do not rename or delete tabs unless explicitly asked.',
        },
      }],
    }),
  );

  return server;
}

export interface ModernMcpRequestHandler {
  close: () => Promise<void>;
  handle: NodeMcpRequestHandler;
}

export function createModernMcpRequestHandler(manager: SessionManager): ModernMcpRequestHandler {
  const handler = createMcpHandler(
    (context) => {
      const authorizedSessionId = context.authInfo?.extra?.roomSessionId;
      if (typeof authorizedSessionId !== 'string') throw new Error('Room access denied.');
      return createMcpServer(manager, authorizedSessionId);
    },
    { legacy: 'reject' },
  );

  return {
    close: () => handler.close(),
    handle: toNodeHandler(handler),
  };
}

export async function handleModernMcpRequest(
  handler: ModernMcpRequestHandler,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  await handler.handle(request, response);
}
