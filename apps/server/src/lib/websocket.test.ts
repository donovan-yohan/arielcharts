import { mkdtemp, rm } from 'node:fs/promises';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import * as Y from 'yjs';
import { createApp } from '../index.js';
import type { ServerEnv } from './types.js';

const MESSAGE_TYPE_SYNC = 0;
const MESSAGE_TYPE_AWARENESS = 1;

interface TestAwarenessEntry {
  clientId: number;
  clock: number;
  state: Record<string, unknown> | null;
}

function toUint8Array(message: RawData): Uint8Array {
  if (message instanceof ArrayBuffer) {
    return new Uint8Array(message);
  }

  if (Array.isArray(message)) {
    return Buffer.concat(message.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  }

  return Buffer.isBuffer(message) ? message : Buffer.from(message);
}

function encodeSyncMessage(writePayload: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoderInstance = encoding.createEncoder();
  encoding.writeVarUint(encoderInstance, MESSAGE_TYPE_SYNC);
  writePayload(encoderInstance);
  return encoding.toUint8Array(encoderInstance);
}

function encodeAwarenessMessage(entries: TestAwarenessEntry[]): Uint8Array {
  const updateEncoder = encoding.createEncoder();
  encoding.writeVarUint(updateEncoder, entries.length);
  for (const entry of entries) {
    encoding.writeVarUint(updateEncoder, entry.clientId);
    encoding.writeVarUint(updateEncoder, entry.clock);
    encoding.writeVarString(updateEncoder, JSON.stringify(entry.state));
  }

  const messageEncoder = encoding.createEncoder();
  encoding.writeVarUint(messageEncoder, MESSAGE_TYPE_AWARENESS);
  encoding.writeVarUint8Array(messageEncoder, encoding.toUint8Array(updateEncoder));
  return encoding.toUint8Array(messageEncoder);
}

function mainDiagram(doc: Y.Doc): Y.Map<unknown> {
  const diagram = doc.getMap<Y.Map<unknown>>('diagrams').get('main');
  if (!diagram) throw new Error('Expected a main diagram.');
  return diagram;
}

function readMermaidText(doc: Y.Doc): string {
  const text = mainDiagram(doc).get('mermaid');
  if (!(text instanceof Y.Text)) throw new Error('Expected main Mermaid text.');
  return text.toString();
}

function readNodePosition(doc: Y.Doc, id: string): unknown {
  const positions = mainDiagram(doc).get('nodePositions');
  if (!(positions instanceof Y.Map)) throw new Error('Expected node position map.');
  return positions.get(id);
}

async function waitFor(assertion: () => void | Promise<void>, timeoutMs = 5_000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      await assertion();
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }

  await assertion();
}

