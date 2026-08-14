import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const mobileCss = css.slice(css.indexOf('@media (max-width: 720px), (max-height: 480px) and (pointer: coarse)'));
const narrowCanvasCss = css.slice(css.indexOf('@media (max-width: 420px)'));

describe('mobile workspace CSS contracts', () => {
  it('preserves the flex shrink boundary that keeps canvas panels internally scrollable', () => {
    expect(css).toMatch(/\.workspace-main\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/u);
  });

  it('keeps the inline overlay strip scrollable, touch-sized, and separately bounded from its inspector', () => {
    expect(css).toMatch(/\.overlay-toolbar-primary,\s*\.overlay-toolbar-context,\s*\.overlay-toolbar-inspector,\s*\.overlay-toolbar-inspector-actions\s*\{[^}]*display:\s*flex;[^}]*pointer-events:\s*auto;/u);
    expect(css).toMatch(/\.overlay-toolbar-primary\s*\{[^}]*overflow-x:\s*auto;[^}]*pointer-events:\s*none;[^}]*touch-action:\s*pan-x;[^}]*width:\s*min\(100%, 790px\);/u);
    expect(css).toMatch(/\.overlay-toolbar-primary > \.overlay-toolbar-button\s*\{\s*pointer-events:\s*auto;\s*\}/u);
    expect(css).not.toMatch(/\.overlay-toolbar-divider\s*\{[^}]*pointer-events:\s*auto;/u);
    expect(css).toMatch(/\.overlay-toolbar-context\s*\{[^}]*overflow-x:\s*auto;[^}]*width:\s*min\(100%, 680px\);/u);
    expect(css).toMatch(/\.overlay-toolbar-inspector\s*\{[^}]*box-sizing:\s*border-box;[^}]*max-height:\s*min\(280px, var\(--overlay-toolbar-inspector-max-height, 0px\)\);[^}]*overflow:\s*auto;/u);
    expect(css).toMatch(/@media \(pointer: coarse\), \(max-width: 420px\)[^]*?\.overlay-toolbar-button\s*\{[^}]*height:\s*44px;[^}]*width:\s*44px;/u);
    expect(css).toMatch(/@media \(pointer: coarse\), \(max-width: 420px\)[^]*?\.overlay-toolbar-inspector\s*\{[^}]*max-width:\s*calc\(var\(--overlay-toolbar-available-width, 100vw\) - 48px\);[^}]*width:\s*calc\(var\(--overlay-toolbar-available-width, 100vw\) - 48px\);/u);
    expect(css).not.toContain('.overlay-tools-toggle');
    expect(css).not.toContain('.overlay-scene-controls');
  });

  it('keeps selected actions beside the direct strip in a one-row short-landscape grid', () => {
    const landscapeCss = css.slice(css.indexOf('@media (min-width: 421px) and (max-height: 500px)'));
    const hostedLandscapeInspectorEdgeGutters = ({
      canvasWidth,
      inspectorWidth,
      toolbarInset,
      inspectorEndMargin,
    }: {
      canvasWidth: number;
      inspectorWidth: number;
      toolbarInset: number;
      inspectorEndMargin: number;
    }) => {
      const toolbarRight = canvasWidth - toolbarInset;
      const inspectorRight = toolbarRight - inspectorEndMargin;
      return { left: inspectorRight - inspectorWidth, right: canvasWidth - inspectorRight };
    };
    expect(landscapeCss).toMatch(/\.overlay-icon-toolbar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);[^}]*width:\s*min\(calc\(100% - 24px\), var\(--overlay-toolbar-available-width, 100vw\)\);/u);
    expect(landscapeCss).toMatch(/\.overlay-icon-toolbar:not\(:has\(\.overlay-toolbar-context\)\) > \.overlay-toolbar-primary\s*\{[^}]*grid-column:\s*1 \/ -1;[^}]*justify-self:\s*center;[^}]*width:\s*min\(100%, 790px\);/u);
    expect(landscapeCss).toMatch(/\.overlay-icon-toolbar:has\(\.overlay-toolbar-context\)\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);/u);
    expect(landscapeCss).toMatch(/\.overlay-icon-toolbar:has\(\.overlay-toolbar-context\) > \.overlay-toolbar-primary,[^]*?\.overlay-icon-toolbar:has\(\.overlay-toolbar-context\) > \.overlay-toolbar-context\s*\{[^}]*grid-row:\s*1;[^}]*min-width:\s*0;[^}]*width:\s*100%;/u);
    expect(landscapeCss).toMatch(/\.overlay-icon-toolbar:has\(\.overlay-toolbar-context\) > \.overlay-toolbar-primary\s*\{\s*grid-column:\s*1;\s*\}/u);
    expect(landscapeCss).toMatch(/\.overlay-icon-toolbar:has\(\.overlay-toolbar-context\) > \.overlay-toolbar-context\s*\{\s*grid-column:\s*2;\s*\}/u);
    expect(landscapeCss).toMatch(/\.overlay-icon-toolbar > \.overlay-toolbar-inspector\s*\{[^}]*grid-row:\s*2;[^}]*justify-self:\s*end;[^}]*margin-inline-end:\s*12px;[^}]*max-width:\s*min\(360px, calc\(\(var\(--overlay-toolbar-available-width, 100vw\) - 48px\) \/ 2\)\);[^}]*width:\s*min\(360px, calc\(\(var\(--overlay-toolbar-available-width, 100vw\) - 48px\) \/ 2\)\);/u);
    // Hosted Chromium had an 844px canvas: the old 12px end gutter supplied
    // no second canvas-owned edge lane alongside the flowchart add form.
    const hostedGutters = hostedLandscapeInspectorEdgeGutters({ canvasWidth: 844, inspectorEndMargin: 12, inspectorWidth: 360, toolbarInset: 12 });
    expect(hostedGutters).toEqual({ left: 460, right: 24 });
    expect(Object.values(hostedGutters).filter((gutter) => gutter >= 20)).toHaveLength(2);
  });

  it('keeps capped error banners touch-scrollable without blocking the rest of the canvas', () => {
    expect(mobileCss).toMatch(/\.error-banner\s*\{[^}]*overflow:\s*auto;[^}]*pointer-events:\s*auto;[^}]*touch-action:\s*pan-y;/u);
  });

  it('truncates long persistent touch labels on one line', () => {
    expect(css).toMatch(/\.workspace-touch-label-status\s*\{[^}]*overflow:\s*hidden;[^}]*text-overflow:\s*ellipsis;[^}]*white-space:\s*nowrap;/u);
  });

  it('keeps the GitHub copy action touch-sized inside the mobile source sheet', () => {
    expect(mobileCss).toMatch(/\.workspace-source-github-copy \.workspace-copy-button\s*\{[^}]*min-height:\s*44px;/u);
  });

  it('keeps chooser documentation links as centered 44px touch targets', () => {
    expect(css).toMatch(/\.workspace-template-menu-help\s*\{[^}]*display:\s*inline-flex;[^}]*align-items:\s*center;[^}]*justify-content:\s*center;[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/u);
  });
});

