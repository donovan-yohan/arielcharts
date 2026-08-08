import { existsSync } from 'node:fs';
import { chromium, type Locator, type Page } from '@playwright/test';
import {
  assertNoPageErrors,
  assertNoReactFlowError015,
  collectReactFlowDiagnostics,
  getReactFlowNodePosition,
  type ReactFlowError015Diagnostic,
  waitForReactFlowNodePositionMovement,
  waitForReactFlowNodePositions,
} from './e2e/support/react-flow';

const FLOWCHART_FIXTURE = `flowchart LR
  A[Main] --> B[Done]`;

const API_SEQUENCE_FIXTURE = `sequenceDiagram
  autonumber
  participant Browser
  participant Gateway
  participant Auth
  participant Service
  participant DB
  Browser->>Gateway: POST /orders
  activate Gateway
  Gateway->>Auth: validate token
  Auth-->>Gateway: approved
  Gateway->>Service: create order
  activate Service
  Service->>DB: INSERT order
  DB-->>Service: order id
  Service-->>Gateway: 201 Created
  deactivate Service
  Gateway-->>Browser: 201 Created
  deactivate Gateway
  Browser->>Gateway: POST /orders (expired token)
  Gateway->>Auth: validate token
  Auth-->>Gateway: 401 Unauthorized
  Gateway-->>Browser: 401 Unauthorized`;

async function ensureSourceFlyoutOpen(page: Page): Promise<Locator> {
  const toggle = page.getByTestId('source-flyout-toggle');
  if (await toggle.getAttribute('aria-expanded') !== 'true') {
    await toggle.click();
  }

  const editor = page.locator('.cm-content');
  await editor.waitFor({ state: 'visible', timeout: 15000 });
  return editor;
}

async function closeSourceFlyout(page: Page): Promise<void> {
  const toggle = page.getByTestId('source-flyout-toggle');
  if (await toggle.getAttribute('aria-expanded') === 'true') {
    await toggle.click();
    await page.getByTestId('source-flyout').waitFor({ state: 'detached', timeout: 15000 });
  }
}

async function replaceSource(page: Page, source: string): Promise<void> {
  const editor = await ensureSourceFlyoutOpen(page);
  await editor.click();
  await page.keyboard.press('Control+A');
  await page.keyboard.type(source, { delay: 1 });
}

async function waitForCanvas(page: Page, mode: 'flowchart' | 'generic'): Promise<void> {
  await page.waitForFunction((expectedMode) => {
    const modeLabel = document.querySelector('[data-testid="diagram-mode"]')?.textContent ?? '';
    const svg = document.querySelector('.diagram-canvas-svg svg');
    const structuralTools = document.querySelector('form[aria-label="Add Mermaid node"]');
    return !!svg?.getAttribute('viewBox')
      && (expectedMode === 'flowchart' ? !!structuralTools && modeLabel.includes('editable') : !structuralTools && modeLabel.includes('source only'));
  }, mode, { timeout: 15000 });
}

async function waitForTransformChange(page: Page, layer: Locator, previous: string | null): Promise<string | null> {
  await page.waitForFunction((lastTransform) => {
    const layerElement = document.querySelector('.diagram-canvas-svg')?.parentElement;
    return layerElement?.getAttribute('style') !== lastTransform;
  }, previous, { timeout: 5000 });
  return layer.getAttribute('style');
}

interface GenericFitBounds {
  fits: boolean;
  svgStyle: string | null;
  viewBox: string | null;
  svg: { bottom: number; height: number; left: number; right: number; top: number; width: number };
  canvas: { bottom: number; height: number; left: number; right: number; top: number; width: number };
}

