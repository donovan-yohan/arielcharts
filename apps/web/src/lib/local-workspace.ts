import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { isValidSessionId } from './session';
import { decodeWorkspaceBundleEnvelope, encodeWorkspaceBundle, snapshotWorkspaceBundle } from './workspace-bundle';

export const LOCAL_WORKSPACE_ID = 'local';
export const LOCAL_WORKSPACE_DATABASE = 'arielcharts.workspace.v1';
/** Non-secret recovery pointer written before a promoted browser navigates. */
export const LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY = 'arielcharts.workspace.v1.handoff';

export type LocalWorkspacePhase = 'restoring' | 'preparing' | 'ready' | 'storage-error';

export function getLocalWorkspaceLoadingCopy(phase: LocalWorkspacePhase): { eyebrow: string; title: string; detail: string } {
  switch (phase) {
    case 'restoring':
      return {
        eyebrow: 'Your device',
        title: 'Restoring work saved on this device…',
        detail: 'Nothing has been sent online.',
      };
    case 'preparing':
      return {
        eyebrow: 'Your device',
        title: 'Preparing the canvas…',
        detail: 'Your workspace is ready to edit locally.',
      };
    case 'storage-error':
      return {
        eyebrow: 'Local workspace',
        title: 'Local storage is unavailable',
        detail: 'A workspace cannot be safely saved on this device right now.',
      };
    case 'ready':
      return {
        eyebrow: 'Your device',
        title: 'Workspace ready',
        detail: 'Saved on this device.',
      };
  }
}

/** Small Awareness-compatible surface for a strictly single-browser workspace. */
export class LocalAwareness {
  readonly clientID: number;
  private readonly handlers = new Set<(...args: unknown[]) => void>();
  private readonly states = new Map<number, unknown>();

  constructor(clientID: number) {
    this.clientID = clientID;
  }

  getStates(): Map<number, unknown> {
    return this.states;
  }

  on(eventName: string, handler: (...args: unknown[]) => void): void {
    if (eventName === 'change') this.handlers.add(handler);
  }

  off(eventName: string, handler: (...args: unknown[]) => void): void {
    if (eventName === 'change') this.handlers.delete(handler);
  }

  setLocalState(state: unknown | null): void {
    if (state === null) this.states.delete(this.clientID); else this.states.set(this.clientID, state);
    this.emit();
  }

  setLocalStateField(field: string, value: unknown): void {
    const current = this.states.get(this.clientID);
    const next = current && typeof current === 'object' && !Array.isArray(current)
      ? { ...current as Record<string, unknown>, [field]: value }
      : { [field]: value };
    this.states.set(this.clientID, next);
    this.emit();
  }

  destroy(): void {
    this.states.clear();
    this.handlers.clear();
  }

  private emit(): void {
    for (const handler of this.handlers) handler();
  }
}

export type LocalWorkspacePersistence = Pick<IndexeddbPersistence, 'clearData' | 'destroy' | 'whenSynced'>;

export function createLocalWorkspacePersistence(doc: Y.Doc, name = LOCAL_WORKSPACE_DATABASE): LocalWorkspacePersistence {
  return new IndexeddbPersistence(name, doc);
}

type StorageLike = Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>;

function resolveHandoffStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/**
 * The marker deliberately contains only a session id. IndexedDB remains an
 * archive until the user explicitly removes it, so a failed navigation can
 * never turn a successful promotion into data loss.
 */
export function recordLocalWorkspaceHandoff(sessionId: string, storage?: StorageLike): void {
  if (!isValidSessionId(sessionId)) throw new Error('Cannot save an invalid online workspace handoff.');
  resolveHandoffStorage(storage)?.setItem(LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY, JSON.stringify({ session_id: sessionId }));
}

export function readLocalWorkspaceHandoff(storage?: StorageLike): string | null {
  const encoded = resolveHandoffStorage(storage)?.getItem(LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY);
  if (!encoded) return null;
  try {
    const value = JSON.parse(encoded) as { session_id?: unknown };
    return typeof value.session_id === 'string' && isValidSessionId(value.session_id) ? value.session_id : null;
  } catch {
    return null;
  }
}

/** Only an online room-access failure should clear this routing pointer. */
export function clearLocalWorkspaceHandoff(sessionId: string, storage?: StorageLike): void {
  const resolvedStorage = resolveHandoffStorage(storage);
  if (resolvedStorage && readLocalWorkspaceHandoff(resolvedStorage) === sessionId) {
    resolvedStorage.removeItem(LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY);
  }
}

export function areYjsStateVectorsEqual(left: Uint8Array, right: Uint8Array): boolean {
  return left.byteLength === right.byteLength && left.every((value, index) => value === right[index]);
}

export type LocalWorkspacePromotionResult<Room> =
  | { status: 'changed-before-request' }
  | { status: 'changed-during-request' }
  | { status: 'published'; room: Room };

/**
 * Promotion is deliberately a snapshot handoff, not a CRDT merge. A state
 * vector is checked both before sending and after receiving the room so an
 * editable local document is never silently replaced by an older snapshot.
 */
export async function publishLocalWorkspace<Room>(
  doc: Y.Doc,
  createRoom: (bundle: Awaited<ReturnType<typeof decodeWorkspaceBundleEnvelope>>) => Promise<Room>,
): Promise<LocalWorkspacePromotionResult<Room>> {
  const snapshotVector = Y.encodeStateVector(doc);
  const snapshot = snapshotWorkspaceBundle(doc);
  const encoded = await encodeWorkspaceBundle(snapshot);
  const requestVector = Y.encodeStateVector(doc);
  if (!areYjsStateVectorsEqual(snapshotVector, requestVector)) return { status: 'changed-before-request' };
  const room = await createRoom(await decodeWorkspaceBundleEnvelope(encoded));
  if (!areYjsStateVectorsEqual(requestVector, Y.encodeStateVector(doc))) return { status: 'changed-during-request' };
  return { status: 'published', room };
}

/** Persist recovery before attempting a navigation that might be interrupted. */
export function completeLocalWorkspacePromotion<Room extends { sessionId: string }>(
  room: Room,
  navigate: (room: Room) => void,
  recordHandoff: (sessionId: string) => void = recordLocalWorkspaceHandoff,
): void {
  recordHandoff(room.sessionId);
  navigate(room);
}
