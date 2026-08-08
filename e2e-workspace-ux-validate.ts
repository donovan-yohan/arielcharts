import type { Locator, Page } from '@playwright/test';
import {
  DESKTOP_VIEWPORT,
  MOBILE_VIEWPORT,
  NARROW_MOBILE_VIEWPORT,
  TABLET_VIEWPORT,
  launchBrowserHarness,
  saveScreenshot,
} from './e2e/support/browser.ts';
import { assert, describeError } from './e2e/support/assert.ts';
import {
  assertAnchorsStable,
  assertContainedInViewport,
  assertContrastAtLeast,
  assertDocumentHasNoHorizontalOverflow,
  assertExactColor,
  assertHitTarget,
  assertNeutralColor,
  snapshotAnchors,
  verifiedClick,
} from './e2e/support/interactions.ts';
import { ModernMcpClient } from './e2e/support/mcp.ts';
import { withOwnedServices } from './e2e/support/owned-services.ts';
import { STARTER_TEMPLATES } from './packages/shared/src/starter-templates.js';
import {
  API_SEQUENCE_FIXTURE,
  FLOWCHART_FIXTURE,
  INVALID_MERMAID_FIXTURE,
  activeTabName,
  canonicalSource,
  closeFlyout,
  createDiagramFromTemplate,
  ensureFlyout,
  ensureSourceFlyoutOpen,
  openTemplateMenu,
  renameActiveDiagram,
  replaceSource,
  selectTabByName,
  templateMenuItem,
  visitWorkspace,
  waitForCanvas,
  waitForInvalidPreview,
  waitForSource,
  waitForSyncedSource,
} from './e2e/support/workspace.ts';

const ANCHORS = {
  canvas: '[data-testid="canvas-first-workspace"]',
  footer: '[data-testid="workspace-footer"]',
  tabBar: '[data-testid="diagram-tab-bar"]',
  topbar: '.workspace-topbar',
};

const SOURCE_OWNED_COLOR_FIXTURE = `flowchart LR
  classDef critical fill:#ffec99,stroke:#d9480f,color:#4a2c00;
  Browser[Browser]:::critical --> Gateway[Gateway]
  Gateway --> Service[Service]`;

const TRANSPARENT_MERMAID_FIXTURE = `flowchart LR
  classDef ghost fill:none,stroke:transparent,color:transparent;
  Ghost[Ghost]:::ghost --> Visible[Visible]`;

const ACTIVITY_FIT_VIEWPORT = { width: 1487, height: 1058 } as const;
const SAFE_FLYOUT_MARGIN = 16;

function record(results: string[], name: string): void {
  results.push(name);
  console.log(`PASS ${name}`);
}

async function waitForFocusedTestId(page: Page, testId: string, label: string): Promise<void> {
  try {
    await page.waitForFunction((expectedTestId) => document.activeElement?.getAttribute('data-testid') === expectedTestId, testId, { timeout: 5_000 });
  } catch {
    const active = await page.evaluate(() => ({
      ariaLabel: document.activeElement?.getAttribute('aria-label'),
      role: document.activeElement?.getAttribute('role'),
      tag: document.activeElement?.tagName,
      testId: document.activeElement?.getAttribute('data-testid'),
      text: document.activeElement?.textContent?.trim().slice(0, 80),
    }));
    throw new Error(`${label} did not restore focus to [data-testid=${JSON.stringify(testId)}]; active=${JSON.stringify(active)}.`);
  }
}

async function waitForFocusedLocator(page: Page, target: Locator, label: string): Promise<void> {
  try {
    await target.waitFor({ state: 'visible', timeout: 5_000 });
    const element = await target.elementHandle();
    assert(element, `${label} has no focusable element.`);
    await page.waitForFunction((candidate) => document.activeElement === candidate, element, { timeout: 5_000 });
  } catch {
    const active = await page.evaluate(() => ({
      ariaLabel: document.activeElement?.getAttribute('aria-label'),
      role: document.activeElement?.getAttribute('role'),
      text: document.activeElement?.textContent?.trim().slice(0, 80),
    }));
    throw new Error(`${label} did not receive focus: active=${JSON.stringify(active)}.`);
  }
}

async function canvasTransform(page: Page): Promise<string | null> {
  const layer = page.locator('.diagram-canvas-svg').locator('..');
  if (await layer.count() === 0) return null;
  return layer.getAttribute('style');
}

async function assertTemplateIdentityAbsent(page: Page): Promise<void> {
  const renderedDocument = await page.locator('html').innerHTML();
  for (const { id } of STARTER_TEMPLATES) {
    assert(!renderedDocument.includes(id), `Creation-time template identity leaked into rendered document markup: ${id}.`);
  }
}

