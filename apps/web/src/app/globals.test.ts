import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const mobileCss = css.slice(css.indexOf('@media (max-width: 720px), (max-height: 480px) and (pointer: coarse)'));
const narrowCanvasCss = css.slice(css.indexOf('@media (max-width: 420px)'));

describe('mobile workspace CSS contracts', () => {
  it('reserves a non-overlapping lane for overlay tools beside narrow canvas controls', () => {
    expect(narrowCanvasCss).toMatch(/\.overlay-tools-toggle\s*\{[^}]*bottom:\s*auto\s*!important;[^}]*top:\s*50%;[^}]*transform:\s*translateY\(-50%\);/u);
    expect(narrowCanvasCss).toMatch(/\.overlay-tools-toggle\[aria-expanded="false"\]\s*\{[^}]*top:\s*8px;[^}]*transform:\s*none;[^}]*width:\s*104px;/u);
    expect(narrowCanvasCss).toMatch(/\.workspace-diagram-pane:has\(\.overlay-tools-toggle\[aria-expanded="false"\]\) > \.error-banner\s*\{[^}]*left:\s*128px;[^}]*right:\s*12px;[^}]*transform:\s*none;[^}]*width:\s*auto;/u);
    expect(narrowCanvasCss).toMatch(/\.overlay-scene-controls\s*\{[^}]*bottom:\s*8px;[^}]*display:\s*grid\s*!important;[^}]*grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[^}]*max-height:\s*calc\(100% - 16px\);[^}]*overflow-y:\s*auto;/u);
    expect(narrowCanvasCss).toMatch(/\.overlay-scene-controls button\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*44px;/u);
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
    expect(narrowCanvasCss).toMatch(/\.canvas-sequence-editor\s*\{[^}]*left:\s*8px;[^}]*right:\s*8px;[^}]*width:\s*auto;/u);
    expect(narrowCanvasCss).toMatch(/\.canvas-sequence-editor\s*\{[^}]*max-height:\s*calc\(100% - 84px\);[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/u);
    expect(narrowCanvasCss).toMatch(/\.canvas-sequence-editor form\s*\{[^}]*display:\s*grid;[^}]*width:\s*100%;/u);
    expect(narrowCanvasCss).toMatch(/\.canvas-sequence-participant-form\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) 44px;/u);
    expect(narrowCanvasCss).toMatch(/\.canvas-sequence-message-form\s*\{[^}]*minmax\(0, 1fr\).*44px/u);
    expect(mobileCss).toMatch(/\.canvas-sequence-editor button\s*\{[^}]*min-height:\s*44px;[^}]*width:\s*44px;/u);
    expect(mobileCss).toMatch(/\.canvas-sequence-editor:not\(\.is-centered\)\s*\{[^}]*max-height:\s*calc\(100% - 84px\);[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;[^}]*pointer-events:\s*none;[^}]*touch-action:\s*pan-y;/u);
    expect(mobileCss).toMatch(/\.canvas-sequence-editor:not\(\.is-centered\) > form,[^}]*\{\s*pointer-events:\s*auto;/u);
  });
});

describe('narrow hierarchy controls', () => {
  it('keeps only Treemap and Venn source-form panels bounded, scrollable, and touch-sized', () => {
    expect(narrowCanvasCss).toMatch(/\.canvas-treemap-venn-editor\s*\{[^}]*left:\s*8px !important;[^}]*max-height:\s*calc\(100% - 84px\) !important;[^}]*overflow-y:\s*auto !important;[^}]*overscroll-behavior:\s*contain;[^}]*touch-action:\s*pan-y;/u);
    expect(narrowCanvasCss).toMatch(/\.canvas-treemap-venn-editor input,[^}]*\.canvas-treemap-venn-editor select,[^}]*\.canvas-treemap-venn-editor button\s*\{[^}]*min-height:\s*44px;[^}]*min-width:\s*44px;/u);
    expect(narrowCanvasCss).not.toMatch(/\.canvas-hierarchy-editor\s*\{/u);
  });
});
