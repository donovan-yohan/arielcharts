import { chromium } from '@playwright/test';
import { WebSocket as NodeWebSocket } from 'ws';
import { assert } from './e2e/support/assert.ts';
import { ModernMcpClient, postModernMcp } from './e2e/support/mcp.ts';
import { createRoom, rotateRoomAccess, type RoomAccess } from './e2e/support/room-access.ts';
import { ensureSourceFlyoutOpen, visitWorkspace } from './e2e/support/workspace.ts';

const PRODUCTION_BASE_URL = 'https://arielcharts.donovanyohan.com';
const PRODUCTION_MCP_URL = 'https://api.arielcharts.donovanyohan.com/mcp';
const PRODUCTION_CONFIRMATION = '1';

type ProductionEndpoints = {
  baseUrl: string;
  mcpUrl: string;
  serverUrl: string;
};

function requireProductionEndpoints(env: NodeJS.ProcessEnv = process.env): ProductionEndpoints {
  if (env.E2E_PRODUCTION_SMOKE !== PRODUCTION_CONFIRMATION) {
    throw new Error('Refusing to create a production room. Set E2E_PRODUCTION_SMOKE=1 explicitly.');
  }
  if (env.E2E_BASE_URL !== PRODUCTION_BASE_URL || env.E2E_MCP_URL !== PRODUCTION_MCP_URL) {
    throw new Error(
      `Production smoke requires E2E_BASE_URL=${PRODUCTION_BASE_URL} and E2E_MCP_URL=${PRODUCTION_MCP_URL}.`,
    );
  }
  const mcpUrl = new URL(env.E2E_MCP_URL);
  if (mcpUrl.protocol !== 'https:' || mcpUrl.pathname !== '/mcp') {
    throw new Error('Production smoke only permits the canonical HTTPS MCP endpoint.');
  }
  return { baseUrl: env.E2E_BASE_URL, mcpUrl: env.E2E_MCP_URL, serverUrl: mcpUrl.origin };
}

function cookieFrom(response: Response, description: string): string {
  const setCookie = response.headers.get('set-cookie');
  assert(setCookie, `${description} did not set a room cookie.`);
  assert(/;\s*HttpOnly(?:;|$)/iu.test(setCookie), `${description} room cookie is not HttpOnly.`);
  assert(/;\s*Secure(?:;|$)/iu.test(setCookie), `${description} room cookie is not Secure.`);
  assert(/;\s*SameSite=Lax(?:;|$)/iu.test(setCookie), `${description} room cookie is not SameSite=Lax.`);
  assert(/;\s*Path=\/(?:;|$)/iu.test(setCookie), `${description} room cookie has the wrong Path.`);
  assert(!/;\s*Domain=/iu.test(setCookie), `${description} room cookie must remain host-only.`);
  const cookie = setCookie.split(';', 1)[0];
  assert(cookie && cookie.includes('='), `${description} returned an invalid room cookie.`);
  return cookie;
}

async function exchangeRoomAccess(serverUrl: string, origin: string, sessionId: string, roomKey: string): Promise<RoomAccess> {
  const response = await fetch(new URL(`/api/rooms/${encodeURIComponent(sessionId)}/access`, serverUrl), {
    body: JSON.stringify({ room_key: roomKey }),
    headers: { 'content-type': 'application/json', origin },
    method: 'POST',
  });
  if (response.status !== 204) {
    throw new Error(`Room access exchange returned ${response.status}: ${await response.text()}`);
  }
  return { cookie: cookieFrom(response, 'Room access exchange'), roomKey, sessionId };
}

async function fetchAuthorizedJson(
  serverUrl: string,
  origin: string,
  path: string,
  cookie: string,
  label: string,
): Promise<unknown> {
  const response = await fetch(new URL(path, serverUrl), { headers: { cookie, origin } });
  if (response.status !== 200) throw new Error(`${label} returned ${response.status}: ${await response.text()}`);
  return response.json();
}

async function openAuthorizedWebSocket(
  serverUrl: string,
  origin: string,
  sessionId: string,
  cookie: string,
): Promise<{ closed: Promise<void>; terminate: () => void }> {
  const url = new URL(`/ws/${encodeURIComponent(sessionId)}`, serverUrl);
  url.protocol = 'wss:';
  const socket = new NodeWebSocket(url, { headers: { cookie, origin } });
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error(`Authorized WebSocket did not open: ${url}`));
      }, 10_000);
      socket.once('open', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.once('error', (error) => {
        clearTimeout(timeout);
        reject(error);
      });
    });
  } catch (error) {
    socket.terminate();
    throw error;
  }
  return { closed, terminate: () => socket.terminate() };
}

async function expectRejectedWebSocket(serverUrl: string, origin: string, sessionId: string, cookie: string): Promise<void> {
  const url = new URL(`/ws/${encodeURIComponent(sessionId)}`, serverUrl);
  url.protocol = 'wss:';
  await new Promise<void>((resolve, reject) => {
    const socket = new NodeWebSocket(url, { headers: { cookie, origin } });
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`Revoked WebSocket remained open: ${url}`));
    }, 10_000);
    socket.once('open', () => {
      clearTimeout(timeout);
      socket.terminate();
      reject(new Error(`Revoked WebSocket unexpectedly opened: ${url}`));
    });
    socket.once('close', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('error', () => undefined);
  });
}

