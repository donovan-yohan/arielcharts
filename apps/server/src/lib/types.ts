import type { ActivityEvent, Participant, SessionSummary } from '@mermaidflow/shared';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { WebSocket } from 'ws';
import type { Awareness } from 'y-protocols/awareness';
import type * as Y from 'yjs';

export interface SessionRecord {
  id: string;
  title: string;
  mermaidText: string;
  activity: ActivityEvent[];
  participants: Participant[];
  encodedState: string;
  updatedAt: number;
}

export interface SessionSnapshot {
  id: string;
  title: string;
  mermaidText: string;
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
  now?: number;
}

export interface ServerEnv {
  port: number;
  dataDir: string;
  cleanupIntervalMs: number;
  sessionTtlMs: number;
  allowedOrigins: string[];
}

export interface UpgradeContext {
  request: IncomingMessage;
  socket: Duplex;
  head: Buffer;
}
