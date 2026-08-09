import { expect, type Locator, type Page } from '@playwright/test';
import { assert } from './assert.ts';

export const FLOWCHART_FIXTURE = `flowchart LR
  Browser[Browser] --> Gateway[Gateway]
  Gateway --> Service[Service]
  Service --> Database[(Database)]`;

export const API_SEQUENCE_FIXTURE = `sequenceDiagram
  autonumber
  participant Browser
  participant Gateway
  participant Service
  participant Database
  Browser->>Gateway: POST /orders
  Gateway->>Service: create order
  Service->>Database: INSERT order
  Database-->>Service: order id
  Service-->>Gateway: 201 Created
  Gateway-->>Browser: 201 Created`;

export const INVALID_MERMAID_FIXTURE = 'this is not valid Mermaid syntax';

export function sourceEditor(page: Page): Locator {
  return page.locator('.cm-content');
}

export async function visitWorkspace(page: Page, baseUrl: string, sessionId: string, roomKey?: string): Promise<void> {
  const url = new URL(`/s/${encodeURIComponent(sessionId)}`, baseUrl);
  if (roomKey) url.hash = `roomKey=${encodeURIComponent(roomKey)}`;
  await page.goto(url.toString(), { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await page.getByTestId('canvas-first-workspace').waitFor({ state: 'visible', timeout: 15_000 });
  await page.getByRole('tab', { name: 'Main', exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
}

export async function ensureFlyout(page: Page, kind: 'source' | 'activity'): Promise<Locator> {
  const toggle = page.getByTestId(`${kind}-flyout-toggle`);
  if (await toggle.getAttribute('aria-expanded') !== 'true') {
    await toggle.click();
  }
  const flyout = page.getByTestId(`${kind}-flyout`);
  await flyout.waitFor({ state: 'visible', timeout: 15_000 });
  return flyout;
}

export async function closeFlyout(page: Page, kind: 'source' | 'activity'): Promise<void> {
  const toggle = page.getByTestId(`${kind}-flyout-toggle`);
  if (await toggle.getAttribute('aria-expanded') === 'true') {
    await toggle.click();
    await page.getByTestId(`${kind}-flyout`).waitFor({ state: 'detached', timeout: 15_000 });
  }
}

export async function ensureSourceFlyoutOpen(page: Page): Promise<Locator> {
  await ensureFlyout(page, 'source');
  const editor = sourceEditor(page);
  await editor.waitFor({ state: 'visible', timeout: 15_000 });
  return editor;
}

export async function replaceSource(page: Page, source: string): Promise<void> {
  const editor = await ensureSourceFlyoutOpen(page);
  await editor.click();
  await page.keyboard.press('ControlOrMeta+A');
  const pasteHandled = await editor.evaluate((element, text) => {
    const clipboard = new DataTransfer();
    clipboard.setData('text/plain', text);
    const event = new ClipboardEvent('paste', {
      bubbles: true,
      cancelable: true,
      clipboardData: clipboard,
    });
    return !element.dispatchEvent(event);
  }, source);
  assert(pasteHandled, 'CodeMirror did not handle the source replacement paste event.');
}

export async function canonicalSource(page: Page): Promise<string> {
  return page.locator('.cm-line').evaluateAll((lines) => lines.map((line) => {
    const copy = line.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[contenteditable="false"], .cm-widgetBuffer').forEach((node) => node.remove());
    return (copy.textContent ?? '').replaceAll('\u2060', '');
  }).join('\n'));
}

export async function waitForSource(page: Page, expected: string): Promise<void> {
  await expect.poll(() => canonicalSource(page), {
    message: 'CodeMirror source did not reach the expected canonical value.',
    timeout: 15_000,
  }).toBe(expected);
}

export async function selectTabByName(page: Page, name: string): Promise<void> {
  const tab = page.getByRole('tab', { name, exact: true });
  await tab.click();
  await page.waitForFunction((tabName) => [...document.querySelectorAll<HTMLElement>('[role="tab"]')]
    .some((candidate) => candidate.textContent?.trim() === tabName && candidate.getAttribute('aria-selected') === 'true'), name, { timeout: 15_000 });
}

export async function activeTabName(page: Page): Promise<string> {
  const name = await page.locator('[role="tab"][aria-selected="true"]').textContent();
  assert(name, 'The workspace has no active tab.');
  return name.trim();
}

function accessibleNamePattern(name: string): RegExp {
  return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}(?:\\s|$)`, 'u');
}

export function templateMenuItem(page: Page, name: string): Locator {
  return page.getByRole('menuitem', { name: accessibleNamePattern(name) });
}

export async function openTemplateMenu(page: Page): Promise<Locator> {
  const trigger = page.getByTestId('create-diagram-tab');
  if (await trigger.getAttribute('aria-expanded') !== 'true') {
    await trigger.click();
  }
  const menu = page.getByRole('menu', { name: 'Starter templates', exact: true });
  await menu.waitFor({ state: 'visible', timeout: 15_000 });
  return menu;
}

export async function openWorkspaceSettings(page: Page): Promise<Locator> {
  const trigger = page.getByTestId('workspace-settings-trigger');
  if (await trigger.getAttribute('aria-expanded') !== 'true') {
    await trigger.click();
  }
  const dialog = page.getByTestId('workspace-settings-dialog');
  await dialog.waitFor({ state: 'visible', timeout: 15_000 });
  return dialog;
}

export async function selectWorkspaceTheme(page: Page, preference: 'system' | 'light' | 'dark'): Promise<void> {
  const dialog = await openWorkspaceSettings(page);
  const label = preference[0]?.toUpperCase() + preference.slice(1);
  await dialog.getByRole('radio', { name: new RegExp(`^${label}(?:\\s|$)`, 'u') }).check();
}

export async function selectTemplateByAccessibleName(page: Page, name: string): Promise<void> {
  await openTemplateMenu(page);
  await templateMenuItem(page, name).click();
  await page.getByRole('menu', { name: 'Starter templates', exact: true }).waitFor({ state: 'detached', timeout: 15_000 });
}

export async function createDiagramFromTemplate(page: Page, name: string): Promise<string> {
  const before = (await page.getByRole('tab').allTextContents()).map((label) => label.trim());
  await selectTemplateByAccessibleName(page, name);
  await page.waitForFunction((count) => document.querySelectorAll('[role="tab"]').length === count + 1, before.length, { timeout: 15_000 });
  const diagramName = await activeTabName(page);
  assert(!before.includes(diagramName), `${name} template did not become active: ${diagramName}`);
  return diagramName;
}

export async function createBlankDiagram(page: Page): Promise<string> {
  return createDiagramFromTemplate(page, 'Blank sheet');
}

export async function renameActiveDiagram(page: Page, name: string): Promise<void> {
  const current = await activeTabName(page);
  await page.getByRole('button', { name: `Rename ${current}`, exact: true }).click();
  const input = page.getByRole('textbox', { name: 'Diagram name', exact: true });
  await input.fill(name);
  await input.press('Enter');
  await page.getByRole('tab', { name, exact: true }).waitFor({ state: 'visible', timeout: 15_000 });
  assert(await activeTabName(page) === name, `Renamed tab was not active: ${name}`);
}

export async function waitForCanvas(page: Page, mode: 'flowchart' | 'generic'): Promise<void> {
  await page.waitForFunction((expectedMode) => {
    const label = document.querySelector('[data-testid="diagram-mode"]')?.textContent ?? '';
    const svg = document.querySelector('.diagram-canvas-svg svg');
    const structureToolbar = document.querySelector('form[aria-label="Add Mermaid node"]');
    return !!svg?.getAttribute('viewBox')
      && (expectedMode === 'flowchart' ? label.includes('editable') && !!structureToolbar : label.includes('source only') && !structureToolbar);
  }, mode, { timeout: 15_000 });
}

export async function waitForInvalidPreview(page: Page): Promise<void> {
  const globalStatus = page.getByTestId('parse-error-banner');
  const sourceStatus = page.getByTestId('source-parse-status');
  const sourceOpen = await page.getByTestId('source-flyout').isVisible();
  const expectedStatus = sourceOpen ? sourceStatus : globalStatus;
  const unexpectedStatus = sourceOpen ? globalStatus : sourceStatus;

  await expectedStatus.waitFor({ state: 'visible', timeout: 15_000 });
  await expect(expectedStatus).toContainText(/preview kept on last valid diagram/iu);
  await expect(unexpectedStatus).toHaveCount(0);
  assert(await page.locator('.diagram-canvas-svg svg').count() > 0, 'Invalid Mermaid removed the last valid visual preview.');
}

export async function waitForSyncedSource(page: Page): Promise<void> {
  await page.getByTestId('connection-status-badge').filter({ hasText: /^synced$/i }).waitFor({ state: 'visible', timeout: 15_000 });
}
