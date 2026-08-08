import { existsSync } from 'node:fs';
import { chromium, type Browser, type Locator, type Page } from '@playwright/test';
import { WebSocket as NodeWebSocket } from 'ws';
import {
  assertNoPageErrors,
  assertNoReactFlowError015,
  collectReactFlowDiagnostics,
  getReactFlowNodePosition,
  waitForReactFlowNodePositionMatch,
  waitForReactFlowNodePositionMovement,
} from './e2e/support/react-flow';
import { ModernMcpClient, postModernMcp, type Diagram } from './e2e/support/mcp';
import { withOwnedServices, type E2eEndpoints } from './e2e/support/owned-services';
import {
  createRoom,
  exchangeRoomAccess,
  getRoomAccess,
  roomShareUrl,
  rotateRoomAccess,
  type RoomCredentials,
} from './e2e/support/room-access';
import { openYjsSessionObserver, type YjsSessionObserver } from './e2e/support/yjs-session';

const BASE_FLOWCHART = `flowchart LR
  Browser[Browser] --> Gateway[Gateway]
  Gateway --> Service[Service]
  Service --> Database[(Database)]`;
const LOCAL_VIEW_FLOWCHART = `flowchart TD
  Local[Local view] --> Scratch[Scratch]`;
const HUMAN_EDGE = '  Browser --> Audit[Audit]';
const AGENT_EDGE = '  Gateway --> Worker[Worker]';
const PENDING_PRUNE_FLOWCHART = `flowchart LR
  A[Disposable] --> B[Bridge]
  B --> C[Keep]`;
const PENDING_PRUNE_REMOVED = `flowchart LR
  B[Bridge] --> C[Keep]`;
const NEGATIVE_OBSERVATION_WINDOW_MS = 300;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function writeDiagram(
  mcp: ModernMcpClient,
  sessionId: string,
  diagramId: string,
  mermaidText: string,
  expectedRevision: string,
) {
  return mcp.tool('writeDiagram', {
    sessionId,
    diagramId,
    mermaidText,
    expectedRevision,
    actorName: 'E2E agent',
    actorType: 'agent',
    detail: 'Merged concurrent browser edit',
  });
}

function sourceEditor(page: Page): Locator {
  return page.locator('.cm-content');
}

async function ensureSourceFlyoutOpen(page: Page): Promise<Locator> {
  const toggle = page.getByTestId('source-flyout-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  const editor = sourceEditor(page);
  await editor.waitFor({ state: 'visible', timeout: 15_000 });
  return editor;
}

async function closeSourceFlyout(page: Page): Promise<void> {
  const toggle = page.getByTestId('source-flyout-toggle');
  if (await toggle.getAttribute('aria-expanded') === 'true') {
    await toggle.click();
    await page.getByTestId('source-flyout').waitFor({ state: 'detached', timeout: 15_000 });
  }
}

async function replaceSource(page: Page, source: string): Promise<void> {
  const editor = await ensureSourceFlyoutOpen(page);
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(source);
}

async function waitForSource(page: Page, expected: string): Promise<void> {
  await page.waitForFunction((source) => {
    const lines = [...document.querySelectorAll('.cm-line')];
    return lines.map((line) => {
      const documentLine = line.cloneNode(true) as HTMLElement;
      documentLine.querySelectorAll('.cm-ySelectionCaret, .cm-widgetBuffer').forEach((widget) => { widget.remove(); });
      return documentLine.textContent ?? '';
    }).join('\n') === source;
  }, expected, { timeout: 15_000 });
}

async function waitForFlowchart(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    return document.querySelector('[data-testid="diagram-mode"]')?.textContent?.includes('Flowchart · editable')
      && document.querySelectorAll('.react-flow__node').length >= 2;
  }, undefined, { timeout: 15_000 });
}

async function waitForSourceFlyoutSync(page: Page): Promise<void> {
  await page.getByTestId('connection-status-badge').filter({ hasText: /^synced$/i }).waitFor({ state: 'visible', timeout: 15_000 });
}

async function waitForMainTabActive(page: Page): Promise<void> {
  const mainTab = page.getByRole('tab', { name: 'Main', exact: true });
  await mainTab.waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction(() => {
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    return tabs.some((tab) => tab.textContent?.trim() === 'Main' && tab.getAttribute('aria-selected') === 'true');
  }, undefined, { timeout: 15_000 });
}

function transformedLayer(page: Page): Locator {
  return page.locator('.diagram-canvas-svg').locator('..');
}

async function getActiveTabId(page: Page): Promise<string | null> {
  return page.locator('[role="tab"][aria-selected="true"]').getAttribute('id');
}

