import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { AwarenessState, Participant } from '@arielcharts/shared';
import * as encoding from 'lib0/encoding';
import { applyAwarenessUpdate } from 'y-protocols/awareness';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createActivityEvent } from './activity.js';
import { SessionStore } from './persistence.js';
import { SessionManager } from './session-manager.js';

function encodeAwarenessStateUpdate(entries: Array<{ clientId: number; clock: number; state: AwarenessState | null }>): Uint8Array {
  const encoderInstance = encoding.createEncoder();
  encoding.writeVarUint(encoderInstance, entries.length);

  for (const entry of entries) {
    encoding.writeVarUint(encoderInstance, entry.clientId);
    encoding.writeVarUint(encoderInstance, entry.clock);
    encoding.writeVarString(encoderInstance, JSON.stringify(entry.state));
  }

  return encoding.toUint8Array(encoderInstance);
}

async function createResources() {
  const dataDir = await mkdtemp(join(tmpdir(), 'arielcharts-cleanup-'));

  function createManager() {
    return new SessionManager(new SessionStore(dataDir));
  }

  return {
    dataDir,
    createManager,
    async cleanup() {
      await rm(dataDir, { recursive: true, force: true });
    },
  };
}

describe('SessionManager cleanup and persistence', () => {
  let resources: Awaited<ReturnType<typeof createResources>>;
  let manager: SessionManager;

  beforeEach(async () => {
    resources = await createResources();
    manager = resources.createManager();
  });

  afterEach(async () => {
    await manager.close();
    await resources.cleanup();
  });

  it('evicts idle sessions after the ttl and preserves persisted state', async () => {
    const session = await manager.getOrCreateSession('abc123de');
    await manager.writeDiagram(
      'abc123de',
      'graph TD\n  A-->B',
      createActivityEvent({ action: 'replaced', actorName: 'agent', actorType: 'agent' }),
      [{ name: 'agent', color: '#00aaff', type: 'agent' }],
    );

    const baseline = session.lastAccessedAt;
    const removed = await manager.cleanupExpiredSessions({
      ttlMs: 10,
      diskTtlMs: Infinity,
      now: baseline + 11,
    });

    expect(removed).toEqual(['abc123de']);

    await expect(manager.readSession('abc123de')).resolves.toMatchObject({
      id: 'abc123de',
      mermaidText: 'graph TD\n  A-->B',
      participants: [{ name: 'agent', color: '#00aaff', type: 'agent' }],
    });
  });

  it('does not evict active websocket sessions', async () => {
    const session = await manager.getOrCreateSession('abc123de');
    session.sockets.add({ readyState: 1 } as never);

    const removed = await manager.cleanupExpiredSessions({
      ttlMs: 10,
      diskTtlMs: Infinity,
      now: session.lastAccessedAt + 100,
    });

    expect(removed).toEqual([]);
  });

  it('reloads persisted diagram state and removes transient websocket awareness on shutdown', async () => {
    const session = await manager.getOrCreateSession('abc123de');
    const transientSocket = { readyState: 1 } as never;
    session.sockets.add(transientSocket);
    session.socketClientIds.set(transientSocket, new Set([101]));
    applyAwarenessUpdate(
      session.awareness,
      encodeAwarenessStateUpdate([
        {
          clientId: 101,
          clock: 1,
          state: {
            user: { name: 'alice', color: '#ff00aa', type: 'human' },
            cursor: { anchor: 1, head: 1 },
          },
        },
      ]),
      'test',
    );

    const managedParticipant: Participant = { name: 'backend-agent', color: '#00aaff', type: 'agent' };
    await manager.writeDiagram(
      'abc123de',
      'flowchart LR\n  A-->B',
      createActivityEvent({ action: 'replaced', actorName: 'backend-agent', actorType: 'agent' }),
      [managedParticipant],
    );

    await manager.close();
    manager = resources.createManager();

    await expect(manager.readSession('abc123de')).resolves.toEqual({
      id: 'abc123de',
      title: 'flowchart LR',
      mermaidText: 'flowchart LR\n  A-->B',
      activity: [
        expect.objectContaining({
          actor: { name: 'backend-agent', type: 'agent' },
          action: 'replaced',
        }),
      ],
      participants: [managedParticipant],
      updatedAt: expect.any(Number),
    });
  });
});
