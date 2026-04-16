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
import { MERMAID_TEXT_KEY } from './constants.js';
import type { ServerEnv } from './types.js';

const MESSAGE_TYPE_SYNC = 0;
const MESSAGE_TYPE_AWARENESS = 1;

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

function readMermaidText(doc: Y.Doc): string {
  return doc.getText(MERMAID_TEXT_KEY).toString();
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
    syncText(text: string) {
      const yText = doc.getText(MERMAID_TEXT_KEY);
      doc.transact(() => {
        yText.delete(0, yText.length);
        yText.insert(0, text);
      }, 'test-client');

      socket.send(Buffer.from(encodeSyncMessage((encoderInstance) => {
        syncProtocol.writeUpdate(encoderInstance, Y.encodeStateAsUpdate(doc));
      })));
    },
  };
}

describe('SessionWebSocketServer', () => {
  let dataDir: string;
  let app: ReturnType<typeof createApp>;
  let port: number;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'mermaidflow-websocket-'));
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

  it('rebroadcasts updates after a room is cleaned up and reopened', async () => {
    const sessionId = 'abc123de';
    const initialWriter = await openClient(port, sessionId);
    const initialReader = await openClient(port, sessionId);
    await waitFor(async () => {
      const session = await app.manager.getOrCreateSession(sessionId);
      expect(session.sockets.size).toBe(2);
    });

    initialWriter.syncText('graph TD\n  A-->B');
    await waitFor(() => {
      expect(readMermaidText(initialReader.doc)).toBe('graph TD\n  A-->B');
    });

    await initialWriter.close();
    await initialReader.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    const removed = await app.manager.cleanupExpiredSessions({
      ttlMs: 0,
      now: Date.now() + 1,
    });
    expect(removed).toEqual([sessionId]);

    const reopenedWriter = await openClient(port, sessionId);
    const reopenedReader = await openClient(port, sessionId);
    await waitFor(async () => {
      const session = await app.manager.getOrCreateSession(sessionId);
      expect(session.sockets.size).toBe(2);
    });

    reopenedWriter.syncText('graph TD\n  A-->C');
    await waitFor(() => {
      expect(readMermaidText(reopenedReader.doc)).toBe('graph TD\n  A-->C');
    });

    await reopenedWriter.close();
    await reopenedReader.close();
  }, 15_000);
});
