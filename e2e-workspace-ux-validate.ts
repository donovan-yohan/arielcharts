import { expect, type Locator, type Page } from '@playwright/test';
import { WebsocketProvider } from 'y-websocket';
import { WebSocket } from 'ws';
import * as Y from 'yjs';
import {
  DESKTOP_VIEWPORT,
  MOBILE_LANDSCAPE_VIEWPORT,
  MOBILE_VIEWPORT,
  NARROW_MOBILE_VIEWPORT,
  TABLET_VIEWPORT,
  launchBrowserHarness,
  saveScreenshot,
  saveViewportScreenshot,
  type BrowserHarness,
} from './e2e/support/browser.ts';
import { assert, describeError } from './e2e/support/assert.ts';
import {
  assertAnchorsStable,
  assertContainedInViewport,
  assertContrastAtLeast,
  assertDocumentMatchesViewport,
  assertDocumentHasNoHorizontalOverflow,
  assertExactColor,
  assertHitTarget,
  assertNeutralColor,
  assertTouchTarget,
  snapshotAnchors,
  verifiedClick,
} from './e2e/support/interactions.ts';
import { ModernMcpClient, type DiagramRevision, type DiagramRevisionSummary } from './e2e/support/mcp.ts';
import { withOwnedServices } from './e2e/support/owned-services.ts';
import { createRoom, exchangeRoomAccess, type RoomAccess } from './e2e/support/room-access.ts';
import {
  getYjsSourceLayoutTransitions,
  openYjsSessionObserver,
  type YjsSessionSnapshot,
  type YjsSessionSnapshotHistory,
} from './e2e/support/yjs-session.ts';
import { STARTER_TEMPLATES } from './packages/shared/src/starter-templates.js';
import { getWebsocketServerUrl } from './apps/web/src/lib/session.ts';
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
  openWorkspaceSettings,
  renameActiveDiagram,
  replaceSource,
  selectTabByName,
  selectWorkspaceTheme,
  templateMenuItem,
  visitWorkspace,
  waitForCanvas,
  waitForInvalidPreview,
  waitForSource,
  waitForSyncedSource,
} from './e2e/support/workspace.ts';

const SETTINGS_TRIGGER_TEST_ID = 'workspace-settings-trigger';
const SETTINGS_DIALOG_TEST_ID = 'workspace-settings-dialog';

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

const HISTORY_PREVIOUS_FLOWCHART = `flowchart LR
  Browser[Browser] --> Prior[Prior revision]
  Prior --> API[API]`;
const HISTORY_CURRENT_FLOWCHART = `flowchart LR
  Browser[Browser] --> Current[Current revision]
  Current --> API[API]`;
const HISTORY_GENERIC_SEQUENCE = `sequenceDiagram
  Browser->>API: Historical request
  API-->>Browser: Historical response`;
const HISTORY_INVALID_FLOWCHART = 'this is a temporary invalid Mermaid revision';
const HISTORY_NEGATIVE_OBSERVATION_MS = 250;

const ACTIVITY_FIT_VIEWPORT = { width: 1487, height: 1058 } as const;
const SAFE_FLYOUT_MARGIN = 16;

type AgentPresence = { destroy: () => void };

type ComputedNodeColors = {
  background: string;
  border: string;
  text: string;
};

function record(results: string[], name: string): void {
  results.push(name);
  console.log(`PASS ${name}`);
}

async function readNodeColors(node: Locator): Promise<ComputedNodeColors> {
  return node.evaluate((element) => {
    const style = getComputedStyle(element);
    return { background: style.backgroundColor, border: style.borderTopColor, text: style.color };
  });
}

async function waitForNodeColors(
  node: Locator,
  expected: ComputedNodeColors,
  label: string,
): Promise<ComputedNodeColors> {
  let settled: ComputedNodeColors | null = null;
  await expect.poll(async () => {
    if (await node.count() === 0) return null;
    settled = await readNodeColors(node);
    return settled;
  }, {
    message: `${label} did not settle to the source-owned Mermaid colors.`,
    timeout: 15_000,
  }).toEqual(expected);
  assert(settled !== null, `${label} did not render a Mermaid node.`);
  return settled;
}

