import { getServerHttpUrl, isValidSessionId } from './session';

export type CreatedRoom = {
  roomKey: string;
  sessionId: string;
};

export class RoomAccessApiError extends Error {
  constructor(readonly status: number) {
    super('Room access could not be verified.');
    this.name = 'RoomAccessApiError';
  }
}

function getRoomApiPath(sessionId: string): string {
  return `${getServerHttpUrl()}/api/rooms/${encodeURIComponent(sessionId)}`;
}

async function requireOk(response: Response): Promise<void> {
  if (!response.ok) {
    throw new RoomAccessApiError(response.status);
  }
}

async function readRoomCredentials(response: Response): Promise<CreatedRoom> {
  await requireOk(response);
  const body = await response.json().catch(() => null) as { room_key?: unknown; session_id?: unknown } | null;
  if (
    typeof body?.session_id !== 'string'
    || !isValidSessionId(body.session_id)
    || typeof body.room_key !== 'string'
    || body.room_key.length === 0
  ) {
    throw new RoomAccessApiError(response.status);
  }
  return { roomKey: body.room_key, sessionId: body.session_id };
}

export async function createRoom(signal?: AbortSignal): Promise<CreatedRoom> {
  const response = await fetch(`${getServerHttpUrl()}/api/rooms`, {
    credentials: 'include',
    method: 'POST',
    signal,
  });
  return readRoomCredentials(response);
}

export async function checkRoomAccess(sessionId: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${getRoomApiPath(sessionId)}/access`, {
    credentials: 'include',
    signal,
  });
  await requireOk(response);
}

export async function exchangeRoomKey(sessionId: string, roomKey: string, signal?: AbortSignal): Promise<void> {
  const response = await fetch(`${getRoomApiPath(sessionId)}/access`, {
    body: JSON.stringify({ room_key: roomKey }),
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal,
  });
  await requireOk(response);
}

export async function rotateRoomKey(sessionId: string, signal?: AbortSignal): Promise<string> {
  const response = await fetch(`${getRoomApiPath(sessionId)}/rotate`, {
    credentials: 'include',
    method: 'POST',
    signal,
  });
  await requireOk(response);
  const body = await response.json().catch(() => null) as { room_key?: unknown } | null;
  if (typeof body?.room_key !== 'string' || body.room_key.length === 0) {
    throw new RoomAccessApiError(response.status);
  }
  return body.room_key;
}

export function getRoomSharePath(sessionId: string, roomKey: string): string {
  return `${getSessionRoomPath(sessionId)}#roomKey=${encodeURIComponent(roomKey)}`;
}

export function getRoomShareUrl(origin: string, sessionId: string, roomKey: string): string {
  const url = new URL(getSessionRoomPath(sessionId), origin);
  url.hash = `roomKey=${encodeURIComponent(roomKey)}`;
  return url.toString();
}

function getSessionRoomPath(sessionId: string): string {
  return `/s/${encodeURIComponent(sessionId)}`;
}

export function readRoomKeyFragment(hash: string): string | null {
  const fragment = hash.startsWith('#') ? hash.slice(1) : hash;
  const roomKey = new URLSearchParams(fragment).get('roomKey');
  return roomKey && roomKey.length > 0 ? roomKey : null;
}

export function clearRoomKeyFragment(
  location: Pick<Location, 'hash' | 'pathname' | 'search'>,
  history: Pick<History, 'replaceState' | 'state'>,
): void {
  if (readRoomKeyFragment(location.hash) === null) {
    return;
  }
  history.replaceState(history.state, '', `${location.pathname}${location.search}`);
}

export type RoomReference = {
  roomKey: string | null;
  sessionId: string;
};

export function parseRoomReference(value: string, baseOrigin = 'https://arielcharts.invalid'): RoomReference | null {
  const trimmed = value.trim();
  if (isValidSessionId(trimmed.toLowerCase())) {
    return { roomKey: null, sessionId: trimmed.toLowerCase() };
  }

  let url: URL;
  try {
    url = new URL(trimmed, baseOrigin);
  } catch {
    return null;
  }
  const match = url.pathname.match(/^\/s\/([^/]+)\/?$/u);
  if (!match) {
    return null;
  }
  let sessionId: string;
  try {
    sessionId = decodeURIComponent(match[1] ?? '').toLowerCase();
  } catch {
    return null;
  }
  if (!isValidSessionId(sessionId)) {
    return null;
  }
  return { roomKey: readRoomKeyFragment(url.hash), sessionId };
}

export function getRoomReferencePath(reference: RoomReference): string {
  return reference.roomKey
    ? getRoomSharePath(reference.sessionId, reference.roomKey)
    : getSessionRoomPath(reference.sessionId);
}

export function getMcpRoomBearer(sessionId: string, roomKey: string): string {
  return `${sessionId}.${roomKey}`;
}
