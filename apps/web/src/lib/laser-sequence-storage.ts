const LASER_SEQUENCE_STORAGE_PREFIX = 'arielcharts.laser-sequence.v1:';

type SessionStorageLike = Pick<Storage, 'getItem' | 'setItem'> | null;
type SessionStorageOwner = { sessionStorage: Storage };

function storageKey(sessionId: string, clientId: number): string {
  return `${LASER_SEQUENCE_STORAGE_PREFIX}${sessionId}:${clientId}`;
}

export function getSafeSessionStorage(owner: SessionStorageOwner): Storage | null {
  try { return owner.sessionStorage; } catch { return null; }
}

/**
 * This is a local reconnect hint only. The server remains the authority on
 * ownership and stale ordering, so cloned browser storage cannot claim a peer.
 */
export function readLaserSequenceHighWater(storage: SessionStorageLike, sessionId: string, clientId: number): number {
  if (!storage || !Number.isSafeInteger(clientId) || clientId < 0) return 0;
  let raw: string | null;
  try { raw = storage.getItem(storageKey(sessionId, clientId)); } catch { return 0; }
  if (raw === null || !/^\d+$/u.test(raw)) return 0;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= 0 && value < Number.MAX_SAFE_INTEGER ? value : 0;
}

export function writeLaserSequenceHighWater(storage: SessionStorageLike, sessionId: string, clientId: number, sequence: number): void {
  if (!storage || !Number.isSafeInteger(clientId) || clientId < 0 || !Number.isSafeInteger(sequence) || sequence < 0 || sequence >= Number.MAX_SAFE_INTEGER) return;
  try { storage.setItem(storageKey(sessionId, clientId), String(sequence)); } catch { /* browser storage is optional reconnect state */ }
}