async function waitForFlowchartFixtureRender(page: Page): Promise<void> {
  await page.locator('.mermaid-flow-node').filter({ hasText: 'Database' }).first()
    .waitFor({ state: 'visible', timeout: 15_000 });
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

async function renderedCanvasCameraTransform(page: Page, label: string): Promise<string> {
  const layer = page.locator('.diagram-canvas-svg').locator('..');
  const transform = await layer.evaluate((element) => (element as HTMLElement).style.transform);
  assert(transform.length > 0, `${label} requires a rendered canvas transform.`);
  return transform;
}

async function waitForStableCanvasTransform(page: Page, label: string): Promise<string> {
  const deadline = Date.now() + 15_000;
  let samples: string[] = [];
  while (Date.now() < deadline) {
    samples = await page.evaluate(async () => {
      const layer = document.querySelector('.diagram-canvas-svg')?.parentElement;
      if (!(layer instanceof HTMLElement)) {
        return [];
      }
      const transforms: string[] = [];
      for (let frame = 0; frame < 4; frame += 1) {
        await new Promise<void>((resolve) => { requestAnimationFrame(() => { resolve(); }); });
        transforms.push(layer.style.transform);
      }
      return transforms;
    });
    if (samples.length === 4 && samples[0] && samples.every((transform) => transform === samples[0])) {
      return samples[0];
    }
  }
  throw new Error(`${label} did not settle a rendered canvas camera transform: ${JSON.stringify(samples)}.`);
}

async function closeWorkspaceSettings(page: Page): Promise<void> {
  const dialog = page.getByTestId(SETTINGS_DIALOG_TEST_ID);
  for (let attempt = 0; attempt < 3 && await dialog.count() > 0; attempt += 1) {
    await page.evaluate(async () => {
      await new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
    });
    await page.keyboard.press('Escape');
    try {
      await dialog.waitFor({ state: 'detached', timeout: 1_000 });
      return;
    } catch {
      // Theme and presence rerenders can briefly replace the document listener.
    }
  }
  if (await dialog.count() > 0) {
    await verifiedClick(
      page,
      dialog.getByRole('button', { name: 'Close', exact: true }),
      'workspace settings Close fallback',
    );
  }
  await dialog.waitFor({ state: 'detached', timeout: 15_000 });
}

async function selectThemePreference(page: Page, preference: 'system' | 'light' | 'dark'): Promise<void> {
  await selectWorkspaceTheme(page, preference);
  const resolvedTheme = preference === 'system'
    ? await page.evaluate(() => window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
    : preference;
  await page.locator(`html[data-theme="${resolvedTheme}"]`).waitFor({ state: 'attached', timeout: 5_000 });
  await closeWorkspaceSettings(page);
}

async function connectAgentPresence(mcpUrl: string, sessionId: string, roomCookie: string, origin: string): Promise<AgentPresence> {
  const endpoint = getWebsocketServerUrl(new URL(mcpUrl).origin);
  const doc = new Y.Doc();
  const WebSocketPolyfill = class CookieWebSocket extends WebSocket {
    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols, { headers: { cookie: roomCookie, origin } });
    }
  };
  const provider = new WebsocketProvider(endpoint, sessionId, doc, {
    maxBackoffTime: 2_500,
    resyncInterval: 10_000,
    WebSocketPolyfill: WebSocketPolyfill as unknown as typeof globalThis.WebSocket,
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        provider.off('status', handleStatus);
        reject(new Error(`Agent awareness provider did not connect to ${endpoint} within 5 seconds.`));
      }, 5_000);
      const handleStatus = ({ status }: { status: 'connected' | 'connecting' | 'disconnected' }) => {
        if (status !== 'connected') {
          return;
        }
        clearTimeout(timeout);
        provider.off('status', handleStatus);
        resolve();
      };
      provider.on('status', handleStatus);
    });
  } catch (error) {
    provider.destroy();
    doc.destroy();
    throw error;
  }
  provider.awareness.setLocalState({
    user: { color: '#111111', name: 'E2E agent', type: 'agent' },
  });
  return {
    destroy: () => {
      provider.destroy();
      doc.destroy();
    },
  };
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
  await saveScreenshot(page, 'issue-28-light-flat-template-menu');
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

  await selectThemePreference(page, 'dark');
  await openTemplateMenu(page);
  await saveScreenshot(page, 'issue-28-dark-flat-template-menu');
  await page.keyboard.press('Escape');
  await menu.waitFor({ state: 'detached', timeout: 15_000 });
  await selectThemePreference(page, 'light');

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
  const closeActivity = page.getByLabel('Close activity and history', { exact: true });
  await closeActivity.waitFor({ state: 'visible', timeout: 15_000 });
  await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Close activity and history', undefined, { timeout: 5_000 });
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
  await waitForSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await waitForFlowchartFixtureRender(page);
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
  await waitForSource(page, SOURCE_OWNED_COLOR_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  const coloredNode = page.locator('.mermaid-flow-node').filter({ hasText: 'Browser' }).first();
  const expectedSourceOwnedColors = {
    background: 'rgb(255, 236, 153)',
    border: 'rgb(217, 72, 15)',
    text: 'rgb(74, 44, 0)',
  };
  const sourceOwnedColors = await waitForNodeColors(
    coloredNode,
    expectedSourceOwnedColors,
    'Light source-owned Mermaid classDef',
  );
  assertExactColor(sourceOwnedColors.background, 'rgb(255, 236, 153)', 'Mermaid classDef #ffec99 fill');
  assertExactColor(sourceOwnedColors.border, 'rgb(217, 72, 15)', 'Mermaid classDef #d9480f stroke');
  assertExactColor(sourceOwnedColors.text, 'rgb(74, 44, 0)', 'Mermaid classDef #4a2c00 text');
  await selectThemePreference(page, 'dark');
  const afterThemeColors = await waitForNodeColors(
    coloredNode,
    expectedSourceOwnedColors,
    'Dark source-owned Mermaid classDef',
  );
  assertExactColor(afterThemeColors.background, 'rgb(255, 236, 153)', 'Dark Mermaid classDef #ffec99 fill');
  assertExactColor(afterThemeColors.border, 'rgb(217, 72, 15)', 'Dark Mermaid classDef #d9480f stroke');
  assertExactColor(afterThemeColors.text, 'rgb(74, 44, 0)', 'Dark Mermaid classDef #4a2c00 text');
  await closeFlyout(page, 'source');
  await saveScreenshot(page, 'issue-14-dark-canvas');
  await selectThemePreference(page, 'light');

  await replaceSource(page, TRANSPARENT_MERMAID_FIXTURE);
  await waitForSource(page, TRANSPARENT_MERMAID_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  const transparentNode = page.locator('.mermaid-flow-node').filter({ hasText: 'Ghost' }).first();
  const transparentColors = await waitForNodeColors(transparentNode, {
    background: 'rgba(0, 0, 0, 0)',
    border: 'rgba(0, 0, 0, 0)',
    text: 'rgba(0, 0, 0, 0)',
  }, 'Transparent source-owned Mermaid classDef');
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

async function expectRendererTransitionPreservesCamera(page: Page): Promise<void> {
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await closeFlyout(page, 'source');
  const beforeZoom = await waitForStableCanvasTransform(page, 'Flowchart zoom verification');
  await verifiedClick(page, page.getByRole('button', { name: 'Zoom in', exact: true }), 'zoom in');
  await page.waitForFunction((previous) => {
    const layer = document.querySelector('.diagram-canvas-svg')?.parentElement;
    return layer instanceof HTMLElement && layer.style.transform !== previous;
  }, beforeZoom, { timeout: 5_000 });
  const zoomed = await waitForStableCanvasTransform(page, 'Flowchart zoom result');
  assert(zoomed !== beforeZoom, `Zoom in did not change the flowchart camera: ${beforeZoom}`);
  await replaceSource(page, API_SEQUENCE_FIXTURE);
  await waitForCanvas(page, 'generic');
  await closeFlyout(page, 'source');
  const staticTransform = await waitForStableCanvasTransform(page, 'Static renderer transition');
  assert(staticTransform === zoomed, `Editable-to-static renderer transition changed the camera: ${zoomed} -> ${staticTransform}`);
  await verifiedClick(page, page.getByRole('button', { name: 'Fit diagram', exact: true }), 'static renderer fit diagram');
  await page.waitForFunction((previous) => {
    const layer = document.querySelector('.diagram-canvas-svg')?.parentElement;
    return layer instanceof HTMLElement && layer.style.transform !== previous;
  }, staticTransform, { timeout: 5_000 });
  const fittedTransform = await waitForStableCanvasTransform(page, 'Static renderer explicit Fit result');
  assert(fittedTransform !== staticTransform, `Explicit Fit did not change the static renderer camera: ${staticTransform}`);
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await closeFlyout(page, 'source');
  const restoredFlowchartTransform = await waitForStableCanvasTransform(page, 'Flowchart renderer restoration');
  assert(restoredFlowchartTransform === fittedTransform,
    `Static-to-editable renderer transition changed the camera: ${fittedTransform} -> ${restoredFlowchartTransform}`);
}

async function expectRemoteUpdateWithoutAnchorJump(page: Page, mcp: ModernMcpClient, sessionId: string, diagramName: string): Promise<void> {
  await selectTabByName(page, diagramName);
  await ensureSourceFlyoutOpen(page);
  await waitForSyncedSource(page);
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await waitForFlowchartFixtureRender(page);
  const session = await mcp.getSession(sessionId);
  const diagram = session.diagrams.find((candidate) => candidate.name === diagramName);
  assert(diagram, `MCP did not expose diagram ${diagramName}.`);
  const before = await snapshotAnchors(page, ANCHORS);
  const beforeCamera = await waitForStableCanvasTransform(page, 'Remote flowchart update camera baseline');
  const remoteSource = `${FLOWCHART_FIXTURE}\n  Gateway --> Audit[Audit]`;
  await mcp.writeLatest(sessionId, diagram.id, remoteSource);
  await waitForSource(page, remoteSource);
  await page.locator('.mermaid-flow-node').filter({ hasText: 'Audit' }).first().waitFor({ state: 'visible', timeout: 15_000 });
  const afterCamera = await waitForStableCanvasTransform(page, 'Remote flowchart update camera result');
  assert(afterCamera === beforeCamera, `Same-renderer remote update changed the camera: ${beforeCamera} -> ${afterCamera}`);
  assertAnchorsStable(before, await snapshotAnchors(page, ANCHORS));
}

async function expectThemeContract(page: Page): Promise<void> {
  const trigger = page.getByTestId(SETTINGS_TRIGGER_TEST_ID);
  assert(await trigger.count() === 1, 'Accessible workspace settings trigger is missing from workspace chrome.');
  await assertHitTarget(page, trigger, 'workspace settings trigger');
  await assertContainedInViewport(page, trigger, 'workspace settings trigger');

  await selectThemePreference(page, 'light');
  await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 5_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 5_000 });

  await selectThemePreference(page, 'dark');
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

  await selectThemePreference(page, 'light');
  await selectThemePreference(page, 'system');
  await page.locator('html[data-theme="light"]').waitFor({ state: 'attached', timeout: 5_000 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('html[data-theme="dark"]').waitFor({ state: 'attached', timeout: 5_000 });
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert(await page.evaluate(() => window.localStorage.getItem('arielcharts.theme.v1')) === 'system', 'System theme preference did not persist across reload.');
  await selectThemePreference(page, 'system');
}

async function openAgentConnectionModal(page: Page, actionLabel: 'Connect my agent' | 'Connection details'): Promise<Locator> {
  const settings = await openWorkspaceSettings(page);
  await verifiedClick(page, settings.getByRole('button', { name: actionLabel, exact: true }), `settings ${actionLabel} action`);
  const modal = page.getByRole('dialog', { name: 'Agent connection', exact: true });
  await modal.waitFor({ state: 'visible', timeout: 15_000 });
  await waitForFocusedLocator(page, modal.getByRole('button', { name: 'Close', exact: true }), 'Opening agent connection modal');
  return modal;
}

async function expectAgentConnectionModal(
  page: Page,
  mcpUrl: string,
  sessionId: string,
  roomCookie: string,
  expectedKeyAvailability: 'in-memory' | 'cookie-only',
): Promise<void> {
  await ensureFlyout(page, 'source');
  const zeroAgentModal = await openAgentConnectionModal(page, 'Connect my agent');
  const zeroAgentDetails = zeroAgentModal.getByTestId('agent-connection-details');
  assert(/Session status\s+(Connected|Connecting|Reconnecting|Disconnected)/u.test(await zeroAgentDetails.innerText()),
    `Agent connection modal omitted the session status: ${JSON.stringify(await zeroAgentDetails.innerText())}.`);
  assert(/Agents\s+0 MCP agents connected/u.test(await zeroAgentDetails.innerText()),
    `Agent connection modal omitted the zero-agent detail: ${JSON.stringify(await zeroAgentDetails.innerText())}.`);
  const prompt = zeroAgentModal.locator('.modal-prompt-text');
  await saveScreenshot(page, 'issue-28-agent-connection-modal');
  const closeAction = zeroAgentModal.getByRole('button', { name: 'Close', exact: true });
  if (expectedKeyAvailability === 'in-memory') {
    assert(await prompt.count() === 1, 'Fragment-derived room key was not available for the agent bearer prompt.');
    assert((await prompt.innerText()).includes('First call getSession'), 'Agent connection modal omitted the current-session MCP prompt.');
    const copyAction = zeroAgentModal.locator('.modal-prompt-copy');
    await verifiedClick(page, copyAction, 'agent prompt copy action');
    await page.waitForFunction(() => /^(copied|copy failed)$/iu.test(document.querySelector('.modal-prompt-copy')?.textContent ?? ''), undefined, { timeout: 5_000 });
    await closeAction.press('Shift+Tab');
    await waitForFocusedLocator(page, copyAction, 'Reverse Tab wrapping in agent connection modal');
    await copyAction.press('Tab');
    await waitForFocusedLocator(page, closeAction, 'Forward Tab wrapping in agent connection modal');
  } else {
    assert(await prompt.count() === 0, 'Cookie-only reload rendered a raw room-key agent prompt.');
    await zeroAgentModal.getByText(/no shareable key in memory/i).waitFor({ state: 'visible', timeout: 5_000 });
  }
  await page.keyboard.press('Escape');
  await zeroAgentModal.waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Escaping agent connection modal');
  await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await closeFlyout(page, 'source');

  const backdropModal = await openAgentConnectionModal(page, 'Connect my agent');
  await page.locator('.modal-backdrop').click({ position: { x: 4, y: 4 } });
  await backdropModal.waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Backdrop-closing agent connection modal');

  const closeButtonModal = await openAgentConnectionModal(page, 'Connect my agent');
  await verifiedClick(page, closeButtonModal.getByRole('button', { name: 'Close', exact: true }), 'close agent connection modal');
  await closeButtonModal.waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Closing agent connection modal');

  const agent = await connectAgentPresence(mcpUrl, sessionId, roomCookie, new URL(page.url()).origin);
  try {
    const settings = await openWorkspaceSettings(page);
    await page.waitForFunction(() => document.querySelector('[data-testid="workspace-agent-status"]')?.textContent?.includes('1 MCP agent working') ?? false, undefined, { timeout: 15_000 });
    await settings.getByRole('button', { name: 'Connection details', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
    await closeWorkspaceSettings(page);
    const activeAgentModal = await openAgentConnectionModal(page, 'Connection details');
    const activeAgentDetails = activeAgentModal.getByTestId('agent-connection-details');
    assert(/Agents\s+1 MCP agent connected/u.test(await activeAgentDetails.innerText()),
      `Agent connection modal omitted the active-agent detail: ${JSON.stringify(await activeAgentDetails.innerText())}.`);
    await page.keyboard.press('Escape');
    await activeAgentModal.waitFor({ state: 'detached', timeout: 15_000 });
    await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Escaping active-agent connection details');
  } finally {
    agent.destroy();
    const settings = await openWorkspaceSettings(page);
    await expect(settings.getByTestId('workspace-agent-status')).not.toContainText('MCP agent working', { timeout: 15_000 });
    await closeWorkspaceSettings(page);
  }
}

async function expectWorkspaceSettings(page: Page, mcpUrl: string, sessionId: string, roomCookie: string): Promise<void> {
  const trigger = page.getByTestId(SETTINGS_TRIGGER_TEST_ID);
  const before = await snapshotAnchors(page, ANCHORS);
  const beforeTransform = await canvasTransform(page);
  const dialog = await openWorkspaceSettings(page);
  await assertContainedInViewport(page, dialog, 'desktop workspace settings dialog');
  const nameInput = dialog.getByRole('textbox', { name: 'Display name', exact: true });
  await waitForFocusedLocator(page, nameInput, 'Opening workspace settings');
  await dialog.getByRole('heading', { name: 'You', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  await dialog.getByRole('heading', { name: /^Agent/u }).waitFor({ state: 'visible', timeout: 5_000 });
  await dialog.getByRole('group', { name: 'Appearance', exact: true }).waitFor({ state: 'visible', timeout: 5_000 });
  const status = dialog.getByTestId('workspace-agent-status');
  await status.waitFor({ state: 'visible', timeout: 5_000 });
  assert(/ready for agents|connecting session|reconnecting session|session offline|mcp agents? working/iu.test(await status.innerText()),
    `Workspace settings agent status does not communicate session state: ${JSON.stringify(await status.innerText())}.`);
  const agentAction = dialog.getByRole('button', { name: /^(Connect my agent|Connection details)$/u });
  await assertHitTarget(page, agentAction, 'workspace settings agent action');
  for (const preference of ['System', 'Light', 'Dark']) {
    await dialog.getByRole('radio', { name: new RegExp(`^${preference}(?:\\s|$)`, 'u') }).waitFor({ state: 'visible', timeout: 5_000 });
  }
  await saveScreenshot(page, 'issue-28-light-flat-settings');

  const originalName = await nameInput.inputValue();
  const savedName = 'Ariel UX E2E';
  await nameInput.fill(savedName);
  await verifiedClick(page, dialog.getByRole('button', { name: 'Save name', exact: true }), 'settings save display name');
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Saving display name');

  const reopenedAfterSave = await openWorkspaceSettings(page);
  const savedInput = reopenedAfterSave.getByRole('textbox', { name: 'Display name', exact: true });
  assert(await savedInput.inputValue() === savedName, 'Saving display name did not retain the edited value.');
  await savedInput.fill('Discarded by cancel');
  await verifiedClick(page, reopenedAfterSave.getByRole('button', { name: 'Cancel', exact: true }), 'settings cancel display name');
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });

  const reopenedAfterCancel = await openWorkspaceSettings(page);
  const escapedInput = reopenedAfterCancel.getByRole('textbox', { name: 'Display name', exact: true });
  assert(await escapedInput.inputValue() === savedName, 'Cancelling display-name edit changed the saved value.');
  const draftName = 'Draft survives agent presence';
  await escapedInput.fill(draftName);
  const draftAgent = await connectAgentPresence(mcpUrl, sessionId, roomCookie, new URL(page.url()).origin);
  try {
    await expect(reopenedAfterCancel.getByTestId('workspace-agent-status')).toContainText('1 MCP agent working', { timeout: 15_000 });
    assert(await escapedInput.inputValue() === draftName, 'An unrelated collaboration rerender reset the in-progress display-name draft.');
  } finally {
    draftAgent.destroy();
    await expect(reopenedAfterCancel.getByTestId('workspace-agent-status')).not.toContainText('MCP agent working', { timeout: 15_000 });
  }
  await escapedInput.fill('Discarded by escape');
  await page.keyboard.press('Escape');
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Closing settings with Escape');

  const reopenedAfterEscape = await openWorkspaceSettings(page);
  const restoredInput = reopenedAfterEscape.getByRole('textbox', { name: 'Display name', exact: true });
  await page.waitForFunction((expected) => (document.querySelector('#workspace-display-name') as HTMLInputElement | null)?.value === expected, savedName, { timeout: 5_000 });
  assert(await restoredInput.inputValue() === savedName, 'Escaping display-name edit changed the saved value.');
  await restoredInput.fill(originalName);
  await verifiedClick(page, reopenedAfterEscape.getByRole('button', { name: 'Save name', exact: true }), 'restore display name after settings test');
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });

  const backwardBoundary = await openWorkspaceSettings(page);
  await backwardBoundary.getByRole('button', { name: 'Close', exact: true }).press('Shift+Tab');
  await backwardBoundary.waitFor({ state: 'detached', timeout: 15_000 });
  assert(await page.evaluate(() => !document.querySelector('[data-testid="workspace-settings-dialog"]')?.contains(document.activeElement)),
    'Shift+Tab at the start of settings trapped focus in the dialog.');

  const forwardBoundary = await openWorkspaceSettings(page);
  const checkedTheme = forwardBoundary.locator('input[type="radio"]:checked');
  await checkedTheme.press('Tab');
  await forwardBoundary.waitFor({ state: 'detached', timeout: 15_000 });
  assert(await page.evaluate(() => !document.querySelector('[data-testid="workspace-settings-dialog"]')?.contains(document.activeElement)),
    'Tab at the end of settings trapped focus in the dialog.');

  await openWorkspaceSettings(page);
  await page.locator('.workspace-logo').click();
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Outside-closing settings from inert page chrome');

  await openWorkspaceSettings(page);
  const mainTab = page.getByRole('tab', { name: 'Main', exact: true });
  await verifiedClick(page, mainTab, 'selecting a tab outside settings');
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedLocator(page, mainTab, 'Selecting a tab outside settings');
  assert(await trigger.evaluate((element) => document.activeElement !== element),
    'Opening an interactive control outside settings had its focus stolen by the settings trigger.');

  const canvas = page.getByRole('application', { name: 'Interactive diagram canvas', exact: true });
  await openWorkspaceSettings(page);
  await canvas.focus();
  await canvas.click({ position: { x: 4, y: 4 } });
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedLocator(page, canvas, 'Closing settings from the interactive canvas');
  assert(await trigger.evaluate((element) => document.activeElement !== element),
    'Closing settings from the interactive canvas had its focus stolen by the settings trigger.');

  await ensureFlyout(page, 'source');
  await openWorkspaceSettings(page);
  await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await closeWorkspaceSettings(page);
  await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await closeFlyout(page, 'source');
  await ensureFlyout(page, 'activity');
  await openWorkspaceSettings(page);
  await page.getByTestId('activity-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await closeWorkspaceSettings(page);
  await page.getByTestId('activity-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await closeFlyout(page, 'activity');
  await openTemplateMenu(page);
  await openWorkspaceSettings(page);
  await page.getByRole('menu', { name: 'Starter templates', exact: true }).waitFor({ state: 'detached', timeout: 15_000 });
  await closeWorkspaceSettings(page);

  assertAnchorsStable(before, await snapshotAnchors(page, ANCHORS));
  assert(await canvasTransform(page) === beforeTransform, 'Opening and closing workspace settings changed the canvas camera.');
}

async function assertNoProductShadows(page: Page, selectors: Record<string, string>): Promise<void> {
  const shadowAudit = await page.evaluate((entries) => Object.fromEntries(entries.map(([label, selector]) => {
    const element = document.querySelector<HTMLElement>(selector);
    if (!element) return [label, null];
    const style = getComputedStyle(element);
    return [label, { boxShadow: style.boxShadow, filter: style.filter }];
  })), Object.entries(selectors)) as Record<string, { boxShadow: string; filter: string } | null>;
  for (const [label, style] of Object.entries(shadowAudit)) {
    assert(style !== null, `Flat chrome audit could not find ${label}.`);
    assert(style.boxShadow === 'none', `${label} retained product box-shadow: ${style.boxShadow}.`);
    assert(!style.filter.includes('drop-shadow'), `${label} retained product drop-shadow filter: ${style.filter}.`);
  }
}

async function expectFlatChrome(page: Page): Promise<void> {
  await ensureFlyout(page, 'source');
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await waitForFlowchartFixtureRender(page);
  const outerNode = page.locator('.diagram-reactflow-layer .react-flow__node').first();
  const visibleNode = outerNode.locator('.mermaid-flow-node');
  const selectedEdge = page.locator('.diagram-reactflow-layer .react-flow__edge').first();
  const edgePath = selectedEdge.locator('.react-flow__edge-path');
  const edgeInteraction = selectedEdge.locator('.react-flow__edge-interaction');
  await outerNode.waitFor({ state: 'visible', timeout: 15_000 });
  await edgePath.waitFor({ state: 'attached', timeout: 15_000 });
  await outerNode.hover();
  await assertNoProductShadows(page, {
    hoveredOuterNode: '.diagram-reactflow-layer .react-flow__node:hover',
  });
  await verifiedClick(page, outerNode, 'outer React Flow node selection for flat chrome audit');
  await expect(visibleNode).toHaveClass(/is-selected/u, { timeout: 5_000 });
  const selectedNodeStyles = await outerNode.evaluate((element) => {
    const visibleNode = element.querySelector<HTMLElement>('.mermaid-flow-node');
    if (!visibleNode) throw new Error('Selected outer React Flow node has no visible Mermaid node.');
    const outerStyle = getComputedStyle(element);
    const visibleStyle = getComputedStyle(visibleNode);
    return {
      background: visibleStyle.backgroundColor,
      boxShadow: outerStyle.boxShadow,
      filter: outerStyle.filter,
      outline: visibleStyle.outlineStyle,
    };
  });
  assert(selectedNodeStyles.boxShadow === 'none' && !selectedNodeStyles.filter.includes('drop-shadow'),
    `Selected outer React Flow node retained elevation: ${JSON.stringify(selectedNodeStyles)}.`);
  assert(selectedNodeStyles.outline !== 'none' || selectedNodeStyles.background !== 'rgba(0, 0, 0, 0)',
    `Selected node has no visible flat selection treatment: ${JSON.stringify(selectedNodeStyles)}.`);
  const unselectedEdgeStyles = await edgePath.evaluate((element) => {
    const style = getComputedStyle(element);
    return { stroke: style.stroke, strokeWidth: style.strokeWidth };
  });
  await edgeInteraction.evaluate((element) => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, button: 0, cancelable: true, view: window }));
  });
  await expect(selectedEdge).toHaveClass(/selected/u, { timeout: 5_000 });
  await selectedEdge.evaluate((element) => {
    if (!element.classList.contains('selected')) {
      throw new Error('React Flow edge did not enter its selected state.');
    }
  });
  const selectedEdgeStyles = await selectedEdge.evaluate((element) => {
    const path = element.querySelector<SVGPathElement>('.react-flow__edge-path');
    if (!path) throw new Error('Selected React Flow edge has no visible path.');
    const edgeStyle = getComputedStyle(element);
    const pathStyle = getComputedStyle(path);
    return {
      edgeBoxShadow: edgeStyle.boxShadow,
      edgeFilter: edgeStyle.filter,
      pathBoxShadow: pathStyle.boxShadow,
      pathFilter: pathStyle.filter,
      stroke: pathStyle.stroke,
      strokeWidth: pathStyle.strokeWidth,
    };
  });
  assert(selectedEdgeStyles.edgeBoxShadow === 'none' && selectedEdgeStyles.pathBoxShadow === 'none'
    && !selectedEdgeStyles.edgeFilter.includes('drop-shadow') && !selectedEdgeStyles.pathFilter.includes('drop-shadow'),
  `Selected React Flow edge retained elevation: ${JSON.stringify(selectedEdgeStyles)}.`);
  assert(selectedEdgeStyles.stroke !== unselectedEdgeStyles.stroke || selectedEdgeStyles.strokeWidth !== unselectedEdgeStyles.strokeWidth,
    `Selected edge did not receive a visible flat selection treatment: ${JSON.stringify({ selectedEdgeStyles, unselectedEdgeStyles })}.`);
  await saveScreenshot(page, 'issue-28-selected-flat-edge');
  await assertNoProductShadows(page, {
    canvasToolbar: '[data-testid="canvas-controls-toolbar"]',
    source: '[data-testid="source-flyout"]',
  });
  await closeFlyout(page, 'source');
  await ensureFlyout(page, 'activity');
  await assertNoProductShadows(page, {
    activity: '[data-testid="activity-flyout"]',
    canvasToolbar: '[data-testid="canvas-controls-toolbar"]',
  });
  await closeFlyout(page, 'activity');
  const templateMenu = await openTemplateMenu(page);
  await assertNoProductShadows(page, {
    canvasToolbar: '[data-testid="canvas-controls-toolbar"]',
    menu: '[role="menu"][aria-label="Starter templates"]',
    templateCard: '[role="menuitem"]',
  });
  const settings = await openWorkspaceSettings(page);
  await templateMenu.waitFor({ state: 'detached', timeout: 15_000 });
  await assertNoProductShadows(page, {
    canvasToolbar: '[data-testid="canvas-controls-toolbar"]',
    settings: '[data-testid="workspace-settings-dialog"]',
  });
  const selectionStyles = await settings.evaluate((dialog) => {
    const selectedTheme = document.querySelector<HTMLElement>('.workspace-settings-theme-option:has(input:checked)');
    return {
      selectedBackground: selectedTheme ? getComputedStyle(selectedTheme).backgroundColor : '',
      selectedOutline: selectedTheme ? getComputedStyle(selectedTheme).outlineStyle : '',
    };
  });
  assert(selectionStyles.selectedBackground !== 'rgba(0, 0, 0, 0)' || selectionStyles.selectedOutline !== 'none',
    'Flat chrome removed the visible selected-theme treatment.');
  await saveScreenshot(page, 'issue-28-dark-flat-chrome');
  await settings.getByRole('button', { name: 'Close', exact: true }).click();
  await waitForFocusedTestId(page, SETTINGS_TRIGGER_TEST_ID, 'Closing settings after flat chrome audit');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  const focusStyles = await page.getByTestId(SETTINGS_TRIGGER_TEST_ID).evaluate((element) => ({
    isFocusVisible: element.matches(':focus-visible'),
    outline: getComputedStyle(element).outlineStyle,
  }));
  assert(focusStyles.isFocusVisible && focusStyles.outline !== 'none',
    `Flat chrome removed the visible keyboard focus treatment: ${JSON.stringify(focusStyles)}.`);
}

