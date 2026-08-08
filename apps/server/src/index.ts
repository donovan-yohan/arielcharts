import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { APP_NAME } from './lib/constants.js';
import { createActivityEvent } from './lib/activity.js';
import { healthResponse } from './lib/health.js';
import { createCorsHeaders, readJsonBody, sendEmpty, sendJson } from './lib/http.js';
import { createModernMcpRequestHandler, handleModernMcpRequest } from './lib/mcp-server.js';
import { isOriginAllowed } from './lib/origin.js';
import { SessionStore } from './lib/persistence.js';
import { assertValidSessionId } from './lib/session-id.js';
import { SessionManager } from './lib/session-manager.js';
import { loadServerEnv } from './lib/env.js';
import { SessionWebSocketServer } from './lib/websocket.js';

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

export function createApp(env = loadServerEnv()) {
  const store = new SessionStore(env.dataDir);
  const manager = new SessionManager(store);
  const websocketServer = new SessionWebSocketServer(manager);
  const mcpRequestHandler = createModernMcpRequestHandler(manager);

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

    const diagramApiPath = parseDiagramApiPath(pathname);
    if (diagramApiPath) {
      if (!isOriginAllowed(request.headers.origin, env.allowedOrigins)) {
        sendJson(response, 403, { error: 'Origin not allowed.' });
        return;
      }

      const corsHeaders = createCorsHeaders(
        request.headers.origin,
        env.allowedOrigins,
        typeof request.headers['access-control-request-headers'] === 'string'
          ? request.headers['access-control-request-headers']
          : undefined,
        'GET, POST, OPTIONS',
      );

      if (request.method === 'OPTIONS') {
        sendEmpty(response, 204, corsHeaders);
        return;
      }

      try {
        assertValidSessionId(diagramApiPath.sessionId);
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
          );
          sendJson(response, result.status === 'stale' ? 409 : 200, result, corsHeaders);
          return;
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Invalid diagram history request.';
        sendJson(response, historyErrorStatus(message), { error: message }, corsHeaders);
        return;
      }

      sendJson(response, 405, { error: 'Method not allowed.' }, corsHeaders);
      return;
    }

    if (pathname === '/mcp') {
      if (!isOriginAllowed(request.headers.origin, env.allowedOrigins)) {
        sendJson(response, 403, { error: 'Origin not allowed.' });
        return;
      }

      const corsHeaders = createCorsHeaders(
        request.headers.origin,
        env.allowedOrigins,
        typeof request.headers['access-control-request-headers'] === 'string'
          ? request.headers['access-control-request-headers']
          : undefined,
      );

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
          await handleModernMcpRequest(mcpRequestHandler, request, response);
        } catch (error) {
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

    if (!isOriginAllowed(request.headers.origin, env.allowedOrigins)) {
      socket.destroy();
      return;
    }

    void websocketServer.upgrade({ request, socket, head });
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

  return { server, manager, close };
}

const isMainModule = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMainModule) {
  const env = loadServerEnv();
  const app = createApp(env);

  app.server.listen(env.port, () => {
    console.log(`${APP_NAME} server listening on http://localhost:${env.port}`);
  });
}