async function renderedCanvasTransform(page: Page, label: string): Promise<string> {
  const transform = await canvasTransform(page);
  assert(transform !== null, `${label} requires a rendered canvas camera layer.`);
  return transform;
}

async function expectTemplateMenu(page: Page): Promise<string> {
  const trigger = page.getByTestId('create-diagram-tab');
  await assertHitTarget(page, trigger, 'always-visible template creation control');
  const before = await snapshotAnchors(page, ANCHORS);
  const beforeTransform = await canvasTransform(page);
  const menu = await openTemplateMenu(page);
  await assertDocumentHasNoHorizontalOverflow(page);
  await assertContainedInViewport(page, menu, 'desktop starter template menu');
  const blank = templateMenuItem(page, 'Blank sheet');
  const apiSequence = templateMenuItem(page, 'End-to-end API sequence');
  const deployment = templateMenuItem(page, 'Deployment architecture');
  const labels = (await menu.getByRole('menuitem').allTextContents()).map((value) => value.trim());
  assert(labels[0]?.startsWith('Blank sheet'), `Blank sheet is not first in the template menu: ${JSON.stringify(labels)}.`);
  await waitForFocusedLocator(page, blank, 'Opening template menu');
  const tabStops = await menu.getByRole('menuitem').evaluateAll((items) => items.map((item) => ({
    tabIndex: (item as HTMLElement).tabIndex,
    text: item.textContent?.trim() ?? '',
  })).filter((item) => item.tabIndex === 0));
  assert(tabStops.length === 1 && tabStops[0]?.text.startsWith('Blank sheet'),
    `Template menu must begin with only Blank sheet in the tab order: ${JSON.stringify(tabStops)}.`);
  await saveScreenshot(page, 'issue-15-light-template-menu');
  await blank.press('Tab');
  await menu.waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, 'source-flyout-toggle', 'Tabbing forward out of the template menu');

  await openTemplateMenu(page);
  await waitForFocusedLocator(page, blank, 'Reopening template menu after Tab exit');
  await blank.press('ArrowDown');
  await waitForFocusedLocator(page, apiSequence, 'ArrowDown in template menu');
  await apiSequence.press('ArrowUp');
  await waitForFocusedLocator(page, blank, 'ArrowUp in template menu');
  await blank.press('ArrowDown');
  await waitForFocusedLocator(page, apiSequence, 'ArrowDown adjacency check in template menu');
  await apiSequence.press('Home');
  await waitForFocusedLocator(page, blank, 'Home in template menu');
  await blank.press('End');
  await waitForFocusedLocator(page, deployment, 'End in template menu');
  await deployment.press('Escape');
  await menu.waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, 'create-diagram-tab', 'Closing template menu with Escape');
  assertAnchorsStable(before, await snapshotAnchors(page, ANCHORS));
  assert(await canvasTransform(page) === beforeTransform, 'Opening and closing the template menu changed the canvas camera.');

  await verifiedClick(page, page.getByTestId('theme-control').getByRole('button', { name: 'Dark', exact: true }), 'dark theme control for template menu');
  await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached', timeout: 5_000 });
  await openTemplateMenu(page);
  await saveScreenshot(page, 'issue-15-dark-template-menu');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached', timeout: 15_000 });
  await verifiedClick(page, page.getByTestId('theme-control').getByRole('button', { name: 'Light', exact: true }), 'light theme control after template menu screenshots');
  await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 5_000 });

  const outsideBefore = await snapshotAnchors(page, ANCHORS);
  const outsideBeforeTransform = await canvasTransform(page);
  await openTemplateMenu(page);
  await page.locator('.workspace-logo').click();
  await menu.waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, 'create-diagram-tab', 'Closing template menu from nonfocusable page chrome');
  assertAnchorsStable(outsideBefore, await snapshotAnchors(page, ANCHORS));
  assert(await canvasTransform(page) === outsideBeforeTransform, 'Outside-closing the template menu changed the canvas camera.');

  await openTemplateMenu(page);
  const sourceToggle = page.getByTestId('source-flyout-toggle');
  await sourceToggle.click();
  await menu.waitFor({ state: 'detached', timeout: 15_000 });
  await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await waitForFocusedLocator(page, page.locator('.cm-content'), 'Clicking an interactive control outside the template menu');
  assert(await trigger.evaluate((element) => document.activeElement !== element),
    'Clicking an interactive control outside the template menu had its focus stolen by the creation trigger.');
  await closeFlyout(page, 'source');

  const blankName = await createDiagramFromTemplate(page, 'Blank sheet');
  await waitForFocusedLocator(page, page.getByRole('tab', { name: blankName, exact: true }), 'Creating a template diagram');
  await ensureSourceFlyoutOpen(page);
  assert(await canonicalSource(page) === '', 'Blank starter template did not create empty Mermaid source.');
  await closeFlyout(page, 'source');
  return blankName;
}

