import { existsSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from '@playwright/test';

export const DESKTOP_VIEWPORT = { width: 1440, height: 960 } as const;
export const TABLET_VIEWPORT = { width: 768, height: 1024 } as const;
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
export const NARROW_MOBILE_VIEWPORT = { width: 320, height: 760 } as const;

export type BrowserHarness = {
  browser: Browser;
  newPage: (viewport?: { width: number; height: number }) => Promise<{ context: BrowserContext; page: Page }>;
  close: () => Promise<void>;
};

function chromiumExecutablePath(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  }

  return existsSync('/usr/bin/chromium') ? '/usr/bin/chromium' : undefined;
}

export async function launchBrowserHarness(): Promise<BrowserHarness> {
  const browser = await chromium.launch({ executablePath: chromiumExecutablePath(), headless: true });
  const contexts = new Set<BrowserContext>();

  return {
    browser,
    async newPage(viewport = DESKTOP_VIEWPORT) {
      const context = await browser.newContext({ viewport });
      contexts.add(context);
      const page = await context.newPage();
      return { context, page };
    },
    async close() {
      await Promise.all([...contexts].map((context) => context.close()));
      await browser.close();
    },
  };
}

export async function saveScreenshot(page: Page, name: string): Promise<string> {
  const path = `/tmp/arielcharts-${name}.png`;
  await page.screenshot({ path, fullPage: true });
  return path;
}
