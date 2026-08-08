import { mkdtemp, rm } from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './index.js';
import type { ServerEnv } from './lib/types.js';

const MCP_PROTOCOL_VERSION = '2026-07-28';

describe('server integration', () => {
  let dataDir: string;
  let app: ReturnType<typeof createApp>;
  let port: number;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'arielcharts-server-'));
    const env: ServerEnv = {
      port: 0,
      dataDir,
      cleanupIntervalMs: 60_000,
      sessionTtlMs: 60_000,
      diskTtlMs: Infinity,
      allowedOrigins: ['http://allowed.test'],
    };
    app = createApp(env);

    await new Promise<void>((resolve) => {
      app.server.listen(0, resolve);
    });

    port = (app.server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  async function mcpRequest(options: {
    headerMethod?: string;
    headerName?: string;
    id: number;
    method: string;
    params?: Record<string, unknown>;
    toolName?: string;
  }) {
    const { id, method, params = {}, toolName, headerMethod = method, headerName = toolName } = options;
    return fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-method': headerMethod,
        'mcp-protocol-version': MCP_PROTOCOL_VERSION,
        origin: 'http://allowed.test',
        ...(headerName === undefined ? {} : { 'mcp-name': headerName }),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params: {
          ...params,
          _meta: {
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'arielcharts-server-test', version: '1.0.0' },
            'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
          },
        },
      }),
    });
  }

  it('rejects disallowed origins for the MCP endpoint', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://blocked.test',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'server/discover', params: {} }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Origin not allowed.' });
  });

  it('handles MCP 2026 preflight requests with every required routing header', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://allowed.test',
        'access-control-request-headers': 'content-type,mcp-protocol-version,mcp-method,mcp-name',
      },
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('access-control-allow-origin')).toBe('http://allowed.test');
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toBe('content-type, mcp-protocol-version, mcp-method, mcp-name');
    expect(response.headers.get('access-control-max-age')).toBe('86400');
  });

  it('serves every public modern tool without an MCP transport session', async () => {
    await app.manager.getOrCreateSession('abc123de');

    const discover = await mcpRequest({ id: 1, method: 'server/discover' });
    expect(discover.status).toBe(200);
    expect(discover.headers.get('mcp-session-id')).toBeNull();

    const toolsResponse = await mcpRequest({ id: 2, method: 'tools/list' });
    expect(toolsResponse.status).toBe(200);
    const toolsPayload = await toolsResponse.json() as {
      result: {
        tools: Array<{
          name: string;
          inputSchema?: { properties?: Record<string, { enum?: string[]; description?: string }> };
        }>;
      };
    };
    expect(toolsPayload.result.tools.map((tool) => tool.name)).toEqual([
      'listSessions',
      'getSession',
      'createDiagram',
      'readDiagram',
      'writeDiagram',
      'renameDiagram',
      'deleteDiagram',
    ]);
    const createTool = toolsPayload.result.tools.find((tool) => tool.name === 'createDiagram');
    expect(createTool?.inputSchema?.properties?.templateId?.enum).toEqual([
      'blank',
      'api-sequence',
      'service-flowchart',
      'data-model-er',
      'state-machine',
      'incident-timeline',
      'deployment-architecture',
    ]);
    expect(createTool?.inputSchema?.properties?.templateId?.description).toContain('api-sequence: A request, response');

    const promptsResponse = await mcpRequest({ id: 3, method: 'prompts/list' });
    expect(promptsResponse.status).toBe(200);
    const promptsPayload = await promptsResponse.json() as { result: { prompts: Array<{ name: string }> } };
    expect(promptsPayload.result.prompts.map((prompt) => prompt.name)).toEqual(['diagrammingWorkflow']);

    const listResponse = await mcpRequest({ id: 4, method: 'tools/call', toolName: 'listSessions', params: { name: 'listSessions', arguments: {} } });
    expect(listResponse.status).toBe(200);
    await expect(listResponse.json()).resolves.toMatchObject({ result: { structuredContent: { sessions: [{ id: 'abc123de' }] } } });

    const sessionResponse = await mcpRequest({
      id: 5,
      method: 'tools/call',
      toolName: 'getSession',
      params: { arguments: { sessionId: 'abc123de' }, name: 'getSession' },
    });
    expect(sessionResponse.status).toBe(200);
    const sessionPayload = await sessionResponse.json() as { result: { structuredContent: { revision: string } } };
    const sessionRevision = sessionPayload.result.structuredContent.revision;
    expect(sessionRevision).toEqual(expect.any(String));

    const explicitSourceCreate = await mcpRequest({
      id: 6,
      method: 'tools/call',
      toolName: 'createDiagram',
      params: {
        name: 'createDiagram',
        arguments: {
          sessionId: 'abc123de',
          name: 'Explicit source',
          mermaidText: 'sequenceDiagram\n  Browser->>API: POST /checkout',
          expectedRevision: sessionRevision,
        },
      },
    });
    expect(explicitSourceCreate.status).toBe(200);
    const explicitSourcePayload = await explicitSourceCreate.json() as {
      result: { structuredContent: { diagram: { id: string; mermaidText: string; revision: string } } };
    };
    expect(explicitSourcePayload.result.structuredContent.diagram.mermaidText).toContain('POST /checkout');

    const latestSessionResponse = await mcpRequest({
      id: 7,
      method: 'tools/call',
      toolName: 'getSession',
      params: { arguments: { sessionId: 'abc123de' }, name: 'getSession' },
    });
    const latestSession = await latestSessionResponse.json() as {
      result: { structuredContent: { revision: string; diagrams: Array<{ id: string; name: string; revision: string }> } };
    };
    const latestRevision = latestSession.result.structuredContent.revision;
    const catalogBeforeRejectedCreates = latestSession.result.structuredContent.diagrams;

    const missingSourceCreate = await mcpRequest({
      id: 8,
      method: 'tools/call',
      toolName: 'createDiagram',
      params: { name: 'createDiagram', arguments: { sessionId: 'abc123de', name: 'Missing source', expectedRevision: latestRevision } },
    });
    expect(missingSourceCreate.status).toBe(200);
    await expect(missingSourceCreate.json()).resolves.toMatchObject({ result: { isError: true } });

    const ambiguousSourceCreate = await mcpRequest({
      id: 9,
      method: 'tools/call',
      toolName: 'createDiagram',
      params: {
        name: 'createDiagram',
        arguments: {
          sessionId: 'abc123de',
          name: 'Ambiguous source',
          templateId: 'blank',
          mermaidText: 'flowchart LR\n  A --> B',
          expectedRevision: latestRevision,
        },
      },
    });
    expect(ambiguousSourceCreate.status).toBe(200);
    await expect(ambiguousSourceCreate.json()).resolves.toMatchObject({ result: { isError: true } });

    const afterRejectedCreates = await mcpRequest({
      id: 10,
      method: 'tools/call',
      toolName: 'getSession',
      params: { arguments: { sessionId: 'abc123de' }, name: 'getSession' },
    });
    await expect(afterRejectedCreates.json()).resolves.toMatchObject({
      result: { structuredContent: { revision: latestRevision, diagrams: catalogBeforeRejectedCreates } },
    });

    const createResponse = await mcpRequest({
      id: 11,
      method: 'tools/call',
      toolName: 'createDiagram',
      params: {
        name: 'createDiagram',
        arguments: {
          sessionId: 'abc123de',
          name: 'Checkout API flow',
          templateId: 'api-sequence',
          expectedRevision: latestRevision,
        },
      },
    });
    expect(createResponse.status).toBe(200);
    const createPayload = await createResponse.json() as {
      result: { structuredContent: { diagram: { id: string; mermaidText: string; revision: string } } };
    };
    expect(createPayload.result.structuredContent.diagram.mermaidText).toContain('sequenceDiagram');

    const readResponse = await mcpRequest({
      id: 12,
      method: 'tools/call',
      toolName: 'readDiagram',
      params: { name: 'readDiagram', arguments: { sessionId: 'abc123de', diagramId: createPayload.result.structuredContent.diagram.id } },
    });
    expect(readResponse.status).toBe(200);
    const readPayload = await readResponse.json() as { result: { structuredContent: { diagram: { revision: string; mermaidText: string } } } };
    expect(readPayload.result.structuredContent.diagram.mermaidText).toContain('POST /orders');

    const writeResponse = await mcpRequest({
      id: 13,
      method: 'tools/call',
      toolName: 'writeDiagram',
      params: {
        name: 'writeDiagram',
        arguments: {
          sessionId: 'abc123de',
          diagramId: createPayload.result.structuredContent.diagram.id,
          mermaidText: 'sequenceDiagram\n  Browser->>API: GET /health',
          expectedRevision: readPayload.result.structuredContent.diagram.revision,
        },
      },
    });
    expect(writeResponse.status).toBe(200);
    const writePayload = await writeResponse.json() as { result: { structuredContent: { diagram: { mermaidText: string; revision: string } } } };
    expect(writePayload.result.structuredContent.diagram.mermaidText).toContain('GET /health');

    const staleWrite = await mcpRequest({
      id: 14,
      method: 'tools/call',
      toolName: 'writeDiagram',
      params: { name: 'writeDiagram', arguments: {
        sessionId: 'abc123de',
        diagramId: createPayload.result.structuredContent.diagram.id,
        mermaidText: 'sequenceDiagram\n  Browser->>API: overwrite',
        expectedRevision: readPayload.result.structuredContent.diagram.revision,
      } },
    });
    expect(staleWrite.status).toBe(200);
    await expect(staleWrite.json()).resolves.toMatchObject({ result: { isError: true } });

    const renamedResponse = await mcpRequest({
      id: 15,
      method: 'tools/call',
      toolName: 'renameDiagram',
      params: { name: 'renameDiagram', arguments: {
        sessionId: 'abc123de', diagramId: createPayload.result.structuredContent.diagram.id,
        name: 'Health flow', expectedRevision: writePayload.result.structuredContent.diagram.revision,
      } },
    });
    expect(renamedResponse.status).toBe(200);
    const renamedPayload = await renamedResponse.json() as { result: { structuredContent: { diagram: { revision: string; name: string } } } };
    expect(renamedPayload.result.structuredContent.diagram.name).toBe('Health flow');

    const canonicalRead = await mcpRequest({
      id: 16,
      method: 'tools/call',
      toolName: 'readDiagram',
      params: { name: 'readDiagram', arguments: { sessionId: 'abc123de', diagramId: createPayload.result.structuredContent.diagram.id } },
    });
    await expect(canonicalRead.json()).resolves.toMatchObject({ result: { structuredContent: { diagram: { mermaidText: expect.stringContaining('GET /health') } } } });

    const deleteResponse = await mcpRequest({
      id: 17,
      method: 'tools/call',
      toolName: 'deleteDiagram',
      params: { name: 'deleteDiagram', arguments: {
        sessionId: 'abc123de', diagramId: createPayload.result.structuredContent.diagram.id,
        expectedRevision: renamedPayload.result.structuredContent.diagram.revision,
      } },
    });
    expect(deleteResponse.status).toBe(200);
    await expect(deleteResponse.json()).resolves.toMatchObject({ result: { structuredContent: { deleted: { id: createPayload.result.structuredContent.diagram.id } } } });
  });

  it('rejects routing headers that disagree with the modern JSON-RPC request', async () => {
    const methodMismatch = await mcpRequest({ id: 1, method: 'tools/list', headerMethod: 'prompts/list' });
    expect(methodMismatch.status).toBeGreaterThanOrEqual(400);

    const nameMismatch = await mcpRequest({
      id: 2,
      method: 'tools/call',
      toolName: 'listSessions',
      headerName: 'getSession',
      params: { name: 'listSessions', arguments: {} },
    });
    expect(nameMismatch.status).toBeGreaterThanOrEqual(400);
  });

  it('rejects the retired initialize lifecycle', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://allowed.test' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'legacy', version: '1.0.0' } },
      }),
    });

    expect(response.status).toBeGreaterThanOrEqual(400);
  });
});
