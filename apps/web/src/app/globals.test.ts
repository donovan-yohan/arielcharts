import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const mobileCss = css.slice(css.indexOf('@media (max-width: 720px), (max-height: 480px) and (pointer: coarse)'));

describe('mobile workspace CSS contracts', () => {
  it('keeps capped error banners touch-scrollable without blocking the rest of the canvas', () => {
    expect(mobileCss).toMatch(/\.error-banner\s*\{[^}]*overflow:\s*auto;[^}]*pointer-events:\s*auto;[^}]*touch-action:\s*pan-y;/u);
  });

  it('truncates long persistent touch labels on one line', () => {
    expect(css).toMatch(/\.workspace-touch-label-status\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/u);
  });
});
