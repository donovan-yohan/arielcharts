// @vitest-environment happy-dom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { OverlayCanvasLayer } from './overlay-canvas-layer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.replaceChildren(); });

describe('OverlayCanvasLayer', () => {
  it('renders a visible orphan and routes common controls through the focused owner', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const callbacks = {
      onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(),
      onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(),
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
        onAdd={vi.fn()} onAnchor={vi.fn()} onCopy={vi.fn()} onDelete={vi.fn()} onMove={vi.fn()} onPaste={vi.fn()} onReorder={vi.fn()} onUndo={vi.fn()}
      />,
    ));
    await act(async () => (host.querySelector('button') as HTMLButtonElement).click());
    expect(host.textContent).toContain('newer overlay scene is read-only');
    expect(([...host.querySelectorAll('button')].find((candidate) => candidate.textContent === 'Add overlay') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => root.unmount());
  });
});
