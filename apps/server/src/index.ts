import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { APP_NAME } from './lib/constants.js';
import { createActivityEvent } from './lib/activity.js';
import { healthResponse } from './lib/health.js';
import { RequestBodyTooLargeError, createCredentialedCorsHeaders, readJsonBody, sendEmpty, sendJson } from './lib/http.js';
import { createModernMcpRequestHandler, handleModernMcpRequest } from './lib/mcp-server.js';
import { isCredentialedBrowserOriginAllowed, isMcpOriginAllowed } from './lib/origin.js';
import { SessionStore } from './lib/persistence.js';
import { assertValidSessionId, isValidSessionId } from './lib/session-id.js';
import { SessionManager } from './lib/session-manager.js';
import { loadServerEnv } from './lib/env.js';
import { SessionWebSocketServer } from './lib/websocket.js';
import { RoomAccessError, RoomAccessService, roomAccessErrorHeaders } from './lib/room-access.js';

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function readRequiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Expected non-empty string field: ${field}`);
  }
  return value;
}

function readRestoreActor(body: Record<string, unknown>) {
  const actorName = typeof body.actor_name === 'string' && body.actor_name.trim() ? body.actor_name : 'browser';
  const actorType = body.actor_type === 'agent' ? 'agent' : 'human';
  const detail = typeof body.detail === 'string' ? body.detail : 'restored diagram revision';
  return createActivityEvent({ action: 'restored', actorName, actorType, detail });
}

type DiagramApiPath =
  | { kind: 'current'; sessionId: string; diagramId: string }
  | { kind: 'history'; sessionId: string; diagramId: string }
  | { kind: 'revision'; sessionId: string; diagramId: string; revisionId: string }
  | { kind: 'restore'; sessionId: string; diagramId: string; revisionId: string };

function parseDiagramApiPath(pathname: string): DiagramApiPath | undefined {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length < 5 || segments[0] !== 'api' || segments[1] !== 'sessions' || segments[3] !== 'diagrams') {
    return undefined;
  }

  try {
    const sessionId = decodeURIComponent(segments[2]!);
    const diagramId = decodeURIComponent(segments[4]!);
    if (segments.length === 5) return { kind: 'current', sessionId, diagramId };
    if (segments.length === 6 && segments[5] === 'history') return { kind: 'history', sessionId, diagramId };
    if (segments.length === 7 && segments[5] === 'history') {
      return { kind: 'revision', sessionId, diagramId, revisionId: decodeURIComponent(segments[6]!) };
    }
    if (segments.length === 8 && segments[5] === 'history' && segments[7] === 'restore') {
      return { kind: 'restore', sessionId, diagramId, revisionId: decodeURIComponent(segments[6]!) };
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function historyErrorStatus(message: string): number {
  if (/^(Session|Diagram|Diagram revision) not found:/.test(message)) return 404;
  if (/^(Expected |Invalid |Unexpected token)/.test(message)) return 400;
  return 500;
}

function historyErrorStatusFor(error: unknown, message: string): number {
  if (error instanceof RequestBodyTooLargeError) return 413;
  return historyErrorStatus(message);
}

function roomApiSessionId(pathname: string, suffix: 'access' | 'rotate'): string | undefined {
  const match = pathname.match(new RegExp(`^/api/rooms/([^/]+)/${suffix}$`, 'u'));
  if (!match) return undefined;
  try {
    return decodeURIComponent(match[1]!);
  } catch {
    return undefined;
  }
}

function requestedHeaders(request: IncomingMessage): string | undefined {
  return typeof request.headers['access-control-request-headers'] === 'string'
    ? request.headers['access-control-request-headers']
    : undefined;
}

function browserCorsHeaders(request: IncomingMessage, allowedOrigins: readonly string[], methods: string) {
  const origin = request.headers.origin;
  if (!isCredentialedBrowserOriginAllowed(origin, allowedOrigins)) return null;
  return createCredentialedCorsHeaders(origin!, requestedHeaders(request), methods);
}

function sendRoomAccessError(response: ServerResponse, error: unknown, headers: Record<string, unknown> = {}): void {
  const roomError = error instanceof RoomAccessError ? error : new RoomAccessError(401);
  sendJson(response, roomError.status, { error: 'Room access denied.' }, {
    ...headers,
    ...roomAccessErrorHeaders(roomError),
    'cache-control': 'no-store',
  });
}

function sendUnexpectedRoomAccessError(response: ServerResponse, error: unknown, headers: Record<string, unknown> = {}): void {
  console.error('Room access request failed:', error);
  sendJson(response, 500, { error: 'Room access unavailable.' }, {
    ...headers,
    'cache-control': 'no-store',
  });
}

function sendRoomAccessFailure(response: ServerResponse, error: unknown, headers: Record<string, unknown> = {}): void {
  if (error instanceof RoomAccessError) {
    sendRoomAccessError(response, error, headers);
    return;
  }
  sendUnexpectedRoomAccessError(response, error, headers);
}

export function createApp(env = loadServerEnv()) {
  if (process.env.NODE_ENV === 'production' && !env.roomCookieSecret) {
    throw new Error('ROOM_COOKIE_SECRET is required in production.');
  }
  const store = new SessionStore(env.dataDir);
  const manager = new SessionManager(store);
  const websocketServer = new SessionWebSocketServer(manager);
  const roomAccess = new RoomAccessService(store, {
    cookieSecret: env.roomCookieSecret,
    cookieTtlMs: env.roomCookieTtlMs,
    secureCookie: env.roomCookieSecure,
    sameSite: env.roomCookieSameSite,
    clientAddressProfile: env.clientAddressProfile,
    cryptoProfile: env.roomAccessCryptoProfile,
  });
  const mcpRequestHandler = createModernMcpRequestHandler(manager);

  async function createRoom(requestedSessionId?: string): Promise<{ sessionId: string; roomKey: string; accessVersion: number }> {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const sessionId = requestedSessionId ?? randomBytes(16).toString('hex');
      const grant = await roomAccess.createGrant();
      try {
        await manager.createProtectedSession(sessionId, grant.record);
        return { sessionId, roomKey: grant.roomKey, accessVersion: grant.record.accessVersion };
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith('Session already exists:')) throw error;
        if (requestedSessionId) throw error;
      }
    }
    throw new Error('Failed to allocate room.');
  }

  const cleanupTimer = setInterval(() => {
    void manager.cleanupExpiredSessions({ ttlMs: env.sessionTtlMs, diskTtlMs: env.diskTtlMs }).catch((error) => {
      console.error('Failed to clean up expired sessions:', error);
    });
  }, env.cleanupIntervalMs);

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (pathname === '/health') {
      sendJson(response, 200, healthResponse());
      return;
    }

    if (pathname === '/api/rooms') {
      const origin = request.headers.origin;
      if (origin && !isCredentialedBrowserOriginAllowed(origin, env.allowedOrigins)) {
        sendJson(response, 403, { error: 'Origin not allowed.' });
        return;
      }
      const corsHeaders = origin ? createCredentialedCorsHeaders(origin, requestedHeaders(request), 'POST, OPTIONS') : {};
      if (request.method === 'OPTIONS') {
        sendEmpty(response, 204, corsHeaders);
        return;
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed.' }, corsHeaders);
        return;
      }
      try {
        roomAccess.allowRoomCreation(request);
        const room = await createRoom();
        sendJson(response, 201, { session_id: room.sessionId, room_key: room.roomKey }, { ...corsHeaders, 'cache-control': 'no-store' });
      } catch (error) {
        if (error instanceof RoomAccessError) {
          sendRoomAccessError(response, error, corsHeaders);
          return;
        }
        sendJson(response, 500, { error: 'Failed to create room.' }, { ...corsHeaders, 'cache-control': 'no-store' });
      }
      return;
    }

    const accessSessionId = roomApiSessionId(pathname, 'access');
    if (accessSessionId) {
      const corsHeaders = browserCorsHeaders(request, env.allowedOrigins, 'GET, POST, OPTIONS');
      if (!corsHeaders) {
        sendJson(response, 403, { error: 'Origin not allowed.' });
        return;
      }
      if (request.method === 'OPTIONS') {
        sendEmpty(response, 204, corsHeaders);
        return;
      }
      if (!isValidSessionId(accessSessionId)) {
        sendRoomAccessError(response, new RoomAccessError(401), corsHeaders);
        return;
      }
      if (request.method === 'GET') {
        try {
          await roomAccess.authenticateBrowserCookie(accessSessionId, request);
          sendEmpty(response, 204, { ...corsHeaders, 'cache-control': 'no-store' });
        } catch (error) {
          sendRoomAccessFailure(response, error, corsHeaders);
        }
        return;
      }
      if (request.method === 'POST') {
        let body: unknown;
        try {
          body = await readJsonBody(request);
          if (!isRecord(body) || typeof body.room_key !== 'string') {
            sendRoomAccessError(response, new RoomAccessError(401), corsHeaders);
            return;
          }
        } catch {
          sendRoomAccessError(response, new RoomAccessError(401), corsHeaders);
          return;
        }
        try {
          const authorized = await roomAccess.authenticateRoomKey(accessSessionId, body.room_key, request);
          sendEmpty(response, 204, { ...corsHeaders, ...roomAccess.browserCookieHeaders(accessSessionId, authorized.accessVersion), 'cache-control': 'no-store' });
        } catch (error) {
          sendRoomAccessFailure(response, error, corsHeaders);
        }
        return;
      }
      sendJson(response, 405, { error: 'Method not allowed.' }, corsHeaders);
      return;
    }

    const rotateSessionId = roomApiSessionId(pathname, 'rotate');
    if (rotateSessionId) {
      const corsHeaders = browserCorsHeaders(request, env.allowedOrigins, 'POST, OPTIONS');
      if (!corsHeaders) {
        sendJson(response, 403, { error: 'Origin not allowed.' });
        return;
      }
      if (request.method === 'OPTIONS') {
        sendEmpty(response, 204, corsHeaders);
        return;
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'Method not allowed.' }, corsHeaders);
        return;
      }
      if (!isValidSessionId(rotateSessionId)) {
        sendRoomAccessError(response, new RoomAccessError(401), corsHeaders);
        return;
      }
      try {
        const authorized = await roomAccess.authenticateBrowserCookie(rotateSessionId, request);
        const grant = await roomAccess.rotate(rotateSessionId, authorized.accessVersion);
        await websocketServer.closeRoom(rotateSessionId, grant.record.accessVersion);
        sendJson(response, 200, { room_key: grant.roomKey }, {
          ...corsHeaders,
          ...roomAccess.browserCookieHeaders(rotateSessionId, grant.record.accessVersion),
          'cache-control': 'no-store',
        });
      } catch (error) {
        sendRoomAccessFailure(response, error, corsHeaders);
      }
      return;
    }

    const diagramApiPath = parseDiagramApiPath(pathname);
    if (diagramApiPath) {
      const corsHeaders = browserCorsHeaders(request, env.allowedOrigins, 'GET, POST, OPTIONS');
      if (!corsHeaders) {
        sendJson(response, 403, { error: 'Origin not allowed.' });
        return;
      }

      if (request.method === 'OPTIONS') {
        sendEmpty(response, 204, corsHeaders);
        return;
      }

      try {
        assertValidSessionId(diagramApiPath.sessionId);
        await roomAccess.authenticateBrowserCookie(diagramApiPath.sessionId, request);
        if (request.method === 'GET' && diagramApiPath.kind === 'current') {
          sendJson(response, 200, await manager.readDiagram(diagramApiPath.sessionId, diagramApiPath.diagramId), corsHeaders);
          return;
        }

        if (request.method === 'GET' && diagramApiPath.kind === 'history') {
          sendJson(response, 200, await manager.listDiagramHistory(diagramApiPath.sessionId, diagramApiPath.diagramId), corsHeaders);
          return;
        }

        if (request.method === 'GET' && diagramApiPath.kind === 'revision') {
          sendJson(response, 200, {
            revision: await manager.readDiagramRevision(diagramApiPath.sessionId, diagramApiPath.diagramId, diagramApiPath.revisionId),
          }, corsHeaders);
          return;
        }

        if (request.method === 'POST' && diagramApiPath.kind === 'restore') {
          const rawBody = await readJsonBody(request);
          if (!isRecord(rawBody)) throw new Error('Expected JSON object payload.');
          const expectedRevision = readRequiredString(rawBody.expected_revision, 'expected_revision');
          const event = readRestoreActor(rawBody);
          const result = await manager.restoreDiagramRevision(
            diagramApiPath.sessionId,
            diagramApiPath.diagramId,
            diagramApiPath.revisionId,
            expectedRevision,
            event,
            undefined,
            'browser',
          );
          sendJson(response, result.status === 'stale' ? 409 : 200, result, corsHeaders);
          return;
        }
      } catch (error) {
        if (error instanceof RoomAccessError) {
          sendRoomAccessError(response, error, corsHeaders);
          return;
        }
        const message = error instanceof Error ? error.message : 'Invalid diagram history request.';
        sendJson(response, historyErrorStatusFor(error, message), { error: message }, corsHeaders);
        return;
      }

      sendJson(response, 405, { error: 'Method not allowed.' }, corsHeaders);
      return;
    }

    if (pathname === '/mcp') {
      if (!isMcpOriginAllowed(request.headers.origin, env.allowedOrigins)) {
        sendJson(response, 403, { error: 'Origin not allowed.' });
        return;
      }
      const corsHeaders = request.headers.origin
        ? createCredentialedCorsHeaders(request.headers.origin, requestedHeaders(request), 'POST, OPTIONS')
        : {};

      if (request.method === 'OPTIONS') {
        sendEmpty(response, 204, corsHeaders);
        return;
      }

      if (request.method === 'POST') {
        for (const [key, value] of Object.entries(corsHeaders)) {
          if (value !== undefined) {
            response.setHeader(key, value);
          }
        }

        try {
          const authorized = await roomAccess.authenticateBearer(request);
          (request as IncomingMessage & { auth?: { token: string; clientId: string; scopes: string[]; extra: Record<string, unknown> } }).auth = {
            token: 'validated-room-capability',
            clientId: authorized.sessionId,
            scopes: ['room:collaborate'],
            extra: { roomSessionId: authorized.sessionId },
          };
          await handleModernMcpRequest(mcpRequestHandler, request, response);
        } catch (error) {
          if (error instanceof RoomAccessError) {
            sendRoomAccessError(response, error, corsHeaders);
            return;
          }
          sendJson(
            response,
            500,
            {
              jsonrpc: '2.0',
              error: {
                code: -32603,
                message: error instanceof Error ? error.message : 'Internal MCP server error.',
              },
              id: null,
            },
            corsHeaders,
          );
        }
        return;
      }

      sendJson(
        response,
        405,
        {
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Method not allowed.',
          },
          id: null,
        },
        corsHeaders,
      );
      return;
    }

    sendJson(response, 404, { error: 'Not found.' });
  });

  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (!websocketServer.accepts(pathname)) {
      socket.destroy();
      return;
    }

    if (!isCredentialedBrowserOriginAllowed(request.headers.origin, env.allowedOrigins)) {
      socket.destroy();
      return;
    }
    const sessionId = pathname.replace(/^\/ws\//u, '');
    if (!isValidSessionId(sessionId)) {
      socket.destroy();
      return;
    }
    const rejectRawSocketError = () => socket.destroy();
    const clearRawSocketGuard = () => {
      socket.removeListener('error', rejectRawSocketError);
      socket.removeListener('close', clearRawSocketGuard);
    };
    socket.once('error', rejectRawSocketError);
    socket.once('close', clearRawSocketGuard);
    void roomAccess.authenticateBrowserCookie(sessionId, request)
      .then(() => {
        if (socket.destroyed) return;
        return roomAccess.authenticateBrowserCookie(sessionId, request);
      })
      .then((authorized) => {
        if (socket.destroyed || !authorized) return;
        clearRawSocketGuard();
        websocketServer.upgrade({ request, socket, head, sessionId, accessVersion: authorized.accessVersion });
      })
      .catch(() => socket.destroy());
  });

  async function close(): Promise<void> {
    clearInterval(cleanupTimer);
    await mcpRequestHandler.close();
    await websocketServer.close();
    await manager.close();
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  return { server, manager, roomAccess, createRoom, close };
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const env = loadServerEnv();
  const app = createApp(env);

  app.server.listen(env.port, () => {
    console.log(`${APP_NAME} server listening on http://localhost:${env.port}`);
  });
}
