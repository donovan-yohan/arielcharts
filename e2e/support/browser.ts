import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chromium,
  type Browser,
  type BrowserContext,
  type BrowserContextOptions,
  type Page,
} from '@playwright/test';

export const DESKTOP_VIEWPORT = { width: 1440, height: 960 } as const;
export const TABLET_VIEWPORT = { width: 768, height: 1024 } as const;
export const MOBILE_VIEWPORT = { width: 390, height: 844 } as const;
export const NARROW_MOBILE_VIEWPORT = { width: 320, height: 760 } as const;
export const MOBILE_LANDSCAPE_VIEWPORT = { width: 844, height: 390 } as const;

export type BrowserPageOptions = Pick<BrowserContextOptions, 'deviceScaleFactor' | 'hasTouch' | 'isMobile' | 'userAgent'>;
export type ScreenshotDimensions = { height: number; width: number };
export type ViewportScreenshot = ScreenshotDimensions & { path: string };

export type BrowserHarness = {
  browser: Browser;
  newPage: (
    viewport?: { width: number; height: number },
    options?: BrowserPageOptions,
  ) => Promise<{ context: BrowserContext; page: Page }>;
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
    async newPage(viewport = DESKTOP_VIEWPORT, options = {}) {
      const context = await browser.newContext({ ...options, viewport });
      contexts.add(context);
      const page = await context.newPage();
      return { context, page };
    },
    async close() {
      try {
        await Promise.allSettled([...contexts].map((context) => context.close()));
      } finally {
        await browser.close();
      }
    },
  };
}

export async function saveScreenshot(page: Page, name: string): Promise<string> {
  const path = join(tmpdir(), `arielcharts-${name}.png`);
  await page.screenshot({ path, fullPage: true });
  return path;
}

export function pngDimensions(png: Buffer): ScreenshotDimensions {
  const pngSignature = '89504e470d0a1a0a';
  if (png.length < 24 || png.subarray(0, 8).toString('hex') !== pngSignature) {
    throw new Error('Expected a PNG screenshot buffer.');
  }
  return { height: png.readUInt32BE(20), width: png.readUInt32BE(16) };
}

/**
 * Captures the browser viewport rather than the full document. Phone checks use
 * this to prove that the actual pixel output is the configured CSS viewport at
 * deviceScaleFactor 1, instead of accidentally accepting a wider page capture.
 */
export async function saveViewportScreenshot(page: Page, name: string): Promise<ViewportScreenshot> {
  const path = join(tmpdir(), `arielcharts-${name}.png`);
  const png = await page.screenshot({ path });
  return { path, ...pngDimensions(png) };
}
