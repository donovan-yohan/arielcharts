import { existsSync } from 'node:fs';
import { chromium, type Locator, type Page } from '@playwright/test';

const MCP_PROTOCOL_VERSION = '2026-07-28';
const BASE_FLOWCHART = `flowchart LR
  Browser[Browser] --> Gateway[Gateway]
  Gateway --> Service[Service]
  Service --> Database[(Database)]`;
const LOCAL_VIEW_FLOWCHART = `flowchart TD
  Local[Local view] --> Scratch[Scratch]`;
const HUMAN_EDGE = '  Browser --> Audit[Audit]';
const AGENT_EDGE = '  Gateway --> Worker[Worker]';

type Diagram = { id: string; mermaidText: string; name: string; revision: string };
type McpPayload = {
  error?: { message?: string };
  result?: {
    content?: Array<{ text?: string }>;
    isError?: boolean;
    structuredContent?: Record<string, unknown>;
  };
};

type ReactFlowError015Diagnostic = {
  channel: string;
  text: string;
};

const REACT_FLOW_ERROR_015 = /(?:\bReact Flow\b[\s\S]*?(?:error#015|(?:error(?: code)?\s*)?#?015\b)|trying to drag a node that is not initialized)/iu;

function collectReactFlowError015(page: Page): ReactFlowError015Diagnostic[] {
  const diagnostics: ReactFlowError015Diagnostic[] = [];
  const collect = (channel: string, text: string) => {
    if (REACT_FLOW_ERROR_015.test(text)) diagnostics.push({ channel, text });
  };

  page.on('console', (message) => collect(`console.${message.type()}`, message.text()));
  page.on('pageerror', (error) => collect('pageerror', error.stack ?? error.message));
  return diagnostics;
}

function assertNoReactFlowError015(diagnostics: ReactFlowError015Diagnostic[], context: string): void {
  if (diagnostics.length === 0) return;
  const detail = diagnostics.map(({ channel, text }) => `${channel}: ${text}`).join('\n');
  throw new Error(`React Flow #015 was emitted ${context}:\n${detail}`);
}

function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.stack ?? error.message));
  return errors;
}

