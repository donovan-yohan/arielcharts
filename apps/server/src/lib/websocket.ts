import type { IncomingMessage } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
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
// Clients normally publish one owned state at a time. This still leaves room
// for seven maximum-size states plus protocol overhead in a batched update.
const MAX_AWARENESS_UPDATE_BYTES = 256 * 1024;
const MAX_AWARENESS_STATE_JSON_BYTES = 32 * 1024;
const MAX_CANVAS_AWARENESS_DIAGRAM_ID_LENGTH = 128;
const MAX_CANVAS_AWARENESS_NODE_IDS = 100;
const MAX_CANVAS_AWARENESS_NODE_ID_LENGTH = 256;
const MAX_CANVAS_AWARENESS_COORDINATE = 1_000_000;

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

interface AwarenessEntry {
  clientId: number;
  clock: number;
  stateJson: string;
  state: Record<string, unknown> | null;
}

function parseAwarenessEntries(update: Uint8Array): AwarenessEntry[] {
  const decoderInstance = decoding.createDecoder(update);
  const clientCount = decoding.readVarUint(decoderInstance);
  const entries: AwarenessEntry[] = [];

  for (let index = 0; index < clientCount; index += 1) {
    const clientId = decoding.readVarUint(decoderInstance);
    const clock = decoding.readVarUint(decoderInstance);
    const stateJson = decoding.readVarString(decoderInstance);
    if (Buffer.byteLength(stateJson, 'utf8') > MAX_AWARENESS_STATE_JSON_BYTES) {
      continue;
    }
    const state: unknown = JSON.parse(stateJson);
    if (state !== null && (typeof state !== 'object' || Array.isArray(state))) {
      throw new Error(`Invalid awareness state for client ${clientId}.`);
    }
    entries.push({ clientId, clock, stateJson, state: state as Record<string, unknown> | null });
  }

  return entries;
}

function encodeAwarenessEntries(entries: AwarenessEntry[]): Uint8Array {
  const encoderInstance = encoding.createEncoder();
  encoding.writeVarUint(encoderInstance, entries.length);
  for (const entry of entries) {
    encoding.writeVarUint(encoderInstance, entry.clientId);
    encoding.writeVarUint(encoderInstance, entry.clock);
    encoding.writeVarString(encoderInstance, entry.stateJson);
  }
  return encoding.toUint8Array(encoderInstance);
}

function isFiniteCanvasCoordinate(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && Math.abs(value) <= MAX_CANVAS_AWARENESS_COORDINATE;
}

function sanitizeCanvasAwarenessEntry(entry: AwarenessEntry): AwarenessEntry {
  if (!entry.state || !Object.hasOwn(entry.state, 'canvas')) {
    return entry;
  }

  const canvas = entry.state.canvas;
  if (canvas === null) {
    return entry;
  }
  if (!canvas || typeof canvas !== 'object' || Array.isArray(canvas)) {
    const { canvas: _canvas, ...state } = entry.state;
    return { ...entry, state, stateJson: JSON.stringify(state) };
  }

  const candidate = canvas as Record<string, unknown>;
  const diagramId = candidate.diagram_id;
  const cursor = candidate.cursor;
  const selectedNodeIds = candidate.selected_node_ids;
  const hasValidDiagramId = typeof diagramId === 'string'
    && diagramId.length > 0
    && diagramId.length <= MAX_CANVAS_AWARENESS_DIAGRAM_ID_LENGTH;
  const hasValidCursor = cursor === undefined || (
    cursor !== null
    && typeof cursor === 'object'
    && !Array.isArray(cursor)
    && isFiniteCanvasCoordinate((cursor as Record<string, unknown>).x)
    && isFiniteCanvasCoordinate((cursor as Record<string, unknown>).y)
  );
  const hasValidSelectedNodeIds = selectedNodeIds === undefined || (
    Array.isArray(selectedNodeIds)
    && selectedNodeIds.length <= MAX_CANVAS_AWARENESS_NODE_IDS
    && selectedNodeIds.every((nodeId) => typeof nodeId === 'string' && nodeId.length > 0 && nodeId.length <= MAX_CANVAS_AWARENESS_NODE_ID_LENGTH)
  );
  if (!hasValidDiagramId || !hasValidCursor || !hasValidSelectedNodeIds) {
    const { canvas: _canvas, ...state } = entry.state;
    return { ...entry, state, stateJson: JSON.stringify(state) };
  }

  const normalizedCanvas = {
    diagram_id: diagramId,
    ...(cursor === undefined ? {} : { cursor }),
    ...(selectedNodeIds === undefined ? {} : { selected_node_ids: selectedNodeIds }),
  };
  const state = { ...entry.state, canvas: normalizedCanvas };
  return { ...entry, state, stateJson: JSON.stringify(state) };
}

