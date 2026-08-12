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
import { canonicalWorkspaceJson } from './lib/workspace-import.js';
import { createHash } from 'node:crypto';

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

  function signedWorkspaceBundle(source = 'flowchart TD\n  A[Import] --> B[Ready]') {
    const payload = {
      schema_version: 1 as const,
      order: ['main'],
      diagrams: [{
        id: 'main', name: 'Imported',
        mermaid: { schema_version: 1 as const, source },
        layout: { schema_version: 1 as const, positions: { A: { x: 12, y: 24 } } },
        overlay: {
          version: 1,
          diagram_id: 'main',
          objects: [{
            id: 'note', kind: 'annotation.sticky', version: 1, order_key: '0001',
            geometry: { x: 10, y: 20, width: 120, height: 80, rotation: 0 },
            style: {}, metadata: {}, payload: {}, body: 'Imported note',
          }],
          layers: [{ id: 'default', name: 'Default', order_key: '0000000000000000', visible: true, locked: false, export: true }],
        },
      }],
    };
    return {
      format: 'arielcharts.workspace' as const,
      version: 1 as const,
      payload,
      integrity: { algorithm: 'SHA-256' as const, value: createHash('sha256').update(canonicalWorkspaceJson(payload)).digest('hex') },
    };
  }

  async function workspaceRevision() {
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions/abc123de/workspace`, {
      headers: { origin: 'http://allowed.test', cookie: roomCookie },
    });
    expect(response.status).toBe(200);
    return response.json() as Promise<{ revision: string }>;
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

  it('server-authoritatively imports one signed workspace atomically while retaining activity and presence', async () => {
    const session = await app.manager.requireSession('abc123de');
    session.doc.transact(() => {
      session.doc.getArray('activity').push([createActivityEvent({ action: 'edited', actorName: 'Existing', actorType: 'human', detail: 'Keep this.' })]);
    });
    session.awareness.setLocalState({ user: { name: 'Existing', color: '#123456', type: 'human' } });
    await app.manager.persistSession(session);
    const before = await workspaceRevision();
    const response = await fetch(`http://127.0.0.1:${port}/api/sessions/abc123de/workspace`, {
      method: 'POST',
      headers: { origin: 'http://allowed.test', cookie: roomCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_revision: before.revision, bundle: signedWorkspaceBundle() }),
    });
    expect(response.status).toBe(200);
    const imported = await response.json() as { status: string; revision: string };
    expect(imported.status).toBe('imported');
    expect(imported.revision).not.toBe(before.revision);
    await expect(app.manager.readDiagram('abc123de', 'main')).resolves.toMatchObject({ diagram: { name: 'Imported', mermaid_text: 'flowchart TD\n  A[Import] --> B[Ready]' } });
    await expect(app.manager.readOverlayScene('abc123de', 'main')).resolves.toMatchObject({ scene: { objects: [{ id: 'note', body: 'Imported note' }] } });
    const after = await app.manager.readSession('abc123de');
    expect(after?.activity).toHaveLength(1);
    expect(after?.participants).toEqual([{ name: 'Existing', color: '#123456', type: 'human' }]);
  });

  it('rejects stale or tampered workspace imports without mutating the room', async () => {
    const before = await workspaceRevision();
    const bundle = signedWorkspaceBundle();
    const stale = await fetch(`http://127.0.0.1:${port}/api/sessions/abc123de/workspace`, {
      method: 'POST', headers: { origin: 'http://allowed.test', cookie: roomCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_revision: 'stale', bundle }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({ status: 'stale', revision: before.revision });
    bundle.payload.diagrams[0]!.mermaid.source = 'flowchart TD\n  Tampered';
    const tampered = await fetch(`http://127.0.0.1:${port}/api/sessions/abc123de/workspace`, {
      method: 'POST', headers: { origin: 'http://allowed.test', cookie: roomCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_revision: before.revision, bundle }),
    });
    expect(tampered.status).toBe(400);
    await expect(app.manager.readDiagram('abc123de', 'main')).resolves.toMatchObject({ diagram: { mermaid_text: '' } });
    await expect(workspaceRevision()).resolves.toEqual(before);
  });

  it('refuses opaque existing overlay roots without collapsing their revision, peer state, activity, or presence', async () => {
    const session = await app.manager.requireSession('abc123de');
    session.doc.transact(() => {
      session.doc.getArray('activity').push([createActivityEvent({ action: 'edited', actorName: 'Existing', actorType: 'human', detail: 'Do not replace.' })]);
      const scene = new Y.Map<unknown>();
      scene.set('version', 2); scene.set('objects', new Y.Map()); scene.set('layers', new Y.Map());
      session.doc.getMap('overlays').set('main', scene);
    });
    session.awareness.setLocalState({ user: { name: 'Existing', color: '#123456', type: 'human' } });
    const newerSceneRevision = await workspaceRevision();
    session.doc.transact(() => (session.doc.getMap('overlays').get('main') as Y.Map<unknown>).set('version', 3));
    const changedOpaqueRevision = await workspaceRevision();
    expect(changedOpaqueRevision.revision).not.toBe(newerSceneRevision.revision);
    const persistedBefore = Buffer.from(Y.encodeStateAsUpdate(session.doc));
    const peerUpdates: Uint8Array[] = [];
    const observePeer = (update: Uint8Array) => peerUpdates.push(update);
    session.doc.on('update', observePeer);
    try {
      const rejected = await fetch(`http://127.0.0.1:${port}/api/sessions/abc123de/workspace`, {
        method: 'POST', headers: { origin: 'http://allowed.test', cookie: roomCookie, 'content-type': 'application/json' },
        body: JSON.stringify({ expected_revision: changedOpaqueRevision.revision, bundle: signedWorkspaceBundle() }),
      });
      expect(rejected.status).toBe(400);
      await expect(rejected.json()).resolves.toMatchObject({ error: expect.stringMatching(/unsupported overlay scene/u) });
      expect(Buffer.from(Y.encodeStateAsUpdate(session.doc))).toEqual(persistedBefore);
      expect(peerUpdates).toEqual([]);
      expect(session.doc.getArray('activity')).toHaveLength(1);
      expect(session.awareness.getLocalState()).toEqual({ user: { name: 'Existing', color: '#123456', type: 'human' } });
    } finally {
      session.doc.off('update', observePeer);
    }

    session.doc.transact(() => {
      const scene = session.doc.getMap('overlays').get('main') as Y.Map<unknown>;
      scene.set('version', 1);
      const layers = new Y.Map<unknown>(); const layer = new Y.Map<unknown>();
      layer.set('id', 'default'); layer.set('name', 'Default'); layer.set('order_key', 'a'); layer.set('visible', true); layer.set('locked', false); layer.set('export', true);
      layers.set('default', layer); scene.set('layers', layers);
      const objects = new Y.Map<unknown>(); const object = new Y.Map<unknown>();
      object.set('kind', 'future.widget'); object.set('version', 1); object.set('order_key', 'a'); object.set('geometry', { x: 0, y: 0, width: 1, height: 1, rotation: 0 }); object.set('style', {}); object.set('metadata', {}); object.set('payload', {});
      objects.set('opaque', object); scene.set('objects', objects);
    });
    const unknownObjectRevision = await workspaceRevision();
    const objectRejected = await fetch(`http://127.0.0.1:${port}/api/sessions/abc123de/workspace`, {
      method: 'POST', headers: { origin: 'http://allowed.test', cookie: roomCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_revision: unknownObjectRevision.revision, bundle: signedWorkspaceBundle() }),
    });
    expect(objectRejected.status).toBe(400);
    await expect(objectRejected.json()).resolves.toMatchObject({ error: expect.stringMatching(/unsupported overlay object/u) });

    session.doc.transact(() => {
      const scene = session.doc.getMap('overlays').get('main') as Y.Map<unknown>;
      scene.set('objects', new Y.Map());
      const layer = (scene.get('layers') as Y.Map<Y.Map<unknown>>).get('default')!;
      layer.set('future_schema', true);
    });
    const unknownLayerRevision = await workspaceRevision();
    const layerRejected = await fetch(`http://127.0.0.1:${port}/api/sessions/abc123de/workspace`, {
      method: 'POST', headers: { origin: 'http://allowed.test', cookie: roomCookie, 'content-type': 'application/json' },
      body: JSON.stringify({ expected_revision: unknownLayerRevision.revision, bundle: signedWorkspaceBundle() }),
    });
    expect(layerRejected.status).toBe(400);
    await expect(layerRejected.json()).resolves.toMatchObject({ error: expect.stringMatching(/unsupported overlay layer/u) });
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

  it('serves revision-safe overlay operations with a structured stale reread payload and no Mermaid activity', async () => {
    const sourceBefore = await app.manager.readDiagram('abc123de', 'main');
    const read = await mcpRequest({
      id: 924, method: 'tools/call', toolName: 'readOverlayScene',
      params: { name: 'readOverlayScene', arguments: { sessionId: 'abc123de', diagramId: 'main' } },
    });
    expect(read.status).toBe(200);
    const readPayload = await read.json() as { result: { structuredContent: { scene: { overlayRevision: string } } } };
    const initialRevision = readPayload.result.structuredContent.scene.overlayRevision;
    const object = {
      id: 'protocol-note', kind: 'foundation.card', version: 1, orderKey: 'a',
      geometry: { x: 10, y: 20, width: 120, height: 72, rotation: 0 }, style: {}, metadata: {}, payload: { text: 'Protocol' },
    };
    const create = await mcpRequest({
      id: 925, method: 'tools/call', toolName: 'createOverlayObject',
      params: { name: 'createOverlayObject', arguments: { sessionId: 'abc123de', diagramId: 'main', expectedOverlayRevision: initialRevision, object, actorName: 'Overlay Protocol Agent' } },
    });
    expect(create.status).toBe(200);
    const createPayload = await create.json() as { result: { structuredContent: { overlayRevision: string; object: { id: string } } } };
    expect(createPayload.result.structuredContent.object).toEqual({ ...object, orderKey: 'a' });

    const stale = await mcpRequest({
      id: 926, method: 'tools/call', toolName: 'updateOverlayObject',
      params: { name: 'updateOverlayObject', arguments: { sessionId: 'abc123de', diagramId: 'main', objectId: 'protocol-note', expectedOverlayRevision: initialRevision, patch: { metadata: { owner: 'stale' } } } },
    });
    expect(stale.status).toBe(200);
    const stalePayload = await stale.json() as { result: { isError: boolean; structuredContent: { error: { code: string; currentOverlayScene: { overlayRevision: string; objects: Array<{ id: string }> } } } } };
    expect(stalePayload.result).toMatchObject({ isError: true, structuredContent: { error: { code: 'STALE_OVERLAY_REVISION', currentOverlayScene: { objects: [{ id: 'protocol-note' }] } } } });
    const retry = await mcpRequest({
      id: 927, method: 'tools/call', toolName: 'updateOverlayObject',
      params: { name: 'updateOverlayObject', arguments: { sessionId: 'abc123de', diagramId: 'main', objectId: 'protocol-note', expectedOverlayRevision: stalePayload.result.structuredContent.error.currentOverlayScene.overlayRevision, patch: { metadata: { owner: 'merged' } } } },
    });
    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ result: { structuredContent: { object: { metadata: { owner: 'merged' } } } } });
    expect((await app.manager.readDiagram('abc123de', 'main')).diagram).toEqual(sourceBefore.diagram);
    expect((await app.manager.readSession('abc123de'))?.activity).toEqual([]);
  });

  it('serves bounded overlay listing and found, opaque, and missing object reads', async () => {
    const scene = await app.manager.readMcpOverlayScene('abc123de', 'main');
    await app.manager.createMcpOverlayObject('abc123de', 'main', scene.overlay_revision, {
      id: 'inspectable', kind: 'foundation.card', version: 1, order_key: 'a',
      geometry: { x: 0, y: 0, width: 20, height: 20, rotation: 0 }, style: {}, metadata: {}, payload: { safe: true },
    });
    const listed = await mcpRequest({ id: 928, method: 'tools/call', toolName: 'listOverlayObjects', params: { name: 'listOverlayObjects', arguments: { sessionId: 'abc123de', diagramId: 'main' } } });
    await expect(listed.json()).resolves.toMatchObject({ result: { structuredContent: { scene: { writable: true, objects: [{ id: 'inspectable', opaque: false, orderKey: 'a' }] } } } });
    const found = await mcpRequest({ id: 929, method: 'tools/call', toolName: 'readOverlayObject', params: { name: 'readOverlayObject', arguments: { sessionId: 'abc123de', diagramId: 'main', objectId: 'inspectable' } } });
    await expect(found.json()).resolves.toMatchObject({ result: { structuredContent: { status: 'found', object: { id: 'inspectable' } } } });
    const missing = await mcpRequest({ id: 930, method: 'tools/call', toolName: 'readOverlayObject', params: { name: 'readOverlayObject', arguments: { sessionId: 'abc123de', diagramId: 'main', objectId: 'deleted' } } });
    await expect(missing.json()).resolves.toMatchObject({ result: { structuredContent: { status: 'missing', objectId: 'deleted' } } });

    const state = await app.manager.getOrCreateSession('abc123de');
    state.doc.transact(() => (state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('inspectable')!.set('kind', 'future.tool'));
    const opaque = await mcpRequest({ id: 931, method: 'tools/call', toolName: 'readOverlayObject', params: { name: 'readOverlayObject', arguments: { sessionId: 'abc123de', diagramId: 'main', objectId: 'inspectable' } } });
    await expect(opaque.json()).resolves.toMatchObject({ result: { structuredContent: { status: 'opaque', writable: false, object: { id: 'inspectable', kind: 'future.tool' } } } });
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
      'readOverlayScene',
      'listOverlayObjects',
      'readOverlayObject',
      'createOverlayObject',
      'updateOverlayObject',
      'reorderOverlayObject',
      'deleteOverlayObject',
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