function assertNoPageErrors(errors: string[], context: string): void {
  if (errors.length > 0) throw new Error(`Browser page errors were emitted ${context}:\n${errors.join('\n')}`);
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
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

async function dataPositionOf(locator: Locator, message: string): Promise<{ transform: string; x: number; y: number }> {
  const position = await locator.evaluate((element) => {
    const transform = element.getAttribute('style')?.match(/transform:\s*([^;]+)/u)?.[1]
      ?? getComputedStyle(element).transform;
    const translate = transform.match(/translate(?:3d)?\(\s*(-?[\d.]+)px(?:,\s*|\s+)(-?[\d.]+)px/u);
    const matrix = transform.match(/^matrix\([^,]+,\s*[^,]+,\s*[^,]+,\s*[^,]+,\s*(-?[\d.]+),\s*(-?[\d.]+)\)$/u);
    if (translate) return { transform, x: Number(translate[1]), y: Number(translate[2]) };
    if (matrix) return { transform, x: Number(matrix[1]), y: Number(matrix[2]) };
    return null;
  });
  assert(position, `${message}: could not parse local node transform.`);
  return position;
}

async function waitForPositionMovement(
  page: Page,
  nodeId: string,
  from: { x: number; y: number },
  minimumDistance = 8,
): Promise<void> {
  await page.waitForFunction(({ id, initial, minimum }) => {
    const node = [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .find((element) => element.dataset.id === id);
    const transform = node?.getAttribute('style')?.match(/transform:\s*([^;]+)/u)?.[1]
      ?? (node ? getComputedStyle(node).transform : '');
    const translate = transform.match(/translate(?:3d)?\(\s*(-?[\d.]+)px(?:,\s*|\s+)(-?[\d.]+)px/u);
    if (!translate) return false;
    return Math.hypot(Number(translate[1]) - initial.x, Number(translate[2]) - initial.y) >= minimum;
  }, { id: nodeId, initial: from, minimum: minimumDistance }, { timeout: 5_000 });
}

async function waitForPositionMatch(
  page: Page,
  nodeId: string,
  target: { x: number; y: number },
): Promise<void> {
  await page.waitForFunction(({ id, expected }) => {
    const node = [...document.querySelectorAll<HTMLElement>('.react-flow__node')]
      .find((element) => element.dataset.id === id);
    const transform = node?.getAttribute('style')?.match(/transform:\s*([^;]+)/u)?.[1]
      ?? (node ? getComputedStyle(node).transform : '');
    const translate = transform.match(/translate(?:3d)?\(\s*(-?[\d.]+)px(?:,\s*|\s+)(-?[\d.]+)px/u);
    if (!translate) return false;
    return Math.abs(Number(translate[1]) - expected.x) <= 2
      && Math.abs(Number(translate[2]) - expected.y) <= 2;
  }, { id: nodeId, expected: target }, { timeout: 15_000 });
}

async function nudgeNode(page: Page, locator: Locator, dx: number, dy: number, hold = false): Promise<void> {
  const box = await boxOf(locator, 'Node has no drag bounds.');
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + dx, box.y + box.height / 2 + dy, { steps: 8 });
  if (!hold) await page.mouse.up();
}

class ModernMcpClient {
  private nextId = 1;

  constructor(private readonly endpoint: string, private readonly origin: string) {}

  async tool(name: string, args: Record<string, unknown>): Promise<McpPayload> {
    const method = 'tools/call';
    const response = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'mcp-method': method,
        'mcp-name': name,
        'mcp-protocol-version': MCP_PROTOCOL_VERSION,
        origin: this.origin,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: this.nextId++,
        method,
        params: {
          name,
          arguments: args,
          _meta: {
            'io.modelcontextprotocol/clientCapabilities': {},
            'io.modelcontextprotocol/clientInfo': { name: 'arielcharts-collaboration-e2e', version: '1.0.0' },
            'io.modelcontextprotocol/protocolVersion': MCP_PROTOCOL_VERSION,
          },
        },
      }),
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`MCP ${name} returned HTTP ${response.status}: ${body}`);
    }
    return response.json() as Promise<McpPayload>;
  }

  expectContent<T>(payload: McpPayload, action: string): T {
    assert(!payload.error, `MCP ${action} JSON-RPC error: ${payload.error?.message ?? 'unknown error'}`);
    assert(!payload.result?.isError, `MCP ${action} tool error: ${payload.result?.content?.map((item) => item.text).join('\n') ?? 'unknown error'}`);
    assert(payload.result?.structuredContent, `MCP ${action} omitted structuredContent.`);
    return payload.result.structuredContent as T;
  }

  async getSession(sessionId: string): Promise<{ diagrams: Array<Pick<Diagram, 'id' | 'name' | 'revision'>>; revision: string }> {
    return this.expectContent(await this.tool('getSession', { sessionId }), 'getSession');
  }

  async readDiagram(sessionId: string, diagramId: string): Promise<Diagram> {
    return this.expectContent<{ diagram: Diagram }>(await this.tool('readDiagram', { sessionId, diagramId }), 'readDiagram').diagram;
  }

  async createDiagramWithLatestRevision(sessionId: string, name: string, mermaidText: string): Promise<Diagram> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const session = await this.getSession(sessionId);
      const payload = await this.tool('createDiagram', {
        sessionId, name, mermaidText, expectedRevision: session.revision, actorName: 'E2E agent', actorType: 'agent', detail: 'Prepared local-view isolation tab',
      });
      if (!payload.result?.isError) {
        return this.expectContent<{ diagram: Diagram }>(payload, 'createDiagram').diagram;
      }
      const detail = payload.result.content?.map((item) => item.text ?? '').join('\n') ?? '';
      if (!/stale session revision/i.test(detail) || attempt === 1) {
        return this.expectContent<{ diagram: Diagram }>(payload, 'createDiagram').diagram;
      }
    }
    throw new Error('Unreachable createDiagram retry state.');
  }

  async writeDiagram(sessionId: string, diagramId: string, mermaidText: string, expectedRevision: string): Promise<McpPayload> {
    return this.tool('writeDiagram', {
      sessionId, diagramId, mermaidText, expectedRevision, actorName: 'E2E agent', actorType: 'agent', detail: 'Merged concurrent browser edit',
    });
  }
}

