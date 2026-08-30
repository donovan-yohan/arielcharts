import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('./globals.css', import.meta.url), 'utf8');
const mobileCss = css.slice(css.indexOf('@media (max-width: 720px), (max-height: 480px) and (pointer: coarse)'));
const narrowCanvasCss = css.slice(css.indexOf('@media (max-width: 420px)'));

describe('mobile workspace CSS contracts', () => {
  it('preserves the flex shrink boundary that keeps canvas panels internally scrollable', () => {
    expect(css).toMatch(/\.workspace-main\s*\{[^}]*flex:\s*1;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;/u);
  });

  it('paints one pill whose rows are separated by hairlines instead of separate surfaces', () => {
    expect(css).toMatch(/\.overlay-icon-toolbar\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--control-surface\) 94%, transparent\);[^}]*border:\s*1px solid var\(--control-border\);[^}]*border-radius:\s*12px;[^}]*box-shadow:\s*0 8px 24px[^;]+;[^}]*gap:\s*0;/u);
    expect(css).not.toMatch(/\.overlay-toolbar-primary,[^]*?\.overlay-toolbar-secondary-actions\s*\{[^}]*(background|border-radius|box-shadow):/u);
    expect(css).toMatch(/\.overlay-toolbar-annotate-actions,\s*\.overlay-toolbar-context,\s*\.overlay-toolbar-inspector,\s*\.overlay-toolbar-secondary-actions\s*\{\s*border-top:\s*1px solid var\(--control-border\);/u);
    expect(css).toMatch(/\.overlay-toolbar-inspector-actions\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--control-surface\) 94%, transparent\);[^}]*border:\s*1px solid var\(--control-border\);[^}]*border-radius:\s*12px;/u);
    expect(css).toMatch(/@media \(forced-colors: active\)[^]*?\.overlay-icon-toolbar, \.overlay-toolbar-inspector-actions, \.overlay-toolbar-secondary \.overlay-toolbar-inspector\s*\{[^}]*background:\s*Canvas;[^}]*border-color:\s*CanvasText;/u);
    expect(css).toMatch(/@media \(forced-colors: active\)[^]*?\.overlay-toolbar-annotate-actions,[^{]*\{[^}]*border-left-color:\s*CanvasText;[^}]*border-top-color:\s*CanvasText;/u);
    // Only short landscape moves the collapsed chrome onto the primary column,
    // so its forced-colors twin carries the same media conditions.
    expect(css).toMatch(/@media \(forced-colors: active\) and \(min-width: 421px\) and \(max-height: 500px\)\s*\{\s*\.overlay-icon-toolbar:not\(\[data-tools-expanded='true'\]\) > \.overlay-toolbar-primary\s*\{[^}]*background:\s*Canvas;[^}]*border-color:\s*CanvasText;/u);
    // The sidecar repaints its own surface inside the short-landscape block, so
    // the forced-colors override only wins if it is declared after it.
    for (const forcedColorsRule of [
      '.overlay-icon-toolbar, .overlay-toolbar-inspector-actions, .overlay-toolbar-secondary .overlay-toolbar-inspector',
      '@media (forced-colors: active) and (min-width: 421px) and (max-height: 500px)',
    ]) {
      expect(css.indexOf(forcedColorsRule)).toBeGreaterThan(css.indexOf('@media (min-width: 421px) and (max-height: 500px)'));
    }
  });

  it('keeps the pill shell and its transparent rows out of hit testing while content rails stay solid', () => {
    for (const rail of ['\\.overlay-icon-toolbar', '\\.overlay-toolbar-primary', '\\.overlay-toolbar-primary-tools', '\\.overlay-toolbar-context', '\\.overlay-toolbar-secondary']) {
      expect(css).toMatch(new RegExp(`${rail}\\s*\\{[^}]*pointer-events:\\s*none;`, 'u'));
    }
    for (const rail of ['\\.overlay-toolbar-annotate-actions', '\\.overlay-toolbar-secondary-actions']) {
      expect(css).not.toMatch(new RegExp(`${rail}\\s*\\{[^}]*pointer-events:\\s*none;`, 'u'));
    }
    expect(css).toMatch(/\.overlay-toolbar-primary,\s*\.overlay-toolbar-annotate-actions,[^]*?\.overlay-toolbar-secondary-actions\s*\{[^}]*pointer-events:\s*auto;/u);
    expect(css).toMatch(/\.overlay-toolbar-annotate-actions > \.overlay-toolbar-button,\s*\.overlay-toolbar-context > \.overlay-toolbar-button,\s*\.overlay-toolbar-primary-tools > \.overlay-toolbar-button,\s*\.overlay-toolbar-primary > \.overlay-toolbar-button,\s*\.overlay-toolbar-secondary-actions > \.overlay-toolbar-button\s*\{[^}]*pointer-events:\s*auto;[^}]*touch-action:\s*pan-x;/u);
    expect(css).toMatch(/\.overlay-toolbar-inspector\s*\{[^}]*pointer-events:\s*auto;/u);
    expect(css).toMatch(/\.overlay-toolbar-inspector-actions\s*\{[^}]*pointer-events:\s*auto;/u);
  });

  it('keeps the direct strip scrollable, touch-sized, and only expands the secondary rail on demand', () => {
    expect(css).toMatch(/\.overlay-toolbar-primary,[^]*?\.overlay-toolbar-secondary-actions\s*\{[^}]*display:\s*flex;/u);
    expect(css).toMatch(/\.overlay-toolbar-primary\s*\{[^}]*overflow:\s*hidden;[^}]*padding:\s*4px;[^}]*width:\s*100%;/u);
    expect(css).toMatch(/\.overlay-toolbar-primary-tools\s*\{[^}]*display:\s*flex;[^}]*flex:\s*1 1 auto;[^}]*min-width:\s*0;[^}]*overflow-x:\s*auto;[^}]*pointer-events:\s*none;[^}]*touch-action:\s*pan-x;/u);
    expect(css).toMatch(/\.overlay-toolbar-annotate-actions,\s*\.overlay-toolbar-secondary-actions\s*\{[^}]*box-sizing:\s*border-box;[^}]*flex-wrap:\s*nowrap;[^}]*overflow-x:\s*auto;[^}]*touch-action:\s*pan-x;[^}]*width:\s*100%;/u);
    expect(css).not.toMatch(/\.overlay-toolbar-divider\s*\{[^}]*pointer-events:\s*auto;/u);
    expect(css).toMatch(/\.overlay-toolbar-secondary\s*\{[^}]*gap:\s*0;[^}]*height:\s*0;[^}]*min-height:\s*0;[^}]*overflow:\s*hidden;[^}]*overflow:\s*clip;[^}]*pointer-events:\s*none;[^}]*grid-template-rows:\s*54px 54px minmax\(0, 1fr\);[^}]*visibility:\s*hidden;/u);
    expect(css).toMatch(/\.overlay-toolbar-secondary\.is-expanded\s*\{[^}]*height:\s*auto;[^}]*max-height:\s*calc\(var\(--overlay-toolbar-available-height, 100vh\) - 54px\);[^}]*visibility:\s*visible;/u);
    expect(css).not.toMatch(/--overlay-toolbar-rail-height/u);
    expect(css).toMatch(/\.overlay-toolbar-inspector\s*\{[^}]*box-sizing:\s*border-box;[^}]*max-height:\s*118px;[^}]*overflow:\s*auto;[^}]*pointer-events:\s*auto;/u);
    expect(css).toMatch(/@media \(pointer: coarse\), \(max-width: 420px\)[^]*?\.overlay-toolbar-button\s*\{[^}]*height:\s*44px;[^}]*width:\s*44px;/u);
    expect(css).not.toMatch(/@media \(pointer: coarse\), \(max-width: 420px\)[^]*?\.overlay-toolbar-primary-tools\s*\{[^}]*pointer-events:\s*auto;/u);
    expect(css).toMatch(/@media \(pointer: coarse\), \(max-width: 420px\)[^]*?\.overlay-toolbar-inspector\s*\{[^}]*max-width:\s*max\(0px, calc\(var\(--overlay-toolbar-available-width, 100vw\) - 48px\)\);[^}]*width:\s*max\(0px, calc\(var\(--overlay-toolbar-available-width, 100vw\) - 48px\)\);/u);
    expect(css).not.toContain('.overlay-tools-toggle');
    expect(css).not.toContain('.overlay-scene-controls');
  });

  it('keeps the primary row stable in short landscape while the rail remains inline', () => {
    const landscapeCss = css.slice(css.indexOf('@media (min-width: 421px) and (max-height: 500px)'));
    expect(landscapeCss).toMatch(/\.overlay-icon-toolbar\s*\{[^}]*grid-template-rows:\s*54px;[^}]*justify-items:\s*stretch;/u);
    expect(landscapeCss).toMatch(/\.overlay-icon-toolbar\[data-tools-expanded='true'\]\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(0, 1fr\);[^}]*width:\s*min\(calc\(100% - 24px\), var\(--overlay-toolbar-available-width, 100vw\)\);/u);
    // Collapsed, the second column is empty, so the chrome moves onto the
    // primary column and the pill's box shrinks to that painted column.
    expect(landscapeCss).toMatch(/\.overlay-icon-toolbar:not\(\[data-tools-expanded='true'\]\)\s*\{[^}]*background:\s*none;[^}]*border-color:\s*transparent;[^}]*box-shadow:\s*none;[^}]*grid-template-columns:\s*max-content 0;[^}]*width:\s*max-content;/u);
    expect(landscapeCss).toMatch(/\.overlay-icon-toolbar:not\(\[data-tools-expanded='true'\]\) > \.overlay-toolbar-primary\s*\{[^}]*background:\s*color-mix\(in srgb, var\(--control-surface\) 94%, transparent\);[^}]*border:\s*1px solid var\(--control-border\);[^}]*border-radius:\s*12px;[^}]*box-shadow:\s*0 8px 24px/u);
    expect(landscapeCss).not.toMatch(/\.overlay-icon-toolbar:not\(\[data-tools-expanded='true'\]\)\s*\{[^}]*border-width:/u);
    expect(landscapeCss).toMatch(/\.overlay-toolbar-secondary\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*row;[^}]*overflow-x:\s*auto;/u);
    expect(landscapeCss).not.toMatch(/\.overlay-toolbar-secondary\s*\{[^}]*grid-template-columns:/u);
    expect(landscapeCss).toMatch(/\.overlay-toolbar-annotate-actions, \.overlay-toolbar-secondary-actions, \.overlay-toolbar-secondary > \.overlay-toolbar-context\s*\{[^}]*border-top:\s*none;[^}]*flex:\s*1 1 0;[^}]*height:\s*54px;/u);
    expect(landscapeCss).toMatch(/\.overlay-toolbar-secondary\.is-expanded\s*\{[^}]*height:\s*54px;[^}]*min-height:\s*54px;[^}]*overflow:\s*visible;/u);
    // The 62px pairs with OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_CSS_TOP; the
    // sidecar sits inside the pill's padding box, so its real top adds the border.
    expect(landscapeCss).toMatch(/\.overlay-toolbar-secondary \.overlay-toolbar-inspector\s*\{[^}]*background:\s*color-mix[^}]*border:\s*1px solid var\(--control-border\);[^}]*max-height:\s*var\(--overlay-toolbar-inspector-max-height\);[^}]*max-width:\s*min\(320px, calc\(50vw - 24px\)\);[^}]*position:\s*absolute;[^}]*top:\s*62px;/u);
    expect(landscapeCss).not.toContain(':has(');
  });

  it('puts desktop and tablet semantic panels below the measured active toolbar lane', () => {
    expect(css).toMatch(/\.diagram-canvas-shell\[data-overlay-toolbar-safe-top='true'\] > \.canvas-sequence-editor:not\(\.is-centered\)\s*\{[^}]*top:\s*var\(--overlay-toolbar-safe-top\);/u);
    expect(css).toMatch(/\.diagram-canvas-shell\[data-overlay-toolbar-safe-top='true'\] > \.canvas-semantic-editor\s*\{[^}]*--canvas-semantic-editor-top:\s*max\(72px, var\(--overlay-toolbar-safe-top, 0px\)\);[^}]*top:\s*var\(--canvas-semantic-editor-top\) !important;/u);
  });

  it('keeps selected transform controls outside clipped objects with touch-safe hit areas', () => {
    expect(css).toMatch(/\.overlay-selection-overlay,[^}]*\.overlay-line-selection-overlay\s*\{[^}]*pointer-events:\s*none;[^}]*position:\s*absolute;/u);
    expect(css).toMatch(/\.overlay-transform-handle\s*\{[^}]*height:\s*44px;[^}]*pointer-events:\s*auto;[^}]*touch-action:\s*none;[^}]*width:\s*44px;/u);
    expect(css).toMatch(/\.overlay-transform-handle::after\s*\{[^}]*height:\s*8px;[^}]*width:\s*8px;/u);
    expect(css).toMatch(/@media \(forced-colors: active\)[^]*?\.overlay-transform-handle::after\s*\{[^}]*background:\s*Highlight;/u);
    expect(css).not.toContain('.overlay-resize-handle');
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

  it('collapses Export chrome before it can overlap the mobile workspace header', () => {
    expect(mobileCss).toMatch(/\.workspace-topbar\s*\{[^}]*justify-content:\s*flex-start;[^}]*gap:\s*6px;/u);
    expect(mobileCss).toMatch(/\.workspace-topbar-left\s*\{[^}]*flex:\s*0 1 auto;[^}]*overflow:\s*hidden;/u);
    expect(mobileCss).toMatch(/\.workspace-topbar-right\s*\{[^}]*flex:\s*1 1 auto;[^}]*margin-left:\s*auto;/u);
    expect(mobileCss).toMatch(/\.workspace-presence-avatars\s*\{[^}]*padding-left:\s*0;/u);
    expect(mobileCss).toMatch(/\.workspace-export-menu > \.workspace-icon-button\s*\{[^}]*width:\s*44px;[^}]*min-width:\s*44px;[^}]*justify-content:\s*center;/u);
    expect(mobileCss).toMatch(/\.presenter-mobile-menu summary\s*\{[^}]*width:\s*44px;[^}]*min-width:\s*44px;[^}]*font-size:\s*0;/u);
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
    expect(css).toMatch(/\.diagram-canvas-shell\[data-overlay-toolbar-safe-top='true'\] > \.canvas-sequence-editor:not\(\.is-centered\)\s*\{[^}]*bottom:\s*var\(--canvas-controls-toolbar-safe-bottom\);[^}]*max-height:\s*calc\(100% - var\(--overlay-toolbar-safe-top\) - var\(--canvas-controls-toolbar-safe-bottom\)\);[^}]*scroll-padding-top:\s*var\(--overlay-toolbar-safe-top\);[^}]*top:\s*var\(--overlay-toolbar-safe-top\);/u);
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