async function getGenericFitBounds(page: Page): Promise<GenericFitBounds> {
  return page.evaluate(() => {
    const canvas = document.querySelector('[aria-label="Interactive diagram canvas"]');
    const svg = document.querySelector('.diagram-canvas-svg svg');
    if (!(canvas instanceof HTMLElement) || !(svg instanceof SVGSVGElement)) {
      return { canvas: { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 }, fits: false, svg: { bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0 }, svgStyle: null, viewBox: null };
    }

    const canvasBounds = canvas.getBoundingClientRect();
    const svgBounds = svg.getBoundingClientRect();
    const fits = svgBounds.width <= canvasBounds.width - 96
      && svgBounds.height <= canvasBounds.height - 96
      && svgBounds.left >= canvasBounds.left
      && svgBounds.top >= canvasBounds.top
      && svgBounds.right <= canvasBounds.right
      && svgBounds.bottom <= canvasBounds.bottom;
    return {
      canvas: { bottom: canvasBounds.bottom, height: canvasBounds.height, left: canvasBounds.left, right: canvasBounds.right, top: canvasBounds.top, width: canvasBounds.width },
      fits,
      svg: { bottom: svgBounds.bottom, height: svgBounds.height, left: svgBounds.left, right: svgBounds.right, top: svgBounds.top, width: svgBounds.width },
      svgStyle: svg.getAttribute('style'),
      viewBox: svg.getAttribute('viewBox'),
    };
  });
}

function nodeById(page: Page, id: string): Locator {
  return page.locator(`.react-flow__node[data-id=${JSON.stringify(id)}]`);
}

async function assertMultiSelectedNodeDrag(
  page: Page,
  peer: Page,
  reactFlowError015: ReactFlowError015Diagnostic[],
): Promise<boolean> {
  const first = page.locator('.react-flow__node').nth(0);
  const second = page.locator('.react-flow__node').nth(1);
  const firstId = await first.getAttribute('data-id');
  const secondId = await second.getAttribute('data-id');
  if (!firstId || !secondId || firstId === secondId) throw new Error('Group-drag fixture requires two stable node IDs.');
  await Promise.all([
    nodeById(peer, firstId).waitFor({ state: 'visible', timeout: 15_000 }),
    nodeById(peer, secondId).waitFor({ state: 'visible', timeout: 15_000 }),
  ]);
  await first.click();
  await page.waitForFunction((selectedId) => {
    const selected = [...document.querySelectorAll<HTMLElement>('.react-flow__node.selected')];
    return selected.length === 1 && selected[0]?.dataset.id === selectedId;
  }, firstId, { timeout: 5_000 });
  await second.click({ modifiers: ['Shift'] });
  await page.waitForFunction((selectedIds) => {
    const selected = [...document.querySelectorAll<HTMLElement>('.react-flow__node.selected')]
      .map((node) => node.dataset.id)
      .sort();
    return selected.length === 2 && selected.every((id, index) => id === selectedIds[index]);
  }, [firstId, secondId].sort(), { timeout: 5_000 });

  const beforeFirst = await getReactFlowNodePosition(first, 'Could not parse first selected node position.');
  const beforeSecond = await getReactFlowNodePosition(second, 'Could not parse second selected node position.');
  const bounds = await first.boundingBox();
  if (!bounds) throw new Error('Selected node has no drag bounds.');
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 + 96, bounds.y + bounds.height / 2 + 28, { steps: 8 });
  await page.mouse.up();
  assertNoReactFlowError015(reactFlowError015, 'during a multi-selected node drag');
  await waitForReactFlowNodePositionMovement(page, firstId, beforeFirst);

  const afterFirst = await getReactFlowNodePosition(first, 'Could not parse first dragged node position.');
  const afterSecond = await getReactFlowNodePosition(second, 'Could not parse second dragged node position.');
  const firstDelta = { x: afterFirst.x - beforeFirst.x, y: afterFirst.y - beforeFirst.y };
  const secondDelta = { x: afterSecond.x - beforeSecond.x, y: afterSecond.y - beforeSecond.y };
  const primaryMoved = Math.hypot(firstDelta.x, firstDelta.y) >= 8;
  const groupMovedTogether = Math.abs(firstDelta.x - secondDelta.x) <= 2
    && Math.abs(firstDelta.y - secondDelta.y) <= 2;
  if (!primaryMoved || !groupMovedTogether) {
    throw new Error(`Multi-selected nodes did not drag together: first=${JSON.stringify(firstDelta)} second=${JSON.stringify(secondDelta)}`);
  }
  await waitForReactFlowNodePositions(peer, { [firstId]: afterFirst, [secondId]: afterSecond });
  return true;
}

