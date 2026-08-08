import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import * as Y from 'yjs';

const DIAGRAMS_KEY = 'diagrams';
const DIAGRAM_MERMAID_TEXT_KEY = 'mermaid';
const DIAGRAM_NODE_POSITIONS_KEY = 'nodePositions';
const ACTIVITY_KEY = 'activity';

export type YjsNodePosition = {
  x: number;
  y: number;
};

export type YjsSessionSnapshot = {
  activity: Array<{
    action: string;
    actorName: string;
    actorType: string;
    detail: string | null;
    diagramId: string | null;
    id: string;
    resultRevision: string | null;
    restoredFromRevisionId: string | null;
  }>;
  exists: boolean;
  mermaidText: string | null;
  nodePositions: Record<string, YjsNodePosition>;
};

export type YjsSessionSnapshotAppearance = {
  snapshot: YjsSessionSnapshot;
  update: number;
};

export type YjsSessionSnapshotHistory = {
  readonly appearances: readonly YjsSessionSnapshotAppearance[];
  destroy(): void;
  expectUnchangedFor(durationMs: number, description: string): Promise<void>;
};

export type YjsNodePositionAppearance = {
  position: YjsNodePosition;
  update: number;
};

export type YjsNodePositionHistory = {
  readonly appearances: readonly YjsNodePositionAppearance[];
  destroy(): void;
  expectAbsentFor(durationMs: number, description: string): Promise<void>;
  hasAppeared(): boolean;
};

export type YjsSessionObserver = {
  diagramExists(diagramId: string): boolean;
  destroy(): void;
  hasNodePosition(diagramId: string, nodeId: string): boolean;
  snapshot(diagramId: string): YjsSessionSnapshot;
  trackSnapshot(diagramId: string): YjsSessionSnapshotHistory;
  trackNodePosition(diagramId: string, nodeId: string): YjsNodePositionHistory;
  waitFor(
    predicate: (observer: YjsSessionObserver) => boolean,
    description: string,
    timeoutMs?: number,
  ): Promise<void>;
};

type DestroyableWebsocketProvider = WebsocketProvider & { destroy(): void };

export type YjsSessionObserverOptions = {
  cookie?: string;
  origin?: string;
  timeoutMs?: number;
};

function diagramMap(doc: Y.Doc, diagramId: string): Y.Map<unknown> | null {
  const diagram = doc.getMap<Y.Map<unknown>>(DIAGRAMS_KEY).get(diagramId);
  return diagram instanceof Y.Map ? diagram : null;
}

function isNodePosition(value: unknown): value is YjsNodePosition {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<YjsNodePosition>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
}

function activitySnapshot(doc: Y.Doc) {
  return doc.getArray<unknown>(ACTIVITY_KEY).toArray().flatMap((value) => {
    if (!value || typeof value !== 'object') return [];
    const event = value as Record<string, unknown>;
    const actor = event.actor && typeof event.actor === 'object' ? event.actor as Record<string, unknown> : {};
    const id = typeof event.id === 'string' ? event.id : null;
    if (!id) return [];
    return [{
      action: typeof event.action === 'string' ? event.action : '',
      actorName: typeof actor.name === 'string' ? actor.name : '',
      actorType: typeof actor.type === 'string' ? actor.type : '',
      detail: typeof event.detail === 'string' ? event.detail : null,
      diagramId: typeof event.diagram_id === 'string' ? event.diagram_id : null,
      id,
      resultRevision: typeof event.result_revision === 'string' ? event.result_revision : null,
      restoredFromRevisionId: typeof event.restored_from_revision_id === 'string' ? event.restored_from_revision_id : null,
    }];
  });
}

export function getYjsWebsocketUrl(mcpUrl: string): string {
  const url = new URL(mcpUrl);
  if (url.protocol === 'http:') url.protocol = 'ws:';
  else if (url.protocol === 'https:') url.protocol = 'wss:';
  else throw new Error(`Unsupported MCP URL protocol for Yjs observation: ${url.protocol}`);
  url.pathname = '/ws';
  url.search = '';
  url.hash = '';
  return url.toString().replace(/\/$/u, '');
}

export function readYjsNodePositions(doc: Y.Doc, diagramId: string): Record<string, YjsNodePosition> {
  const positions = diagramMap(doc, diagramId)?.get(DIAGRAM_NODE_POSITIONS_KEY);
  const nodePositions: Record<string, YjsNodePosition> = {};
  if (positions instanceof Y.Map) {
    for (const [nodeId, value] of positions.entries()) {
      if (isNodePosition(value)) nodePositions[nodeId] = { x: value.x, y: value.y };
    }
  }
  return nodePositions;
}

