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
    expect(host.textContent).toContain('Include ink in composite export');
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

  it('exposes shape, connector, frame, layer, multi-select, and rotate controls as real hit targets', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAddShape: vi.fn(), onAddConnector: vi.fn(), onAddFrame: vi.fn(), onAddLayer: vi.fn(), onUpdateLayer: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onMoveMany: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    const scene = { version: 1 as const, diagram_id: 'main', layers: [{ id: 'default', name: 'Default', order_key: 'a', visible: true, locked: false, export: true }], objects: [
      { id: 'left', kind: 'shape.rectangle', version: 1, order_key: 'a', geometry: { x: 0, y: 0, width: 80, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'Left' },
      { id: 'right', kind: 'shape.ellipse', version: 1, order_key: 'b', geometry: { x: 100, y: 0, width: 80, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'Right' },
    ] };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} scene={scene} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} />));
    const button = (label: string) => [...host.querySelectorAll('button')].find((item) => item.textContent === label) as HTMLButtonElement;
    await act(async () => button('Overlay tools').click());
    await act(async () => button('Rectangle').click());
    expect(callbacks.onAddShape).toHaveBeenCalledWith(expect.any(Object), 'shape.rectangle');
    const listButton = (prefix: string) => [...host.querySelectorAll('aside[aria-label="ArielCharts overlay list"] button')].find((item) => item.textContent?.startsWith(prefix)) as HTMLButtonElement;
    await act(async () => {
      listButton('shape.rectangle: Left').click();
      listButton('shape.ellipse: Right').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    });
    await act(async () => button('Connect selection').click());
    expect(callbacks.onAddConnector).toHaveBeenCalledWith('left', 'right');
    await act(async () => button('Frame selection').click());
    expect(callbacks.onAddFrame).toHaveBeenCalledWith(expect.any(Object), ['left', 'right']);
    await act(async () => listButton('shape.rectangle: Left').click());
    expect(button('Connect selection').disabled).toBe(true);
    await act(async () => button('Rotate 15°').click());
    expect(callbacks.onUpdate).toHaveBeenCalledWith('left', expect.objectContaining({ geometry: expect.objectContaining({ rotation: 15 }) }));
    await act(async () => button('Lock').click());
    expect(callbacks.onUpdateLayer).toHaveBeenCalledWith('default', { locked: true });
    await act(async () => root.unmount());
  });

  it('keeps locked layer content selectable but not editable through visible controls', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} scene={{ version: 1, diagram_id: 'main', layers: [{ id: 'locked', name: 'Locked', order_key: 'a', visible: true, locked: true, export: true }], objects: [{ id: 'shape', kind: 'shape.rectangle', version: 1, order_key: 'a', layer: 'locked', geometry: { x: 0, y: 0, width: 80, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'Locked' }] }} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} />));
    await act(async () => (host.querySelector('[data-testid="overlay-object-shape"]') as HTMLElement).click());
    await act(async () => ([...host.querySelectorAll('button')].find((item) => item.textContent === 'Overlay tools') as HTMLButtonElement).click());
    expect((host.querySelector('textarea') as HTMLTextAreaElement).readOnly).toBe(true);
    expect(([...host.querySelectorAll('button')].find((item) => item.textContent === 'Move right') as HTMLButtonElement).disabled).toBe(true);
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

  it('keeps ink drafts local and clears preview on cancel, tool exit, diagram switch, and unmount', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onAddStroke = vi.fn(); const onInkPreview = vi.fn();
    const props = {
      diagramId: 'main', sessionId: 'abc123de', readOnly: false,
      scene: { version: 1 as const, diagram_id: 'main', objects: [] },
      transform: { x: 0, y: 0, zoom: 1 }, semanticAnchors: new Map(),
      onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn(),
      onAddStroke, onInkPreview,
    };
    const render = async (diagramId = 'main') => act(async () => root.render(<OverlayCanvasLayer {...props} diagramId={diagramId} scene={{ ...props.scene, diagram_id: diagramId }} />));
    const pointer = (surface: HTMLElement, type: string, pointerId: number, x: number, y: number) => {
      const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { button: 0, clientX: x, clientY: y, pointerId, pointerType: 'pen', pressure: 0.5 });
      surface.dispatchEvent(event);
    };
    await render();
    await act(async () => ([...host.querySelectorAll('button')].find((button) => button.textContent === 'Overlay tools') as HTMLButtonElement).click());
    const pen = [...host.querySelectorAll('button')].find((button) => button.textContent === 'Pen') as HTMLButtonElement;
    await act(async () => pen.click());
    const surface = host.querySelector<HTMLElement>('[data-testid="ink-drawing-surface"]')!;
    surface.setPointerCapture = vi.fn();
    const owner = host.querySelector<HTMLElement>('[data-testid="overlay-canvas-owner"]')!;
    owner.getBoundingClientRect = () => ({ bottom: 400, height: 400, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    await act(async () => { pointer(surface, 'pointerdown', 1, 20, 20); pointer(surface, 'pointermove', 1, 80, 60); pointer(surface, 'pointercancel', 1, 80, 60); });
    expect(onAddStroke).not.toHaveBeenCalled();
    expect(onInkPreview).toHaveBeenLastCalledWith(null);
    await act(async () => { pointer(surface, 'pointerdown', 2, 20, 20); pointer(surface, 'pointermove', 2, 80, 60); pen.click(); });
    expect(onAddStroke).not.toHaveBeenCalled();
    expect(onInkPreview).toHaveBeenLastCalledWith(null);
    await act(async () => pen.click());
    const switchedSurface = host.querySelector<HTMLElement>('[data-testid="ink-drawing-surface"]')!;
    switchedSurface.setPointerCapture = vi.fn();
    await act(async () => { pointer(switchedSurface, 'pointerdown', 3, 20, 20); pointer(switchedSurface, 'pointermove', 3, 80, 60); });
    await render('next');
    expect(onAddStroke).not.toHaveBeenCalled();
    expect(onInkPreview).toHaveBeenLastCalledWith(null);
    await act(async () => root.unmount());
    expect(onInkPreview).toHaveBeenLastCalledWith(null);
  });
});