async function expectTemplateDiagramCreation(page: Page): Promise<void> {
  const flowchartName = await createDiagramFromTemplate(page, 'Service / system flowchart');
  await waitForCanvas(page, 'flowchart');
  assert(await page.locator('form[aria-label="Add Mermaid node"]').count() === 1,
    'Service flowchart template did not expose structural controls.');
  await renameActiveDiagram(page, 'Service API flow');
  await ensureSourceFlyoutOpen(page);
  const flowchartSource = await canonicalSource(page);
  await replaceSource(page, `${flowchartSource}\n  Service --> Audit[Audit log]`);
  await waitForSource(page, `${flowchartSource}\n  Service --> Audit[Audit log]`);
  await waitForCanvas(page, 'flowchart');
  await closeFlyout(page, 'source');
  await saveScreenshot(page, 'issue-15-service-flowchart');

  const sequenceName = await createDiagramFromTemplate(page, 'End-to-end API sequence');
  await waitForCanvas(page, 'generic');
  assert(await page.locator('form[aria-label="Add Mermaid node"]').count() === 0,
    'API sequence template retained flowchart structural controls.');
  await renameActiveDiagram(page, 'API request timing');
  await ensureSourceFlyoutOpen(page);
  const sequenceSource = await canonicalSource(page);
  await replaceSource(page, `${sequenceSource}\n  Note over Client,API: traced in live coding`);
  await waitForSource(page, `${sequenceSource}\n  Note over Client,API: traced in live coding`);
  await waitForCanvas(page, 'generic');
  await closeFlyout(page, 'source');
  await saveScreenshot(page, 'issue-15-api-sequence');
  await assertTemplateIdentityAbsent(page);
  assert(flowchartName !== sequenceName, 'Flowchart and sequence templates reused the same created tab.');
}

async function expectStableFlyoutAnchors(page: Page, label: string): Promise<void> {
  const before = await snapshotAnchors(page, ANCHORS);
  await ensureFlyout(page, 'source');
  const afterOpen = await snapshotAnchors(page, ANCHORS);
  assertAnchorsStable(before, afterOpen);
  await closeFlyout(page, 'source');
  const afterClose = await snapshotAnchors(page, ANCHORS);
  assertAnchorsStable(before, afterClose);
  console.log(`anchors stable ±1px (${label})`);
}

async function expectFlyoutExclusivity(page: Page): Promise<void> {
  await ensureFlyout(page, 'source');
  await verifiedClick(page, page.getByTestId('activity-flyout-toggle'), 'activity flyout toggle');
  await page.getByTestId('activity-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('source-flyout').waitFor({ state: 'detached', timeout: 15_000 });
  assert(await page.getByTestId('source-flyout-toggle').getAttribute('aria-expanded') === 'false', 'Source flyout remained expanded behind activity.');
  await closeFlyout(page, 'activity');
}

async function expectFlyoutFocusAndEscape(page: Page): Promise<void> {
  const sourceToggle = page.getByTestId('source-flyout-toggle');
  await verifiedClick(page, sourceToggle, 'source flyout toggle');
  await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await page.keyboard.press('Escape');
  await page.getByTestId('source-flyout').waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, 'source-flyout-toggle', 'Closing source with Escape');
  assert(await sourceToggle.evaluate((element) => document.activeElement === element), 'Closing source with Escape did not return focus to its toggle.');

  const activityToggle = page.getByTestId('activity-flyout-toggle');
  await verifiedClick(page, activityToggle, 'activity flyout toggle');
  const closeActivity = page.getByLabel('Close activity history', { exact: true });
  await closeActivity.waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Close activity history', undefined, { timeout: 5_000 });
  await saveScreenshot(page, 'issue-14-activity-focus');
  await page.keyboard.press('Escape');
  await page.getByTestId('activity-flyout').waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, 'activity-flyout-toggle', 'Closing activity with Escape');
  assert(await activityToggle.evaluate((element) => document.activeElement === element), 'Closing activity with Escape did not return focus to its toggle.');
}

async function expectTabKeyboardAndRename(page: Page, created: string): Promise<string> {
  await selectTabByName(page, created);
  const renamed = 'API timing';
  await renameActiveDiagram(page, renamed);
  await saveScreenshot(page, 'issue-14-rename');
  const mainTab = page.getByRole('tab', { name: 'Main', exact: true });
  await mainTab.focus();
  await mainTab.press('ArrowRight');
  assert(await activeTabName(page) === renamed, 'ArrowRight did not activate the next diagram tab.');
  await page.getByRole('tab', { name: renamed, exact: true }).press('ArrowLeft');
  assert(await activeTabName(page) === 'Main', 'ArrowLeft did not activate the previous diagram tab.');
  await selectTabByName(page, renamed);
  assert(created !== renamed, 'Renaming a blank tab did not change its label.');
  return renamed;
}

