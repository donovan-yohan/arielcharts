import type { ActivityEvent, Diagram, DiagramRevision, Participant, SessionSummary } from '@arielcharts/shared';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocket } from 'ws';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';

export interface SessionRecord {
  id: string;
  title: string;
  activity: ActivityEvent[];
  participants: Participant[];
  encodedState: string;
  updatedAt: number;
}

/** Server-private capability verifier. It never contains the raw room key. */
export interface RoomAccessRecord {
  salt: string;
  verifier: string;
  accessVersion: number;
  createdAt: number;
  updatedAt: number;
}

export interface DiagramHistoryMetadata {
  sessionId: string;
  diagramId: string;
  firstRetainedMutationSequence: number;
  nextSequence: number;
  processedActivityIds: string[];
  latestRevision: string;
}

export interface HistoryPersistenceChange {
  revisions: DiagramRevision[];
  metadata: DiagramHistoryMetadata[];
  deleteSequences: Array<{ sessionId: string; diagramId: string; sequence: number }>;
  deleteDiagramHistory: Array<{ sessionId: string; diagramId: string }>;
}

export interface SessionSnapshot {
  id: string;
  title: string;
  diagrams: Diagram[];
  revision: string;
  activity: ActivityEvent[];
  participants: Participant[];
  updatedAt: number;
}

export interface SessionState {
  id: string;
  doc: Y.Doc;
  awareness: Awareness;
  sockets: Set<WebSocket>;
  socketClientIds: Map<WebSocket, Set<number>>;
  managedAwarenessClientIds: Set<number>;
  lastAccessedAt: number;
  lastPersistedAt: number;
  updatedAt: number;
}

export interface StoredSessionSummary extends SessionSummary {
  updatedAt: number;
}

export interface CleanupOptions {
  ttlMs: number;
  diskTtlMs: number;
  now?: number;
}

export interface ServerEnv {
  port: number;
  dataDir: string;
  cleanupIntervalMs: number;
  sessionTtlMs: number;
  diskTtlMs: number;
  allowedOrigins: string[];
  /** Required by loadServerEnv in production; tests may inject a deterministic value. */
  roomCookieSecret?: string;
  roomCookieTtlMs?: number;
  roomCookieSecure?: boolean;
  roomCookieSameSite?: 'Lax' | 'Strict' | 'None';
  /** Explicit proxy identity source. Local/default deployments trust no forwarded headers. */
  clientAddressProfile?: 'none' | 'fly';
  /** Test-only low-cost verifier profile. Never enable this from production environment. */
  roomAccessCryptoProfile?: 'test';
}

export interface UpgradeContext {
  request: IncomingMessage;
  socket: Duplex;
  head: Buffer;
  sessionId: string;
  accessVersion: number;
}
