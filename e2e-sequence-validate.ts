import { existsSync } from 'node:fs';
import { chromium, type Locator, type Page } from '@playwright/test';

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

async function assertSameTabKindTransition(page: Page): Promise<boolean> {
  const node = page.locator('.react-flow__node').first();
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
  const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
  const baseUrl = process.env.E2E_BASE_URL ?? 'http://localhost:3003';
  const sessionName = `e2e-sequence-${Date.now()}`;

  try {
    await page.goto(`${baseUrl}/s/${sessionName}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await replaceSource(page, FLOWCHART_FIXTURE);
    await waitForCanvas(page, 'flowchart');
    const sameTabTransition = await assertSameTabKindTransition(page);

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

    const zoomChangedTransform = fittedTransform !== afterZoomTransform;
    const fitChangedTransform = baselineTransform !== fittedTransform;
    const fitRestoredTransform = settledRestoredFitTransform === fittedTransform;
    const panChangedTransform = settledRestoredFitTransform !== afterPanTransform;
    const passed = zoomChangedTransform
      && fitChangedTransform
      && panChangedTransform
      && genericFitBounds.fits
      && fitRestoredTransform
      && sameTabTransition
      && flowchartRestored
      && invalidPreviewRetained
      && invalidDoesNotLeak;
    console.log(`generic zoom transform changed=${zoomChangedTransform}`);
    console.log(`generic Fit transform changed=${fitChangedTransform} restored=${fitRestoredTransform}`);
    console.log(`generic Fit bounds=${genericFitBounds.fits} transform=${fittedTransform} viewBox=${genericFitBounds.viewBox} style=${genericFitBounds.svgStyle} svg=${JSON.stringify(genericFitBounds.svg)} canvas=${JSON.stringify(genericFitBounds.canvas)}`);
    console.log(`generic Space-drag transform changed=${panChangedTransform}`);
    console.log(`same-tab flowchart/sequence transition=${sameTabTransition}`);
    console.log(`flowchart controls restore=${flowchartRestored}`);
    console.log(`invalid generic preview retained=${invalidPreviewRetained}`);
    console.log(`invalid state isolated=${invalidDoesNotLeak}`);
    console.log(passed ? 'SEQUENCE E2E PASSED' : 'SEQUENCE E2E FAILED');
    if (!passed) process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

validateSequenceCanvas().catch((error) => {
  console.error(error);
  process.exit(1);
});