async function assertSameTabKindTransition(page: Page): Promise<boolean> {
  const node = page.locator('.react-flow__node').first();
  const nodeId = await node.getAttribute('data-id');
  if (!nodeId) throw new Error('Single-node drag fixture requires a stable node ID.');
  await closeSourceFlyout(page);
  await page.locator('.react-flow__pane').click({ position: { x: 8, y: 8 } });
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node.selected').length === 0, undefined, { timeout: 5_000 });
  await node.click();
  await page.waitForFunction((selectedId) => {
    const selected = [...document.querySelectorAll<HTMLElement>('.react-flow__node.selected')];
    return selected.length === 1 && selected[0]?.dataset.id === selectedId;
  }, nodeId, { timeout: 5_000 });
  const nodeBounds = await node.boundingBox();
  if (!nodeBounds) return false;

  await page.mouse.move(nodeBounds.x + (nodeBounds.width / 2), nodeBounds.y + (nodeBounds.height / 2));
  await page.mouse.down();
  await page.mouse.move(nodeBounds.x + (nodeBounds.width / 2) + 120, nodeBounds.y + (nodeBounds.height / 2) + 32, { steps: 8 });
  await page.mouse.up();
  const resetLayout = page.locator('button[aria-label="Reset shared layout to Mermaid"]');
  await resetLayout.waitFor({ state: 'visible', timeout: 10000 });

  await replaceSource(page, API_SEQUENCE_FIXTURE);
  await waitForCanvas(page, 'generic');
  const genericWithholdsStructure = await page.locator('form[aria-label="Add Mermaid node"]').count() === 0
    && await page.locator('button[aria-label="Reset shared layout to Mermaid"]').count() === 0
    && await page.locator('button[aria-label="Connect nodes"]').count() === 0;

  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  return genericWithholdsStructure && await resetLayout.count() > 0;
}