async function expectMermaidStatesAndToolbar(page: Page): Promise<void> {
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await saveScreenshot(page, 'issue-14-source');
  await closeFlyout(page, 'source');
  await saveScreenshot(page, 'issue-14-light-canvas');
  await ensureSourceFlyoutOpen(page);
  const nodeLabel = page.getByRole('textbox', { name: 'New node label', exact: true });
  await nodeLabel.fill('Toolbar node');
  await verifiedClick(page, page.getByRole('button', { name: 'Add node to Mermaid text', exact: true }), 'add node toolbar');
  await page.waitForFunction(() => [...document.querySelectorAll('.cm-line')].some((line) => line.textContent?.includes('Toolbar node')), undefined, { timeout: 15_000 });
  assert((await page.locator('.cm-content').textContent())?.includes('Toolbar node'), 'Add-node toolbar did not write Mermaid source.');

  const firstNode = page.locator('.mermaid-flow-node').first();
  await verifiedClick(page, firstNode, 'first diagram node');
  const nodeToolbar = page.getByTestId('canvas-node-toolbar');
  await nodeToolbar.waitFor({ state: 'visible', timeout: 15_000 });
  for (const label of ['Edit label', 'Change shape', 'Connect nodes', 'Delete selected nodes', 'Add node']) {
    await assertHitTarget(page, nodeToolbar.getByRole('button', { name: label, exact: true }), `node toolbar ${label}`);
  }
  await verifiedClick(page, nodeToolbar.getByRole('button', { name: 'Add node', exact: true }), 'node toolbar Add node');
  await page.waitForFunction(() => [...document.querySelectorAll('.cm-line')].some((line) => line.textContent?.includes('New Node')), undefined, { timeout: 15_000 });
  await verifiedClick(page, firstNode, 'first diagram node after add');
  await verifiedClick(page, nodeToolbar.getByRole('button', { name: 'Change shape', exact: true }), 'node toolbar Change shape');
  await verifiedClick(page, page.getByRole('button', { name: 'diamond', exact: true }), 'diamond shape picker action');
  await verifiedClick(page, firstNode, 'first diagram node after shape change');
  await verifiedClick(page, nodeToolbar.getByRole('button', { name: 'Connect nodes', exact: true }), 'node toolbar Connect nodes');
  await page.getByText('click source node [esc cancel]', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await firstNode.click();
  await page.getByText('click target node [esc cancel]', { exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByTestId('diagram-canvas').press('Escape');
  await closeFlyout(page, 'source');
  await saveScreenshot(page, 'issue-14-flowchart-selected');

  await replaceSource(page, SOURCE_OWNED_COLOR_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  const coloredNode = page.locator('.mermaid-flow-node').filter({ hasText: 'Browser' }).first();
  const sourceOwnedColors = await coloredNode.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderTopColor, text: style.color };
  });
  assertExactColor(sourceOwnedColors.background, 'rgb(255, 236, 153)', 'Mermaid classDef #ffec99 fill');
  assertExactColor(sourceOwnedColors.border, 'rgb(217, 72, 15)', 'Mermaid classDef #d9480f stroke');
  assertExactColor(sourceOwnedColors.text, 'rgb(74, 44, 0)', 'Mermaid classDef #4a2c00 text');
  await verifiedClick(page, page.getByTestId('theme-control').getByRole('button', { name: 'Dark', exact: true }), 'dark theme control for source-owned colors');
  await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached', timeout: 5_000 });
  const afterThemeColors = await coloredNode.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderTopColor, text: style.color };
  });
  assertExactColor(afterThemeColors.background, 'rgb(255, 236, 153)', 'Dark Mermaid classDef #ffec99 fill');
  assertExactColor(afterThemeColors.border, 'rgb(217, 72, 15)', 'Dark Mermaid classDef #d9480f stroke');
  assertExactColor(afterThemeColors.text, 'rgb(74, 44, 0)', 'Dark Mermaid classDef #4a2c00 text');
  await closeFlyout(page, 'source');
  await saveScreenshot(page, 'issue-14-dark-canvas');
  await verifiedClick(page, page.getByTestId('theme-control').getByRole('button', { name: 'Light', exact: true }), 'light theme control after source-owned colors');
  await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 5_000 });

  await replaceSource(page, TRANSPARENT_MERMAID_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  const transparentNode = page.locator('.mermaid-flow-node').filter({ hasText: 'Ghost' }).first();
  const transparentColors = await transparentNode.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderTopColor, text: style.color };
  });
  assertExactColor(transparentColors.background, 'rgba(0, 0, 0, 0)', 'Mermaid fill:none background');
  assertExactColor(transparentColors.border, 'rgba(0, 0, 0, 0)', 'Mermaid transparent stroke');
  assertExactColor(transparentColors.text, 'rgba(0, 0, 0, 0)', 'Mermaid transparent text');

  await replaceSource(page, API_SEQUENCE_FIXTURE);
  await waitForCanvas(page, 'generic');
  assert(await page.locator('form[aria-label="Add Mermaid node"]').count() === 0, 'Static Mermaid retained flowchart mutation controls.');
  await closeFlyout(page, 'source');
  await saveScreenshot(page, 'issue-14-sequence-static');

  await replaceSource(page, INVALID_MERMAID_FIXTURE);
  await waitForInvalidPreview(page);
  await saveScreenshot(page, 'issue-14-invalid');
}

