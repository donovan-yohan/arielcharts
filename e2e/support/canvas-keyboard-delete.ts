import { expect, type Page } from '@playwright/test';
import { type BrowserHarness, saveScreenshot } from './browser.ts';
import { canonicalSource, closeFlyout, ensureSourceFlyoutOpen, replaceSource, waitForSource } from './workspace.ts';

const SOURCE = 'flowchart LR\n  A[Alpha] --> B[Beta]\n  C[Gamma]';
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"] .mermaid-flow-node`);

async function seed(page: Page) {
  await replaceSource(page, SOURCE);
  await waitForSource(page, SOURCE);
  await closeFlyout(page, 'source');
  await expect(node(page, 'B')).toBeVisible();
}

async function assertSource(page: Page, check: (source: string) => void) {
  await ensureSourceFlyoutOpen(page);
  await expect.poll(async () => {
    try { check(await canonicalSource(page)); return true; } catch { return false; }
  }).toBe(true);
  await closeFlyout(page, 'source');
}

/** Ordinary local root route, native pointer selection and keyboard delivery. */
export async function runCanvasKeyboardDeleteRegression(harness: BrowserHarness, baseUrl: string) {
  const failures: string[] = [];
  const run = async (name: string, test: (page: Page) => Promise<void>) => {
    const { context, page } = await harness.newPage();
    try {
      await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
      await page.getByTestId('canvas-first-workspace').waitFor();
      await seed(page);
      await test(page);
      console.log(`PASS canvas keyboard: ${name}`);
    } catch (error) {
      const focus = await page.evaluate(() => document.activeElement?.outerHTML.slice(0, 500));
      const screenshot = await saveScreenshot(page, `keyboard-delete-${name.replaceAll(' ', '-')}`);
      failures.push(`${name}: ${String(error)}\nfocus=${focus}\nscreenshot=${screenshot}`);
      console.error(`FAIL canvas keyboard: ${failures.at(-1)}`);
    } finally { await context.close(); }
  };

  for (const key of ['Delete', 'Backspace']) {
    await run(`flowchart ${key}`, async (page) => {
      await node(page, 'B').click();
      await expect(node(page, 'B')).toHaveAttribute('aria-pressed', 'true');
      await page.keyboard.press(key);
      await expect(node(page, 'B')).toHaveCount(0);
      await expect(page.locator('.react-flow__edge')).toHaveCount(0);
      await assertSource(page, (source) => {
        expect(source).not.toMatch(/\bB\b|-->/u);
        expect(source).toContain('Alpha'); expect(source).toContain('Gamma');
      });
      await node(page, 'A').click();
      await page.keyboard.press('ControlOrMeta+z');
      await expect(node(page, 'B')).toBeVisible();
      await expect(page.locator('.react-flow__edge')).toHaveCount(1);
      await assertSource(page, (source) => expect(source).toBe(SOURCE));
    });
  }

  await run('multi selection one Undo', async (page) => {
    await node(page, 'A').click();
    await node(page, 'B').click({ modifiers: ['Shift'] });
    await expect(page.locator('.mermaid-flow-node[aria-pressed="true"]')).toHaveCount(2);
    await page.keyboard.press('Backspace');
    await expect(node(page, 'A')).toHaveCount(0);
    await expect(node(page, 'B')).toHaveCount(0);
    await assertSource(page, (source) => {
      expect(source).not.toMatch(/Alpha|Beta|-->/u); expect(source).toContain('Gamma');
    });
    await node(page, 'C').click();
    await page.keyboard.press('ControlOrMeta+z');
    await expect(node(page, 'A')).toBeVisible();
    await expect(node(page, 'B')).toBeVisible();
    await assertSource(page, (source) => expect(source).toBe(SOURCE));
  });

  await run('rename text owns Backspace', async (page) => {
    await node(page, 'B').click();
    await page.keyboard.press('F2');
    const input = page.locator('input:focus, textarea:focus');
    await expect(input).toHaveCount(1);
    await input.fill('BetaX');
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await expect(input).toHaveValue('Beta');
    await page.keyboard.press('Escape');
    await expect(node(page, 'B')).toBeVisible();
    await assertSource(page, (source) => expect(source).toBe(SOURCE));
  });

  await run('source text owns Backspace', async (page) => {
    await node(page, 'B').click();
    const editor = await ensureSourceFlyoutOpen(page);
    await editor.click();
    await page.keyboard.press('ControlOrMeta+End');
    await page.keyboard.type('X');
    await page.keyboard.press('Backspace');
    await waitForSource(page, SOURCE);
    await expect(node(page, 'B')).toHaveCount(1);
  });

  for (const key of ['Delete', 'Backspace']) {
    await run(`selected edge ${key}`, async (page) => {
      const edge = page.locator('.react-flow__edge').first();
      const edgePoint = () => edge.locator('.react-flow__edge-interaction').evaluate((element) => {
        const path = element as SVGPathElement;
        const point = path.getPointAtLength(path.getTotalLength() / 2).matrixTransform(path.getScreenCTM()!);
        return { x: point.x, y: point.y, ownsHit: element.closest('.react-flow__edge')?.contains(document.elementFromPoint(point.x, point.y)) };
      });
      await expect.poll(async () => (await edgePoint()).ownsHit).toBe(true);
      const point = await edgePoint();
      await page.mouse.click(point.x, point.y);
      await expect(edge).toHaveClass(/selected/u);
      await page.keyboard.press(key);
      await expect(page.locator('.react-flow__edge')).toHaveCount(0);
      await expect(page.locator('.mermaid-flow-node')).toHaveCount(3);
      await assertSource(page, (source) => expect(source).not.toContain('-->'));
      await node(page, 'A').click();
      await page.keyboard.press('ControlOrMeta+z');
      await expect(page.locator('.react-flow__edge')).toHaveCount(1);
      await assertSource(page, (source) => expect(source).toBe(SOURCE));
    });
  }

  await run('source only keeps source', async (page) => {
    const source = 'gitGraph\n  commit\n  commit';
    await replaceSource(page, source);
    await closeFlyout(page, 'source');
    await expect(page.locator('.react-flow__node')).toHaveCount(0);
    const canvas = page.getByTestId('diagram-canvas');
    await canvas.click({ position: { x: 20, y: 200 } });
    await page.keyboard.press('Delete');
    await page.keyboard.press('Backspace');
    await assertSource(page, (current) => expect(current).toBe(source));
  });

  for (const [tool, key] of [['r', 'Delete'], ['sticky', 'Backspace']] as const) {
    await run(`overlay ${tool} ${key}`, async (page) => {
      await node(page, 'A').click();
      if (tool === 'sticky') {
        await page.getByTestId('overlay-toolbar-more-toggle').click();
        await page.getByRole('button', { name: 'Sticky note', exact: true }).click();
      } else await page.keyboard.press(tool);
      const drawing = page.getByTestId('ink-drawing-surface');
      await expect(drawing).toBeVisible();
      const bounds = await page.getByTestId('diagram-canvas').boundingBox();
      if (!bounds) throw new Error('Canvas bounds unavailable');
      await page.mouse.click(bounds.x + bounds.width * 0.7, bounds.y + bounds.height * 0.7);
      await page.keyboard.press('Escape');
      const object = page.locator('[data-testid^="overlay-object-"]').first();
      await expect(object).toBeVisible();
      await object.click({ position: { x: 20, y: 20 } });
      console.log('overlay pointer focus', await page.evaluate(() => document.activeElement?.getAttribute('data-testid')));
      await expect(object).toHaveAttribute('data-selected', 'true');
      await object.dispatchEvent('keydown', { key, code: key, isComposing: true });
      await expect(object).toBeVisible();
      const objectBox = await object.boundingBox();
      if (!objectBox) throw new Error('Overlay object bounds unavailable');
      await page.mouse.move(objectBox.x + 80, objectBox.y + 80);
      await page.mouse.down();
      await page.mouse.move(objectBox.x + 105, objectBox.y + 95, { steps: 4 });
      await page.mouse.up();
      await expect(object).toBeFocused();
      await page.keyboard.press(key);
      await expect(page.locator('[data-testid^="overlay-object-"]')).toHaveCount(0);
      await expect(node(page, 'A')).toBeVisible();
      await assertSource(page, (source) => expect(source).toBe(SOURCE));
      await node(page, 'C').click();
      await page.keyboard.press('ControlOrMeta+z');
      await expect(page.locator('[data-testid^="overlay-object-"]')).toHaveCount(1);
      const restored = page.locator('[data-testid^="overlay-object-"]').first();
      const handle = page.getByTestId('overlay-resize-nw');
      const box = await handle.boundingBox();
      if (!box) throw new Error('Overlay resize handle bounds unavailable');
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 + 25, box.y + box.height / 2 + 15, { steps: 4 });
      await page.mouse.up();
      await expect(restored).toBeFocused();
      await page.keyboard.press(key);
      await expect(page.locator('[data-testid^="overlay-object-"]')).toHaveCount(0);
      await expect(node(page, 'A')).toBeVisible();
      await node(page, 'C').click();
      await page.keyboard.press('ControlOrMeta+z');
      await expect(restored).toBeVisible();
      const more = page.getByTestId('overlay-toolbar-more-toggle');
      if (await more.getAttribute('aria-expanded') !== 'true') await more.click();
      await page.getByRole('button', { name: 'Objects and layers', exact: true }).click();
      await page.getByRole('button', { name: /^Lock .* layer$/u }).click();
      await page.getByRole('button', { name: 'Close objects and layers', exact: true }).click();
      await restored.click({ position: { x: 20, y: 20 } });
      await page.keyboard.press(key);
      await expect(restored).toBeVisible();
      await assertSource(page, (source) => expect(source).toBe(SOURCE));
      await node(page, 'B').click();
      await page.keyboard.press(key);
      await expect(node(page, 'B')).toHaveCount(0);
      await expect(restored).toBeVisible();
      await saveScreenshot(page, `keyboard-delete-green-${tool}`);
    });
  }

  if (failures.length) throw new Error(failures.join('\n\n'));
}
