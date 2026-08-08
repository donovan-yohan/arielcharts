import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleMcpToolCall } from './mcp.js';
import { SessionStore } from './persistence.js';
import { SessionManager } from './session-manager.js';

async function createManager() {
  const dataDir = await mkdtemp(join(tmpdir(), 'arielcharts-mcp-'));
  const manager = new SessionManager(new SessionStore(dataDir));
  return { dataDir, manager, async close() { await manager.close(); await rm(dataDir, { recursive: true, force: true }); } };
}

describe('handleMcpToolCall', () => {
  let resources: Awaited<ReturnType<typeof createManager>>;

  beforeEach(async () => { resources = await createManager(); });
  afterEach(async () => { await resources.close(); });

  async function getSession() {
    return handleMcpToolCall(resources.manager, { tool: 'get_session', input: { session_id: 'abc123de' } }) as Promise<{
      diagrams: Array<{ id: string; name: string; revision: string }>;
      revision: string;
    }>;
  }

  it('orients an agent with ordered names and stable IDs, then creates, reads, and writes one exact diagram', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();
    expect(initial.diagrams).toEqual([{ id: 'main', name: 'Main', revision: expect.any(String) }]);

    const created = await handleMcpToolCall(resources.manager, {
      tool: 'create_diagram',
      input: { session_id: 'abc123de', name: 'Checkout API sequence', mermaid_text: 'sequenceDiagram\n  Browser->>API: POST /checkout', revision: initial.revision },
    }) as { diagram: { id: string; name: string; revision: string } };
    expect(created.diagram).toMatchObject({ name: 'Checkout API sequence' });

    await expect(handleMcpToolCall(resources.manager, {
      tool: 'read_diagram', input: { session_id: 'abc123de', diagram_id: created.diagram.id },
    })).resolves.toMatchObject({ diagram: { id: created.diagram.id, name: 'Checkout API sequence', mermaid_text: expect.stringContaining('sequenceDiagram') } });

    await expect(handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: created.diagram.id, mermaid_text: 'timeline\n  now : request', revision: created.diagram.revision },
    })).resolves.toMatchObject({ diagram: { id: created.diagram.id, mermaid_text: 'timeline\n  now : request' } });

    await expect(getSession()).resolves.toMatchObject({
      diagrams: [
        { id: 'main', name: 'Main', revision: expect.any(String) },
        { id: created.diagram.id, name: 'Checkout API sequence', revision: expect.any(String) },
      ],
    });
  });

  it('requires an exact latest revision for every MCP mutation', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();
    const first = await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram', input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: 'flowchart LR\n A-->B', revision: initial.diagrams[0]!.revision },
    }) as { diagram: { revision: string } };

    await expect(handleMcpToolCall(resources.manager, {
      tool: 'rename_diagram', input: { session_id: 'abc123de', diagram_id: 'main', name: 'Changed', revision: initial.diagrams[0]!.revision },
    })).rejects.toThrow('Stale diagram revision');

    await expect(handleMcpToolCall(resources.manager, {
      tool: 'rename_diagram', input: { session_id: 'abc123de', diagram_id: 'main', name: 'Changed', revision: first.diagram.revision },
    })).resolves.toMatchObject({ diagram: { name: 'Changed' } });
  });

  it('rejects duplicate normalized names and preserves at least one tab', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'create_diagram', input: { session_id: 'abc123de', name: ' main ', revision: initial.revision },
    })).rejects.toThrow('Diagram name already exists');

    await expect(handleMcpToolCall(resources.manager, {
      tool: 'delete_diagram', input: { session_id: 'abc123de', diagram_id: 'main', revision: initial.diagrams[0]!.revision },
    })).rejects.toThrow('must retain at least one diagram');
  });

  it('rejects invalid IDs and missing required diagram fields', async () => {
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'get_session', input: { session_id: 'Invalid!' },
    })).rejects.toThrow('Invalid session_id');
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'write_diagram', input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: '' },
    })).rejects.toThrow('Expected non-empty string field: revision');
  });
});