describe('Mermaid source highlighting accessibility', () => {
  it('uses theme tokens and a forced-colors fallback instead of fixed editor colors', () => {
    expect(css).toMatch(/--source-syntax-keyword:\s*#1559c8;/u);
    expect(css).toMatch(/html\[data-theme='dark'\]\s*\{[^}]*--source-syntax-keyword:\s*#9abfff;/u);
    const forcedColors = css.slice(css.indexOf('@media (forced-colors: active)'));
    expect(forcedColors).toMatch(/:root\s*\{[^}]*--source-syntax-keyword:\s*CanvasText;/u);
    expect(forcedColors).toMatch(/--source-syntax-comment:\s*CanvasText;/u);
    expect(forcedColors).toMatch(/--source-syntax-invalid:\s*CanvasText;/u);
  });
});

describe('flow-node shape surface contracts', () => {
  it('clips only the painted shape surface, leaving React Flow handles outside it', () => {
    expect(css).toMatch(/\.mermaid-flow-node\s*\{[^}]*position:\s*relative;[^}]*\}/u);
    expect(css).toMatch(/\.mermaid-flow-node-surface--diamond\s*\{[^}]*clip-path:\s*polygon\(/u);
    expect(css).toMatch(/\.mermaid-flow-node-surface--hexagon\s*\{[^}]*clip-path:\s*polygon\(/u);
    expect(css).not.toMatch(/\.mermaid-flow-node--(?:diamond|hexagon)\s*\{[^}]*clip-path:/u);
    expect(css).toMatch(/\.diagram-reactflow-layer \.react-flow__handle\s*\{[^}]*z-index:\s*2;/u);
    expect(css).not.toMatch(/\.mermaid-flow-handle--source\s*\{[^}]*pointer-events:\s*auto;/u);
    expect(css).not.toMatch(/\.mermaid-flow-handle--target\s*\{[^}]*pointer-events:\s*auto;/u);
    expect(css).toMatch(/\.mermaid-flow-node-surface--cylinder::before\s*\{[^}]*height:\s*clamp\(6px,\s*22%,\s*18px\);/u);
    expect(css).toMatch(/\.mermaid-flow-node-surface--cylinder::before\s*\{[^}]*left:\s*-1px;[^}]*right:\s*-1px;/u);
    expect(css).toMatch(/\.mermaid-flow-node-surface--cylinder::before\s*\{[^}]*border-color:\s*inherit;/u);
  });
});

describe('revision history selection CSS contracts', () => {
  it('keeps the current revision bottom border selected when it is the final or only card', () => {
    const lastItem = css.indexOf('.history-item:last-child');
    const currentLastItem = css.indexOf('.history-item.is-current:last-child');

    expect(currentLastItem).toBeGreaterThan(lastItem);
    expect(css.slice(currentLastItem, currentLastItem + 140)).toMatch(/border-bottom-color:\s*var\(--selection\);/u);
  });
});

describe('editable section presentation', () => {
  it('hides stale Mermaid cluster geometry behind the derived interactive section layer', () => {
    expect(css).toMatch(/\.diagram-canvas-svg--reactflow svg g\.cluster,[^}]*\{\s*opacity:\s*0;/u);
  });
});

describe('narrow sequence controls', () => {
  it('stacks the chooser, constrains both sequence forms, and keeps add actions touch-sized', () => {
    expect(narrowCanvasCss).toMatch(/\.canvas-empty-chooser-actions\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/u);
    expect(narrowCanvasCss).toMatch(/\.canvas-sequence-editor\s*\{[^}]*left:\s*24px;[^}]*right:\s*24px;[^}]*width:\s*auto;/u);
    expect(narrowCanvasCss).toMatch(/\.canvas-sequence-editor\s*\{[^}]*max-height:\s*calc\(100% - 84px\);[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/u);
    expect(narrowCanvasCss).toMatch(/\.canvas-sequence-editor form\s*\{[^}]*display:\s*grid;[^}]*width:\s*100%;/u);
    expect(narrowCanvasCss).toMatch(/\.canvas-sequence-participant-form\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 44px;/u);
    expect(narrowCanvasCss).toMatch(/\.canvas-sequence-message-form\s*\{[^}]*minmax\(0, 1fr\).*44px/u);
    expect(mobileCss).toMatch(/\.canvas-sequence-editor button\s*\{[^}]*min-height:\s*44px;[^}]*width:\s*44px;/u);
    expect(mobileCss).toMatch(/\.canvas-sequence-editor:not\(\.is-centered\)\s*\{[^}]*max-height:\s*calc\(100% - 84px\);[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;[^}]*pointer-events:\s*none;[^}]*touch-action:\s*pan-y;/u);
    expect(mobileCss).toMatch(/\.canvas-sequence-editor:not\(\.is-centered\) > form,[^}]*\{\s*pointer-events:\s*auto;/u);
    expect(narrowCanvasCss).toMatch(/@media \(max-width: 420px\), \(max-height: 500px\)[^]*?\.diagram-canvas-shell\[data-overlay-toolbar-safe-top='true'\] > \.canvas-sequence-editor:not\(\.is-centered\)\s*\{[^}]*bottom:\s*var\(--canvas-controls-toolbar-safe-bottom\);[^}]*max-height:\s*calc\(100% - var\(--overlay-toolbar-safe-top\) - var\(--canvas-controls-toolbar-safe-bottom\)\);[^}]*scroll-padding-top:\s*var\(--overlay-toolbar-safe-top\);[^}]*top:\s*var\(--overlay-toolbar-safe-top\);/u);
  });
});

