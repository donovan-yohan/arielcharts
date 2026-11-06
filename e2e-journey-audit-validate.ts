import { expect, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { launchBrowserHarness } from './e2e/support/browser.ts';
import { withOwnedServices } from './e2e/support/owned-services.ts';
import { createDiagramFromTemplate, closeFlyout, replaceSource, canonicalSource, ensureSourceFlyoutOpen, renameActiveDiagram } from './e2e/support/workspace.ts';
import { assertHitTarget } from './e2e/support/interactions.ts';
import { MERMAID_DIAGRAM_FAMILIES, EXTERNAL_MERMAID_PLUGIN_FAMILIES } from './packages/shared/src/mermaid-diagram-catalog.ts';
const out = process.env.AUDIT_OUTPUT ?? join(tmpdir(), 'arielcharts-journey-audit');
type FamilyEvidence = { family: string; theme: string; width: number; controls: number };
async function assertNativeAnatomy(page: Page, panelId: string, touch: boolean) {
  const panel = panelId === 'flowchart' ? page.getByRole('form', { name: 'Add Mermaid node', exact: true }) : page.getByTestId(panelId); await panel.waitFor();
  const evidence = await panel.evaluate((root, isTouch) => {
    const failures: string[] = [];
    for (const el of root.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input,select,textarea,button')) {
      if (!el.classList.contains(el.tagName === 'BUTTON' ? 'workspace-control-button' : 'workspace-control-input')) failures.push(`unadopted ${el.tagName}`);
      if (el instanceof HTMLInputElement && ['checkbox', 'radio'].includes(el.type)) {
        if (el.getBoundingClientRect().height > 22) failures.push('oversized checkbox'); continue;
      }
      const style = getComputedStyle(el); const height = el.getBoundingClientRect().height;
      if (height < (isTouch ? 44 : el.classList.contains('canvas-toolbar-button') ? 32 : 36) - .1) failures.push(`short ${el.getAttribute('aria-label') ?? el.textContent}: ${height}`);
      if (isTouch && el.tagName !== 'BUTTON' && Number.parseFloat(style.fontSize) < 16) failures.push('small touch field');
      if (el.tagName !== 'BUTTON') {
        const field = el.closest('.workspace-control-field');
        if (!field?.querySelector('label')?.textContent?.trim()) failures.push(`missing visible label ${el.getAttribute('aria-label')}`);
      }
    }
    if (root.scrollWidth > root.clientWidth + 1) failures.push('horizontal panel overflow');
    return { failures, controls: root.querySelectorAll('input,select,textarea,button').length };
  }, touch);
  expect(evidence.failures, panelId).toEqual([]); return evidence.controls;
}
async function assertTabActions(page: Page) {
  for (const width of [390, 320, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    await createDiagramFromTemplate(page, 'Blank sheet');
    await renameActiveDiagram(page, 'Phone scratchpad');
    const deletion = page.getByRole('button', { name: 'Delete Phone scratchpad', exact: true });
    const geometry = await deletion.evaluate((button, minimum) => {
      const row = button.closest('.workspace-diagram-tab')!.getBoundingClientRect();
      const actions = [...button.parentElement!.querySelectorAll('button')].map((action) => action.getBoundingClientRect());
      return { contained: actions.every((action) => action.left >= row.left && action.right <= row.right + 1), usable: actions.every((action) => action.width >= minimum && action.height >= minimum) };
    }, width <= 720 ? 44 : 36);
    expect(geometry, `tab actions at ${width}px`).toEqual({ contained: true, usable: true });
    await assertHitTarget(page, deletion, `tab delete at ${width}px`);
    const before = await page.getByRole('tab').count();
    await deletion.click();
    const confirmation = page.getByRole('dialog', { name: /^Delete “Phone scratchpad”/ });
    await expect(confirmation).toBeVisible();
    await confirmation.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(before);
    await deletion.click();
    await confirmation.getByRole('button', { name: 'Delete diagram', exact: true }).click();
    await expect(page.getByRole('tab')).toHaveCount(before - 1);
  }
}
async function localJourney(base: string, serverUrl: string) {
  const harness = await launchBrowserHarness(); const families: FamilyEvidence[] = [];
  try {
    const context = await harness.browser.newContext({ viewport: { width: 390, height: 844 }, recordVideo: { dir: out, size: { width: 844, height: 844 } } });
    const page = await context.newPage();
    const video = page.video();
    const pageErrors: string[] = []; page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(base); await page.getByTestId('workspace-footer').waitFor();
    await expect(page.locator('.workspace-save-status-label')).toBeVisible();
    await expect(page.getByTestId('workspace-onboarding')).toContainText('Start a diagram');
    await page.screenshot({ path: `${out}/engineering-start-mobile-light.png` });
    await assertTabActions(page);
    for (const [width, height, theme] of [[1440, 1000, 'light'], [1440, 1000, 'dark'], [390, 844, 'dark']] as const) {
      await page.setViewportSize({ width, height }); await page.emulateMedia({ colorScheme: theme });
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByTestId('overlay-toolbar-primary')).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `${out}/engineering-start-${width === 390 ? 'mobile' : 'desktop'}-${theme}.png` });
    }
    // Every catalog family must reach its real consuming panel, not a second gallery.
    for (const family of [...MERMAID_DIAGRAM_FAMILIES, ...EXTERNAL_MERMAID_PLUGIN_FAMILIES]) {
      await page.setViewportSize({ width: 1440, height: 1000 }); await page.emulateMedia({ colorScheme: 'light' });
      await createDiagramFromTemplate(page, family.id === 'zenuml' ? 'ZenUML · lazy plugin' : family.label);
      if (family.id === 'flowchart') {
        await page.locator('.react-flow__node').first().waitFor(); families.push({ family: family.id, theme: 'light', width: 1440, controls: await assertNativeAnatomy(page, 'flowchart', false) });
        await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' });
        families.push({ family: family.id, theme: 'dark', width: 390, controls: await assertNativeAnatomy(page, 'flowchart', true) });
        await page.screenshot({ path: `${out}/engineering-flowchart-mobile-dark.png` }); continue;
      }
      const id = family.id === 'entity-relationship' ? 'er' : family.id === 'tree-view' ? 'treeview' : family.id === 'xy-chart' ? 'xychart' : family.id;
      const panelId = `${id}-editor-controls`;
      families.push({ family: family.id, theme: 'light', width: 1440, controls: await assertNativeAnatomy(page, panelId, false) });
      await page.setViewportSize({ width: 390, height: 844 }); await page.emulateMedia({ colorScheme: 'dark' });
      families.push({ family: family.id, theme: 'dark', width: 390, controls: await assertNativeAnatomy(page, panelId, true) });
      if (['er', 'sequence', 'wardley', 'c4', 'block', 'zenuml'].includes(id)) await page.screenshot({ path: `${out}/engineering-${id}-mobile-dark.png` });
      if (id === 'er') { await page.emulateMedia({ colorScheme: 'light' }); await page.screenshot({ path: `${out}/engineering-er-mobile-light.png` }); }
    }
    await writeFile(`${out}/engineering-family-anatomy.json`, JSON.stringify(families, null, 2));
    expect(new Set(families.map((item) => item.family)).size).toBe(MERMAID_DIAGRAM_FAMILIES.length + EXTERNAL_MERMAID_PLUGIN_FAMILIES.length);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.getByRole('button', { name: /^Rename / }).click();
    const name = page.getByRole('textbox', { name: 'Diagram name', exact: true });
    await name.fill('   '); await name.press('Enter'); await expect(name).toHaveValue('   '); await expect(name).toHaveAttribute('aria-invalid', 'true');
    await name.fill('Untitled diagram'); await name.press('Enter'); await expect(page.getByText('A diagram with this name already exists.')).toBeVisible(); await name.press('Escape');
    const tabs = await page.getByRole('tab').allTextContents();
    await page.locator('.workspace-diagram-tab-delete').click();
    const deletion = page.getByRole('dialog', { name: /^Delete “/ }); await deletion.getByRole('button', { name: 'Cancel', exact: true }).click();
    expect(await page.getByRole('tab').allTextContents()).toEqual(tabs);
    await createDiagramFromTemplate(page, 'Pie');
    await page.getByTestId('pie-editor-controls').waitFor();
    await page.getByLabel('New Pie slice value', { exact: true }).fill('-2');
    await page.getByTestId('pie-editor-controls').getByRole('button', { name: 'Add slice', exact: true }).click();
    await expect(page.getByLabel('New Pie slice value', { exact: true })).toHaveValue('-2');
    await replaceSource(page, 'pie\n"A" : nope'); await expect(page.getByTestId('source-parse-status')).toContainText('Showing the last valid preview');
    await closeFlyout(page, 'source');
    await page.locator('.workspace-export-menu > button').click();
    await expect(page.getByRole('menuitem', { name: 'Export canvas SVG' })).toBeDisabled();
    await expect(page.getByRole('menuitem', { name: 'Export Mermaid (.mmd)' })).toBeEnabled();
    await expect(page.getByRole('menuitem', { name: 'Export editable workspace' })).toBeEnabled(); await page.keyboard.press('Escape');
    await page.setViewportSize({ width: 844, height: 390 }); await page.emulateMedia({ colorScheme: 'light' });
    await page.getByTestId('overlay-toolbar-more-toggle').click();
    await page.screenshot({ path: `${out}/engineering-constrained-errors-light.png` });
    const inspectorToggle = page.getByRole('button', { name: 'Objects and layers', exact: true }); await inspectorToggle.scrollIntoViewIfNeeded(); await inspectorToggle.click();
    const inspector = page.getByRole('complementary', { name: 'Overlay objects and layers', exact: true }); await expect(inspector).toBeVisible();
    await expect(page.getByRole('button', { name: 'Restore previous canvas scene…', exact: true })).toBeDisabled();
    const last = inspector.getByText('Include ink in composite export', { exact: false }); await last.scrollIntoViewIfNeeded(); await expect(last).toBeVisible();
    const geometry = await page.evaluate(() => {
      return { parse: document.querySelector('[data-testid="parse-error-banner"]')!.getBoundingClientRect().toJSON(), mutation: document.querySelector('[data-testid="mutation-error-banner"]')!.getBoundingClientRect().toJSON(), inspector: document.querySelector('.overlay-toolbar-inspector')!.getBoundingClientRect().toJSON(), camera: document.querySelector('[data-testid="canvas-controls-toolbar"]')!.getBoundingClientRect().toJSON() };
    });
    await page.screenshot({ path: `${out}/engineering-constrained-errors-inspector-light.png` });
    console.log('Constrained geometry', geometry);
    expect(geometry.parse.bottom).toBeLessThanOrEqual(geometry.mutation.top);
    expect(geometry.inspector.bottom).toBeLessThanOrEqual(geometry.camera.top - 7);
    expect(geometry.inspector.height).toBeGreaterThan(100);
    const intersects = (left: typeof geometry.inspector, right: typeof geometry.inspector) =>
      left.left < right.right && left.right > right.left && left.top < right.bottom && left.bottom > right.top;
    expect(intersects(geometry.inspector, geometry.parse), 'Inspector must not cover the parse diagnostic').toBe(false);
    expect(intersects(geometry.inspector, geometry.mutation), 'Inspector must not cover an independent mutation diagnostic').toBe(false);
    await page.screenshot({ path: `${out}/engineering-constrained-errors-inspector-light.png` });
    await page.getByRole('button', { name: 'Close objects and layers', exact: true }).click();
    await page.getByTestId('overlay-toolbar-more-toggle').click();
    await page.setViewportSize({ width: 390, height: 844 });
    await createDiagramFromTemplate(page, 'Blank sheet'); await replaceSource(page, 'invalid first source');
    await expect(page.getByTestId('source-parse-status')).toContainText('Preview unavailable');
    // Delay an actual room-creation request, edit through the normal editor, then
    // release it to the isolated server. The older snapshot must never hand off.
    let release!: () => void; const held = new Promise<void>((resolve) => { release = resolve; });
    let entered!: () => void; const requestHeld = new Promise<void>((resolve) => { entered = resolve; });
    await page.route(`${serverUrl}/api/rooms`, async (route) => { entered(); await held; await route.continue(); });
    await page.getByTestId('share-session-button').click(); await requestHeld;
    await replaceSource(page, 'flowchart LR\nPending[Still editing] --> Local[Stays local]');
    expect(await canonicalSource(page)).toContain('Still editing');
    release(); await expect(page.getByTestId('workspace-promotion-error')).toBeVisible({ timeout: 15000 });
    expect(new URL(page.url()).pathname).toBe('/');
    await expect(page.getByTestId('live-save-status')).toContainText('Saved on this device');
    expect(pageErrors).toEqual([]);
    await context.close();
    if (video) await video.saveAs(`${out}/engineering-journey-local.webm`);
    console.log(`Journey audit passed with ${new Set(families.map((item) => item.family)).size} actual family owners, safe local media, validation/cancel, stale static export and real editable-promotion race.`);
  } finally { await harness.close(); }
}
async function run() { await mkdir(out, { recursive: true }); await withOwnedServices(({ baseUrl, serverUrl }) => localJourney(baseUrl, serverUrl)); }
run().catch((error) => { console.error(error); process.exitCode = 1; });
