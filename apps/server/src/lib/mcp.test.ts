import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { ALL_STARTER_TEMPLATES, PRIMARY_STARTER_TEMPLATES } from '@arielcharts/shared';
import { handleMcpToolCall as handleAuthorizedMcpToolCall } from './mcp.js';
import { SessionStore } from './persistence.js';
import { SessionManager } from './session-manager.js';

function overlayObject(id: string, orderKey = id) {
  return {
    id,
    kind: 'foundation.card',
    version: 1,
    order_key: orderKey,
    geometry: { x: 10, y: 20, width: 120, height: 72, rotation: 0 },
    style: {},
    metadata: {},
    payload: { text: id },
  };
}

function handleMcpToolCall(manager: SessionManager, payload: unknown, authorizedSessionId = 'abc123de') {
  return handleAuthorizedMcpToolCall(manager, payload, authorizedSessionId);
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

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

  async function durableParticipants(): Promise<Y.Map<{ name: string; color: string; type: 'human' | 'agent' }>> {
    const session = await resources.manager.getOrCreateSession('abc123de');
    return session.doc.getMap<{ name: string; color: string; type: 'human' | 'agent' }>('presence');
  }

  it('lazily joins an authenticated MCP actor only with its first successful mutation', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();

    await handleMcpToolCall(resources.manager, {
      tool: 'read_diagram', input: { session_id: 'abc123de', diagram_id: 'main' },
    });
    expect([...((await durableParticipants()).entries())]).toEqual([]);

    const written = await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: {
        session_id: 'abc123de',
        diagram_id: 'main',
        mermaid_text: 'flowchart LR\n  Agent --> API',
        revision: initial.diagrams[0]!.revision,
        actor_name: 'Diagram Agent',
      },
    }) as { diagram: { revision: string } };

    expect((await durableParticipants()).get('Diagram Agent')).toEqual({ name: 'Diagram Agent', color: '#7c3aed', type: 'agent' });
    expect((await resources.manager.readSession('abc123de'))?.activity).toHaveLength(1);

    await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: {
        session_id: 'abc123de',
        diagram_id: 'main',
        mermaid_text: 'flowchart LR\n  Agent --> API\n  API --> Database',
        revision: written.diagram.revision,
        actor_name: 'Diagram Agent',
      },
    });
    expect([...((await durableParticipants()).entries())]).toEqual([
      ['Diagram Agent', { name: 'Diagram Agent', color: '#7c3aed', type: 'agent' }],
    ]);
    expect((await resources.manager.readSession('abc123de'))?.activity).toHaveLength(2);
  });

  it('preserves an already joined agent identity while applying a mutation', async () => {
    const session = await resources.manager.getOrCreateSession('abc123de');
    const existing = { name: 'Diagram Agent', color: '#0ea5e9', type: 'agent' as const };
    session.doc.getMap('presence').set(existing.name, existing);
    const initial = await getSession();

    await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: {
        session_id: 'abc123de',
        diagram_id: 'main',
        mermaid_text: 'flowchart LR\n  Agent --> API',
        revision: initial.diagrams[0]!.revision,
        actor_name: existing.name,
      },
    });

    expect((await durableParticipants()).get(existing.name)).toEqual(existing);
  });

  it('does not join an actor when duplicate create or rename validation rejects the mutation', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();

    await expect(handleMcpToolCall(resources.manager, {
      tool: 'create_diagram',
      input: {
        session_id: 'abc123de',
        name: 'Main',
        mermaid_text: 'flowchart LR\n  Duplicate --> Main',
        revision: initial.revision,
        actor_name: 'Rejected Agent',
      },
    })).rejects.toThrow('Diagram name already exists');
    expect([...((await durableParticipants()).entries())]).toEqual([]);

    const second = await resources.manager.createDiagram(
      'abc123de',
      'Second',
      'flowchart LR\n  Second --> Diagram',
      initial.revision,
      { action: 'created', actor: { name: 'Browser', type: 'human' }, id: 'browser-created-second', timestamp: 1 },
    );
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'rename_diagram',
      input: {
        session_id: 'abc123de',
        diagram_id: second.id,
        name: 'Main',
        revision: second.revision,
        actor_name: 'Rejected Agent',
      },
    })).rejects.toThrow('Diagram name already exists');
    expect([...((await durableParticipants()).entries())]).toEqual([]);
  });

  it('preserves a durable MCP agent across reload and human awareness churn', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();
    await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: {
        session_id: 'abc123de',
        diagram_id: 'main',
        mermaid_text: 'flowchart LR\n  Agent --> API',
        revision: initial.diagrams[0]!.revision,
        actor_name: 'Persistent Agent',
      },
    });

    const active = await resources.manager.getOrCreateSession('abc123de');
    await resources.manager.cleanupExpiredSessions({ ttlMs: 0, diskTtlMs: Infinity, now: active.lastAccessedAt + 1 });
    const reloaded = await resources.manager.getOrCreateSession('abc123de');
    const human = { name: 'Browser Human', color: '#2563eb', type: 'human' as const };
    reloaded.awareness.setLocalState({ user: human });
    expect(Object.fromEntries(reloaded.doc.getMap('presence').entries())).toEqual({
      'Browser Human': human,
      'Persistent Agent': { name: 'Persistent Agent', color: '#7c3aed', type: 'agent' },
    });

    reloaded.awareness.setLocalState(null);
    expect([...reloaded.doc.getMap('presence').entries()]).toEqual([
      ['Persistent Agent', { name: 'Persistent Agent', color: '#7c3aed', type: 'agent' }],
    ]);
    await expect(resources.manager.readDiagram('abc123de', 'main')).resolves.toMatchObject({
      participants: [{ name: 'Persistent Agent', color: '#7c3aed', type: 'agent' }],
    });
    await expect(resources.manager.getSession('abc123de')).resolves.toMatchObject({
      participants: [{ name: 'Persistent Agent', color: '#7c3aed', type: 'agent' }],
    });
  });

  it('does not join a room-mismatched or stale concurrent MCP mutation', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();

    await expect(handleMcpToolCall(resources.manager, {
      tool: 'read_overlay_scene', input: { session_id: 'abc123de', diagram_id: 'main' },
    }, 'other123')).rejects.toThrow('Room access denied.');

    await expect(handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: {
        session_id: 'abc123de',
        diagram_id: 'main',
        mermaid_text: 'flowchart LR\n  Rejected --> Write',
        revision: initial.diagrams[0]!.revision,
        actor_name: 'Rejected Agent',
      },
    }, 'other123')).rejects.toThrow('Room access denied.');
    expect([...((await durableParticipants()).entries())]).toEqual([]);

    const concurrent = await Promise.allSettled([
      handleMcpToolCall(resources.manager, {
        tool: 'write_diagram',
        input: {
          session_id: 'abc123de',
          diagram_id: 'main',
          mermaid_text: 'flowchart LR\n  Agent --> API',
          revision: initial.diagrams[0]!.revision,
          actor_name: 'Concurrent Agent',
        },
      }),
      handleMcpToolCall(resources.manager, {
        tool: 'write_diagram',
        input: {
          session_id: 'abc123de',
          diagram_id: 'main',
          mermaid_text: 'flowchart LR\n  Agent --> Database',
          revision: initial.diagrams[0]!.revision,
          actor_name: 'Concurrent Agent',
        },
      }),
    ]);

    expect(concurrent.filter(({ status }) => status === 'fulfilled')).toHaveLength(1);
    expect(concurrent.filter(({ status }) => status === 'rejected')).toHaveLength(1);
    expect([...((await durableParticipants()).entries())]).toEqual([
      ['Concurrent Agent', { name: 'Concurrent Agent', color: '#7c3aed', type: 'agent' }],
    ]);
    expect((await resources.manager.readSession('abc123de'))?.activity).toHaveLength(1);
  });

  it('rejects invalid overlay payloads and a deleted diagram without joining an actor', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const scene = await handleMcpToolCall(resources.manager, { tool: 'read_overlay_scene', input: { session_id: 'abc123de', diagram_id: 'main' } }) as { overlay_revision: string };
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'create_overlay_object',
      input: { session_id: 'abc123de', diagram_id: 'main', expected_overlay_revision: scene.overlay_revision, object: { ...overlayObject('invalid'), geometry: { x: 0, y: 0, width: -1, height: 1, rotation: 0 } }, actor_name: 'Rejected Overlay Agent' },
    })).rejects.toThrow('Overlay mutation exceeds collaboration limits');
    expect([...((await durableParticipants()).entries())]).toEqual([]);

    const initial = await getSession();
    const extra = await resources.manager.createDiagram('abc123de', 'Disposable', '', initial.revision, { action: 'created', actor: { name: 'Browser', type: 'human' }, id: 'delete-overlay-target', timestamp: 1 });
    await resources.manager.deleteDiagram('abc123de', extra.id, extra.revision, { action: 'deleted', actor: { name: 'Browser', type: 'human' }, id: 'deleted-overlay-target', timestamp: 2 });
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'read_overlay_scene', input: { session_id: 'abc123de', diagram_id: extra.id },
    })).rejects.toThrow(`Diagram not found: ${extra.id}`);
  });

  it('uses a raw scene revision for bounded object operations without changing Mermaid revisions or activity', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const sourceBefore = await resources.manager.readDiagram('abc123de', 'main');
    const sessionBefore = await getSession();
    const firstRead = await handleMcpToolCall(resources.manager, {
      tool: 'read_overlay_scene', input: { session_id: 'abc123de', diagram_id: 'main' },
    }) as { overlay_revision: string; objects: unknown[]; opaque_objects: unknown[] };
    expect(firstRead.objects).toEqual([]); expect(firstRead.opaque_objects).toEqual([]);
    expect([...((await durableParticipants()).entries())]).toEqual([]);

    const created = await handleMcpToolCall(resources.manager, {
      tool: 'create_overlay_object',
      input: {
        session_id: 'abc123de', diagram_id: 'main', expected_overlay_revision: firstRead.overlay_revision,
        object: overlayObject('agent-note'), actor_name: 'Overlay Agent',
      },
    }) as { status: string; overlay_revision: string; object: { id: string } };
    expect(created).toMatchObject({ status: 'updated', object: { id: 'agent-note' } });
    expect((await resources.manager.readDiagram('abc123de', 'main')).diagram).toEqual(sourceBefore.diagram);
    expect(await getSession()).toMatchObject({ revision: sessionBefore.revision });
    expect((await resources.manager.readSession('abc123de'))?.activity).toEqual([]);
    expect((await durableParticipants()).get('Overlay Agent')).toEqual({ name: 'Overlay Agent', color: '#7c3aed', type: 'agent' });

    const staleUpdate = await handleMcpToolCall(resources.manager, {
      tool: 'update_overlay_object',
      input: { session_id: 'abc123de', diagram_id: 'main', object_id: 'agent-note', expected_overlay_revision: firstRead.overlay_revision, patch: { metadata: { owner: 'stale' } } },
    }) as { status: string; scene: { overlay_revision: string; objects: Array<{ id: string }> } };
    expect(staleUpdate).toMatchObject({ status: 'stale', scene: { objects: [{ id: 'agent-note' }] } });
    const retried = await handleMcpToolCall(resources.manager, {
      tool: 'update_overlay_object',
      input: { session_id: 'abc123de', diagram_id: 'main', object_id: 'agent-note', expected_overlay_revision: staleUpdate.scene.overlay_revision, patch: { metadata: { owner: 'merged' } } },
    }) as { status: string; object: { metadata: Record<string, string> } };
    expect(retried).toMatchObject({ status: 'updated', object: { metadata: { owner: 'merged' } } });
  });

  it('makes different-object retries and same-object stale conflicts explicit, including reorder and delete', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await handleMcpToolCall(resources.manager, { tool: 'read_overlay_scene', input: { session_id: 'abc123de', diagram_id: 'main' } }) as { overlay_revision: string };
    const first = await handleMcpToolCall(resources.manager, {
      tool: 'create_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', expected_overlay_revision: initial.overlay_revision, object: overlayObject('left', 'a') },
    }) as { status: string; overlay_revision: string };
    const staleDifferent = await handleMcpToolCall(resources.manager, {
      tool: 'create_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', expected_overlay_revision: initial.overlay_revision, object: overlayObject('right', 'z') },
    }) as { status: string; scene: { overlay_revision: string } };
    expect(first.status).toBe('updated'); expect(staleDifferent.status).toBe('stale');
    const right = await handleMcpToolCall(resources.manager, {
      tool: 'create_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', expected_overlay_revision: staleDifferent.scene.overlay_revision, object: overlayObject('right', 'z') },
    }) as { status: string; overlay_revision: string };
    const staleSame = await handleMcpToolCall(resources.manager, {
      tool: 'update_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', object_id: 'left', expected_overlay_revision: first.overlay_revision, patch: { metadata: { owner: 'late' } } },
    }) as { status: string; scene: { overlay_revision: string } };
    expect(staleSame.status).toBe('stale');
    const ordered = await handleMcpToolCall(resources.manager, {
      tool: 'reorder_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', object_id: 'left', expected_overlay_revision: right.overlay_revision, direction: 'front' },
    }) as { status: string; overlay_revision: string; object: { order_key: string } };
    expect(ordered).toMatchObject({ status: 'updated', object: { order_key: expect.any(String) } });
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'delete_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', object_id: 'left', expected_overlay_revision: staleSame.scene.overlay_revision },
    })).resolves.toMatchObject({ status: 'stale' });
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'delete_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', object_id: 'left', expected_overlay_revision: ordered.overlay_revision },
    })).resolves.toMatchObject({ status: 'updated', deleted_object_id: 'left' });
  });

  it('lists bounded overlay identities and reads found, opaque, missing, and deleted objects', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await handleMcpToolCall(resources.manager, { tool: 'read_overlay_scene', input: { session_id: 'abc123de', diagram_id: 'main' } }) as { overlay_revision: string };
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'list_overlay_scene', input: { session_id: 'abc123de', diagram_id: 'main' },
    })).resolves.toMatchObject({ objects: [] });
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'read_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', object_id: 'gone' },
    })).resolves.toMatchObject({ status: 'missing', object_id: 'gone' });
    expect([...((await durableParticipants()).entries())]).toEqual([]);
    const created = await handleMcpToolCall(resources.manager, {
      tool: 'create_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', expected_overlay_revision: initial.overlay_revision, object: overlayObject('visible') },
    }) as { overlay_revision: string };
    const transient = await handleMcpToolCall(resources.manager, {
      tool: 'create_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', expected_overlay_revision: created.overlay_revision, object: overlayObject('deleted') },
    }) as { overlay_revision: string };
    await handleMcpToolCall(resources.manager, {
      tool: 'delete_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', object_id: 'deleted', expected_overlay_revision: transient.overlay_revision },
    });
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'read_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', object_id: 'deleted' },
    })).resolves.toMatchObject({ status: 'missing', object_id: 'deleted' });
    const listed = await handleMcpToolCall(resources.manager, { tool: 'list_overlay_scene', input: { session_id: 'abc123de', diagram_id: 'main' } }) as { objects: Array<{ id: string; opaque: boolean }> };
    expect(listed.objects).toEqual([{ id: 'visible', kind: 'foundation.card', version: 1, opaque: false, order_key: 'visible' }]);
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'read_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', object_id: 'visible' },
    })).resolves.toMatchObject({ status: 'found', object: { id: 'visible' } });
    const state = await resources.manager.getOrCreateSession('abc123de');
    state.doc.transact(() => {
      const object = (state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('visible')!;
      object.set('kind', 'future.tool');
    });
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'list_overlay_scene', input: { session_id: 'abc123de', diagram_id: 'main' },
    })).resolves.toMatchObject({ writable: false, objects: [{ id: 'visible', opaque: true }] });
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'read_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', object_id: 'visible' },
    })).resolves.toMatchObject({ status: 'opaque', writable: false, object: { id: 'visible', kind: 'future.tool' } });
    expect([...((await durableParticipants()).entries())]).toEqual([
      ['mcp-agent', { name: 'mcp-agent', color: '#7c3aed', type: 'agent' }],
    ]);
  });

  it('returns the command-committed object after a later peer deletion races persistence', async () => {
    const state = await resources.manager.getOrCreateSession('abc123de');
    const initial = await handleMcpToolCall(resources.manager, { tool: 'read_overlay_scene', input: { session_id: 'abc123de', diagram_id: 'main' } }) as { overlay_revision: string };
    const entered = deferred(); const release = deferred();
    const originalPersist = resources.manager.persistSession.bind(resources.manager);
    let pauseOnce = true;
    resources.manager.persistSession = async (...args) => {
      if (pauseOnce) { pauseOnce = false; entered.resolve(); await release.promise; }
      return originalPersist(...args);
    };
    const mutation = handleMcpToolCall(resources.manager, {
      tool: 'create_overlay_object', input: { session_id: 'abc123de', diagram_id: 'main', expected_overlay_revision: initial.overlay_revision, object: overlayObject('race') },
    }) as Promise<{ status: string; overlay_revision: string; object: { id: string } }>;
    await entered.promise;
    state.doc.transact(() => (state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).delete('race'));
    release.resolve();
    const committed = await mutation;
    const afterPeerDelete = await handleMcpToolCall(resources.manager, {
      tool: 'read_overlay_scene', input: { session_id: 'abc123de', diagram_id: 'main' },
    }) as { overlay_revision: string; objects: Array<{ id: string }> };
    expect(committed).toMatchObject({ status: 'updated', object: { id: 'race' }, overlay_revision: expect.any(String) });
    expect(committed.overlay_revision).not.toBe(afterPeerDelete.overlay_revision);
    expect(afterPeerDelete.objects).toEqual([]);
  });

  it('rejects an overlong overlay actor before persisting participant or object state', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await handleMcpToolCall(resources.manager, { tool: 'read_overlay_scene', input: { session_id: 'abc123de', diagram_id: 'main' } }) as { overlay_revision: string };
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'create_overlay_object',
      input: { session_id: 'abc123de', diagram_id: 'main', expected_overlay_revision: initial.overlay_revision, object: overlayObject('too-long'), actor_name: 'x'.repeat(257) },
    })).rejects.toThrow('Overlay mutation exceeds collaboration limits');
    expect((await resources.manager.readMcpOverlayScene('abc123de', 'main')).objects).toEqual([]);
    expect([...((await durableParticipants()).keys())]).toEqual([]);
  });

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

  it('resolves every accepted starter into ordinary name, source, and layout records without template identity', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const session = await resources.manager.getOrCreateSession('abc123de');
    const forbiddenFields = ['template_id', 'templateId', 'family_id', 'familyId'];
    for (const [index, template] of ALL_STARTER_TEMPLATES.entries()) {
      const before = await getSession();
      const name = `Starter conformance ${index + 1}`;
      const created = await handleMcpToolCall(resources.manager, {
        tool: 'create_diagram',
        input: { session_id: 'abc123de', name, template_id: template.id, revision: before.revision },
      }) as { diagram: { id: string; mermaid_text: string } };

      expect(created.diagram.mermaid_text, template.id).toBe(template.source);
      const diagram = session.doc.getMap<Y.Map<unknown>>('diagrams').get(created.diagram.id);
      expect([...diagram!.keys()].sort(), template.id).toEqual(['mermaid', 'name', 'nodePositions']);
      expect([...diagram!.keys()], template.id).toEqual(expect.not.arrayContaining(forbiddenFields));
      expect(diagram!.get('name'), template.id).toBe(name);
      const source = diagram!.get('mermaid');
      const positions = diagram!.get('nodePositions');
      expect(source, template.id).toBeInstanceOf(Y.Text);
      expect((source as Y.Text).toString(), template.id).toBe(template.source);
      expect(positions, template.id).toBeInstanceOf(Y.Map);
      expect((positions as Y.Map<unknown>).size, template.id).toBe(0);
    }
  });

  it('resolves every generated primary templateId into an isolated current diagram revision and history', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    for (const template of PRIMARY_STARTER_TEMPLATES.filter((candidate) => candidate.familyId)) {
      const before = await getSession();
      const created = await handleMcpToolCall(resources.manager, {
        tool: 'create_diagram',
        input: {
          session_id: 'abc123de',
          name: `Catalog ${template.id}`,
          template_id: template.id,
          revision: before.revision,
        },
      }) as { diagram: { id: string; mermaid_text: string; revision: string } };
      expect(created.diagram.mermaid_text, template.id).toBe(template.source);
      const current = await getSession();
      expect(current.diagrams.find((diagram) => diagram.id === created.diagram.id), template.id)
        .toMatchObject({ name: `Catalog ${template.id}`, revision: created.diagram.revision });
      await expect(handleMcpToolCall(resources.manager, {
        tool: 'read_diagram', input: { session_id: 'abc123de', diagram_id: created.diagram.id },
      })).resolves.toMatchObject({ diagram: { mermaid_text: template.source, revision: created.diagram.revision } });
      await expect(handleMcpToolCall(resources.manager, {
        tool: 'list_diagram_history', input: { session_id: 'abc123de', diagram_id: created.diagram.id },
      })).resolves.toMatchObject({
        current_revision: created.diagram.revision,
        revisions: expect.arrayContaining([expect.objectContaining({ result_revision: created.diagram.revision })]),
      });
    }
  });

  it('requires exactly one creation source before it mutates the session', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();
    const invalidInputs = [
      { session_id: 'abc123de', name: 'Missing source', revision: initial.revision },
      { session_id: 'abc123de', name: 'Ambiguous source', mermaid_text: 'flowchart LR\n  A --> B', template_id: 'blank', revision: initial.revision },
      { session_id: 'abc123de', name: 'Unknown starter', template_id: 'not-a-template', revision: initial.revision },
    ];

    for (const input of invalidInputs) {
      await expect(handleMcpToolCall(resources.manager, { tool: 'create_diagram', input })).rejects.toThrow(
        input.template_id === 'not-a-template' ? 'Expected one of: blank, api-sequence' : 'Expected exactly one of mermaid_text or template_id',
      );
    }

    await expect(getSession()).resolves.toMatchObject({ diagrams: [{ id: 'main' }], revision: initial.revision });
  });

  it('rejects a stale session revision before creating a template tab', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();
    await handleMcpToolCall(resources.manager, {
      tool: 'create_diagram',
      input: { session_id: 'abc123de', name: 'First template', template_id: 'flowchart', revision: initial.revision },
    });

    await expect(handleMcpToolCall(resources.manager, {
      tool: 'create_diagram',
      input: { session_id: 'abc123de', name: 'Stale template', template_id: 'sequence', revision: initial.revision },
    })).rejects.toThrow('Stale diagram revision');
    await expect(getSession()).resolves.toMatchObject({ diagrams: [{ id: 'main' }, { name: 'First template' }] });
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

  it('lists and reads immutable named-tab history, then restores only against an immediately current revision', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();
    const written = await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: {
        session_id: 'abc123de',
        diagram_id: 'main',
        mermaid_text: 'sequenceDiagram\n  Browser->>API: GET /health',
        revision: initial.diagrams[0]!.revision,
      },
    }) as { diagram: { revision: string } };

    const history = await handleMcpToolCall(resources.manager, {
      tool: 'list_diagram_history',
      input: { session_id: 'abc123de', diagram_id: 'main' },
    }) as { current_revision: string; revisions: Array<{ revision_id: string; name: string }> };
    expect(history.current_revision).toBe(written.diagram.revision);
    expect(history.revisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Main', revision_id: expect.any(String) }),
    ]));

    const target = history.revisions.at(-1)!.revision_id;
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'read_diagram_revision',
      input: { session_id: 'abc123de', diagram_id: 'main', revision_id: target },
    })).resolves.toMatchObject({ revision_id: target, diagram_id: 'main', mermaid_text: expect.any(String) });

    const fresh = await handleMcpToolCall(resources.manager, {
      tool: 'read_diagram', input: { session_id: 'abc123de', diagram_id: 'main' },
    }) as { diagram: { revision: string } };
    const restored = await handleMcpToolCall(resources.manager, {
      tool: 'restore_diagram_revision',
      input: { session_id: 'abc123de', diagram_id: 'main', revision_id: target, expected_revision: fresh.diagram.revision },
    }) as { status: string; revision?: { restored_from_revision_id?: string } };
    expect(restored).toMatchObject({ status: 'restored', revision: { restored_from_revision_id: target } });

    await expect(handleMcpToolCall(resources.manager, {
      tool: 'restore_diagram_revision',
      input: { session_id: 'abc123de', diagram_id: 'main', revision_id: target, expected_revision: fresh.diagram.revision },
    })).resolves.toMatchObject({ status: 'stale', current_revision: expect.any(String) });
  });

  it('prunes MCP-removed Mermaid layout before the id is reused', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();
    const initialWrite = await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: 'flowchart LR\n  A --> B', revision: initial.diagrams[0]!.revision },
    }) as { diagram: { revision: string } };
    const positions = await nodePositions();
    positions.set('A', { x: 10, y: 20 });
    positions.set('B', { x: 30, y: 40 });
    const afterLayout = await handleMcpToolCall(resources.manager, {
      tool: 'read_diagram', input: { session_id: 'abc123de', diagram_id: 'main' },
    }) as { diagram: { revision: string } };

    const removed = await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: 'flowchart LR\n  B --> C', revision: afterLayout.diagram.revision },
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
    const afterLayout = await handleMcpToolCall(resources.manager, {
      tool: 'read_diagram', input: { session_id: 'abc123de', diagram_id: 'main' },
    }) as { diagram: { revision: string } };

    await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: 'not valid Mermaid', revision: afterLayout.diagram.revision },
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
    const afterFlowchartLayout = await handleMcpToolCall(resources.manager, {
      tool: 'read_diagram', input: { session_id: 'abc123de', diagram_id: 'main' },
    }) as { diagram: { revision: string } };

    const generic = await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: 'sequenceDiagram\n  Browser->>API: request', revision: afterFlowchartLayout.diagram.revision },
    }) as { diagram: { revision: string } };
    expect([...positions.entries()]).toEqual([]);

    positions.set('B', { x: 30, y: 40 });
    const afterGenericLayout = await handleMcpToolCall(resources.manager, {
      tool: 'read_diagram', input: { session_id: 'abc123de', diagram_id: 'main' },
    }) as { diagram: { revision: string } };
    await handleMcpToolCall(resources.manager, {
      tool: 'write_diagram',
      input: { session_id: 'abc123de', diagram_id: 'main', mermaid_text: '', revision: afterGenericLayout.diagram.revision },
    });
    expect([...positions.entries()]).toEqual([]);
  });

  it('records diagram-scoped base and resulting revisions for MCP mutations', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    const initial = await getSession();
    const created = await handleMcpToolCall(resources.manager, {
      tool: 'create_diagram',
      input: { session_id: 'abc123de', name: 'Checkout', template_id: 'blank', revision: initial.revision },
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
      tool: 'create_diagram', input: { session_id: 'abc123de', name: ' main ', template_id: 'blank', revision: initial.revision },
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

  it('rejects a supplied session from another room before invoking the manager', async () => {
    await resources.manager.getOrCreateSession('abc123de');
    await expect(handleMcpToolCall(resources.manager, {
      tool: 'get_session', input: { session_id: 'abc123de' },
    }, 'other123')).rejects.toThrow('Room access denied.');
  });
});
