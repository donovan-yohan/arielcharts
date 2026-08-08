import { APP_NAME } from '@arielcharts/shared';
import { toNodeHandler, type NodeMcpRequestHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod/v4';
import { handleMcpToolCall } from './mcp.js';
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

const sessionSummarySchema = z.object({
  id: z.string(),
  title: z.string(),
  participants: z.number(),
});

const actorInputSchema = {
  actorName: z.string().optional().describe('Optional display name recorded in the ArielCharts activity feed.'),
  actorType: z.enum(['human', 'agent']).optional().describe('Optional activity-feed actor type. Defaults to agent.'),
  detail: z.string().optional().describe('Optional concise activity-feed description of the change.'),
};

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

function mapActorInput(input: { actorName?: string; actorType?: 'human' | 'agent'; detail?: string }) {
  return {
    ...(input.actorName === undefined ? {} : { actor_name: input.actorName }),
    ...(input.actorType === undefined ? {} : { actor_type: input.actorType }),
    ...(input.detail === undefined ? {} : { detail: input.detail }),
  };
}

function createMcpServer(manager: SessionManager): McpServer {
  const server = new McpServer(
    { name: APP_NAME, version: '0.1.0' },
    { capabilities: { prompts: {}, tools: {} } },
  );

  server.registerTool(
    'listSessions',
    {
      title: 'List ArielCharts sessions',
      description: 'List available ArielCharts workspaces. Use this only when no sessionId was supplied; then call getSession before mutating a diagram.',
      outputSchema: z.object({ sessions: z.array(sessionSummarySchema) }),
    },
    async () => {
      const output = await handleMcpToolCall(manager, { tool: 'list_sessions', input: {} }) as {
        sessions: Array<{ id: string; title: string; participants: number }>;
      };
      return createToolResult(output);
    },
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
      const output = await handleMcpToolCall(manager, { tool: 'get_session', input: { session_id: sessionId } }) as {
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
      description: 'Create one new named tab in a session. First call getSession and pass its latest revision as expectedRevision. Use sequenceDiagram for end-to-end API interactions between parties; do not create a duplicate topic or alter another tab.',
      inputSchema: z.object({
        sessionId: z.string(),
        name: z.string().describe('Unique human-readable tab name within the session.'),
        mermaidText: z.string().optional().describe('Initial full Mermaid source. Use sequenceDiagram for request/response timelines.'),
        expectedRevision: z.string().describe('Latest session revision returned by getSession.'),
        ...actorInputSchema,
      }),
      outputSchema: z.object({ diagram: diagramSchema }),
    },
    async ({ sessionId, name, mermaidText, expectedRevision, actorName, actorType, detail }) => {
      const output = await handleMcpToolCall(manager, {
        tool: 'create_diagram',
        input: {
          session_id: sessionId,
          name,
          ...(mermaidText === undefined ? {} : { mermaid_text: mermaidText }),
          revision: expectedRevision,
          ...mapActorInput({ actorName, actorType, detail }),
        },
      }) as { diagram: { id: string; name: string; revision: string; mermaid_text: string } };
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
      }) as {
        diagram: { id: string; name: string; revision: string; mermaid_text: string };
        participants: Array<{ name: string; color: string; type: 'human' | 'agent' }>;
      };
      return createToolResult({ diagram: mapDiagram(output.diagram), participants: output.participants });
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
      }) as { diagram: { id: string; name: string; revision: string; mermaid_text: string } };
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
      }) as { diagram: { id: string; name: string; revision: string; mermaid_text: string } };
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
      }) as { deleted: { id: string }; revision: string };
      return createToolResult(output);
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
          text: 'When asked to scaffold or update an ArielCharts diagram: use the supplied sessionId (or listSessions if none was supplied), call getSession to select a tab, and use stable diagram IDs. Create a named tab only when the topic is new. For end-to-end API calls, use Mermaid sequenceDiagram with explicit actors/participants, request and response arrows, and alt/error paths when relevant. Before changing an existing tab, call readDiagram and pass its latest revision as expectedRevision to writeDiagram or renameDiagram. If a stale-revision error occurs, re-read, merge the concurrent edit, and retry. Do not rename or delete tabs unless explicitly asked.',
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
    () => createMcpServer(manager),
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
