import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { DiagramLink } from '../lib/diagram-mutations';
import type { MermaidPresentation } from '../lib/mermaid-presentation';
import type { SvgHitMap } from '../lib/svg-hit-map';
import { getCanvasEdgeMarker } from '../lib/mermaid-presentation';
import { areMermaidPresentationsEqual, areSvgHitMapsEqual, getCanvasHistoryShortcut, getCanonicalSelectionAttribute, getFlowEdgePresentation, getFlowSelectionChange, getGraphMembershipKey, getNodeClickSelection, getRendererInteractionMode, isSameNodeSelection, shouldEnableCanvasMarquee, shouldHandleCanvasShortcut, shouldHandleCanvasSingleKeyShortcut, shouldHandleGlobalCanvasRenameShortcut, shouldRestoreCanvasFocusAfterPaste } from './diagram-canvas';

const canvasSource = readFileSync(new URL('./diagram-canvas.tsx', import.meta.url), 'utf8');
const workspaceSource = readFileSync(new URL('./session-workspace.tsx', import.meta.url), 'utf8');

describe('canvas cursor callback lifecycle', () => {
  it('withdraws presence only on true canvas unmount and keeps preview gating behind a stable publisher ref', () => {
    expect(canvasSource).toMatch(/onCanvasCursorChangeRef\.current = onCanvasCursorChange;[^]*?useEffect\(\(\) => \(\) => \{\s*onCanvasCursorChangeRef\.current\?\.\(null\);\s*\}, \[\]\);/u);
    expect(workspaceSource).toMatch(/historyPreviewRef\.current = historyPreview;[^]*?if \(!collaboration \|\| !diagramId \|\| historyPreviewRef\.current !== null\)[^]*?\}, \[collaboration\]\);/u);
  });
});

describe('getRendererInteractionMode', () => {
  it('leaves camera ownership separate while static previews clear connect mode', () => {
    expect(getRendererInteractionMode('connect', false)).toBe('select');
    expect(getRendererInteractionMode('connect', true)).toBe('connect');
    expect(getRendererInteractionMode('select', false)).toBe('select');
  });
});

describe('React Flow handle directionality', () => {
  it('leaves sources as connection starts and targets as connection ends', () => {
    expect(canvasSource).toMatch(/mermaid-flow-handle--\$\{position\} mermaid-flow-handle--target[^]*?isConnectableStart=\{false\}/u);
    expect(canvasSource).toMatch(/mermaid-flow-handle--\$\{position\} mermaid-flow-handle--source[^]*?isConnectableEnd=\{false\}/u);
  });
});

describe('flyout viewport measurement', () => {
  it('defers mutation-triggered measurements until the flyout layout frame settles', () => {
    expect(canvasSource).toMatch(/const mutationObserver = new MutationObserver\(\(\) => \{\s*observeFlyouts\(\);\s*scheduleViewportUpdate\(\);\s*\}\);/u);
  });
});

describe('getCanonicalSelectionAttribute', () => {
  it('keeps one stable app-owned snapshot across preview entry and exit', () => {
    const selected = ['Browser', 'API'];
    const beforePreview = getCanonicalSelectionAttribute(selected);
    const duringDetachedPreview = getCanonicalSelectionAttribute(selected);
    const afterCancel = getCanonicalSelectionAttribute(selected);

    expect(beforePreview).toBe('["API","Browser"]');
    expect(duringDetachedPreview).toBe(beforePreview);
    expect(afterCancel).toBe(beforePreview);
  });
});

describe('getGraphMembershipKey', () => {
  it('does not retrigger SVG-derived state for equivalent parser array identities', () => {
    expect(getGraphMembershipKey(['B', 'A'], ['group-b', 'group-a']))
      .toBe(getGraphMembershipKey(['A', 'B'], ['group-a', 'group-b']));
    expect(getGraphMembershipKey(['A'], [])).not.toBe(getGraphMembershipKey(['A', 'B'], []));
  });
});

describe('SVG-derived state equality', () => {
  it('keeps equivalent SVG hit maps and presentation projections as no-ops', () => {
    const hitMap: SvgHitMap = {
      edges: new Map(),
      nodes: new Map([['A', { height: 24, width: 80, x: 12, y: 8 }]]),
      subgraphs: new Map(),
      viewBox: { height: 100, width: 200, x: 0, y: 0 },
    };
    const equivalentHitMap: SvgHitMap = {
      ...hitMap,
      nodes: new Map(hitMap.nodes),
    };
    const presentation: MermaidPresentation = {
      edges: [{ stroke: '#123' }],
      nodes: new Map([['A', { fill: '#fff', text: '#111' }]]),
    };
    const equivalentPresentation: MermaidPresentation = {
      edges: [{ stroke: '#123' }],
      nodes: new Map([['A', { fill: '#fff', text: '#111' }]]),
    };

    expect(areSvgHitMapsEqual(hitMap, equivalentHitMap)).toBe(true);
    expect(areMermaidPresentationsEqual(presentation, equivalentPresentation)).toBe(true);
    expect(areSvgHitMapsEqual(hitMap, { ...equivalentHitMap, nodes: new Map([['A', { height: 24, width: 80, x: 13, y: 8 }]]) })).toBe(false);
  });
});

