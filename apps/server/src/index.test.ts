import { mkdtemp, rm } from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from './index.js';
import type { ServerEnv } from './lib/types.js';

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

  it('rejects disallowed origins for the MCP endpoint', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        origin: 'http://blocked.test',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'blocked-client', version: '1.0.0' },
        },
      }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: 'Origin not allowed.' });
  });

  it('handles allowed MCP preflight requests', async () => {
    const response = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: 'OPTIONS',
      headers: {
        origin: 'http://allowed.test',
        'access-control-request-headers': 'content-type,mcp-protocol-version',
      },
    });

    expect(response.status).toBe(204);
    expect(await response.text()).toBe('');
    expect(response.headers.get('access-control-allow-origin')).toBe('http://allowed.test');
    expect(response.headers.get('access-control-allow-methods')).toBe('POST, OPTIONS');
    expect(response.headers.get('access-control-allow-headers')).toBe('content-type,mcp-protocol-version');
    expect(response.headers.get('access-control-max-age')).toBe('86400');
  });

  it('supports MCP initialize, tools/list, and tools/call flows over streamable HTTP', async () => {
    const client = new Client({
      name: 'arielcharts-server-test',
      version: '1.0.0',
    });

    const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/mcp`), {
      requestInit: {
        headers: {
          origin: 'http://allowed.test',
        },
      },
    });

    await client.connect(transport);

    expect(client.getServerVersion()).toEqual({ name: 'ArielCharts', version: '0.1.0' });
    expect(client.getServerCapabilities()).toMatchObject({ tools: {} });

    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(['read_diagram', 'write_diagram', 'list_sessions']);

    const writeResult = await client.callTool({
      name: 'write_diagram',
      arguments: {
        session_id: 'abc123de',
        mermaid_text: 'graph TD\n  Browser-->Server',
        actor_name: 'claude-code',
        actor_type: 'agent',
        detail: 'updated over MCP',
      },
    });

    expect(writeResult.isError).toBeUndefined();
    expect(writeResult.structuredContent).toEqual({ success: true });

    const readResult = await client.callTool({
      name: 'read_diagram',
      arguments: {
        session_id: 'abc123de',
      },
    });

    expect(readResult.isError).toBeUndefined();
    expect(readResult.structuredContent).toEqual({
      mermaid_text: 'graph TD\n  Browser-->Server',
      participants: [
        {
          name: 'claude-code',
          color: '#7c3aed',
          type: 'agent',
        },
      ],
    });

    const sessionsResult = await client.callTool({
      name: 'list_sessions',
      arguments: {},
    });

    expect(sessionsResult.isError).toBeUndefined();
    expect(sessionsResult.structuredContent).toEqual({
      sessions: [
        {
          id: 'abc123de',
          title: 'graph TD',
          participants: 1,
        },
      ],
    });

    await transport.close();
  });
});