describe('canvas context menu CSS contracts', () => {
  const contextMenuCss = css.slice(css.indexOf('.canvas-context-menu {'));

  it('paints a self-contained surface above the floating canvas toolbars', () => {
    expect(contextMenuCss).toMatch(/\.canvas-context-menu\s*\{[^}]*background:\s*var\(--control-surface\);[^}]*border:\s*1px solid var\(--control-border\);[^}]*z-index:\s*95;/u);
    expect(contextMenuCss).toMatch(/\.canvas-context-menu\s*\{[^}]*max-height:\s*calc\(100vh - 16px\);[^}]*overflow-y:\s*auto;[^}]*overscroll-behavior:\s*contain;/u);
  });

  it('keeps items touch-sized on coarse pointers and readable when disabled or dangerous', () => {
    expect(contextMenuCss).toMatch(/\.canvas-context-menu-item\s*\{[^}]*min-height:\s*36px;/u);
    expect(contextMenuCss).toMatch(/@media \(pointer: coarse\), \(max-width: 420px\)\s*\{\s*\.canvas-context-menu-item\s*\{\s*min-height:\s*44px;/u);
    expect(contextMenuCss).toMatch(/\.canvas-context-menu-item:disabled\s*\{[^}]*cursor:\s*default;/u);
    expect(contextMenuCss).toMatch(/\.canvas-context-menu-item\[data-danger='true'\]\s*\{\s*color:\s*var\(--status-danger-text\);/u);
    expect(contextMenuCss).toMatch(/\.canvas-context-menu-item:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--focus-ring\);/u);
  });

  it('carries its own forced-colors block instead of extending the toolbar block', () => {
    const forcedColors = contextMenuCss.slice(contextMenuCss.indexOf('@media (forced-colors: active)'));
    expect(forcedColors).toMatch(/\.canvas-context-menu\s*\{[^}]*background:\s*Canvas;[^}]*border-color:\s*CanvasText;/u);
    expect(forcedColors).toMatch(/\.canvas-context-menu-item:focus-visible\s*\{[^}]*background:\s*Highlight;[^}]*color:\s*HighlightText;/u);
    expect(css.slice(0, css.indexOf('.canvas-context-menu {'))).not.toContain('canvas-context-menu');
  });

  it('overrides every author colour that outranks the plain item rule under forced colors', () => {
    const forcedColors = contextMenuCss.slice(contextMenuCss.indexOf('@media (forced-colors: active)'));
    for (const selector of [
      /\.canvas-context-menu-item\[data-danger='true'\][^{:]*,?[^{]*\{[^}]*color:\s*CanvasText;/u,
      /\.canvas-context-menu-item kbd[^{]*\{[^}]*color:\s*CanvasText;/u,
      /\.canvas-context-menu-item:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*Highlight;[^}]*color:\s*HighlightText;/u,
      /\.canvas-context-menu-item\[data-danger='true'\]:hover:not\(:disabled\)[^{]*\{[^}]*background:\s*Highlight;/u,
    ]) {
      expect(forcedColors).toMatch(selector);
    }
  });
});
