import { describe, expect, it } from 'vitest';
import {
  getCanvasHandlePaint,
  getCanvasNodePaint,
  getMermaidNodePresentation,
  getMermaidPresentationFromElement,
} from './mermaid-presentation';

describe('getMermaidPresentationFromElement', () => {
  it('projects classDef-like CSS and inline styles for editable flowchart items', () => {
    expect(getMermaidPresentationFromElement({
      classNames: ['node', 'critical'],
      css: ['.critical { fill: #ffec99; stroke: #d9480f; color: #4a2c00; }'],
      style: 'stroke-width: 3px; stroke-dasharray: 6 3',
    })).toEqual({
      fill: '#ffec99',
      stroke: '#d9480f',
      strokeDasharray: '6 3',
      strokeWidth: '3px',
      text: '#4a2c00',
    });
  });

  it('uses a node-specific Mermaid style rule and ignores non-paint values', () => {
    expect(getMermaidPresentationFromElement({
      attributes: { stroke: '#111111' },
      css: ['#flowchart-Gateway-0 { fill: #e7f5ff !important; }'],
      rootId: 'flowchart-Gateway-0',
    })).toEqual({
      fill: '#e7f5ff',
      stroke: '#111111',
      strokeDasharray: undefined,
      strokeWidth: undefined,
      text: undefined,
    });
  });

  it.each(['none', 'transparent'])('preserves authored fill:%s without substituting a fallback', (fill) => {
    const presentation = getMermaidPresentationFromElement({ style: `fill:${fill}` });
    expect(presentation.fill).toBe(fill);
    expect(getCanvasNodePaint(presentation).background).toBe(fill);
  });

  it('keeps unstyled handles neutral until an explicit interaction state', () => {
    expect(getCanvasHandlePaint(false)).toBe('var(--diagram-item-stroke-fallback)');
    expect(getCanvasHandlePaint(true)).toBe('var(--selection)');
  });

  it('keeps Mermaid-owned text color separate from shape fill across app themes', () => {
    const common = {
      classNames: ['node', 'critical'],
      css: [
        '#mermaid-fixture .critical > * { fill: #ffec99 !important; stroke: #d9480f !important; }',
        '#mermaid-fixture .critical tspan { fill: #4a2c00 !important; }',
        'span { fill: #232323; }',
      ],
      rootId: 'flowchart-Browser-0',
    };

    const shape = getMermaidPresentationFromElement({ ...common, style: 'color:#4a2c00', tagName: 'rect' });
    const label = getMermaidPresentationFromElement({ ...common, tagName: 'tspan' });
    const light = getMermaidNodePresentation(shape, [label]);
    const dark = getMermaidNodePresentation(shape, [label]);

    expect(light).toEqual({
      fill: '#ffec99',
      stroke: '#d9480f',
      strokeDasharray: undefined,
      strokeWidth: undefined,
      text: '#4a2c00',
    });
    expect(dark).toEqual(light);

    const childOnly = getMermaidNodePresentation(
      getMermaidPresentationFromElement({ ...common, tagName: 'rect' }),
      [getMermaidPresentationFromElement({ ...common, tagName: 'tspan' })],
    );
    expect(childOnly.text).toBe('#4a2c00');
  });
});