export function readYjsSessionSnapshot(doc: Y.Doc, diagramId: string): YjsSessionSnapshot {
  const diagram = diagramMap(doc, diagramId);
  if (!diagram) return { activity: activitySnapshot(doc), exists: false, mermaidText: null, nodePositions: {} };

  const mermaid = diagram.get(DIAGRAM_MERMAID_TEXT_KEY);

  return {
    activity: activitySnapshot(doc),
    exists: true,
    mermaidText: mermaid instanceof Y.Text ? mermaid.toString() : null,
    nodePositions: readYjsNodePositions(doc, diagramId),
  };
}

/**
 * A diagram restore is one source/layout state transition. Document updates
 * that only persist participant metadata must not count as another restore.
 */
export function getYjsSourceLayoutSignature(snapshot: YjsSessionSnapshot): string {
  return JSON.stringify({ mermaidText: snapshot.mermaidText, nodePositions: snapshot.nodePositions });
}

export function getYjsSessionSnapshotSignature(snapshot: YjsSessionSnapshot): string {
  return JSON.stringify(snapshot);
}

export function getYjsSourceLayoutTransitions(
  appearances: readonly YjsSessionSnapshotAppearance[],
): YjsSessionSnapshotAppearance[] {
  let previousSignature: string | null = null;
  return appearances.filter((appearance) => {
    const signature = getYjsSourceLayoutSignature(appearance.snapshot);
    if (signature === previousSignature) {
      return false;
    }
    previousSignature = signature;
    return true;
  });
}

export function trackYjsSessionSnapshot(doc: Y.Doc, diagramId: string): YjsSessionSnapshotHistory {
  const appearances: YjsSessionSnapshotAppearance[] = [];
  const listeners = new Set<(appearance: YjsSessionSnapshotAppearance) => void>();
  let destroyed = false;
  let update = 0;

  const record = () => {
    const appearance = { snapshot: readYjsSessionSnapshot(doc, diagramId), update };
    appearances.push(appearance);
    listeners.forEach((listener) => { listener(appearance); });
  };
  const onUpdate = () => {
    update += 1;
    record();
  };
  doc.on('update', onUpdate);
  record();

  return {
    get appearances() {
      return appearances;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      doc.off('update', onUpdate);
      listeners.clear();
    },
    async expectUnchangedFor(durationMs, description) {
      if (destroyed) throw new Error('Cannot observe a destroyed Yjs snapshot history.');
      const baseline = appearances.at(-1);
      if (!baseline) throw new Error('Yjs snapshot history has no baseline appearance.');
      const baselineSignature = getYjsSessionSnapshotSignature(baseline.snapshot);
      await new Promise<void>((resolve, reject) => {
        const onAppearance = (appearance: YjsSessionSnapshotAppearance) => {
          if (getYjsSessionSnapshotSignature(appearance.snapshot) === baselineSignature) {
            return;
          }
          cleanup();
          reject(new Error(`Yjs session changed during ${description}: baseline=${JSON.stringify(baseline.snapshot)} next=${JSON.stringify(appearance.snapshot)}`));
        };
        const timeout = setTimeout(() => {
          cleanup();
          resolve();
        }, durationMs);
        const cleanup = () => {
          clearTimeout(timeout);
          listeners.delete(onAppearance);
        };
        listeners.add(onAppearance);
      });
    },
  };
}

export function trackYjsNodePosition(
  doc: Y.Doc,
  diagramId: string,
  nodeId: string,
): YjsNodePositionHistory {
  const appearances: YjsNodePositionAppearance[] = [];
  const appearanceListeners = new Set<(appearance: YjsNodePositionAppearance) => void>();
  let destroyed = false;
  let update = 0;

  const recordIfPresent = () => {
    const position = readYjsNodePositions(doc, diagramId)[nodeId];
    if (!position) return;
    const appearance = { position, update };
    appearances.push(appearance);
    appearanceListeners.forEach((listener) => { listener(appearance); });
  };
  const onUpdate = () => {
    update += 1;
    recordIfPresent();
  };
  doc.on('update', onUpdate);
  recordIfPresent();

  return {
    get appearances() {
      return appearances;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      doc.off('update', onUpdate);
      appearanceListeners.clear();
    },
    async expectAbsentFor(durationMs, description) {
      if (destroyed) throw new Error('Cannot observe a destroyed Yjs node-position history.');
      if (appearances.length > 0) {
        throw new Error(`Yjs node position appeared before ${description}: ${JSON.stringify(appearances)}`);
      }

      await new Promise<void>((resolve, reject) => {
        const onAppearance = (appearance: YjsNodePositionAppearance) => {
          cleanup();
          reject(new Error(`Yjs node position appeared during ${description}: ${JSON.stringify(appearance)}`));
        };
        const timeout = setTimeout(() => {
          cleanup();
          resolve();
        }, durationMs);
        const cleanup = () => {
          clearTimeout(timeout);
          appearanceListeners.delete(onAppearance);
        };
        appearanceListeners.add(onAppearance);
      });
    },
    hasAppeared() {
      return appearances.length > 0;
    },
  };
}