async function expectUnstyledNodesUseNeutralThemeColors(page: Page): Promise<void> {
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await waitForFlowchartFixtureRender(page);
  await page.locator('.react-flow__edge-path').first().waitFor({ state: 'attached', timeout: 15_000 });
  await assertNoProductShadows(page, {
    edge: '.react-flow__edge-path',
    node: '.mermaid-flow-node',
  });
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
  await selectThemePreference(page, 'dark');
  const dark = await colors();
  assertFallbacks('Dark', dark);
  assert(light.background !== dark.background && light.text !== dark.text, `Unstyled nodes did not adopt theme-neutral colors: light=${JSON.stringify(light)} dark=${JSON.stringify(dark)}.`);
  await selectThemePreference(page, 'light');
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
  await verifiedClick(page, page.getByTestId('activity-flyout').getByRole('button', { name: /^Activity\s+/u }), 'activity view switch for contrast audit');
  const activityColors = await page.locator('.activity-time').first().evaluate((element) => {
    const background = element.closest('.activity-item-content');
    return { background: background ? getComputedStyle(background).backgroundColor : '', text: getComputedStyle(element).color };
  });
  assertContrastAtLeast(activityColors.text, activityColors.background, 4.5, 'Activity small text');
  await closeFlyout(page, 'activity');
}