async function expectRendererKindFit(page: Page): Promise<void> {
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await closeFlyout(page, 'source');
  const beforeZoom = await renderedCanvasTransform(page, 'Flowchart zoom verification');
  await verifiedClick(page, page.getByRole('button', { name: 'Zoom in', exact: true }), 'zoom in');
  await page.waitForFunction((previous) => document.querySelector('.diagram-canvas-svg')?.parentElement?.getAttribute('style') !== previous, beforeZoom, { timeout: 5_000 });
  const zoomed = await renderedCanvasTransform(page, 'Flowchart zoom result');
  await replaceSource(page, API_SEQUENCE_FIXTURE);
  await waitForCanvas(page, 'generic');
  await closeFlyout(page, 'source');
  await page.waitForFunction((previous) => (
    document.querySelector('.diagram-canvas-svg')?.parentElement?.getAttribute('style') !== previous
  ), zoomed, { timeout: 5_000 });
  const staticTransform = await renderedCanvasTransform(page, 'Static renderer transition');
  assert(staticTransform !== zoomed, `Editable-to-static renderer transition did not fit the camera: ${zoomed}`);
  await verifiedClick(page, page.getByRole('button', { name: 'Fit diagram', exact: true }), 'static renderer fit diagram');
}

async function expectRemoteUpdateWithoutAnchorJump(page: Page, mcp: ModernMcpClient, sessionId: string, diagramName: string): Promise<void> {
  await selectTabByName(page, diagramName);
  await ensureSourceFlyoutOpen(page);
  await waitForSyncedSource(page);
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  const session = await mcp.getSession(sessionId);
  const diagram = session.diagrams.find((candidate) => candidate.name === diagramName);
  assert(diagram, `MCP did not expose diagram ${diagramName}.`);
  const before = await snapshotAnchors(page, ANCHORS);
  const remoteSource = `${FLOWCHART_FIXTURE}\n  Gateway --> Audit[Audit]`;
  await mcp.writeLatest(sessionId, diagram.id, remoteSource);
  await waitForSource(page, remoteSource);
  assertAnchorsStable(before, await snapshotAnchors(page, ANCHORS));
}

async function expectThemeContract(page: Page): Promise<void> {
  const control = page.getByTestId('theme-control');
  assert(await control.count() === 1, 'Accessible ThemeControl is missing from workspace chrome.');

  await verifiedClick(page, control.getByRole('button', { name: 'Light', exact: true }), 'light theme control');
  await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 5_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 5_000 });

  await verifiedClick(page, control.getByRole('button', { name: 'Dark', exact: true }), 'dark theme control');
  await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached', timeout: 5_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached', timeout: 5_000 });

  await page.emulateMedia({ colorScheme: 'light' });
  const storagePeer = await page.context().newPage();
  try {
    await storagePeer.goto(page.url(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await storagePeer.evaluate(() => window.localStorage.clear());
    await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 5_000 });
    assert(await page.evaluate(() => window.localStorage.getItem('arielcharts.theme.v1')) === null,
      'Clearing theme storage in a peer tab did not reset this tab to the system preference.');
  } finally {
    await storagePeer.close();
  }

  await verifiedClick(page, control.getByRole('button', { name: 'System', exact: true }), 'system theme control');
  await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 5_000 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached', timeout: 5_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert(await page.evaluate(() => window.localStorage.getItem('arielcharts.theme.v1')) === 'system', 'System theme preference did not persist across reload.');
}