async function waitForInitialSync(provider: WebsocketProvider, timeoutMs: number): Promise<void> {
  if (provider.synced) return;
  await new Promise<void>((resolve, reject) => {
    const cleanup = () => {
      clearTimeout(timeout);
      provider.off('sync', onSync);
      provider.off('connection-error', onConnectionError);
    };
    const onSync = (synced: boolean) => {
      if (!synced) return;
      cleanup();
      resolve();
    };
    const onConnectionError = (event: Event) => {
      cleanup();
      reject(new Error(`Yjs observer connection failed: ${event.type}`));
    };
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Yjs observer did not complete its initial sync within ${timeoutMs}ms.`));
    }, timeoutMs);
    provider.on('sync', onSync);
    provider.on('connection-error', onConnectionError);
  });
}

export async function openYjsSessionObserver(
  mcpUrl: string,
  sessionId: string,
  { cookie, origin, timeoutMs = 15_000 }: YjsSessionObserverOptions = {},
): Promise<YjsSessionObserver> {
  const doc = new Y.Doc();
  const WebSocketPolyfill = cookie
    ? class CookieWebSocket extends WebSocket {
      constructor(url: string | URL, protocols?: string | string[]) {
        super(url, protocols, { headers: { cookie, ...(origin ? { origin } : {}) } });
      }
    }
    : WebSocket;
  const provider = new WebsocketProvider(getYjsWebsocketUrl(mcpUrl), sessionId, doc, {
    WebSocketPolyfill: WebSocketPolyfill as unknown as typeof globalThis.WebSocket,
    disableBc: true,
  });

  try {
    await waitForInitialSync(provider, timeoutMs);
  } catch (error) {
    (provider as DestroyableWebsocketProvider).destroy();
    doc.destroy();
    throw error;
  }

  let destroyed = false;
  const nodePositionHistories = new Set<YjsNodePositionHistory>();
  const snapshotHistories = new Set<YjsSessionSnapshotHistory>();
  const observer: YjsSessionObserver = {
    diagramExists(diagramId) {
      return readYjsSessionSnapshot(doc, diagramId).exists;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      nodePositionHistories.forEach((history) => { history.destroy(); });
      nodePositionHistories.clear();
      snapshotHistories.forEach((history) => { history.destroy(); });
      snapshotHistories.clear();
      (provider as DestroyableWebsocketProvider).destroy();
      doc.destroy();
    },
    hasNodePosition(diagramId, nodeId) {
      return Object.hasOwn(readYjsNodePositions(doc, diagramId), nodeId);
    },
    snapshot(diagramId) {
      return readYjsSessionSnapshot(doc, diagramId);
    },
    trackSnapshot(diagramId) {
      if (destroyed) throw new Error('Cannot track a snapshot on a destroyed Yjs session observer.');
      const history = trackYjsSessionSnapshot(doc, diagramId);
      snapshotHistories.add(history);
      return history;
    },
    trackNodePosition(diagramId, nodeId) {
      if (destroyed) throw new Error('Cannot track a node position on a destroyed Yjs session observer.');
      const history = trackYjsNodePosition(doc, diagramId, nodeId);
      nodePositionHistories.add(history);
      return history;
    },
    async waitFor(predicate, description, waitTimeoutMs = timeoutMs) {
      if (destroyed) throw new Error('Cannot wait on a destroyed Yjs session observer.');
      if (predicate(observer)) return;

      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timeout);
          doc.off('update', onUpdate);
        };
        const onUpdate = () => {
          try {
            if (!predicate(observer)) return;
            cleanup();
            resolve();
          } catch (error) {
            cleanup();
            reject(error);
          }
        };
        const timeout = setTimeout(() => {
          cleanup();
          reject(new Error(`Yjs observer did not reach ${description} within ${waitTimeoutMs}ms.`));
        }, waitTimeoutMs);
        doc.on('update', onUpdate);
        onUpdate();
      });
    },
  };

  return observer;
}
