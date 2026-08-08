import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';

const MAX_BODY_BYTES = 1_048_576; // 1 MB
const MCP_CORS_HEADERS = ['content-type', 'mcp-protocol-version', 'mcp-method', 'mcp-name'];

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
  headers: OutgoingHttpHeaders = {},
): void {
  response.statusCode = statusCode;

  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      response.setHeader(key, value);
    }
  }

  response.setHeader('content-type', 'application/json');
  response.end(JSON.stringify(payload));
}

export function sendEmpty(response: ServerResponse, statusCode: number, headers: OutgoingHttpHeaders = {}): void {
  response.statusCode = statusCode;

  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) {
      response.setHeader(key, value);
    }
  }

  response.end();
}

export function createCorsHeaders(
  origin: string | undefined,
  allowedOrigins: readonly string[],
  requestedHeaders: string | undefined,
  allowedMethods = 'POST, OPTIONS',
): OutgoingHttpHeaders {
  const isWildcard = allowedOrigins.length === 0 || allowedOrigins.includes('*');
  const allowOrigin = isWildcard ? '*' : origin;
  const requested = requestedHeaders
    ?.split(',')
    .map((header) => header.trim().toLowerCase())
    .filter(Boolean) ?? [];
  const allowedHeaders = [...new Set([...MCP_CORS_HEADERS, ...requested])];

  const headers: OutgoingHttpHeaders = {
    'access-control-allow-headers': allowedHeaders.join(', '),
    'access-control-allow-methods': allowedMethods,
    'access-control-max-age': '86400',
    vary: isWildcard ? 'Access-Control-Request-Headers' : 'Origin, Access-Control-Request-Headers',
  };

  if (allowOrigin) {
    headers['access-control-allow-origin'] = allowOrigin;
  }

  return headers;
}
