import type { ActivityEvent, AwarenessState, Participant, SessionSummary } from '@arielcharts/shared';
import * as encoding from 'lib0/encoding';
import { Awareness, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { ACTIVITY_KEY, DEFAULT_SESSION_TITLE, MERMAID_TEXT_KEY, PRESENCE_KEY } from './constants.js';
import { SessionStore } from './persistence.js';
import type { CleanupOptions, SessionSnapshot, SessionState, StoredSessionSummary } from './types.js';

const MANAGED_AWARENESS_ORIGIN = 'session-manager';

function readMermaidText(doc: Y.Doc): string {
  return doc.getText(MERMAID_TEXT_KEY).toString();
}

function writeMermaidText(doc: Y.Doc, mermaidText: string): void {
  const text = doc.getText(MERMAID_TEXT_KEY);
  text.delete(0, text.length);
  text.insert(0, mermaidText);
}

function readActivity(doc: Y.Doc): ActivityEvent[] {
  return doc.getArray<ActivityEvent>(ACTIVITY_KEY).toArray();
}

function writeActivity(doc: Y.Doc, activity: ActivityEvent[]): void {
  const activityArray = doc.getArray<ActivityEvent>(ACTIVITY_KEY);
  if (activityArray.length > 0) {
    activityArray.delete(0, activityArray.length);
  }
  if (activity.length > 0) {
    activityArray.insert(0, activity);
  }
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
    const awarenessState = state as AwarenessState | Record<string, unknown>;
    if (typeof awarenessState !== 'object' || awarenessState === null || !('user' in awarenessState)) {
      continue;
    }

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

function titleFromMermaidText(mermaidText: string): string {
  const firstLine = mermaidText
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine) {
    return DEFAULT_SESSION_TITLE;
  }

  return firstLine.slice(0, 80);
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

function encodeAwarenessStateUpdate(entries: Array<{ clientId: number; clock: number; state: AwarenessState | null }>): Uint8Array {
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

  constructor(store: SessionStore) {
    this.store = store;
  }

  async getOrCreateSession(sessionId: string): Promise<SessionState> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastAccessedAt = Date.now();
      return existing;
    }

    const state = await this.loadSession(sessionId);
    this.sessions.set(sessionId, state);
    return state;
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

    return {
      id: persisted.id,
      title: persisted.title,
      mermaidText: readMermaidText(doc),
      activity: readActivity(doc),
      participants: readParticipants(doc),
      updatedAt: persisted.updatedAt,
    };
  }

  async writeDiagram(sessionId: string, mermaidText: string, event: ActivityEvent, participants?: Participant[]): Promise<void> {
    const session = await this.getOrCreateSession(sessionId);
    const now = Date.now();
    session.lastAccessedAt = now;
    session.updatedAt = now;

    session.doc.transact(() => {
      writeMermaidText(session.doc, mermaidText);
      const activity = readActivity(session.doc);
      activity.push(event);
      writeActivity(session.doc, activity.slice(-100));
    }, MANAGED_AWARENESS_ORIGIN);

    if (participants !== undefined) {
      this.setManagedParticipants(session, participants);
    }

    await this.persistSession(session);
  }

  async listSessions(): Promise<StoredSessionSummary[]> {
    const persisted = await this.store.list();
    const summaries = new Map<string, StoredSessionSummary>();

    for (const record of persisted) {
      summaries.set(record.id, {
        id: record.id,
        title: record.title,
        participants: record.participants.length,
        updatedAt: record.updatedAt,
      });
    }

    for (const state of this.sessions.values()) {
      const snapshot = this.snapshot(state);
      summaries.set(snapshot.id, {
        id: snapshot.id,
        title: snapshot.title,
        participants: snapshot.participants.length,
        updatedAt: snapshot.updatedAt,
      });
    }

    return [...summaries.values()].sort((left, right) => right.updatedAt - left.updatedAt);
  }

  async cleanupExpiredSessions(options: CleanupOptions): Promise<string[]> {
    const now = options.now ?? Date.now();
    const removed: string[] = [];

    for (const [sessionId, state] of this.sessions.entries()) {
      if (state.sockets.size > 0) {
        continue;
      }

      if (now - state.lastAccessedAt < options.ttlMs) {
        continue;
      }

      await this.persistSession(state);
      state.doc.destroy();
      this.sessions.delete(sessionId);
      removed.push(sessionId);
    }

    if (Number.isFinite(options.diskTtlMs)) {
      const persisted = await this.store.list();
      for (const record of persisted) {
        if (this.sessions.has(record.id)) {
          continue;
        }

        if (now - record.updatedAt >= options.diskTtlMs) {
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
      mermaidText: snapshot.mermaidText,
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
      if (activeClientIds.length > 0) {
        removeAwarenessStates(state.awareness, activeClientIds, MANAGED_AWARENESS_ORIGIN);
      }
      await this.persistSession(state);
      state.doc.destroy();
    }
    this.sessions.clear();
    await this.store.close();
  }

  toSessionSummary(snapshot: SessionSnapshot): SessionSummary {
    return {
      id: snapshot.id,
      title: snapshot.title,
      participants: snapshot.participants.length,
    };
  }

  private async loadSession(sessionId: string): Promise<SessionState> {
    const persisted = await this.store.get(sessionId);
    const doc = new Y.Doc();

    if (persisted) {
      Y.applyUpdate(doc, Buffer.from(persisted.encodedState, 'base64'));
    }

    const awareness = new Awareness(doc);
    awareness.setLocalState(null);

    const now = Date.now();
    const state: SessionState = {
      id: sessionId,
      doc,
      awareness,
      sockets: new Set(),
      socketClientIds: new Map(),
      managedAwarenessClientIds: new Set(),
      lastAccessedAt: now,
      lastPersistedAt: persisted?.updatedAt ?? 0,
      updatedAt: persisted?.updatedAt ?? now,
    };

    awareness.on('update', () => {
      syncParticipantsFromAwareness(state);
      state.lastAccessedAt = Date.now();
    });

    return state;
  }

  private snapshot(session: SessionState): SessionSnapshot {
    return {
      id: session.id,
      title: titleFromMermaidText(readMermaidText(session.doc)),
      mermaidText: readMermaidText(session.doc),
      activity: readActivity(session.doc),
      participants: readParticipantsFromAwareness(session.awareness),
      updatedAt: session.updatedAt,
    };
  }

  private setManagedParticipants(session: SessionState, participants: Participant[]): void {
    const nextClientIds = new Set<number>();
    const updates: Array<{ clientId: number; clock: number; state: AwarenessState | null }> = [];

    for (const participant of participants) {
      const clientId = stableParticipantClientId(participant);
      nextClientIds.add(clientId);
      const currentClock = session.awareness.meta.get(clientId)?.clock ?? 0;
      updates.push({
        clientId,
        clock: currentClock + 1,
        state: { user: participant },
      });
    }

    const removedClientIds = [...session.managedAwarenessClientIds].filter((clientId) => !nextClientIds.has(clientId));
    if (removedClientIds.length > 0) {
      removeAwarenessStates(session.awareness, removedClientIds, MANAGED_AWARENESS_ORIGIN);
    }

    if (updates.length > 0) {
      applyAwarenessUpdate(session.awareness, encodeAwarenessStateUpdate(updates), MANAGED_AWARENESS_ORIGIN);
    }

    session.managedAwarenessClientIds = nextClientIds;
  }
}