async function expectUnstyledNodesUseNeutralThemeColors(page: Page): Promise<void> {
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await page.locator('.mermaid-flow-node').first().waitFor({ state: 'visible', timeout: 15_000 });
  await page.locator('.react-flow__edge-path').first().waitFor({ state: 'attached', timeout: 15_000 });
  const node = page.locator('.mermaid-flow-node').filter({ hasText: 'Browser' }).first();
  const colors = async () => page.evaluate(() => {
    const canvas = document.querySelector<HTMLElement>('[data-testid="diagram-canvas"]');
    const unselectedNode = [...document.querySelectorAll<HTMLElement>('.mermaid-flow-node')]
      .find((candidate) => !candidate.classList.contains('is-selected'));
    const edge = document.querySelector<SVGPathElement>('.react-flow__edge:not(.selected) .react-flow__edge-path');
    if (!canvas || !unselectedNode || !edge) {
      throw new Error(`Neutral fallback audit requires an unselected node, edge, and canvas: ${JSON.stringify({
        canvas: !!canvas,
        edgeCount: document.querySelectorAll('.react-flow__edge').length,
        nodes: [...document.querySelectorAll<HTMLElement>('.mermaid-flow-node')].map((candidate) => candidate.className),
        unselectedEdgeCount: document.querySelectorAll('.react-flow__edge:not(.selected) .react-flow__edge-path').length,
      })}`);
    }
    const markerReference = edge.getAttribute('marker-end') ?? '';
    if (!markerReference.includes('color=var(--diagram-item-stroke-fallback)')) {
      throw new Error(`Default edge arrow does not use the shared fallback token: ${markerReference}.`);
    }
    const probe = document.createElement('span');
    probe.style.color = 'var(--diagram-item-stroke-fallback)';
    canvas.append(probe);
    const markerColor = getComputedStyle(probe).color;
    probe.remove();
    return {
      arrow: markerColor,
      background: getComputedStyle(unselectedNode).backgroundColor,
      border: getComputedStyle(unselectedNode).borderTopColor,
      canvas: getComputedStyle(canvas).backgroundColor,
      edge: getComputedStyle(edge).stroke,
      text: getComputedStyle(unselectedNode).color,
    };
  });
  const assertFallbacks = (theme: string, value: Awaited<ReturnType<typeof colors>>) => {
    assertNeutralColor(value.background, `${theme} unselected node fill`);
    assertNeutralColor(value.border, `${theme} unselected node border`);
    assertNeutralColor(value.text, `${theme} unselected node text`);
    assertNeutralColor(value.edge, `${theme} unselected edge stroke`);
    assertNeutralColor(value.arrow, `${theme} unselected arrow fallback`);
    assertContrastAtLeast(value.border, value.canvas, 3, `${theme} unselected node border`);
    assertContrastAtLeast(value.edge, value.canvas, 3, `${theme} unselected edge stroke`);
    assertContrastAtLeast(value.arrow, value.canvas, 3, `${theme} unselected arrow fallback`);
  };
  const light = await colors();
  assertFallbacks('Light', light);
  await verifiedClick(page, page.getByTestId('theme-control').getByRole('button', { name: 'Dark', exact: true }), 'dark theme control for neutral nodes');
  await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached', timeout: 5_000 });
  const dark = await colors();
  assertFallbacks('Dark', dark);
  assert(light.background !== dark.background && light.text !== dark.text, `Unstyled nodes did not adopt theme-neutral colors: light=${JSON.stringify(light)} dark=${JSON.stringify(dark)}.`);
  await verifiedClick(page, page.getByTestId('theme-control').getByRole('button', { name: 'Light', exact: true }), 'light theme control after neutral nodes');
}

async function expectContrastRoles(page: Page): Promise<void> {
  const roleColors = await page.evaluate(() => {
    const root = getComputedStyle(document.documentElement);
    return {
      canvas: root.getPropertyValue('--surface-canvas').trim(),
      focus: root.getPropertyValue('--focus-ring').trim(),
      interactive: root.getPropertyValue('--interactive-hover').trim(),
      surface: root.getPropertyValue('--control-surface').trim(),
    };
  });
  assertContrastAtLeast(roleColors.focus, roleColors.canvas, 3, 'Focus role');
  assertContrastAtLeast(roleColors.interactive, roleColors.surface, 3, 'Interactive role');
  await ensureFlyout(page, 'activity');
  const activityColors = await page.locator('.activity-time').first().evaluate((element) => {
    const background = element.closest('.activity-item-content');
    return { background: background ? getComputedStyle(background).backgroundColor : '', text: getComputedStyle(element).color };
  });
  assertContrastAtLeast(activityColors.text, activityColors.background, 4.5, 'Activity small text');
  await closeFlyout(page, 'activity');
}

