import type { ActivityEvent, Diagram, DiagramSummary, Participant, SessionSummary } from '@arielcharts/shared';
import { createHash } from 'node:crypto';
import * as encoding from 'lib0/encoding';
import { Awareness, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import {
  ACTIVITY_KEY,
  DEFAULT_SESSION_TITLE,
  DIAGRAM_MERMAID_TEXT_KEY,
  DIAGRAM_NODE_POSITIONS_KEY,
  DIAGRAM_ORDER_KEY,
  DIAGRAM_NAME_KEY,
  DIAGRAMS_KEY,
  PRESENCE_KEY,
} from './constants.js';
import { SessionStore } from './persistence.js';
import type { CleanupOptions, SessionSnapshot, SessionState, StoredSessionSummary } from './types.js';

const MANAGED_AWARENESS_ORIGIN = 'session-manager';
const DEFAULT_DIAGRAM_ID = 'main';
const DEFAULT_DIAGRAM_TITLE = 'Main';

type DiagramMap = Y.Map<unknown>;

function diagramsMap(doc: Y.Doc): Y.Map<DiagramMap> {
  return doc.getMap<DiagramMap>(DIAGRAMS_KEY);
}

function diagramOrder(doc: Y.Doc): Y.Array<string> {
  return doc.getArray<string>(DIAGRAM_ORDER_KEY);
}

function getMermaidText(diagram: DiagramMap): Y.Text {
  const value = diagram.get(DIAGRAM_MERMAID_TEXT_KEY);
  if (!(value instanceof Y.Text)) {
    throw new Error('Diagram is missing its Mermaid text.');
  }
  return value;
}

function getDiagramName(diagram: DiagramMap, id: string): string {
  const name = diagram.get(DIAGRAM_NAME_KEY);
  return typeof name === 'string' && name.trim().length > 0 ? name : `Diagram ${id}`;
}

function createDiagram(id: string, name: string, mermaidText: string): DiagramMap {
  const diagram = new Y.Map<unknown>();
  diagram.set(DIAGRAM_NAME_KEY, name);
  diagram.set(DIAGRAM_MERMAID_TEXT_KEY, new Y.Text(mermaidText));
  diagram.set(DIAGRAM_NODE_POSITIONS_KEY, new Y.Map());
  return diagram;
}

function normalizeDiagramName(name: string): string {
  const normalized = name.trim().replace(/\s+/gu, ' ');
  if (!normalized) {
    throw new Error('Diagram name must not be empty.');
  }
  return normalized.slice(0, 120);
}

function diagramId(): string {
  return `diagram_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

function revisionFromDoc(doc: Y.Doc): string {
  return Buffer.from(Y.encodeStateVector(doc)).toString('base64url');
}

function revisionForDiagram(diagram: DiagramMap, id: string): string {
  return createHash('sha256')
    .update(id)
    .update('\0')
    .update(getDiagramName(diagram, id))
    .update('\0')
    .update(getMermaidText(diagram).toString())
    .digest('base64url');
}

function orderedDiagramIds(doc: Y.Doc): string[] {
  const diagrams = diagramsMap(doc);
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const id of diagramOrder(doc).toArray()) {
    if (diagrams.has(id) && !seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }

  for (const id of diagrams.keys()) {
    if (!seen.has(id)) {
      seen.add(id);
      ordered.push(id);
    }
  }

  return ordered;
}

function readDiagrams(doc: Y.Doc): Diagram[] {
  const diagrams = diagramsMap(doc);
  return orderedDiagramIds(doc).flatMap((id) => {
    const diagram = diagrams.get(id);
    if (!diagram) {
      return [];
    }
    return [{
      id,
      name: getDiagramName(diagram, id),
      mermaid_text: getMermaidText(diagram).toString(),
      revision: revisionForDiagram(diagram, id),
    }];
  });
}

function readDiagram(doc: Y.Doc, id: string): Diagram {
  const diagram = diagramsMap(doc).get(id);
  if (!diagram) {
    throw new Error(`Diagram not found: ${id}`);
  }
  return {
    id,
    name: getDiagramName(diagram, id),
    mermaid_text: getMermaidText(diagram).toString(),
    revision: revisionForDiagram(diagram, id),
  };
}

function ensureInitialDiagram(doc: Y.Doc): void {
  const diagrams = diagramsMap(doc);
  const order = diagramOrder(doc);
  if (diagrams.size > 0 || order.length > 0) {
    return;
  }

  doc.transact(() => {
    // A single authoritative server doc initializes the first tab before it
    // can be observed by clients, so concurrent websocket joins share it.
    if (diagrams.size === 0 && order.length === 0) {
      diagrams.set(DEFAULT_DIAGRAM_ID, createDiagram(DEFAULT_DIAGRAM_ID, DEFAULT_DIAGRAM_TITLE, ''));
      order.push([DEFAULT_DIAGRAM_ID]);
    }
  }, MANAGED_AWARENESS_ORIGIN);
}

/**
 * Browser clients can mutate the Yjs document directly, bypassing the MCP
 * command validation. Resolve colliding raw names deterministically on the
 * authoritative document so an agent can safely identify a diagram by name.
 */
function reconcileDiagramNames(doc: Y.Doc): void {
  const diagrams = diagramsMap(doc);
  const claimedNames = new Set<string>();

  for (const id of [...diagrams.keys()].sort((left, right) => left.localeCompare(right))) {
    const diagram = diagrams.get(id);
    if (!diagram) continue;

    let baseName: string;
    try {
      baseName = normalizeDiagramName(getDiagramName(diagram, id));
    } catch {
      baseName = `Diagram ${id}`;
    }

    let candidate = baseName;
    let suffix = 1;
    while (claimedNames.has(candidate.toLocaleLowerCase())) {
      candidate = `${baseName} (${id.slice(-4)}${suffix === 1 ? '' : `-${suffix}`})`;
      suffix += 1;
    }

    claimedNames.add(candidate.toLocaleLowerCase());
    if (diagram.get(DIAGRAM_NAME_KEY) !== candidate) {
      diagram.set(DIAGRAM_NAME_KEY, candidate);
    }
  }
}

function readActivity(doc: Y.Doc): ActivityEvent[] {
  return doc.getArray<ActivityEvent>(ACTIVITY_KEY).toArray();
}

function isParticipant(value: unknown): value is Participant {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const participant = value as Record<string, unknown>;
  return typeof participant.name === 'string'
    && typeof participant.color === 'string'
    && (participant.type === 'human' || participant.type === 'agent');
}

function readParticipants(doc: Y.Doc): Participant[] {
  return [...doc.getMap<Participant>(PRESENCE_KEY).values()].sort((left, right) => left.name.localeCompare(right.name));
}

function writeParticipants(doc: Y.Doc, participants: Participant[]): void {
  const map = doc.getMap<Participant>(PRESENCE_KEY);
  for (const key of [...map.keys()]) {
    map.delete(key);
  }
  for (const participant of participants) {
    map.set(participant.name, participant);
  }
}

function readParticipantsFromAwareness(awareness: Awareness): Participant[] {
  const participants: Participant[] = [];

  for (const state of awareness.getStates().values()) {
    const awarenessState = state as { user?: unknown } | Record<string, unknown>;
    const participant = awarenessState.user;
    if (isParticipant(participant)) {
      participants.push(participant);
    }
  }

  return participants.sort((left, right) => left.name.localeCompare(right.name));
}

function syncParticipantsFromAwareness(session: SessionState): void {
  const participants = readParticipantsFromAwareness(session.awareness);
  session.doc.transact(() => {
    writeParticipants(session.doc, participants);
  }, MANAGED_AWARENESS_ORIGIN);
}

function titleFromDiagrams(diagrams: DiagramSummary[]): string {
  return diagrams[0]?.name ?? DEFAULT_SESSION_TITLE;
}

function stableParticipantClientId(participant: Participant): number {
  let hash = 2_166_136_261;
  const input = `managed:${participant.type}:${participant.name}`;

  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }

  return (hash >>> 0) % 2_147_483_646 + 1;
}

function encodeAwarenessStateUpdate(entries: Array<{ clientId: number; clock: number; state: Record<string, unknown> | null }>): Uint8Array {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, entries.length);
  for (const entry of entries) {
    encoding.writeVarUint(encoder, entry.clientId);
    encoding.writeVarUint(encoder, entry.clock);
    encoding.writeVarString(encoder, JSON.stringify(entry.state));
  }
  return encoding.toUint8Array(encoder);
}

export class SessionManager {
  private readonly store: SessionStore;
  private readonly sessions = new Map<string, SessionState>();
  private readonly loadingSessions = new Map<string, Promise<SessionState>>();

  constructor(store: SessionStore) {
    this.store = store;
  }

  async getOrCreateSession(sessionId: string): Promise<SessionState> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastAccessedAt = Date.now();
      return existing;
    }

    const loading = this.loadingSessions.get(sessionId);
    if (loading) {
      return loading;
    }

    const next = this.loadSession(sessionId).then((state) => {
      this.sessions.set(sessionId, state);
      this.loadingSessions.delete(sessionId);
      return state;
    }, (error) => {
      this.loadingSessions.delete(sessionId);
      throw error;
    });
    this.loadingSessions.set(sessionId, next);
    return next;
  }

  async readSession(sessionId: string): Promise<SessionSnapshot | null> {
    const live = this.sessions.get(sessionId);
    if (live) {
      live.lastAccessedAt = Date.now();
      return this.snapshot(live);
    }

    const persisted = await this.store.get(sessionId);
    if (!persisted) {
      return null;
    }

    const doc = new Y.Doc();
    Y.applyUpdate(doc, Buffer.from(persisted.encodedState, 'base64'));
    return this.snapshotFromDoc({
      id: persisted.id,
      doc,
      updatedAt: persisted.updatedAt,
      participants: readParticipants(doc),
    });
  }

  async getSession(sessionId: string): Promise<{ session_id: string; diagrams: DiagramSummary[]; participants: Participant[]; revision: string }> {
    const snapshot = await this.readSession(sessionId);
    if (!snapshot) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    return {
      session_id: sessionId,
      diagrams: snapshot.diagrams.map(({ id, name, revision }) => ({ id, name, revision })),
      participants: snapshot.participants,
      revision: snapshot.revision,
    };
  }

  async listDiagrams(sessionId: string): Promise<{ diagrams: DiagramSummary[]; participants: Participant[]; revision: string }> {
    const { session_id: _sessionId, ...result } = await this.getSession(sessionId);
    return result;
  }

  async readDiagram(sessionId: string, diagramId: string): Promise<{ diagram: Diagram; participants: Participant[] }> {
    const live = this.sessions.get(sessionId);
    if (live) {
      live.lastAccessedAt = Date.now();
      return { diagram: readDiagram(live.doc, diagramId), participants: readParticipantsFromAwareness(live.awareness) };
    }
    const snapshot = await this.readSession(sessionId);
    if (!snapshot) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const diagram = snapshot.diagrams.find((candidate) => candidate.id === diagramId);
    if (!diagram) {
      throw new Error(`Diagram not found: ${diagramId}`);
    }
    return { diagram, participants: snapshot.participants };
  }

  async createDiagram(sessionId: string, name: string, mermaidText: string, revision: string, event: ActivityEvent, participants?: Participant[]): Promise<Diagram> {
    const session = await this.getOrCreateSession(sessionId);
    this.assertRevision(session.doc, revision);
    const id = diagramId();
    const normalizedName = normalizeDiagramName(name);
    session.doc.transact(() => {
      this.assertUniqueDiagramName(session.doc, normalizedName);
      diagramsMap(session.doc).set(id, createDiagram(id, normalizedName, mermaidText));
      diagramOrder(session.doc).push([id]);
      this.appendActivity(session.doc, { ...event, diagram_id: id });
    }, MANAGED_AWARENESS_ORIGIN);
    await this.afterMutation(session, participants);
    return readDiagram(session.doc, id);
  }

  async writeDiagram(sessionId: string, diagramId: string, mermaidText: string, revision: string, event: ActivityEvent, participants?: Participant[], name?: string): Promise<Diagram> {
    const session = await this.getOrCreateSession(sessionId);
    const diagram = diagramsMap(session.doc).get(diagramId);
    if (!diagram) {
      throw new Error(`Diagram not found: ${diagramId}`);
    }
    this.assertDiagramRevision(diagram, diagramId, revision);
    const nextName = name === undefined ? undefined : normalizeDiagramName(name);
    session.doc.transact(() => {
      const text = getMermaidText(diagram);
      text.delete(0, text.length);
      text.insert(0, mermaidText);
      if (nextName !== undefined) {
        this.assertUniqueDiagramName(session.doc, nextName, diagramId);
        diagram.set(DIAGRAM_NAME_KEY, nextName);
      }
      this.appendActivity(session.doc, event);
    }, MANAGED_AWARENESS_ORIGIN);
    await this.afterMutation(session, participants);
    return readDiagram(session.doc, diagramId);
  }

  async renameDiagram(sessionId: string, diagramId: string, name: string, revision: string, event: ActivityEvent, participants?: Participant[]): Promise<Diagram> {
    const session = await this.getOrCreateSession(sessionId);
    const diagram = diagramsMap(session.doc).get(diagramId);
    if (!diagram) {
      throw new Error(`Diagram not found: ${diagramId}`);
    }
    this.assertDiagramRevision(diagram, diagramId, revision);
    session.doc.transact(() => {
      const normalizedName = normalizeDiagramName(name);
      this.assertUniqueDiagramName(session.doc, normalizedName, diagramId);
      diagram.set(DIAGRAM_NAME_KEY, normalizedName);
      this.appendActivity(session.doc, event);
    }, MANAGED_AWARENESS_ORIGIN);
    await this.afterMutation(session, participants);
    return readDiagram(session.doc, diagramId);
  }

  async deleteDiagram(sessionId: string, diagramId: string, revision: string, event: ActivityEvent, participants?: Participant[]): Promise<string> {
    const session = await this.getOrCreateSession(sessionId);
    const diagrams = diagramsMap(session.doc);
    if (!diagrams.has(diagramId)) {
      throw new Error(`Diagram not found: ${diagramId}`);
    }
    this.assertDiagramRevision(diagrams.get(diagramId)!, diagramId, revision);
    if (diagrams.size <= 1) {
      throw new Error('A session must retain at least one diagram.');
    }
    session.doc.transact(() => {
      diagrams.delete(diagramId);
      const order = diagramOrder(session.doc);
      const index = order.toArray().indexOf(diagramId);
      if (index >= 0) {
        order.delete(index, 1);
      }
      this.appendActivity(session.doc, event);
    }, MANAGED_AWARENESS_ORIGIN);
    await this.afterMutation(session, participants);
    return revisionFromDoc(session.doc);
  }

  async listSessions(): Promise<StoredSessionSummary[]> {
    const persisted = await this.store.list();
    const summaries = new Map<string, StoredSessionSummary>();
    for (const record of persisted) {
      summaries.set(record.id, { id: record.id, title: record.title, participants: record.participants.length, updatedAt: record.updatedAt });
    }
    for (const state of this.sessions.values()) {
      const snapshot = this.snapshot(state);
      summaries.set(snapshot.id, { id: snapshot.id, title: snapshot.title, participants: snapshot.participants.length, updatedAt: snapshot.updatedAt });
    }
    return [...summaries.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async cleanupExpiredSessions(options: CleanupOptions): Promise<string[]> {
    const now = options.now ?? Date.now();
    const removed: string[] = [];
    for (const [sessionId, state] of this.sessions.entries()) {
      if (state.sockets.size > 0 || now - state.lastAccessedAt < options.ttlMs) continue;
      await this.persistSession(state);
      state.doc.destroy();
      this.sessions.delete(sessionId);
      removed.push(sessionId);
    }
    if (Number.isFinite(options.diskTtlMs)) {
      for (const record of await this.store.list()) {
        if (!this.sessions.has(record.id) && now - record.updatedAt >= options.diskTtlMs) {
          await this.store.delete(record.id);
          removed.push(record.id);
        }
      }
    }
    return removed;
  }

  async persistSession(session: SessionState): Promise<void> {
    syncParticipantsFromAwareness(session);
    const snapshot = this.snapshot(session);
    await this.store.set({
      id: snapshot.id,
      title: snapshot.title,
      activity: snapshot.activity,
      participants: snapshot.participants,
      encodedState: Buffer.from(Y.encodeStateAsUpdate(session.doc)).toString('base64'),
      updatedAt: snapshot.updatedAt,
    });
    session.lastPersistedAt = snapshot.updatedAt;
  }

  async close(): Promise<void> {
    for (const state of this.sessions.values()) {
      const activeClientIds = [...state.socketClientIds.values()].flatMap((clientIds) => [...clientIds]);
      if (activeClientIds.length > 0) removeAwarenessStates(state.awareness, activeClientIds, MANAGED_AWARENESS_ORIGIN);
      await this.persistSession(state);
      state.doc.destroy();
    }
    this.sessions.clear();
    await this.store.close();
  }

  toSessionSummary(snapshot: SessionSnapshot): SessionSummary {
    return { id: snapshot.id, title: snapshot.title, participants: snapshot.participants.length };
  }

  private async loadSession(sessionId: string): Promise<SessionState> {
    const persisted = await this.store.get(sessionId);
    const doc = new Y.Doc();
    if (persisted) Y.applyUpdate(doc, Buffer.from(persisted.encodedState, 'base64'));
    ensureInitialDiagram(doc);
    reconcileDiagramNames(doc);
    const awareness = new Awareness(doc);
    awareness.setLocalState(null);
    const now = Date.now();
    const state: SessionState = {
      id: sessionId, doc, awareness, sockets: new Set(), socketClientIds: new Map(), managedAwarenessClientIds: new Set(),
      lastAccessedAt: now, lastPersistedAt: persisted?.updatedAt ?? 0, updatedAt: persisted?.updatedAt ?? now,
    };
    awareness.on('update', () => {
      syncParticipantsFromAwareness(state);
      state.lastAccessedAt = Date.now();
    });
    doc.on('afterTransaction', (transaction) => {
      if (transaction.origin === MANAGED_AWARENESS_ORIGIN || transaction.origin === 'diagram-name-reconciliation') {
        return;
      }
      doc.transact(() => {
        reconcileDiagramNames(doc);
      }, 'diagram-name-reconciliation');
    });
    return state;
  }

  private snapshot(session: SessionState): SessionSnapshot {
    return this.snapshotFromDoc({ id: session.id, doc: session.doc, updatedAt: session.updatedAt, participants: readParticipantsFromAwareness(session.awareness) });
  }

  private snapshotFromDoc(options: { id: string; doc: Y.Doc; updatedAt: number; participants: Participant[] }): SessionSnapshot {
    const diagrams = readDiagrams(options.doc);
    return { id: options.id, title: titleFromDiagrams(diagrams), diagrams, revision: revisionFromDoc(options.doc), activity: readActivity(options.doc), participants: options.participants, updatedAt: options.updatedAt };
  }

  private assertRevision(doc: Y.Doc, revision: string): void {
    if (revision !== revisionFromDoc(doc)) throw new Error('Stale diagram revision. Read or list diagrams and retry.');
  }

  private assertDiagramRevision(diagram: DiagramMap, diagramId: string, revision: string): void {
    if (revision !== revisionForDiagram(diagram, diagramId)) {
      throw new Error('Stale diagram revision. Read or list diagrams and retry.');
    }
  }

  private assertUniqueDiagramName(doc: Y.Doc, name: string, exceptId?: string): void {
    const normalized = name.toLocaleLowerCase();
    for (const id of orderedDiagramIds(doc)) {
      if (id !== exceptId && getDiagramName(diagramsMap(doc).get(id)!, id).toLocaleLowerCase() === normalized) {
        throw new Error(`Diagram name already exists: ${name}`);
      }
    }
  }

  private appendActivity(doc: Y.Doc, event: ActivityEvent): void {
    const activity = doc.getArray<ActivityEvent>(ACTIVITY_KEY);
    activity.push([event]);
    const overflow = activity.length - 100;
    if (overflow > 0) {
      activity.delete(0, overflow);
    }
  }

  private async afterMutation(session: SessionState, participants?: Participant[]): Promise<void> {
    const now = Date.now();
    session.lastAccessedAt = now;
    session.updatedAt = now;
    if (participants !== undefined) this.setManagedParticipants(session, participants);
    await this.persistSession(session);
  }

  private setManagedParticipants(session: SessionState, participants: Participant[]): void {
    const nextClientIds = new Set<number>();
    const updates: Array<{ clientId: number; clock: number; state: Record<string, unknown> | null }> = [];
    for (const participant of participants) {
      const clientId = stableParticipantClientId(participant);
      nextClientIds.add(clientId);
      updates.push({ clientId, clock: (session.awareness.meta.get(clientId)?.clock ?? 0) + 1, state: { user: participant } });
    }
    const removedClientIds = [...session.managedAwarenessClientIds].filter((clientId) => !nextClientIds.has(clientId));
    if (removedClientIds.length > 0) removeAwarenessStates(session.awareness, removedClientIds, MANAGED_AWARENESS_ORIGIN);
    if (updates.length > 0) applyAwarenessUpdate(session.awareness, encodeAwarenessStateUpdate(updates), MANAGED_AWARENESS_ORIGIN);
    session.managedAwarenessClientIds = nextClientIds;
  }
}