async function waitForClosed(closed: Promise<void>, label: string): Promise<void> {
  await Promise.race([
    closed,
    new Promise<void>((_, reject) => setTimeout(() => reject(new Error(`${label} was not revoked within 10 seconds.`)), 10_000)),
  ]);
}

async function run(): Promise<void> {
  const endpoints = requireProductionEndpoints();
  const origin = endpoints.baseUrl;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  let initialSocket: { closed: Promise<void>; terminate: () => void } | undefined;
  let reconnectedSocket: { closed: Promise<void>; terminate: () => void } | undefined;
  try {
    // Creation happens only after endpoint/confirmation validation and the
    // local browser harness are both ready, avoiding orphan smoke rooms.
    const credentials = await createRoom(endpoints.serverUrl, origin);
    const nodeAccess = await exchangeRoomAccess(endpoints.serverUrl, origin, credentials.sessionId, credentials.roomKey);
    await visitWorkspace(page, endpoints.baseUrl, credentials.sessionId, credentials.roomKey);
    assert(!new URL(page.url()).hash, 'Room key fragment remained in the browser URL after exchange.');

    const browserCookies = await context.cookies([endpoints.serverUrl]);
    const browserCookie = browserCookies.find((cookie) => cookie.name === `arielcharts_room_${credentials.sessionId}`);
    assert(browserCookie, 'Browser did not retain the room access cookie from the canonical API host.');
    assert(browserCookie.secure && browserCookie.httpOnly && browserCookie.sameSite === 'Lax' && browserCookie.path === '/',
      'Browser room cookie is not Secure, HttpOnly, SameSite=Lax, and Path=/ as required.');

    const state = await fetchAuthorizedJson(
      endpoints.serverUrl,
      origin,
      `/api/sessions/${encodeURIComponent(credentials.sessionId)}/diagrams/main`,
      nodeAccess.cookie,
      'Authorized diagram state',
    ) as { diagram?: { id?: unknown; revision?: unknown }; participants?: unknown };
    assert(
      typeof state.diagram?.id === 'string' && typeof state.diagram.revision === 'string',
      'Authorized diagram state omitted its public diagram fields.',
    );
    const history = await fetchAuthorizedJson(
      endpoints.serverUrl,
      origin,
      `/api/sessions/${encodeURIComponent(credentials.sessionId)}/diagrams/main/history`,
      nodeAccess.cookie,
      'Authorized diagram history',
    ) as { revisions?: unknown };
    assert(Array.isArray(history.revisions), 'Authorized diagram history omitted revisions.');

    const browserAccessStatus = await page.evaluate(async ({ serverUrl, sessionId }) => {
      const response = await fetch(`${serverUrl}/api/rooms/${encodeURIComponent(sessionId)}/access`, { credentials: 'include' });
      return response.status;
    }, { serverUrl: endpoints.serverUrl, sessionId: credentials.sessionId });
    assert(browserAccessStatus === 204, `Browser did not send its same-site cookie to API access check: HTTP ${browserAccessStatus}.`);

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 });
    await ensureSourceFlyoutOpen(page);
    await page.getByTestId('connection-status-badge').filter({ hasText: /^synced$/iu }).waitFor({ state: 'visible', timeout: 15_000 });

    initialSocket = await openAuthorizedWebSocket(endpoints.serverUrl, origin, credentials.sessionId, nodeAccess.cookie);
    initialSocket.terminate();
    await waitForClosed(initialSocket.closed, 'Initial WebSocket');
    reconnectedSocket = await openAuthorizedWebSocket(endpoints.serverUrl, origin, credentials.sessionId, nodeAccess.cookie);

    const oldMcp = new ModernMcpClient(endpoints.mcpUrl, origin, credentials);
    const session = await oldMcp.getSession(credentials.sessionId);
    assert(Array.isArray(session.diagrams) && typeof session.revision === 'string', 'MCP bearer did not read the protected session.');

    const rotated = await rotateRoomAccess(endpoints.serverUrl, origin, nodeAccess);
    await waitForClosed(reconnectedSocket.closed, 'Open WebSocket after key rotation');
    await expectRejectedWebSocket(endpoints.serverUrl, origin, credentials.sessionId, nodeAccess.cookie);

    await page.waitForFunction(() => {
      const state = document.querySelector('[data-testid="connection-status-badge"]')?.textContent?.trim().toLowerCase();
      return Boolean(state && state !== 'synced');
    }, undefined, { timeout: 15_000 });
    await page.waitForTimeout(3_000);
    const browserConnectionState = await page.getByTestId('connection-status-badge').textContent();
    assert(browserConnectionState?.trim().toLowerCase() !== 'synced',
      'Browser page reconnected with its revoked room cookie after rotation.');
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: 'Enter the room key', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    assert(await page.getByTestId('canvas-first-workspace').count() === 0,
      'Revoked browser cookie remounted the protected workspace after reload.');

    const revokedMcp = await postModernMcp(endpoints.mcpUrl, origin, credentials, 'getSession', { sessionId: credentials.sessionId }, 99);
    assert(revokedMcp.status === 401, `Revoked MCP bearer returned ${revokedMcp.status}, expected 401.`);
    const renewedMcp = new ModernMcpClient(endpoints.mcpUrl, origin, rotated);
    await renewedMcp.getSession(credentials.sessionId);
    console.log(`Production room-access smoke passed for session ${credentials.sessionId}.`);
  } finally {
    initialSocket?.terminate();
    reconnectedSocket?.terminate();
    await context.close();
    await browser.close();
  }
}

run().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

export { requireProductionEndpoints };
