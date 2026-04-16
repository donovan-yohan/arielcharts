import { DEFAULT_CLEANUP_INTERVAL_MS, DEFAULT_DISK_TTL_MS, DEFAULT_SESSION_TTL_MS } from './constants.js';
import type { ServerEnv } from './types.js';

function parseNumber(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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
  return {
    port: parseNumber(env.PORT, 4000),
    dataDir: env.DATA_DIR ?? '.data/arielcharts',
    cleanupIntervalMs: parseNumber(env.CLEANUP_INTERVAL_MS, DEFAULT_CLEANUP_INTERVAL_MS),
    sessionTtlMs: parseNumber(env.SESSION_TTL_MS, DEFAULT_SESSION_TTL_MS),
    diskTtlMs: parseNumber(env.DISK_TTL_MS, DEFAULT_DISK_TTL_MS),
    allowedOrigins: parseAllowedOrigins(env.ALLOWED_ORIGINS),
  };
}
