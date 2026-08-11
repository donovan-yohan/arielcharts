import {
  resolveSourceLayoutPolicy,
  type ActivityEvent,
  type Diagram,
  type DiagramNodePositions,
  type DiagramRevision,
  type DiagramRevisionAction,
  type DiagramRevisionOrigin,
  type DiagramRevisionSummary,
  type DiagramSummary,
  type Participant,
  type RestoreDiagramRevisionResult,
  type SessionSummary,
  type SourceLayoutPolicy,
} from '@arielcharts/shared';
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
import {
  COLLABORATION_BUDGETS,
  createReservedRootDocument,
  decodePersistedYjsState,
  repairOverlayDocument,
  validateDocumentState,
  validateReservedRootTypes,
} from './document-admission.js';
import { SessionStore } from './persistence.js';
import type { CleanupOptions, DiagramHistoryMetadata, HistoryPersistenceChange, RoomAccessRecord, SessionRecord, SessionSnapshot, SessionState } from './types.js';

const MANAGED_AWARENESS_ORIGIN = 'session-manager';
const CATALOG_REPAIR_ORIGIN = 'catalog-repair';
const DEFAULT_DIAGRAM_ID = 'main';
const DEFAULT_DIAGRAM_TITLE = 'Main';
const HISTORY_PROCESSED_ACTIVITY_LIMIT = 200;
const HISTORY_RETAINED_MUTATIONS = 99;
const SYSTEM_HISTORY_ACTOR = { name: 'System', type: 'agent' as const };
const ACTIVITY_ACTIONS = new Set<ActivityEvent['action']>(['joined', 'left', 'edited', 'replaced', 'created', 'renamed', 'deleted', 'restored']);

type DiagramMap = Y.Map<unknown>;

interface DiagramHistorySnapshot {
  id: string;
  name: string;
  mermaidText: string;
  nodePositions: DiagramNodePositions;
  revision: string;
}

interface HistorySnapshot {
  diagrams: DiagramHistorySnapshot[];
  activity: ActivityEvent[];
}

interface PendingSessionPersistence {
  snapshot: HistorySnapshot;
  record: SessionRecord;
}

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

function getNodePositions(diagram: DiagramMap): Y.Map<unknown> {
  const value = diagram.get(DIAGRAM_NODE_POSITIONS_KEY);
  if (!(value instanceof Y.Map)) {
    throw new Error('Diagram is missing its node positions.');
  }
  return value;
}

function readRevisionNodePositions(diagram: DiagramMap): DiagramNodePositions {
  const positions = Object.create(null) as DiagramNodePositions;
  for (const [id, value] of [...getNodePositions(diagram).entries()].sort(([left], [right]) => left.localeCompare(right))) {
    if (!id || !value || typeof value !== 'object') continue;
    const position = value as Partial<{ x: unknown; y: unknown }>;
    if (typeof position.x === 'number' && Number.isFinite(position.x)
      && typeof position.y === 'number' && Number.isFinite(position.y)) {
      positions[id] = { x: position.x, y: position.y };
    }
  }
  return positions;
}

/** Source is canonical: only accepted blank/generic/flowchart source can prune layout. */
function reconcileNodePositionsForSource(diagram: DiagramMap, policy: SourceLayoutPolicy): void {
  if (!policy.pruneDurablePositions) {
    return;
  }

  const positions = getNodePositions(diagram);
  for (const nodeId of positions.keys()) {
    if (!policy.nodeIds.has(nodeId)) {
      positions.delete(nodeId);
    }
  }
}

