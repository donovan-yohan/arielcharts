import { describe, expect, it } from 'vitest';
import type { DiagramLink } from '../lib/diagram-mutations';
import { getCanvasEdgeMarker } from '../lib/mermaid-presentation';
import { getCanonicalSelectionAttribute, getFlowEdgePresentation, getNodeClickSelection, getRendererInteractionMode } from './diagram-canvas';

describe('getRendererInteractionMode', () => {
  it('leaves camera ownership separate while static previews clear connect mode', () => {
    expect(getRendererInteractionMode('connect', false)).toBe('select');
    expect(getRendererInteractionMode('connect', true)).toBe('connect');
    expect(getRendererInteractionMode('select', false)).toBe('select');
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

describe('getNodeClickSelection', () => {
  it('keeps ordinary and Shift selection in app-owned click handlers', () => {
    expect(getNodeClickSelection(['A'], 'B', false)).toEqual(['B']);
    expect(getNodeClickSelection(['A'], 'B', true)).toEqual(['A', 'B']);
    expect(getNodeClickSelection(['A', 'B'], 'A', true)).toEqual(['B']);
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
