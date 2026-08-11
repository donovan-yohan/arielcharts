// @vitest-environment happy-dom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { incrementalTextChange, OverlayCanvasLayer, viewportCenterToWorld } from './overlay-canvas-layer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.replaceChildren(); });

describe('OverlayCanvasLayer', () => {
  it('derives one incremental character operation for controlled text edits', () => {
    expect(incrementalTextChange('hello world', 'hello brave world')).toEqual({ index: 6, deleteCount: 0, insert: 'brave ' });
    expect(incrementalTextChange('hello brave world', 'hello world')).toEqual({ index: 6, deleteCount: 6, insert: '' });
  });

  it('creates in visible world space after inverse pan and zoom', () => {
    expect(viewportCenterToWorld(800, 600, { x: -100, y: 50, zoom: 2 })).toEqual({ x: 250, y: 125 });
    expect(viewportCenterToWorld(800, 600, { x: -100, y: 50, zoom: 2 }, { x: 0, y: 0, width: 400, height: 600 })).toEqual({ x: 150, y: 125 });
  });

  it('exposes sticky text and a pointer-independent semantic list without interpreting markup', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [{ id: 'sticky', kind: 'annotation.sticky', version: 1, order_key: 'a', geometry: { x: 1, y: 2, width: 180, height: 120, rotation: 0 }, style: { color: '#fef3a6' }, metadata: {}, payload: {}, body: '<script>alert(1)</script>' }] }} />));
    expect(host.querySelector('script')).toBeNull();
    const textarea = host.querySelector('textarea')!;
    expect(textarea.value).toBe('<script>alert(1)</script>');
    await act(async () => ([...host.querySelectorAll('button')].find(({ textContent }) => textContent === 'Overlay tools') as HTMLButtonElement).click());
    expect(host.querySelector('[aria-label="ArielCharts overlay list"]')?.textContent).toContain('Sticky note: <script>alert(1)</script>');
    expect(host.textContent).toContain('not in Mermaid export');
    await act(async () => root.unmount());
  });
  it('renders a visible orphan and routes common controls through the focused owner', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const callbacks = {
      onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(),
      onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(),
      onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(),
      onBeginComposition: vi.fn(), onCommitComposition: vi.fn(),
    };
    await act(async () => root.render(
      <OverlayCanvasLayer
        {...callbacks}
        diagramId="main"
        readOnly={false}
        scene={{
          version: 1,
          diagram_id: 'main',
          objects: [{
            id: 'note', kind: 'future.note', version: 1, order_key: 'a',
            geometry: { x: 10, y: 20, width: 100, height: 40, rotation: 0 },
            anchor: { mermaid_id: 'missing', offset: { x: 0, y: 0 }, fallback: { x: 50, y: 60 } },
            style: {}, metadata: {}, payload: { label: 'Visible note' },
          }],
        }}
        semanticAnchors={new Map()}
        sessionId="abc123de"
        transform={{ x: 5, y: 10, zoom: 2 }}
      />,
    ));
    const object = host.querySelector<HTMLButtonElement>('[data-testid="overlay-object-note"]')!;
    expect(object.textContent).toContain('Visible note (orphaned)');
    expect(object.style.left).toBe('105px');
    expect(object.style.top).toBe('130px');
    await act(async () => object.click());
    await act(async () => object.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowLeft' })));
    expect(callbacks.onMove).toHaveBeenCalledWith('note', -1, 0);
    await act(async () => ([...host.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Overlay tools') as HTMLButtonElement).click());
    for (const label of ['Move right', 'Bring front', 'Copy overlay', 'Delete overlay']) {
      const button = [...host.querySelectorAll('button')].find((candidate) => candidate.textContent === label) as HTMLButtonElement;
      await act(async () => button.click());
    }
    expect(callbacks.onMove).toHaveBeenCalledWith('note', 16, 0);
    expect(callbacks.onReorder).toHaveBeenCalledWith('note', 'front');
    expect(callbacks.onCopy).toHaveBeenCalledWith(['note']);
    expect(callbacks.onDelete).toHaveBeenCalledWith(['note']);
    await act(async () => root.unmount());
  });

  it('fails newer scenes closed in the visible owner', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(
      <OverlayCanvasLayer
        diagramId="main" sessionId="abc123de" scene={{ version: 2, diagram_id: 'main', objects: [] }}
        transform={{ x: 0, y: 0, zoom: 1 }} semanticAnchors={new Map()} readOnly={false}
        onAdd={vi.fn()} onAnchor={vi.fn()} onCopy={vi.fn()} onDelete={vi.fn()} onMove={vi.fn()} onPaste={vi.fn()} onReorder={vi.fn()} onUndo={vi.fn()} onUpdate={vi.fn()} onEditText={vi.fn()} onDuplicate={vi.fn()} onBeginComposition={vi.fn()} onCommitComposition={vi.fn()}
      />,
    ));
    await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
    expect(host.textContent).toContain('newer overlay scene is read-only');
    expect(([...host.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Add overlay') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => root.unmount());
  });
});