async function expectActivityFlyoutFitSafety(page: Page): Promise<void> {
  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForSource(page, FLOWCHART_FIXTURE);
  await waitForCanvas(page, 'flowchart');
  await waitForFlowchartFixtureRender(page);
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

async function prepareSettingsTargetForTouch(
  page: Page,
  target: Locator,
  label: string,
): Promise<void> {
  await target.waitFor({ state: 'visible', timeout: 15_000 });
  await target.scrollIntoViewIfNeeded();
  await target.evaluate((element) => {
    const dialog = element.closest('[data-testid="workspace-settings-dialog"]');
    if (!(dialog instanceof HTMLElement)) return;
    const dialogBounds = dialog.getBoundingClientRect();
    const targetBounds = element.getBoundingClientRect();
    dialog.scrollTop += targetBounds.top - dialogBounds.top
      - ((dialog.clientHeight - targetBounds.height) / 2);
  });
  await expect.poll(async () => target.evaluate((element) => {
    const dialog = element.closest('[data-testid="workspace-settings-dialog"]');
    if (!(dialog instanceof HTMLElement)) {
      return { centerHit: false, contained: false, hit: 'missing settings dialog' };
    }
    const dialogBounds = dialog.getBoundingClientRect();
    const targetBounds = element.getBoundingClientRect();
    const centerX = targetBounds.left + (targetBounds.width / 2);
    const centerY = targetBounds.top + (targetBounds.height / 2);
    const hit = document.elementFromPoint(centerX, centerY);
    const contained = targetBounds.top >= dialogBounds.top - 0.5
      && targetBounds.bottom <= dialogBounds.bottom + 0.5
      && targetBounds.left >= dialogBounds.left - 0.5
      && targetBounds.right <= dialogBounds.right + 0.5;
    return {
      centerHit: hit instanceof Node && element.contains(hit),
      contained,
      dialog: { bottom: dialogBounds.bottom, left: dialogBounds.left, right: dialogBounds.right, top: dialogBounds.top },
      hit: hit instanceof Element
        ? `${hit.tagName.toLowerCase()}[data-testid=${hit.getAttribute('data-testid') ?? ''}][class=${hit.getAttribute('class') ?? ''}]`
        : 'none',
      target: { bottom: targetBounds.bottom, left: targetBounds.left, right: targetBounds.right, top: targetBounds.top },
    };
  }), {
    message: `${label} did not settle fully inside the scrollable settings dialog with an unobscured center hit.`,
    timeout: 5_000,
  }).toMatchObject({ centerHit: true, contained: true });
  await assertContainedInViewport(page, target, label);
  await assertHitTarget(page, target, label);
}

async function expectResponsiveControls(page: Page, label: string, diagramName: string): Promise<void> {
  await page.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 });
  await selectTabByName(page, diagramName);
  await waitForCanvas(page, 'flowchart');
  const sourceToggle = page.getByTestId('source-flyout-toggle');
  await expect(sourceToggle).toHaveAccessibleName(/^(show|hide) source$/i);
  assert(await sourceToggle.getAttribute('title') === 'Mermaid source',
    `${label} source toggle must retain its tooltip when text is hidden.`);
  await assertHitTarget(page, sourceToggle, `${label} source toggle`);
  if (label.startsWith('mobile')) {
    const sourceBounds = await sourceToggle.boundingBox();
    assert(sourceBounds !== null && sourceBounds.width >= 44 && sourceBounds.height >= 44,
      `${label} source toggle must provide a 44px touch target: ${JSON.stringify(sourceBounds)}.`);
  }
  if (label === 'mobile-320') {
    const topbarOverflow = page.getByTestId('topbar-collaborator-overflow');
    const footerOverflow = page.getByTestId('footer-collaborator-overflow');
    await expect.poll(async () => Number((await topbarOverflow.textContent())?.slice(1) ?? '0'), {
      message: 'mobile-320 did not expose an overflow indicator for four or more topbar collaborators.',
      timeout: 15_000,
    }).toBeGreaterThan(0);
    await expect.poll(async () => Number((await footerOverflow.textContent())?.slice(1) ?? '0'), {
      message: 'mobile-320 did not expose an overflow indicator for four or more footer collaborators.',
      timeout: 15_000,
    }).toBeGreaterThan(0);
    for (const [target, targetLabel] of [
      [topbarOverflow, 'topbar collaborator overflow'],
      [footerOverflow, 'footer collaborator overflow'],
    ] as const) {
      await target.waitFor({ state: 'visible', timeout: 15_000 });
      assert(/^\d+ more collaborators$/u.test(await target.getAttribute('aria-label') ?? ''),
        `${label} ${targetLabel} must expose its hidden collaborator count to assistive technology.`);
    }
  }
  const settingsTrigger = page.getByTestId(SETTINGS_TRIGGER_TEST_ID);
  await assertHitTarget(page, settingsTrigger, `${label} workspace settings trigger`);
  await assertContainedInViewport(page, settingsTrigger, `${label} workspace settings trigger`);
  if (label.startsWith('mobile')) {
    const settingsBounds = await settingsTrigger.boundingBox();
    assert(settingsBounds !== null && settingsBounds.width >= 44 && settingsBounds.height >= 44,
      `${label} workspace settings trigger must provide a 44px touch target: ${JSON.stringify(settingsBounds)}.`);
  }
  const settings = await openWorkspaceSettings(page);
  await assertContainedInViewport(page, settings, `${label} workspace settings dialog`);
  if (label.startsWith('mobile')) {
    const closeSettings = settings.getByRole('button', { name: 'Close', exact: true });
    await assertContainedInViewport(page, closeSettings, `${label} close settings initial state`);
    await assertHitTarget(page, closeSettings, `${label} close settings initial state`);
    const closeBounds = await closeSettings.boundingBox();
    assert(closeBounds !== null && closeBounds.height >= 44,
      `${label} close settings must provide a 44px touch target: ${JSON.stringify(closeBounds)}.`);
    for (const [target, targetLabel] of [
      [settings.getByRole('button', { name: 'Cancel', exact: true }), 'cancel display-name edit'],
      [settings.getByRole('button', { name: 'Save name', exact: true }), 'save display name'],
      [settings.getByRole('button', { name: /^(Connect my agent|Connection details)$/u }), 'agent connection'],
      [settings.getByRole('textbox', { name: 'Display name', exact: true }), 'display-name input'],
      [settings.locator('.workspace-settings-theme-option').first(), 'System theme option'],
      [settings.locator('.workspace-settings-theme-option').nth(1), 'Light theme option'],
      [settings.locator('.workspace-settings-theme-option').nth(2), 'Dark theme option'],
    ] as const) {
      await prepareSettingsTargetForTouch(page, target, `${label} ${targetLabel}`);
      const bounds = await target.boundingBox();
      assert(bounds !== null && bounds.height >= 44,
        `${label} ${targetLabel} must provide a 44px touch target: ${JSON.stringify(bounds)}.`);
    }
  }
  await saveScreenshot(page, `issue-28-${label}-settings`);
  await closeWorkspaceSettings(page);
  await verifiedClick(page, sourceToggle, `${label} source toggle`);
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
      [settingsTrigger, 'workspace settings trigger'],
      [sourceToggle, 'source toggle'],
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

const PHONE_CONTEXT_OPTIONS = { deviceScaleFactor: 1, hasTouch: true, isMobile: true } as const;

async function waitForPhoneLayout(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await new Promise<void>((resolve) => { requestAnimationFrame(() => { requestAnimationFrame(() => { resolve(); }); }); });
  });
}

async function assertPhoneViewportEvidence(page: Page, label: string, state: string): Promise<void> {
  await waitForPhoneLayout(page);
  await assertDocumentMatchesViewport(page, `${label} ${state}`);
  const configuredViewport = page.viewportSize();
  assert(configuredViewport, `${label} ${state} has no configured browser viewport.`);
  const layout = await page.evaluate(() => ({
    devicePixelRatio: window.devicePixelRatio,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
  }));
  assert(layout.devicePixelRatio === 1,
    `${label} ${state} must capture at deviceScaleFactor 1, received ${layout.devicePixelRatio}.`);
  assert(layout.innerWidth === configuredViewport.width && layout.innerHeight === configuredViewport.height,
    `${label} ${state} CSS viewport ${layout.innerWidth}x${layout.innerHeight} did not match configured ${configuredViewport.width}x${configuredViewport.height}.`);
  const screenshot = await saveViewportScreenshot(page, `issue-18-${label}-${state}`);
  assert(screenshot.width === configuredViewport.width && screenshot.height === configuredViewport.height,
    `${label} ${state} screenshot was ${screenshot.width}x${screenshot.height}, expected ${configuredViewport.width}x${configuredViewport.height} at deviceScaleFactor 1.`);
}

async function assertVisiblePhoneActionTargets(page: Page, label: string, state: string): Promise<void> {
  const targets = page.locator('button, [role="tab"]');
  const viewport = page.viewportSize();
  assert(viewport, `${label} ${state} has no configured browser viewport.`);
  const count = await targets.count();
  let checked = 0;
  for (let index = 0; index < count; index += 1) {
    const target = targets.nth(index);
    if (!await target.isVisible()) continue;
    const box = await target.boundingBox();
    if (!box) continue;
    const centerVisible = box.x + (box.width / 2) >= 0
      && box.x + (box.width / 2) <= viewport.width
      && box.y + (box.height / 2) >= 0
      && box.y + (box.height / 2) <= viewport.height;
    if (!centerVisible) continue;
    const name = (await target.getAttribute('aria-label')) ?? (await target.textContent())?.trim() ?? `action ${index + 1}`;
    const centerResult = await target.evaluate((element, point) => {
      const hit = document.elementFromPoint(point.x, point.y);
      const targetHit = !!hit && (element === hit || element.contains(hit));
      let ancestor = element.parentElement;
      let clippedByScrollContainer = false;
      while (ancestor && !clippedByScrollContainer) {
        const style = window.getComputedStyle(ancestor);
        const clipsX = style.overflowX === 'auto' || style.overflowX === 'scroll';
        const clipsY = style.overflowY === 'auto' || style.overflowY === 'scroll';
        if (clipsX || clipsY) {
          const rect = ancestor.getBoundingClientRect();
          clippedByScrollContainer = (clipsX && (point.x < rect.left || point.x > rect.right))
            || (clipsY && (point.y < rect.top || point.y > rect.bottom));
        }
        ancestor = ancestor.parentElement;
      }
      const activeSurfaceSelectors = [
        '[data-testid="source-flyout"]',
        '[data-testid="activity-flyout"]',
        '[data-testid="workspace-settings-dialog"]',
        '[role="menu"][aria-label="Starter templates"]',
      ];
      const occludedByActiveSurface = !targetHit && !!hit && activeSurfaceSelectors.some((selector) => {
        const surface = document.querySelector(selector);
        return surface !== null && surface.contains(hit) && !surface.contains(element);
      });
      return {
        clippedByScrollContainer,
        hitDescription: hit instanceof Element
          ? `${hit.tagName.toLowerCase()}[data-testid=${hit.getAttribute('data-testid') ?? ''}][class=${hit.getAttribute('class') ?? ''}]`
          : 'none',
        occludedByActiveSurface,
        targetHit,
      };
    }, { x: box.x + (box.width / 2), y: box.y + (box.height / 2) });
    if (centerResult.clippedByScrollContainer) continue;
    if (centerResult.occludedByActiveSurface) continue;
    assert(centerResult.targetHit, `${label} ${state} ${name} is visible and centered in the viewport, but its center is hit by ${centerResult.hitDescription}.`);
    await assertTouchTarget(page, target, `${label} ${state} ${name}`);
    checked += 1;
  }
  assert(checked > 0, `${label} ${state} did not expose any visible action chrome.`);
}

async function assertPhoneSurface(page: Page, label: string, state: string): Promise<void> {
  await assertVisiblePhoneActionTargets(page, label, state);
  await assertPhoneViewportEvidence(page, label, state);
}

async function assertActiveTabVisible(page: Page, label: string): Promise<void> {
  const activeTab = page.locator('[role="tab"][aria-selected="true"]');
  await activeTab.waitFor({ state: 'visible', timeout: 15_000 });
  let geometry: { scrollerLeft: number; scrollerRight: number; tabLeft: number; tabRight: number } | null = null;
  try {
    await expect.poll(async () => {
      geometry = await activeTab.evaluate((tab) => {
        const scroller = tab.closest('[data-testid="diagram-tab-bar"]')?.querySelector('.workspace-diagram-tab-scroller');
        if (!(scroller instanceof HTMLElement)) {
          throw new Error('The active diagram tab has no scroll container.');
        }
        const tabContainer = tab.closest('.workspace-diagram-tab');
        if (!(tabContainer instanceof HTMLElement)) {
          throw new Error('The active diagram tab has no action container.');
        }
        const tabRect = tabContainer.getBoundingClientRect();
        const scrollerRect = scroller.getBoundingClientRect();
        return {
          scrollerLeft: scrollerRect.left,
          scrollerRight: scrollerRect.right,
          tabLeft: tabRect.left,
          tabRight: tabRect.right,
        };
      });
      return geometry.tabLeft >= geometry.scrollerLeft - 1 && geometry.tabRight <= geometry.scrollerRight + 1;
    }, { timeout: 5_000 }).toBe(true);
  } catch (error) {
    throw new Error(`${label} active tab or its actions remained clipped in the overflow scroller: ${JSON.stringify(geometry)}.`, { cause: error });
  }
}

async function tapTarget(page: Page, target: Locator, label: string): Promise<void> {
  await assertTouchTarget(page, target, label);
  const box = await target.boundingBox();
  assert(box, `${label} has no tappable bounds.`);
  await page.touchscreen.tap(box.x + (box.width / 2), box.y + (box.height / 2));
}

async function expectTouchLabelStatus(page: Page, expected: string, label: string): Promise<void> {
  const status = page.getByTestId('workspace-touch-label-status');
  await expect(status, `${label} did not preserve its touch label outside the action subtree.`).toHaveText(expected);
  await expect(status, `${label} touch label was not visibly presented.`).toHaveClass(/\bis-visible\b/u);
  await assertContainedInViewport(page, status, `${label} touch label`);
}

async function waitForCameraChange(page: Page, previous: string, label: string): Promise<string> {
  await page.waitForFunction((before) => {
    const layer = document.querySelector('.diagram-canvas-svg')?.parentElement;
    return layer instanceof HTMLElement && layer.style.transform !== before;
  }, previous, { timeout: 5_000 });
  return renderedCanvasCameraTransform(page, label);
}

type CanvasGesturePoint = { x: number; y: number };

async function allowedCanvasGesturePoints(
  page: Page,
  label: string,
  count: number,
  minimumSeparationPx: number,
): Promise<CanvasGesturePoint[]> {
  const points = await page.getByTestId('diagram-canvas').evaluate((canvas, options) => {
    const root = canvas as HTMLElement;
    const rect = root.getBoundingClientRect();
    const forbiddenSelector = 'button, input, select, textarea, [contenteditable="true"], [role="button"], .react-flow__node, .react-flow__edge, .react-flow__handle';
    const ratios = [0.12, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.88];
    const candidates: CanvasGesturePoint[] = [];

    for (const yRatio of ratios) {
      for (const xRatio of ratios) {
        const point = { x: rect.left + (rect.width * xRatio), y: rect.top + (rect.height * yRatio) };
        const target = document.elementFromPoint(point.x, point.y);
        if (!(target instanceof Element) || !root.contains(target) || target.closest(forbiddenSelector)) continue;
        if (candidates.every((candidate) => Math.hypot(candidate.x - point.x, candidate.y - point.y) >= options.minimumSeparationPx)) {
          candidates.push(point);
        }
        if (candidates.length === options.count) return candidates;
      }
    }
    return candidates;
  }, { count, minimumSeparationPx });
  assert(points.length === count,
    `${label} found ${points.length} of ${count} required blank canvas touch points at least ${minimumSeparationPx}px apart.`);
  return points;
}

