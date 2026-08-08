import { createHash, createHmac, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import { isIP } from 'node:net';
import { SessionStore } from './persistence.js';
import type { RoomAccessRecord } from './types.js';

const ROOM_KEY_BYTES = 32;
const ROOM_KEY_PATTERN = /^[A-Za-z0-9_-]{43}$/u;
const DEFAULT_COOKIE_TTL_MS = 8 * 60 * 60 * 1000;
const COOKIE_NAME_PREFIX = 'arielcharts_room_';
const GENERIC_AUTH_ERROR = 'Room access denied.';
const MAX_BEARER_PROOFS = 256;

export interface RoomAccessOptions {
  cookieSecret?: string;
  cookieTtlMs?: number;
  secureCookie?: boolean;
  sameSite?: 'Lax' | 'Strict' | 'None';
  clientAddressProfile?: 'none' | 'fly';
  cryptoProfile?: 'test';
  now?: () => number;
  /** Test seam for admission-control coverage; production uses Node scrypt. */
  derive?: (key: string, salt: string) => Promise<Buffer>;
  /** Test seam for bounded successful-bearer proof coverage. */
  maxBearerProofs?: number;
}

export interface RoomAccessGrant {
  roomKey: string;
  record: RoomAccessRecord;
}

export interface AuthorizedRoom {
  sessionId: string;
  accessVersion: number;
}

export class RoomAccessError extends Error {
  constructor(
    readonly status: 401 | 429,
    readonly retryAfterSeconds?: number,
  ) {
    super(GENERIC_AUTH_ERROR);
  }
}

interface ScryptProfile {
  N: number;
  r: number;
  p: number;
  maxmem: number;
}

interface TokenBucket {
  tokens: number;
  updatedAt: number;
}

interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds?: number;
}

interface BearerProof {
  recordFingerprint: string;
  accessVersion: number;
}

class BoundedTokenBuckets {
  private readonly buckets = new Map<string, TokenBucket>();

  constructor(
    private readonly now: () => number,
    private readonly maxBuckets = 1_024,
  ) {}

  consume(key: string, capacity: number, refillPerMs: number): RateLimitDecision {
    const timestamp = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket) {
      this.evict(timestamp);
      bucket = { tokens: capacity, updatedAt: timestamp };
      this.buckets.set(key, bucket);
    }
    const elapsed = Math.max(0, timestamp - bucket.updatedAt);
    bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillPerMs);
    bucket.updatedAt = timestamp;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      return { allowed: true };
    }
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((1 - bucket.tokens) / refillPerMs / 1_000)) };
  }

  refund(key: string, capacity: number): void {
    const bucket = this.buckets.get(key);
    if (bucket) bucket.tokens = Math.min(capacity, bucket.tokens + 1);
  }

  private evict(now: number): void {
    if (this.buckets.size < this.maxBuckets) return;
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > 60 * 60 * 1_000) this.buckets.delete(key);
    }
    while (this.buckets.size >= this.maxBuckets) {
      const oldest = this.buckets.keys().next().value;
      if (!oldest) return;
      this.buckets.delete(oldest);
    }
  }
}

function scryptProfile(profile: RoomAccessOptions['cryptoProfile']): ScryptProfile {
  if (profile === 'test') {
    return { N: 1 << 10, r: 8, p: 1, maxmem: 16 * 1024 * 1024 };
  }
  // OWASP's scrypt baseline: N=2^17, r=8, p=1 (about 128 MiB per verification).
  return { N: 1 << 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
}

function parseCookies(header: string | undefined): Map<string, string> {
  const values = new Map<string, string>();
  if (!header) return values;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0) continue;
    values.set(part.slice(0, separator).trim(), part.slice(separator + 1).trim());
  }
  return values;
}

function safeEqual(left: Buffer, right: Buffer): boolean {
  return left.length === right.length && timingSafeEqual(left, right);
}

function validRoomKey(value: string): boolean {
  return ROOM_KEY_PATTERN.test(value);
}