async function expectActivityFlyoutFitSafety(page: Page): Promise<void> {
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await closeFlyout(page, 'source');
  const firstNode = page.locator('.mermaid-flow-node').first();
  await verifiedClick(page, firstNode, 'selected node before activity Fit');
  await page.getByTestId('canvas-node-toolbar').waitFor({ state: 'visible', timeout: 15_000 });
  const before = await snapshotAnchors(page, ANCHORS);
  await ensureFlyout(page, 'activity');
  await verifiedClick(page, page.getByRole('button', { name: 'Fit diagram', exact: true }), 'Fit diagram while activity flyout is open');
  const after = await snapshotAnchors(page, ANCHORS);
  assertAnchorsStable(before, after);
  const flyout = await page.getByTestId('activity-flyout').boundingBox();
  const canvas = await page.getByTestId('diagram-canvas').boundingBox();
  assert(flyout && canvas, 'Activity Fit safety requires canvas and activity flyout bounds.');
  const canvasRect = { bottom: canvas.y + canvas.height, left: canvas.x, right: canvas.x + canvas.width, top: canvas.y };
  const flyoutRect = { bottom: flyout.y + flyout.height, left: flyout.x, right: flyout.x + flyout.width, top: flyout.y };
  const safeRight = Math.min(canvasRect.right, flyoutRect.left - SAFE_FLYOUT_MARGIN);
  for (const [label, locator] of [
    ['graph node', page.locator('.mermaid-flow-node')],
    ['selected node toolbar', page.getByTestId('canvas-node-toolbar')],
  ] as const) {
    const boxes = await locator.evaluateAll((elements) => elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return { bottom: rect.bottom, left: rect.left, right: rect.right, top: rect.top };
    }));
    assert(boxes.length > 0, `Activity Fit did not render ${label}.`);
    for (const box of boxes) {
      assert(box.left >= canvasRect.left + SAFE_FLYOUT_MARGIN && box.right <= safeRight
        && box.top >= canvasRect.top + SAFE_FLYOUT_MARGIN && box.bottom <= canvasRect.bottom - SAFE_FLYOUT_MARGIN,
      `${label} is outside unobscured activity-safe canvas: ${JSON.stringify({ box, canvas: canvasRect, flyout: flyoutRect, safeRight })}.`);
    }
  }
  await closeFlyout(page, 'activity');
}

async function expectNoDevelopmentIndicator(page: Page): Promise<void> {
  const hasIndicator = await page.evaluate(() => !!document.querySelector('nextjs-portal, [data-nextjs-dev-tools], [data-nextjs-toast]'));
  assert(!hasIndicator, 'Browser evidence is running with a Next.js development indicator; use the production owned-services mode for screenshots.');
}

async function expectResponsiveControls(page: Page, label: string, diagramName: string): Promise<void> {
  await page.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 });
  await selectTabByName(page, diagramName);
  await waitForCanvas(page, 'flowchart');
  await verifiedClick(page, page.getByTestId('source-flyout-toggle'), `${label} source toggle`);
  await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await verifiedClick(page, page.getByLabel('Close source panel', { exact: true }), `${label} close source`);
  await page.getByTestId('source-flyout').waitFor({ state: 'detached', timeout: 15_000 });
  const templateTrigger = page.getByTestId('create-diagram-tab');
  await assertHitTarget(page, templateTrigger, `${label} template creation control`);
  const templateMenu = await openTemplateMenu(page);
  const blankTemplate = templateMenuItem(page, 'Blank sheet');
  await waitForFocusedLocator(page, blankTemplate, `${label} opening starter template menu`);
  await assertDocumentHasNoHorizontalOverflow(page);
  await assertContainedInViewport(page, templateTrigger, `${label} template creation control`);
  await assertContainedInViewport(page, templateMenu, `${label} starter template menu`);
  await blankTemplate.press('Escape');
  await templateMenu.waitFor({ state: 'detached', timeout: 15_000 });
  if (label === 'mobile-320') {
    await assertDocumentHasNoHorizontalOverflow(page);
    for (const [target, targetLabel] of [
      [templateTrigger, 'tab creation control'],
      [page.getByTestId('source-flyout-toggle'), 'source toggle'],
      [page.getByTestId('canvas-add-node-toolbar'), 'add-node toolbar'],
      [page.getByTestId('canvas-controls-toolbar'), 'canvas controls toolbar'],
    ] as const) {
      await assertContainedInViewport(page, target, `mobile-320 ${targetLabel}`);
    }
    const beforeZoomOut = await renderedCanvasTransform(page, 'mobile-320 zoom-out verification');
    await verifiedClick(page, page.getByRole('button', { name: 'Zoom out', exact: true }), 'mobile-320 Zoom out');
    await page.waitForFunction((previous) => document.querySelector('.diagram-canvas-svg')?.parentElement?.getAttribute('style') !== previous, beforeZoomOut, { timeout: 5_000 });
    const beforeZoomIn = await renderedCanvasTransform(page, 'mobile-320 zoom-in verification');
    await verifiedClick(page, page.getByRole('button', { name: 'Zoom in', exact: true }), 'mobile-320 Zoom in');
    await page.waitForFunction((previous) => document.querySelector('.diagram-canvas-svg')?.parentElement?.getAttribute('style') !== previous, beforeZoomIn, { timeout: 5_000 });
    const beforeFit = await renderedCanvasTransform(page, 'mobile-320 fit verification');
    await verifiedClick(page, page.getByRole('button', { name: 'Fit diagram', exact: true }), 'mobile-320 Fit diagram');
    await page.waitForFunction((previous) => document.querySelector('.diagram-canvas-svg')?.parentElement?.getAttribute('style') !== previous, beforeFit, { timeout: 5_000 });
    const mobileLabel = page.getByRole('textbox', { name: 'New node label', exact: true });
    await mobileLabel.fill('Mobile toolbar node');
    await verifiedClick(page, page.getByRole('button', { name: 'Add node to Mermaid text', exact: true }), 'mobile-320 add node');
    await ensureSourceFlyoutOpen(page);
    await page.waitForFunction(() => [...document.querySelectorAll('.cm-line')].some((line) => line.textContent?.includes('Mobile toolbar node')), undefined, { timeout: 15_000 });
    await closeFlyout(page, 'source');
  }
}

