import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { chromium } from '@playwright/test';

it.skipIf(!process.env.SAFETY_BROWSER_EXECUTABLE)('contains real Tab and Shift+Tab while a confirmation is pending, refuses background actions and restores focus', async () => {
  const require = createRequire(import.meta.url);
  const { build } = createRequire(require.resolve('vitest/package.json'))('esbuild');
  const bundled = await build({ stdin: { contents: `
    import React from 'react'; import { createRoot } from 'react-dom/client';
    import { WorkspaceConfirmation } from './workspace-controls';
    function App() {
      const [open, setOpen] = React.useState(false); const [pending, setPending] = React.useState(false);
      window.finish = () => { setPending(false); setOpen(false); };
      return <><button id="origin" onClick={() => setOpen(true)}>Open</button><button id="background" onClick={() => { window.backgroundActions = (window.backgroundActions || 0) + 1; }}>Background</button>
        {open && <WorkspaceConfirmation title="Replace fixture?" confirmLabel="Replace" pending={pending} onCancel={() => setOpen(false)} onConfirm={() => setPending(true)}><p>Reviewed fixture</p></WorkspaceConfirmation>}</>;
    }
    createRoot(document.getElementById('root')).render(<App />);
  `, resolveDir: dirname(fileURLToPath(import.meta.url)), loader: 'tsx' }, bundle: true, write: false, format: 'iife', platform: 'browser' });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.SAFETY_BROWSER_EXECUTABLE ?? chromium.executablePath() });
  try {
    const page = await browser.newPage(); await page.setContent('<div id="root"></div>'); await page.addScriptTag({ content: bundled.outputFiles[0].text });
    await page.locator('#origin').click(); await expect.poll(() => page.evaluate(() => document.activeElement?.textContent)).toBe('Cancel');
    await page.keyboard.press('Tab'); await page.keyboard.press('Enter');
    await expect.poll(() => page.getByRole('button', { name: 'Please wait…' }).isDisabled()).toBe(true);
    for (const key of ['Tab', 'Shift+Tab', 'Tab']) {
      await page.keyboard.press(key);
      expect(await page.evaluate(() => !!document.querySelector('[role="dialog"]')?.contains(document.activeElement))).toBe(true);
    }
    await page.keyboard.press('Escape'); await page.keyboard.press('Enter'); await page.keyboard.press('Space');
    const background = await page.locator('#background').boundingBox();
    await page.mouse.click(background!.x + background!.width / 2, background!.y + background!.height / 2);
    expect(await page.evaluate(() => (window as typeof window & { backgroundActions?: number }).backgroundActions ?? 0)).toBe(0);
    expect(await page.getByRole('dialog').count()).toBe(1);
    await page.evaluate(() => (window as typeof window & { finish: () => void }).finish());
    await expect.poll(() => page.evaluate(() => document.activeElement?.id)).toBe('origin');
  } finally { await browser.close(); }
}, 20000);