export class RoomAccessService {
  private readonly now: () => number;
  private readonly cookieSecret: Buffer;
  private readonly cookieTtlMs: number;
  private readonly secureCookie: boolean;
  private readonly sameSite: 'Lax' | 'Strict' | 'None';
  private readonly clientAddressProfile: 'none' | 'fly';
  private readonly profile: ScryptProfile;
  private readonly creationBuckets: BoundedTokenBuckets;
  private readonly accessAttemptBuckets: BoundedTokenBuckets;
  private readonly attemptIpBuckets: BoundedTokenBuckets;
  private readonly deriveOverride?: RoomAccessOptions['derive'];
  private readonly rotations = new Map<string, Promise<RoomAccessGrant | null>>();
  /** LRU of successful bearer proofs; keys are digests, never capabilities. */
  private readonly bearerProofs = new Map<string, BearerProof>();
  /** Coalesces identical cold proof checks without retaining a raw capability. */
  private readonly pendingBearerProofs = new Map<string, Promise<boolean>>();
  private readonly maxBearerProofs: number;
  private readonly dummySalt = randomBytes(16).toString('base64url');
  private readonly dummyKey = randomBytes(ROOM_KEY_BYTES).toString('base64url');

  constructor(
    private readonly store: SessionStore,
    options: RoomAccessOptions = {},
  ) {
    this.now = options.now ?? Date.now;
    this.cookieSecret = Buffer.from(options.cookieSecret ?? 'development-only-room-cookie-secret');
    this.cookieTtlMs = options.cookieTtlMs ?? DEFAULT_COOKIE_TTL_MS;
    this.secureCookie = options.secureCookie ?? false;
    this.sameSite = options.sameSite ?? 'Lax';
    if (this.sameSite === 'None' && !this.secureCookie) {
      throw new Error('SameSite=None requires a secure room cookie.');
    }
    this.clientAddressProfile = options.clientAddressProfile ?? 'none';
    this.profile = scryptProfile(options.cryptoProfile);
    this.creationBuckets = new BoundedTokenBuckets(this.now);
    this.accessAttemptBuckets = new BoundedTokenBuckets(this.now);
    this.attemptIpBuckets = new BoundedTokenBuckets(this.now);
    this.deriveOverride = options.derive;
    this.maxBearerProofs = options.maxBearerProofs ?? MAX_BEARER_PROOFS;
    if (!Number.isSafeInteger(this.maxBearerProofs) || this.maxBearerProofs < 1) {
      throw new Error('maxBearerProofs must be a positive integer.');
    }
  }

  async createGrant(): Promise<RoomAccessGrant> {
    const roomKey = randomBytes(ROOM_KEY_BYTES).toString('base64url');
    const salt = randomBytes(16).toString('base64url');
    const verifier = await this.derive(roomKey, salt);
    const timestamp = this.now();
    return {
      roomKey,
      record: {
        salt,
        verifier: verifier.toString('base64url'),
        accessVersion: 1,
        createdAt: timestamp,
        updatedAt: timestamp,
      },
    };
  }

  allowRoomCreation(request: IncomingMessage): void {
    const decision = this.creationBuckets.consume(`create:${this.clientAddress(request)}`, 5, 5 / (60 * 1_000));
    if (!decision.allowed) throw new RoomAccessError(429, decision.retryAfterSeconds);
  }

  async authenticateRoomKey(sessionId: string, roomKey: string, request: IncomingMessage): Promise<AuthorizedRoom> {
    const address = this.clientAddress(request);
    this.consumeAttempt('access', sessionId, address);
    const record = await this.store.getRoomAccess(sessionId);
    const matched = await this.matches(record, roomKey);
    if (!matched || !record) {
      throw new RoomAccessError(401);
    }
    this.refundAttempt('access', sessionId, address);
    return { sessionId, accessVersion: record.accessVersion };
  }

  async authenticateBrowserCookie(sessionId: string, request: IncomingMessage): Promise<AuthorizedRoom> {
    const cookie = parseCookies(typeof request.headers.cookie === 'string' ? request.headers.cookie : undefined).get(this.cookieName(sessionId));
    const payload = this.readCookie(cookie);
    if (!payload || payload.sessionId !== sessionId) throw new RoomAccessError(401);
    const record = await this.store.getRoomAccess(sessionId);
    if (!record || record.accessVersion !== payload.accessVersion) throw new RoomAccessError(401);
    return { sessionId, accessVersion: record.accessVersion };
  }

