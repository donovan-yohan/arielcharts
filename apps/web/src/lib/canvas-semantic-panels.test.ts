import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getPairedSemanticPanelPlacement } from './canvas-semantic-panels';

describe('paired semantic panel placement', () => {
  it('keeps C4 and Block panels side-by-side inside a wide unobscured viewport', () => {
    expect(getPairedSemanticPanelPlacement({ height: 700 }, { height: 600, width: 900, x: 0, y: 0 }, 64)).toEqual({
      stacked: false,
      containment: { bottom: 164, left: 12, width: 400 },
      editor: { bottom: 164, left: 488, width: 400 },
    });
  });

  it.each([320, 390])('leaves the inspector edge-gutter midpoint canvas-owned at %ipx', (width) => {
    const placement = getPairedSemanticPanelPlacement({ height: 720 }, { height: 600, width, x: 0, y: 0 }, 48);
    expect(placement?.stacked).toBe(true);
    // The open narrow inspector ends 39px before the canvas edge.
    const gutterPoint = width - (39 / 2);
    for (const panel of [placement!.containment, placement!.editor]) {
      expect(panel.left).toBeGreaterThanOrEqual(20);
      expect(panel.left + panel.width).toBeLessThan(gutterPoint);
    }
  });

  it('keeps shared narrow semantic panel outer gutters separate from field insets', () => {
    const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
    expect(css).toMatch(/@media \(max-width: 720px\)\s*\{\s*\[data-workspace-panel='semantic'\]\s*\{[^}]*right: 24px;[^}]*width: min\(400px, calc\(100% - 48px\)\);/u);
    expect(css).toMatch(/@media \(max-width: 720px\), \(pointer: coarse\)[^]*?\[data-workspace-panel='semantic'\] \{ padding: 12px; \}/u);
  });

  it('stacks paired sections within the narrow canvas pan gutters', () => {
    const placement = getPairedSemanticPanelPlacement({ height: 600 }, { height: 600, width: 360, x: 0, y: 0 }, 48);
    expect(placement).toEqual({
      stacked: true,
      containment: { bottom: 48, left: 24, width: 312 },
      editor: { bottom: 48, left: 24, width: 312 },
    });
  });

  it('uses the unobscured viewport origin and bottom rather than the full canvas', () => {
    expect(getPairedSemanticPanelPlacement({ height: 800 }, { height: 500, width: 520, x: 40, y: 100 }, 40)).toEqual({
      stacked: true,
      containment: { bottom: 240, left: 64, width: 472 },
      editor: { bottom: 240, left: 64, width: 472 },
    });
  });
});
