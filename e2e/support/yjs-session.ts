import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import * as Y from 'yjs';

const DIAGRAMS_KEY = 'diagrams';
const DIAGRAM_MERMAID_TEXT_KEY = 'mermaid';
const DIAGRAM_NODE_POSITIONS_KEY = 'nodePositions';

export type YjsNodePosition = {
  x: number;
  y: number;
};

export type YjsSessionSnapshot = {
  exists: boolean;
  mermaidText: string | null;
  nodePositions: Record<string, YjsNodePosition>;
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
  trackNodePosition(diagramId: string, nodeId: string): YjsNodePositionHistory;
  waitFor(
    predicate: (observer: YjsSessionObserver) => boolean,
    description: string,
    timeoutMs?: number,
  ): Promise<void>;
};

type DestroyableWebsocketProvider = WebsocketProvider & { destroy(): void };

function diagramMap(doc: Y.Doc, diagramId: string): Y.Map<unknown> | null {
  const diagram = doc.getMap<Y.Map<unknown>>(DIAGRAMS_KEY).get(diagramId);
  return diagram instanceof Y.Map ? diagram : null;
}

function isNodePosition(value: unknown): value is YjsNodePosition {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<YjsNodePosition>;
  return Number.isFinite(candidate.x) && Number.isFinite(candidate.y);
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

export function readYjsSessionSnapshot(doc: Y.Doc, diagramId: string): YjsSessionSnapshot {
  const diagram = diagramMap(doc, diagramId);
  if (!diagram) return { exists: false, mermaidText: null, nodePositions: {} };

  const mermaid = diagram.get(DIAGRAM_MERMAID_TEXT_KEY);
  const positions = diagram.get(DIAGRAM_NODE_POSITIONS_KEY);
  const nodePositions: Record<string, YjsNodePosition> = {};
  if (positions instanceof Y.Map) {
    for (const [nodeId, value] of positions.entries()) {
      if (isNodePosition(value)) nodePositions[nodeId] = { x: value.x, y: value.y };
    }
  }

  return {
    exists: true,
    mermaidText: mermaid instanceof Y.Text ? mermaid.toString() : null,
    nodePositions,
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
    const position = readYjsSessionSnapshot(doc, diagramId).nodePositions[nodeId];
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
  timeoutMs = 15_000,
): Promise<YjsSessionObserver> {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(getYjsWebsocketUrl(mcpUrl), sessionId, doc, {
    WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
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
  const histories = new Set<YjsNodePositionHistory>();
  const observer: YjsSessionObserver = {
    diagramExists(diagramId) {
      return readYjsSessionSnapshot(doc, diagramId).exists;
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      histories.forEach((history) => { history.destroy(); });
      histories.clear();
      (provider as DestroyableWebsocketProvider).destroy();
      doc.destroy();
    },
    hasNodePosition(diagramId, nodeId) {
      return Object.hasOwn(readYjsSessionSnapshot(doc, diagramId).nodePositions, nodeId);
    },
    snapshot(diagramId) {
      return readYjsSessionSnapshot(doc, diagramId);
    },
    trackNodePosition(diagramId, nodeId) {
      if (destroyed) throw new Error('Cannot track a node position on a destroyed Yjs session observer.');
      const history = trackYjsNodePosition(doc, diagramId, nodeId);
      histories.add(history);
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