  async authenticateBearer(request: IncomingMessage): Promise<AuthorizedRoom> {
    const header = typeof request.headers.authorization === 'string' ? request.headers.authorization : undefined;
    const token = header?.match(/^Bearer ([A-Za-z0-9_-]{6,32})\.([A-Za-z0-9_-]{43})$/u);
    const sessionId = token?.[1] ?? 'unknown';
    const roomKey = token?.[2] ?? '';
    const address = this.clientAddress(request);
    this.consumeAttempt('bearer', sessionId, address);
    const record = token ? await this.store.getRoomAccess(sessionId) : null;
    const matched = token && record
      ? await this.matchesBearer(token[0], record, roomKey)
      : await this.matches(record, roomKey);
    if (!token || !record || !matched) {
      throw new RoomAccessError(401);
    }
    this.refundAttempt('bearer', sessionId, address);
    return { sessionId, accessVersion: record.accessVersion };
  }

  browserCookieHeaders(sessionId: string, accessVersion: number): OutgoingHttpHeaders {
    const expiresAt = this.now() + this.cookieTtlMs;
    const body = Buffer.from(JSON.stringify({ sessionId, accessVersion, expiresAt })).toString('base64url');
    const signature = this.sign(body);
    const parts = [
      `${this.cookieName(sessionId)}=${body}.${signature}`,
      `Max-Age=${Math.max(1, Math.floor(this.cookieTtlMs / 1_000))}`,
      'Path=/',
      'HttpOnly',
      `SameSite=${this.sameSite}`,
    ];
    if (this.secureCookie) parts.push('Secure');
    return { 'set-cookie': parts.join('; ') };
  }

  async rotate(sessionId: string, expectedAccessVersion: number): Promise<RoomAccessGrant> {
    const active = this.rotations.get(sessionId);
    if (active) {
      const result = await active;
      if (!result) throw new RoomAccessError(401);
      return result;
    }
    const next = this.rotateExclusive(sessionId, expectedAccessVersion);
    this.rotations.set(sessionId, next);
    try {
      const result = await next;
      if (!result) throw new RoomAccessError(401);
      return result;
    } finally {
      this.rotations.delete(sessionId);
    }
  }

  private async rotateExclusive(sessionId: string, expectedAccessVersion: number): Promise<RoomAccessGrant | null> {
    const current = await this.store.getRoomAccess(sessionId);
    if (!current || current.accessVersion !== expectedAccessVersion) return null;
    const next = await this.createGrant();
    await this.store.setRoomAccess(sessionId, {
      ...next.record,
      accessVersion: current.accessVersion + 1,
      createdAt: current.createdAt,
    });
    return { roomKey: next.roomKey, record: { ...next.record, accessVersion: current.accessVersion + 1, createdAt: current.createdAt } };
  }

  private async matches(record: RoomAccessRecord | null, key: string): Promise<boolean> {
    const verifier = record?.verifier;
    const salt = record?.salt;
    const derived = await this.derive(validRoomKey(key) ? key : this.dummyKey, typeof salt === 'string' ? salt : this.dummySalt);
    if (!record || typeof verifier !== 'string') return false;
    let expected: Buffer;
    try {
      expected = Buffer.from(verifier, 'base64url');
    } catch {
      return false;
    }
    return safeEqual(derived, expected);
  }

  /**
   * Re-check the current durable record on every request so an access-version
   * rotation invalidates cached proof immediately, while avoiding repeated
   * expensive scrypt work for an unchanged successful bearer.
   */
  private async matchesBearer(bearer: string, record: RoomAccessRecord, key: string): Promise<boolean> {
    const bearerFingerprint = this.fingerprint(bearer);
    const recordFingerprint = this.recordFingerprint(record);
    const cached = this.bearerProofs.get(bearerFingerprint);
    if (cached?.recordFingerprint === recordFingerprint && cached.accessVersion === record.accessVersion) {
      this.bearerProofs.delete(bearerFingerprint);
      this.bearerProofs.set(bearerFingerprint, cached);
      return true;
    }
    if (cached) this.bearerProofs.delete(bearerFingerprint);

    const pendingKey = `${bearerFingerprint}:${recordFingerprint}`;
    let pending = this.pendingBearerProofs.get(pendingKey);
    if (!pending) {
      pending = this.matches(record, key).then((matched) => {
        if (matched) this.rememberBearerProof(bearerFingerprint, { recordFingerprint, accessVersion: record.accessVersion });
        return matched;
      }).finally(() => {
        this.pendingBearerProofs.delete(pendingKey);
      });
      this.pendingBearerProofs.set(pendingKey, pending);
    }
    return pending;
  }