async function validateSequenceCanvas() {
  const chromiumPath = process.env.PLAYWRIGHT_CHROMIUM_PATH ?? (existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined);
  const browser = await chromium.launch({ executablePath: chromiumPath, headless: true });
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const diagnostics = collectReactFlowDiagnostics(page);
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3003';
  const sessionName = `e2e-sequence-${Date.now()}`;

  try {
    await page.goto(`${baseUrl}/s/${sessionName}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await replaceSource(page, FLOWCHART_FIXTURE);
    await waitForCanvas(page, 'flowchart');
    const peer = await page.context().newPage();
    const peerDiagnostics = collectReactFlowDiagnostics(peer);
    let multiSelectedDrag: boolean;
    try {
      await peer.goto(`${baseUrl}/s/${sessionName}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await waitForCanvas(peer, 'flowchart');
      multiSelectedDrag = await assertMultiSelectedNodeDrag(page, peer, diagnostics.reactFlowError015);
      assertNoPageErrors(peerDiagnostics.pageErrors, 'in the fresh persistence peer');
    } finally {
      await peer.close();
    }
    assertNoReactFlowError015(diagnostics.reactFlowError015, 'during a multi-selected node drag');
    const sameTabTransition = await assertSameTabKindTransition(page);
    assertNoReactFlowError015(diagnostics.reactFlowError015, 'during a single-node drag');

    await page.getByTestId('create-diagram-tab').click();
    await replaceSource(page, API_SEQUENCE_FIXTURE);
    await waitForCanvas(page, 'generic');
    await closeSourceFlyout(page);
    await page.waitForTimeout(300);

    const canvas = page.locator('[aria-label="Interactive diagram canvas"]');
    const transformedLayer = page.locator('.diagram-canvas-svg').locator('..');
    const baselineTransform = await transformedLayer.getAttribute('style');
    await page.locator('button[aria-label="Fit diagram"]').click();
    await waitForTransformChange(page, transformedLayer, baselineTransform);
    await page.waitForTimeout(240);
    const fittedTransform = await transformedLayer.getAttribute('style');
    await page.waitForTimeout(240);
    const genericFitBounds = await getGenericFitBounds(page);
    await page.locator('button[aria-label="Zoom in"]').click();
    const afterZoomTransform = await waitForTransformChange(page, transformedLayer, fittedTransform);
    await page.locator('button[aria-label="Fit diagram"]').click();
    await waitForTransformChange(page, transformedLayer, afterZoomTransform);
    await page.waitForTimeout(240);
    const settledRestoredFitTransform = await transformedLayer.getAttribute('style');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('Generic canvas has no bounds.');
    await page.keyboard.down('Space');
    await page.mouse.move(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(canvasBox.x + canvasBox.width / 2 + 96, canvasBox.y + canvasBox.height / 2 + 48, { steps: 8 });
    await page.mouse.up();
    await page.keyboard.up('Space');
    await page.waitForTimeout(100);
    const afterPanTransform = await transformedLayer.getAttribute('style');
    await page.screenshot({ path: '/tmp/arielcharts-sequence.png' });

    const tabs = page.getByRole('tab');
    await tabs.nth(0).click();
    await waitForCanvas(page, 'flowchart');
    const flowchartRestored = (await page.locator('.diagram-canvas-svg svg').textContent())?.includes('Main') ?? false;

    await tabs.nth(1).click();
    await waitForCanvas(page, 'generic');
    await replaceSource(page, 'not valid Mermaid');
    await page.getByTestId('parse-error-banner').waitFor({ state: 'visible', timeout: 15000 });
    const invalidPreviewRetained = await page.locator('.diagram-canvas-svg svg').count() > 0;

    await tabs.nth(0).click();
    await waitForCanvas(page, 'flowchart');
    const invalidDoesNotLeak = await page.getByTestId('parse-error-banner').count() === 0;

    await page.screenshot({ path: '/tmp/arielcharts-sequence-isolation.png' });
    assertNoPageErrors(diagnostics.pageErrors, 'during the sequence canvas gate');

    const zoomChangedTransform = fittedTransform !== afterZoomTransform;
    const fitChangedTransform = baselineTransform !== fittedTransform;
    const fitRestoredTransform = settledRestoredFitTransform === fittedTransform;
    const panChangedTransform = settledRestoredFitTransform !== afterPanTransform;
    const passed = zoomChangedTransform
      && fitChangedTransform
      && panChangedTransform
      && genericFitBounds.fits
      && fitRestoredTransform
      && multiSelectedDrag
      && sameTabTransition
      && flowchartRestored
      && invalidPreviewRetained
      && invalidDoesNotLeak;
    console.log(`generic zoom transform changed=${zoomChangedTransform}`);
    console.log(`generic Fit transform changed=${fitChangedTransform} restored=${fitRestoredTransform}`);
    console.log(`generic Fit bounds=${genericFitBounds.fits} transform=${fittedTransform} viewBox=${genericFitBounds.viewBox} style=${genericFitBounds.svgStyle} svg=${JSON.stringify(genericFitBounds.svg)} canvas=${JSON.stringify(genericFitBounds.canvas)}`);
    console.log(`generic Space-drag transform changed=${panChangedTransform}`);
    console.log(`multi-selected nodes drag together and persist to fresh peer=${multiSelectedDrag}`);
    console.log(`same-tab flowchart/sequence transition=${sameTabTransition}`);
    console.log(`flowchart controls restore=${flowchartRestored}`);
    console.log(`invalid generic preview retained=${invalidPreviewRetained}`);
    console.log(`invalid state isolated=${invalidDoesNotLeak}`);
    console.log(passed ? 'SEQUENCE E2E PASSED' : 'SEQUENCE E2E FAILED');
    if (!passed) process.exitCode = 1;
  } finally {
    try {
      await context.close();
    } finally {
      await browser.close();
    }
  }
}

validateSequenceCanvas().catch((error) => {
  console.error(error);
  process.exit(1);
});
