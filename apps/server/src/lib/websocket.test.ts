import { mkdtemp, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import * as syncProtocol from 'y-protocols/sync';
import { applyAwarenessUpdate, Awareness } from 'y-protocols/awareness';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebSocket, type RawData } from 'ws';
import * as Y from 'yjs';
import { createApp } from '../index.js';
import type { ServerEnv } from './types.js';
import { canonicalWorkspaceJson } from './workspace-import.js';

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

function encodeRawAwarenessMessage(entries: Array<Pick<TestAwarenessEntry, 'clientId' | 'clock'> & { stateJson: string }>): Uint8Array {
  const updateEncoder = encoding.createEncoder();
  encoding.writeVarUint(updateEncoder, entries.length);
  for (const entry of entries) {
    encoding.writeVarUint(updateEncoder, entry.clientId);
    encoding.writeVarUint(updateEncoder, entry.clock);
    encoding.writeVarString(updateEncoder, entry.stateJson);
  }

  const messageEncoder = encoding.createEncoder();
  encoding.writeVarUint(messageEncoder, MESSAGE_TYPE_AWARENESS);
  encoding.writeVarUint8Array(messageEncoder, encoding.toUint8Array(updateEncoder));
  return encoding.toUint8Array(messageEncoder);
}

function encodeAwarenessMessage(entries: TestAwarenessEntry[]): Uint8Array {
  return encodeRawAwarenessMessage(entries.map((entry) => ({
    clientId: entry.clientId,
    clock: entry.clock,
    stateJson: JSON.stringify(entry.state),
  })));
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

function overlayBody(doc: Y.Doc, id = 'note'): Y.Text {
  const scene = doc.getMap<Y.Map<unknown>>('overlays').get('main');
  const objects = scene?.get('objects');
  const body = objects instanceof Y.Map ? (objects.get(id) as Y.Map<unknown> | undefined)?.get('body') : undefined;
  if (!(body instanceof Y.Text)) throw new Error('Expected annotation body.');
  return body;
}

function addAnnotation(doc: Y.Doc): void {
  const scene = doc.getMap<Y.Map<unknown>>('overlays').get('main');
  const objects = scene?.get('objects');
  if (!(objects instanceof Y.Map)) throw new Error('Expected main overlay scene.');
  const note = new Y.Map<unknown>();
  note.set('kind', 'annotation.text'); note.set('version', 1); note.set('order_key', 'a');
  note.set('geometry', { x: 0, y: 0, width: 100, height: 40, rotation: 0 });
  note.set('style', {}); note.set('metadata', {}); note.set('payload', {});
  objects.set('note', note); note.set('body', new Y.Text());
}

function signedWorkspaceBundle(source: string) {
  const payload = {
    schema_version: 1 as const,
    order: ['main'],
    diagrams: [{
      id: 'main', name: 'Imported',
      mermaid: { schema_version: 1 as const, source },
      layout: { schema_version: 1 as const, positions: { A: { x: 12, y: 24 } } },
      overlay: {
        version: 1,
        diagram_id: 'main',
        objects: [],
        layers: [{ id: 'default', name: 'Default', order_key: '0000000000000000', visible: true, locked: false, export: true }],
      },
    }],
  };
  return {
    format: 'arielcharts.workspace' as const,
    version: 1 as const,
    payload,
    integrity: { algorithm: 'SHA-256' as const, value: createHash('sha256').update(canonicalWorkspaceJson(payload)).digest('hex') },
  };
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

async function openClient(port: number, sessionId: string, cookie: string, doc = new Y.Doc()) {
  const awareness = new Awareness(doc);
  awareness.setLocalState(null);
  let awarenessMessageCount = 0;
  let documentMessageCount = 0;
  const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/${sessionId}`, {
    headers: {
      origin: 'http://allowed.test',
      cookie,
    },
  });

  socket.on('message', (message: RawData) => {
    const decoderInstance = decoding.createDecoder(toUint8Array(message));
    const messageType = decoding.readVarUint(decoderInstance);

    if (messageType === MESSAGE_TYPE_SYNC) {
      documentMessageCount += 1;
      const encoderInstance = encoding.createEncoder();
      encoding.writeVarUint(encoderInstance, MESSAGE_TYPE_SYNC);
      syncProtocol.readSyncMessage(decoderInstance, encoderInstance, doc, socket);

      if (encoding.length(encoderInstance) > 1 && socket.readyState === WebSocket.OPEN) {
        socket.send(Buffer.from(encoding.toUint8Array(encoderInstance)));
      }
      return;
    }

    if (messageType === MESSAGE_TYPE_AWARENESS) {
      awarenessMessageCount += 1;
      applyAwarenessUpdate(awareness, decoding.readVarUint8Array(decoderInstance), socket);
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
    get awarenessMessageCount() {
      return awarenessMessageCount;
    },
    get documentMessageCount() {
      return documentMessageCount;
    },
    doc,
    awareness,
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
    sendSyncStep2(update: Uint8Array) {
      socket.send(Buffer.from(encodeSyncMessage((encoderInstance) => {
        encoding.writeVarUint(encoderInstance, syncProtocol.messageYjsSyncStep2);
        encoding.writeVarUint8Array(encoderInstance, update);
      })));
    },
    sendAwareness(entries: TestAwarenessEntry[]) {
      socket.send(Buffer.from(encodeAwarenessMessage(entries)));
    },
    sendRawAwareness(entries: Array<Pick<TestAwarenessEntry, 'clientId' | 'clock'> & { stateJson: string }>) {
      socket.send(Buffer.from(encodeRawAwarenessMessage(entries)));
    },
    sendRaw(payload: Uint8Array) {
      socket.send(Buffer.from(payload));
    },
  };
}

describe('SessionWebSocketServer', () => {
  let dataDir: string;
  let app: ReturnType<typeof createApp>;
  let port: number;
  let roomCookie: string;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'arielcharts-websocket-'));
    const env: ServerEnv = {
      port: 0,
      dataDir,
      cleanupIntervalMs: 60_000,
      sessionTtlMs: 60_000,
      diskTtlMs: Infinity,
      allowedOrigins: ['http://allowed.test'],
      roomAccessCryptoProfile: 'test',
    };
    app = createApp(env);

    await new Promise<void>((resolve) => {
      app.server.listen(0, resolve);
    });

    port = (app.server.address() as AddressInfo).port;
    const room = await app.createRoom('abc123de');
    roomCookie = (app.roomAccess.browserCookieHeaders('abc123de', room.accessVersion)['set-cookie'] as string).split(';')[0]!;
  });

  afterEach(async () => {
    await app.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('converges duplicate and reversed nested tab updates, then restores them after reconnect', async () => {
    const sessionId = 'abc123de';
    const initialWriter = await openClient(port, sessionId, roomCookie);
    const initialReader = await openClient(port, sessionId, roomCookie);
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

    const reopenedWriter = await openClient(port, sessionId, roomCookie);
    const reopenedReader = await openClient(port, sessionId, roomCookie);
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

  it('fans a server-authoritative workspace import to the HTTP initiator and peer exactly once', async () => {
    const sessionId = 'abc123de';
    const importer = await openClient(port, sessionId, roomCookie);
    const peer = await openClient(port, sessionId, roomCookie);
    await waitFor(async () => expect((await app.manager.requireSession(sessionId)).sockets.size).toBe(2));
    await waitFor(() => {
      expect(readMermaidText(importer.doc)).toBe('');
      expect(readMermaidText(peer.doc)).toBe('');
    });

    const beforePeerWrite = Y.encodeStateVector(peer.doc);
    const peerText = mainDiagram(peer.doc).get('mermaid');
    if (!(peerText instanceof Y.Text)) throw new Error('Expected peer Mermaid text.');
    peerText.insert(0, 'flowchart LR\n  Peer --> BeforeImport');
    peer.syncUpdate(Y.encodeStateAsUpdate(peer.doc, beforePeerWrite));
    await waitFor(() => expect(readMermaidText(importer.doc)).toContain('BeforeImport'));

    const beforeImport = await app.manager.readWorkspaceRevision(sessionId);
    const importerMessagesBefore = importer.documentMessageCount;
    const peerMessagesBefore = peer.documentMessageCount;
    await expect(app.manager.importWorkspace(sessionId, beforeImport.revision, signedWorkspaceBundle('flowchart LR\n  Imported --> Workspace')))
      .resolves.toMatchObject({ status: 'imported' });
    await waitFor(() => {
      expect(readMermaidText(importer.doc)).toBe('flowchart LR\n  Imported --> Workspace');
      expect(readMermaidText(peer.doc)).toBe('flowchart LR\n  Imported --> Workspace');
    });
    expect(importer.documentMessageCount - importerMessagesBefore).toBe(1);
    expect(peer.documentMessageCount - peerMessagesBefore).toBe(1);
    await importer.close();
    await peer.close();
  }, 15_000);

  it('fans an authoritative repaired offline annotation merge to stale sender, healthy peer, server, and reload', async () => {
    const sessionId = 'abc123de';
    const initialLeft = await openClient(port, sessionId, roomCookie);
    const initialRight = await openClient(port, sessionId, roomCookie);
    await waitFor(() => { expect(readMermaidText(initialLeft.doc)).toBe(''); expect(readMermaidText(initialRight.doc)).toBe(''); });
    const beforeNote = Y.encodeStateVector(initialLeft.doc);
    addAnnotation(initialLeft.doc);
    initialLeft.syncUpdate(Y.encodeStateAsUpdate(initialLeft.doc, beforeNote));
    await waitFor(() => expect(overlayBody(initialRight.doc).toString()).toBe(''));
    await initialLeft.close(); await initialRight.close();

    overlayBody(initialLeft.doc).insert(0, 'L'.repeat(5_000));
    overlayBody(initialRight.doc).insert(0, 'R'.repeat(5_000));
    const healthy = await openClient(port, sessionId, roomCookie, initialLeft.doc);
    await waitFor(async () => expect(overlayBody((await app.manager.getOrCreateSession(sessionId)).doc).toString()).toHaveLength(5_000));
    const healthyMessagesBeforeRepair = healthy.documentMessageCount;
    const laterSender = await openClient(port, sessionId, roomCookie, initialRight.doc);
    await waitFor(async () => {
      const serverText = overlayBody((await app.manager.getOrCreateSession(sessionId)).doc).toString();
      expect(Buffer.byteLength(serverText, 'utf8')).toBe(8_192);
      expect(overlayBody(healthy.doc).toString()).toBe(serverText);
      expect(overlayBody(laterSender.doc).toString()).toBe(serverText);
    });
    expect(healthy.documentMessageCount - healthyMessagesBeforeRepair).toBeLessThanOrEqual(2);
    await healthy.close(); await laterSender.close();
    const session = await app.manager.getOrCreateSession(sessionId);
    await app.manager.cleanupExpiredSessions({ ttlMs: 0, diskTtlMs: Infinity, now: session.lastAccessedAt + 1 });
    const reload = await openClient(port, sessionId, roomCookie);
    await waitFor(() => {
      expect(Buffer.byteLength(overlayBody(reload.doc).toString(), 'utf8')).toBe(8_192);
      expect(overlayBody(reload.doc).toString()).toBe(overlayBody(initialLeft.doc).toString());
    });
    await reload.close();
  }, 15_000);

  it('rejects malformed and oversized SyncStep2 updates before live state, peer fan-out, or persistence', async () => {
    const sessionId = 'abc123de';
    const attacker = await openClient(port, sessionId, roomCookie);
    const peer = await openClient(port, sessionId, roomCookie);
    await waitFor(() => {
      expect(readMermaidText(attacker.doc)).toBe('');
      expect(readMermaidText(peer.doc)).toBe('');
    });
    const session = await app.manager.getOrCreateSession(sessionId);
    const before = Buffer.from(Y.encodeStateAsUpdate(session.doc));
    const activityBefore = session.doc.getArray('activity').toArray();
    const peerMessagesBefore = peer.documentMessageCount;

    attacker.sendSyncStep2(new Uint8Array([255]));
    attacker.sendSyncStep2(new Uint8Array(129 * 1024));

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(Buffer.from(Y.encodeStateAsUpdate(session.doc))).toEqual(before);
    expect(session.doc.getArray('activity').toArray()).toEqual(activityBefore);
    expect(peer.documentMessageCount).toBe(peerMessagesBefore);
    expect(readMermaidText(peer.doc)).toBe('');

    const normal = new Y.Doc();
    Y.applyUpdate(normal, Y.encodeStateAsUpdate(attacker.doc));
    const text = mainDiagram(normal).get('mermaid');
    if (!(text instanceof Y.Text)) throw new Error('Expected Mermaid text.');
    text.insert(0, 'flowchart LR\n  Client-->Server');
    attacker.syncUpdate(Y.encodeStateAsUpdate(normal, Y.encodeStateVector(attacker.doc)));
    await waitFor(() => {
      expect(readMermaidText(peer.doc)).toBe('flowchart LR\n  Client-->Server');
    });

    await attacker.close();
    await peer.close();
  });

  it('rejects schema-invalid SyncStep2 before live state, peer fan-out, or persistence', async () => {
    const sessionId = 'abc123de';
    const attacker = await openClient(port, sessionId, roomCookie);
    const peer = await openClient(port, sessionId, roomCookie);
    await waitFor(() => expect(readMermaidText(peer.doc)).toBe(''));
    const session = await app.manager.getOrCreateSession(sessionId);
    const before = Buffer.from(Y.encodeStateAsUpdate(session.doc));
    const peerMessagesBefore = peer.documentMessageCount;
    const persist = vi.spyOn(app.manager, 'persistSession');
    const invalid = new Y.Doc();
    Y.applyUpdate(invalid, Y.encodeStateAsUpdate(attacker.doc));
    invalid.getMap('presence').set('invalid', { name: 'invalid', color: '#111111', type: 'robot' });
    attacker.sendSyncStep2(Y.encodeStateAsUpdate(invalid, Y.encodeStateVector(attacker.doc)));

    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(Buffer.from(Y.encodeStateAsUpdate(session.doc))).toEqual(before);
    expect(peer.documentMessageCount).toBe(peerMessagesBefore);
    expect(persist).not.toHaveBeenCalled();

    const normal = new Y.Doc();
    Y.applyUpdate(normal, Y.encodeStateAsUpdate(attacker.doc));
    const text = mainDiagram(normal).get('mermaid');
    if (!(text instanceof Y.Text)) throw new Error('Expected Mermaid text.');
    text.insert(0, 'flowchart LR\n  Valid-->AfterRejectedSchema');
    attacker.syncUpdate(Y.encodeStateAsUpdate(normal, Y.encodeStateVector(attacker.doc)));
    await waitFor(() => expect(readMermaidText(peer.doc)).toContain('AfterRejectedSchema'));

    persist.mockRestore();
    await attacker.close();
    await peer.close();
  });

  it('rejects unbounded ink geometry before live state, peer fan-out, or persistence', async () => {
    const sessionId = 'abc123de';
    const attacker = await openClient(port, sessionId, roomCookie);
    const peer = await openClient(port, sessionId, roomCookie);
    const session = await app.manager.getOrCreateSession(sessionId);
    await new Promise((resolve) => setTimeout(resolve, 75));
    const before = Buffer.from(Y.encodeStateAsUpdate(session.doc));
    const peerMessagesBefore = peer.documentMessageCount;
    const persist = vi.spyOn(app.manager, 'persistSession');
    const invalid = new Y.Doc(); Y.applyUpdate(invalid, Y.encodeStateAsUpdate(attacker.doc));
    const scene = new Y.Map<unknown>(); const objects = new Y.Map<unknown>(); const ink = new Y.Map<unknown>();
    scene.set('version', 1); scene.set('objects', objects);
    ink.set('kind', 'ink.stroke'); ink.set('version', 1); ink.set('order_key', 'ink');
    ink.set('geometry', { x: 1e308, y: -1.5, width: 13, height: 13, rotation: 0 });
    ink.set('style', { color: '#2563eb', width: 3, opacity: 1 }); ink.set('metadata', { export: 'composite-export' });
    ink.set('payload', { mode: 'pen', composite_export: true, points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] });
    objects.set('ink', ink); invalid.getMap<Y.Map<unknown>>('overlays').set('main', scene);
    attacker.sendSyncStep2(Y.encodeStateAsUpdate(invalid, Y.encodeStateVector(attacker.doc)));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(Buffer.from(Y.encodeStateAsUpdate(session.doc))).toEqual(before);
    expect(peer.documentMessageCount).toBe(peerMessagesBefore);
    expect(persist).not.toHaveBeenCalled();
    persist.mockRestore(); await attacker.close(); await peer.close();
  });

  it('accepts a realistic burst of source deltas without consuming the awareness budget', async () => {
    const sessionId = 'abc123de';
    const writer = await openClient(port, sessionId, roomCookie);
    const peer = await openClient(port, sessionId, roomCookie);
    await waitFor(() => expect(readMermaidText(peer.doc)).toBe(''));
    const text = mainDiagram(writer.doc).get('mermaid');
    if (!(text instanceof Y.Text)) throw new Error('Expected Mermaid text.');

    for (let index = 0; index < 160; index += 1) {
      const before = Y.encodeStateVector(writer.doc);
      text.insert(text.length, 'x');
      writer.sendSyncStep2(Y.encodeStateAsUpdate(writer.doc, before));
    }

    await waitFor(() => expect(readMermaidText(peer.doc)).toBe('x'.repeat(160)), 10_000);
    await writer.close();
    await peer.close();
  }, 15_000);

  it('drops stale and current foreign awareness echoes but rejects a foreign clock advance', async () => {
    const sessionId = 'abc123de';
    const clientA = await openClient(port, sessionId, roomCookie);
    const clientB = await openClient(port, sessionId, roomCookie);
    const stateA = { user: { name: 'A', color: '#111111', type: 'human' } };
    const currentStateA = {
      user: { name: 'A', color: '#111111', type: 'human' },
      cursor: { anchor: 8, head: 8 },
      canvas: { diagram_id: 'main', laser: { active: true, sequence: 7, point: { x: 12, y: 16 } } },
    };
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

  it('does not mirror cursor-only awareness changes into the durable participant map', async () => {
    const sessionId = 'abc123de';
    const client = await openClient(port, sessionId, roomCookie);
    const participant = { name: 'Cursor user', color: '#1188cc', type: 'human' };
    client.sendAwareness([{ clientId: 404, clock: 1, state: { user: participant } }]);

    const session = await app.manager.getOrCreateSession(sessionId);
    await waitFor(() => {
      expect(session.awareness.getStates().get(404)).toEqual({ user: participant });
      expect(session.doc.getMap('presence').get(participant.name)).toEqual(participant);
    });

    let documentUpdates = 0;
    const countDocumentUpdate = () => { documentUpdates += 1; };
    session.doc.on('update', countDocumentUpdate);
    client.sendAwareness([{
      clientId: 404,
      clock: 2,
      state: {
        user: participant,
        canvas: { diagram_id: 'main', cursor: { x: 120, y: 80 }, selected_node_ids: ['Gateway'] },
      },
    }]);

    await waitFor(() => {
      expect(session.awareness.getStates().get(404)).toEqual({
        user: participant,
        canvas: { diagram_id: 'main', cursor: { x: 120, y: 80 }, selected_node_ids: ['Gateway'] },
      });
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    session.doc.off('update', countDocumentUpdate);

    expect(documentUpdates).toBe(0);
    await client.close();
  });

  it('bounds presenter awareness and rejects stale camera sequences without durable writes', async () => {
    const sessionId = 'abc123de';
    const client = await openClient(port, sessionId, roomCookie);
    const user = { name: 'Presenter', color: '#1188cc', type: 'human' };
    const valid = { active: true, sequence: 4, diagram_id: 'main', viewport: { pan_x: 12, pan_y: 24, zoom: 1.25 }, extra: 'drop-me' };
    client.sendAwareness([{ clientId: 704, clock: 1, state: { user, presenter: valid } }]);
    const session = await app.manager.getOrCreateSession(sessionId);
    await waitFor(() => expect(session.awareness.getStates().get(704)).toEqual({
      user,
      presenter: { active: true, sequence: 4, diagram_id: 'main', viewport: { pan_x: 12, pan_y: 24, zoom: 1.25 } },
    }));

    client.sendAwareness([{ clientId: 704, clock: 2, state: { user, canvas: { diagram_id: 'main', cursor: { x: 4, y: 8 } }, presenter: valid } }]);
    await waitFor(() => expect(session.awareness.getStates().get(704)).toEqual({
      user,
      canvas: { diagram_id: 'main', cursor: { x: 4, y: 8 } },
      presenter: { active: true, sequence: 4, diagram_id: 'main', viewport: { pan_x: 12, pan_y: 24, zoom: 1.25 } },
    }));

    client.sendAwareness([{ clientId: 704, clock: 3, state: { user, presenter: { ...valid, sequence: 3 } } }]);
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(session.awareness.getStates().get(704)).toEqual({
      user,
      canvas: { diagram_id: 'main', cursor: { x: 4, y: 8 } },
      presenter: { active: true, sequence: 4, diagram_id: 'main', viewport: { pan_x: 12, pan_y: 24, zoom: 1.25 } },
    });

    client.sendAwareness([{ clientId: 704, clock: 4, state: { user, presenter: { ...valid, sequence: 5, viewport: { pan_x: 0, pan_y: 0, zoom: 99 } } } }]);
    await waitFor(() => expect(session.awareness.getStates().get(704)).toEqual({ user }));
    await client.close();
    await waitFor(() => expect(session.awareness.getStates().has(704)).toBe(false));

    const replacement = await openClient(port, sessionId, roomCookie);
    // Awareness clocks remain monotonic across a reclaimed client id, while
    // the presenter-specific sequence watermark resets with socket ownership.
    replacement.sendAwareness([{ clientId: 704, clock: 6, state: { user, presenter: { ...valid, sequence: 1 } } }]);
    await waitFor(() => expect(session.awareness.getStates().get(704)).toEqual({
      user,
      presenter: { active: true, sequence: 1, diagram_id: 'main', viewport: { pan_x: 12, pan_y: 24, zoom: 1.25 } },
    }));
    await replacement.close();
  });

  it('keeps awareness-only agents live-only and removes them on disconnect', async () => {
    const sessionId = 'abc123de';
    const client = await openClient(port, sessionId, roomCookie);
    const participant = { name: 'Transient agent', color: '#7c3aed', type: 'agent' };
    client.sendAwareness([{ clientId: 408, clock: 1, state: { user: participant } }]);

    const session = await app.manager.getOrCreateSession(sessionId);
    await waitFor(() => {
      expect(session.awareness.getStates().get(408)).toEqual({ user: participant });
    });
    expect(session.doc.getMap('presence').has(participant.name)).toBe(false);

    await client.close();
    await waitFor(() => {
      expect(session.awareness.getStates().has(408)).toBe(false);
    });
    expect(session.doc.getMap('presence').has(participant.name)).toBe(false);
  });

  it('preserves a durable agent when a live human claims the same name', async () => {
    const sessionId = 'abc123de';
    const client = await openClient(port, sessionId, roomCookie);
    const durableAgent = { name: 'Shared name', color: '#7c3aed', type: 'agent' } as const;
    const liveHuman = { name: 'Shared name', color: '#0284c7', type: 'human' } as const;
    const session = await app.manager.getOrCreateSession(sessionId);
    session.doc.getMap('presence').set(durableAgent.name, durableAgent);

    client.sendAwareness([{ clientId: 409, clock: 1, state: { user: liveHuman } }]);
    await waitFor(() => {
      expect(session.awareness.getStates().get(409)).toEqual({ user: liveHuman });
    });
    expect(session.doc.getMap('presence').get(durableAgent.name)).toEqual(durableAgent);
    expect((await app.manager.getSession(sessionId)).participants).toEqual([durableAgent]);

    await client.close();
    await waitFor(() => {
      expect(session.awareness.getStates().has(409)).toBe(false);
    });
    expect(session.doc.getMap('presence').get(durableAgent.name)).toEqual(durableAgent);
    expect((await app.manager.getSession(sessionId)).participants).toEqual([durableAgent]);
  });

  it('strips over-limit canvas awareness while preserving the owned participant state', async () => {
    const sessionId = 'abc123de';
    const client = await openClient(port, sessionId, roomCookie);
    const participant = { name: 'Bounded user', color: '#1188cc', type: 'human' };
    client.sendAwareness([{
      clientId: 405,
      clock: 1,
      state: {
        user: participant,
        cursor: { anchor: 4, head: 4 },
        canvas: {
          diagram_id: 'main'.repeat(50),
          cursor: { x: 1_000_001, y: 20 },
          selected_node_ids: Array.from({ length: 101 }, (_, index) => `node-${index}`),
        },
      },
    }]);

    const session = await app.manager.getOrCreateSession(sessionId);
    await waitFor(() => {
      expect(session.awareness.getStates().get(405)).toEqual({
        user: participant,
        cursor: { anchor: 4, head: 4 },
      });
      expect(session.doc.getMap('presence').get(participant.name)).toEqual(participant);
    });

    expect(client.socket.readyState).toBe(WebSocket.OPEN);
    await client.close();
  });

  it('keeps a bounded owned editing marker live-only and strips malformed canvas entries', async () => {
    const sessionId = 'abc123de';
    const client = await openClient(port, sessionId, roomCookie);
    const participant = { name: 'Editing user', color: '#1188cc', type: 'human' };
    client.sendAwareness([{
      clientId: 415,
      clock: 1,
      state: { user: participant, canvas: { diagram_id: 'main', editing_node_id: 'node-a' } },
    }]);

    const session = await app.manager.getOrCreateSession(sessionId);
    await waitFor(() => {
      expect(session.awareness.getStates().get(415)).toEqual({
        user: participant,
        canvas: { diagram_id: 'main', editing_node_id: 'node-a' },
      });
    });
    expect(session.doc.getMap('presence').get(participant.name)).toEqual(participant);

    client.sendAwareness([{
      clientId: 415,
      clock: 2,
      state: { user: participant, canvas: { diagram_id: 'main', editing_node_id: 'x'.repeat(257) } },
    }]);
    await waitFor(() => {
      expect(session.awareness.getStates().get(415)).toEqual({ user: participant });
    });
    await client.close();
  });

  it('keeps bounded laser samples awareness-only and strips invalid laser state', async () => {
    const sessionId = 'abc123de';
    const client = await openClient(port, sessionId, roomCookie);
    const participant = { name: 'Laser user', color: '#ff3366', type: 'human' };
    const session = await app.manager.getOrCreateSession(sessionId);
    let documentUpdates = 0;
    session.doc.on('update', () => { documentUpdates += 1; });

    client.sendAwareness([{
      clientId: 416,
      clock: 1,
      state: { user: participant },
    }]);
    await waitFor(() => {
      expect(session.awareness.getStates().get(416)).toEqual({ user: participant });
    });
    documentUpdates = 0;

    client.sendAwareness([{
      clientId: 416,
      clock: 2,
      state: { user: participant, canvas: { diagram_id: 'main', laser: { active: true, sequence: 1, point: { x: 24, y: -12 } } } },
    }]);
    await waitFor(() => {
      expect(session.awareness.getStates().get(416)).toEqual({
        user: participant,
        canvas: { diagram_id: 'main', laser: { active: true, sequence: 1, point: { x: 24, y: -12 } } },
      });
    });
    expect(documentUpdates).toBe(0);
    expect(session.doc.share.has('laser')).toBe(false);

    client.sendAwareness([{
      clientId: 416,
      clock: 3,
      state: { user: participant, canvas: { diagram_id: 'main', laser: { active: true, sequence: 2, point: { x: 1_000_001, y: 0 } } } },
    }]);
    await waitFor(() => {
      expect(session.awareness.getStates().get(416)).toEqual({ user: participant });
    });
    expect(documentUpdates).toBe(0);
    await client.close();
  });

  it('keeps the laser watermark for owned lifetime without old-clock poisoning and resets on disconnect', async () => {
    const sessionId = 'abc123de';
    const sender = await openClient(port, sessionId, roomCookie);
    const observer = await openClient(port, sessionId, roomCookie);
    const participant = { name: 'Sequenced laser', color: '#ff3366', type: 'human' };
    const session = await app.manager.getOrCreateSession(sessionId);
    const active = (sequence: number) => ({
      user: participant,
      canvas: { diagram_id: 'main', laser: { active: true, sequence, point: { x: sequence, y: sequence } } },
    });

    sender.sendAwareness([{ clientId: 417, clock: 1, state: active(5) }]);
    await waitFor(() => expect(session.awareness.getStates().get(417)).toEqual(active(5)));
    const observerAfterAccepted = observer.awarenessMessageCount;
    sender.sendAwareness([{ clientId: 417, clock: 2, state: active(5) }]);
    sender.sendAwareness([{ clientId: 417, clock: 3, state: active(4) }]);
    await new Promise((resolve) => setTimeout(resolve, 75));
    expect(session.awareness.getStates().get(417)).toEqual(active(5));
    expect(session.awareness.meta.get(417)?.clock).toBe(1);
    expect(observer.awarenessMessageCount).toBe(observerAfterAccepted);

    const inactive = { user: participant, canvas: { diagram_id: 'main', laser: { active: false, sequence: 6 } } };
    sender.sendAwareness([{ clientId: 417, clock: 4, state: inactive }]);
    await waitFor(() => expect(session.awareness.getStates().get(417)).toEqual(inactive));
    const observerAfterInactive = observer.awarenessMessageCount;
    sender.sendAwareness([{ clientId: 417, clock: 5, state: active(1) }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(session.awareness.getStates().get(417)).toEqual(inactive);
    expect(observer.awarenessMessageCount).toBe(observerAfterInactive);

    sender.sendAwareness([{ clientId: 417, clock: 6, state: { user: participant } }]);
    await waitFor(() => expect(session.awareness.getStates().get(417)).toEqual({ user: participant }));
    const observerAfterOmitted = observer.awarenessMessageCount;
    sender.sendAwareness([{ clientId: 417, clock: 5, state: active(999) }]);
    sender.sendAwareness([{ clientId: 417, clock: 7, state: active(6) }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(session.awareness.getStates().get(417)).toEqual({ user: participant });
    expect(session.awareness.meta.get(417)?.clock).toBe(6);
    expect(observer.awarenessMessageCount).toBe(observerAfterOmitted);

    sender.sendAwareness([{ clientId: 417, clock: 8, state: active(7) }]);
    await waitFor(() => expect(session.awareness.getStates().get(417)).toEqual(active(7)));
    const freshObserver = await openClient(port, sessionId, roomCookie);
    await waitFor(() => expect(freshObserver.awareness.getStates().get(417)).toEqual(active(7)));
    expect(freshObserver.awareness.getStates().get(417)).not.toEqual(active(999));
    await freshObserver.close();

    await sender.close();
    await waitFor(() => expect(session.awareness.getStates().has(417)).toBe(false));
    const reconnected = await openClient(port, sessionId, roomCookie);
    reconnected.sendAwareness([{ clientId: 417, clock: 100, state: active(1) }]);
    await waitFor(() => expect(session.awareness.getStates().get(417)).toEqual(active(1)));
    await reconnected.close();
    await observer.close();
  });

  it('strips stale transient samples while fanning out fresh canvas presence', async () => {
    const sessionId = 'abc123de';
    const sender = await openClient(port, sessionId, roomCookie);
    const observer = await openClient(port, sessionId, roomCookie);
    const participant = { name: 'Mixed presence', color: '#7c3aed', type: 'human' };
    const session = await app.manager.getOrCreateSession(sessionId);
    const laser = (sequence: number) => ({ active: true, sequence, point: { x: sequence, y: sequence } });
    const inkPreview = (sequence: number) => ({
      active: true, sequence, mode: 'pen', color: '#7c3aed', width: 3, opacity: 1,
      points: [{ x: 1, y: 2 }, { x: 3, y: 4 }],
    });

    sender.sendAwareness([{
      clientId: 420,
      clock: 1,
      state: { user: participant, canvas: { diagram_id: 'main', laser: laser(5) } },
    }]);
    await waitFor(() => expect(observer.awareness.getStates().get(420)).toEqual({
      user: participant, canvas: { diagram_id: 'main', laser: laser(5) },
    }));
    const observerBeforeCursor = observer.awarenessMessageCount;
    sender.sendAwareness([{
      clientId: 420,
      clock: 2,
      state: { user: participant, canvas: { diagram_id: 'main', cursor: { x: 80, y: 48 }, laser: laser(5) } },
    }]);
    const cursorWithCurrentLaser = { user: participant, canvas: { diagram_id: 'main', cursor: { x: 80, y: 48 }, laser: laser(5) } };
    await waitFor(() => {
      expect(session.awareness.getStates().get(420)).toEqual(cursorWithCurrentLaser);
      expect(observer.awareness.getStates().get(420)).toEqual(cursorWithCurrentLaser);
      expect(observer.awarenessMessageCount).toBeGreaterThan(observerBeforeCursor);
    });

    sender.sendAwareness([{
      clientId: 420,
      clock: 3,
      state: { user: participant, canvas: { diagram_id: 'main', cursor: { x: 84, y: 52 }, laser: laser(4) } },
    }]);
    const cursorOnly = { user: participant, canvas: { diagram_id: 'main', cursor: { x: 84, y: 52 } } };
    await waitFor(() => {
      expect(session.awareness.getStates().get(420)).toEqual(cursorOnly);
      expect(observer.awareness.getStates().get(420)).toEqual(cursorOnly);
    });

    sender.sendAwareness([{
      clientId: 420,
      clock: 4,
      state: { user: participant, canvas: { diagram_id: 'main', ink_preview: inkPreview(7) } },
    }]);
    await waitFor(() => expect(observer.awareness.getStates().get(420)).toEqual({
      user: participant, canvas: { diagram_id: 'main', ink_preview: inkPreview(7) },
    }));
    const observerBeforeSelection = observer.awarenessMessageCount;
    sender.sendAwareness([{
      clientId: 420,
      clock: 5,
      state: { user: participant, canvas: { diagram_id: 'main', selected_node_ids: ['A', 'B'], ink_preview: inkPreview(7) } },
    }]);
    const selectionWithCurrentPreview = { user: participant, canvas: { diagram_id: 'main', selected_node_ids: ['A', 'B'], ink_preview: inkPreview(7) } };
    await waitFor(() => {
      expect(session.awareness.getStates().get(420)).toEqual(selectionWithCurrentPreview);
      expect(observer.awareness.getStates().get(420)).toEqual(selectionWithCurrentPreview);
      expect(observer.awarenessMessageCount).toBeGreaterThan(observerBeforeSelection);
    });

    sender.sendAwareness([{
      clientId: 420,
      clock: 6,
      state: { user: participant, canvas: { diagram_id: 'main', selected_node_ids: ['A', 'B'], ink_preview: inkPreview(6) } },
    }]);
    const selectionOnly = { user: participant, canvas: { diagram_id: 'main', selected_node_ids: ['A', 'B'] } };
    await waitFor(() => {
      expect(session.awareness.getStates().get(420)).toEqual(selectionOnly);
      expect(observer.awareness.getStates().get(420)).toEqual(selectionOnly);
    });
    const freshObserver = await openClient(port, sessionId, roomCookie);
    await waitFor(() => expect(freshObserver.awareness.getStates().get(420)).toEqual(selectionOnly));

    await freshObserver.close();
    await sender.close();
    await observer.close();
  });

  it('resets reconnect watermarks while preserving concurrent canvas transients within the shared awareness budget', async () => {
    const sessionId = 'abc123de';
    const sender = await openClient(port, sessionId, roomCookie);
    const observer = await openClient(port, sessionId, roomCookie);
    const participant = { name: 'Reconnect presence', color: '#2563eb', type: 'human' };
    const sample = (sequence: number) => ({
      user: participant,
      canvas: {
        cursor: { x: sequence, y: sequence + 1 },
        diagram_id: 'main',
        ink_preview: { active: true, color: '#2563eb', mode: 'pen', opacity: 1, points: [{ x: sequence, y: sequence }], sequence, width: 3 },
        laser: { active: true, point: { x: sequence, y: sequence }, sequence },
      },
    });
    sender.sendAwareness([{ clientId: 421, clock: 1, state: sample(80) }]);
    await waitFor(() => expect(observer.awareness.getStates().get(421)).toEqual(sample(80)));
    await sender.close();
    await waitFor(() => expect(observer.awareness.getStates().has(421)).toBe(false));

    const reconnected = await openClient(port, sessionId, roomCookie);
    // 81 combined canvas frames stay below the 120-message/10-second budget
    // while exercising fresh cursor, ink, and laser fan-out after reconnect.
    for (let sequence = 1; sequence <= 81; sequence += 1) {
      reconnected.sendAwareness([{ clientId: 421, clock: 100 + sequence, state: sample(sequence) }]);
    }
    await waitFor(() => expect(observer.awareness.getStates().get(421)).toEqual(sample(81)));
    expect(reconnected.socket.readyState).toBe(WebSocket.OPEN);
    await reconnected.close();
    await observer.close();
  });

  it('admits the legitimate ten-second laser cadence with stop and collaboration headroom', async () => {
    const sessionId = 'abc123de';
    const sender = await openClient(port, sessionId, roomCookie);
    const observer = await openClient(port, sessionId, roomCookie);
    const participant = { name: 'Sustained laser', color: '#ff3366', type: 'human' };
    const session = await app.manager.getOrCreateSession(sessionId);
    for (let sequence = 1; sequence <= 80; sequence += 1) {
      sender.sendAwareness([{
        clientId: 418,
        clock: sequence,
        state: { user: participant, canvas: { diagram_id: 'main', laser: { active: true, sequence, point: { x: sequence, y: sequence } } } },
      }]);
    }
    sender.sendAwareness([{
      clientId: 418,
      clock: 81,
      state: { user: participant, canvas: { diagram_id: 'main', laser: { active: false, sequence: 81 } } },
    }]);
    await waitFor(() => {
      expect(session.awareness.getStates().get(418)).toEqual({
        user: participant,
        canvas: { diagram_id: 'main', laser: { active: false, sequence: 81 } },
      });
    });
    await waitFor(() => {
      expect(observer.awareness.getStates().get(418)).toEqual({
        user: participant,
        canvas: { diagram_id: 'main', laser: { active: false, sequence: 81 } },
      });
      expect(observer.awarenessMessageCount).toBeGreaterThanOrEqual(81);
    });
    expect(sender.socket.readyState).toBe(WebSocket.OPEN);
    await sender.close();
    await observer.close();
  });

  it('keeps ink previews ephemeral, bounded, and immune to delayed or duplicate packets', async () => {
    const sessionId = 'abc123de';
    const sender = await openClient(port, sessionId, roomCookie); const observer = await openClient(port, sessionId, roomCookie);
    const session = await app.manager.getOrCreateSession(sessionId);
    const participant = { name: 'Ink peer', color: '#2563eb', type: 'human' };
    const preview = (sequence: number) => ({ user: participant, canvas: { diagram_id: 'main', ink_preview: { active: true, sequence, mode: 'pen', color: '#2563eb', width: 3, opacity: 1, points: [{ x: 1, y: 2 }, { x: 3, y: 4 }] } } });
    sender.sendAwareness([{ clientId: 419, clock: 1, state: preview(2) }]);
    await waitFor(() => expect(session.awareness.getStates().get(419)).toEqual(preview(2)));
    const revision = Y.encodeStateAsUpdate(session.doc);
    sender.sendAwareness([{ clientId: 419, clock: 2, state: preview(2) }, { clientId: 419, clock: 3, state: preview(1) }]);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(session.awareness.getStates().get(419)).toEqual(preview(2));
    sender.sendAwareness([{ clientId: 419, clock: 4, state: { user: participant } }]);
    await waitFor(() => expect(session.awareness.getStates().get(419)).toEqual({ user: participant }));
    sender.sendAwareness([{ clientId: 419, clock: 5, state: preview(3) }]);
    await waitFor(() => expect(session.awareness.getStates().get(419)).toEqual(preview(3)));
    expect(Buffer.from(Y.encodeStateAsUpdate(session.doc))).toEqual(Buffer.from(revision));
    await sender.close(); await observer.close();
  });

  it('drops over-state-byte-limit awareness before parsing, ownership, or peer fan-out', async () => {
    const sessionId = 'abc123de';
    const sender = await openClient(port, sessionId, roomCookie);
    const observer = await openClient(port, sessionId, roomCookie);
    const session = await app.manager.getOrCreateSession(sessionId);
    const observerAwarenessBaseline = observer.awarenessMessageCount;
    let documentUpdates = 0;
    const countDocumentUpdate = () => { documentUpdates += 1; };
    session.doc.on('update', countDocumentUpdate);

    sender.sendAwareness([{
      clientId: 406,
      clock: 1,
      state: {
        user: { name: 'Oversized', color: '#1188cc', type: 'human' },
        unknown: 'x'.repeat(40 * 1024),
      },
    }]);
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(sender.socket.readyState).toBe(WebSocket.OPEN);
    expect(session.awareness.getStates().has(406)).toBe(false);
    expect([...session.socketClientIds.values()].some((clientIds) => clientIds.has(406))).toBe(false);
    expect(observer.awarenessMessageCount).toBe(observerAwarenessBaseline);
    expect(documentUpdates).toBe(0);

    const participant = { name: 'Bounded after drop', color: '#1188cc', type: 'human' };
    sender.sendAwareness([{
      clientId: 406,
      clock: 2,
      state: {
        user: participant,
        cursor: { anchor: 2, head: 2 },
        canvas: { diagram_id: 'main', cursor: { x: 40, y: 60 }, selected_node_ids: ['A'] },
      },
    }]);
    await waitFor(() => {
      expect(session.awareness.getStates().get(406)).toEqual({
        user: participant,
        cursor: { anchor: 2, head: 2 },
        canvas: { diagram_id: 'main', cursor: { x: 40, y: 60 }, selected_node_ids: ['A'] },
      });
      expect(observer.awarenessMessageCount).toBe(observerAwarenessBaseline + 1);
    });

    session.doc.off('update', countDocumentUpdate);
    await sender.close();
    await observer.close();
  });

  it('rate-limits an awareness flood without exhausting peer fan-out or poisoning a healthy peer', async () => {
    const sessionId = 'abc123de';
    const attacker = await openClient(port, sessionId, roomCookie);
    const observer = await openClient(port, sessionId, roomCookie);
    const healthy = await openClient(port, sessionId, roomCookie);
    const session = await app.manager.getOrCreateSession(sessionId);
    const observerBaseline = observer.awarenessMessageCount;

    for (let index = 0; index < 160; index += 1) {
      attacker.sendAwareness([{
        clientId: 10_000 + index,
        clock: 1,
        state: {
          user: { name: `Flood ${index}`, color: '#1188cc', type: 'human' },
          canvas: { diagram_id: 'main', laser: { active: true, sequence: index, point: { x: index, y: index } } },
        },
      }]);
    }
    await new Promise((resolve) => setTimeout(resolve, 250));

    // One socket's shared ingress window bounds both live awareness states and
    // the resulting observer broadcasts, even if its frames are individually valid.
    expect(session.awareness.getStates().size).toBeLessThanOrEqual(120);
    expect(observer.awarenessMessageCount - observerBaseline).toBeLessThanOrEqual(120);

    const participant = { name: 'Healthy peer', color: '#22aa66', type: 'human' };
    healthy.sendAwareness([{ clientId: 20_000, clock: 1, state: { user: participant } }]);
    await waitFor(() => expect(session.awareness.getStates().get(20_000)).toEqual({ user: participant }));

    await attacker.close();
    await observer.close();
    await healthy.close();
  });

  it('rejects an over-budget first control frame before it can trigger awareness fan-out', async () => {
    const sessionId = 'abc123de';
    const sender = await openClient(port, sessionId, roomCookie);
    const observer = await openClient(port, sessionId, roomCookie);
    const session = await app.manager.getOrCreateSession(sessionId);
    const observerBaseline = observer.awarenessMessageCount;
    const oversizedControl = new Uint8Array(128 * 1024 + 1);
    oversizedControl[0] = 3; // MESSAGE_TYPE_QUERY_AWARENESS

    sender.sendRaw(oversizedControl);
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(sender.socket.readyState).toBe(WebSocket.OPEN);
    expect(session.awareness.getStates().size).toBe(0);
    expect(observer.awarenessMessageCount).toBe(observerBaseline);

    const participant = { name: 'Usable after control drop', color: '#1188cc', type: 'human' };
    sender.sendAwareness([{ clientId: 30_000, clock: 1, state: { user: participant } }]);
    await waitFor(() => expect(session.awareness.getStates().get(30_000)).toEqual({ user: participant }));

    await sender.close();
    await observer.close();
  });

  it('drops an oversized raw awareness update before decoding its state string', async () => {
    const sessionId = 'abc123de';
    const sender = await openClient(port, sessionId, roomCookie);
    const observer = await openClient(port, sessionId, roomCookie);
    const session = await app.manager.getOrCreateSession(sessionId);
    const observerAwarenessBaseline = observer.awarenessMessageCount;
    let documentUpdates = 0;
    const countDocumentUpdate = () => { documentUpdates += 1; };
    session.doc.on('update', countDocumentUpdate);

    sender.sendRawAwareness([{
      clientId: 407,
      clock: 1,
      // Deliberately invalid JSON: if the raw update cap runs too late this
      // closes the socket during JSON.parse instead of safely dropping it.
      stateJson: `{${'x'.repeat(300 * 1024)}`,
    }]);
    await new Promise((resolve) => setTimeout(resolve, 75));

    expect(sender.socket.readyState).toBe(WebSocket.OPEN);
    expect(session.awareness.getStates().has(407)).toBe(false);
    expect([...session.socketClientIds.values()].some((clientIds) => clientIds.has(407))).toBe(false);
    expect(observer.awarenessMessageCount).toBe(observerAwarenessBaseline);
    expect(documentUpdates).toBe(0);
    session.doc.off('update', countDocumentUpdate);

    const participant = { name: 'Usable after raw drop', color: '#1188cc', type: 'human' };
    sender.sendAwareness([{
      clientId: 407,
      clock: 2,
      state: { user: participant, cursor: { anchor: 1, head: 1 } },
    }]);
    await waitFor(() => {
      expect(session.awareness.getStates().get(407)).toEqual({
        user: participant,
        cursor: { anchor: 1, head: 1 },
      });
      expect(observer.awarenessMessageCount).toBe(observerAwarenessBaseline + 1);
    });

    await sender.close();
    await observer.close();
  });

  it('hands awareness ownership to a reconnect without stale-close cleanup removing it', async () => {
    const sessionId = 'abc123de';
    const original = await openClient(port, sessionId, roomCookie);
    const replacement = await openClient(port, sessionId, roomCookie);
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

  it('revokes an upgraded socket while its session registration is pending', async () => {
    const sessionId = 'abc123de';
    const session = await app.manager.requireSession(sessionId);
    const originalRequireSession = app.manager.requireSession.bind(app.manager);
    let releaseRegistration!: () => void;
    let markRegistrationPending!: () => void;
    const registrationGate = new Promise<void>((resolve) => {
      releaseRegistration = resolve;
    });
    const registrationPending = new Promise<void>((resolve) => {
      markRegistrationPending = resolve;
    });
    let deferNextSessionLookup = true;
    const requireSession = vi.spyOn(app.manager, 'requireSession').mockImplementation(async (requestedSessionId) => {
      if (requestedSessionId === sessionId && deferNextSessionLookup) {
        deferNextSessionLookup = false;
        markRegistrationPending();
        await registrationGate;
      }
      return originalRequireSession(requestedSessionId);
    });
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws/${sessionId}`, {
      headers: { origin: 'http://allowed.test', cookie: roomCookie },
    });

    try {
      await new Promise<void>((resolve, reject) => {
        socket.once('open', resolve);
        socket.once('error', reject);
      });
      await registrationPending;
      expect(socket.readyState).toBe(WebSocket.OPEN);
      expect(session.sockets.size).toBe(0);

      const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
      const rotated = await fetch(`http://127.0.0.1:${port}/api/rooms/${sessionId}/rotate`, {
        method: 'POST',
        headers: { origin: 'http://allowed.test', cookie: roomCookie },
      });
      expect(rotated.status).toBe(200);
      await closed;

      releaseRegistration();
      await waitFor(() => {
        expect(session.sockets.size).toBe(0);
      });
    } finally {
      releaseRegistration();
      requireSession.mockRestore();
      if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CLOSING) {
        socket.terminate();
      }
    }
  });
});
