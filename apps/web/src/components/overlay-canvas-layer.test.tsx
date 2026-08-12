// @vitest-environment happy-dom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { incrementalTextChange, OverlayCanvasLayer, syncCompactErrorToolbarState, syncOverlayToolbarSafeTop, viewportCenterToWorld } from './overlay-canvas-layer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('OverlayCanvasLayer', () => {
  it('derives one incremental character operation for controlled text edits', () => {
    expect(incrementalTextChange('hello world', 'hello brave world')).toEqual({ index: 6, deleteCount: 0, insert: 'brave ' });
    expect(incrementalTextChange('hello brave world', 'hello world')).toEqual({ index: 6, deleteCount: 6, insert: '' });
  });

  it('creates in visible world space after inverse pan and zoom', () => {
    expect(viewportCenterToWorld(800, 600, { x: -100, y: 50, zoom: 2 })).toEqual({ x: 250, y: 125 });
    expect(viewportCenterToWorld(800, 600, { x: -100, y: 50, zoom: 2 }, { x: 0, y: 0, width: 400, height: 600 })).toEqual({ x: 150, y: 125 });
  });

  it('updates compact error mode once per real transition without observing its own marker', () => {
    const pane = document.createElement('div');
    const markerMutations: MutationRecord[] = [];
    const observer = new MutationObserver((records) => markerMutations.push(...records));
    observer.observe(pane, { childList: true, subtree: true });

    expect(syncCompactErrorToolbarState(pane, true)).toBe(true);
    expect(pane.dataset.overlayToolbarErrorCompact).toBe('true');
    expect(syncCompactErrorToolbarState(pane, true)).toBe(false);
    expect(markerMutations).toHaveLength(0);

    pane.append(document.createElement('div'));
    expect(syncCompactErrorToolbarState(pane, false)).toBe(true);
    expect(pane.dataset.overlayToolbarErrorCompact).toBeUndefined();
    expect(syncCompactErrorToolbarState(pane, false)).toBe(false);
    observer.disconnect();
  });

  it('publishes a measured short-touch toolbar lane only while it is needed', () => {
    const canvas = document.createElement('div');
    expect(syncOverlayToolbarSafeTop(canvas, 74)).toBe(true);
    expect(canvas.dataset.overlayToolbarSafeTop).toBe('true');
    expect(canvas.style.getPropertyValue('--overlay-toolbar-safe-top')).toBe('74px');
    expect(syncOverlayToolbarSafeTop(canvas, 74)).toBe(false);
    expect(syncOverlayToolbarSafeTop(canvas, null)).toBe(true);
    expect(canvas.dataset.overlayToolbarSafeTop).toBeUndefined();
    expect(canvas.style.getPropertyValue('--overlay-toolbar-safe-top')).toBe('');
  });

  it('exposes sticky text and a pointer-independent semantic list without interpreting markup', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [{ id: 'sticky', kind: 'annotation.sticky', version: 1, order_key: 'a', geometry: { x: 1, y: 2, width: 180, height: 120, rotation: 0 }, style: { color: '#fef3a6' }, metadata: {}, payload: {}, body: '<script>alert(1)</script>' }] }} />));
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('<script>alert(1)</script>');
    await act(async () => (document.body.querySelector('[aria-label="Overlay tools"]') as HTMLButtonElement).click());
    expect(document.body.querySelector('[aria-label="ArielCharts overlay list"]')?.textContent).toContain('Sticky note: <script>alert(1)</script>');
    expect(document.body.textContent).toContain('not included in Mermaid source');
    expect(document.body.textContent).toContain('Include ink in composite export');
    await act(async () => root.unmount());
  });
  it('keeps overlay editor chrome hidden until selection and makes the icon strip expandable', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onToolActivate: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn(), onHistoryActionBegin: vi.fn(), onHistoryActionEnd: vi.fn(), onHistoryActionRun: (run: () => void) => run() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} viewport={{ x: 0, y: 40, width: 400, height: 260 }} scene={{ version: 1, diagram_id: 'main', objects: [{ id: 'shape', kind: 'shape.rectangle', version: 1, order_key: 'a', geometry: { x: 1, y: 2, width: 180, height: 120, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'A label' }] }} />));
    expect((document.body.querySelector('[aria-label="Overlay scene controls"]') as HTMLElement).style.top).toBe('52px');
    const object = host.querySelector<HTMLElement>('[data-testid="overlay-object-shape"]')!;
    expect(object.style.border).toBe('0px');
    expect(document.body.querySelector('[aria-label="Delete overlay"]')).toBeNull();
    const more = document.body.querySelector<HTMLButtonElement>('[aria-label="Overlay tools"]')!;
    expect(more.getAttribute('aria-pressed')).toBe('false');
    expect(more.getAttribute('aria-expanded')).toBe('false');
    expect(document.body.querySelector('[aria-label="Pen"]')).toBeNull();
    await act(async () => more.click());
    expect(more.getAttribute('aria-pressed')).toBe('true');
    expect(more.getAttribute('aria-expanded')).toBe('true');
    await act(async () => object.click());
    expect(object.style.border).toBe('2px solid');
    expect(document.body.querySelector('[aria-label="Delete overlay"]')).not.toBeNull();
    const resize = object.querySelector<HTMLElement>('[aria-label="Resize overlay"]')!;
    expect(resize).not.toBeNull();
    const owner = host.querySelector<HTMLElement>('[data-testid="overlay-canvas-owner"]')!;
    owner.getBoundingClientRect = () => ({ bottom: 400, height: 400, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    resize.setPointerCapture = vi.fn();
    const pointer = (type: string, x: number, y: number) => Object.assign(new MouseEvent(type, { bubbles: true, button: 0, cancelable: true, clientX: x, clientY: y }), { pointerId: 2 });
    await act(async () => { resize.dispatchEvent(pointer('pointerdown', 180, 120)); resize.dispatchEvent(pointer('pointermove', 220, 150)); resize.dispatchEvent(pointer('lostpointercapture', 220, 150)); });
    expect(callbacks.onUpdate).toHaveBeenCalledWith('shape', expect.objectContaining({ geometry: expect.objectContaining({ height: 150, width: 220 }) }));
    expect(callbacks.onHistoryActionBegin).toHaveBeenCalledTimes(1);
    expect(callbacks.onHistoryActionEnd).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it('keeps Select and Add unique normally, but exposes them from the compact error palette', async () => {
    const pane = document.createElement('div'); pane.className = 'workspace-diagram-pane'; document.body.append(pane);
    const canvas = document.createElement('div'); canvas.dataset.testid = 'diagram-canvas'; pane.append(canvas);
    const host = document.createElement('div'); canvas.append(host);
    const banner = document.createElement('div'); banner.className = 'error-banner'; pane.append(banner);
    canvas.getBoundingClientRect = () => ({ bottom: 360, height: 360, left: 0, right: 390, top: 0, width: 390, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    banner.getBoundingClientRect = () => ({ bottom: 56, height: 48, left: 64, right: 382, top: 8, width: 318, x: 64, y: 8, toJSON: () => ({}) }) as DOMRect;
    const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    const more = document.body.querySelector<HTMLButtonElement>('[aria-label="Overlay tools"]')!;
    await act(async () => more.click());
    expect(document.body.querySelectorAll('[aria-label="Select overlay tool"]')).toHaveLength(1);
    expect(document.body.querySelectorAll('[aria-label="Add overlay"]')).toHaveLength(1);
    await act(async () => root.unmount());

    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true }));
    const compactRoot = createRoot(host);
    await act(async () => compactRoot.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    const compactToolbar = document.body.querySelector<HTMLElement>('.overlay-icon-toolbar')!;
    expect(compactToolbar.dataset.compactError).toBe('true');
    await act(async () => (document.body.querySelector('[aria-label="Overlay tools"]') as HTMLButtonElement).click());
    const palette = document.body.querySelector<HTMLElement>('.overlay-toolbar-secondary')!;
    expect(palette.querySelector('[aria-label="Select overlay tool"]')).not.toBeNull();
    expect(palette.querySelector('[aria-label="Add overlay"]')).not.toBeNull();
    await act(async () => compactRoot.unmount());
  });
  it('owns overlay undo and select shortcuts outside text editing', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onToolActivate: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [{ id: 'note', kind: 'annotation.text', version: 1, order_key: 'a', geometry: { x: 0, y: 0, width: 80, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'note' }] }} />));
    const controls = document.body.querySelector<HTMLElement>('[data-testid="overlay-controls-owner"]')!;
    const send = (key: string, options: KeyboardEventInit = {}) => controls.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...options }));
    await act(async () => { send('z', { ctrlKey: true }); send('z', { metaKey: true, shiftKey: true }); send('y', { ctrlKey: true }); });
    expect(callbacks.onUndo).toHaveBeenCalledTimes(1); expect(callbacks.onRedo).toHaveBeenCalledTimes(2);
    await act(async () => (document.body.querySelector('[aria-label="Overlay tools"]') as HTMLButtonElement).click());
    await act(async () => (document.body.querySelector('[aria-label="Pen"]') as HTMLButtonElement).click());
    expect(callbacks.onToolActivate).toHaveBeenCalledTimes(1);
    expect((document.body.querySelector('[aria-label="Pen"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    await act(async () => { send('v'); });
    expect((document.body.querySelector('[aria-label="Select overlay tool"]') as HTMLButtonElement).getAttribute('aria-pressed')).toBe('true');
    await act(async () => (host.querySelector('[data-testid="overlay-object-note"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
    const editor = host.querySelector('textarea')!;
    await act(async () => editor.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'z', ctrlKey: true })));
    expect(callbacks.onUndo).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });
  it('keeps line chrome hidden at rest and commits a direct pointer drag only on release', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [{ id: 'line', kind: 'shape.line', version: 1, order_key: 'a', geometry: { x: 20, y: 30, width: 160, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {} }] }} />));
    const owner = host.querySelector<HTMLElement>('[data-testid="overlay-canvas-owner"]')!;
    owner.getBoundingClientRect = () => ({ bottom: 400, height: 400, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const line = host.querySelector<HTMLElement>('[data-testid="overlay-object-line"]')!;
    expect(line.style.border).toBe('0px');
    line.setPointerCapture = vi.fn();
    const pointer = (type: string, x: number, y: number) => Object.assign(new MouseEvent(type, { bubbles: true, button: 0, cancelable: true, clientX: x, clientY: y }), { pointerId: 1 });
    await act(async () => line.dispatchEvent(pointer('pointerdown', 40, 50)));
    expect(line.style.border).toBe('2px solid');
    await act(async () => line.dispatchEvent(pointer('pointermove', 70, 90)));
    expect(callbacks.onMove).not.toHaveBeenCalled();
    await act(async () => line.dispatchEvent(pointer('pointerup', 70, 90)));
    expect(callbacks.onMove).toHaveBeenCalledWith('line', 30, 40);
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
    await act(async () => (document.body.querySelector('[aria-label="Overlay tools"]') as HTMLButtonElement).click());
    for (const label of ['Move right', 'Bring front', 'Copy overlay', 'Delete overlay']) {
      const button = document.body.querySelector(`[aria-label="${label}"]`) as HTMLButtonElement;
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
    const button = (label: string) => [...document.body.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === label || item.textContent === label) as HTMLButtonElement;
    await act(async () => button('Overlay tools').click());
    await act(async () => button('Rectangle').click());
    expect(callbacks.onAddShape).toHaveBeenCalledWith(expect.any(Object), 'shape.rectangle');
    const listButton = (prefix: string) => [...document.body.querySelectorAll('aside[aria-label="ArielCharts overlay list"] button')].find((item) => item.textContent?.startsWith(prefix)) as HTMLButtonElement;
    await act(async () => {
      listButton('shape.rectangle: Left').click();
      listButton('shape.ellipse: Right').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    });
    await act(async () => button('Connect selection').click());
    expect(callbacks.onAddConnector).toHaveBeenCalledWith('left', 'right');
    await act(async () => button('Frame selection').click());
    expect(callbacks.onAddFrame).toHaveBeenCalledWith(expect.any(Object), ['left', 'right']);
    await act(async () => listButton('shape.rectangle: Left').click());
    expect(document.body.querySelector('[aria-label="Connect selection"]')).toBeNull();
    await act(async () => button('Rotate 15°').click());
    expect(callbacks.onUpdate).toHaveBeenCalledWith('left', expect.objectContaining({ geometry: expect.objectContaining({ rotation: 15 }) }));
    await act(async () => button('Lock Default layer').click());
    expect(callbacks.onUpdateLayer).toHaveBeenCalledWith('default', { locked: true });
    await act(async () => root.unmount());
  });

  it('keeps locked layer content selectable but not editable through visible controls', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} scene={{ version: 1, diagram_id: 'main', layers: [{ id: 'locked', name: 'Locked', order_key: 'a', visible: true, locked: true, export: true }], objects: [{ id: 'shape', kind: 'shape.rectangle', version: 1, order_key: 'a', layer: 'locked', geometry: { x: 0, y: 0, width: 80, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'Locked' }] }} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} />));
    await act(async () => (host.querySelector('[data-testid="overlay-object-shape"]') as HTMLElement).click());
    await act(async () => (document.body.querySelector('[aria-label="Overlay tools"]') as HTMLButtonElement).click());
    await act(async () => (host.querySelector('[data-testid="overlay-object-shape"]') as HTMLElement).dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' })));
    expect((host.querySelector('textarea') as HTMLTextAreaElement).readOnly).toBe(true);
    expect(document.body.querySelector('[aria-label="Move right"]')).toBeNull();
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
    await act(async () => (document.body.querySelector('[aria-label="Overlay tools"]') as HTMLButtonElement).click());
    expect(document.body.textContent).toContain('newer overlay scene is read-only');
    expect((document.body.querySelector('[aria-label="Add overlay"]') as HTMLButtonElement).disabled).toBe(true);
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
    await act(async () => (document.body.querySelector('[aria-label="Overlay tools"]') as HTMLButtonElement).click());
    const pen = document.body.querySelector('[aria-label="Pen"]') as HTMLButtonElement;
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
