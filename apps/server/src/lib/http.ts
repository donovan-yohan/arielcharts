import type { IncomingMessage, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 1_048_576; // 1 MB

export async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let totalBytes = 0;

  for await (const chunk of request) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += buf.length;
    if (totalBytes > MAX_BODY_BYTES) {
      throw new Error('Request body too large.');
    }
    chunks.push(buf);
  }

  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) {
    return {};
  }

  return JSON.parse(raw);
}

export function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
  headers?: Record<string, string>,
): void {
  response.statusCode = statusCode;
  response.setHeader('content-type', 'application/json');
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        response.setHeader(key, value);
      }
    }
  }
  response.end(JSON.stringify(payload));
}

export function sendEmpty(
  response: ServerResponse,
  statusCode: number,
  headers?: Record<string, string>,
): void {
  response.statusCode = statusCode;
  if (headers) {
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) {
        response.setHeader(key, value);
      }
    }
  }
  response.end();
}

export function createCorsHeaders(
  origin: string | undefined,
  allowedOrigins: string[],
  requestHeaders?: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    'access-control-allow-methods': 'POST, OPTIONS',
    'access-control-max-age': '86400',
  };
  if (requestHeaders) {
    headers['access-control-allow-headers'] = requestHeaders;
  }
  if (origin && (allowedOrigins.length === 0 || allowedOrigins.includes(origin))) {
    headers['access-control-allow-origin'] = origin;
  }
  return headers;
}