function replaceNodePositions(diagram: DiagramMap, positions: DiagramNodePositions): void {
  const durablePositions = getNodePositions(diagram);
  for (const id of [...durablePositions.keys()]) {
    durablePositions.delete(id);
  }
  for (const [id, position] of Object.entries(positions)) {
    durablePositions.set(id, { x: position.x, y: position.y });
  }
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

function isDiagramMap(value: unknown): value is DiagramMap {
  return value instanceof Y.Map;
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
  const name = normalizeDiagramName(getDiagramName(diagram, id));
  const source = getMermaidText(diagram).toString();
  const positions = readRevisionNodePositions(diagram);
  return createHash('sha256')
    .update(JSON.stringify({ id, name, source, positions }))
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

function repairDiagramCatalog(doc: Y.Doc): boolean {
  const diagrams = diagramsMap(doc);
  const order = diagramOrder(doc);
  let repairedEntry = false;

  for (const id of [...diagrams.keys()].sort((left, right) => left.localeCompare(right))) {
    const diagram = diagrams.get(id);
    if (!isDiagramMap(diagram)) {
      diagrams.delete(id);
      repairedEntry = true;
      continue;
    }

    const mermaid = diagram.get(DIAGRAM_MERMAID_TEXT_KEY);
    if (!(mermaid instanceof Y.Text)) {
      const text = new Y.Text();
      if (typeof mermaid === 'string') text.insert(0, mermaid);
      diagram.set(DIAGRAM_MERMAID_TEXT_KEY, text);
      repairedEntry = true;
    }
    if (!(diagram.get(DIAGRAM_NODE_POSITIONS_KEY) instanceof Y.Map)) {
      diagram.set(DIAGRAM_NODE_POSITIONS_KEY, new Y.Map());
      repairedEntry = true;
    }
    const positions = diagram.get(DIAGRAM_NODE_POSITIONS_KEY) as Y.Map<unknown>;
    for (const [nodeId, rawPosition] of positions.entries()) {
      const position = rawPosition as Partial<{ x: unknown; y: unknown }> | null;
      if (!nodeId || !position || typeof position !== 'object'
        || typeof position.x !== 'number' || !Number.isFinite(position.x)
        || typeof position.y !== 'number' || !Number.isFinite(position.y)) {
        positions.delete(nodeId);
        repairedEntry = true;
      }
    }
  }

  const currentOrder = order.toArray();
  const canonicalOrder: string[] = [];
  const seen = new Set<string>();
  let seeded = false;

  for (const id of currentOrder) {
    if (diagrams.has(id) && !seen.has(id)) {
      seen.add(id);
      canonicalOrder.push(id);
    }
  }

  if (diagrams.size === 0) {
    diagrams.set(DEFAULT_DIAGRAM_ID, createDiagram(DEFAULT_DIAGRAM_ID, DEFAULT_DIAGRAM_TITLE, ''));
    canonicalOrder.push(DEFAULT_DIAGRAM_ID);
    seeded = true;
  } else {
    for (const id of [...diagrams.keys()].sort((left, right) => left.localeCompare(right))) {
      if (!seen.has(id)) {
        seen.add(id);
        canonicalOrder.push(id);
      }
    }
  }

  const orderChanged = currentOrder.length !== canonicalOrder.length
    || currentOrder.some((id, index) => id !== canonicalOrder[index]);
  if (orderChanged) {
    if (order.length > 0) order.delete(0, order.length);
    if (canonicalOrder.length > 0) order.insert(0, canonicalOrder);
  }

  return repairedEntry || seeded || orderChanged;
}

/**
 * Browser clients can mutate the Yjs document directly, bypassing the MCP
 * command validation. Resolve colliding raw names deterministically on the
 * authoritative document so an agent can safely identify a diagram by name.
 */
function reconcileDiagramNames(doc: Y.Doc): boolean {
  const diagrams = diagramsMap(doc);
  const claimedNames = new Set<string>();
  let changed = false;

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
      changed = true;
    }
  }
  return changed;
}

function repairDocument(doc: Y.Doc): boolean {
  let changed = false;
  doc.transact(() => {
    const catalogChanged = repairDiagramCatalog(doc);
    const namesChanged = reconcileDiagramNames(doc);
    const overlaysChanged = repairOverlayDocument(doc);
    changed = catalogChanged || namesChanged || overlaysChanged;
  }, CATALOG_REPAIR_ORIGIN);
  return changed;
}

function readActivity(doc: Y.Doc): ActivityEvent[] {
  return doc.getArray<ActivityEvent>(ACTIVITY_KEY).toArray();
}

