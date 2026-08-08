import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { IncomingMessage } from 'node:http';
import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadServerEnv } from './env.js';
import { SessionStore } from './persistence.js';
import { RoomAccessService } from './room-access.js';
import { SessionManager } from './session-manager.js';

function request(headers: Record<string, string | string[]> = {}, address = '203.0.113.7'): IncomingMessage {
  return { headers, socket: { remoteAddress: address } } as unknown as IncomingMessage;
}

describe('RoomAccessService', () => {
  let dataDir: string;
  let store: SessionStore;

  beforeEach(async () => {
    dataDir = await mkdtemp(join(tmpdir(), 'arielcharts-room-access-'));
    store = new SessionStore(dataDir);
  });

  afterEach(async () => {
    await store.close();
    await rm(dataDir, { recursive: true, force: true });
  });

  it('stores only a verifier, creates protected sessions atomically, rejects collisions, and deletes access with a room', async () => {
    const access = new RoomAccessService(store, { cryptoProfile: 'test', cookieSecret: 'test-secret' });
    const manager = new SessionManager(store);
    const grant = await access.createGrant();
    expect(grant.roomKey).toMatch(/^[A-Za-z0-9_-]{43}$/u);

    await manager.createProtectedSession('abc123de', grant.record);
    const record = await store.getRoomAccess('abc123de');
    expect(record).toEqual(expect.objectContaining({ accessVersion: 1, salt: expect.any(String), verifier: expect.any(String) }));
    expect(JSON.stringify(record)).not.toContain(grant.roomKey);
    expect(JSON.stringify(await manager.readSession('abc123de'))).not.toContain(grant.roomKey);
    expect(JSON.stringify((await manager.getOrCreateSession('abc123de')).doc.toJSON())).not.toContain(grant.roomKey);
    await expect(manager.createProtectedSession('abc123de', (await access.createGrant()).record)).rejects.toThrow('Session already exists');
    await expect(manager.requireSession('missing1')).rejects.toThrow('Session not found');
    expect(await store.get('missing1')).toBeNull();

    await store.delete('abc123de');
    expect(await store.getRoomAccess('abc123de')).toBeNull();
  });

  it('uses generic failures for wrong and nonexistent keys, signs room-scoped expiring cookies, and validates derived MCP bearers', async () => {
    let now = 1_000;
    const access = new RoomAccessService(store, { cryptoProfile: 'test', cookieSecret: 'test-secret', cookieTtlMs: 1_000, now: () => now });
    const grant = await access.createGrant();
    await store.setRoomAccess('abc123de', grant.record);

    await expect(access.authenticateRoomKey('abc123de', 'invalid', request())).rejects.toMatchObject({ status: 401, message: 'Room access denied.' });
    await expect(access.authenticateRoomKey('missing1', 'invalid', request())).rejects.toMatchObject({ status: 401, message: 'Room access denied.' });
    await expect(access.authenticateBearer(request({ authorization: `Bearer abc123de.${grant.roomKey}` }))).resolves.toEqual({ sessionId: 'abc123de', accessVersion: 1 });
    await expect(access.authenticateBearer(request({ authorization: `Bearer abc123de-${grant.roomKey}` }))).rejects.toMatchObject({ status: 401 });

    const cookie = access.browserCookieHeaders('abc123de', 1)['set-cookie'] as string;
    const cookiePair = cookie.split(';')[0]!;
    expect(cookie).toMatch(/^arielcharts_room_abc123de=[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+; Max-Age=1; Path=\/; HttpOnly; SameSite=Lax$/u);
    expect(cookie.split('; ').filter((attribute) => attribute === 'Path=/')).toHaveLength(1);
    await expect(access.authenticateBrowserCookie('abc123de', request({ cookie: cookiePair }))).resolves.toEqual({ sessionId: 'abc123de', accessVersion: 1 });
    const tamperedCookie = `${cookiePair.slice(0, -1)}${cookiePair.endsWith('a') ? 'b' : 'a'}`;
    await expect(access.authenticateBrowserCookie('abc123de', request({ cookie: tamperedCookie }))).rejects.toMatchObject({ status: 401 });
    const rotated = await access.rotate('abc123de', 1);
    expect(rotated.record).toEqual(expect.objectContaining({ accessVersion: 2, createdAt: grant.record.createdAt }));
    await expect(access.authenticateBearer(request({ authorization: `Bearer abc123de.${grant.roomKey}` }))).rejects.toMatchObject({ status: 401 });
    await expect(access.authenticateBearer(request({ authorization: `Bearer abc123de.${rotated.roomKey}` }))).resolves.toEqual({ sessionId: 'abc123de', accessVersion: 2 });
    await expect(access.authenticateBrowserCookie('abc123de', request({ cookie: cookiePair }))).rejects.toMatchObject({ status: 401 });
    const rotatedCookiePair = (access.browserCookieHeaders('abc123de', 2)['set-cookie'] as string).split(';')[0]!;
    await expect(access.authenticateBrowserCookie('abc123de', request({ cookie: rotatedCookiePair }))).resolves.toEqual({ sessionId: 'abc123de', accessVersion: 2 });
    now += 1_001;
    await expect(access.authenticateBrowserCookie('abc123de', request({ cookie: rotatedCookiePair }))).rejects.toMatchObject({ status: 401 });
    const secureAccess = new RoomAccessService(store, { cryptoProfile: 'test', cookieSecret: 'test-secret', secureCookie: true, sameSite: 'None' });
    expect(secureAccess.browserCookieHeaders('abc123de', 1)['set-cookie']).toContain('SameSite=None; Secure');
  });

  it('coalesces and bounds successful bearer proofs without weakening rotation', async () => {
    let derivations = 0;
    const derive = async (key: string, salt: string) => {
      derivations += 1;
      await new Promise<void>((resolve) => setImmediate(resolve));
      return createHash('sha512').update(key).update('\u0000').update(salt).digest();
    };
    const access = new RoomAccessService(store, { cookieSecret: 'test-secret', derive, maxBearerProofs: 2 });
    const first = await access.createGrant();
    const second = await access.createGrant();
    const third = await access.createGrant();
    await store.setRoomAccess('abc123de', first.record);
    await store.setRoomAccess('second12', second.record);
    await store.setRoomAccess('third123', third.record);
    derivations = 0;

    const firstBearer = `Bearer abc123de.${first.roomKey}`;
    await access.authenticateBearer(request({ authorization: firstBearer }));
    await access.authenticateBearer(request({ authorization: firstBearer }));
    expect(derivations).toBe(1);

    const secondBearer = `Bearer second12.${second.roomKey}`;
    await Promise.all(Array.from({ length: 6 }, () => access.authenticateBearer(request({ authorization: secondBearer }))));
    expect(derivations).toBe(2);

    await access.authenticateBearer(request({ authorization: `Bearer third123.${third.roomKey}` }));
    await access.authenticateBearer(request({ authorization: firstBearer }));
    expect(derivations).toBe(4);

    const rotated = await access.rotate('abc123de', 1);
    const afterRotation = derivations;
    await expect(access.authenticateBearer(request({ authorization: firstBearer }))).rejects.toMatchObject({ status: 401 });
    expect(derivations).toBe(afterRotation + 1);
    await expect(access.authenticateBearer(request({ authorization: `Bearer abc123de.${rotated.roomKey}` }))).resolves.toEqual({ sessionId: 'abc123de', accessVersion: 2 });
  });

  it('rejects attempts before derivation after the room or IP bucket is exhausted', async () => {
    let derivations = 0;
    const access = new RoomAccessService(store, {
      cookieSecret: 'test-secret',
      derive: async () => {
        derivations += 1;
        return Buffer.alloc(64);
      },
    });
    for (let index = 0; index < 8; index += 1) {
      await expect(access.authenticateRoomKey('missing1', 'invalid', request())).rejects.toMatchObject({ status: 401 });
    }
    expect(derivations).toBe(8);
    await expect(access.authenticateRoomKey('missing1', 'invalid', request())).rejects.toMatchObject({ status: 429, retryAfterSeconds: expect.any(Number) });
    expect(derivations).toBe(8);

    let bearerDerivations = 0;
    const bearerAccess = new RoomAccessService(store, {
      cookieSecret: 'test-secret',
      derive: async () => {
        bearerDerivations += 1;
        return Buffer.alloc(64);
      },
    });
    const invalidBearer = `Bearer missing1.${'x'.repeat(43)}`;
    for (let index = 0; index < 8; index += 1) {
      await expect(bearerAccess.authenticateBearer(request({ authorization: invalidBearer }))).rejects.toMatchObject({ status: 401 });
    }
    await expect(bearerAccess.authenticateBearer(request({ authorization: invalidBearer }))).rejects.toMatchObject({ status: 429 });
    expect(bearerDerivations).toBe(8);

    let rotatingDerivations = 0;
    const rotatingAccess = new RoomAccessService(store, {
      cookieSecret: 'test-secret',
      derive: async () => {
        rotatingDerivations += 1;
        return Buffer.alloc(64);
      },
    });
    for (let index = 0; index < 20; index += 1) {
      const id = `missing${index.toString().padStart(2, '0')}`;
      await expect(rotatingAccess.authenticateRoomKey(id, 'invalid', request())).rejects.toMatchObject({ status: 401 });
    }
    expect(rotatingDerivations).toBe(20);
    await expect(rotatingAccess.authenticateRoomKey('missingzz', 'invalid', request())).rejects.toMatchObject({ status: 429, retryAfterSeconds: expect.any(Number) });
    expect(rotatingDerivations).toBe(20);
  });

  it('does not let spoofed X-Forwarded-For values bypass creation, room-key, or bearer IP limits', async () => {
    const socketAddress = '203.0.113.7';
    const creationAccess = new RoomAccessService(store, { cookieSecret: 'test-secret' });
    for (let index = 0; index < 5; index += 1) {
      expect(() => creationAccess.allowRoomCreation(request({ 'x-forwarded-for': `198.51.100.${index}` }, socketAddress))).not.toThrow();
    }
    expect(() => creationAccess.allowRoomCreation(request({ 'x-forwarded-for': '198.51.100.99' }, socketAddress))).toThrow('Room access denied.');

    const roomKeyAccess = new RoomAccessService(store, {
      cookieSecret: 'test-secret',
      derive: async () => Buffer.alloc(64),
    });
    for (let index = 0; index < 20; index += 1) {
      await expect(roomKeyAccess.authenticateRoomKey(`missing${index.toString().padStart(2, '0')}`, 'invalid', request({ 'x-forwarded-for': `198.51.100.${index}` }, socketAddress))).rejects.toMatchObject({ status: 401 });
    }
    await expect(roomKeyAccess.authenticateRoomKey('missingzz', 'invalid', request({ 'x-forwarded-for': '198.51.100.99' }, socketAddress))).rejects.toMatchObject({ status: 429 });

    const bearerAccess = new RoomAccessService(store, {
      cookieSecret: 'test-secret',
      derive: async () => Buffer.alloc(64),
    });
    for (let index = 0; index < 20; index += 1) {
      const sessionId = `missing${index.toString().padStart(2, '0')}`;
      await expect(bearerAccess.authenticateBearer(request({ authorization: `Bearer ${sessionId}.${'x'.repeat(43)}`, 'x-forwarded-for': `198.51.100.${index}` }, socketAddress))).rejects.toMatchObject({ status: 401 });
    }
    await expect(bearerAccess.authenticateBearer(request({ authorization: `Bearer missingzz.${'x'.repeat(43)}`, 'x-forwarded-for': '198.51.100.99' }, socketAddress))).rejects.toMatchObject({ status: 429 });
  });

  it('uses only one valid Fly-Client-IP and falls back safely for missing, invalid, or multi-value headers', () => {
    const flyAddress = '198.51.100.42';
    const flyAccess = new RoomAccessService(store, { cookieSecret: 'test-secret', clientAddressProfile: 'fly' });
    for (let index = 0; index < 5; index += 1) {
      expect(() => flyAccess.allowRoomCreation(request({
        'fly-client-ip': flyAddress,
        'x-forwarded-for': `203.0.113.${index}`,
      }, `10.0.0.${index + 1}`))).not.toThrow();
    }
    expect(() => flyAccess.allowRoomCreation(request({ 'fly-client-ip': flyAddress, 'x-forwarded-for': '203.0.113.99' }, '10.0.0.99'))).toThrow('Room access denied.');

    const expectSocketFallback = (headersFor: (index: number) => Record<string, string | string[]>) => {
      const access = new RoomAccessService(store, { cookieSecret: 'test-secret', clientAddressProfile: 'fly' });
      for (let index = 0; index < 5; index += 1) {
        expect(() => access.allowRoomCreation(request(headersFor(index), '203.0.113.55'))).not.toThrow();
      }
      expect(() => access.allowRoomCreation(request(headersFor(99), '203.0.113.55'))).toThrow('Room access denied.');
    };

    expectSocketFallback((index) => ({ 'x-forwarded-for': `198.51.100.${index}` }));
    expectSocketFallback((index) => ({ 'fly-client-ip': `not-an-ip-${index}`, 'x-forwarded-for': `198.51.100.${index}` }));
    expectSocketFallback((index) => ({ 'fly-client-ip': `198.51.100.${index}, 198.51.100.254`, 'x-forwarded-for': `203.0.113.${index}` }));
    expectSocketFallback((index) => ({ 'fly-client-ip': [`198.51.100.${index}`], 'x-forwarded-for': `203.0.113.${index}` }));
  });
});

describe('room access environment', () => {
  it('requires a signing secret and exact origins in production, and prevents insecure SameSite=None cookies', () => {
    expect(() => loadServerEnv({ NODE_ENV: 'production', ALLOWED_ORIGINS: 'https://app.example.com' })).toThrow('ROOM_COOKIE_SECRET');
    expect(() => loadServerEnv({ NODE_ENV: 'production', ROOM_COOKIE_SECRET: 'secret', ALLOWED_ORIGINS: '*' })).toThrow('ALLOWED_ORIGINS');
    expect(() => loadServerEnv({ ROOM_COOKIE_SAME_SITE: 'None', ROOM_COOKIE_SECURE: 'false' })).toThrow('requires ROOM_COOKIE_SECURE');
    expect(() => loadServerEnv({ ROOM_COOKIE_SECURE: 'TRUE' })).toThrow('ROOM_COOKIE_SECURE must be true or false');
    expect(() => loadServerEnv({ ROOM_COOKIE_SECURE: 'yes' })).toThrow('ROOM_COOKIE_SECURE must be true or false');
    expect(() => loadServerEnv({ NODE_ENV: 'production', ROOM_COOKIE_SECRET: 'secret', ALLOWED_ORIGINS: 'https://app.example.com', ROOM_ACCESS_CRYPTO_PROFILE: 'test' })).toThrow('ROOM_ACCESS_CRYPTO_PROFILE');
    expect(() => loadServerEnv({ TRUST_PROXY: 'true' })).toThrow('TRUST_PROXY is not supported');
    expect(() => loadServerEnv({ CLIENT_ADDRESS_PROFILE: 'proxy' })).toThrow('CLIENT_ADDRESS_PROFILE must be none or fly');
    expect(loadServerEnv({ NODE_ENV: 'production', ROOM_COOKIE_SECRET: 'secret', ALLOWED_ORIGINS: 'https://app.example.com' })).toMatchObject({ roomCookieSecure: true, roomCookieSameSite: 'Lax', clientAddressProfile: 'none' });
    expect(loadServerEnv({ CLIENT_ADDRESS_PROFILE: 'fly' })).toMatchObject({ clientAddressProfile: 'fly' });
    expect(loadServerEnv({ NODE_ENV: 'test', ROOM_ACCESS_CRYPTO_PROFILE: 'test' })).toMatchObject({ roomAccessCryptoProfile: 'test' });
  });

  it('does not let direct service construction weaken SameSite=None', () => {
    expect(() => new RoomAccessService({} as SessionStore, { cookieSecret: 'test-secret', sameSite: 'None', secureCookie: false })).toThrow('requires a secure room cookie');
  });
});
