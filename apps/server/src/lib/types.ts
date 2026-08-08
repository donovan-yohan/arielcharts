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
}

export interface UpgradeContext {
  request: IncomingMessage;
  socket: Duplex;
  head: Buffer;
}
