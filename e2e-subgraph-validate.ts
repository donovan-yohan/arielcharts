import { existsSync } from 'node:fs';
import { chromium, type CDPSession, type Locator, type Page } from '@playwright/test';
import { getCameraPerturbationKey } from './e2e/support/canvas-camera';
import { ModernMcpClient } from './e2e/support/mcp';
import { withOwnedServices, type E2eEndpoints } from './e2e/support/owned-services';
import { createRoom, exchangeRoomAccess, roomShareUrl } from './e2e/support/room-access';
import { openYjsSessionObserver } from './e2e/support/yjs-session';

const NESTED_SOURCE = `flowchart TD
  subgraph outer[Outer section]
    A[Alpha]
    subgraph inner[Inner section]
      B[Beta]
    end
    C[Gamma]
  end`;
const RENAMED_SOURCE = NESTED_SOURCE.replace('subgraph inner[Inner section]', 'subgraph inner["Renamed inner"]');
const IMPLICIT_SOURCE = `flowchart TD
  subgraph ImplicitSection
    A[Alpha]
  end`;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function readSource(page: Page): Promise<string> {
  return page.locator('.cm-line').allTextContents().then((lines) => lines.join('\n'));
}

async function ensureSourceOpen(page: Page): Promise<Locator> {
  const toggle = page.getByTestId('source-flyout-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
  const editor = page.locator('.cm-content');
  await editor.waitFor({ state: 'visible', timeout: 15_000 });
  return editor;
}

async function ensureSourceClosed(page: Page): Promise<void> {
  const toggle = page.getByTestId('source-flyout-toggle');
  if (await toggle.getAttribute('aria-expanded') === 'true') await toggle.click();
}

async function replaceSource(page: Page, source: string): Promise<void> {
  const editor = await ensureSourceOpen(page);
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.insertText(source);
}

async function dispatchTouchDrag(cdp: CDPSession, target: Locator, dx: number, dy: number): Promise<void> {
  const bounds = await target.boundingBox();
  assert(bounds, 'Touch drag target has no browser bounds.');
  const start = { x: bounds.x + (bounds.width / 2), y: bounds.y + (bounds.height / 2) };
  const touchPoint = (x: number, y: number) => ({ id: 1, radiusX: 2, radiusY: 2, x, y });
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [touchPoint(start.x, start.y)], type: 'touchStart' });
  for (let step = 1; step <= 8; step += 1) {
    await cdp.send('Input.dispatchTouchEvent', {
      touchPoints: [touchPoint(start.x + ((dx * step) / 8), start.y + ((dy * step) / 8))],
      type: 'touchMove',
    });
  }
  await cdp.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
}

function getDeltas(
  before: Array<{ x: number; y: number } | null>,
  after: Array<{ x: number; y: number } | null>,
) {
  return before.map((prior, index) => {
    const next = after[index];
    return prior && next ? { x: next.x - prior.x, y: next.y - prior.y } : null;
  });
}

function deltasMatch(deltas: Array<{ x: number; y: number } | null>, x: number, y: number): boolean {
  return deltas.every((delta) => delta && Math.abs(delta.x - x) <= 6 && Math.abs(delta.y - y) <= 6);
}

