import { assert } from './assert.ts';

const MCP_PROTOCOL_VERSION = '2026-07-28';
const MCP_FETCH_TIMEOUT_MS = 15_000;

export type Diagram = { id: string; mermaidText: string; name: string; revision: string };
export type McpRoomAccess = { roomKey: string; sessionId: string };
export type DiagramRevisionSummary = {
  id: string;
  sequence: number;
  diagramId: string;
  diagramName: string;
  timestamp: number;
  actor: { name: string; type: 'human' | 'agent' };
  origin: 'browser' | 'mcp' | 'system';
  action: string;
  baseRevision?: string;
  resultRevision: string;
  restoredFromRevisionId?: string;
};

export type DiagramRevision = DiagramRevisionSummary & {
  mermaidText: string;
  nodePositions: Record<string, { x: number; y: number }>;
};
type McpPayload = {
  error?: { message?: string };
  result?: {
    content?: Array<{ text?: string }>;
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };
};

function isRevisionConflict(payload: McpPayload): boolean {
  const message = [
    payload.error?.message,
    ...payload.result?.content?.map((item) => item.text) ?? [],
  ].filter((value): value is string => Boolean(value)).join('\n');

  return /stale (?:(?:diagram|session) )?revision|revision conflict/i.test(message);
}

export async function postModernMcp(
  endpoint: string,
  origin: string,
  room: McpRoomAccess,
  name: string,
  args: Record<string, unknown>,
  id = 1,
): Promise<Response> {
  return fetch(endpoint, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${room.sessionId}.${room.roomKey}`,
      'content-type': 'application/json',
      'mcp-method': 'tools/call',
      'mcp-name': name,
      'mcp-protocol-version': MCP_PROTOCOL_VERSION,
      origin,
    },
    signal: AbortSignal.timeout(MCP_FETCH_TIMEOUT_MS),
    body: JSON.stringify({
      jsonrpc: '2.0',
      id,
      method: 'tools/call',
      params: {
        name,
        arguments: args,
        _meta: {
          'io.modelcontextprotocol/clientCapabilities': {},
          'io.modelcontextprotocol/clientInfo': { name: 'arielcharts-workspace-ux-e2e', version: '1.0.0' },
          'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
        },
      },
    }),
  });
}

export class ModernMcpClient {
  private nextId = 1;

  constructor(
    private readonly endpoint: string,
    private readonly origin: string,
    private readonly room: McpRoomAccess,
  ) {}

  async tool(name: string, args: Record<string, unknown>): Promise<McpPayload> {
    const argumentSessionId = typeof args.sessionId === 'string' ? args.sessionId : null;
    if (argumentSessionId && argumentSessionId !== this.room.sessionId) {
      throw new Error(`Authenticated MCP ${name} request targeted ${argumentSessionId}, not bound room ${this.room.sessionId}.`);
    }
    let response: Response;
    try {
      response = await postModernMcp(this.endpoint, this.origin, this.room, name, args, this.nextId++);
    } catch (error) {
      throw new Error(`MCP ${name} request failed within ${MCP_FETCH_TIMEOUT_MS / 1_000}s`, { cause: error });
    }
    if (!response.ok) {
      throw new Error(`MCP ${name} returned HTTP ${response.status}: ${await response.text()}`);
    }
    return response.json() as Promise<McpPayload>;
  }

  expectContent<T>(payload: McpPayload, action: string): T {
    assert(!payload.error, `MCP ${action} JSON-RPC error: ${payload.error?.message ?? 'unknown error'}`);
    assert(!payload.result?.isError, `MCP ${action} tool error: ${payload.result?.content?.map((item) => item.text).join('\n') ?? 'unknown error'}`);
    assert(payload.result?.structuredContent, `MCP ${action} omitted structuredContent.`);
    return payload.result.structuredContent as T;
  }

  async getSession(sessionId: string): Promise<{ diagrams: Array<Pick<Diagram, 'id' | 'name' | 'revision'>>; revision: string }> {
    return this.expectContent(await this.tool('getSession', { sessionId }), 'getSession');
  }

  async readDiagram(sessionId: string, diagramId: string): Promise<Diagram> {
    return this.expectContent<{ diagram: Diagram }>(await this.tool('readDiagram', { sessionId, diagramId }), 'readDiagram').diagram;
  }

  async listDiagramHistory(sessionId: string, diagramId: string): Promise<{ currentRevision: string; revisions: DiagramRevisionSummary[] }> {
    return this.expectContent<{ currentRevision: string; revisions: DiagramRevisionSummary[] }>(
      await this.tool('listDiagramHistory', { sessionId, diagramId }),
      'listDiagramHistory',
    );
  }

  async readDiagramRevision(sessionId: string, diagramId: string, revisionId: string): Promise<DiagramRevision> {
    return this.expectContent<{ revision: DiagramRevision }>(
      await this.tool('readDiagramRevision', { sessionId, diagramId, revisionId }),
      'readDiagramRevision',
    ).revision;
  }

  async restoreDiagramRevision(
    sessionId: string,
    diagramId: string,
    revisionId: string,
    expectedRevision: string,
  ): Promise<{ diagram: Diagram; revision: DiagramRevisionSummary }> {
    return this.expectContent<{ diagram: Diagram; revision: DiagramRevisionSummary }>(
      await this.tool('restoreDiagramRevision', {
        sessionId,
        diagramId,
        revisionId,
        expectedRevision,
        actorName: 'UX harness',
        actorType: 'agent',
        detail: 'Restored a revision from E2E history coverage',
      }),
      'restoreDiagramRevision',
    );
  }

  async createDiagramWithLatestRevision(sessionId: string, name: string, mermaidText: string): Promise<Diagram> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.getSession(sessionId);
      const payload = await this.tool('createDiagram', {
        sessionId,
        name,
        mermaidText,
        expectedRevision: session.revision,
        actorName: 'UX harness',
        actorType: 'agent',
        detail: 'Prepared revision-history browser coverage',
      });
      if (!isRevisionConflict(payload) || attempt === 1) {
        return this.expectContent<{ diagram: Diagram }>(payload, 'createDiagram').diagram;
      }
    }
    throw new Error('Unreachable createDiagram retry state.');
  }

  async createDiagramFromTemplateWithLatestRevision(sessionId: string, name: string, templateId: string): Promise<Diagram> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.getSession(sessionId);
      const payload = await this.tool('createDiagram', {
        sessionId,
        name,
        templateId,
        expectedRevision: session.revision,
        actorName: 'UX harness',
        actorType: 'agent',
        detail: 'Generated catalog template conformance',
      });
      if (!isRevisionConflict(payload) || attempt === 1) {
        return this.expectContent<{ diagram: Diagram }>(payload, 'createDiagram templateId').diagram;
      }
    }
    throw new Error('Unreachable template createDiagram retry state.');
  }

  async writeLatest(sessionId: string, diagramId: string, mermaidText: string, detail = 'Remote UX anchor update'): Promise<Diagram> {
    const current = await this.readDiagram(sessionId, diagramId);
    const metadata = {
      actorName: 'UX harness',
      actorType: 'agent',
      detail,
    } as const;
    const write = (expectedRevision: string) => this.tool('writeDiagram', {
      sessionId,
      diagramId,
      mermaidText,
      expectedRevision,
      ...metadata,
    });
    const firstWrite = await write(current.revision);
    if (!isRevisionConflict(firstWrite)) {
      return this.expectContent<{ diagram: Diagram }>(firstWrite, 'writeDiagram').diagram;
    }

    const refreshed = await this.readDiagram(sessionId, diagramId);
    return this.expectContent<{ diagram: Diagram }>(await write(refreshed.revision), 'writeDiagram').diagram;
  }
}