async function validateWorkspaceUx(): Promise<void> {
  const results: string[] = [];
  await withOwnedServices(async ({ baseUrl, mcpUrl }) => {
    const browser = await launchBrowserHarness();
    const sessionId = `e2e-workspace-ux-${Date.now()}`;
    const mcp = new ModernMcpClient(mcpUrl, baseUrl);
    try {
      const { page } = await browser.newPage(DESKTOP_VIEWPORT);
      await visitWorkspace(page, baseUrl, sessionId);
      await expectThemeContract(page);
      record(results, 'system, light, and dark media resolution plus persistence');
      await verifiedClick(page, page.getByTestId('theme-control').getByRole('button', { name: 'Light', exact: true }), 'light theme control for screenshot matrix');
      await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 5_000 });
      const blankDiagramName = await expectTemplateMenu(page);
      record(results, 'template menu visibility, keyboard navigation, focus return, stable anchors, and blank creation');
      await expectUnstyledNodesUseNeutralThemeColors(page);
      record(results, 'unstyled flowchart nodes use monochrome-neutral theme colors');
      await expectContrastRoles(page);
      record(results, 'activity and interaction/focus contrast roles meet WCAG thresholds');
      await expectStableFlyoutAnchors(page, 'desktop');
      record(results, 'desktop source flyout anchors');
      await ensureFlyout(page, 'source');
      await saveScreenshot(page, 'issue-14-source');
      await closeFlyout(page, 'source');
      await expectFlyoutExclusivity(page);
      record(results, 'source/activity flyout exclusivity');
      await ensureFlyout(page, 'activity');
      await saveScreenshot(page, 'issue-14-activity');
      await closeFlyout(page, 'activity');
      await expectFlyoutFocusAndEscape(page);
      record(results, 'flyout autofocus, Escape close, and focus return');
      const diagramName = await expectTabKeyboardAndRename(page, blankDiagramName);
      record(results, 'blank tab create, rename, and keyboard navigation');
      await selectTabByName(page, diagramName);
      await saveScreenshot(page, 'issue-14-blank');
      await expectTemplateDiagramCreation(page);
      record(results, 'flowchart and API sequence templates render, rename, edit, and remain ordinary diagrams');
      await selectTabByName(page, diagramName);
      await expectMermaidStatesAndToolbar(page);
      record(results, 'flowchart, static, invalid Mermaid, and toolbar action');
      await expectRendererKindFit(page);
      record(results, 'editable/static renderer transition fits camera');
      await expectRemoteUpdateWithoutAnchorJump(page, mcp, sessionId, diagramName);
      record(results, 'remote update leaves desktop anchors stable');
      await saveScreenshot(page, 'workspace-ux-desktop');

      const { page: activityFitPage } = await browser.newPage(ACTIVITY_FIT_VIEWPORT);
      await visitWorkspace(activityFitPage, baseUrl, sessionId);
      await selectTabByName(activityFitPage, diagramName);
      await expectActivityFlyoutFitSafety(activityFitPage);
      record(results, 'activity-open Fit keeps graph and selected toolbar in unobscured canvas');

      for (const [label, viewport] of [
        ['tablet', TABLET_VIEWPORT],
        ['mobile-390', MOBILE_VIEWPORT],
        ['mobile-320', NARROW_MOBILE_VIEWPORT],
      ] as const) {
        const { page: responsivePage } = await browser.newPage(viewport);
        await visitWorkspace(responsivePage, baseUrl, sessionId);
        await expectStableFlyoutAnchors(responsivePage, label);
        await expectResponsiveControls(responsivePage, label, diagramName);
        await expectNoDevelopmentIndicator(responsivePage);
        await saveScreenshot(responsivePage, `workspace-ux-${label}`);
        record(results, `${label} anchors and source controls`);
      }
    } finally {
      await browser.close();
    }
  });
  console.log(`WORKSPACE UX E2E PASSED (${results.length} passed, 0 skips)`);
}

validateWorkspaceUx().catch((error) => {
  console.error(describeError(error));
  process.exit(1);
});
