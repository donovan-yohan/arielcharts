import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { pathToFileURL } from 'node:url';
import { healthResponse } from './lib/health.js';
import { createCorsHeaders, sendEmpty, sendJson, readJsonBody } from './lib/http.js';
import { handleMcpToolCall } from './lib/mcp.js';
import { isOriginAllowed } from './lib/origin.js';
import { SessionStore } from './lib/persistence.js';
import { SessionManager } from './lib/session-manager.js';
import { loadServerEnv } from './lib/env.js';
import { SessionWebSocketServer } from './lib/websocket.js';

export function createApp(env = loadServerEnv()) {
  const store = new SessionStore(env.dataDir);
  const manager = new SessionManager(store);
  const websocketServer = new SessionWebSocketServer(manager);

  const cleanupTimer = setInterval(() => {
    void manager.cleanupExpiredSessions({ ttlMs: env.sessionTtlMs }).catch((error) => {
      console.error('Failed to clean up expired sessions:', error);
    });
  }, env.cleanupIntervalMs);

  const server = createServer(async (request: IncomingMessage, response: ServerResponse) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;

    if (pathname === '/health') {
      sendJson(response, 200, healthResponse());
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
        try {
          const body = await readJsonBody(request);
          const result = await handleMcpToolCall(manager, body);
          sendJson(response, 200, { result }, corsHeaders);
        } catch (error) {
          sendJson(
            response,
            400,
            {
              error: error instanceof Error ? error.message : 'Unknown MCP error.',
            },
            corsHeaders,
          );
        }
        return;
      }
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
    console.log(`MermaidFlow server listening on http://localhost:${env.port}`);
  });
}