async function dispatchTouchDrag(page: Page, label: string): Promise<void> {
  const [from, to] = await allowedCanvasGesturePoints(page, `${label} pan`, 2, 48);
  assert(from && to, `${label} pan did not resolve two blank canvas points.`);
  const session = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => ({ force: 1, id: 1, radiusX: 1, radiusY: 1, x, y });
  try {
    await session.send('Input.dispatchTouchEvent', { touchPoints: [point(from.x, from.y)], type: 'touchStart' });
    await session.send('Input.dispatchTouchEvent', { touchPoints: [point((from.x + to.x) / 2, (from.y + to.y) / 2)], type: 'touchMove' });
    await session.send('Input.dispatchTouchEvent', { touchPoints: [point(to.x, to.y)], type: 'touchMove' });
    await session.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  } finally {
    await session.detach();
  }
}

function parseCameraTransform(transform: string, label: string): { panX: number; panY: number; zoom: number } {
  const match = transform.match(/^translate\(([-+]?(?:\d+(?:\.\d*)?|\.\d+))px,\s*([-+]?(?:\d+(?:\.\d*)?|\.\d+))px\)\s*scale\(([-+]?(?:\d+(?:\.\d*)?|\.\d+))\)$/u);
  assert(match, `${label} has an unexpected canvas transform: ${transform}.`);
  const camera = { panX: Number(match[1]), panY: Number(match[2]), zoom: Number(match[3]) };
  assert(Object.values(camera).every(Number.isFinite), `${label} has non-finite camera values: ${transform}.`);
  return camera;
}

async function assertPinchZoomIncrease(page: Page, label: string, renderer: 'flowchart' | 'generic', residuals: string[]): Promise<void> {
  const initial = await allowedCanvasGesturePoints(page, `${label} ${renderer} pinch`, 2, 72);
  const [first, second] = initial;
  assert(first && second, `${label} ${renderer} pinch did not resolve two blank canvas points.`);
  const beforeTransform = await renderedCanvasCameraTransform(page, `${label} ${renderer} pinch baseline`);
  const before = parseCameraTransform(beforeTransform, `${label} ${renderer} pinch baseline`);
  const center = { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
  const expansion = 1.35;
  const movedFirst = {
    x: center.x + ((first.x - center.x) * expansion),
    y: center.y + ((first.y - center.y) * expansion),
  };
  const movedSecond = {
    x: center.x + ((second.x - center.x) * expansion),
    y: center.y + ((second.y - center.y) * expansion),
  };
  const session = await page.context().newCDPSession(page);
  const point = (id: number, x: number, y: number) => ({ force: 1, id, radiusX: 1, radiusY: 1, x, y });
  try {
    await session.send('Input.dispatchTouchEvent', {
      touchPoints: [point(1, first.x, first.y), point(2, second.x, second.y)],
      type: 'touchStart',
    });
    await session.send('Input.dispatchTouchEvent', {
      touchPoints: [point(1, movedFirst.x, movedFirst.y), point(2, movedSecond.x, movedSecond.y)],
      type: 'touchMove',
    });
    await session.send('Input.dispatchTouchEvent', { touchPoints: [], type: 'touchEnd' });
  } catch (error) {
    throw new Error(`${label} ${renderer} CDP pinch could not be dispatched.`, { cause: error });
  } finally {
    await session.detach();
  }
  let afterZoom = before.zoom;
  await expect.poll(async () => {
    const transform = await renderedCanvasCameraTransform(page, `${label} ${renderer} pinch result`);
    afterZoom = parseCameraTransform(transform, `${label} ${renderer} pinch result`).zoom;
    return afterZoom;
  }, {
    message: `${label} ${renderer} pinch did not increase zoom above ${before.zoom}.`,
    timeout: 5_000,
  }).toBeGreaterThan(before.zoom + 0.001);
  residuals.push(`${label} ${renderer}: simulated pinch increased zoom from ${before.zoom} to ${afterZoom}; physical iOS/Android pinch remains a manual residual.`);
}

async function expectTouchCanvasControls(
  page: Page,
  label: string,
  renderer: 'flowchart' | 'generic',
  residuals: string[],
): Promise<void> {
  const controls = page.getByTestId('canvas-controls-toolbar');
  await controls.waitFor({ state: 'visible', timeout: 15_000 });
  for (const name of ['Zoom out', 'Zoom in', 'Fit diagram'] as const) {
    await assertTouchTarget(page, page.getByRole('button', { name, exact: true }), `${label} ${renderer} ${name}`);
  }
  if (renderer === 'flowchart') {
    const addNode = page.getByRole('button', { name: 'Add node to Mermaid text', exact: true });
    await assertTouchTarget(page, addNode, `${label} flowchart add-node control`);
    await addNode.click({ trial: true, timeout: 15_000 });
  }

  const beforeZoom = await renderedCanvasCameraTransform(page, `${label} ${renderer} touch zoom baseline`);
  await tapTarget(page, page.getByRole('button', { name: 'Zoom in', exact: true }), `${label} ${renderer} touch Zoom in`);
  const afterZoom = await waitForCameraChange(page, beforeZoom, `${label} ${renderer} touch zoom`);
  await tapTarget(page, page.getByRole('button', { name: 'Fit diagram', exact: true }), `${label} ${renderer} touch Fit diagram`);
  const afterFit = await waitForCameraChange(page, afterZoom, `${label} ${renderer} touch fit`);
  await dispatchTouchDrag(page, `${label} ${renderer}`);
  await waitForCameraChange(page, afterFit, `${label} ${renderer} touch pan`);
  await assertPinchZoomIncrease(page, label, renderer, residuals);
}

async function expectPhoneLiveCodingWorkspace(page: Page, label: string, diagramName: string, residuals: string[]): Promise<void> {
  await page.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 });
  await selectTabByName(page, diagramName);
  await waitForCanvas(page, 'flowchart');
  await assertActiveTabVisible(page, `${label} initial tabs`);
  await assertPhoneSurface(page, label, 'canvas');

  await expect.poll(async () => (await presenceSignature(page)).length, {
    message: `${label} did not show collaboration presence after peer pages joined.`,
    timeout: 15_000,
  }).toBeGreaterThanOrEqual(2);
  await assertPhoneSurface(page, label, 'presence-and-footer');

  const sourceCamera = await renderedCanvasCameraTransform(page, `${label} source baseline`);
  const sourceToggle = page.getByTestId('source-flyout-toggle');
  await tapTarget(page, sourceToggle, `${label} source toggle`);
  await page.getByTestId('source-flyout').waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.getByTestId('source-flyout')).toHaveCount(1);
  await expectTouchLabelStatus(page, 'Show source', `${label} source toggle`);
  assert(await renderedCanvasCameraTransform(page, `${label} source open`) === sourceCamera,
    `${label} opening source changed the local canvas camera.`);
  await assertPhoneSurface(page, label, 'source');
  const sourceClose = page.getByRole('button', { name: 'Close source panel', exact: true });
  await tapTarget(page, sourceClose, `${label} source close`);
  await page.getByTestId('source-flyout').waitFor({ state: 'detached', timeout: 15_000 });
  await expectTouchLabelStatus(page, 'Close', `${label} source close`);
  assert(await renderedCanvasCameraTransform(page, `${label} source close`) === sourceCamera,
    `${label} closing source changed the local canvas camera.`);

  const templateCamera = await renderedCanvasCameraTransform(page, `${label} template baseline`);
  const templateMenu = await openTemplateMenu(page);
  assert(await renderedCanvasCameraTransform(page, `${label} template open`) === templateCamera,
    `${label} opening templates changed the local canvas camera.`);
  await assertContainedInViewport(page, templateMenu, `${label} starter template menu`);
  const blankTemplate = templateMenuItem(page, 'Blank sheet');
  await assertTouchTarget(page, blankTemplate, `${label} Blank sheet template`);
  await blankTemplate.click({ trial: true, timeout: 15_000 });
  await assertPhoneSurface(page, label, 'templates');
  if (label === 'mobile-390') {
    const beforeTabCount = await page.getByRole('tab').count();
    await blankTemplate.click();
    await page.waitForFunction((count) => document.querySelectorAll('[role="tab"]').length === count + 1, beforeTabCount, { timeout: 15_000 });
    await assertActiveTabVisible(page, `${label} blank-sheet tab`);
    await assertPhoneSurface(page, label, 'tab-overflow');
    await renameActiveDiagram(page, 'Phone scratchpad');
    await assertActiveTabVisible(page, `${label} renamed tab`);
    const tabCountBeforeDelete = await page.getByRole('tab').count();
    const deleteTab = page.getByRole('button', { name: 'Delete Phone scratchpad', exact: true });
    await tapTarget(page, deleteTab, `${label} delete tab`);
    await page.waitForFunction((count) => document.querySelectorAll('[role="tab"]').length === count - 1, tabCountBeforeDelete, { timeout: 15_000 });
    await expect(page.getByRole('tab', { name: 'Phone scratchpad', exact: true })).toHaveCount(0);
    await expectTouchLabelStatus(page, 'Delete', `${label} delete tab`);
  } else {
    await waitForFocusedLocator(page, blankTemplate, `${label} opening starter templates`);
    await blankTemplate.press('Escape');
    await templateMenu.waitFor({ state: 'detached', timeout: 15_000 });
    await waitForFocusedTestId(page, 'create-diagram-tab', `${label} closing starter templates with Escape`);
  }

  await selectTabByName(page, diagramName);
  await waitForCanvas(page, 'flowchart');
  const settingsCamera = await renderedCanvasCameraTransform(page, `${label} settings baseline`);
  const settingsTrigger = page.getByTestId(SETTINGS_TRIGGER_TEST_ID);
  await tapTarget(page, settingsTrigger, `${label} settings`);
  await page.getByTestId(SETTINGS_DIALOG_TEST_ID).waitFor({ state: 'visible', timeout: 15_000 });
  await expect(page.getByTestId(SETTINGS_DIALOG_TEST_ID)).toHaveCount(1);
  await expectTouchLabelStatus(page, 'Settings', `${label} settings`);
  assert(await renderedCanvasCameraTransform(page, `${label} settings open`) === settingsCamera,
    `${label} opening settings changed the local canvas camera.`);
  await assertPhoneSurface(page, label, 'settings');
  await closeWorkspaceSettings(page);
  assert(await renderedCanvasCameraTransform(page, `${label} settings close`) === settingsCamera,
    `${label} closing settings changed the local canvas camera.`);

  const historyCamera = await renderedCanvasCameraTransform(page, `${label} history baseline`);
  await ensureFlyout(page, 'activity');
  assert(await renderedCanvasCameraTransform(page, `${label} history open`) === historyCamera,
    `${label} opening history changed the local canvas camera.`);
  await page.getByTestId('diagram-history-list').waitFor({ state: 'visible', timeout: 15_000 });
  await assertPhoneSurface(page, label, 'history');
  await closeFlyout(page, 'activity');
  assert(await renderedCanvasCameraTransform(page, `${label} history close`) === historyCamera,
    `${label} closing history changed the local canvas camera.`);

  await expectTouchCanvasControls(page, label, 'flowchart', residuals);
  await assertPhoneSurface(page, label, 'flowchart-touch-controls');

  await replaceSource(page, API_SEQUENCE_FIXTURE);
  await waitForSource(page, API_SEQUENCE_FIXTURE);
  await closeFlyout(page, 'source');
  await waitForCanvas(page, 'generic');
  await expectTouchCanvasControls(page, label, 'generic', residuals);
  await assertPhoneSurface(page, label, 'generic-touch-controls');

  await replaceSource(page, INVALID_MERMAID_FIXTURE);
  await waitForInvalidPreview(page);
  const sourceFlyout = page.getByTestId('source-flyout');
  const sourceParseStatus = page.getByTestId('source-parse-status');
  await sourceParseStatus.waitFor({ state: 'visible', timeout: 15_000 });
  await expect(sourceParseStatus).toContainText('Preview kept on last valid diagram');
  await expect(sourceParseStatus.locator('span')).not.toHaveText('');
  await expect(page.getByTestId('parse-error-banner')).toHaveCount(0);
  await assertContainedInViewport(page, sourceFlyout, `${label} invalid Mermaid source flyout`);
  await assertContainedInViewport(page, sourceParseStatus, `${label} contextual source parse error`);
  await assertPhoneSurface(page, label, 'source-parse-error');

  await replaceSource(page, FLOWCHART_FIXTURE);
  await waitForSource(page, FLOWCHART_FIXTURE);
  await sourceParseStatus.waitFor({ state: 'detached', timeout: 15_000 });
  await closeFlyout(page, 'source');
  await waitForCanvas(page, 'flowchart');
  await assertPhoneSurface(page, label, 'flowchart-restored');
}

