import { mkdtemp, rm } from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import { ALL_STARTER_TEMPLATES } from '@arielcharts/shared';
import { createApp } from './index.js';
import { createActivityEvent } from './lib/activity.js';
import type { ServerEnv } from './lib/types.js';
import { SessionWebSocketServer } from './lib/websocket.js';

const MCP_PROTOCOL_VERSION = '2026-07-28';

describe('server integration', () => {
  let dataDir: string;
  let app: ReturnType<typeof createApp>;
  let port: number;
  let roomKey: string;
  let roomCookie: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'arielcharts-server-'));
    const env: ServerEnv = {
      port: 0,
      dataDir,
      cleanupIntervalMs: 60_000,
      sessionTtlMs: 60_000,
      diskTtlMs: Infinity,
      allowedOrigins: ['http://allowed.test'],
      roomAccessCryptoProfile: 'test',
    };
    app = createApp(env);

    await new Promise<void>((resolve) => {
      app.server.listen(0, resolve);
    });

    port = (app.server.address() as AddressInfo).port;
    const room = await app.createRoom('abc123de');
    roomKey = room.roomKey;
    roomCookie = (app.roomAccess.browserCookieHeaders('abc123de', room.accessVersion)['set-cookie'] as string).split(';')[0]!;
  });

  afterEach(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  async function mcpRequest(options: {
    authorization?: string | null;
    headerMethod?: string;
    headerName?: string;
    id: number;
    method: string;
    params?: Record<string, unknown>;
    toolName?: string;
  }) {
    const { id, method, params = {}, toolName, headerMethod = method, headerName = toolName, authorization = `Bearer abc123de.${roomKey}` } = options;
    return fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-method': headerMethod,
        'mcp-protocol-version': MCP_PROTOCOL_VERSION,
        origin: 'http://allowed.test',
        ...(authorization === null ? {} : { authorization }),
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

  it('rejects ID-only browser JSON requests before a session lookup and sends exact credentialed CORS', async () => {
    const missingId = 'missingzz';
    const url = `http://127.0.0.1:${port}/api/sessions/${missingId}/diagrams/main`;
    const response = await fetch(url, { headers: { origin: 'http://allowed.test' } });
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'Room access denied.' });
    expect(response.headers.get('access-control-allow-origin')).toBe('http://allowed.test');
    expect(response.headers.get('access-control-allow-credentials')).toBe('true');
    expect(await app.manager.readSession(missingId)).toBeNull();
  });

  it('rejects an unauthenticated WebSocket upgrade before it can create a room', async () => {
    const missingId = 'missingws';
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/${missingId}`, { headers: { origin: 'http://allowed.test' } });
    await new Promise<void>((resolve) => {
      socket.once('error', () => resolve());
      socket.once('close', () => resolve());
    });
    expect(await app.manager.readSession(missingId)).toBeNull();
  });

  it('revalidates browser room access immediately before a WebSocket upgrade', async () => {
    const authenticate = vi.spyOn(app.roomAccess, 'authenticateBrowserCookie')
      .mockResolvedValueOnce({ sessionId: 'abc123de', accessVersion: 1 })
      .mockRejectedValueOnce(new Error('Room key rotated.'));
    const upgrade = vi.spyOn(SessionWebSocketServer.prototype, 'upgrade');
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/abc123de`, {
      headers: { origin: 'http://allowed.test', cookie: roomCookie },
    });

    try {
      await new Promise<void>((resolve) => {
        socket.once('error', resolve);
        socket.once('close', resolve);
      });
      expect(authenticate).toHaveBeenCalledTimes(2);
      expect(upgrade).not.toHaveBeenCalled();
    } finally {
      authenticate.mockRestore();
      upgrade.mockRestore();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
        socket.terminate();
      }
    }
  });

  it('rejects a stale final WebSocket authorization after room-key rotation completes', async () => {
    const originalAuthenticate = app.roomAccess.authenticateBrowserCookie.bind(app.roomAccess);
    const staleAuthorization = { sessionId: 'abc123de', accessVersion: 1 };
    let releaseFinalAuthorization!: () => void;
    let markFinalAuthorizationPending!: () => void;
    const finalAuthorization = new Promise<typeof staleAuthorization>((resolve) => {
      releaseFinalAuthorization = () => resolve(staleAuthorization);
    });
    const finalAuthorizationPending = new Promise<void>((resolve) => {
      markFinalAuthorizationPending = resolve;
    });
    let authenticationCount = 0;
    const authenticate = vi.spyOn(app.roomAccess, 'authenticateBrowserCookie').mockImplementation((sessionId, request) => {
      authenticationCount += 1;
      if (authenticationCount === 2) {
        markFinalAuthorizationPending();
        return finalAuthorization;
      }
      return originalAuthenticate(sessionId, request);
    });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/abc123de`, {
      headers: { origin: 'http://allowed.test', cookie: roomCookie },
    });

    try {
      await finalAuthorizationPending;
      const rotated = await fetch(`http://127.0.0.1:${port}/api/rooms/abc123de/rotate`, {
        method: 'POST',
        headers: { origin: 'http://allowed.test', cookie: roomCookie },
      });
      expect(rotated.status).toBe(200);

      const rejected = new Promise<void>((resolve, reject) => {
        socket.once('open', () => reject(new Error('Expected stale authorization to reject the WebSocket upgrade.')));
        socket.once('error', () => resolve());
        socket.once('close', () => resolve());
      });
      releaseFinalAuthorization();
      await rejected;

      const session = await app.manager.requireSession('abc123de');
      expect(authenticationCount).toBe(3);
      expect(session.sockets.size).toBe(0);
    } finally {
      releaseFinalAuthorization();
      authenticate.mockRestore();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
        socket.terminate();
      }
    }
  });

  it('exchanges a raw key once, rotates capability access, and revokes existing WebSocket, cookie, and MCP authorization', async () => {
    const accessUrl = `http://127.0.0.1:${port}/api/rooms/abc123de/access`;
    const exchange = await fetch(accessUrl, {
      method: 'POST',
      headers: { origin: 'http://allowed.test', 'content-type': 'application/json' },
      body: JSON.stringify({ room_key: roomKey }),
    });
    expect(exchange.status).toBe(204);
    const oldCookie = exchange.headers.get('set-cookie')!.split(';')[0]!;
    expect(exchange.headers.get('cache-control')).toBe('no-store');
    await expect(fetch(accessUrl, { headers: { origin: 'http://allowed.test', cookie: oldCookie } })).resolves.toMatchObject({ status: 204 });

    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/abc123de`, { headers: { origin: 'http://allowed.test', cookie: oldCookie } });
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
    const rotate = await fetch(`http://127.0.0.1:${port}/api/rooms/abc123de/rotate`, {
      method: 'POST',
      headers: { origin: 'http://allowed.test', cookie: oldCookie },
    });
    expect(rotate.status).toBe(200);
    const rotated = await rotate.json() as { room_key: string };
    const newCookie = rotate.headers.get('set-cookie')!.split(';')[0]!;
    await closed;
    await expect(fetch(accessUrl, { headers: { origin: 'http://allowed.test', cookie: oldCookie } })).resolves.toMatchObject({ status: 401 });
    await expect(fetch(accessUrl, { headers: { origin: 'http://allowed.test', cookie: newCookie } })).resolves.toMatchObject({ status: 204 });
    expect((await mcpRequest({ id: 900, method: 'server/discover', authorization: `Bearer abc123de.${roomKey}` })).status).toBe(401);
    expect((await mcpRequest({ id: 901, method: 'server/discover', authorization: `Bearer abc123de.${rotated.room_key}` })).status).toBe(200);
  });

  it('requires a bearer for MCP discovery and rejects a tool session that differs from its bearer-bound room', async () => {
    expect((await mcpRequest({ id: 920, method: 'server/discover', authorization: null })).status).toBe(401);
    expect((await mcpRequest({ id: 921, method: 'server/discover', authorization: 'Bearer abc123de.invalid' })).status).toBe(401);
    await app.createRoom('other123');
    const crossRoom = await mcpRequest({
      id: 922,
      method: 'tools/call',
      toolName: 'getSession',
      params: { name: 'getSession', arguments: { sessionId: 'other123' } },
    });
    expect(crossRoom.status).toBe(200);
    await expect(crossRoom.json()).resolves.toMatchObject({ result: { isError: true } });
  });

  it('does not materialize an MCP participant for an invalid bearer mutation', async () => {
    const initial = await app.manager.readDiagram('abc123de', 'main');
    const rejected = await mcpRequest({
      id: 923,
      method: 'tools/call',
      toolName: 'writeDiagram',
      authorization: 'Bearer abc123de.invalid',
      params: {
        name: 'writeDiagram',
        arguments: {
          sessionId: 'abc123de',
          diagramId: 'main',
          mermaidText: 'flowchart LR\n  Rejected --> Write',
          expectedRevision: initial.diagram.revision,
          actorName: 'Rejected Agent',
        },
      },
    });

    expect(rejected.status).toBe(401);
    const session = await app.manager.getOrCreateSession('abc123de');
    expect([...session.doc.getMap('presence').entries()]).toEqual([]);
    expect((await app.manager.readSession('abc123de'))?.activity).toEqual([]);
  });

  it('binds each modern MCP request to its current bearer', async () => {
    const otherRoom = await app.createRoom('other123');
    const getSession = (id: number, sessionId: string, authorization?: string) => mcpRequest({
      id,
      method: 'tools/call',
      toolName: 'getSession',
      ...(authorization === undefined ? {} : { authorization }),
      params: { name: 'getSession', arguments: { sessionId } },
    });

    const firstRoom = await getSession(930, 'abc123de');
    const secondRoom = await getSession(931, 'other123', `Bearer other123.${otherRoom.roomKey}`);
    const firstRoomAgain = await getSession(932, 'abc123de');
    expect(firstRoom.status).toBe(200);
    expect(secondRoom.status).toBe(200);
    expect(firstRoomAgain.status).toBe(200);
    await expect(firstRoom.json()).resolves.toMatchObject({ result: { structuredContent: { sessionId: 'abc123de' } } });
    await expect(secondRoom.json()).resolves.toMatchObject({ result: { structuredContent: { sessionId: 'other123' } } });
    await expect(firstRoomAgain.json()).resolves.toMatchObject({ result: { structuredContent: { sessionId: 'abc123de' } } });
  });

  it('keeps invalid room requests generic but reports unexpected room-access failures', async () => {
    const accessUrl = `http://127.0.0.1:${port}/api/rooms/abc123de/access`;
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const invalidSession = await fetch(`http://127.0.0.1:${port}/api/rooms/no/access`, {
        headers: { origin: 'http://allowed.test' },
      });
      expect(invalidSession.status).toBe(401);
      await expect(invalidSession.json()).resolves.toEqual({ error: 'Room access denied.' });

      vi.spyOn(app.roomAccess, 'authenticateBrowserCookie').mockRejectedValueOnce(new Error('LevelDB unavailable'));
      const failedAccess = await fetch(accessUrl, { headers: { origin: 'http://allowed.test', cookie: roomCookie } });
      expect(failedAccess.status).toBe(500);
      await expect(failedAccess.json()).resolves.toEqual({ error: 'Room access unavailable.' });

      vi.spyOn(app.roomAccess, 'rotate').mockRejectedValueOnce(new Error('LevelDB unavailable'));
      const failedRotation = await fetch(`http://127.0.0.1:${port}/api/rooms/abc123de/rotate`, {
        method: 'POST',
        headers: { origin: 'http://allowed.test', cookie: roomCookie },
      });
      expect(failedRotation.status).toBe(500);
      await expect(failedRotation.json()).resolves.toEqual({ error: 'Room access unavailable.' });
      expect(log).toHaveBeenCalledTimes(2);
    } finally {
      log.mockRestore();
      vi.restoreAllMocks();
    }
  });

  it('serves every room-bound modern tool without an MCP transport session or room enumeration', async () => {

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
      'getSession',
      'createDiagram',
      'readDiagram',
      'listDiagramHistory',
      'readDiagramRevision',
      'writeDiagram',
      'renameDiagram',
      'deleteDiagram',
      'restoreDiagramRevision',
    ]);
    const createTool = toolsPayload.result.tools.find((tool) => tool.name === 'createDiagram');
    expect(createTool?.inputSchema?.properties?.templateId?.enum).toEqual(ALL_STARTER_TEMPLATES.map((template) => template.id));
    expect(createTool?.inputSchema?.properties?.templateId?.description).toContain('sequence: A minimal sequence message');

    const promptsResponse = await mcpRequest({ id: 3, method: 'prompts/list' });
    expect(promptsResponse.status).toBe(200);
    const promptsPayload = await promptsResponse.json() as { result: { prompts: Array<{ name: string }> } };
    expect(promptsPayload.result.prompts.map((prompt) => prompt.name)).toEqual(['diagrammingWorkflow']);

    const sessionResponse = await mcpRequest({
      id: 4,
      method: 'tools/call',
      toolName: 'getSession',
      params: { arguments: { sessionId: 'abc123de' }, name: 'getSession' },
    });
    expect(sessionResponse.status).toBe(200);
    const sessionPayload = await sessionResponse.json() as { result: { structuredContent: { revision: string } } };
    const sessionRevision = sessionPayload.result.structuredContent.revision;
    expect(sessionRevision).toEqual(expect.any(String));

    const explicitSourceCreate = await mcpRequest({
      id: 5,
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
      id: 6,
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
      id: 7,
      method: 'tools/call',
      toolName: 'createDiagram',
      params: { name: 'createDiagram', arguments: { sessionId: 'abc123de', name: 'Missing source', expectedRevision: latestRevision } },
    });
    expect(missingSourceCreate.status).toBe(200);
    await expect(missingSourceCreate.json()).resolves.toMatchObject({ result: { isError: true } });

    const ambiguousSourceCreate = await mcpRequest({
      id: 8,
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
      id: 9,
      method: 'tools/call',
      toolName: 'getSession',
      params: { arguments: { sessionId: 'abc123de' }, name: 'getSession' },
    });
    await expect(afterRejectedCreates.json()).resolves.toMatchObject({
      result: { structuredContent: { revision: latestRevision, diagrams: catalogBeforeRejectedCreates } },
    });

    const createResponse = await mcpRequest({
      id: 10,
      method: 'tools/call',
      toolName: 'createDiagram',
      params: {
        name: 'createDiagram',
        arguments: {
          sessionId: 'abc123de',
          name: 'Checkout API flow',
          templateId: 'sequence',
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
      id: 11,
      method: 'tools/call',
      toolName: 'readDiagram',
      params: { name: 'readDiagram', arguments: { sessionId: 'abc123de', diagramId: createPayload.result.structuredContent.diagram.id } },
    });
    expect(readResponse.status).toBe(200);
    const readPayload = await readResponse.json() as { result: { structuredContent: { diagram: { revision: string; mermaidText: string } } } };
    expect(readPayload.result.structuredContent.diagram.mermaidText).toContain('A->>B: Request');

    const writeResponse = await mcpRequest({
      id: 12,
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
      id: 13,
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
      id: 14,
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
      id: 15,
      method: 'tools/call',
      toolName: 'readDiagram',
      params: { name: 'readDiagram', arguments: { sessionId: 'abc123de', diagramId: createPayload.result.structuredContent.diagram.id } },
    });
    await expect(canonicalRead.json()).resolves.toMatchObject({ result: { structuredContent: { diagram: { mermaidText: expect.stringContaining('GET /health') } } } });

    const deleteResponse = await mcpRequest({
      id: 16,
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
      toolName: 'getSession',
      headerName: 'readDiagram',
      params: { name: 'getSession', arguments: { sessionId: 'abc123de' } },
    });
    expect(nameMismatch.status).toBeGreaterThanOrEqual(400);
  });

  it('exposes origin-checked current, history, immutable revision, and revision-checked restore routes', async () => {
    const initial = await app.manager.readDiagram('abc123de', 'main');
    await app.manager.writeDiagram(
      'abc123de',
      'main',
      'sequenceDiagram\n  Browser->>API: GET /health',
      initial.diagram.revision,
      createActivityEvent({ action: 'edited', actorName: 'Ada', actorType: 'human', detail: 'added health request' }),
    );

    const baseUrl = `http://127.0.0.1:${port}/api/sessions/abc123de/diagrams/main`;
    const headers = { origin: 'http://allowed.test', cookie: roomCookie };
    const preflight = await fetch(`${baseUrl}/history`, {
      method: 'OPTIONS',
      headers: { ...headers, 'access-control-request-headers': 'content-type' },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('access-control-allow-methods')).toBe('GET, POST, OPTIONS');
    const current = await fetch(baseUrl, { headers });
    expect(current.status).toBe(200);
    const currentPayload = await current.json() as { diagram: { revision: string; mermaid_text: string } };
    expect(currentPayload.diagram.mermaid_text).toContain('GET /health');

    const history = await fetch(`${baseUrl}/history`, { headers });
    expect(history.status).toBe(200);
    const historyPayload = await history.json() as {
      current_revision: string;
      revisions: Array<{ revision_id: string; sequence: number; name: string }>;
    };
    expect(historyPayload.current_revision).toBe(currentPayload.diagram.revision);
    expect(historyPayload.revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Main', revision_id: expect.any(String), sequence: expect.any(Number) }),
    ]));

    const targetId = historyPayload.revisions.at(-1)!.revision_id;
    const revision = await fetch(`${baseUrl}/history/${encodeURIComponent(targetId)}`, { headers });
    expect(revision.status).toBe(200);
    await expect(revision.json()).resolves.toMatchObject({
      revision: { revision_id: targetId, diagram_id: 'main', mermaid_text: expect.any(String), node_positions: expect.any(Object) },
    });

    const restored = await fetch(`${baseUrl}/history/${encodeURIComponent(targetId)}/restore`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ actor_name: 'Ada', actor_type: 'human', expected_revision: currentPayload.diagram.revision }),
    });
    expect(restored.status).toBe(200);
    const restoredPayload = await restored.json() as {
      status: string;
      diagram: { revision: string };
      revision: { origin?: string; restored_from_revision_id?: string };
    };
    expect(restoredPayload).toMatchObject({ status: 'restored', revision: { origin: 'browser', restored_from_revision_id: targetId } });

    const stale = await fetch(`${baseUrl}/history/${encodeURIComponent(targetId)}/restore`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_revision: currentPayload.diagram.revision }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      status: 'stale',
      current_revision: restoredPayload.diagram.revision,
    });

    const oversized = await fetch(`${baseUrl}/history/${encodeURIComponent(targetId)}/restore`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_revision: restoredPayload.diagram.revision, detail: 'x'.repeat(1_048_576) }),
    });
    expect(oversized.status).toBe(413);
    await expect(oversized.json()).resolves.toEqual({ error: 'Request body too large.' });

    const blocked = await fetch(`${baseUrl}/history`, { headers: { origin: 'http://blocked.test' } });
    expect(blocked.status).toBe(403);
    await expect(blocked.json()).resolves.toEqual({ error: 'Origin not allowed.' });
  });

  it('exposes overlay history only on cookie-authenticated browser routes', async () => {
    const state = await app.manager.getOrCreateSession('abc123de');
    const scene = state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!;
    const object = new Y.Map<unknown>();
    object.set('kind', 'foundation.card');
    object.set('version', 1);
    object.set('order_key', 'a');
    object.set('geometry', { x: 1, y: 2, width: 3, height: 4, rotation: 0 });
    object.set('style', {});
    object.set('metadata', {});
    object.set('payload', { text: 'hello' });
    (scene.get('objects') as Y.Map<Y.Map<unknown>>).set('note', object);
    await app.manager.persistSession(state);

    const baseUrl = `http://127.0.0.1:${port}/api/sessions/abc123de/diagrams/main/overlays`;
    const headers = { origin: 'http://allowed.test', cookie: roomCookie };
    const current = await fetch(baseUrl, { headers });
    const currentPayload = await current.json() as { revision: string; scene: { objects: unknown[] } };
    expect(current.status).toBe(200);
    expect(currentPayload.scene.objects).toHaveLength(1);
    const history = await fetch(`${baseUrl}/history`, { headers });
    const historyPayload = await history.json() as { revisions: Array<{ revision_id: string }>; current_revision: string };
    expect(historyPayload.current_revision).toBe(currentPayload.revision);
    const baselineId = historyPayload.revisions.at(-1)!.revision_id;
    const oversizedActor = await fetch(`${baseUrl}/history/${baselineId}/restore`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_revision: currentPayload.revision, actor_name: 'x'.repeat(257) }),
    });
    expect(oversizedActor.status).toBe(400);
    const historyAfterRejectedActor = await fetch(`${baseUrl}/history`, { headers });
    expect((await historyAfterRejectedActor.json() as { revisions: unknown[] }).revisions).toHaveLength(historyPayload.revisions.length);
    const restore = await fetch(`${baseUrl}/history/${baselineId}/restore`, {
      method: 'POST',
      headers: { ...headers, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_revision: currentPayload.revision, actor_name: 'Ada' }),
    });
    expect(restore.status).toBe(200);
    await expect(restore.json()).resolves.toMatchObject({ status: 'restored', scene: { objects: [] }, revision: { restored_from_revision_id: baselineId } });
    expect((await app.manager.readDiagram('abc123de', 'main')).diagram.mermaid_text).toBe('');

    const unsupported = new Y.Map<unknown>();
    unsupported.set('kind', 'future.tool'); unsupported.set('version', 1); unsupported.set('order_key', 'future');
    unsupported.set('geometry', { x: 1, y: 2, width: 3, height: 4, rotation: 0 });
    unsupported.set('style', {}); unsupported.set('metadata', {}); unsupported.set('payload', { opaque: 'keep' });
    const restoredScene = state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!;
    (restoredScene.get('objects') as Y.Map<Y.Map<unknown>>).set('future', unsupported);
    await app.manager.persistSession(state);
    const rawBefore = Buffer.from(Y.encodeStateAsUpdate(state.doc));
    for (const [url, init] of [
      [baseUrl, { headers }],
      [`${baseUrl}/history`, { headers }],
      [`${baseUrl}/history/${baselineId}/restore`, {
        method: 'POST', headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ expected_revision: 'unused', actor_name: 'Ada' }),
      }],
    ] as const) {
      const rejected = await fetch(url, init);
      expect(rejected.status).toBe(422);
      await expect(rejected.json()).resolves.toMatchObject({ error: 'Unsupported overlay object: future.tool@1' });
    }
    expect(Buffer.from(Y.encodeStateAsUpdate(state.doc))).toEqual(rawBefore);
    expect(unsupported.get('payload')).toEqual({ opaque: 'keep' });

    const unauthenticated = await fetch(`${baseUrl}/history`, { headers: { origin: 'http://allowed.test' } });
    expect(unauthenticated.status).toBe(401);
  });

  it('discovers history tools with named metadata and returns a structured stale restore result', async () => {
    const initial = await app.manager.readDiagram('abc123de', 'main');
    await app.manager.writeDiagram(
      'abc123de',
      'main',
      'sequenceDiagram\n  Browser->>API: GET /health',
      initial.diagram.revision,
      createActivityEvent({ action: 'edited', actorName: 'Ada', actorType: 'human', detail: 'added health request' }),
    );

    const listed = await mcpRequest({
      id: 40,
      method: 'tools/call',
      toolName: 'listDiagramHistory',
      params: { name: 'listDiagramHistory', arguments: { sessionId: 'abc123de', diagramId: 'main' } },
    });
    const listedPayload = await listed.json() as {
      result: { structuredContent: { currentRevision: string; revisions: Array<{ id: string; diagramId: string; diagramName: string }> } };
    };
    expect(listedPayload.result.structuredContent.revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ diagramId: 'main', diagramName: 'Main', id: expect.any(String) }),
    ]));

    const revisionId = listedPayload.result.structuredContent.revisions.at(-1)!.id;
    const readRevision = await mcpRequest({
      id: 41,
      method: 'tools/call',
      toolName: 'readDiagramRevision',
      params: { name: 'readDiagramRevision', arguments: { sessionId: 'abc123de', diagramId: 'main', revisionId } },
    });
    await expect(readRevision.json()).resolves.toMatchObject({
      result: { structuredContent: { revision: { id: revisionId, diagramId: 'main', mermaidText: expect.any(String) } } },
    });

    const fresh = await mcpRequest({
      id: 42,
      method: 'tools/call',
      toolName: 'readDiagram',
      params: { name: 'readDiagram', arguments: { sessionId: 'abc123de', diagramId: 'main' } },
    });
    const freshPayload = await fresh.json() as { result: { structuredContent: { diagram: { revision: string } } } };

    const restored = await mcpRequest({
      id: 43,
      method: 'tools/call',
      toolName: 'restoreDiagramRevision',
      params: { name: 'restoreDiagramRevision', arguments: {
        sessionId: 'abc123de', diagramId: 'main', revisionId, expectedRevision: freshPayload.result.structuredContent.diagram.revision,
      } },
    });
    expect(restored.status).toBe(200);
    await expect(restored.json()).resolves.toMatchObject({
      result: { structuredContent: { revision: { origin: 'mcp', restoredFromRevisionId: revisionId } } },
    });

    const stale = await mcpRequest({
      id: 44,
      method: 'tools/call',
      toolName: 'restoreDiagramRevision',
      params: { name: 'restoreDiagramRevision', arguments: {
        sessionId: 'abc123de', diagramId: 'main', revisionId, expectedRevision: freshPayload.result.structuredContent.diagram.revision,
      } },
    });
    expect(stale.status).toBe(200);
    await expect(stale.json()).resolves.toMatchObject({
      result: {
        isError: true,
        structuredContent: { error: { code: 'STALE_DIAGRAM_REVISION', currentDiagram: { id: 'main' } } },
      },
    });
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
