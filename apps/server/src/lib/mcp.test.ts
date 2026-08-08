import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
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

  async function nodePositions(diagramId = 'main'): Promise<Y.Map<{ x: number; y: number }>> {
    const session = await resources.manager.getOrCreateSession('abc123de');
    const diagram = session.doc.getMap<Y.Map<unknown>>('diagrams').get(diagramId);
    const positions = diagram?.get('nodePositions');
    if (!(positions instanceof Y.Map)) {
      throw new Error(`Missing node positions for diagram ${diagramId}.`);
    }
    return positions as Y.Map<{ x: number; y: number }>;
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

  it('reconciles an inactive diagram’s layout before MCP removes and later reuses a Mermaid id', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();
    const initialWrite = await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: 'flowchart LR\n  A --> B', revision: initial.diagrams[0]!.revision },
    }) as { diagram: { revision: string } };
    const positions = await nodePositions();
    positions.set('A', { x: 10, y: 20 });
    positions.set('B', { x: 30, y: 40 });

    const removed = await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: 'flowchart LR\n  B --> C', revision: initialWrite.diagram.revision },
    }) as { diagram: { revision: string } };
    expect([...positions.entries()]).toEqual([['B', { x: 30, y: 40 }]]);

    await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: 'flowchart LR\n  A --> B', revision: removed.diagram.revision },
    });
    expect([...positions.entries()]).toEqual([['B', { x: 30, y: 40 }]]);
  });

  it('preserves settled layout for invalid Mermaid source', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();
    const valid = await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: 'flowchart LR\n  A --> B', revision: initial.diagrams[0]!.revision },
    }) as { diagram: { revision: string } };
    const positions = await nodePositions();
    positions.set('A', { x: 10, y: 20 });

    await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: 'not valid Mermaid', revision: valid.diagram.revision },
    });
    expect([...positions.entries()]).toEqual([['A', { x: 10, y: 20 }]]);
  });

  it('clears obsolete layout for blank and accepted generic Mermaid source', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();
    const flowchart = await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: 'flowchart LR\n  A --> B', revision: initial.diagrams[0]!.revision },
    }) as { diagram: { revision: string } };
    const positions = await nodePositions();
    positions.set('A', { x: 10, y: 20 });

    const generic = await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: 'sequenceDiagram\n  Browser->>API: request', revision: flowchart.diagram.revision },
    }) as { diagram: { revision: string } };
    expect([...positions.entries()]).toEqual([]);

    positions.set('B', { x: 30, y: 40 });
    await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: '', revision: generic.diagram.revision },
    });
    expect([...positions.entries()]).toEqual([]);
  });

  it('records diagram-scoped base and resulting revisions for MCP mutations', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();
    const created = await handleMcpToolCall(resources.manager, {
      tool: 'create_diagram',
      input: { session_id: 'abc123de', name: 'Checkout', revision: initial.revision },
    }) as { diagram: { id: string; revision: string } };
    const written = await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: created.diagram.id, mermaid_text: 'sequenceDiagram\n  Browser->>API: POST', revision: created.diagram.revision },
    }) as { diagram: { revision: string } };
    const renamed = await handleMcpToolCall(resources.manager, {
      tool: 'rename_diagram',
      input: { session_id: 'abc123de', diagram_id: created.diagram.id, name: 'Checkout API', revision: written.diagram.revision },
    }) as { diagram: { revision: string } };
    const deleted = await handleMcpToolCall(resources.manager, {
      tool: 'delete_diagram',
      input: { session_id: 'abc123de', diagram_id: created.diagram.id, revision: renamed.diagram.revision },
    }) as { revision: string };

    const activity = (await resources.manager.readSession('abc123de'))?.activity ?? [];
    expect(activity).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'created', diagram_id: created.diagram.id, base_revision: initial.revision, result_revision: created.diagram.revision }),
      expect.objectContaining({ action: 'replaced', diagram_id: created.diagram.id, base_revision: created.diagram.revision, result_revision: written.diagram.revision }),
      expect.objectContaining({ action: 'renamed', diagram_id: created.diagram.id, base_revision: written.diagram.revision, result_revision: renamed.diagram.revision }),
      expect.objectContaining({ action: 'deleted', diagram_id: created.diagram.id, base_revision: renamed.diagram.revision }),
    ]));
    expect(activity.find((event) => event.action === 'deleted')?.result_revision).toBeUndefined();
    expect(deleted.revision).toEqual(expect.any(String));
  });

  it('rejects a stale agent write until it reads, merges, and retries against the current tab revision', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const firstRead = await handleMcpToolCall(resources.manager, {
      tool: 'read_diagram', input: { session_id: 'abc123de', diagram_id: 'main' },
    }) as { diagram: { mermaid_text: string; revision: string } };
    const browserWrite = await resources.manager.writeDiagram(
      'abc123de',
      'main',
      'flowchart LR\n  Browser-->Gateway',
      firstRead.diagram.revision,
      { id: 'browser-edit', timestamp: Date.now(), actor: { name: 'browser', type: 'human' }, action: 'edited' },
    );

    await expect(handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: 'flowchart LR\n  Agent-->Service', revision: firstRead.diagram.revision },
    })).rejects.toThrow('Stale diagram revision');

    const current = await handleMcpToolCall(resources.manager, {
      tool: 'read_diagram', input: { session_id: 'abc123de', diagram_id: 'main' },
    }) as { diagram: { mermaid_text: string; revision: string } };
    const merged = `${current.diagram.mermaid_text}\n  Gateway-->Service`;
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: merged, revision: current.diagram.revision },
    })).resolves.toMatchObject({ diagram: { mermaid_text: merged } });
    expect(browserWrite.mermaid_text).toContain('Browser-->Gateway');
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
