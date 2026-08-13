import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  checkRoomAccess,
  clearRoomKeyFragment,
  createRoom,
  exchangeRoomKey,
  getMcpRoomBearer,
  getRoomReferencePath,
  getRoomSharePath,
  getRoomShareUrl,
  parseRoomReference,
  readRoomKeyFragment,
  RoomAccessApiError,
  rotateRoomKey,
} from './room-access-api';
import { getServerHttpUrl } from './session';

const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

describe('room access API', () => {
  it('creates a room and returns its generated credentials', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ session_id: 'abc123de', room_key: 'raw key' }), { status: 201 }));

    await expect(createRoom()).resolves.toEqual({ sessionId: 'abc123de', roomKey: 'raw key' });
    expect(fetchMock).toHaveBeenCalledWith(`${getServerHttpUrl()}/api/rooms`, {
      credentials: 'include',
      method: 'POST',
      signal: undefined,
    });
  });

  it('sends a local workspace snapshot only when publishing it into a new room', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ session_id: 'abc123de', room_key: 'raw key' }), { status: 201 }));
    const bundle = {
      format: 'arielcharts.workspace' as const,
      version: 1 as const,
      integrity: { algorithm: 'SHA-256' as const, value: 'a'.repeat(64) },
      payload: { schema_version: 1 as const, order: [], diagrams: [] },
    };
    await createRoom(bundle);
    expect(fetchMock).toHaveBeenCalledWith(`${getServerHttpUrl()}/api/rooms`, expect.objectContaining({
      body: JSON.stringify({ bundle }),
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      method: 'POST',
    }));
  });

  it('includes browser credentials on access checks, key exchange, and rotation', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ room_key: 'replacement' }), { status: 200 }));

    await checkRoomAccess('abc123de');
    await exchangeRoomKey('abc123de', 'raw key');
    await expect(rotateRoomKey('abc123de')).resolves.toBe('replacement');

    expect(fetchMock.mock.calls).toEqual([
      [`${getServerHttpUrl()}/api/rooms/abc123de/access`, { credentials: 'include', signal: undefined }],
      [`${getServerHttpUrl()}/api/rooms/abc123de/access`, {
        body: JSON.stringify({ room_key: 'raw key' }),
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        method: 'POST',
        signal: undefined,
      }],
      [`${getServerHttpUrl()}/api/rooms/abc123de/rotate`, { credentials: 'include', method: 'POST', signal: undefined }],
    ]);
  });

  it('keeps failures generic instead of exposing backend details', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ error: 'secret internal detail' }), { status: 401 }));

    await expect(checkRoomAccess('abc123de')).rejects.toEqual(
      expect.objectContaining<Partial<RoomAccessApiError>>({ message: 'Room access could not be verified.', status: 401 }),
    );
  });
});

describe('room access URL helpers', () => {
  it('puts an encoded raw key in a fragment, never a query parameter', () => {
    expect(getRoomSharePath('abc123de', 'space /? key')).toBe('/s/abc123de#roomKey=space%20%2F%3F%20key');
    expect(getRoomShareUrl('https://charts.test/base', 'abc123de', 'space /? key')).toBe('https://charts.test/s/abc123de#roomKey=space%20%2F%3F%20key');
    expect(getRoomSharePath('abc123de', 'secret')).not.toContain('?');
  });

  it('reads a fragment once and clears it without losing unrelated query state', () => {
    const replaceState = vi.fn();
    expect(readRoomKeyFragment('#roomKey=space%20key')).toBe('space key');
    clearRoomKeyFragment(
      { hash: '#roomKey=space%20key', pathname: '/s/abc123de', search: '?view=fit' } as Location,
      { replaceState, state: { navigation: true } } as unknown as History,
    );
    expect(replaceState).toHaveBeenCalledWith({ navigation: true }, '', '/s/abc123de?view=fit');
  });

  it('accepts an ID, relative share path, or full share URL', () => {
    expect(parseRoomReference('ABC123DE')).toEqual({ sessionId: 'abc123de', roomKey: null });
    expect(parseRoomReference('/s/abc123de#roomKey=raw%20key')).toEqual({ sessionId: 'abc123de', roomKey: 'raw key' });
    const full = parseRoomReference('https://charts.test/s/abc123de#roomKey=raw%20key');
    expect(full).toEqual({ sessionId: 'abc123de', roomKey: 'raw key' });
    expect(full && getRoomReferencePath(full)).toBe('/s/abc123de#roomKey=raw%20key');
    expect(parseRoomReference('/s/abc123de?roomKey=must-not-be-used')).toEqual({ sessionId: 'abc123de', roomKey: null });
    expect(parseRoomReference('https://charts.test/not-a-room')).toBeNull();
    expect(parseRoomReference('/s/%E0%A4%A')).toBeNull();
  });

  it('derives the strict MCP bearer without changing the pasteable key', () => {
    expect(getMcpRoomBearer('abc123de', 'raw-key')).toBe('abc123de.raw-key');
  });
});