async function openClient(port: number, sessionId: string) {
  const doc = new Y.Doc();
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/${sessionId}`, {
    headers: {
      origin: 'http://allowed.test',
    },
  });

  socket.on('message', (message: RawData) => {
    const decoderInstance = decoding.createDecoder(toUint8Array(message));
    const messageType = decoding.readVarUint(decoderInstance);

    if (messageType === MESSAGE_TYPE_SYNC) {
      const encoderInstance = encoding.createEncoder();
      encoding.writeVarUint(encoderInstance, MESSAGE_TYPE_SYNC);
      syncProtocol.readSyncMessage(decoderInstance, encoderInstance, doc, socket);

      if (encoding.length(encoderInstance) > 1 && socket.readyState === WebSocket.OPEN) {
        socket.send(Buffer.from(encoding.toUint8Array(encoderInstance)));
      }
      return;
    }

    if (messageType === MESSAGE_TYPE_AWARENESS) {
      decoding.readVarUint8Array(decoderInstance);
    }
  });

  await new Promise<void>((resolve, reject) => {
    socket.once('open', () => resolve());
    socket.once('error', reject);
  });
  socket.send(Buffer.from(encodeSyncMessage((encoderInstance) => {
    syncProtocol.writeSyncStep1(encoderInstance, doc);
  })));

  return {
    doc,
    socket,
    close: async () => {
      if (socket.readyState === WebSocket.CLOSED) {
        return;
      }

      await new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
        socket.close();
      });
    },
    syncUpdate(update: Uint8Array) {
      Y.applyUpdate(doc, update, 'test-client');
      socket.send(Buffer.from(encodeSyncMessage((encoderInstance) => {
        syncProtocol.writeUpdate(encoderInstance, update);
      })));
    },
    sendAwareness(entries: TestAwarenessEntry[]) {
      socket.send(Buffer.from(encodeAwarenessMessage(entries)));
    },
  };
}

describe('SessionWebSocketServer', () => {
  let dataDir: string;
  let app: ReturnType<typeof createApp>;
  let port: number;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'arielcharts-websocket-'));
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

  it('converges duplicate and reversed nested tab updates, then restores them after reconnect', async () => {
    const sessionId = 'abc123de';
    const initialWriter = await openClient(port, sessionId);
    const initialReader = await openClient(port, sessionId);
    await waitFor(async () => {
      const session = await app.manager.getOrCreateSession(sessionId);
      expect(session.sockets.size).toBe(2);
    });

    await waitFor(() => {
      expect(readMermaidText(initialWriter.doc)).toBe('');
      expect(readMermaidText(initialReader.doc)).toBe('');
    });
    const baseline = Y.encodeStateAsUpdate(initialWriter.doc);
    const sourceAndLayout = new Y.Doc();
    const secondLayoutAndActivity = new Y.Doc();
    Y.applyUpdate(sourceAndLayout, baseline);
    Y.applyUpdate(secondLayoutAndActivity, baseline);
    const sourceActivity = { id: 'browser-source', timestamp: 1, actor: { name: 'browser-a', type: 'human' as const }, action: 'edited' as const, diagram_id: 'main' };
    const layoutActivity = { id: 'browser-layout', timestamp: 2, actor: { name: 'browser-b', type: 'human' as const }, action: 'edited' as const, diagram_id: 'main' };
    sourceAndLayout.transact(() => {
      const diagram = mainDiagram(sourceAndLayout);
      const text = diagram.get('mermaid');
      if (!(text instanceof Y.Text)) throw new Error('Expected main Mermaid text.');
      text.insert(0, 'sequenceDiagram\n  Browser->>Gateway: request');
      const positions = diagram.get('nodePositions');
      if (!(positions instanceof Y.Map)) throw new Error('Expected node position map.');
      positions.set('Browser', { x: 20, y: 40 });
      sourceAndLayout.getArray('activity').push([sourceActivity]);
    });
    secondLayoutAndActivity.transact(() => {
      const positions = mainDiagram(secondLayoutAndActivity).get('nodePositions');
      if (!(positions instanceof Y.Map)) throw new Error('Expected node position map.');
      positions.set('Gateway', { x: 220, y: 40 });
      secondLayoutAndActivity.getArray('activity').push([layoutActivity]);
    });
    const sourceUpdate = Y.encodeStateAsUpdate(sourceAndLayout, Y.encodeStateVector(initialWriter.doc));
    const layoutUpdate = Y.encodeStateAsUpdate(secondLayoutAndActivity, Y.encodeStateVector(initialWriter.doc));

    initialWriter.syncUpdate(layoutUpdate);
    initialWriter.syncUpdate(sourceUpdate);
    initialWriter.syncUpdate(layoutUpdate);
    await waitFor(() => {
      expect(readMermaidText(initialReader.doc)).toBe('sequenceDiagram\n  Browser->>Gateway: request');
      expect(readNodePosition(initialReader.doc, 'Browser')).toEqual({ x: 20, y: 40 });
      expect(readNodePosition(initialReader.doc, 'Gateway')).toEqual({ x: 220, y: 40 });
      const activityIds = initialReader.doc.getArray<{ id: string }>('activity').toArray().map((event) => event.id);
      expect(activityIds).toEqual(expect.arrayContaining([sourceActivity.id, layoutActivity.id]));
    });

    await initialWriter.close();
    await initialReader.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const removed = await app.manager.cleanupExpiredSessions({
      ttlMs: 0,
      diskTtlMs: Infinity,
      now: Date.now() + 1,
    });
    expect(removed).toEqual([sessionId]);

    const reopenedWriter = await openClient(port, sessionId);
    const reopenedReader = await openClient(port, sessionId);
    await waitFor(async () => {
      const session = await app.manager.getOrCreateSession(sessionId);
      expect(session.sockets.size).toBe(2);
    });

    await waitFor(() => {
      expect(readMermaidText(reopenedWriter.doc)).toBe('sequenceDiagram\n  Browser->>Gateway: request');
      expect(readNodePosition(reopenedReader.doc, 'Gateway')).toEqual({ x: 220, y: 40 });
      const activityIds = reopenedReader.doc.getArray<{ id: string }>('activity').toArray().map((event) => event.id);
      expect(activityIds).toEqual(expect.arrayContaining([sourceActivity.id, layoutActivity.id]));
    });
    reopenedWriter.doc.transact(() => {
      const text = mainDiagram(reopenedWriter.doc).get('mermaid');
      if (!(text instanceof Y.Text)) throw new Error('Expected main Mermaid text.');
      text.delete(0, text.length);
      text.insert(0, 'sequenceDiagram\n  Browser->>Gateway: reconnect');
    });
    const reconnectUpdate = Y.encodeStateAsUpdate(reopenedWriter.doc, Y.encodeStateVector(reopenedReader.doc));
    reopenedWriter.syncUpdate(reconnectUpdate);
    await waitFor(() => {
      expect(readMermaidText(reopenedReader.doc)).toBe('sequenceDiagram\n  Browser->>Gateway: reconnect');
    });

    await reopenedWriter.close();
    await reopenedReader.close();
  }, 15_000);

  it('drops stale and current foreign awareness echoes but rejects a foreign clock advance', async () => {
    const sessionId = 'abc123de';
    const clientA = await openClient(port, sessionId);
    const clientB = await openClient(port, sessionId);
    const stateA = { user: { name: 'A', color: '#111111', type: 'human' } };
    const currentStateA = { user: { name: 'A', color: '#111111', type: 'human' }, cursor: { anchor: 8, head: 8 } };
    const stateB = { user: { name: 'B', color: '#222222', type: 'human' } };
    clientA.sendAwareness([{ clientId: 101, clock: 1, state: stateA }]);
    clientB.sendAwareness([{ clientId: 202, clock: 1, state: stateB }]);

    await waitFor(async () => {
      const session = await app.manager.getOrCreateSession(sessionId);
      expect(session.awareness.getStates().get(101)).toEqual(stateA);
      expect(session.awareness.getStates().get(202)).toEqual(stateB);
    });

    clientA.sendAwareness([{ clientId: 101, clock: 2, state: currentStateA }]);
    await waitFor(async () => {
      const session = await app.manager.getOrCreateSession(sessionId);
      expect(session.awareness.getStates().get(101)).toEqual(currentStateA);
    });
    clientB.sendAwareness([{ clientId: 101, clock: 1, state: stateA }]);
    clientB.sendAwareness([{ clientId: 101, clock: 2, state: currentStateA }]);
    clientB.sendAwareness([{ clientId: 101, clock: 2, state: null }]);
    const updatedStateB = { user: { name: 'B updated', color: '#222222', type: 'human' } };
    clientB.sendAwareness([{ clientId: 202, clock: 2, state: updatedStateB }]);
    await waitFor(async () => {
      const session = await app.manager.getOrCreateSession(sessionId);
      expect(session.awareness.getStates().get(202)).toEqual(updatedStateB);
    });

    const session = await app.manager.getOrCreateSession(sessionId);
    expect(clientB.socket.readyState).toBe(WebSocket.OPEN);
    expect(session.awareness.getStates().get(101)).toEqual(currentStateA);
    expect([...session.socketClientIds.values()].filter((ids) => ids.has(101))).toHaveLength(1);
    expect([...session.socketClientIds.values()].find((ids) => ids.has(202))?.has(101)).toBe(false);

    clientB.sendAwareness([{ clientId: 101, clock: 3, state: currentStateA }]);
    await waitFor(() => {
      expect(clientB.socket.readyState).toBe(WebSocket.CLOSED);
    });
    expect(session.awareness.getStates().get(101)).toEqual(currentStateA);
    expect(session.awareness.meta.get(101)?.clock).toBe(2);

    await clientA.close();
  });

  it('hands awareness ownership to a reconnect without stale-close cleanup removing it', async () => {
    const sessionId = 'abc123de';
    const original = await openClient(port, sessionId);
    const replacement = await openClient(port, sessionId);
    const initialState = { user: { name: 'Original', color: '#111111', type: 'human' } };
    const replacementState = { user: { name: 'Replacement', color: '#333333', type: 'human' } };
    original.sendAwareness([{ clientId: 303, clock: 1, state: initialState }]);
    const session = await app.manager.getOrCreateSession(sessionId);
    await waitFor(() => {
      expect(session.awareness.getStates().get(303)).toEqual(initialState);
    });
    const originalServerSocket = [...session.socketClientIds.entries()].find(([, ids]) => ids.has(303))?.[0];
    expect(originalServerSocket).toBeDefined();

    originalServerSocket!.close();
    replacement.sendAwareness([{ clientId: 303, clock: 3, state: replacementState }]);
    await waitFor(() => {
      expect(original.socket.readyState).toBe(WebSocket.CLOSED);
    });
    await waitFor(() => {
      expect(session.awareness.getStates().get(303)).toEqual(replacementState);
      expect(session.awareness.meta.get(303)?.clock).toBe(3);
      expect([...session.socketClientIds.values()].filter((ids) => ids.has(303))).toHaveLength(1);
    });

    await replacement.close();
  });
});