  private rememberBearerProof(key: string, proof: BearerProof): void {
    this.bearerProofs.delete(key);
    this.bearerProofs.set(key, proof);
    while (this.bearerProofs.size > this.maxBearerProofs) {
      const oldest = this.bearerProofs.keys().next().value;
      if (!oldest) return;
      this.bearerProofs.delete(oldest);
    }
  }

  private recordFingerprint(record: RoomAccessRecord): string {
    return this.fingerprint(`${record.accessVersion}:${record.salt}:${record.verifier}`);
  }

  private fingerprint(value: string): string {
    return createHash('sha256').update(value).digest('base64url');
  }

  private async derive(key: string, salt: string): Promise<Buffer> {
    if (this.deriveOverride) return this.deriveOverride(key, salt);
    return new Promise((resolve, reject) => {
      scryptCallback(key, salt, 64, this.profile, (error, derivedKey) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(derivedKey);
      });
    });
  }

  private consumeAttempt(surface: 'access' | 'bearer', sessionId: string, address: string): void {
    const roomDecision = this.accessAttemptBuckets.consume(`${surface}:${sessionId}:${address}`, 8, 8 / (60 * 1_000));
    const ipDecision = this.attemptIpBuckets.consume(`${surface}:ip:${address}`, 20, 20 / (60 * 1_000));
    const decision = !roomDecision.allowed ? roomDecision : ipDecision;
    if (!decision.allowed) throw new RoomAccessError(429, decision.retryAfterSeconds);
  }

  private refundAttempt(surface: 'access' | 'bearer', sessionId: string, address: string): void {
    this.accessAttemptBuckets.refund(`${surface}:${sessionId}:${address}`, 8);
    this.attemptIpBuckets.refund(`${surface}:ip:${address}`, 20);
  }

  private cookieName(sessionId: string): string {
    return `${COOKIE_NAME_PREFIX}${sessionId}`;
  }

  private sign(value: string): string {
    return createHmac('sha256', this.cookieSecret).update(value).digest('base64url');
  }

  private readCookie(value: string | undefined): { sessionId: string; accessVersion: number; expiresAt: number } | null {
    if (!value) return null;
    const separator = value.lastIndexOf('.');
    if (separator <= 0) return null;
    const body = value.slice(0, separator);
    const signature = value.slice(separator + 1);
    const expected = this.sign(body);
    if (!safeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
    try {
      const parsed: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const payload = parsed as Record<string, unknown>;
      const { sessionId, accessVersion, expiresAt } = payload;
      if (typeof sessionId !== 'string' || typeof accessVersion !== 'number' || typeof expiresAt !== 'number'
        || !Number.isSafeInteger(accessVersion) || !Number.isFinite(expiresAt)) return null;
      if (expiresAt <= this.now()) return null;
      return { sessionId, accessVersion, expiresAt };
    } catch {
      return null;
    }
  }

  private clientAddress(request: IncomingMessage): string {
    if (this.clientAddressProfile === 'fly') {
      const flyClientIp = request.headers['fly-client-ip'];
      if (typeof flyClientIp === 'string' && !flyClientIp.includes(',') && flyClientIp === flyClientIp.trim() && isIP(flyClientIp) !== 0) {
        return flyClientIp;
      }
    }
    return request.socket.remoteAddress ?? 'unknown';
  }
}

export function roomAccessErrorHeaders(error: RoomAccessError): OutgoingHttpHeaders {
  return error.status === 429 && error.retryAfterSeconds
    ? { 'retry-after': String(error.retryAfterSeconds) }
    : {};
}
