import { assert } from './assert.ts';

const MCP_PROTOCOL_VERSION = '2026-07-28';
const MCP_FETCH_TIMEOUT_MS = 15_000;

export type Diagram = { id: string; mermaidText: string; name: string; revision: string };
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

  return /stale (?:diagram )?revision|revision conflict/i.test(message);
}

export class ModernMcpClient {
  private nextId = 1;

  constructor(private readonly endpoint: string, private readonly origin: string) {}

  async tool(name: string, args: Record<string, unknown>): Promise<McpPayload> {
    try {
      const response = await fetch(this.endpoint, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'mcp-method': 'tools/call',
          'mcp-name': name,
          'mcp-protocol-version': MCP_PROTOCOL_VERSION,
          origin: this.origin,
        },
        signal: AbortSignal.timeout(MCP_FETCH_TIMEOUT_MS),
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: this.nextId++,
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
      if (!response.ok) {
        throw new Error(`MCP ${name} returned HTTP ${response.status}: ${await response.text()}`);
      }
      return response.json() as Promise<McpPayload>;
    } catch (error) {
      throw new Error(`MCP ${name} request failed within ${MCP_FETCH_TIMEOUT_MS / 1_000}s`, { cause: error });
    }
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