function historyItem(page: Page, revisionId: string): Locator {
  return page.getByTestId(`history-revision-${revisionId}`);
}

async function prepareHistoryActionForClick(
  page: Page,
  item: Locator,
  action: Locator,
  label: string,
): Promise<void> {
  const list = page.getByTestId('diagram-history-list');
  await list.waitFor({ state: 'visible', timeout: 15_000 });
  await item.waitFor({ state: 'visible', timeout: 15_000 });
  await item.evaluate((element) => {
    element.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
  });
  await action.scrollIntoViewIfNeeded();
  await expect.poll(async () => action.evaluate((element) => {
    const itemElement = element.closest('.history-item');
    const listElement = element.closest('.history-list');
    if (!(itemElement instanceof HTMLElement) || !(listElement instanceof HTMLElement)) {
      return { actionContained: false, centerHit: false, hit: 'missing history ancestors', itemContained: false };
    }
    const actionBounds = element.getBoundingClientRect();
    const itemBounds = itemElement.getBoundingClientRect();
    const listBounds = listElement.getBoundingClientRect();
    const centerX = actionBounds.left + (actionBounds.width / 2);
    const centerY = actionBounds.top + (actionBounds.height / 2);
    const hit = document.elementFromPoint(centerX, centerY);
    const actionContained = actionBounds.top >= listBounds.top - 0.5
      && actionBounds.bottom <= listBounds.bottom + 0.5
      && actionBounds.left >= listBounds.left - 0.5
      && actionBounds.right <= listBounds.right + 0.5;
    const itemContained = itemBounds.top >= listBounds.top - 0.5
      && itemBounds.bottom <= listBounds.bottom + 0.5
      && itemBounds.left >= listBounds.left - 0.5
      && itemBounds.right <= listBounds.right + 0.5;
    return {
      action: { bottom: actionBounds.bottom, left: actionBounds.left, right: actionBounds.right, top: actionBounds.top },
      actionContained,
      centerHit: hit instanceof Node && element.contains(hit),
      hit: hit instanceof Element
        ? `${hit.tagName.toLowerCase()}[data-testid=${hit.getAttribute('data-testid') ?? ''}][class=${hit.getAttribute('class') ?? ''}]`
        : 'none',
      item: { bottom: itemBounds.bottom, left: itemBounds.left, right: itemBounds.right, top: itemBounds.top },
      itemContained,
      list: { bottom: listBounds.bottom, left: listBounds.left, right: listBounds.right, top: listBounds.top },
    };
  }), {
    message: `${label} did not settle fully inside the history list with an unobscured center hit.`,
    timeout: 5_000,
  }).toMatchObject({ actionContained: true, centerHit: true, itemContained: true });
  await assertContainedInViewport(page, action, label);
  await assertHitTarget(page, action, label);
}

function snapshotsMatch(left: YjsSessionSnapshot, right: YjsSessionSnapshot): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function sourceAndLayoutMatch(
  snapshot: YjsSessionSnapshot,
  revision: Pick<DiagramRevision, 'mermaidText' | 'nodePositions'>,
): boolean {
  return snapshot.mermaidText === revision.mermaidText
    && JSON.stringify(snapshot.nodePositions) === JSON.stringify(revision.nodePositions);
}

async function waitForHistoryRevision(
  mcp: ModernMcpClient,
  sessionId: string,
  diagramId: string,
  source: string,
): Promise<{ history: { currentRevision: string; revisions: DiagramRevisionSummary[] }; revision: DiagramRevision }> {
  let match: { history: { currentRevision: string; revisions: DiagramRevisionSummary[] }; revision: DiagramRevision } | null = null;
  await expect.poll(async () => {
    const history = await mcp.listDiagramHistory(sessionId, diagramId);
    for (const summary of history.revisions) {
      const revision = await mcp.readDiagramRevision(sessionId, diagramId, summary.id);
      if (revision.mermaidText === source) {
        match = { history, revision };
        return true;
      }
    }
    return false;
  }, {
    message: `Immutable history did not capture the requested Mermaid source for ${diagramId}.`,
    timeout: 15_000,
  }).toBe(true);
  assert(match, `History search did not retain ${diagramId} even though its poll succeeded.`);
  return match;
}

async function renderedSelectedNodeIds(page: Page): Promise<string[]> {
  return page.locator('.react-flow__node.selected').evaluateAll((nodes) => nodes
    .map((node) => node.getAttribute('data-id'))
    .filter((id): id is string => Boolean(id))
    .sort());
}

async function canonicalSelectedNodeIds(page: Page): Promise<string[]> {
  const value = await page.getByTestId('diagram-canvas').getAttribute('data-selected-node-ids');
  assert(value !== null, 'Diagram canvas did not expose canonical selected-node state.');
  try {
    const selected = JSON.parse(value);
    assert(Array.isArray(selected) && selected.every((nodeId) => typeof nodeId === 'string'),
      `Diagram canvas exposed invalid canonical selected-node state: ${value}.`);
    return selected;
  } catch {
    throw new Error(`Diagram canvas exposed invalid canonical selected-node state: ${value}.`);
  }
}

async function presenceSignature(page: Page): Promise<string[]> {
  return page.getByTestId('presence-bar').locator('[title]').evaluateAll((avatars) => avatars
    .map((avatar) => avatar.getAttribute('title') ?? '')
    .filter(Boolean)
    .sort());
}

type LocalWorkspaceSnapshot = {
  activeTab: string;
  camera: string;
  presence: string[];
  selected: string[];
};

async function snapshotLocalWorkspace(page: Page, label: string): Promise<LocalWorkspaceSnapshot> {
  return {
    activeTab: await activeTabName(page),
    camera: await renderedCanvasCameraTransform(page, `${label} camera`),
    presence: await presenceSignature(page),
    selected: await canonicalSelectedNodeIds(page),
  };
}

async function selectAndZoomHistoryDiagram(page: Page, index: number, label: string): Promise<void> {
  const node = page.locator('.react-flow__node').nth(index);
  await verifiedClick(page, node, `${label} selected node`);
  const beforeZoom = await renderedCanvasTransform(page, `${label} before zoom`);
  await verifiedClick(page, page.getByRole('button', { name: 'Zoom in', exact: true }), `${label} zoom in`);
  await page.waitForFunction((previous) => document.querySelector('.diagram-canvas-svg')?.parentElement?.getAttribute('style') !== previous, beforeZoom, { timeout: 5_000 });
}

async function dragHistoryNode(page: Page, label: string, delta: { x: number; y: number }): Promise<string> {
  const node = page.locator('.react-flow__node').first();
  const nodeId = await node.getAttribute('data-id');
  assert(nodeId, `${label} drag fixture is missing a React Flow node ID.`);
  const box = await node.boundingBox();
  assert(box, `${label} drag fixture has no node bounds.`);
  await page.mouse.move(box.x + (box.width / 2), box.y + (box.height / 2));
  await page.mouse.down();
  await page.mouse.move(box.x + (box.width / 2) + delta.x, box.y + (box.height / 2) + delta.y, { steps: 8 });
  await page.mouse.up();
  return nodeId;
}

async function expectHistoryFlyoutSafety(
  page: Page,
  label: string,
  revisionId: string,
): Promise<void> {
  const before = await snapshotAnchors(page, ANCHORS);
  const beforeCamera = await waitForStableCanvasTransform(page, `${label} history camera`);
  const toggle = page.getByTestId('activity-flyout-toggle');
  await assertHitTarget(page, toggle, `${label} activity and history toggle`);
  await assertContainedInViewport(page, toggle, `${label} activity and history toggle`);
  await verifiedClick(page, toggle, `${label} activity and history toggle`);
  const flyout = page.getByTestId('activity-flyout');
  await flyout.waitFor({ state: 'visible', timeout: 15_000 });
  await assertContainedInViewport(page, flyout, `${label} history flyout`);
  const close = flyout.getByLabel('Close activity and history', { exact: true });
  await waitForFocusedLocator(page, close, `${label} opening activity and history`);
  const historySwitch = flyout.getByRole('button', { name: 'History', exact: true });
  await assertHitTarget(page, historySwitch, `${label} history view toggle`);
  const revision = historyItem(page, revisionId);
  await revision.waitFor({ state: 'visible', timeout: 15_000 });
  const preview = revision.getByRole('button', { name: 'Preview', exact: true });
  const restore = revision.getByRole('button', { name: 'Restore', exact: true });
  const isMobile = label.startsWith('mobile');
  if (!isMobile) {
    await assertHitTarget(page, preview, `${label} revision preview action`);
    await assertHitTarget(page, restore, `${label} revision restore action`);
  } else {
    for (const [target, targetLabel] of [
      [toggle, 'activity and history toggle'],
      [close, 'close activity and history'],
      [historySwitch, 'History switch'],
      [preview, 'revision Preview'],
      [restore, 'revision Restore'],
    ] as const) {
      await target.scrollIntoViewIfNeeded();
      await assertHitTarget(page, target, `${label} ${targetLabel}`);
      const bounds = await target.boundingBox();
      assert(bounds !== null && bounds.height >= 44,
        `${label} ${targetLabel} must provide a 44px touch target: ${JSON.stringify(bounds)}.`);
    }
  }
  assertAnchorsStable(before, await snapshotAnchors(page, ANCHORS));
  assert(await renderedCanvasCameraTransform(page, `${label} history open camera`) === beforeCamera,
    `${label} opening history changed the canvas camera.`);

  if (isMobile) {
    await preview.scrollIntoViewIfNeeded();
  }
  await verifiedClick(page, preview, `${label} revision preview action`);
  const cancelPreview = flyout.getByRole('button', { name: 'Cancel preview', exact: true });
  await cancelPreview.waitFor({ state: 'visible', timeout: 15_000 });
  if (isMobile) {
    await cancelPreview.scrollIntoViewIfNeeded();
  }
  await assertHitTarget(page, cancelPreview, `${label} cancel history preview`);
  if (isMobile) {
    const bounds = await cancelPreview.boundingBox();
    assert(bounds !== null && bounds.height >= 44,
      `${label} Cancel preview must provide a 44px touch target: ${JSON.stringify(bounds)}.`);
  }
  await verifiedClick(page, cancelPreview, `${label} cancel history preview`);
  await cancelPreview.waitFor({ state: 'detached', timeout: 15_000 });
  assertAnchorsStable(before, await snapshotAnchors(page, ANCHORS));
  assert(await renderedCanvasCameraTransform(page, `${label} history cancel camera`) === beforeCamera,
    `${label} cancelling history preview changed the canvas camera.`);
  await page.keyboard.press('Escape');
  await flyout.waitFor({ state: 'detached', timeout: 15_000 });
  await waitForFocusedTestId(page, 'activity-flyout-toggle', `${label} closing history with Escape`);
}

async function expectCrossRendererHistoryPreviewCameraHandoff(
  page: Page,
  mcp: ModernMcpClient,
  sessionId: string,
  diagramId: string,
): Promise<void> {
  await mcp.writeLatest(sessionId, diagramId, HISTORY_GENERIC_SEQUENCE, 'Prepared generic history camera handoff');
  await ensureSourceFlyoutOpen(page);
  await waitForSource(page, HISTORY_GENERIC_SEQUENCE);
  await closeFlyout(page, 'source');
  await waitForCanvas(page, 'generic');
  const genericHistory = await waitForHistoryRevision(mcp, sessionId, diagramId, HISTORY_GENERIC_SEQUENCE);

  await mcp.writeLatest(sessionId, diagramId, HISTORY_CURRENT_FLOWCHART, 'Prepared live flowchart after generic history');
  await ensureSourceFlyoutOpen(page);
  await waitForSource(page, HISTORY_CURRENT_FLOWCHART);
  await closeFlyout(page, 'source');
  await waitForCanvas(page, 'flowchart');
  await selectAndZoomHistoryDiagram(page, 0, 'cross-renderer history camera handoff');
  const beforeCamera = await waitForStableCanvasTransform(page, 'cross-renderer history camera baseline');

  await ensureFlyout(page, 'activity');
  const genericRevision = historyItem(page, genericHistory.revision.id);
  await genericRevision.waitFor({ state: 'visible', timeout: 15_000 });
  await verifiedClick(page, genericRevision.getByRole('button', { name: 'Preview', exact: true }), 'cross-renderer historical generic preview');
  await page.getByTestId('history-preview-notice').waitFor({ state: 'visible', timeout: 15_000 });
  await waitForCanvas(page, 'generic');
  assert(await waitForStableCanvasTransform(page, 'cross-renderer generic history preview camera') === beforeCamera,
    'Cross-renderer history preview changed the active local camera.');

  await verifiedClick(page, page.getByRole('button', { name: 'Cancel preview', exact: true }), 'cross-renderer historical preview cancel');
  await page.getByTestId('history-preview-notice').waitFor({ state: 'detached', timeout: 15_000 });
  await waitForCanvas(page, 'flowchart');
  assert(await waitForStableCanvasTransform(page, 'cross-renderer history cancel camera') === beforeCamera,
    'Cancelling a generic historical preview into the live flowchart changed the active local camera.');
  await closeFlyout(page, 'activity');
}

