import type { IncomingMessage } from 'node:http';
import { isDeepStrictEqual } from 'node:util';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import { applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';
import { WebSocket, WebSocketServer, type RawData } from 'ws';
import { admitYjsUpdate, COLLABORATION_BUDGETS, type DocumentAdmissionReason } from './document-admission.js';
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
const MAX_AWARENESS_ENTRIES_PER_UPDATE = 64;
const MAX_CANVAS_AWARENESS_DIAGRAM_ID_LENGTH = 128;
const MAX_CANVAS_AWARENESS_NODE_IDS = 100;
const MAX_CANVAS_AWARENESS_NODE_ID_LENGTH = 256;
const MAX_CANVAS_AWARENESS_COORDINATE = 1_000_000;
const MAX_CANVAS_LASER_SEQUENCE = Number.MAX_SAFE_INTEGER;
const INGRESS_RATE_WINDOW_MS = 10_000;
const INGRESS_BUDGETS = {
  // A normal text-editor burst emits many small Yjs deltas. Permit that path
  // independently from ephemeral fan-out so it cannot be starved by presence.
  sync: { messages: 512, bytes: 4 * 1024 * 1024 },
  awareness: { messages: 120, bytes: 512 * 1024 },
  control: { messages: 32, bytes: 128 * 1024 },
} as const;

type IngressClass = keyof typeof INGRESS_BUDGETS;

type IngressRejectionReason = DocumentAdmissionReason
  | 'sync_frame_too_large'
  | 'sync_rate_limited'
  | 'awareness_rate_limited'
  | 'control_rate_limited'
  | 'awareness_update_too_large'
  | 'malformed_awareness_update'
  | 'stale_laser_sequence'
  | 'outbound_sync_too_large';

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
  if (clientCount > MAX_AWARENESS_ENTRIES_PER_UPDATE) {
    throw new Error('Awareness update exceeds entry limit.');
  }
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
  const editingNodeId = candidate.editing_node_id;
  const laser = candidate.laser;
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
  const hasValidEditingNodeId = editingNodeId === undefined || (
    typeof editingNodeId === 'string'
    && editingNodeId.length > 0
    && editingNodeId.length <= MAX_CANVAS_AWARENESS_NODE_ID_LENGTH
  );
  const hasValidLaser = laser === undefined || (
    laser !== null
    && typeof laser === 'object'
    && !Array.isArray(laser)
    && typeof (laser as Record<string, unknown>).active === 'boolean'
    && Number.isSafeInteger((laser as Record<string, unknown>).sequence)
    && ((laser as Record<string, unknown>).sequence as number) >= 0
    && ((laser as Record<string, unknown>).sequence as number) <= MAX_CANVAS_LASER_SEQUENCE
    && ((laser as Record<string, unknown>).active === false
      ? (laser as Record<string, unknown>).point === undefined
      : (laser as Record<string, unknown>).point !== null
        && typeof (laser as Record<string, unknown>).point === 'object'
        && !Array.isArray((laser as Record<string, unknown>).point)
        && isFiniteCanvasCoordinate(((laser as Record<string, unknown>).point as Record<string, unknown>).x)
        && isFiniteCanvasCoordinate(((laser as Record<string, unknown>).point as Record<string, unknown>).y))
  );
  if (!hasValidDiagramId || !hasValidCursor || !hasValidSelectedNodeIds || !hasValidEditingNodeId || !hasValidLaser) {
    const { canvas: _canvas, ...state } = entry.state;
    return { ...entry, state, stateJson: JSON.stringify(state) };
  }

  const normalizedCanvas = {
    diagram_id: diagramId,
    ...(cursor === undefined ? {} : { cursor }),
    ...(selectedNodeIds === undefined ? {} : { selected_node_ids: selectedNodeIds }),
    ...(editingNodeId === undefined ? {} : { editing_node_id: editingNodeId }),
    ...(laser === undefined ? {} : { laser }),
  };
  const state = { ...entry.state, canvas: normalizedCanvas };
  return { ...entry, state, stateJson: JSON.stringify(state) };
}

