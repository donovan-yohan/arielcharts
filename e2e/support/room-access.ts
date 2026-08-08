import { assert } from './assert.ts';

export type RoomCredentials = {
  roomKey: string;
  sessionId: string;
};

export type RoomAccess = RoomCredentials & {
  cookie: string;
};

function roomUrl(serverUrl: string, path: string): URL {
  return new URL(path, serverUrl);
}

async function responseBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function cookieFrom(response: Response, description: string, sessionId: string): string {
  const headers = response.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies = headers.getSetCookie?.() ?? [response.headers.get('set-cookie')].filter((value): value is string => Boolean(value));
  const expectedName = `arielcharts_room_${sessionId}=`;
  const roomCookies = setCookies.filter((setCookie) => setCookie.startsWith(expectedName));
  assert(roomCookies.length === 1, `${description} did not set exactly one room access cookie for ${sessionId}.`);
  const cookie = roomCookies[0]?.split(';', 1)[0];
  assert(cookie && cookie.includes('='), `${description} returned an invalid room access cookie.`);
  return cookie;
}

function roomCredentials(payload: unknown, description: string): RoomCredentials {
  const candidate = payload as Partial<{ room_key: unknown; session_id: unknown }>;
  assert(typeof candidate.session_id === 'string' && candidate.session_id.length > 0,
    `${description} omitted a session_id.`);
  assert(typeof candidate.room_key === 'string' && candidate.room_key.length > 0,
    `${description} omitted a room_key.`);
  return { roomKey: candidate.room_key, sessionId: candidate.session_id };
}

export function roomShareUrl(baseUrl: string, credentials: RoomCredentials): string {
  const url = new URL(`/s/${encodeURIComponent(credentials.sessionId)}`, baseUrl);
  url.hash = `roomKey=${encodeURIComponent(credentials.roomKey)}`;
  return url.toString();
}

export async function createRoom(serverUrl: string, origin: string): Promise<RoomCredentials> {
  const response = await fetch(roomUrl(serverUrl, '/api/rooms'), {
    headers: { origin },
    method: 'POST',
  });
  if (response.status !== 201) {
    throw new Error(`Room creation returned ${response.status}: ${await responseBody(response)}`);
  }
  assert(response.headers.get('cache-control')?.includes('no-store'),
    'Room creation must return Cache-Control: no-store.');
  return roomCredentials(await response.json(), 'Room creation');
}

export async function exchangeRoomAccess(
  serverUrl: string,
  origin: string,
  credentials: RoomCredentials,
): Promise<RoomAccess> {
  const response = await fetch(roomUrl(serverUrl, `/api/rooms/${encodeURIComponent(credentials.sessionId)}/access`), {
    body: JSON.stringify({ room_key: credentials.roomKey }),
    headers: { 'content-type': 'application/json', origin },
    method: 'POST',
  });
  if (response.status !== 204) {
    throw new Error(`Room access exchange returned ${response.status}: ${await responseBody(response)}`);
  }
  return { ...credentials, cookie: cookieFrom(response, 'Room access exchange', credentials.sessionId) };
}

export async function getRoomAccess(
  serverUrl: string,
  origin: string,
  sessionId: string,
  cookie?: string,
): Promise<Response> {
  return fetch(roomUrl(serverUrl, `/api/rooms/${encodeURIComponent(sessionId)}/access`), {
    headers: { ...(cookie ? { cookie } : {}), origin },
  });
}

export async function rotateRoomAccess(
  serverUrl: string,
  origin: string,
  access: RoomAccess,
): Promise<RoomAccess> {
  const response = await fetch(roomUrl(serverUrl, `/api/rooms/${encodeURIComponent(access.sessionId)}/rotate`), {
    headers: { cookie: access.cookie, origin },
    method: 'POST',
  });
  if (response.status !== 200) {
    throw new Error(`Room key rotation returned ${response.status}: ${await responseBody(response)}`);
  }
  const payload = await response.json() as Partial<{ room_key: unknown }>;
  assert(typeof payload.room_key === 'string' && payload.room_key.length > 0,
    'Room key rotation omitted a room_key.');
  return { sessionId: access.sessionId, roomKey: payload.room_key, cookie: cookieFrom(response, 'Room key rotation', access.sessionId) };
}