async function expectRevisionHistoryCollaboration(
  browser: BrowserHarness,
  baseUrl: string,
  mcpUrl: string,
  sessionId: string,
  mcp: ModernMcpClient,
  roomAccess: RoomAccess,
): Promise<void> {
  const diagramName = 'Revision history E2E';
  const target = await mcp.createDiagramWithLatestRevision(sessionId, diagramName, HISTORY_PREVIOUS_FLOWCHART);
  const observer = await openYjsSessionObserver(mcpUrl, sessionId, { cookie: roomAccess.cookie, origin: baseUrl });
  let page: Page | null = null;
  let peer: Page | null = null;
  try {
    const primary = await browser.newPage(DESKTOP_VIEWPORT);
    const secondary = await browser.newPage(DESKTOP_VIEWPORT);
    page = primary.page;
    peer = secondary.page;
    await Promise.all([
      visitWorkspace(page, baseUrl, sessionId, roomAccess.roomKey),
      visitWorkspace(peer, baseUrl, sessionId, roomAccess.roomKey),
    ]);
    await Promise.all([
      selectTabByName(page, diagramName),
      selectTabByName(peer, diagramName),
    ]);
    await Promise.all([
      ensureSourceFlyoutOpen(page),
      ensureSourceFlyoutOpen(peer),
      waitForCanvas(page, 'flowchart'),
      waitForCanvas(peer, 'flowchart'),
    ]);
    await Promise.all([
      waitForSource(page, HISTORY_PREVIOUS_FLOWCHART),
      waitForSource(peer, HISTORY_PREVIOUS_FLOWCHART),
    ]);
    await Promise.all([closeFlyout(page, 'source'), closeFlyout(peer, 'source')]);
    await Promise.all([waitForCanvas(page, 'flowchart'), waitForCanvas(peer, 'flowchart')]);

    const historical = await waitForHistoryRevision(mcp, sessionId, target.id, HISTORY_PREVIOUS_FLOWCHART);
    assert(Object.keys(historical.revision.nodePositions).length === 0,
      `The requested source-only revision unexpectedly included a layout: ${JSON.stringify(historical.revision.nodePositions)}.`);
    assert(historical.history.revisions.some((revision) => revision.id === historical.revision.id),
      'MCP listDiagramHistory did not expose the revision that readDiagramRevision returned.');

    const movedNodeId = await dragHistoryNode(page, 'history baseline', { x: 102, y: 38 });
    await observer.waitFor(
      (current) => Object.hasOwn(current.snapshot(target.id).nodePositions, movedNodeId),
      'the browser layout checkpoint before the current revision',
    );
    await mcp.writeLatest(sessionId, target.id, HISTORY_CURRENT_FLOWCHART, 'Prepared current history revision');
    await Promise.all([
      ensureSourceFlyoutOpen(page),
      ensureSourceFlyoutOpen(peer),
      waitForSource(page, HISTORY_CURRENT_FLOWCHART),
      waitForSource(peer, HISTORY_CURRENT_FLOWCHART),
    ]);
    await Promise.all([closeFlyout(page, 'source'), closeFlyout(peer, 'source')]);
    await Promise.all([waitForCanvas(page, 'flowchart'), waitForCanvas(peer, 'flowchart')]);
    await selectAndZoomHistoryDiagram(page, 0, 'primary history local state');
    await selectAndZoomHistoryDiagram(peer, 1, 'peer history local state');
    await expect.poll(async () => (await presenceSignature(page)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await presenceSignature(peer)).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);

    const localBeforePreview = await snapshotLocalWorkspace(page, 'primary history preview baseline');
    const peerBeforePreview = await snapshotLocalWorkspace(peer, 'peer history preview baseline');
    const renderedSelectionBeforePreview = await renderedSelectedNodeIds(page);
    const sharedBeforePreview = observer.snapshot(target.id);
    const previewTracker = observer.trackSnapshot(target.id);
    const desktopAnchors = await snapshotAnchors(page, ANCHORS);
    const currentSvgBeforePreview = await page.locator('.diagram-canvas-svg svg').innerHTML();

    await ensureFlyout(page, 'activity');
    const historicalItem = historyItem(page, historical.revision.id);
    await historicalItem.waitFor({ state: 'visible', timeout: 15_000 });
    await verifiedClick(page, historicalItem.getByRole('button', { name: 'Preview', exact: true }), 'desktop immutable history preview');
    await page.getByTestId('history-preview-notice').waitFor({ state: 'visible', timeout: 15_000 });
    await expect.poll(async () => page.locator('.diagram-canvas-svg svg').innerHTML(), {
      message: 'History preview did not replace the live Mermaid SVG with the requested immutable revision.',
      timeout: 15_000,
    }).not.toBe(currentSvgBeforePreview);
    assert(snapshotsMatch(sharedBeforePreview, observer.snapshot(target.id)), 'History preview wrote canonical Yjs state.');
    const localDuringPreview = await snapshotLocalWorkspace(page, 'primary during history preview');
    const peerDuringPreview = await snapshotLocalWorkspace(peer, 'peer during history preview');
    assert(JSON.stringify(localBeforePreview) === JSON.stringify(localDuringPreview),
      `History preview changed local active tab, selection, camera, or Awareness presence: before=${JSON.stringify(localBeforePreview)} after=${JSON.stringify(localDuringPreview)}.`);
    assert(JSON.stringify(peerBeforePreview) === JSON.stringify(peerDuringPreview),
      `History preview changed the peer active tab, selection, camera, or Awareness presence: before=${JSON.stringify(peerBeforePreview)} after=${JSON.stringify(peerDuringPreview)}.`);
    assertAnchorsStable(desktopAnchors, await snapshotAnchors(page, ANCHORS));
    assert(await renderedCanvasCameraTransform(page, 'history preview camera') === localBeforePreview.camera,
      'History preview changed the primary canvas camera.');
    await verifiedClick(page, page.getByRole('button', { name: 'Cancel preview', exact: true }), 'desktop immutable history cancel preview');
    await page.getByTestId('history-preview-notice').waitFor({ state: 'detached', timeout: 15_000 });
    await waitForCanvas(page, 'flowchart');
    await expect.poll(() => renderedSelectedNodeIds(page), {
      message: 'Cancelling history preview did not restore React Flow selection chrome.',
      timeout: 15_000,
    }).toEqual(renderedSelectionBeforePreview);
    await previewTracker.expectUnchangedFor(HISTORY_NEGATIVE_OBSERVATION_MS, 'detached history preview and cancellation');
    previewTracker.destroy();
    assert(snapshotsMatch(sharedBeforePreview, observer.snapshot(target.id)), 'Cancelling history preview changed canonical Yjs state.');
    const localAfterPreviewCancellation = await snapshotLocalWorkspace(page, 'primary after history preview cancellation');
    assert(JSON.stringify(localBeforePreview) === JSON.stringify(localAfterPreviewCancellation),
      `Cancelling history preview changed primary local state: before=${JSON.stringify(localBeforePreview)} after=${JSON.stringify(localAfterPreviewCancellation)}.`);
    assert(JSON.stringify(peerBeforePreview) === JSON.stringify(await snapshotLocalWorkspace(peer, 'peer after history preview cancellation')),
      'Cancelling history preview changed peer local state.');

    const historyBeforeRestore = await mcp.listDiagramHistory(sessionId, target.id);
    const activityCountBeforeRestore = observer.snapshot(target.id).activity.length;
    const restoreTracker = observer.trackSnapshot(target.id);
    const serverOrigin = new URL(mcpUrl).origin;
    const currentPath = `/api/sessions/${encodeURIComponent(sessionId)}/diagrams/${encodeURIComponent(target.id)}`;
    const historyPath = `${currentPath}/history`;
    const restorePath = `${currentPath}/history/${encodeURIComponent(historical.revision.id)}/restore`;
    const restoreRequests: Array<{ method: string; path: string }> = [];
    const recordRestoreRequest = (request: { method: () => string; url: () => string }) => {
      const url = new URL(request.url());
      if (url.origin === serverOrigin && (url.pathname === currentPath || url.pathname === restorePath)) {
        restoreRequests.push({ method: request.method(), path: url.pathname });
      }
    };
    page.on('request', recordRestoreRequest);
    try {
      await verifiedClick(page, historicalItem.getByRole('button', { name: 'Restore', exact: true }), 'desktop immutable history restore');
      const confirmation = page.getByTestId('history-restore-confirmation');
      await confirmation.waitFor({ state: 'visible', timeout: 15_000 });
      await verifiedClick(page, confirmation.getByRole('button', { name: 'Confirm restore', exact: true }), 'confirm immutable history restore');
      await observer.waitFor(
        (current) => sourceAndLayoutMatch(current.snapshot(target.id), historical.revision),
        'the restored immutable source and layout in Yjs',
      );
      await Promise.all([waitForCanvas(page, 'flowchart'), waitForCanvas(peer, 'flowchart')]);
      await expect.poll(() => restoreRequests.filter((request) => request.path === currentPath && request.method === 'GET').length, {
        message: `Confirmed restore did not issue one current-head GET: ${JSON.stringify(restoreRequests)}.`,
        timeout: 15_000,
      })
        .toBe(1);
      await expect.poll(() => restoreRequests.filter((request) => request.path === restorePath && request.method === 'POST').length, {
        message: `Confirmed restore did not issue one restore POST: ${JSON.stringify(restoreRequests)}.`,
        timeout: 15_000,
      })
        .toBe(1);
    } finally {
      page.off('request', recordRestoreRequest);
    }
    assert(JSON.stringify(restoreRequests) === JSON.stringify([
      { method: 'GET', path: currentPath },
      { method: 'POST', path: restorePath },
    ]), `Confirmed restore did not perform exactly one fresh GET followed by one POST: ${JSON.stringify(restoreRequests)}.`);
    await restoreTracker.expectUnchangedFor(HISTORY_NEGATIVE_OBSERVATION_MS, 'the post-restore convergence window');
    const restoreAppearances = getYjsSourceLayoutTransitions(restoreTracker.appearances)
      .filter((appearance) => sourceAndLayoutMatch(appearance.snapshot, historical.revision));
    restoreTracker.destroy();
    assert(restoreAppearances.length === 1,
      `Restored source/layout appeared ${restoreAppearances.length} times in the Yjs observer: ${JSON.stringify(restoreAppearances)}.`);
    const historyAfterRestore = await mcp.listDiagramHistory(sessionId, target.id);
    assert(historyAfterRestore.revisions.length === historyBeforeRestore.revisions.length + 1,
      'Confirmed restore did not create exactly one new immutable history revision.');
    const newestRevision = historyAfterRestore.revisions[0];
    assert(newestRevision?.action === 'restored' && newestRevision.restoredFromRevisionId === historical.revision.id,
      `Confirmed restore did not record immutable restore provenance: ${JSON.stringify(newestRevision)}.`);
    const restoredCurrent = await mcp.readDiagram(sessionId, target.id);
    assert(restoredCurrent.mermaidText === historical.revision.mermaidText
      && restoredCurrent.revision === historyAfterRestore.currentRevision,
    'MCP current head did not match the confirmed UI restore.');
    const activityAfterRestore = observer.snapshot(target.id).activity;
    assert(activityAfterRestore.length === activityCountBeforeRestore + 1
      && activityAfterRestore.at(-1)?.action === 'restored'
      && activityAfterRestore.at(-1)?.restoredFromRevisionId === historical.revision.id,
    `Confirmed restore did not append exactly one linked activity item: ${JSON.stringify(activityAfterRestore.slice(-2))}.`);
    await saveScreenshot(page, 'issue-17-history-restored');

    await closeFlyout(page, 'activity');
    await ensureFlyout(page, 'activity');
    const staleItem = historyItem(page, historical.revision.id);
    await staleItem.waitFor({ state: 'visible', timeout: 15_000 });
    const staleRestore = staleItem.getByRole('button', { name: 'Restore', exact: true });
    await prepareHistoryActionForClick(page, staleItem, staleRestore, 'stale layout-only restore candidate');
    await verifiedClick(page, staleRestore, 'stale layout-only restore candidate');
    const staleConfirmation = page.getByTestId('history-restore-confirmation');
    await staleConfirmation.waitFor({ state: 'visible', timeout: 15_000 });
    const staleRestoreRequests: Array<{ method: string; path: string }> = [];
    const recordStaleRestoreRequest = (request: { method: () => string; url: () => string }) => {
      const url = new URL(request.url());
      if (url.origin === serverOrigin && (url.pathname === currentPath || url.pathname === restorePath)) {
        staleRestoreRequests.push({ method: request.method(), path: url.pathname });
      }
    };
    const historyBeforeStaleRestore = await mcp.listDiagramHistory(sessionId, target.id);
    const restoredActivityCountBeforeStale = observer.snapshot(target.id).activity.filter((event) => event.action === 'restored').length;
    const staleTracker = observer.trackSnapshot(target.id);
    let routedStaleRestore = false;
    let headAfterPeerLayout: { mermaidText: string; revision: string } | null = null;
    let releaseHistoryRefresh: () => void = () => {};
    const historyRefreshReleased = new Promise<void>((resolve) => {
      releaseHistoryRefresh = resolve;
    });
    let historyRefreshStarted = false;
    let historyRefreshFinished = false;
    page.on('request', recordStaleRestoreRequest);
    await page.route(`${serverOrigin}${restorePath}`, async (route) => {
      if (routedStaleRestore) {
        await route.continue();
        return;
      }
      routedStaleRestore = true;
      const peerMovedNodeId = await dragHistoryNode(peer, 'layout-only peer stale-restore race', { x: -86, y: 52 });
      await observer.waitFor(
        (current) => Object.hasOwn(current.snapshot(target.id).nodePositions, peerMovedNodeId),
        'the peer layout-only change between restore read and write',
      );
      const currentHead = await mcp.readDiagram(sessionId, target.id);
      headAfterPeerLayout = { mermaidText: currentHead.mermaidText, revision: currentHead.revision };
      await route.continue();
    });
    await page.route(`${serverOrigin}${historyPath}`, async (route) => {
      historyRefreshStarted = true;
      await historyRefreshReleased;
      try {
        await route.continue();
      } finally {
        historyRefreshFinished = true;
      }
    });
    try {
      const staleRestoreResponse = page.waitForResponse((response) => {
        const url = new URL(response.url());
        return url.origin === serverOrigin
          && url.pathname === restorePath
          && response.request().method() === 'POST';
      }, { timeout: 15_000 });
      await verifiedClick(page, staleConfirmation.getByRole('button', { name: 'Confirm restore', exact: true }), 'confirm stale layout-only restore');
      const response = await staleRestoreResponse;
      assert(response.status() === 409, `Stale restore response was ${response.status()} instead of 409.`);
      await expect.poll(() => staleRestoreRequests.filter((request) => request.path === restorePath && request.method === 'POST').length, {
        message: `Stale restore did not issue one restore POST: ${JSON.stringify(staleRestoreRequests)}.`,
        timeout: 15_000,
      })
        .toBe(1);
    } finally {
      await page.unroute(`${serverOrigin}${restorePath}`);
      page.off('request', recordStaleRestoreRequest);
    }
    assert(routedStaleRestore, 'The stale-restore test did not interpose the layout-only peer update between GET and POST.');
    assert(JSON.stringify(staleRestoreRequests) === JSON.stringify([
      { method: 'GET', path: currentPath },
      { method: 'POST', path: restorePath },
    ]), `Stale restore did not use one fresh GET and one POST: ${JSON.stringify(staleRestoreRequests)}.`);
    assert(headAfterPeerLayout !== null, 'The peer layout-only update did not provide a current head for stale-restore verification.');
    const currentAfterStaleRestore = await mcp.readDiagram(sessionId, target.id);
    assert(currentAfterStaleRestore.revision === headAfterPeerLayout.revision
      && currentAfterStaleRestore.mermaidText === headAfterPeerLayout.mermaidText,
    'A stale restore changed the current head after its 409 response.');
    const staleSnapshot = observer.snapshot(target.id);
    assert(staleSnapshot.mermaidText === HISTORY_PREVIOUS_FLOWCHART
      && JSON.stringify(staleSnapshot.nodePositions) !== JSON.stringify(historical.revision.nodePositions),
    `A layout-only peer change did not leave stale restore as a no-op: ${JSON.stringify(staleSnapshot)}.`);
    await staleTracker.expectUnchangedFor(HISTORY_NEGATIVE_OBSERVATION_MS, 'the stale-restore no-op window');
    staleTracker.destroy();
    const historyAfterStaleRestore = await mcp.listDiagramHistory(sessionId, target.id);
    const restoredActivityCountAfterStale = observer.snapshot(target.id).activity.filter((event) => event.action === 'restored').length;
    assert(historyAfterStaleRestore.revisions.filter((revision) => revision.action === 'restored').length
      === historyBeforeStaleRestore.revisions.filter((revision) => revision.action === 'restored').length,
    'A stale restore appended an immutable restored revision.');
    assert(restoredActivityCountAfterStale === restoredActivityCountBeforeStale,
      'A stale restore appended an activity event instead of remaining a no-op.');
    try {
      await expect.poll(() => historyRefreshStarted, {
        message: 'Stale restore did not start its history refresh.',
        timeout: 15_000,
      }).toBe(true);
      await staleConfirmation.waitFor({ state: 'detached', timeout: 15_000 });
      await expect(staleItem.getByRole('button', { name: 'Restore', exact: true })).toBeEnabled({ timeout: 5_000 });
    } finally {
      releaseHistoryRefresh();
      if (historyRefreshStarted) {
        await expect.poll(() => historyRefreshFinished, {
          message: 'Stale restore history refresh did not finish after release.',
          timeout: 15_000,
        }).toBe(true);
      }
      await page.unroute(`${serverOrigin}${historyPath}`);
    }

    await closeFlyout(page, 'activity');
    await expectHistoryFlyoutSafety(page, 'desktop', historical.revision.id);
    for (const [label, viewport] of [
      ['tablet', TABLET_VIEWPORT],
      ['mobile-390', MOBILE_VIEWPORT],
      ['mobile-320', NARROW_MOBILE_VIEWPORT],
    ] as const) {
      const { page: responsivePage } = await browser.newPage(viewport);
      await visitWorkspace(responsivePage, baseUrl, sessionId, roomAccess.roomKey);
      await selectTabByName(responsivePage, diagramName);
      await waitForCanvas(responsivePage, 'flowchart');
      await expectHistoryFlyoutSafety(responsivePage, label, historical.revision.id);
    }

    await expectCrossRendererHistoryPreviewCameraHandoff(page, mcp, sessionId, target.id);

    const invalidTracker: YjsSessionSnapshotHistory = observer.trackSnapshot(target.id);
    await ensureSourceFlyoutOpen(peer);
    await replaceSource(peer, HISTORY_INVALID_FLOWCHART);
    await waitForInvalidPreview(peer);
    await observer.waitFor(
      (current) => current.snapshot(target.id).mermaidText === HISTORY_INVALID_FLOWCHART,
      'the temporary invalid Mermaid source',
    );
    await ensureSourceFlyoutOpen(page);
    await waitForSource(page, HISTORY_INVALID_FLOWCHART);
    await invalidTracker.expectUnchangedFor(HISTORY_NEGATIVE_OBSERVATION_MS, 'the invalid Mermaid transient observation window');
    invalidTracker.destroy();
    assert(observer.snapshot(target.id).mermaidText === HISTORY_INVALID_FLOWCHART,
      'Temporary invalid Mermaid source auto-reverted instead of remaining the canonical current source.');
    await saveScreenshot(peer, 'issue-17-invalid-transient');
  } finally {
    observer.destroy();
  }
}

