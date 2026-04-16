import type { IncomingMessage } from 'node:http';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import type { SessionManager } from './session-manager.js';
import { isValidSessionId } from './session-id.js';
import type { SessionState, UpgradeContext } from './types.js';

const MESSAGE_TYPE_SYNC = 0;
const MESSAGE_TYPE_AWARENESS = 1;
const MESSAGE_TYPE_QUERY_AWARENESS = 3;

function toUint8Array(message: RawData): Uint8Array {
  if (message instanceof ArrayBuffer) {
    return new Uint8Array(message);
  }

  if (Array.isArray(message)) {
    return Buffer.concat(message.map((chunk) => Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  }

  return Buffer.isBuffer(message) ? message : Buffer.from(message);
}

function encodeMessage(messageType: number, writePayload?: (encoder: encoding.Encoder) => void): Uint8Array {
  const encoderInstance = encoding.createEncoder();
  encoding.writeVarUint(encoderInstance, messageType);
  writePayload?.(encoderInstance);
  return encoding.toUint8Array(encoderInstance);
}

function parseAwarenessClientIds(update: Uint8Array): number[] {
  const decoderInstance = decoding.createDecoder(update);
  const clientCount = decoding.readVarUint(decoderInstance);
  const clientIds: number[] = [];

  for (let index = 0; index < clientCount; index += 1) {
    const clientId = decoding.readVarUint(decoderInstance);
    clientIds.push(clientId);
    decoding.readVarUint(decoderInstance);
    decoding.readVarString(decoderInstance);
  }

  return clientIds;
}

export class SessionWebSocketServer {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly observedDocs = new WeakSet<object>();

  constructor(private readonly manager: SessionManager) {
    this.wss.on('connection', (socket: WebSocket, _request: IncomingMessage, sessionId: string) => {
      void this.handleConnection(socket, sessionId).catch((error) => {
        console.error('WebSocket connection handling failed:', error);
        socket.close();
      });
      socket.on('error', () => {
        socket.close();
      });
      socket.on('close', () => {
        void this.handleClose(socket, sessionId).catch((error) => {
          console.error('WebSocket close handling failed:', error);
        });
      });
      socket.on('message', (message: RawData) => {
        void this.handleMessage(sessionId, message, socket).catch((error) => {
          console.error('WebSocket message handling failed:', error);
          socket.close();
        });
      });
    });
  }

  accepts(pathname: string): boolean {
    return pathname.startsWith('/ws/');
  }

  async upgrade({ request, socket, head }: UpgradeContext): Promise<void> {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const sessionId = pathname.replace(/^\/ws\//u, '');

    if (!isValidSessionId(sessionId)) {
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (websocket) => {
      this.wss.emit('connection', websocket, request, sessionId);
    });
  }

  async close(): Promise<void> {
    for (const client of this.wss.clients) {
      client.terminate();
    }

    await new Promise<void>((resolve, reject) => {
      this.wss.close((error) => {
        if (error) {
          reject(error);
          return;
        }

        resolve();
      });
    });
  }

  private async handleConnection(socket: WebSocket, sessionId: string): Promise<void> {
    const session = await this.manager.getOrCreateSession(sessionId);
    if (socket.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ensureSocketRegistered(session, socket);
    socket.send(Buffer.from(encodeMessage(MESSAGE_TYPE_SYNC, (encoderInstance) => {
      syncProtocol.writeSyncStep1(encoderInstance, session.doc);
    })));

    const awarenessClientIds = [...session.awareness.getStates().keys()];
    if (awarenessClientIds.length > 0) {
      socket.send(Buffer.from(encodeMessage(MESSAGE_TYPE_AWARENESS, (encoderInstance) => {
        encoding.writeVarUint8Array(encoderInstance, encodeAwarenessUpdate(session.awareness, awarenessClientIds));
      })));
    }
  }

  private async handleClose(socket: WebSocket, sessionId: string): Promise<void> {
    const session = await this.manager.getOrCreateSession(sessionId);
    session.sockets.delete(socket);
    const clientIds = session.socketClientIds.get(socket);
    if (clientIds && clientIds.size > 0) {
      removeAwarenessStates(session.awareness, [...clientIds], socket);
    }
    session.socketClientIds.delete(socket);
  }

  private async handleMessage(sessionId: string, message: RawData, sender: WebSocket): Promise<void> {
    const buffer = toUint8Array(message);
    if (buffer.length === 0) {
      return;
    }

    const session = await this.manager.getOrCreateSession(sessionId);
    this.ensureSocketRegistered(session, sender);
    const decoderInstance = decoding.createDecoder(buffer);
    const messageType = decoding.readVarUint(decoderInstance);

    switch (messageType) {
      case MESSAGE_TYPE_SYNC: {
        const encoderInstance = encoding.createEncoder();
        encoding.writeVarUint(encoderInstance, MESSAGE_TYPE_SYNC);
        const syncMessageType = syncProtocol.readSyncMessage(decoderInstance, encoderInstance, session.doc, sender);
        if (encoding.length(encoderInstance) > 1 && sender.readyState === WebSocket.OPEN) {
          sender.send(Buffer.from(encoding.toUint8Array(encoderInstance)));
        }

        if (syncMessageType === syncProtocol.messageYjsSyncStep2 || syncMessageType === syncProtocol.messageYjsUpdate) {
          session.updatedAt = Date.now();
          await this.manager.persistSession(session);
        }
        return;
      }

      case MESSAGE_TYPE_AWARENESS: {
        const awarenessUpdate = decoding.readVarUint8Array(decoderInstance);
        const clientIds = parseAwarenessClientIds(awarenessUpdate);
        this.assertSocketOwnsAwarenessClients(session, sender, clientIds);
        applyAwarenessUpdate(session.awareness, awarenessUpdate, sender);
        return;
      }

      case MESSAGE_TYPE_QUERY_AWARENESS: {
        this.sendAwareness(session, sender);
        return;
      }

      default:
        return;
    }
  }

  private ensureSocketRegistered(session: SessionState, socket: WebSocket): void {
    this.observeSession(session);
    session.sockets.add(socket);
    if (!session.socketClientIds.has(socket)) {
      session.socketClientIds.set(socket, new Set());
    }
  }

  private observeSession(session: SessionState): void {
    if (this.observedDocs.has(session.doc)) {
      return;
    }

    this.observedDocs.add(session.doc);

    session.doc.on('update', (update: Uint8Array, origin: unknown) => {
      session.updatedAt = Date.now();
      this.broadcast(session, encodeMessage(MESSAGE_TYPE_SYNC, (encoderInstance) => {
        syncProtocol.writeUpdate(encoderInstance, update);
      }), origin instanceof WebSocket ? origin : undefined);
    });

    session.awareness.on('update', (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
      const changedClientIds = [...changes.added, ...changes.updated, ...changes.removed];
      if (changedClientIds.length === 0) {
        return;
      }

      this.broadcast(session, encodeMessage(MESSAGE_TYPE_AWARENESS, (encoderInstance) => {
        encoding.writeVarUint8Array(encoderInstance, encodeAwarenessUpdate(session.awareness, changedClientIds));
      }), origin instanceof WebSocket ? origin : undefined);
    });
  }

  private assertSocketOwnsAwarenessClients(session: SessionState, socket: WebSocket, clientIds: number[]): void {
    const ownedClientIds = session.socketClientIds.get(socket);
    if (!ownedClientIds) {
      throw new Error('Socket is not registered for the session.');
    }

    if (clientIds.length === 0) {
      return;
    }

    if (ownedClientIds.size === 0) {
      for (const clientId of clientIds) {
        ownedClientIds.add(clientId);
      }
      return;
    }

    for (const clientId of clientIds) {
      if (!ownedClientIds.has(clientId)) {
        throw new Error(`Awareness client ${clientId} does not belong to this socket.`);
      }
    }
  }

  private sendAwareness(session: SessionState, socket: WebSocket): void {
    const awarenessClientIds = [...session.awareness.getStates().keys()];
    if (awarenessClientIds.length === 0 || socket.readyState !== WebSocket.OPEN) {
      return;
    }

    socket.send(Buffer.from(encodeMessage(MESSAGE_TYPE_AWARENESS, (encoderInstance) => {
      encoding.writeVarUint8Array(encoderInstance, encodeAwarenessUpdate(session.awareness, awarenessClientIds));
    })));
  }

  private broadcast(session: SessionState, payload: Uint8Array, exclude?: WebSocket): void {
    for (const socket of session.sockets) {
      if (socket === exclude || socket.readyState !== WebSocket.OPEN) {
        continue;
      }

      socket.send(Buffer.from(payload));
    }
  }
}