async function selectTabByName(page: Page, name: string): Promise<void> {
  await page.getByRole('tab', { name, exact: true }).click();
  await page.getByRole('tab', { name, exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction((tabName) => {
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')];
    return tabs.some((tab) => tab.getAttribute('aria-selected') === 'true' && tab.textContent?.trim() === tabName);
  }, name, { timeout: 15_000 });
}

async function nodeIdAt(page: Page, index: number): Promise<string> {
  const id = await page.locator('.react-flow__node').nth(index).getAttribute('data-id');
  assert(id, `Missing React Flow data-id at node index ${index}.`);
  return id;
}

function nodeById(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id=${JSON.stringify(id)}]`);
}

async function boxOf(locator: Locator, message: string) {
  const box = await locator.boundingBox();
  assert(box, message);
  return box;
}

async function nudgeNode(page: Page, locator: Locator, dx: number, dy: number, hold = false): Promise<void> {
  const box = await boxOf(locator, 'Node has no drag bounds.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  if (!hold) await page.mouse.up();
}

async function advanceClockUntilNodePresence(
  page: Page,
  nodeId: string,
  expectedCount: number,
  maximumAdvanceMs: number,
  stepMs = 10,
): Promise<number> {
  let elapsed = 0;
  while (await nodeById(page, nodeId).count() !== expectedCount) {
    assert(elapsed < maximumAdvanceMs,
      `Node ${nodeId} did not reach count ${expectedCount} within ${maximumAdvanceMs}ms of controlled clock time.`);
    const advance = Math.min(stepMs, maximumAdvanceMs - elapsed);
    await page.clock.runFor(advance);
    elapsed += advance;
  }
  return elapsed;
}

function positionsMatch(
  left: { x: number; y: number },
  right: { x: number; y: number },
  tolerance = 2,
): boolean {
  return Math.abs(left.x - right.x) <= tolerance && Math.abs(left.y - right.y) <= tolerance;
}

function diagramStateUrl(serverUrl: string, sessionId: string): string {
  return new URL(`/api/sessions/${encodeURIComponent(sessionId)}/diagrams/main`, serverUrl).toString();
}

async function diagramStateResponse(
  serverUrl: string,
  origin: string,
  sessionId: string,
  cookie?: string,
): Promise<Response> {
  return fetch(diagramStateUrl(serverUrl, sessionId), {
    headers: { ...(cookie ? { cookie } : {}), origin },
  });
}

async function waitForBrowserSocketRevocation(page: Page, label: string): Promise<void> {
  await page.waitForFunction(() => {
    const state = document.querySelector('[data-testid="connection-status-badge"]')?.textContent?.trim().toLowerCase();
    return Boolean(state && state !== 'synced');
  }, undefined, { timeout: 15_000 }).catch(() => {
    throw new Error(`${label} remained synced after room key rotation.`);
  });
}

async function openAuthorizedWebsocket(
  serverUrl: string,
  origin: string,
  sessionId: string,
  cookie: string,
): Promise<{ closed: Promise<void>; terminate: () => void }> {
  const websocketUrl = new URL(`/ws/${encodeURIComponent(sessionId)}`, serverUrl);
  websocketUrl.protocol = websocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new NodeWebSocket(websocketUrl, { headers: { cookie, origin } });
  const closed = new Promise<void>((resolve) => socket.once('close', () => resolve()));
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        socket.terminate();
        reject(new Error(`Authorized room WebSocket did not open: ${websocketUrl}`));
      }, 5_000);
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

async function expectRejectedWebsocket(
  serverUrl: string,
  origin: string,
  sessionId: string,
  cookie?: string,
): Promise<void> {
  const websocketUrl = new URL(`/ws/${encodeURIComponent(sessionId)}`, serverUrl);
  websocketUrl.protocol = websocketUrl.protocol === 'https:' ? 'wss:' : 'ws:';
  await new Promise<void>((resolve, reject) => {
    const socket = new NodeWebSocket(websocketUrl, { headers: { ...(cookie ? { cookie } : {}), origin } });
    const timeout = setTimeout(() => {
      socket.terminate();
      reject(new Error(`Rejected room WebSocket stayed open: ${websocketUrl}`));
    }, 5_000);
    socket.on('open', () => {
      clearTimeout(timeout);
      socket.terminate();
      reject(new Error(`Rejected room WebSocket unexpectedly opened: ${websocketUrl}`));
    });
    socket.on('close', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.on('error', () => undefined);
  });
}

async function expectLockedRoomDoesNotMount(
  browser: Browser,
  baseUrl: string,
  serverUrl: string,
  room: RoomCredentials,
  invalidKey = false,
): Promise<void> {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  const websocketUrls: string[] = [];
  const stateRequests: string[] = [];
  page.on('websocket', (socket) => { websocketUrls.push(socket.url()); });
  page.on('request', (request) => {
    if (request.url().startsWith(`${serverUrl}/api/sessions/${encodeURIComponent(room.sessionId)}/`)) {
      stateRequests.push(request.url());
    }
  });
  try {
    const target = invalidKey
      ? roomShareUrl(baseUrl, { ...room, roomKey: 'invalid-room-key' })
      : new URL(`/s/${encodeURIComponent(room.sessionId)}`, baseUrl).toString();
    await page.goto(target, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.getByRole('heading', { name: 'Enter the room key', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    if (invalidKey) {
      await page.locator('#room-key-error').waitFor({ state: 'visible', timeout: 15_000 });
    }
    await page.waitForTimeout(300);
    assert(await page.getByTestId('canvas-first-workspace').count() === 0,
      `${invalidKey ? 'Invalid' : 'Bare'} room URL mounted the workspace.`);
    assert(websocketUrls.length === 0,
      `${invalidKey ? 'Invalid' : 'Bare'} room URL opened a WebSocket: ${JSON.stringify(websocketUrls)}.`);
    assert(stateRequests.length === 0,
      `${invalidKey ? 'Invalid' : 'Bare'} room URL requested diagram state: ${JSON.stringify(stateRequests)}.`);
  } finally {
    await context.close();
  }
}

async function expectProtectedRoomAccess(browser: Browser, endpoints: E2eEndpoints): Promise<void> {
  const { baseUrl, mcpUrl, serverUrl } = endpoints;
  const room = await createRoom(serverUrl, baseUrl);
  const shareUrl = roomShareUrl(baseUrl, room);
  const parsedShareUrl = new URL(shareUrl);
  assert(parsedShareUrl.search === '' && parsedShareUrl.hash.startsWith('#roomKey='),
    `Room share link leaked its key outside the fragment: ${shareUrl}.`);
  assert((await diagramStateResponse(serverUrl, baseUrl, room.sessionId)).status === 401,
    'Unauthenticated diagram state access was not denied.');
  await expectRejectedWebsocket(serverUrl, baseUrl, room.sessionId);
  await expectLockedRoomDoesNotMount(browser, baseUrl, serverUrl, room);
  await expectLockedRoomDoesNotMount(browser, baseUrl, serverUrl, room, true);

  const browserA = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const browserB = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const pageA = await browserA.newPage();
  const pageB = await browserB.newPage();
  let activeSocket: Awaited<ReturnType<typeof openAuthorizedWebsocket>> | null = null;
  try {
    await Promise.all([
      pageA.goto(shareUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
      pageB.goto(shareUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
    ]);
    await Promise.all([
      pageA.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 }),
      pageB.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 }),
      ensureSourceFlyoutOpen(pageA),
      ensureSourceFlyoutOpen(pageB),
    ]);
    await Promise.all([
      pageA.getByTestId('connection-status-badge').filter({ hasText: /^synced$/i }).waitFor({ state: 'visible', timeout: 15_000 }),
      pageB.getByTestId('connection-status-badge').filter({ hasText: /^synced$/i }).waitFor({ state: 'visible', timeout: 15_000 }),
    ]);
    assert(await pageA.evaluate(() => window.location.hash === '') && await pageB.evaluate(() => window.location.hash === ''),
      'Successful fragment room-key exchange did not clear the browser URL hash.');

    const roomAccess = await exchangeRoomAccess(serverUrl, baseUrl, room);
    const mcp = new ModernMcpClient(mcpUrl, baseUrl, room);
    const session = await mcp.getSession(room.sessionId);
    assert(session.diagrams.some((diagram) => diagram.id === 'main'),
      'Authorized MCP client did not receive the protected room main diagram.');

    const roomB = await createRoom(serverUrl, baseUrl);
    assert((await getRoomAccess(serverUrl, baseUrl, roomB.sessionId, roomAccess.cookie)).status === 401,
      'Room-A cookie accessed room B.');
    assert((await diagramStateResponse(serverUrl, baseUrl, roomB.sessionId, roomAccess.cookie)).status === 401,
      'Room-A cookie accessed room-B diagram state.');
    const foreignMcp = await postModernMcp(mcpUrl, baseUrl, room, 'getSession', { sessionId: roomB.sessionId });
    const foreignMcpPayload = await foreignMcp.json().catch(() => null) as {
      error?: unknown;
      result?: { isError?: boolean };
    } | null;
    assert(!foreignMcp.ok || Boolean(foreignMcpPayload?.error) || foreignMcpPayload?.result?.isError === true,
      `Room-A MCP bearer accessed room B: status=${foreignMcp.status} body=${JSON.stringify(foreignMcpPayload)}.`);

    const socket = await openAuthorizedWebsocket(serverUrl, baseUrl, room.sessionId, roomAccess.cookie);
    activeSocket = socket;
    const rotated = await rotateRoomAccess(serverUrl, baseUrl, roomAccess);
    await Promise.all([
      socket.closed,
      waitForBrowserSocketRevocation(pageA, 'authorized browser A socket'),
      waitForBrowserSocketRevocation(pageB, 'authorized browser B socket'),
    ]);
    assert((await getRoomAccess(serverUrl, baseUrl, room.sessionId, roomAccess.cookie)).status === 401,
      'Pre-rotation browser cookie remained valid.');
    assert((await diagramStateResponse(serverUrl, baseUrl, room.sessionId, roomAccess.cookie)).status === 401,
      'Pre-rotation browser cookie still read diagram state.');
    await expectRejectedWebsocket(serverUrl, baseUrl, room.sessionId, roomAccess.cookie);
    const revokedMcp = await postModernMcp(mcpUrl, baseUrl, room, 'getSession', { sessionId: room.sessionId });
    assert(revokedMcp.status === 401, `Pre-rotation MCP bearer returned ${revokedMcp.status}, not 401.`);
    assert((await getRoomAccess(serverUrl, baseUrl, room.sessionId, rotated.cookie)).status === 204,
      'Replacement rotation cookie was not accepted.');
    const replacementMcp = new ModernMcpClient(mcpUrl, baseUrl, rotated);
    await replacementMcp.getSession(room.sessionId);

    const replacementContext = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const replacementPage = await replacementContext.newPage();
    try {
      await replacementPage.goto(roomShareUrl(baseUrl, rotated), { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await replacementPage.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 });
      assert(await replacementPage.evaluate(() => window.location.hash === ''),
        'Replacement room key did not clear from the browser URL after exchange.');
    } finally {
      await replacementContext.close();
    }
  } finally {
    activeSocket?.terminate();
    await Promise.all([browserB.close(), browserA.close()]);
  }
}

async function validateCollaboration({ baseUrl, mcpUrl, serverUrl }: E2eEndpoints): Promise<void> {
  const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  try {
  const browserA = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const browserB = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const pageA = await browserA.newPage();
  const pageB = await browserB.newPage();
  await pageA.clock.install({ time: Date.now() });
  const diagnosticsA = collectReactFlowDiagnostics(pageA);
  const diagnosticsB = collectReactFlowDiagnostics(pageB);
  const room = await createRoom(serverUrl, baseUrl);
  const roomAccess = await exchangeRoomAccess(serverUrl, baseUrl, room);
  const sessionId = room.sessionId;
  const mcp = new ModernMcpClient(mcpUrl, baseUrl, room);

    await expectProtectedRoomAccess(browser, { baseUrl, mcpUrl, serverUrl });
    await Promise.all([
      pageA.goto(roomShareUrl(baseUrl, room), { waitUntil: 'domcontentloaded', timeout: 30_000 }),
      pageB.goto(roomShareUrl(baseUrl, room), { waitUntil: 'domcontentloaded', timeout: 30_000 }),
    ]);
    await Promise.all([
      pageA.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 }),
      pageB.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 }),
    ]);
    await Promise.all([waitForMainTabActive(pageA), waitForMainTabActive(pageB)]);

    await Promise.all([ensureSourceFlyoutOpen(pageA), ensureSourceFlyoutOpen(pageB)]);
    await Promise.all([waitForSourceFlyoutSync(pageA), waitForSourceFlyoutSync(pageB)]);
    await replaceSource(pageA, BASE_FLOWCHART);
    await waitForFlowchart(pageA);
    await waitForSource(pageB, BASE_FLOWCHART);
    await waitForFlowchart(pageB);
    await closeSourceFlyout(pageB);

    const initial = await mcp.getSession(sessionId);
    const main = initial.diagrams.find((diagram) => diagram.id === 'main');
    assert(main, 'Modern MCP getSession did not expose the named main diagram.');
    const staleRevision = (await mcp.readDiagram(sessionId, main.id)).revision;
    const localView = await mcp.createDiagramWithLatestRevision(sessionId, 'Local view', LOCAL_VIEW_FLOWCHART);

    await pageB.getByRole('tab', { name: 'Local view', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await selectTabByName(pageB, 'Local view');
    await waitForFlowchart(pageB);
    const localNode = pageB.locator('.react-flow__node').first();
    await localNode.click();
    const selectedNodeId = await nodeIdAt(pageB, 0);
    const selectedBeforeRemote = (await nodeById(pageB, selectedNodeId).getAttribute('class'))?.includes('selected') === true;
    assert(selectedBeforeRemote, 'Selecting the local-view node did not produce a React Flow selected node.');
    await pageB.getByRole('button', { name: 'Connect nodes' }).click();
    await pageB.getByText('click source node [esc cancel]', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
    await pageB.getByRole('button', { name: 'Zoom in' }).click();
    const localTabBeforeRemote = await getActiveTabId(pageB);
    const localTransformBeforeRemote = await transformedLayer(pageB).getAttribute('style');
    const sourceOpenBeforeRemote = await pageA.getByTestId('source-flyout-toggle').getAttribute('aria-expanded');
    const sourceClosedBeforeRemote = await pageB.getByTestId('source-flyout-toggle').getAttribute('aria-expanded');

    await selectTabByName(pageA, 'Main');
    await ensureSourceFlyoutOpen(pageA);
    await replaceSource(pageA, `${BASE_FLOWCHART}\n${HUMAN_EDGE}`);
    await waitForSource(pageA, `${BASE_FLOWCHART}\n${HUMAN_EDGE}`);
    await pageA.waitForTimeout(250);
    const afterHuman = await mcp.readDiagram(sessionId, main.id);
    assert(afterHuman.revision !== staleRevision, 'Browser source write did not advance the MCP diagram revision.');
    assert(afterHuman.mermaidText.includes(HUMAN_EDGE.trim()), 'MCP re-read did not observe the browser edit.');

    const staleWrite = await writeDiagram(mcp, sessionId, main.id, `${BASE_FLOWCHART}\n${AGENT_EDGE}`, staleRevision);
    const staleText = `${staleWrite.result?.content?.map((item) => item.text ?? '').join('\n') ?? ''}\n${staleWrite.error?.message ?? ''}`;
    const staleRejected = staleWrite.result?.isError === true && /stale diagram revision/i.test(staleText);
    assert(staleRejected, `Stale modern MCP write was not rejected: ${staleText}`);

    const reread = await mcp.readDiagram(sessionId, main.id);
    const mergedSource = `${reread.mermaidText}\n${AGENT_EDGE}`;
    const retriedWrite = await writeDiagram(mcp, sessionId, main.id, mergedSource, reread.revision);
    const merged = mcp.expectContent<{ diagram: Diagram }>(retriedWrite, 'writeDiagram').diagram;
    assert(merged.mermaidText === mergedSource, 'MCP retry did not write the exact merged source.');

    await waitForSource(pageA, mergedSource);
    const activeTabPreserved = await getActiveTabId(pageB) === localTabBeforeRemote;
    const sourceFlyoutsPreserved = await pageA.getByTestId('source-flyout-toggle').getAttribute('aria-expanded') === sourceOpenBeforeRemote
      && await pageB.getByTestId('source-flyout-toggle').getAttribute('aria-expanded') === sourceClosedBeforeRemote;
    const localConnectModePreserved = await pageB.getByText('click source node [esc cancel]', { exact: true }).count() === 1;
    const localSelectionPreserved = (await nodeById(pageB, selectedNodeId).getAttribute('class'))?.includes('selected') === true;
    const localCameraPreserved = await transformedLayer(pageB).getAttribute('style') === localTransformBeforeRemote;
    assert(activeTabPreserved && sourceFlyoutsPreserved && localConnectModePreserved && localSelectionPreserved && localCameraPreserved,
      `Remote MCP update took over browser-local state: tab=${activeTabPreserved} flyouts=${sourceFlyoutsPreserved} mode=${localConnectModePreserved} selection=${localSelectionPreserved} camera=${localCameraPreserved}`);
    await pageB.screenshot({ path: '/tmp/arielcharts-collaboration-local-state.png' });

    await selectTabByName(pageB, 'Main');
    await ensureSourceFlyoutOpen(pageB);
    await waitForSource(pageB, mergedSource);
    await closeSourceFlyout(pageB);
    await closeSourceFlyout(pageA);
    await Promise.all([waitForFlowchart(pageA), waitForFlowchart(pageB)]);

    const dragNodeId = await nodeIdAt(pageA, 0);
    const remoteNodeId = await nodeIdAt(pageA, 1);
    assert(dragNodeId !== remoteNodeId, 'Collaboration drag fixture requires two distinct nodes.');
    const activeDragNode = nodeById(pageA, dragNodeId);
    const remoteNode = nodeById(pageB, remoteNodeId);
    await nudgeNode(pageA, activeDragNode, 110, 34, true);
    assertNoReactFlowError015(diagnosticsA.reactFlowError015, 'when browser A began its node drag');
    const heldBeforeRemote = await boxOf(activeDragNode, 'Active drag node disappeared before remote update.');
    await nudgeNode(pageB, remoteNode, -84, 46);
    assertNoReactFlowError015(diagnosticsB.reactFlowError015, 'when browser B completed its node drag');
    await pageA.waitForTimeout(500);
    const heldAfterRemote = await boxOf(activeDragNode, 'Active drag node disappeared during remote update.');
    const activeDragStable = positionsMatch(heldAfterRemote, heldBeforeRemote);
    assert(activeDragStable, `Remote layout update jittered active drag overlay: before=${JSON.stringify(heldBeforeRemote)} after=${JSON.stringify(heldAfterRemote)}`);
    await pageA.mouse.up();
    await pageA.waitForTimeout(700);
    assertNoReactFlowError015(diagnosticsA.reactFlowError015, 'when browser A completed its node drag');
    const finalA = await getReactFlowNodePosition(nodeById(pageA, dragNodeId), 'Dragged node disappeared after drag stop');
    const finalB = await getReactFlowNodePosition(nodeById(pageB, dragNodeId), 'Remote replica dragged node disappeared after drag stop');
    const replicasConverged = positionsMatch(finalA, finalB);
    assert(replicasConverged, `Drag replicas did not converge: A=${JSON.stringify(finalA)} B=${JSON.stringify(finalB)}`);

    const releasedPosition = finalB;
    await nudgeNode(pageB, nodeById(pageB, dragNodeId), -72, 52);
    assertNoReactFlowError015(diagnosticsB.reactFlowError015, 'when browser B dragged the released node');
    await waitForReactFlowNodePositionMovement(pageB, dragNodeId, releasedPosition);
    const winnerB = await getReactFlowNodePosition(nodeById(pageB, dragNodeId), 'Browser B winner node disappeared after post-release drag');
    const postReleaseWinnerMoved = Math.hypot(winnerB.x - releasedPosition.x, winnerB.y - releasedPosition.y) >= 8;
    assert(postReleaseWinnerMoved, `Post-release same-node drag did not establish a new winner: before=${JSON.stringify(releasedPosition)} after=${JSON.stringify(winnerB)}`);
    await waitForReactFlowNodePositionMatch(pageA, dragNodeId, winnerB);
    const winnerA = await getReactFlowNodePosition(nodeById(pageA, dragNodeId), 'Browser A replica lost the post-release winner node');
    const postReleaseReplicasConverged = positionsMatch(winnerA, winnerB);
    assert(postReleaseReplicasConverged, `Post-release same-node winner did not converge: A=${JSON.stringify(winnerA)} B=${JSON.stringify(winnerB)}`);

    const pendingPrune = await mcp.createDiagramWithLatestRevision(sessionId, 'Pending prune', PENDING_PRUNE_FLOWCHART);
    await Promise.all([
      pageA.getByRole('tab', { name: pendingPrune.name, exact: true }).waitFor({ state: 'visible', timeout: 15_000 }),
      pageB.getByRole('tab', { name: pendingPrune.name, exact: true }).waitFor({ state: 'visible', timeout: 15_000 }),
    ]);
    await Promise.all([
      selectTabByName(pageA, pendingPrune.name),
      selectTabByName(pageB, pendingPrune.name),
    ]);
    await Promise.all([ensureSourceFlyoutOpen(pageA), ensureSourceFlyoutOpen(pageB)]);
    await Promise.all([
      waitForSource(pageA, PENDING_PRUNE_FLOWCHART),
      waitForSource(pageB, PENDING_PRUNE_FLOWCHART),
      waitForFlowchart(pageA),
      waitForFlowchart(pageB),
    ]);

    let observer: YjsSessionObserver | null = null;
    let freshObserver: YjsSessionObserver | null = null;
    let clockPaused = false;
    let raceMouseHeld = false;
    let removalAdvanceMs = -1;
    let pendingPrunedBeforeStop = false;
    let pendingPrunedAfterStop = false;
    let freshObserverConfirmed = false;
    let reusedNodeMatchesInitial = false;
    let reusedNodeRejectedDraggedPosition = false;
    let restoredReplicasConverged = false;
    try {
      observer = await openYjsSessionObserver(mcpUrl, sessionId, { cookie: roomAccess.cookie, origin: baseUrl });
      await observer.waitFor(
        (current) => current.snapshot(pendingPrune.id).mermaidText === PENDING_PRUNE_FLOWCHART,
        'the pending-prune diagram source',
      );
      assert(observer.diagramExists(pendingPrune.id), 'Pending-prune fixture diagram is absent from the canonical Yjs map.');
      assert(!observer.hasNodePosition(pendingPrune.id, 'A'), 'Pending-prune fixture unexpectedly began with a persisted position for A.');

      const initialA = await getReactFlowNodePosition(nodeById(pageA, 'A'), 'Pending-prune node A was missing before the race');
      const pauseTime = await pageA.evaluate(() => Date.now() + 100);
      await pageA.clock.pauseAt(pauseTime);
      clockPaused = true;

      await nudgeNode(pageA, nodeById(pageA, 'A'), 132, 48, true);
      raceMouseHeld = true;
      const queuedA = await getReactFlowNodePosition(nodeById(pageA, 'A'), 'Pending-prune node A disappeared during its held drag');
      assert(Math.hypot(queuedA.x - initialA.x, queuedA.y - initialA.y) >= 8,
        `Held drag did not queue a meaningful position change: initial=${JSON.stringify(initialA)} queued=${JSON.stringify(queuedA)}`);

      await replaceSource(pageB, PENDING_PRUNE_REMOVED);
      await observer.waitFor(
        (current) => current.snapshot(pendingPrune.id).mermaidText === PENDING_PRUNE_REMOVED,
        'the source edit that removes node A',
      );
      await waitForSource(pageB, PENDING_PRUNE_REMOVED);
      assert(observer.diagramExists(pendingPrune.id), 'Pending-prune diagram disappeared before the removal race.');
      const removedNodeHistory = observer.trackNodePosition(pendingPrune.id, 'A');
      removalAdvanceMs = await advanceClockUntilNodePresence(pageA, 'A', 0, 120);
      assert(removalAdvanceMs < 120,
        `Node A was not reconciled away before the 120ms drag commit deadline: advanced=${removalAdvanceMs}ms.`);

      await pageA.clock.runFor(250);
      await removedNodeHistory.expectAbsentFor(NEGATIVE_OBSERVATION_WINDOW_MS, 'the post-timer observation window');
      pendingPrunedBeforeStop = observer.diagramExists(pendingPrune.id)
        && !removedNodeHistory.hasAppeared()
        && !observer.hasNodePosition(pendingPrune.id, 'A');
      assert(pendingPrunedBeforeStop, 'The expired drag timer resurrected removed node A in the canonical positions map.');
      assert(observer.snapshot(pendingPrune.id).mermaidText === PENDING_PRUNE_REMOVED,
        'The pending-prune source changed during the timer observation window.');

      await pageA.mouse.up();
      raceMouseHeld = false;
      await pageA.clock.runFor(250);
      await removedNodeHistory.expectAbsentFor(NEGATIVE_OBSERVATION_WINDOW_MS, 'the post-drag-stop observation window');
      pendingPrunedAfterStop = observer.diagramExists(pendingPrune.id)
        && !removedNodeHistory.hasAppeared()
        && !observer.hasNodePosition(pendingPrune.id, 'A');
      assert(pendingPrunedAfterStop, 'Drag stop resurrected removed node A in the canonical positions map.');
      assert(observer.snapshot(pendingPrune.id).mermaidText === PENDING_PRUNE_REMOVED,
        'The pending-prune source changed during the drag-stop observation window.');

      freshObserver = await openYjsSessionObserver(mcpUrl, sessionId, { cookie: roomAccess.cookie, origin: baseUrl });
      const freshRemovedSnapshot = freshObserver.snapshot(pendingPrune.id);
      freshObserverConfirmed = freshRemovedSnapshot.exists
        && freshRemovedSnapshot.mermaidText === PENDING_PRUNE_REMOVED
        && !freshObserver.hasNodePosition(pendingPrune.id, 'A');
      assert(freshObserverConfirmed,
        `A fresh Yjs observer did not confirm canonical removal: ${JSON.stringify(freshRemovedSnapshot)}`);

      await replaceSource(pageB, PENDING_PRUNE_FLOWCHART);
      await Promise.all([
        observer.waitFor(
          (current) => current.snapshot(pendingPrune.id).mermaidText === PENDING_PRUNE_FLOWCHART,
          'restored source in the original observer',
        ),
        freshObserver.waitFor(
          (current) => current.snapshot(pendingPrune.id).mermaidText === PENDING_PRUNE_FLOWCHART,
          'restored source in the fresh observer',
        ),
      ]);
      await advanceClockUntilNodePresence(pageA, 'A', 1, 500);
      await pageA.clock.resume();
      clockPaused = false;

      await Promise.all([
        waitForSource(pageA, PENDING_PRUNE_FLOWCHART),
        waitForSource(pageB, PENDING_PRUNE_FLOWCHART),
        waitForFlowchart(pageA),
        waitForFlowchart(pageB),
      ]);
      await Promise.all([closeSourceFlyout(pageA), closeSourceFlyout(pageB)]);
      const reusedA = await getReactFlowNodePosition(nodeById(pageA, 'A'), 'Reused node A was missing after source restoration');
      reusedNodeMatchesInitial = positionsMatch(reusedA, initialA);
      reusedNodeRejectedDraggedPosition = Math.hypot(reusedA.x - queuedA.x, reusedA.y - queuedA.y) >= 8;
      assert(reusedNodeMatchesInitial,
        `Reused node A did not return to its clean layout position: initial=${JSON.stringify(initialA)} reused=${JSON.stringify(reusedA)}`);
      assert(reusedNodeRejectedDraggedPosition,
        `Reused node A inherited its removed drag position: queued=${JSON.stringify(queuedA)} reused=${JSON.stringify(reusedA)}`);
      assert(!removedNodeHistory.hasAppeared()
        && observer.diagramExists(pendingPrune.id)
        && freshObserver.diagramExists(pendingPrune.id)
        && !observer.hasNodePosition(pendingPrune.id, 'A')
        && !freshObserver.hasNodePosition(pendingPrune.id, 'A'),
        'Reusing node ID A repopulated the canonical positions map with a stale coordinate.');

      const validB = await getReactFlowNodePosition(nodeById(pageA, 'B'), 'Valid node B was missing after the pending-prune race');
      await Promise.all([
        waitForReactFlowNodePositionMatch(pageB, 'A', reusedA),
        waitForReactFlowNodePositionMatch(pageB, 'B', validB),
      ]);
      const replicaA = await getReactFlowNodePosition(nodeById(pageB, 'A'), 'Browser B lost reused node A after source restoration');
      const replicaB = await getReactFlowNodePosition(nodeById(pageB, 'B'), 'Browser B lost valid node B after source restoration');
      restoredReplicasConverged = positionsMatch(replicaA, reusedA) && positionsMatch(replicaB, validB);
      assert(restoredReplicasConverged, 'Valid and reused nodes did not converge after the pending-prune race.');
    } finally {
      if (raceMouseHeld) await pageA.mouse.up().catch(() => undefined);
      if (clockPaused) await pageA.clock.resume().catch(() => undefined);
      freshObserver?.destroy();
      observer?.destroy();
    }

    assertNoPageErrors(diagnosticsA.pageErrors, 'in collaboration browser A');
    assertNoPageErrors(diagnosticsB.pageErrors, 'in collaboration browser B');
    assertNoReactFlowError015(diagnosticsA.reactFlowError015, 'during the collaboration gate');
    assertNoReactFlowError015(diagnosticsB.reactFlowError015, 'during the collaboration gate');
    await pageA.screenshot({ path: '/tmp/arielcharts-collaboration.png' });

    console.log(`modern MCP stale write rejected=${staleRejected}`);
    console.log(`browser/MCP merged source converged=${merged.mermaidText.includes(HUMAN_EDGE.trim()) && merged.mermaidText.includes(AGENT_EDGE.trim())}`);
    console.log(`remote local-state isolation tab=${activeTabPreserved} flyouts=${sourceFlyoutsPreserved} selection=${localSelectionPreserved} mode=${localConnectModePreserved} camera=${localCameraPreserved}`);
    console.log(`concurrent drag active overlay stable=${activeDragStable} replicas converged=${replicasConverged}`);
    console.log(`post-release same-node winner moved=${postReleaseWinnerMoved} replicas converged=${postReleaseReplicasConverged}`);
    console.log(`pending removal reconciled before commit=${removalAdvanceMs}ms timer pruned=${pendingPrunedBeforeStop} stop pruned=${pendingPrunedAfterStop}`);
    console.log(`fresh canonical observer confirmed=${freshObserverConfirmed} reused initial=${reusedNodeMatchesInitial} rejected dragged=${reusedNodeRejectedDraggedPosition} replicas converged=${restoredReplicasConverged}`);
    console.log('protected room access, cross-room isolation, fragment exchange, and rotation revocation passed=true');
    console.log('COLLABORATION E2E PASSED');
  } finally {
    await browser.close();
  }
}

withOwnedServices(validateCollaboration).catch((error) => {
  console.error(error);
  process.exit(1);
});
