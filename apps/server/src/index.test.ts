import { mkdtemp, rm } from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './index.js';
import type { ServerEnv } from './lib/types.js';

describe('server integration', () => {
  let dataDir: string;
  let app: ReturnType<typeof createApp>;
  let port: number;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'mermaidflow-server-'));
    const env: ServerEnv = {
      port: 0,
      dataDir,
      cleanupIntervalMs: 60_000,
      sessionTtlMs: 60_000,
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

  it('rejects disallowed origins and malformed MCP payloads', async () => {
    const disallowedResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://blocked.test',
      },
      body: JSON.stringify({ tool: 'list_sessions', input: {} }),
    });

    expect(disallowedResponse.status).toBe(403);
    await expect(disallowedResponse.json()).resolves.toEqual({ error: 'Origin not allowed.' });

    const emptyResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://allowed.test',
      },
      body: '',
    });

    expect(emptyResponse.status).toBe(400);
    await expect(emptyResponse.json()).resolves.toEqual({
      error: 'Expected non-empty string field: tool',
    });

    const invalidJsonResponse = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://allowed.test',
      },
      body: '{',
    });

    expect(invalidJsonResponse.status).toBe(400);
    const invalidJsonPayload = await invalidJsonResponse.json();
    expect(invalidJsonPayload.error).toContain('JSON');
  });
});