function isDiagramActivityEvent(value: unknown, diagramId: string): value is ActivityEvent {
  if (!value || typeof value !== 'object') return false;
  const event = value as Partial<ActivityEvent>;
  return event.diagram_id === diagramId
    && typeof event.id === 'string'
    && event.id.length > 0
    && typeof event.timestamp === 'number'
    && Number.isFinite(event.timestamp)
    && typeof event.action === 'string'
    && ACTIVITY_ACTIONS.has(event.action as ActivityEvent['action'])
    && !!event.actor
    && typeof event.actor.name === 'string'
    && (event.actor.type === 'human' || event.actor.type === 'agent');
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

function ensureParticipants(doc: Y.Doc, participants: readonly Participant[]): Participant[] {
  const map = doc.getMap<Participant>(PRESENCE_KEY);
  const ensured: Participant[] = [];

  for (const participant of participants) {
    const existing = map.get(participant.name);
    if (isParticipant(existing)) {
      ensured.push(existing);
      continue;
    }
    map.set(participant.name, participant);
    ensured.push(participant);
  }

  return ensured;
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

function readCollaborators(doc: Y.Doc, awareness: Awareness): Participant[] {
  const collaborators = new Map<string, Participant>();
  for (const participant of readParticipants(doc)) {
    if (participant.type === 'agent') {
      collaborators.set(participant.name, participant);
    }
  }
  for (const participant of readParticipantsFromAwareness(awareness)) {
    if (!collaborators.has(participant.name)) {
      collaborators.set(participant.name, participant);
    }
  }
  return [...collaborators.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function readParticipantMirror(doc: Y.Doc, awareness: Awareness): Participant[] {
  const participants = new Map<string, Participant>();
  for (const participant of readParticipants(doc)) {
    if (participant.type === 'agent') {
      participants.set(participant.name, participant);
    }
  }
  for (const participant of readParticipantsFromAwareness(awareness)) {
    if (participant.type === 'human' && !participants.has(participant.name)) {
      participants.set(participant.name, participant);
    }
  }
  return [...participants.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function areParticipantsEqual(left: readonly Participant[], right: readonly Participant[]): boolean {
  return left.length === right.length && left.every((participant, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && participant.name === candidate.name
      && participant.color === candidate.color
      && participant.type === candidate.type;
  });
}

function syncParticipantsFromAwareness(session: SessionState): void {
  const participants = readParticipantMirror(session.doc, session.awareness);
  const currentParticipants = readParticipants(session.doc);
  // Cursor and canvas-selection awareness updates must not create a document
  // transaction when the durable participant mirror is already current.
  if (areParticipantsEqual(currentParticipants, participants)) {
    return;
  }
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
  private readonly persistenceQueues = new Map<string, Promise<void>>();

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

  /** Explicit protected-room creation. Network ingress must use requireSession instead. */
  async createProtectedSession(sessionId: string, access: RoomAccessRecord): Promise<SessionState> {
    if (this.sessions.has(sessionId) || await this.store.get(sessionId)) {
      throw new Error(`Session already exists: ${sessionId}`);
    }
    const loading = this.loadingSessions.get(sessionId);
    if (loading) {
      await loading;
      throw new Error(`Session already exists: ${sessionId}`);
    }
    const next = this.loadSession(sessionId, { allowCreate: true, initialRoomAccess: access }).then((state) => {
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

  /** Loads an existing persisted/live room without creating state as a side effect. */
  async requireSession(sessionId: string): Promise<SessionState> {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      existing.lastAccessedAt = Date.now();
      return existing;
    }
    const loading = this.loadingSessions.get(sessionId);
    if (loading) return loading;
    const next = this.loadSession(sessionId, { allowCreate: false }).then((state) => {
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

    const { doc, repaired } = this.documentFromPersistedRecord(persisted);
    try {
      const updatedAt = repaired ? Date.now() : persisted.updatedAt;
      const snapshot = this.snapshotFromDoc({
        id: persisted.id,
        doc,
        updatedAt,
        participants: readParticipants(doc),
      });
      if (repaired) {
        await this.runSessionPersistence(sessionId, () => this.store.set({
          id: snapshot.id,
          title: snapshot.title,
          activity: snapshot.activity,
          participants: snapshot.participants,
          encodedState: Buffer.from(Y.encodeStateAsUpdate(doc)).toString('base64'),
          updatedAt,
        }));
      }
      return snapshot;
    } finally {
      doc.destroy();
    }
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
      return { diagram: readDiagram(live.doc, diagramId), participants: readCollaborators(live.doc, live.awareness) };
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

  async listDiagramHistory(sessionId: string, diagramId: string): Promise<{ revisions: DiagramRevisionSummary[]; current_revision: string }> {
    const session = await this.requireSession(sessionId);
    const diagram = readDiagram(session.doc, diagramId);
    const revisions = await this.store.listDiagramHistory(sessionId, diagramId);
    return {
      revisions: revisions.map(({ mermaid_text: _source, node_positions: _positions, ...summary }) => summary),
      current_revision: diagram.revision,
    };
  }

  async readDiagramRevision(sessionId: string, diagramId: string, revisionId: string): Promise<DiagramRevision> {
    const session = await this.requireSession(sessionId);
    readDiagram(session.doc, diagramId);
    const revision = await this.store.getDiagramRevision(sessionId, diagramId, revisionId);
    if (!revision) {
      throw new Error(`Diagram revision not found: ${revisionId}`);
    }
    return revision;
  }

  async restoreDiagramRevision(
    sessionId: string,
    diagramId: string,
    revisionId: string,
    expectedRevision: string,
    event: ActivityEvent,
    participants?: Participant[],
    origin: Extract<DiagramRevisionOrigin, 'browser' | 'mcp'> = 'mcp',
  ): Promise<RestoreDiagramRevisionResult> {
    const session = await this.requireSession(sessionId);
    const current = readDiagram(session.doc, diagramId);
    if (expectedRevision !== current.revision) {
      return { status: 'stale', current, current_revision: current.revision };
    }

    const target = await this.store.getDiagramRevision(sessionId, diagramId, revisionId);
    if (!target) {
      throw new Error(`Diagram revision not found: ${revisionId}`);
    }

    const currentAfterTargetRead = readDiagram(session.doc, diagramId);
    if (expectedRevision !== currentAfterTargetRead.revision) {
      return { status: 'stale', current: currentAfterTargetRead, current_revision: currentAfterTargetRead.revision };
    }

    const diagram = diagramsMap(session.doc).get(diagramId);
    if (!diagram) {
      throw new Error(`Diagram not found: ${diagramId}`);
    }
    this.assertProjectedSourceBudget(session.doc, getMermaidText(diagram).toString(), target.mermaid_text);

    const restoreEvent: ActivityEvent = {
      ...event,
      action: 'restored',
      diagram_id: diagramId,
      base_revision: expectedRevision,
      restored_from_revision_id: revisionId,
    };
    const currentBeforeRestore = readDiagram(session.doc, diagramId);
    if (expectedRevision !== currentBeforeRestore.revision) {
      return { status: 'stale', current: currentBeforeRestore, current_revision: currentBeforeRestore.revision };
    }

    const ensuredParticipants = this.mutateWithParticipants(session, participants, () => {
      const text = getMermaidText(diagram);
      text.delete(0, text.length);
      text.insert(0, target.mermaid_text);
      replaceNodePositions(diagram, target.node_positions);
      this.appendActivity(session.doc, {
        ...restoreEvent,
        result_revision: revisionForDiagram(diagram, diagramId),
      });
    });
    const revisions = await this.afterMutation(session, ensuredParticipants, restoreEvent.id, origin);
    const revision = revisions.find((candidate) => candidate.activity_id === restoreEvent.id);
    if (!revision) {
      throw new Error('Restore history checkpoint was not persisted.');
    }
    return { status: 'restored', diagram: readDiagram(session.doc, diagramId), revision: this.revisionSummary(revision) };
  }

  async createDiagram(sessionId: string, name: string, mermaidText: string, revision: string, event: ActivityEvent, participants?: Participant[]): Promise<Diagram> {
    const session = await this.requireSession(sessionId);
    this.assertRevision(session.doc, revision);
    this.assertProjectedSourceBudget(session.doc, '', mermaidText, { creatingDiagram: true });
    const id = diagramId();
    const normalizedName = normalizeDiagramName(name);
    this.assertUniqueDiagramName(session.doc, normalizedName);
    const ensuredParticipants = this.mutateWithParticipants(session, participants, () => {
      diagramsMap(session.doc).set(id, createDiagram(id, normalizedName, mermaidText));
      diagramOrder(session.doc).push([id]);
      this.appendActivity(session.doc, {
        ...event,
        diagram_id: id,
        base_revision: revision,
        result_revision: revisionForDiagram(diagramsMap(session.doc).get(id)!, id),
      });
    });
    await this.afterMutation(session, ensuredParticipants, event.id);
    return readDiagram(session.doc, id);
  }

  async writeDiagram(sessionId: string, diagramId: string, mermaidText: string, revision: string, event: ActivityEvent, participants?: Participant[], name?: string): Promise<Diagram> {
    const sourceLayoutPolicy = await resolveSourceLayoutPolicy(mermaidText);
    const session = await this.requireSession(sessionId);
    const diagram = diagramsMap(session.doc).get(diagramId);
    if (!diagram) {
      throw new Error(`Diagram not found: ${diagramId}`);
    }
    this.assertDiagramRevision(diagram, diagramId, revision);
    this.assertProjectedSourceBudget(session.doc, getMermaidText(diagram).toString(), mermaidText);
    const nextName = name === undefined ? undefined : normalizeDiagramName(name);
    if (nextName !== undefined) {
      this.assertUniqueDiagramName(session.doc, nextName, diagramId);
    }
    const ensuredParticipants = this.mutateWithParticipants(session, participants, () => {
      const text = getMermaidText(diagram);
      text.delete(0, text.length);
      text.insert(0, mermaidText);
      reconcileNodePositionsForSource(diagram, sourceLayoutPolicy);
      if (nextName !== undefined) {
        diagram.set(DIAGRAM_NAME_KEY, nextName);
      }
      this.appendActivity(session.doc, {
        ...event,
        diagram_id: diagramId,
        base_revision: revision,
        result_revision: revisionForDiagram(diagram, diagramId),
      });
    });
    await this.afterMutation(session, ensuredParticipants, event.id);
    return readDiagram(session.doc, diagramId);
  }

  async renameDiagram(sessionId: string, diagramId: string, name: string, revision: string, event: ActivityEvent, participants?: Participant[]): Promise<Diagram> {
    const session = await this.requireSession(sessionId);
    const diagram = diagramsMap(session.doc).get(diagramId);
    if (!diagram) {
      throw new Error(`Diagram not found: ${diagramId}`);
    }
    this.assertDiagramRevision(diagram, diagramId, revision);
    const normalizedName = normalizeDiagramName(name);
    this.assertUniqueDiagramName(session.doc, normalizedName, diagramId);
    const ensuredParticipants = this.mutateWithParticipants(session, participants, () => {
      diagram.set(DIAGRAM_NAME_KEY, normalizedName);
      this.appendActivity(session.doc, {
        ...event,
        diagram_id: diagramId,
        base_revision: revision,
        result_revision: revisionForDiagram(diagram, diagramId),
      });
    });
    await this.afterMutation(session, ensuredParticipants, event.id);
    return readDiagram(session.doc, diagramId);
  }

  async deleteDiagram(sessionId: string, diagramId: string, revision: string, event: ActivityEvent, participants?: Participant[]): Promise<string> {
    const session = await this.requireSession(sessionId);
    const diagrams = diagramsMap(session.doc);
    if (!diagrams.has(diagramId)) {
      throw new Error(`Diagram not found: ${diagramId}`);
    }
    this.assertDiagramRevision(diagrams.get(diagramId)!, diagramId, revision);
    if (diagrams.size <= 1) {
      throw new Error('A session must retain at least one diagram.');
    }
    const ensuredParticipants = this.mutateWithParticipants(session, participants, () => {
      diagrams.delete(diagramId);
      const order = diagramOrder(session.doc);
      const index = order.toArray().indexOf(diagramId);
      if (index >= 0) {
        order.delete(index, 1);
      }
      this.appendActivity(session.doc, { ...event, diagram_id: diagramId, base_revision: revision });
    });
    await this.afterMutation(session, ensuredParticipants, event.id);
    return revisionFromDoc(session.doc);
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
          const deleted = await this.runSessionPersistence(record.id, async () => {
            if (!this.sessions.has(record.id)) {
              await this.store.delete(record.id);
              return true;
            }
            return false;
          });
          if (deleted) removed.push(record.id);
        }
      }
    }
    return removed;
  }

  async persistSession(session: SessionState, options: { recovery?: boolean; activityOrigins?: ReadonlyMap<string, DiagramRevisionOrigin>; initialRoomAccess?: RoomAccessRecord } = {}): Promise<DiagramRevision[]> {
    const pending = this.capturePendingPersistence(session);
    return this.runSessionPersistence(session.id, () => this.persistSessionLocked(session, pending, options));
  }

  private async persistSessionLocked(
    session: SessionState,
    pending: PendingSessionPersistence,
    options: { recovery?: boolean; activityOrigins?: ReadonlyMap<string, DiagramRevisionOrigin>; initialRoomAccess?: RoomAccessRecord },
  ): Promise<DiagramRevision[]> {
    const history = await this.historyChanges(session.id, pending.snapshot, options);
    const persisted = await this.store.persistWithHistory(pending.record, history, { initialRoomAccess: options.initialRoomAccess });
    if (persisted === false) throw new Error(`Session already exists: ${session.id}`);
    session.lastPersistedAt = Math.max(session.lastPersistedAt, pending.record.updatedAt);
    return history.revisions;
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

  private async loadSession(
    sessionId: string,
    options: { allowCreate?: boolean; initialRoomAccess?: RoomAccessRecord } = {},
  ): Promise<SessionState> {
    const persisted = await this.store.get(sessionId);
    if (persisted && options.initialRoomAccess) {
      throw new Error(`Session already exists: ${sessionId}`);
    }
    if (!persisted && options.allowCreate === false) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    const loaded = persisted ? this.documentFromPersistedRecord(persisted) : { doc: createReservedRootDocument(), repaired: false };
    const doc = loaded.doc;
    const repairedOnLoad = repairDocument(doc) || loaded.repaired;
    const admission = validateDocumentState(doc);
    if (!admission.accepted) {
      doc.destroy();
      throw new Error(`Session document rejected: ${admission.reason}`);
    }
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
      if (transaction.origin === MANAGED_AWARENESS_ORIGIN || transaction.origin === CATALOG_REPAIR_ORIGIN) {
        return;
      }
      repairDocument(doc);
    });
    if (repairedOnLoad) {
      state.updatedAt = Date.now();
    }
    if (repairedOnLoad || persisted) {
      await this.persistSession(state, { recovery: true, initialRoomAccess: options.initialRoomAccess });
    }
    return state;
  }

  /** Builds and validates a detached persisted candidate before it becomes live. */
  private documentFromPersistedRecord(record: SessionRecord): { doc: Y.Doc; repaired: boolean } {
    const encoded = decodePersistedYjsState(record.encodedState);
    if (!(encoded instanceof Uint8Array)) {
      throw new Error(`Persisted session rejected: ${encoded.reason}`);
    }
    const doc = createReservedRootDocument();
    try {
      Y.applyUpdate(doc, new Uint8Array(encoded));
      // Root collection identities are not repairable without changing the
      // document contract. Refuse them before typed catalog repair executes.
      const rootTypes = validateReservedRootTypes(doc);
      if (!rootTypes.accepted) throw new Error(`Persisted session rejected: ${rootTypes.reason}`);
      const repaired = repairDocument(doc);
      const admission = validateDocumentState(doc);
      if (!admission.accepted) throw new Error(`Persisted session rejected: ${admission.reason}`);
      return { doc, repaired };
    } catch (error) {
      doc.destroy();
      if (error instanceof Error && error.message.startsWith('Persisted session rejected:')) throw error;
      throw new Error('Persisted session rejected: malformed_yjs_update');
    }
  }

  private snapshot(session: SessionState): SessionSnapshot {
    return this.snapshotFromDoc({ id: session.id, doc: session.doc, updatedAt: session.updatedAt, participants: readCollaborators(session.doc, session.awareness) });
  }

  private snapshotFromDoc(options: { id: string; doc: Y.Doc; updatedAt: number; participants: Participant[] }): SessionSnapshot {
    const diagrams = readDiagrams(options.doc);
    return { id: options.id, title: titleFromDiagrams(diagrams), diagrams, revision: revisionFromDoc(options.doc), activity: readActivity(options.doc), participants: options.participants, updatedAt: options.updatedAt };
  }

  private async historyChanges(
    sessionId: string,
    snapshot: HistorySnapshot,
    options: { recovery?: boolean; activityOrigins?: ReadonlyMap<string, DiagramRevisionOrigin> },
  ): Promise<HistoryPersistenceChange> {
    const revisions: DiagramRevision[] = [];
    const metadataUpdates: DiagramHistoryMetadata[] = [];
    const deleteSequences = new Map<string, { sessionId: string; diagramId: string; sequence: number }>();
    const diagramIds = snapshot.diagrams.map((diagram) => diagram.id);
    const storedMetadata = await this.store.listSessionHistoryMetadata(sessionId);
    const metadataByDiagram = new Map(storedMetadata.map((metadata) => [metadata.diagramId, metadata]));
    const sessionHasHistory = storedMetadata.length > 0;

    for (const id of diagramIds) {
      const diagram = snapshot.diagrams.find((candidate) => candidate.id === id);
      if (!diagram) continue;

      const prior = metadataByDiagram.get(id) ?? null;
      const events = snapshot.activity.filter((event) => isDiagramActivityEvent(event, id));
      const processed = new Set(prior?.processedActivityIds ?? []);
      const unseen = events.filter((event) => !processed.has(event.id));
      let nextSequence = prior?.nextSequence ?? 0;
      let latestRevision = prior?.latestRevision ?? '';
      const previousFirstRetainedMutation = prior?.firstRetainedMutationSequence ?? 1;
      const captured: DiagramRevision[] = [];

      if (!prior) {
        const creationIndex = sessionHasHistory ? unseen.findIndex((event) => event.action === 'created') : -1;
        if (creationIndex < 0) {
          captured.push(this.captureRevision(diagram, nextSequence, {
            action: 'baseline',
            actor: SYSTEM_HISTORY_ACTOR,
            origin: 'system',
          }));
          nextSequence += 1;
        }

        for (const event of creationIndex < 0 ? [] : unseen.slice(creationIndex)) {
          captured.push(this.captureRevision(diagram, nextSequence, {
            action: event.action,
            activity: event,
            origin: options.activityOrigins?.get(event.id) ?? 'browser',
          }));
          nextSequence += 1;
        }
      } else {
        for (const event of unseen) {
          captured.push(this.captureRevision(diagram, nextSequence, {
            action: event.action,
            activity: event,
            origin: options.activityOrigins?.get(event.id) ?? 'browser',
          }));
          nextSequence += 1;
        }
        if (captured.length === 0 && options.recovery && latestRevision !== diagram.revision) {
          captured.push(this.captureRevision(diagram, nextSequence, {
            action: 'checkpoint',
            actor: SYSTEM_HISTORY_ACTOR,
            origin: 'system',
          }));
          nextSequence += 1;
        }
      }

      if (captured.length === 0) continue;
      revisions.push(...captured);
      latestRevision = captured.at(-1)!.result_revision!;
      for (const event of unseen) processed.add(event.id);
      const processedActivityIds = [...processed].slice(-HISTORY_PROCESSED_ACTIVITY_LIMIT);
      const firstRetainedMutation = Math.max(1, nextSequence - HISTORY_RETAINED_MUTATIONS);
      metadataUpdates.push({
        sessionId,
        diagramId: id,
        firstRetainedMutationSequence: firstRetainedMutation,
        nextSequence,
        processedActivityIds,
        latestRevision,
      });

      for (let sequence = previousFirstRetainedMutation; sequence < firstRetainedMutation; sequence += 1) {
        deleteSequences.set(`${sessionId}:${id}:${sequence}`, { sessionId, diagramId: id, sequence });
      }
    }

    return {
      revisions,
      metadata: metadataUpdates,
      deleteSequences: [...deleteSequences.values()],
      deleteDiagramHistory: storedMetadata
        .filter((metadata) => !diagramIds.includes(metadata.diagramId))
        .map((metadata) => ({ sessionId, diagramId: metadata.diagramId })),
    };
  }

  private captureRevision(
    diagram: DiagramHistorySnapshot,
    sequence: number,
    input: {
      action: DiagramRevisionAction;
      actor?: ActivityEvent['actor'];
      origin: DiagramRevisionOrigin;
      activity?: ActivityEvent;
    },
  ): DiagramRevision {
    const activity = input.activity;
    return {
      revision_id: `revision_${sequence.toString().padStart(16, '0')}`,
      sequence,
      diagram_id: diagram.id,
      name: diagram.name,
      timestamp: activity?.timestamp ?? Date.now(),
      actor: input.actor ?? activity?.actor ?? SYSTEM_HISTORY_ACTOR,
      origin: input.origin,
      action: input.action,
      ...(activity === undefined ? {} : {
        activity_id: activity.id,
        base_revision: activity.base_revision,
        restored_from_revision_id: activity.restored_from_revision_id,
      }),
      result_revision: activity?.result_revision ?? diagram.revision,
      mermaid_text: diagram.mermaidText,
      node_positions: diagram.nodePositions,
    };
  }

  private revisionSummary(revision: DiagramRevision): DiagramRevisionSummary {
    const { mermaid_text: _source, node_positions: _positions, ...summary } = revision;
    return summary;
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

  /** MCP and server-owned source writes use the same bounded durable envelope as raw Yjs ingress. */
  private assertProjectedSourceBudget(
    doc: Y.Doc,
    previousSource: string,
    nextSource: string,
    options: { creatingDiagram?: boolean } = {},
  ): void {
    const nextBytes = Buffer.byteLength(nextSource, 'utf8');
    if (nextBytes > COLLABORATION_BUDGETS.totalTextBytes) {
      throw new Error('Mermaid source exceeds the collaborative document text budget.');
    }
    const currentBytes = Y.encodeStateAsUpdate(doc).byteLength;
    const previousBytes = Buffer.byteLength(previousSource, 'utf8');
    const structureAllowance = options.creatingDiagram ? 2_048 : 256;
    if (currentBytes - previousBytes + nextBytes + structureAllowance > COLLABORATION_BUDGETS.sessionStateBytes) {
      throw new Error('Mermaid source exceeds the collaborative document state budget.');
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

  private async afterMutation(
    session: SessionState,
    participants?: Participant[],
    activityId?: string,
    origin: Extract<DiagramRevisionOrigin, 'browser' | 'mcp'> = 'mcp',
  ): Promise<DiagramRevision[]> {
    const now = Date.now();
    session.lastAccessedAt = now;
    session.updatedAt = now;
    if (participants !== undefined) this.setManagedParticipants(session, participants);
    return this.persistSession(session, {
      activityOrigins: activityId === undefined ? undefined : new Map([[activityId, origin]]),
    });
  }

  private historySnapshot(doc: Y.Doc, activity: ActivityEvent[]): HistorySnapshot {
    return {
      diagrams: orderedDiagramIds(doc).flatMap((id) => {
        const diagram = diagramsMap(doc).get(id);
        if (!diagram) return [];
        return [{
          id,
          name: normalizeDiagramName(getDiagramName(diagram, id)),
          mermaidText: getMermaidText(diagram).toString(),
          nodePositions: readRevisionNodePositions(diagram),
          revision: revisionForDiagram(diagram, id),
        }];
      }),
      activity,
    };
  }

  private capturePendingPersistence(session: SessionState): PendingSessionPersistence {
    syncParticipantsFromAwareness(session);
    const snapshot = this.snapshot(session);
    return {
      snapshot: this.historySnapshot(session.doc, snapshot.activity),
      record: {
        id: snapshot.id,
        title: snapshot.title,
        activity: snapshot.activity,
        participants: snapshot.participants,
        encodedState: Buffer.from(Y.encodeStateAsUpdate(session.doc)).toString('base64'),
        updatedAt: snapshot.updatedAt,
      },
    };
  }

  private runSessionPersistence<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.persistenceQueues.get(sessionId);
    const result = previous === undefined
      ? operation()
      : previous.catch(() => undefined).then(operation);
    const tail = result.then(() => undefined, () => undefined);
    this.persistenceQueues.set(sessionId, tail);
    void tail.then(() => {
      if (this.persistenceQueues.get(sessionId) === tail) {
        this.persistenceQueues.delete(sessionId);
      }
    });
    return result;
  }

  private mutateWithParticipants(
    session: SessionState,
    participants: readonly Participant[] | undefined,
    mutation: () => void,
  ): Participant[] | undefined {
    let ensuredParticipants: Participant[] | undefined;
    session.doc.transact(() => {
      ensuredParticipants = participants === undefined ? undefined : ensureParticipants(session.doc, participants);
      mutation();
    }, MANAGED_AWARENESS_ORIGIN);
    return ensuredParticipants;
  }

  private setManagedParticipants(session: SessionState, participants: Participant[]): void {
    const updates: Array<{ clientId: number; clock: number; state: Record<string, unknown> | null }> = [];
    for (const participant of participants) {
      const clientId = stableParticipantClientId(participant);
      const existing = session.awareness.getStates().get(clientId) as { user?: unknown } | undefined;
      if (isParticipant(existing?.user)
        && existing.user.name === participant.name
        && existing.user.color === participant.color
        && existing.user.type === participant.type) {
        session.managedAwarenessClientIds.add(clientId);
        continue;
      }
      updates.push({ clientId, clock: (session.awareness.meta.get(clientId)?.clock ?? 0) + 1, state: { user: participant } });
      session.managedAwarenessClientIds.add(clientId);
    }
    if (updates.length > 0) applyAwarenessUpdate(session.awareness, encodeAwarenessStateUpdate(updates), MANAGED_AWARENESS_ORIGIN);
  }
}