async function validateCollaboration(): Promise<void> {
  const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  const browserA = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const browserB = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const pageA = await browserA.newPage();
  const pageB = await browserB.newPage();
  const reactFlowError015A = collectReactFlowError015(pageA);
  const reactFlowError015B = collectReactFlowError015(pageB);
  const pageErrorsA = collectPageErrors(pageA);
  const pageErrorsB = collectPageErrors(pageB);
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3003';
  const mcpUrl = process.env.E2E_MCP_URL ?? 'http://localhost:4000/mcp';
  const sessionId = `e2e-collaboration-${Date.now()}`;
  const mcp = new ModernMcpClient(mcpUrl, baseUrl);

  try {
    await Promise.all([
      pageA.goto(`${baseUrl}/s/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
      pageB.goto(`${baseUrl}/s/${sessionId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 }),
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

    const staleWrite = await mcp.writeDiagram(sessionId, main.id, `${BASE_FLOWCHART}\n${AGENT_EDGE}`, staleRevision);
    const staleText = `${staleWrite.result?.content?.map((item) => item.text ?? '').join('\n') ?? ''}\n${staleWrite.error?.message ?? ''}`;
    const staleRejected = staleWrite.result?.isError === true && /stale diagram revision/i.test(staleText);
    assert(staleRejected, `Stale modern MCP write was not rejected: ${staleText}`);

    const reread = await mcp.readDiagram(sessionId, main.id);
    const mergedSource = `${reread.mermaidText}\n${AGENT_EDGE}`;
    const retriedWrite = await mcp.writeDiagram(sessionId, main.id, mergedSource, reread.revision);
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
    assertNoReactFlowError015(reactFlowError015A, 'when browser A began its node drag');
    const heldBeforeRemote = await boxOf(activeDragNode, 'Active drag node disappeared before remote update.');
    await nudgeNode(pageB, remoteNode, -84, 46);
    assertNoReactFlowError015(reactFlowError015B, 'when browser B completed its node drag');
    await pageA.waitForTimeout(500);
    const heldAfterRemote = await boxOf(activeDragNode, 'Active drag node disappeared during remote update.');
    const activeDragStable = Math.abs(heldAfterRemote.x - heldBeforeRemote.x) <= 2
      && Math.abs(heldAfterRemote.y - heldBeforeRemote.y) <= 2;
    assert(activeDragStable, `Remote layout update jittered active drag overlay: before=${JSON.stringify(heldBeforeRemote)} after=${JSON.stringify(heldAfterRemote)}`);
    await pageA.mouse.up();
    await pageA.waitForTimeout(700);
    assertNoReactFlowError015(reactFlowError015A, 'when browser A completed its node drag');
    const finalA = await dataPositionOf(nodeById(pageA, dragNodeId), 'Dragged node disappeared after drag stop');
    const finalB = await dataPositionOf(nodeById(pageB, dragNodeId), 'Remote replica dragged node disappeared after drag stop');
    const replicasConverged = Math.abs(finalA.x - finalB.x) <= 2 && Math.abs(finalA.y - finalB.y) <= 2;
    assert(replicasConverged, `Drag replicas did not converge: A=${JSON.stringify(finalA)} B=${JSON.stringify(finalB)}`);

    const releasedPosition = finalB;
    await nudgeNode(pageB, nodeById(pageB, dragNodeId), -72, 52);
    assertNoReactFlowError015(reactFlowError015B, 'when browser B dragged the released node');
    await waitForPositionMovement(pageB, dragNodeId, releasedPosition);
    const winnerB = await dataPositionOf(nodeById(pageB, dragNodeId), 'Browser B winner node disappeared after post-release drag');
    const postReleaseWinnerMoved = Math.hypot(winnerB.x - releasedPosition.x, winnerB.y - releasedPosition.y) >= 8;
    assert(postReleaseWinnerMoved, `Post-release same-node drag did not establish a new winner: before=${JSON.stringify(releasedPosition)} after=${JSON.stringify(winnerB)}`);
    await waitForPositionMatch(pageA, dragNodeId, winnerB);
    const winnerA = await dataPositionOf(nodeById(pageA, dragNodeId), 'Browser A replica lost the post-release winner node');
    const postReleaseReplicasConverged = Math.abs(winnerA.x - winnerB.x) <= 2 && Math.abs(winnerA.y - winnerB.y) <= 2;
    assert(postReleaseReplicasConverged, `Post-release same-node winner did not converge: A=${JSON.stringify(winnerA)} B=${JSON.stringify(winnerB)}`);
    assertNoPageErrors(pageErrorsA, 'in collaboration browser A');
    assertNoPageErrors(pageErrorsB, 'in collaboration browser B');
    await pageA.screenshot({ path: '/tmp/arielcharts-collaboration.png' });

    console.log(`modern MCP stale write rejected=${staleRejected}`);
    console.log(`browser/MCP merged source converged=${merged.mermaidText.includes(HUMAN_EDGE.trim()) && merged.mermaidText.includes(AGENT_EDGE.trim())}`);
    console.log(`remote local-state isolation tab=${activeTabPreserved} flyouts=${sourceFlyoutsPreserved} selection=${localSelectionPreserved} mode=${localConnectModePreserved} camera=${localCameraPreserved}`);
    console.log(`concurrent drag active overlay stable=${activeDragStable} replicas converged=${replicasConverged}`);
    console.log(`post-release same-node winner moved=${postReleaseWinnerMoved} replicas converged=${postReleaseReplicasConverged}`);
    console.log('COLLABORATION E2E PASSED');
  } finally {
    await browser.close();
  }
}

validateCollaboration().catch((error) => {
  console.error(error);
  process.exit(1);
});
