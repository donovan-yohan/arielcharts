import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleMcpToolCall } from './mcp.js';
import { SessionStore } from './persistence.js';
import { SessionManager } from './session-manager.js';

async function createManager() {
  const dataDir = await mkdtemp(join(tmpdir(), 'mermaidflow-mcp-'));
  const store = new SessionStore(dataDir);
  const manager = new SessionManager(store);
  return {
    dataDir,
    manager,
    async close() {
      await manager.close();
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

describe('handleMcpToolCall', () => {
  let resources: Awaited<ReturnType<typeof createManager>>;

  beforeEach(async () => {
    resources = await createManager();
  });

  afterEach(async () => {
    await resources.close();
  });

  it('writes and reads a deterministic session', async () => {
    const sessionId = 'abc123de';
    const mermaidText = 'graph TD\n  A-->B';

    await expect(
      handleMcpToolCall(resources.manager, {
        tool: 'write_diagram',
        input: {
          session_id: sessionId,
          mermaid_text: mermaidText,
          actor_name: 'backend-agent',
          participants: [{ name: 'backend-agent', color: '#00aaff', type: 'agent' }],
        },
      }),
    ).resolves.toEqual({ success: true });

    await expect(
      handleMcpToolCall(resources.manager, {
        tool: 'read_diagram',
        input: { session_id: sessionId },
      }),
    ).resolves.toEqual({
      mermaid_text: mermaidText,
      participants: [{ name: 'backend-agent', color: '#00aaff', type: 'agent' }],
    });

    await expect(resources.manager.readSession(sessionId)).resolves.toMatchObject({
      id: sessionId,
      mermaidText,
      participants: [{ name: 'backend-agent', color: '#00aaff', type: 'agent' }],
      activity: [
        expect.objectContaining({
          action: 'replaced',
          actor: { name: 'backend-agent', type: 'agent' },
        }),
      ],
    });
  });

  it('supports empty diagram text and synthesizes actor awareness when participants are omitted', async () => {
    await expect(
      handleMcpToolCall(resources.manager, {
        tool: 'write_diagram',
        input: {
          session_id: 'abc123de',
          mermaid_text: '',
          actor_name: 'diagram-bot',
        },
      }),
    ).resolves.toEqual({ success: true });

    await expect(
      handleMcpToolCall(resources.manager, {
        tool: 'read_diagram',
        input: { session_id: 'abc123de' },
      }),
    ).resolves.toEqual({
      mermaid_text: '',
      participants: [{ name: 'diagram-bot', color: '#7c3aed', type: 'agent' }],
    });
  });

  it('lists active sessions', async () => {
    await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: {
        session_id: 'abc123de',
        mermaid_text: 'flowchart LR\n  A-->B',
        participants: [],
      },
    });

    await expect(
      handleMcpToolCall(resources.manager, {
        tool: 'list_sessions',
        input: {},
      }),
    ).resolves.toEqual({
      sessions: [
        {
          id: 'abc123de',
          title: 'flowchart LR',
          participants: 0,
        },
      ],
    });
  });

  it('rejects invalid session ids', async () => {
    await expect(
      handleMcpToolCall(resources.manager, {
        tool: 'read_diagram',
        input: { session_id: 'Invalid!' },
      }),
    ).rejects.toThrow('Invalid session_id');
  });

  it('rejects invalid payloads', async () => {
    await expect(
      handleMcpToolCall(resources.manager, {
        tool: 'write_diagram',
        input: {
          session_id: 'abc123de',
        },
      }),
    ).rejects.toThrow('Expected string field: mermaid_text');

    await expect(
      handleMcpToolCall(resources.manager, {
        tool: 'unsupported_tool',
        input: {},
      }),
    ).rejects.toThrow('Unsupported MCP tool: unsupported_tool');
  });

  it('rejects nonexistent sessions', async () => {
    await expect(
      handleMcpToolCall(resources.manager, {
        tool: 'read_diagram',
        input: { session_id: 'abc123de' },
      }),
    ).rejects.toThrow('Session not found: abc123de');
  });
});
