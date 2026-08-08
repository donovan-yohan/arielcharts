import { DEFAULT_CLEANUP_INTERVAL_MS, DEFAULT_DISK_TTL_MS, DEFAULT_SESSION_TTL_MS } from './constants.js';
import type { ServerEnv } from './types.js';

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === 'true') return true;
  if (value === 'false') return false;
  throw new Error('ROOM_COOKIE_SECURE must be true or false.');
}

function parseClientAddressProfile(value: string | undefined, legacyTrustProxy: string | undefined): 'none' | 'fly' {
  if (legacyTrustProxy !== undefined) {
    throw new Error('TRUST_PROXY is not supported; set CLIENT_ADDRESS_PROFILE to none or fly.');
  }
  if (value === undefined || value === 'none') return 'none';
  if (value === 'fly') return 'fly';
  throw new Error('CLIENT_ADDRESS_PROFILE must be none or fly.');
}

function parseSameSite(value: string | undefined): 'Lax' | 'Strict' | 'None' {
  switch (value?.toLowerCase()) {
    case undefined:
    case 'lax': return 'Lax';
    case 'strict': return 'Strict';
    case 'none': return 'None';
    default: throw new Error('ROOM_COOKIE_SAME_SITE must be Lax, Strict, or None.');
  }
}

function parseCryptoProfile(value: string | undefined, nodeEnv: string | undefined): 'test' | undefined {
  if (value === undefined) return undefined;
  if (value === 'test' && nodeEnv === 'test') return 'test';
  throw new Error('ROOM_ACCESS_CRYPTO_PROFILE=test is permitted only when NODE_ENV=test.');
}

export function parseAllowedOrigins(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }

  return raw
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
}

export function loadServerEnv(env: NodeJS.ProcessEnv = process.env): ServerEnv {
  const production = env.NODE_ENV === 'production';
  const roomCookieSecret = env.ROOM_COOKIE_SECRET;
  if (production && !roomCookieSecret) {
    throw new Error('ROOM_COOKIE_SECRET is required in production.');
  }
  const allowedOrigins = parseAllowedOrigins(env.ALLOWED_ORIGINS);
  if (production && (allowedOrigins.length === 0 || allowedOrigins.includes('*'))) {
    throw new Error('ALLOWED_ORIGINS must contain explicit browser origins in production.');
  }
  const roomCookieSameSite = parseSameSite(env.ROOM_COOKIE_SAME_SITE);
  const roomCookieSecure = parseBoolean(env.ROOM_COOKIE_SECURE, production);
  if (roomCookieSameSite === 'None' && !roomCookieSecure) {
    throw new Error('ROOM_COOKIE_SAME_SITE=None requires ROOM_COOKIE_SECURE=true.');
  }
  return {
    port: parseNumber(env.PORT, 4000),
    dataDir: env.DATA_DIR ?? '.data/arielcharts',
    cleanupIntervalMs: parseNumber(env.CLEANUP_INTERVAL_MS, DEFAULT_CLEANUP_INTERVAL_MS),
    sessionTtlMs: parseNumber(env.SESSION_TTL_MS, DEFAULT_SESSION_TTL_MS),
    diskTtlMs: parseNumber(env.DISK_TTL_MS, DEFAULT_DISK_TTL_MS),
    allowedOrigins,
    roomCookieSecret,
    roomCookieTtlMs: parseNumber(env.ROOM_COOKIE_TTL_MS, 8 * 60 * 60 * 1_000),
    roomCookieSecure,
    roomCookieSameSite,
    clientAddressProfile: parseClientAddressProfile(env.CLIENT_ADDRESS_PROFILE, env.TRUST_PROXY),
    roomAccessCryptoProfile: parseCryptoProfile(env.ROOM_ACCESS_CRYPTO_PROFILE, env.NODE_ENV),
  };
}