describe('isSameNodeSelection', () => {
  it('treats React Flow selection callbacks with the same ids as a no-op', () => {
    expect(isSameNodeSelection(['B', 'A'], ['A', 'B'])).toBe(true);
    expect(isSameNodeSelection(['A'], ['A', 'B'])).toBe(false);
  });
});

describe('getFlowSelectionChange', () => {
  it('keeps intentional empty selection while ignoring callbacks from an unavailable or stale graph', () => {
    expect(getFlowSelectionChange([], ['A', 'B'])).toEqual([]);
    expect(getFlowSelectionChange([], [])).toBeNull();
    expect(getFlowSelectionChange([{ id: 'stale' }], ['A', 'B'])).toBeNull();
    expect(getFlowSelectionChange([{ id: 'A' }], ['A', 'B'])).toEqual(['A']);
  });
});

describe('getNodeClickSelection', () => {
  it('keeps ordinary and Shift selection in app-owned click handlers', () => {
    expect(getNodeClickSelection(['A'], 'B', false)).toEqual(['B']);
    expect(getNodeClickSelection(['A'], 'B', true)).toEqual(['A', 'B']);
    expect(getNodeClickSelection(['A', 'B'], 'A', true)).toEqual(['B']);
  });
});

describe('shouldHandleCanvasShortcut', () => {
  it('keeps canvas shortcuts out of source and other typing targets', () => {
    expect(shouldHandleCanvasShortcut(true, true, false)).toBe(true);
    expect(shouldHandleCanvasShortcut(false, false, false)).toBe(false);
    expect(shouldHandleCanvasShortcut(true, true, true)).toBe(false);
  });
});

describe('shouldHandleCanvasSingleKeyShortcut', () => {
  it('accepts canvas descendants while excluding typing and toolbar ownership', () => {
    expect(shouldHandleCanvasSingleKeyShortcut(true, true, false, false)).toBe(true);
    expect(shouldHandleCanvasSingleKeyShortcut(false, true, false, false)).toBe(false);
    expect(shouldHandleCanvasSingleKeyShortcut(true, false, false, false)).toBe(false);
    expect(shouldHandleCanvasSingleKeyShortcut(true, true, true, false)).toBe(false);
    expect(shouldHandleCanvasSingleKeyShortcut(true, true, false, true)).toBe(false);
  });
});

describe('shouldHandleGlobalCanvasRenameShortcut', () => {
  it('leaves F2 with a focused node or section instead of renaming a different selected node', () => {
    expect(shouldHandleGlobalCanvasRenameShortcut(false, true)).toBe(false);
    expect(shouldHandleGlobalCanvasRenameShortcut(true, false)).toBe(false);
    expect(shouldHandleGlobalCanvasRenameShortcut(false, false)).toBe(true);
  });
});

describe('getCanvasHistoryShortcut', () => {
  it('maps Ctrl/Cmd+Z and Ctrl/Cmd+Shift+Z without taking non-modifier Z', () => {
    expect(getCanvasHistoryShortcut('z', true, false)).toBe('undo');
    expect(getCanvasHistoryShortcut('Z', true, true)).toBe('redo');
    expect(getCanvasHistoryShortcut('z', false, false)).toBeNull();
    expect(getCanvasHistoryShortcut('y', true, false)).toBeNull();
  });
});

describe('shouldRestoreCanvasFocusAfterPaste', () => {
  it('restores repeated-paste focus only while no external surface owns it', () => {
    expect(shouldRestoreCanvasFocusAfterPaste(true, false)).toBe(true);
    expect(shouldRestoreCanvasFocusAfterPaste(false, true)).toBe(true);
    expect(shouldRestoreCanvasFocusAfterPaste(false, false)).toBe(false);
  });
});

describe('shouldEnableCanvasMarquee', () => {
  it('keeps drag selection desktop-only without changing touch click selection', () => {
    expect(shouldEnableCanvasMarquee(true, 'select', false)).toBe(true);
    expect(shouldEnableCanvasMarquee(true, 'select', true)).toBe(false);
    expect(shouldEnableCanvasMarquee(true, 'connect', false)).toBe(false);
    expect(shouldEnableCanvasMarquee(false, 'select', false)).toBe(false);
  });
});

describe('getFlowEdgePresentation', () => {
  it.each(['arrow_circle', 'arrow_cross'] as const)('uses authored stroke color for %s markers', (type) => {
    const link: DiagramLink = {
      length: 1,
      source: 'Browser',
      stroke: 'normal',
      target: 'API',
      type,
    };

    const presentation = getFlowEdgePresentation(link, { stroke: '#d9480f' });

    expect(presentation.markerEnd).toBe(getCanvasEdgeMarker(type, '#d9480f').id);
    expect(presentation.style?.stroke).toBe('#d9480f');
  });
});
