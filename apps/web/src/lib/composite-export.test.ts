import { describe, expect, it, vi } from 'vitest';
import { createCompositeSvg, sanitizeMermaidSvg } from './composite-export';

const mermaid = '<svg viewBox="0 0 200 100"><script>alert(1)</script><a href="https://evil.test"><text>link</text></a><rect fill="#fff" filter="url(data:text/plain,x)" mask="url(https://evil.test/mask)" clip-path="url(https://evil.test/clip)" marker-end="url(https://evil.test/marker)" cursor="url(data:text/plain,x)" stroke="url(https://evil.test/stroke)" style="fill:url(https://evil.test/paint)" xlink:href="https://evil.test/ref" onclick="alert(1)" width="100" height="50"/><style>@import url(https://evil.test/a.css)</style></svg>';

describe('composite export', () => {
  it('sanitizes executable/external authored SVG content', () => {
    const safe = sanitizeMermaidSvg(mermaid);
    expect(safe.inner).not.toMatch(/script|onclick|evil|data:|<a|url\(/iu);
    expect(safe.inner).toContain('fill="#fff"');
    expect(safe.bounds).toEqual({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('applies the same URL policy through the no-DOMParser fallback', () => {
    vi.stubGlobal('DOMParser', undefined);
    try {
      const safe = sanitizeMermaidSvg('<svg viewBox="0 0 10 10"><path fill="#123" filter="url(https://evil.test/filter)" marker-end="url(#local)" style="stroke:url(data:text/plain,x)"/></svg>');
      expect(safe.inner).toContain('fill="#123"');
      expect(safe.inner).toContain('marker-end="url(#local)"');
      expect(safe.inner).not.toMatch(/evil|data:/iu);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('uses only visible export-enabled layers and never leaks private annotation metadata', () => {
    const svg = createCompositeSvg({
      mermaidSvg: mermaid,
      theme: 'dark',
      scene: {
        version: 1, diagram_id: 'main',
        layers: [
          { id: 'default', name: 'Default', order_key: 'a', visible: true, locked: false, export: true },
          { id: 'hidden', name: 'Hidden', order_key: 'b', visible: false, locked: false, export: true },
        ],
        objects: [
          { id: 'private-note', kind: 'annotation.sticky', version: 1, order_key: 'a', layer: 'default', geometry: { x: 10, y: 10, width: 80, height: 50, rotation: 0 }, style: {}, metadata: { export: 'arielcharts-only', secret: 'do-not-export' }, payload: {}, body: 'private note' },
          { id: 'ink', kind: 'ink.stroke', version: 1, order_key: 'b', layer: 'default', geometry: { x: 10, y: 10, width: 20, height: 20, rotation: 0 }, style: { color: '#2563eb', width: 2, opacity: 1 }, metadata: { export: 'composite-export' }, payload: { mode: 'pen', composite_export: true, points: [{ x: 10, y: 10 }, { x: 30, y: 30 }] } },
          { id: 'hidden-shape', kind: 'shape.rectangle', version: 1, order_key: 'c', layer: 'hidden', geometry: { x: 1000, y: 1000, width: 50, height: 50, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'hidden' },
          { id: 'arrow', kind: 'shape.arrow', version: 1, order_key: 'd', layer: 'default', geometry: { x: 40, y: 45, width: 90, height: 10, rotation: 28 }, style: { color: '#111827', width: 4, fill: 'url(https://evil.test/paint)' }, metadata: { export: 'composite-export' }, payload: {}, body: '' },
        ],
      },
    });
    expect(svg).toContain('<polyline'); expect(svg).toContain('marker-end="url(#arielcharts-arrowhead)"'); expect(svg).toContain('rotate(28'); expect(svg).not.toContain('private note'); expect(svg).not.toContain('do-not-export'); expect(svg).not.toContain('hidden-shape'); expect(svg).not.toMatch(/script|evil|onclick|data:/iu);
  });

  it('retains only safe local marker references and rejects oversized export geometry', () => {
    const safe = sanitizeMermaidSvg('<svg viewBox="0 0 50 50"><path marker-end="url(#arrow)"/><marker id="arrow"/></svg>');
    expect(safe.inner).toContain('url(#arrow)');
    expect(() => sanitizeMermaidSvg('<svg viewBox="0 0 2000001 20"><rect/></svg>')).toThrow(/safe geometry/u);
  });
});
