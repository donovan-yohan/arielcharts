import type { Locator, Page } from '@playwright/test';
import { assert } from './assert.ts';

export type Anchor = { bottom: number; height: number; left: number; right: number; top: number; width: number };
export type AnchorSnapshot = Record<string, Anchor>;

export async function snapshotAnchors(page: Page, selectors: Record<string, string>): Promise<AnchorSnapshot> {
  return page.evaluate((entries) => Object.fromEntries(entries.map(([name, selector]) => {
    const element = document.querySelector(selector);
    if (!(element instanceof HTMLElement)) {
      throw new Error(`Anchor ${name} is missing (${selector}).`);
    }
    const rect = element.getBoundingClientRect();
    return [name, { bottom: rect.bottom, height: rect.height, left: rect.left, right: rect.right, top: rect.top, width: rect.width }];
  })), Object.entries(selectors));
}

export function assertAnchorsStable(before: AnchorSnapshot, after: AnchorSnapshot, tolerancePx = 1): void {
  for (const [name, previous] of Object.entries(before)) {
    const next = after[name];
    assert(next, `Anchor ${name} disappeared.`);
    for (const key of ['bottom', 'height', 'left', 'right', 'top', 'width'] as const) {
      assert(Math.abs(previous[key] - next[key]) <= tolerancePx,
        `Anchor ${name}.${key} moved ${Math.abs(previous[key] - next[key]).toFixed(2)}px (limit ${tolerancePx}px).`);
    }
  }
}

export async function assertHitTarget(page: Page, target: Locator, label: string): Promise<void> {
  await target.waitFor({ state: 'visible', timeout: 15_000 });
  assert(await target.isEnabled(), `${label} is disabled.`);
  const box = await target.boundingBox();
  assert(box && box.width > 0 && box.height > 0, `${label} has no clickable bounds.`);
  const point = { x: box.x + (box.width / 2), y: box.y + (box.height / 2) };
  const hit = await target.evaluate((targetElement, { x, y }) => {
    const hitElement = document.elementFromPoint(x, y);
    return !!hitElement && (targetElement === hitElement || targetElement.contains(hitElement));
  }, point);
  assert(hit, `${label} is obscured at its center point.`);
}

export async function verifiedClick(page: Page, target: Locator, label: string): Promise<void> {
  await assertHitTarget(page, target, label);
  await target.click({ trial: true, timeout: 15_000 });
  await target.click({ timeout: 15_000 });
}

export async function assertContainedInViewport(page: Page, target: Locator, label: string, tolerancePx = 1): Promise<void> {
  await target.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await target.boundingBox();
  assert(box, `${label} has no visible bounds.`);
  const viewport = page.viewportSize();
  assert(viewport, `${label} viewport is unavailable.`);
  assert(box.x >= -tolerancePx && box.y >= -tolerancePx
    && box.x + box.width <= viewport.width + tolerancePx
    && box.y + box.height <= viewport.height + tolerancePx,
  `${label} escapes the viewport: ${JSON.stringify(box)} in ${JSON.stringify(viewport)}.`);
}

export async function assertDocumentHasNoHorizontalOverflow(page: Page, tolerancePx = 1): Promise<void> {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert(overflow <= tolerancePx, `Document has ${overflow}px horizontal overflow.`);
}

type Rgb = { b: number; g: number; r: number };

function parseRgb(value: string, label: string): Rgb {
  const match = value.match(/^rgba?\((\d+),\s*(\d+),\s*(\d+)/u);
  if (match) {
    return { r: Number(match[1]), g: Number(match[2]), b: Number(match[3]) };
  }
  const hex = value.trim().match(/^#([\da-f]{3}|[\da-f]{6})$/iu)?.[1];
  assert(hex, `${label} is not a resolved RGB or hex color: ${value}.`);
  const expanded = hex.length === 3 ? [...hex].map((channel) => `${channel}${channel}`).join('') : hex;
  return {
    r: Number.parseInt(expanded.slice(0, 2), 16),
    g: Number.parseInt(expanded.slice(2, 4), 16),
    b: Number.parseInt(expanded.slice(4, 6), 16),
  };
}

function channelLuminance(channel: number): number {
  const normalized = channel / 255;
  return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
}

export function contrastRatio(foreground: string, background: string, label: string): number {
  const fg = parseRgb(foreground, `${label} foreground`);
  const bg = parseRgb(background, `${label} background`);
  const luminance = ({ r, g, b }: Rgb) => (0.2126 * channelLuminance(r)) + (0.7152 * channelLuminance(g)) + (0.0722 * channelLuminance(b));
  const [light, dark] = [luminance(fg), luminance(bg)].sort((left, right) => right - left);
  return (light + 0.05) / (dark + 0.05);
}

export function assertContrastAtLeast(foreground: string, background: string, minimum: number, label: string): void {
  const ratio = contrastRatio(foreground, background, label);
  assert(ratio >= minimum, `${label} contrast ${ratio.toFixed(2)}:1 is below ${minimum}:1 (${foreground} on ${background}).`);
}

export function assertNeutralColor(value: string, label: string, maxChannelDelta = 12): void {
  const { r, g, b } = parseRgb(value, label);
  const delta = Math.max(r, g, b) - Math.min(r, g, b);
  assert(delta <= maxChannelDelta, `${label} is not monochrome-neutral: ${value} (channel delta ${delta}).`);
}

export function assertExactColor(actual: string, expected: string, label: string): void {
  assert(actual === expected, `${label} expected ${expected}, received ${actual}.`);
}