async function validateWorkspaceUx(): Promise<void> {
  const results: string[] = [];
  const mobilePinchResiduals: string[] = [];
  const slice = process.env.ARIELCHARTS_E2E_SLICE;
  if (slice !== undefined && slice !== 'history') {
    throw new Error(`Unsupported ARIELCHARTS_E2E_SLICE=${JSON.stringify(slice)}. Expected "history" or no slice.`);
  }
  await withOwnedServices(async ({ baseUrl, mcpUrl, serverUrl }) => {
    const browser = await launchBrowserHarness();
    try {
      const room = await createRoom(serverUrl, baseUrl);
      const roomAccess = await exchangeRoomAccess(serverUrl, baseUrl, room);
      const sessionId = room.sessionId;
      const mcp = new ModernMcpClient(mcpUrl, baseUrl, room);
      if (slice === 'history') {
        const { page: seedPage } = await browser.newPage(DESKTOP_VIEWPORT);
        await visitWorkspace(seedPage, baseUrl, sessionId, room.roomKey);
        await expectRevisionHistoryCollaboration(browser, baseUrl, mcpUrl, sessionId, mcp, roomAccess);
        record(results, 'immutable active-tab history preview, restore, stale layout guard, invalid-source persistence, and responsive history controls');
        return;
      }

        const { page } = await browser.newPage(DESKTOP_VIEWPORT);
      await visitWorkspace(page, baseUrl, sessionId, room.roomKey);
        await expectAgentConnectionModal(page, mcpUrl, sessionId, roomAccess.cookie, 'in-memory');
        record(results, 'fragment-derived room key exposes a copyable MCP bearer prompt');
        await expectThemeContract(page);
        record(results, 'system, light, and dark media resolution plus persistence');
        // The theme contract already reloads after the fragment exchange, so the
        // following check exercises cookie-only access without another navigation.
        await expectAgentConnectionModal(page, mcpUrl, sessionId, roomAccess.cookie, 'cookie-only');
        record(results, 'cookie-only reload hides raw key material and offers reset guidance');
        await selectThemePreference(page, 'light');
      await expectWorkspaceSettings(page, mcpUrl, sessionId, roomAccess.cookie);
      record(results, 'settings, agent connection, focus boundaries, canvas handoff, overlay coexistence, and stable chrome');
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
      await selectThemePreference(page, 'dark');
      await expectFlatChrome(page);
      record(results, 'flat monochrome chrome has no product shadows while focus and selection remain visible');
      await selectThemePreference(page, 'light');
      await expectRendererTransitionPreservesCamera(page);
      record(results, 'editable/static renderer transition preserves camera and explicit Fit changes it');
      await expectRemoteUpdateWithoutAnchorJump(page, mcp, sessionId, diagramName);
      record(results, 'remote update leaves desktop anchors stable');
      await saveScreenshot(page, 'workspace-ux-desktop');

      await expectRevisionHistoryCollaboration(browser, baseUrl, mcpUrl, sessionId, mcp, roomAccess);
      record(results, 'immutable active-tab history preview, restore, stale layout guard, invalid-source persistence, and responsive history controls');

      const { page: activityFitPage } = await browser.newPage(ACTIVITY_FIT_VIEWPORT);
      await visitWorkspace(activityFitPage, baseUrl, sessionId, room.roomKey);
      await selectTabByName(activityFitPage, diagramName);
      await expectActivityFlyoutFitSafety(activityFitPage);
      record(results, 'activity-open Fit keeps graph and selected toolbar in unobscured canvas');

      for (const [label, viewport] of [
        ['tablet', TABLET_VIEWPORT],
        ['mobile-390', MOBILE_VIEWPORT],
        ['mobile-320', NARROW_MOBILE_VIEWPORT],
        ['mobile-landscape', MOBILE_LANDSCAPE_VIEWPORT],
      ] as const) {
        const { page: responsivePage } = await browser.newPage(
          viewport,
          label.startsWith('mobile') ? PHONE_CONTEXT_OPTIONS : undefined,
        );
        await visitWorkspace(responsivePage, baseUrl, sessionId, room.roomKey);
        await expectStableFlyoutAnchors(responsivePage, label);
        await expectResponsiveControls(responsivePage, label, diagramName);
        if (label.startsWith('mobile')) {
          await expectPhoneLiveCodingWorkspace(responsivePage, label, diagramName, mobilePinchResiduals);
          record(results, `${label} touch viewport, tabs, flyouts, camera, final-state overflow, screenshots, and canvas controls`);
        }
        await expectNoDevelopmentIndicator(responsivePage);
        await saveScreenshot(responsivePage, `workspace-ux-${label}`);
        record(results, `${label} anchors and source controls`);
      }
    } finally {
      await browser.close();
    }
  });
  for (const residual of mobilePinchResiduals) {
    console.warn(`MOBILE PINCH RESIDUAL ${residual}`);
  }
  console.log(`WORKSPACE UX E2E PASSED (${results.length} passed, 0 skips)`);
}

validateWorkspaceUx().catch((error) => {
  console.error(describeError(error));
  process.exit(1);
});