async function waitForMovedSectionRevision(mcp: ModernMcpClient, sessionId: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const history = await mcp.listDiagramHistory(sessionId, 'main');
    for (const summary of history.revisions) {
      const revision = await mcp.readDiagramRevision(sessionId, 'main', summary.id);
      if (revision.mermaidText === RENAMED_SOURCE
        && ['A', 'B', 'C'].every((nodeId) => Object.hasOwn(revision.nodePositions, nodeId))) {
        return summary.id;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Immutable history did not capture the moved nested section revision.');
}

async function validate({ baseUrl, mcpUrl }: E2eEndpoints) {
  const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH
    ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  const room = await createRoom(new URL(mcpUrl).origin, baseUrl);
  const roomAccess = await exchangeRoomAccess(new URL(mcpUrl).origin, baseUrl, room);
  const mcp = new ModernMcpClient(mcpUrl, baseUrl, room);
  const durableObserver = await openYjsSessionObserver(mcpUrl, room.sessionId, { cookie: roomAccess.cookie, origin: baseUrl });

  try {
    const page = await browser.newPage({ viewport: { height: 900, width: 1400 } });
    const cdp = await page.context().newCDPSession(page);
    await page.goto(roomShareUrl(baseUrl, room), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await replaceSource(page, NESTED_SOURCE);
    await page.waitForFunction((expected) => (
      [...document.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '').join('\n') === expected
    ), NESTED_SOURCE, { timeout: 15_000 });
    await durableObserver.waitFor(
      (observer) => observer.snapshot('main').mermaidText === NESTED_SOURCE,
      'canonical nested section source before keyboard selection',
      10_000,
    );
    await ensureSourceClosed(page);

    const innerSection = page.getByTestId('canvas-subgraph-inner');
    const innerHeader = page.getByTestId('canvas-subgraph-header-inner');
    await innerHeader.waitFor({ state: 'visible', timeout: 15_000 });
    const selectedNode = page.locator('.react-flow__node[data-id="A"] .mermaid-flow-node');
    const focusedNode = page.locator('.react-flow__node[data-id="B"] .mermaid-flow-node');
    await selectedNode.click();
    await focusedNode.press('F2');
    const focusedNodeEditor = page.locator('input[placeholder="node label"]');
    await focusedNodeEditor.waitFor({ state: 'visible', timeout: 5_000 });
    assert(await focusedNodeEditor.inputValue() === 'Beta',
      'F2 on the focused node renamed the selected node instead of the focused node.');
    await focusedNodeEditor.press('Escape');

    await innerHeader.press('F2');
    const focusedSectionEditor = page.getByRole('textbox', { name: 'Section label', exact: true });
    await focusedSectionEditor.waitFor({ state: 'visible', timeout: 5_000 });
    assert(await focusedSectionEditor.inputValue() === 'Inner section',
      'F2 on the focused section header did not open its rename editor.');
    await focusedSectionEditor.press('Escape');

    await page.getByTestId('canvas-subgraph-boundary-inner-1').click();
    await page.waitForFunction(() => (
      document.querySelector('[data-testid="canvas-subgraph-inner"]')?.getAttribute('data-selected') === 'true'
    ), undefined, { timeout: 5_000 });
    const boundsSelected = await innerSection.getAttribute('data-selected') === 'true';
    await innerHeader.press('Escape');
    await page.waitForFunction(() => (
      document.querySelector('[data-testid="canvas-subgraph-inner"]')?.getAttribute('data-selected') === 'false'
      && !document.querySelector('[data-testid="canvas-subgraph-toolbar"]')
    ), undefined, { timeout: 5_000 });
    await innerHeader.press('Enter');
    await page.waitForFunction(() => (
      document.querySelector('[data-testid="canvas-subgraph-inner"]')?.getAttribute('data-selected') === 'true'
      && document.querySelector('[data-testid="canvas-subgraph-toolbar"]')
      && document.querySelector('[data-testid="canvas-action-edit-section-label"]')
    ), undefined, { timeout: 5_000 });
    const enterSelected = await innerSection.getAttribute('data-selected') === 'true';
    const enterToolbarVisible = await page.getByTestId('canvas-subgraph-toolbar').isVisible();
    await innerHeader.press('Escape');
    await page.waitForFunction(() => (
      document.querySelector('[data-testid="canvas-subgraph-inner"]')?.getAttribute('data-selected') === 'false'
      && !document.querySelector('[data-testid="canvas-subgraph-toolbar"]')
    ), undefined, { timeout: 5_000 });
    await innerHeader.press('Space');
    await page.waitForFunction(() => (
      document.querySelector('[data-testid="canvas-subgraph-inner"]')?.getAttribute('data-selected') === 'true'
      && document.querySelector('[data-testid="canvas-subgraph-toolbar"]')
      && document.querySelector('[data-testid="canvas-action-edit-section-label"]')
    ), undefined, { timeout: 5_000 });
    const spaceSelected = await innerSection.getAttribute('data-selected') === 'true';
    const spaceToolbarVisible = await page.getByTestId('canvas-subgraph-toolbar').isVisible();

    const editButton = page.getByRole('button', { name: 'Edit section label', exact: true });
    await editButton.waitFor({ state: 'visible', timeout: 5_000 });
    await editButton.press('Enter');
    const input = page.getByRole('textbox', { name: 'Section label', exact: true });
    await input.fill('Renamed inner');
    await input.press('Enter');
    await ensureSourceOpen(page);
    await page.waitForFunction((expected) => (
      [...document.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '').join('\n') === expected
    ), RENAMED_SOURCE, { timeout: 15_000 });
    assert(boundsSelected && enterSelected && spaceSelected,
      'Section boundary, Enter, and Space did not all select the nested section.');
    assert(enterToolbarVisible && spaceToolbarVisible, 'Keyboard section selection did not expose its toolbar.');
    assert(await readSource(page) === RENAMED_SOURCE, 'Rename changed nested section identity, nesting, or contents.');
    await ensureSourceClosed(page);

    const outerHeader = page.getByTestId('canvas-subgraph-header-outer');
    await outerHeader.waitFor({ state: 'visible', timeout: 15_000 });
    const nodeLocators = ['A', 'B', 'C'].map((id) => page.locator(`.react-flow__node[data-id=${JSON.stringify(id)}]`));
    const before = await Promise.all(nodeLocators.map((node) => node.boundingBox()));
    const headerBox = await outerHeader.boundingBox();
    assert(headerBox, 'Outer section header has no draggable bounds.');
    const start = { x: headerBox.x + (headerBox.width / 2), y: headerBox.y + (headerBox.height / 2) };
    await page.mouse.move(start.x, start.y);
    await page.mouse.down();
    await page.mouse.move(start.x + 320, start.y + 180, { steps: 10 });
    await page.mouse.up();

    await durableObserver.waitFor(
      (observer) => ['A', 'B', 'C'].every((nodeId) => observer.hasNodePosition('main', nodeId)),
      'durable positions for every nested section member',
      10_000,
    );
    const after = await Promise.all(nodeLocators.map((node) => node.boundingBox()));
    const deltas = getDeltas(before, after);
    assert(deltasMatch(deltas, 320, 180),
      `Nested section members did not move together: ${JSON.stringify(deltas)}`);
    const positions = durableObserver.snapshot('main').nodePositions;
    assert(!Object.hasOwn(positions, 'outer') && !Object.hasOwn(positions, 'inner'),
      'Section drag persisted section-position metadata instead of member-node positions.');

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByTestId('canvas-subgraph-header-outer').waitFor({ state: 'visible', timeout: 15_000 });
    await ensureSourceClosed(page);
    await page.getByRole('button', { name: 'Fit diagram', exact: true }).click();
    await page.waitForTimeout(350);
    const fittedOuter = await page.getByTestId('canvas-subgraph-outer').boundingBox();
    const fittedCanvas = await page.getByTestId('diagram-canvas').boundingBox();
    assert(fittedOuter && fittedCanvas, 'Reloaded section or canvas has no browser bounds.');
    const fitOffset = {
      x: (fittedOuter.x + (fittedOuter.width / 2)) - (fittedCanvas.x + (fittedCanvas.width / 2)),
      y: (fittedOuter.y + (fittedOuter.height / 2)) - (fittedCanvas.y + (fittedCanvas.height / 2)),
    };
    assert(Math.abs(fitOffset.x) <= 16 && Math.abs(fitOffset.y) <= 16,
      `Reload + Fit centered stale Mermaid cluster geometry: ${JSON.stringify(fitOffset)}`);

    const viewport = page.locator('.react-flow__viewport');
    const touchBoundary = page.getByTestId('canvas-subgraph-boundary-outer-1');
    const beforeBoundaryTouch = await Promise.all(nodeLocators.map((node) => node.boundingBox()));
    const cameraBeforeBoundary = await viewport.getAttribute('style');
    await dispatchTouchDrag(cdp, touchBoundary, 42, 24);
    await page.waitForTimeout(250);
    const afterBoundaryTouch = await Promise.all(nodeLocators.map((node) => node.boundingBox()));
    const boundaryTouchDeltas = getDeltas(beforeBoundaryTouch, afterBoundaryTouch);
    assert(deltasMatch(boundaryTouchDeltas, 42, 24),
      `Touch boundary drag did not move every member together: ${JSON.stringify(boundaryTouchDeltas)}`);
    assert(await viewport.getAttribute('style') === cameraBeforeBoundary,
      'Touch boundary drag also moved the canvas camera.');

    const touchHeader = page.getByTestId('canvas-subgraph-header-outer');
    const beforeHeaderTouch = await Promise.all(nodeLocators.map((node) => node.boundingBox()));
    const cameraBeforeHeader = await viewport.getAttribute('style');
    await dispatchTouchDrag(cdp, touchHeader, 30, 18);
    await page.waitForTimeout(250);
    const afterHeaderTouch = await Promise.all(nodeLocators.map((node) => node.boundingBox()));
    const headerTouchDeltas = getDeltas(beforeHeaderTouch, afterHeaderTouch);
    assert(deltasMatch(headerTouchDeltas, 30, 18),
      `Touch header drag did not move every member together: ${JSON.stringify(headerTouchDeltas)}`);
    assert(await viewport.getAttribute('style') === cameraBeforeHeader,
      'Touch header drag also moved the canvas camera.');
    const movedSectionRevisionId = await waitForMovedSectionRevision(mcp, room.sessionId);

    await replaceSource(page, IMPLICIT_SOURCE);
    await page.waitForFunction((expected) => (
      [...document.querySelectorAll('.cm-line')].map((line) => line.textContent ?? '').join('\n') === expected
    ), IMPLICIT_SOURCE, { timeout: 15_000 });
    await ensureSourceClosed(page);
    const implicitHeader = page.getByRole('button', { name: 'Select section ImplicitSection', exact: true });
    await implicitHeader.waitFor({ state: 'visible', timeout: 15_000 });
    await implicitHeader.focus();
    await page.keyboard.press('Enter');
    assert(await page.getByTestId('canvas-subgraph-ImplicitSection').getAttribute('data-selected') === 'true',
      'Implicit-title section was not selectable from its keyboard-accessible header.');
    assert(await page.getByRole('button', { name: 'Edit section label', exact: true }).count() === 0,
      'Implicit-title section incorrectly exposed an ambiguous rename action.');
    const implicitNode = page.locator('.react-flow__node[data-id="A"]');
    const implicitBefore = await implicitNode.boundingBox();
    const implicitCameraBefore = await viewport.getAttribute('style');
    await dispatchTouchDrag(cdp, implicitHeader, 38, 22);
    await page.waitForTimeout(250);
    const implicitAfter = await implicitNode.boundingBox();
    const implicitDelta = getDeltas([implicitBefore], [implicitAfter]);
    assert(deltasMatch(implicitDelta, 38, 22),
      `Implicit-title section did not retain group dragging: ${JSON.stringify(implicitDelta)}`);
    assert(await viewport.getAttribute('style') === implicitCameraBefore,
      'Implicit-title section touch drag also moved the canvas camera.');

    await ensureSourceOpen(page);
    assert(await readSource(page) === IMPLICIT_SOURCE, 'Implicit-title selection or drag changed canonical Mermaid source.');
    await ensureSourceClosed(page);

    await page.getByTestId('activity-flyout-toggle').click();
    const activityFlyout = page.getByTestId('activity-flyout');
    await activityFlyout.waitFor({ state: 'visible', timeout: 15_000 });
    await activityFlyout.getByRole('button', { name: 'History', exact: true }).click();
    const movedRevisionItem = page.getByTestId(`history-revision-${movedSectionRevisionId}`);
    await movedRevisionItem.waitFor({ state: 'visible', timeout: 15_000 });
    await movedRevisionItem.getByRole('button', { name: 'Preview', exact: true }).click();
    await page.getByTestId('history-preview-notice').waitFor({ state: 'visible', timeout: 15_000 });
    const previewOuter = page.getByTestId('canvas-subgraph-outer');
    try {
      await previewOuter.waitFor({ state: 'visible', timeout: 15_000 });
    } catch (error) {
      const banner = await page.getByTestId('parse-error-banner').textContent().catch(() => null);
      const canvasText = await page.getByTestId('diagram-canvas').textContent().catch(() => null);
      throw new Error(`Moved history preview did not render its section. banner=${JSON.stringify(banner)} canvas=${JSON.stringify(canvasText)}`, { cause: error });
    }
    assert(await page.getByTestId('canvas-subgraph-ImplicitSection').count() === 0,
      'History preview did not switch from the live implicit section to the moved nested revision.');
    const previewCanvas = page.getByTestId('diagram-canvas');
    const previewOuterHeader = page.getByTestId('canvas-subgraph-header-outer');
    await previewOuterHeader.focus();
    await page.waitForFunction(() => (
      document.activeElement?.getAttribute('data-testid') === 'canvas-subgraph-header-outer'
    ), undefined, { timeout: 5_000 });
    const previewViewport = page.locator('.react-flow__viewport');
    const transformBeforeHistoryZoom = await previewViewport.getAttribute('style');
    await page.keyboard.press(getCameraPerturbationKey(transformBeforeHistoryZoom));
    await page.waitForFunction((previous) => (
      document.querySelector('.react-flow__viewport')?.getAttribute('style') !== previous
    ), transformBeforeHistoryZoom, { timeout: 5_000 });
    await page.waitForFunction(() => (
      document.activeElement?.getAttribute('data-testid') === 'canvas-subgraph-header-outer'
    ), undefined, { timeout: 5_000 });
    const transformBeforeHistoryFit = await previewViewport.getAttribute('style');
    await page.keyboard.press('f');
    await page.waitForFunction((previous) => (
      document.querySelector('.react-flow__viewport')?.getAttribute('style') !== previous
    ), transformBeforeHistoryFit, { timeout: 5_000 });
    await page.waitForFunction(() => {
      const section = document.querySelector('[data-testid="canvas-subgraph-outer"]');
      const canvas = document.querySelector('[data-testid="diagram-canvas"]');
      const flyout = document.querySelector('[data-testid="activity-flyout"]');
      if (!(section instanceof HTMLElement) || !(canvas instanceof HTMLElement) || !(flyout instanceof HTMLElement)) return false;
      const sectionBounds = section.getBoundingClientRect();
      const canvasBounds = canvas.getBoundingClientRect();
      const flyoutBounds = flyout.getBoundingClientRect();
      const safeRight = Math.min(canvasBounds.right, flyoutBounds.left);
      const x = (sectionBounds.left + (sectionBounds.width / 2)) - (canvasBounds.left + ((safeRight - canvasBounds.left) / 2));
      const y = (sectionBounds.top + (sectionBounds.height / 2)) - (canvasBounds.top + (canvasBounds.height / 2));
      return Math.abs(x) <= 16 && Math.abs(y) <= 16;
    }, undefined, { timeout: 5_000 });
    const previewOuterBounds = await previewOuter.boundingBox();
    const previewCanvasBounds = await previewCanvas.boundingBox();
    const previewFlyoutBounds = await activityFlyout.boundingBox();
    assert(previewOuterBounds && previewCanvasBounds && previewFlyoutBounds,
      'Read-only history section, canvas, or history flyout has no browser bounds.');
    const previewSafeRight = Math.min(
      previewCanvasBounds.x + previewCanvasBounds.width,
      previewFlyoutBounds.x,
    );
    const historyFitOffset = {
      x: (previewOuterBounds.x + (previewOuterBounds.width / 2))
        - (previewCanvasBounds.x + ((previewSafeRight - previewCanvasBounds.x) / 2)),
      y: (previewOuterBounds.y + (previewOuterBounds.height / 2))
        - (previewCanvasBounds.y + (previewCanvasBounds.height / 2)),
    };
    assert(Math.abs(historyFitOffset.x) <= 16 && Math.abs(historyFitOffset.y) <= 16,
      `Read-only history Fit centered stale Mermaid cluster geometry: ${JSON.stringify(historyFitOffset)}`);

    await page.screenshot({ path: '/tmp/arielcharts-subgraph-editing.png' });
    console.log(`subgraph review gates PASS mouse=${JSON.stringify(deltas)} boundaryTouch=${JSON.stringify(boundaryTouchDeltas)} headerTouch=${JSON.stringify(headerTouchDeltas)} fitOffset=${JSON.stringify(fitOffset)} historyFitOffset=${JSON.stringify(historyFitOffset)} keys=${Object.keys(positions).sort().join(',')}`);
  } finally {
    durableObserver.destroy();
    await browser.close();
  }
}

withOwnedServices(validate).catch((error) => {
  console.error(error);
  process.exit(1);
});