export class SessionWebSocketServer {
  private readonly wss = new WebSocketServer({ noServer: true, maxPayload: COLLABORATION_BUDGETS.websocketFrameBytes });
  private readonly observedDocs = new WeakSet<object>();
  private readonly minimumAccessVersions = new Map<string, number>();
  private readonly ingressBySocket = new WeakMap<WebSocket, Map<IngressClass, { windowStartedAt: number; messages: number; bytes: number }>>();
  private readonly ingressRejectionCounts = new Map<IngressRejectionReason, number>();
  private readonly laserSequencesBySession = new WeakMap<SessionState, Map<number, number>>();
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
        this.ingressBySocket.delete(socket);
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

  /** Fixed-key, content-free observability for bounded ingress rejections. */
  getIngressRejectionCounts(): ReadonlyMap<IngressRejectionReason, number> {
    return this.ingressRejectionCounts;
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
        const laserSequences = this.laserSequencesBySession.get(session);
        orphanedClientIds.forEach((clientId) => laserSequences?.delete(clientId));
        removeAwarenessStates(session.awareness, orphanedClientIds, socket);
      }
    }
  }

  private async handleMessage(sessionId: string, message: RawData, sender: WebSocket): Promise<void> {
    const buffer = toUint8Array(message);
    if (buffer.length === 0) {
      return;
    }
    if (buffer.byteLength > COLLABORATION_BUDGETS.websocketFrameBytes) {
      this.recordIngressRejection('sync_frame_too_large');
      return;
    }
    const session = await this.manager.requireSession(sessionId);
    if (sender.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ensureSocketRegistered(session, sender);
    const decoderInstance = decoding.createDecoder(buffer);
    let messageType: number;
    try {
      messageType = decoding.readVarUint(decoderInstance);
    } catch {
      this.recordIngressRejection('malformed_yjs_update');
      return;
    }
    const ingressClass: IngressClass = messageType === MESSAGE_TYPE_SYNC
      ? 'sync'
      : messageType === MESSAGE_TYPE_AWARENESS
        ? 'awareness'
        : 'control';
    if (!this.allowIngress(sender, ingressClass, buffer.byteLength)) {
      this.recordIngressRejection(`${ingressClass}_rate_limited`);
      return;
    }

    switch (messageType) {
      case MESSAGE_TYPE_SYNC: {
        const encoderInstance = encoding.createEncoder();
        encoding.writeVarUint(encoderInstance, MESSAGE_TYPE_SYNC);
        let syncMessageType: number;
        try {
          syncMessageType = decoding.readVarUint(decoderInstance);
        } catch {
          this.recordIngressRejection('malformed_yjs_update');
          return;
        }
        if (syncMessageType === syncProtocol.messageYjsSyncStep1) {
          try {
            syncProtocol.writeSyncStep2(encoderInstance, session.doc, decoding.readVarUint8Array(decoderInstance));
          } catch {
            this.recordIngressRejection('malformed_yjs_update');
            return;
          }
          if (encoding.length(encoderInstance) > COLLABORATION_BUDGETS.websocketFrameBytes) {
            this.recordIngressRejection('outbound_sync_too_large');
            return;
          }
          if (encoding.length(encoderInstance) > 1 && sender.readyState === WebSocket.OPEN) {
            sender.send(Buffer.from(encoding.toUint8Array(encoderInstance)));
          }
          return;
        }
        if (syncMessageType !== syncProtocol.messageYjsSyncStep2 && syncMessageType !== syncProtocol.messageYjsUpdate) {
          this.recordIngressRejection('malformed_yjs_update');
          return;
        }
        let update: Uint8Array;
        try {
          update = decoding.readVarUint8Array(decoderInstance);
        } catch {
          this.recordIngressRejection('malformed_yjs_update');
          return;
        }
        const admission = admitYjsUpdate(session.doc, update);
        if (!admission.accepted) {
          this.recordIngressRejection(admission.reason);
          return;
        }
        Y.applyUpdate(session.doc, update, sender);
        session.updatedAt = Date.now();
        await this.manager.persistSession(session);
        return;
      }

      case MESSAGE_TYPE_AWARENESS: {
        let awarenessUpdate: Uint8Array;
        try {
          awarenessUpdate = decoding.readVarUint8Array(decoderInstance);
        } catch {
          this.recordIngressRejection('malformed_awareness_update');
          return;
        }
        if (awarenessUpdate.byteLength > MAX_AWARENESS_UPDATE_BYTES) {
          this.recordIngressRejection('awareness_update_too_large');
          return;
        }
        let entries: AwarenessEntry[];
        try {
          entries = parseAwarenessEntries(awarenessUpdate);
        } catch {
          this.recordIngressRejection('malformed_awareness_update');
          return;
        }
        const filtered = this.filterAwarenessEntries(session, sender, entries);
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

  private allowIngress(socket: WebSocket, ingressClass: IngressClass, bytes: number): boolean {
    const now = Date.now();
    const budget = INGRESS_BUDGETS[ingressClass];
    if (bytes > budget.bytes) {
      return false;
    }
    let windows = this.ingressBySocket.get(socket);
    if (!windows) {
      windows = new Map();
      this.ingressBySocket.set(socket, windows);
    }
    const current = windows.get(ingressClass);
    if (!current || now - current.windowStartedAt >= INGRESS_RATE_WINDOW_MS) {
      windows.set(ingressClass, { windowStartedAt: now, messages: 1, bytes });
      return true;
    }
    if (current.messages >= budget.messages || current.bytes + bytes > budget.bytes) {
      return false;
    }
    current.messages += 1;
    current.bytes += bytes;
    return true;
  }

  private recordIngressRejection(reason: IngressRejectionReason): void {
    const count = (this.ingressRejectionCounts.get(reason) ?? 0) + 1;
    this.ingressRejectionCounts.set(reason, count);
    if (count === 1) {
      console.warn(`[collaboration-ingress] rejected ${reason}`);
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
        const authoritativeClock = session.awareness.meta.get(entry.clientId)?.clock;
        if (authoritativeClock !== undefined && entry.clock <= authoritativeClock) continue;
        if (!this.admitLaserSequence(session, entry)) continue;
        allowed.push(entry);
        if (entry.state === null) {
          this.laserSequencesBySession.get(session)?.delete(entry.clientId);
          nextOwnedClientIds.delete(entry.clientId);
          releasedClientIds.push(entry.clientId);
        }
        continue;
      }

      const liveOwner = this.findLiveOwner(session, entry.clientId, socket);
      if (!liveOwner && !session.managedAwarenessClientIds.has(entry.clientId) && entry.state !== null) {
        this.releaseStaleOwners(session, entry.clientId, socket);
        this.laserSequencesBySession.get(session)?.delete(entry.clientId);
        if (!this.admitLaserSequence(session, entry)) continue;
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

  private admitLaserSequence(session: SessionState, entry: AwarenessEntry): boolean {
    let sequences = this.laserSequencesBySession.get(session);
    if (!sequences) {
      sequences = new Map();
      this.laserSequencesBySession.set(session, sequences);
    }
    const canvas = entry.state?.canvas;
    const laser = canvas && typeof canvas === 'object' && !Array.isArray(canvas)
      ? (canvas as Record<string, unknown>).laser
      : undefined;
    if (!laser || typeof laser !== 'object' || Array.isArray(laser)) {
      return true;
    }
    const candidate = laser as { active: boolean; sequence: number };
    const previous = sequences.get(entry.clientId);
    if (previous !== undefined && candidate.sequence <= previous) {
      this.recordIngressRejection('stale_laser_sequence');
      return false;
    }
    sequences.set(entry.clientId, candidate.sequence);
    return true;
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