describe('narrow hierarchy controls', () => {
  it('keeps only Treemap and Venn source-form panels bounded, scrollable, and touch-sized', () => {
    expect(css).toMatch(/@media \(max-width: 420px\), \(max-height: 500px\)\s*\{\s*\.canvas-semantic-editor\s*\{[^}]*--canvas-semantic-editor-top:\s*max\(72px, var\(--overlay-toolbar-safe-top, 0px\)\);[^}]*top:\s*var\(--canvas-semantic-editor-top\) !important;/u);
    expect(narrowCanvasCss).toMatch(/\.canvas-semantic-editor\s*\{[^}]*--canvas-semantic-editor-top:\s*max\(72px, var\(--overlay-toolbar-safe-top, 0px\)\);[^}]*top:\s*var\(--canvas-semantic-editor-top\) !important;/u);
    expect(narrowCanvasCss).toMatch(/\.canvas-treemap-venn-editor\s*\{[^}]*left:\s*8px !important;[^}]*max-height:\s*calc\(100% - var\(--canvas-semantic-editor-top\) - 12px\) !important;[^}]*overflow-y:\s*auto !important;[^}]*overscroll-behavior:\s*contain;[^}]*touch-action:\s*pan-y;/u);
    expect(narrowCanvasCss).toMatch(/\.canvas-treemap-venn-editor input,[^}]*\.canvas-treemap-venn-editor select,[^}]*\.canvas-treemap-venn-editor button\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*44px;/u);
    expect(narrowCanvasCss).not.toMatch(/\.canvas-hierarchy-editor\s*\{/u);
  });
});