export class SessionWebSocketServer {
  private readonly wss = new WebSocketServer({ noServer: true });
  private readonly observedDocs = new WeakSet<object>();
  private readonly minimumAccessVersions = new Map<string, number>();
  /**
   * An upgraded connection does not join SessionState.sockets until its
   * asynchronous session lookup completes. Track that interval so key
   * rotation can revoke it as well.
   */
  private readonly pendingSockets = new Map<string, Set<WebSocket>>();

  constructor(private readonly manager: SessionManager) {
    this.wss.on('connection', (socket: WebSocket, _request: IncomingMessage, sessionId: string) => {
      this.trackPendingSocket(sessionId, socket);
      void this.handleConnection(socket, sessionId).catch((error) => {
        console.error('WebSocket connection handling failed:', error);
        this.untrackPendingSocket(sessionId, socket);
        socket.close();
      });
      socket.on('error', () => {
        socket.close();
      });
      socket.on('close', () => {
        this.untrackPendingSocket(sessionId, socket);
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

  async upgrade({ request, socket, head, sessionId, accessVersion }: UpgradeContext): Promise<void> {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    const pathSessionId = pathname.replace(/^\/ws\//u, '');

    if (!isValidSessionId(sessionId) || sessionId !== pathSessionId) {
      socket.destroy();
      return;
    }
    if (accessVersion < (this.minimumAccessVersions.get(sessionId) ?? 0)) {
      socket.destroy();
      return;
    }

    this.wss.handleUpgrade(request, socket, head, (websocket) => {
      this.wss.emit('connection', websocket, request, sessionId);
    });
  }

  async close(): Promise<void> {
    for (const sockets of this.pendingSockets.values()) {
      for (const socket of sockets) {
        socket.terminate();
      }
    }
    this.pendingSockets.clear();

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

  /** Rotation revokes already-upgraded peers; cookie checks alone only protect reconnects. */
  async closeRoom(sessionId: string, accessVersion: number): Promise<void> {
    this.minimumAccessVersions.set(sessionId, Math.max(
      this.minimumAccessVersions.get(sessionId) ?? 0,
      accessVersion,
    ));
    for (const socket of [...(this.pendingSockets.get(sessionId) ?? [])]) {
      socket.terminate();
    }

    let session: SessionState;
    try {
      session = await this.manager.requireSession(sessionId);
    } catch {
      return;
    }
    for (const socket of [...session.sockets]) {
      socket.terminate();
    }
  }

  private async handleConnection(socket: WebSocket, sessionId: string): Promise<void> {
    const session = await this.manager.requireSession(sessionId);
    if (socket.readyState !== WebSocket.OPEN) {
      this.untrackPendingSocket(sessionId, socket);
      return;
    }
    this.ensureSocketRegistered(session, socket);
    this.untrackPendingSocket(sessionId, socket);
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
    const session = await this.manager.requireSession(sessionId);
    session.sockets.delete(socket);
    const clientIds = session.socketClientIds.get(socket);
    session.socketClientIds.delete(socket);
    if (clientIds && clientIds.size > 0) {
      const orphanedClientIds = [...clientIds].filter((clientId) => !this.findLiveOwner(session, clientId));
      if (orphanedClientIds.length > 0) {
        removeAwarenessStates(session.awareness, orphanedClientIds, socket);
      }
    }
  }

  private async handleMessage(sessionId: string, message: RawData, sender: WebSocket): Promise<void> {
    const buffer = toUint8Array(message);
    if (buffer.length === 0) {
      return;
    }

    const session = await this.manager.requireSession(sessionId);
    if (sender.readyState !== WebSocket.OPEN) {
      return;
    }
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
        if (awarenessUpdate.byteLength > MAX_AWARENESS_UPDATE_BYTES) {
          return;
        }
        const filtered = this.filterAwarenessEntries(session, sender, parseAwarenessEntries(awarenessUpdate));
        if (filtered.entries.length === 0) {
          return;
        }
        applyAwarenessUpdate(session.awareness, encodeAwarenessEntries(filtered.entries), sender);
        const ownedClientIds = session.socketClientIds.get(sender)!;
        for (const clientId of filtered.claimedClientIds) ownedClientIds.add(clientId);
        for (const clientId of filtered.releasedClientIds) {
          if (!session.awareness.getStates().has(clientId)) ownedClientIds.delete(clientId);
        }
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

  private trackPendingSocket(sessionId: string, socket: WebSocket): void {
    let sockets = this.pendingSockets.get(sessionId);
    if (!sockets) {
      sockets = new Set();
      this.pendingSockets.set(sessionId, sockets);
    }
    sockets.add(socket);
  }

  private untrackPendingSocket(sessionId: string, socket: WebSocket): void {
    const sockets = this.pendingSockets.get(sessionId);
    if (!sockets) {
      return;
    }

    sockets.delete(socket);
    if (sockets.size === 0) {
      this.pendingSockets.delete(sessionId);
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

  private filterAwarenessEntries(session: SessionState, socket: WebSocket, entries: AwarenessEntry[]): {
    entries: AwarenessEntry[];
    claimedClientIds: number[];
    releasedClientIds: number[];
  } {
    const ownedClientIds = session.socketClientIds.get(socket);
    if (!ownedClientIds) {
      throw new Error('Socket is not registered for the session.');
    }

    const nextOwnedClientIds = new Set(ownedClientIds);
    const allowed: AwarenessEntry[] = [];
    const claimedClientIds: number[] = [];
    const releasedClientIds: number[] = [];
    for (const rawEntry of entries) {
      const entry = sanitizeCanvasAwarenessEntry(rawEntry);
      if (nextOwnedClientIds.has(entry.clientId)) {
        allowed.push(entry);
        if (entry.state === null) {
          nextOwnedClientIds.delete(entry.clientId);
          releasedClientIds.push(entry.clientId);
        }
        continue;
      }

      const liveOwner = this.findLiveOwner(session, entry.clientId, socket);
      if (!liveOwner && !session.managedAwarenessClientIds.has(entry.clientId) && entry.state !== null) {
        this.releaseStaleOwners(session, entry.clientId, socket);
        nextOwnedClientIds.add(entry.clientId);
        claimedClientIds.push(entry.clientId);
        allowed.push(entry);
        continue;
      }

      const authoritativeClock = session.awareness.meta.get(entry.clientId)?.clock;
      if (authoritativeClock !== undefined) {
        if (entry.clock < authoritativeClock) {
          continue;
        }
        if (entry.clock === authoritativeClock
          && (entry.state === null || isDeepStrictEqual(entry.state, session.awareness.getStates().get(entry.clientId)))) {
          continue;
        }
      }

      throw new Error(`Awareness client ${entry.clientId} does not belong to this socket.`);
    }

    return { entries: allowed, claimedClientIds, releasedClientIds };
  }

  private findLiveOwner(session: SessionState, clientId: number, except?: WebSocket): WebSocket | undefined {
    for (const [candidate, clientIds] of session.socketClientIds) {
      if (candidate !== except && candidate.readyState === WebSocket.OPEN && clientIds.has(clientId)) {
        return candidate;
      }
    }
    return undefined;
  }

  private releaseStaleOwners(session: SessionState, clientId: number, except: WebSocket): void {
    for (const [candidate, clientIds] of session.socketClientIds) {
      if (candidate !== except && candidate.readyState !== WebSocket.OPEN) {
        clientIds.delete(clientId);
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
