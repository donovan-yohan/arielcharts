// @vitest-environment happy-dom

import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { incrementalTextChange, inspectorCapacityPx, moveRovingToolbarFocus, OverlayCanvasLayer, resolveOverlayToolbarViewport, viewportCenterToWorld } from './overlay-canvas-layer';

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

  it('reserves a whole rendered pixel below the inspector before the camera lane', () => {
    expect(inspectorCapacityPx(244, 257)).toBe(12);
    expect(inspectorCapacityPx(244, 257.5)).toBe(12);
    expect(inspectorCapacityPx(244.25, 257.5)).toBe(12);
    expect(inspectorCapacityPx(244, 244.9)).toBe(0);
  });

  it('uses a complete canvas-local fallback for transient unusable toolbar viewports', () => {
    expect(resolveOverlayToolbarViewport({ height: 1, width: 1, x: 612, y: 444 }, 844, 223)).toEqual({ height: 223, width: 844, x: 0, y: 0 });
    expect(resolveOverlayToolbarViewport({ height: Number.NaN, width: 400, x: 12, y: 18 }, 844, 223)).toEqual({ height: 223, width: 844, x: 0, y: 0 });
    expect(resolveOverlayToolbarViewport({ height: 100, width: 400, x: 12, y: 18 }, 844, 223)).toEqual({ height: 100, width: 400, x: 12, y: 18 });
  });

  it('consumes onboarding actions through its real creation and edit paths', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const complete = vi.fn(); const editComplete = vi.fn();
    const callbacks = { onAdd: vi.fn(() => 'sticky'), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    const request = { id: 1, action: 'sticky' as const };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" onOnboardingRequestComplete={complete} onboardingRequest={request} readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    expect(callbacks.onAdd).toHaveBeenCalledWith(expect.objectContaining({ x: expect.any(Number), y: expect.any(Number) }), 'annotation.sticky');
    expect(complete).toHaveBeenCalledWith(1, 'sticky');
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" onRequestedTextEditComplete={editComplete} readOnly={false} requestedTextEditId="sticky" semanticAnchors={new Map()} sessionId="abc123de" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [{ id: 'sticky', kind: 'annotation.sticky', version: 1, order_key: 'a', geometry: { x: 1, y: 2, width: 180, height: 120, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: '' }] }} />));
    expect(host.querySelector<HTMLTextAreaElement>('[data-testid="overlay-object-sticky"] textarea')).not.toBeNull();
    expect(editComplete).toHaveBeenCalledWith('sticky');
    await act(async () => root.unmount());
  });

  it('moves focus to the usable drawing surface for a pen onboarding request', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const complete = vi.fn();
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn(), onToolActivate: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" onOnboardingRequestComplete={complete} onboardingRequest={{ id: 2, action: 'pen' }} readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
    const surface = host.querySelector<HTMLElement>('[data-testid="ink-drawing-surface"]')!;
    expect(surface).not.toBeNull();
    expect(surface.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(surface);
    expect(complete).toHaveBeenCalledWith(2);
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" onOnboardingRequestComplete={complete} onboardingRequest={{ id: 3, action: 'pen' }} readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    expect(document.activeElement).toBe(surface);
    expect(complete).toHaveBeenCalledWith(3);
    expect(complete).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });

  it('identifies its portalled toolbar by diagram without owning semantic layout state', () => {
    const source = readFileSync('src/components/overlay-canvas-layer.tsx', 'utf8');
    expect(source).toContain('data-overlay-diagram-id={props.diagramId}');
    expect(source).not.toContain('syncOverlayToolbarSafeTop');
  });

  it('exposes sticky text and a pointer-independent semantic list without interpreting markup', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [{ id: 'sticky', kind: 'annotation.sticky', version: 1, order_key: 'a', geometry: { x: 1, y: 2, width: 180, height: 120, rotation: 0 }, style: { color: '#fef3a6' }, metadata: {}, payload: {}, body: '<script>alert(1)</script>' }] }} />));
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('<script>alert(1)</script>');
    await act(async () => (document.body.querySelector('[aria-label="Objects and layers"]') as HTMLButtonElement).click());
    expect(document.body.querySelector('[aria-label="ArielCharts overlay list"]')?.textContent).toContain('Sticky note: <script>alert(1)</script>');
    expect(document.body.textContent).toContain('not included in Mermaid source');
    expect(document.body.textContent).toContain('Include ink in composite export');
    await act(async () => root.unmount());
  });
  it('keeps overlay editor chrome hidden until selection while keeping primary tools directly available', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onToolActivate: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn(), onHistoryActionBegin: vi.fn(), onHistoryActionEnd: vi.fn(), onHistoryActionRun: (run: () => void) => run() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} viewport={{ x: 0, y: 40, width: 400, height: 260 }} scene={{ version: 1, diagram_id: 'main', objects: [{ id: 'shape', kind: 'shape.rectangle', version: 1, order_key: 'a', geometry: { x: 1, y: 2, width: 180, height: 120, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'A label' }] }} />));
    expect((document.body.querySelector('[aria-label="Overlay scene controls"]') as HTMLElement).style.top).toBe('52px');
    const object = host.querySelector<HTMLElement>('[data-testid="overlay-object-shape"]')!;
    expect(object.style.border).toBe('0px');
    expect(document.body.querySelector('[aria-label="Delete overlay"]')).toBeNull();
    expect(document.body.querySelector('[aria-label="Overlay tools"]')).toBeNull();
    expect(document.body.querySelector('[aria-label="More overlay tools"]')).toBeNull();
    for (const label of ['Select overlay tool', 'Text', 'Sticky note', 'Rectangle', 'Ellipse', 'Diamond', 'Line', 'Arrow', 'Pen', 'Highlighter', 'Erase stroke', 'Undo overlay', 'Redo overlay']) {
      expect(document.body.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    }
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

  it('keeps the full direct strip available in compact error layouts', async () => {
    const pane = document.createElement('div'); pane.className = 'workspace-diagram-pane'; document.body.append(pane);
    const canvas = document.createElement('div'); canvas.dataset.testid = 'diagram-canvas'; pane.append(canvas);
    const host = document.createElement('div'); canvas.append(host);
    const banner = document.createElement('div'); banner.className = 'error-banner'; pane.append(banner);
    canvas.getBoundingClientRect = () => ({ bottom: 360, height: 360, left: 0, right: 390, top: 0, width: 390, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    banner.getBoundingClientRect = () => ({ bottom: 56, height: 48, left: 64, right: 382, top: 8, width: 318, x: 64, y: 8, toJSON: () => ({}) }) as DOMRect;
    const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    expect(document.body.querySelectorAll('[aria-label="Select overlay tool"]')).toHaveLength(1);
    expect(document.body.querySelectorAll('[aria-label="Text"]')).toHaveLength(1);
    expect(document.body.querySelector('[aria-label="Pen"]')).not.toBeNull();
    expect(document.body.querySelector('[aria-label="Overlay tools"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it('recomputes an open inspector capacity with the error-shifted toolbar in the same layout frame', async () => {
    const mutationObservers: Array<{ callback: MutationCallback; disconnected: boolean; targets: Node[] }> = [];
    const resizeObservers: Array<{ callback: ResizeObserverCallback; disconnected: boolean; targets: Element[]; unobserved: Element[] }> = [];
    class MutationObserverMock {
      readonly record: { callback: MutationCallback; disconnected: boolean; targets: Node[] };
      constructor(callback: MutationCallback) {
        this.record = { callback, disconnected: false, targets: [] };
        mutationObservers.push(this.record);
      }
      disconnect() { this.record.disconnected = true; }
      observe(target: Node) { this.record.targets.push(target); }
    }
    class ResizeObserverMock {
      readonly record: { callback: ResizeObserverCallback; disconnected: boolean; targets: Element[]; unobserved: Element[] };
      constructor(callback: ResizeObserverCallback) {
        this.record = { callback, disconnected: false, targets: [], unobserved: [] };
        resizeObservers.push(this.record);
      }
      disconnect() { this.record.disconnected = true; }
      observe(target: Element) { this.record.targets.push(target); }
      unobserve(target: Element) { this.record.unobserved.push(target); }
    }
    const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
    const requestFrame = vi.fn((callback: FrameRequestCallback) => { nextFrame += 1; frames.set(nextFrame, callback); return nextFrame; });
    const cancelFrame = vi.fn((frame: number) => { frames.delete(frame); });
    const flushFrames = () => {
      const queued = [...frames.entries()]; frames.clear();
      for (const [, callback] of queued) callback(0);
    };
    vi.stubGlobal('MutationObserver', MutationObserverMock);
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', requestFrame);
    vi.stubGlobal('cancelAnimationFrame', cancelFrame);

    const pane = document.createElement('div'); pane.className = 'workspace-diagram-pane'; document.body.append(pane);
    const canvas = document.createElement('div'); canvas.dataset.testid = 'diagram-canvas'; pane.append(canvas);
    const controls = document.createElement('div'); controls.dataset.testid = 'canvas-controls-toolbar'; canvas.append(controls);
    const host = document.createElement('div'); canvas.append(host);
    canvas.style.setProperty('--canvas-controls-toolbar-safe-bottom', '74px');
    canvas.getBoundingClientRect = () => ({ bottom: 701, height: 593, left: 0, right: 320, top: 108, width: 320, x: 0, y: 108, toJSON: () => ({}) }) as DOMRect;
    controls.getBoundingClientRect = () => ({ bottom: 689, height: 54, left: 120, right: 200, top: 635, width: 80, x: 120, y: 635, toJSON: () => ({}) }) as DOMRect;
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    const root = createRoot(host);
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    await act(async () => flushFrames());

    const toolbar = document.body.querySelector<HTMLElement>('[aria-label="Overlay scene controls"]')!;
    const primary = document.body.querySelector<HTMLElement>('[data-testid="overlay-toolbar-primary"]')!;
    primary.getBoundingClientRect = () => {
      const top = Number.parseFloat(toolbar.style.top) || 120;
      return ({ bottom: top + 54, height: 54, left: 0, right: 320, top, width: 320, x: 0, y: top, toJSON: () => ({}) }) as DOMRect;
    };
    await act(async () => (document.body.querySelector('[aria-label="Objects and layers"]') as HTMLButtonElement).click());
    await act(async () => flushFrames());
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBeGreaterThan(280);

    let errorBottom = 330.78125;
    const banner = document.createElement('div'); banner.className = 'error-banner';
    banner.getBoundingClientRect = () => ({ bottom: errorBottom, height: errorBottom - 108, left: 0, right: 320, top: 108, width: 320, x: 0, y: 108, toJSON: () => ({}) }) as DOMRect;
    pane.append(banner);
    const paneObserver = mutationObservers.find((observer) => !observer.disconnected && observer.targets.includes(pane));
    const geometryObserver = resizeObservers.find((observer) => !observer.disconnected && observer.targets.includes(canvas));
    expect(paneObserver).toBeDefined();
    expect(geometryObserver).toBeDefined();
    await act(async () => {
      paneObserver!.callback([], {} as MutationObserver);
      expect(geometryObserver!.targets).toContain(banner);
      geometryObserver!.callback([], {} as ResizeObserver);
      // Both observers feed one coalesced frame: neither can publish shifted
      // placement with the capacity from the pre-error layout.
      expect(toolbar.style.top).toBe('120px');
      expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBeGreaterThan(280);
      expect(frames.size).toBe(1);
      flushFrames();
    });

    expect(toolbar.style.top).toBe('338.78125px');
    expect(controls.getBoundingClientRect().top).toBe(635);
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBeLessThanOrEqual(226);
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(225);

    // The same banner can resize without a child-list record. Its observed
    // geometry still updates placement and capacity together in one frame.
    errorBottom = 360.78125;
    await act(async () => {
      geometryObserver!.callback([], {} as ResizeObserver);
      expect(toolbar.style.top).toBe('338.78125px');
      expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(225);
      expect(frames.size).toBe(1);
      flushFrames();
    });
    expect(toolbar.style.top).toBe('368.78125px');
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(195);

    pane.removeChild(banner);
    await act(async () => paneObserver!.callback([], {} as MutationObserver));
    expect(geometryObserver!.unobserved).toContain(banner);
    expect(frames.size).toBe(1);
    await act(async () => root.unmount());
    expect(frames.size).toBe(0);
    expect(cancelFrame).toHaveBeenCalled();
    expect(mutationObservers.every((observer) => observer.disconnected)).toBe(true);
    expect(resizeObservers.every((observer) => observer.disconnected)).toBe(true);
  });

  it('keeps an open inspector bound to DiagramCanvas’s camera reserve through a renderer remount', async () => {
    const mutationObservers: Array<{ callback: MutationCallback; disconnected: boolean; targets: Node[] }> = [];
    const resizeObservers: Array<{ callback: ResizeObserverCallback; disconnected: boolean; targets: Element[]; unobserved: Element[] }> = [];
    class MutationObserverMock {
      readonly record: { callback: MutationCallback; disconnected: boolean; targets: Node[] };
      constructor(callback: MutationCallback) { this.record = { callback, disconnected: false, targets: [] }; mutationObservers.push(this.record); }
      disconnect() { this.record.disconnected = true; }
      observe(target: Node) { this.record.targets.push(target); }
    }
    class ResizeObserverMock {
      readonly record: { callback: ResizeObserverCallback; disconnected: boolean; targets: Element[]; unobserved: Element[] };
      constructor(callback: ResizeObserverCallback) { this.record = { callback, disconnected: false, targets: [], unobserved: [] }; resizeObservers.push(this.record); }
      disconnect() { this.record.disconnected = true; }
      observe(target: Element) { this.record.targets.push(target); }
      unobserve(target: Element) { this.record.unobserved.push(target); }
    }
    const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0;
    const flushFrames = () => { const queued = [...frames.entries()]; frames.clear(); for (const [, callback] of queued) callback(0); };
    vi.stubGlobal('MutationObserver', MutationObserverMock);
    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { nextFrame += 1; frames.set(nextFrame, callback); return nextFrame; });
    vi.stubGlobal('cancelAnimationFrame', (frame: number) => { frames.delete(frame); });

    const pane = document.createElement('div'); pane.className = 'workspace-diagram-pane'; document.body.append(pane);
    const canvasStyleHost = document.createElement('div'); canvasStyleHost.className = 'diagram-canvas-shell'; pane.append(canvasStyleHost);
    const canvas = document.createElement('div'); canvas.dataset.testid = 'diagram-canvas'; canvasStyleHost.append(canvas);
    const oldControls = document.createElement('div'); oldControls.dataset.testid = 'canvas-controls-toolbar'; canvas.append(oldControls);
    const host = document.createElement('div'); canvas.append(host);
    canvasStyleHost.style.setProperty('--canvas-controls-toolbar-safe-bottom', '74px');
    expect(getComputedStyle(canvas).getPropertyValue('--canvas-controls-toolbar-safe-bottom')).toBe('');
    const canvasBounds = () => ({ bottom: 331, height: 223, left: 0, right: 844, top: 108, width: 844, x: 0, y: 108, toJSON: () => ({}) }) as DOMRect;
    const controlsBounds = () => ({ bottom: 319, height: 54, left: 586, right: 832, top: 265, width: 246, x: 586, y: 265, toJSON: () => ({}) }) as DOMRect;
    const detachedControlsBounds = () => ({ bottom: 0, height: 0, left: 0, right: 0, top: 0, width: 0, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    let oldControlsAttached = true;
    canvas.getBoundingClientRect = canvasBounds;
    oldControls.getBoundingClientRect = () => oldControlsAttached ? controlsBounds() : detachedControlsBounds();
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    const root = createRoot(host);
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" transform={{ x: 0, y: 0, zoom: 1 }} viewport={{ height: 1, width: 1, x: 612, y: 444 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    await act(async () => flushFrames());
    const toolbar = document.body.querySelector<HTMLElement>('[aria-label="Overlay scene controls"]')!;
    expect(toolbar.style.getPropertyValue('--overlay-toolbar-available-width')).toBe('844px');
    expect(toolbar.style.left).toBe('422px');
    const primary = document.body.querySelector<HTMLElement>('[data-testid="overlay-toolbar-primary"]')!;
    let primaryTop = 120;
    primary.getBoundingClientRect = () => {
      return ({ bottom: primaryTop + 54, height: 54, left: 0, right: 844, top: primaryTop, width: 844, x: 0, y: primaryTop, toJSON: () => ({}) }) as DOMRect;
    };
    await act(async () => (document.body.querySelector('[aria-label="Objects and layers"]') as HTMLButtonElement).click());
    await act(async () => flushFrames());
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(74);

    const geometryObserver = resizeObservers.find((observer) => !observer.disconnected && observer.targets.includes(canvas));
    const canvasObserver = mutationObservers.find((observer) => !observer.disconnected && observer.targets.includes(canvas));
    expect(geometryObserver).toBeDefined();
    expect(canvasObserver).toBeDefined();
    expect(inspectorCapacityPx(182, 323)).toBe(140);
    oldControlsAttached = false;
    canvas.removeChild(oldControls);
    await act(async () => canvasObserver!.callback([], {} as MutationObserver));
    expect(frames.size).toBe(1);
    let replacementControlsOffCanvas = false;
    let replacementControlsTop = 170;
    const newControls = document.createElement('div'); newControls.dataset.testid = 'canvas-controls-toolbar'; newControls.getBoundingClientRect = () => (replacementControlsOffCanvas
      ? { bottom: 97, height: 214, left: -21, right: -11, top: -117, width: 10, x: -21, y: -117, toJSON: () => ({}) }
      : { bottom: replacementControlsTop + 54, height: 54, left: 586, right: 832, top: replacementControlsTop, width: 246, x: 586, y: replacementControlsTop, toJSON: () => ({}) }) as DOMRect; canvas.append(newControls);
    await act(async () => canvasObserver!.callback([], {} as MutationObserver));
    expect(frames.size).toBe(1);
    await act(async () => flushFrames());
    // Replacement controls may be temporarily absent or move while rendering;
    // the inherited DiagramCanvas reserve remains the sole camera-safe bound.
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(74);
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" transform={{ x: 0, y: 0, zoom: 1 }} viewport={{ height: 100, width: 400, x: 110, y: 14 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    await act(async () => flushFrames());
    expect(toolbar.style.getPropertyValue('--overlay-toolbar-available-width')).toBe('400px');
    expect(toolbar.style.left).toBe('310px');
    expect(toolbar.style.top).toBe('134px');
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBeGreaterThan(0);
    // A published zero means there is no current in-canvas camera rail. It
    // remains authoritative even when a stale, visible renderer control exists.
    primaryTop = 134;
    canvasStyleHost.style.setProperty('--canvas-controls-toolbar-safe-bottom', '0px');
    replacementControlsTop = 265;
    const currentCanvasObserver = mutationObservers.find((observer) => !observer.disconnected && observer.targets.includes(canvas));
    expect(currentCanvasObserver).toBeDefined();
    await act(async () => currentCanvasObserver!.callback([], {} as MutationObserver));
    await act(async () => flushFrames());
    const zeroReserveCapacity = Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10);
    expect(zeroReserveCapacity).toBe(126);
    expect(196 + zeroReserveCapacity).toBeLessThanOrEqual(canvasBounds().bottom - 8);
    // Without a published reserve, a legacy visible controls rail remains the
    // fallback source of truth.
    canvasStyleHost.style.removeProperty('--canvas-controls-toolbar-safe-bottom');
    await act(async () => currentCanvasObserver!.callback([], {} as MutationObserver));
    await act(async () => flushFrames());
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(60);
    await act(async () => root.unmount());
    expect(mutationObservers.every((observer) => observer.disconnected)).toBe(true);
    expect(resizeObservers.every((observer) => observer.disconnected)).toBe(true);
  });

  it('uses one tab stop per toolbar and roves primary, contextual, and inspector actions', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView; const scrollIntoView = vi.fn(); HTMLElement.prototype.scrollIntoView = scrollIntoView;
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="primary" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'primary', objects: [{ id: 'shape', kind: 'shape.rectangle', version: 1, order_key: 'a', geometry: { x: 1, y: 2, width: 180, height: 120, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'A label' }] }} />));
    const primary = document.body.querySelector<HTMLElement>('[data-testid="overlay-toolbar-primary"]')!;
    const select = primary.querySelector<HTMLButtonElement>('[aria-label="Select overlay tool"]')!;
    const text = primary.querySelector<HTMLButtonElement>('[aria-label="Text"]')!;
    const inspector = primary.querySelector<HTMLButtonElement>('[aria-label="Objects and layers"]')!;
    expect([...primary.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.tabIndex === 0)).toHaveLength(1);
    select.focus();
    await act(async () => primary.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' })));
    expect(document.activeElement).toBe(text); expect(text.tabIndex).toBe(0); expect(select.tabIndex).toBe(-1);
    text.disabled = true;
    await act(async () => { await Promise.resolve(); });
    expect(select.tabIndex).toBe(0);
    text.remove();
    await act(async () => { await Promise.resolve(); });
    expect(select.tabIndex).toBe(0);
    await act(async () => primary.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'End' })));
    expect(document.activeElement).toBe(inspector); expect(scrollIntoView).toHaveBeenCalled();
    await act(async () => inspector.click());
    expect(inspector.getAttribute('aria-controls')).toBe('overlay-inspector-primary');
    expect(document.getElementById('overlay-inspector-primary')).not.toBeNull();
    const inspectorToolbar = document.body.querySelector<HTMLElement>('[aria-label="Overlay inspector actions"]')!;
    expect(moveRovingToolbarFocus(inspectorToolbar, 'End')).toBe(true);
    expect(document.activeElement).toBe(inspectorToolbar.querySelectorAll('button')[1]);
    const restore = inspectorToolbar.querySelectorAll<HTMLButtonElement>('button')[0]!;
    const paste = inspectorToolbar.querySelectorAll<HTMLButtonElement>('button')[1]!;
    paste.disabled = true;
    await act(async () => { await Promise.resolve(); });
    expect(restore.tabIndex).toBe(0);
    paste.remove();
    await act(async () => { await Promise.resolve(); });
    expect(restore.tabIndex).toBe(0);
    await act(async () => inspector.click());
    expect(document.getElementById('overlay-inspector-primary')).toBeNull();
    await act(async () => (host.querySelector('[data-testid="overlay-object-shape"]') as HTMLElement).click());
    const selectedContext = document.body.querySelector<HTMLElement>('[data-testid="overlay-toolbar-context"]');
    expect(selectedContext).not.toBeNull();
    expect(selectedContext?.getAttribute('role')).toBe('toolbar');
    expect(selectedContext?.getAttribute('aria-label')).toBe('Selected overlay actions');
    expect(selectedContext?.querySelector('[aria-label="Frame selection"]')).not.toBeNull();
    await act(async () => inspector.click());
    expect(document.body.querySelector('[data-testid="overlay-toolbar-context"]')).toBeNull();
    expect(document.getElementById('overlay-inspector-primary')).not.toBeNull();
    await act(async () => inspector.click());
    const context = document.body.querySelector<HTMLElement>('[data-testid="overlay-toolbar-context"]')!;
    expect(context).not.toBeNull();
    expect([...context.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.tabIndex === 0)).toHaveLength(1);
    const frame = context.querySelector<HTMLButtonElement>('[aria-label="Frame selection"]')!;
    const move = context.querySelector<HTMLButtonElement>('[aria-label="Move right"]')!;
    frame.disabled = true;
    await act(async () => { await Promise.resolve(); });
    expect(move.tabIndex).toBe(0);
    move.remove();
    await act(async () => { await Promise.resolve(); });
    expect([...context.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')].filter((button) => button.tabIndex === 0)).toHaveLength(1);
    await act(async () => context.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'End' })));
    expect(document.activeElement).toBe(context.querySelectorAll('button')[context.querySelectorAll('button').length - 1]);
    await act(async () => root.unmount()); HTMLElement.prototype.scrollIntoView = originalScrollIntoView;
  });
  it('owns overlay undo and select shortcuts outside text editing', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onToolActivate: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [{ id: 'note', kind: 'annotation.text', version: 1, order_key: 'a', geometry: { x: 0, y: 0, width: 80, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'note' }] }} />));
    const controls = document.body.querySelector<HTMLElement>('[data-testid="overlay-controls-owner"]')!;
    const send = (key: string, options: KeyboardEventInit = {}) => controls.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...options }));
    await act(async () => { send('z', { ctrlKey: true }); send('z', { metaKey: true, shiftKey: true }); send('y', { ctrlKey: true }); });
    expect(callbacks.onUndo).toHaveBeenCalledTimes(1); expect(callbacks.onRedo).toHaveBeenCalledTimes(2);
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
    await act(async () => button('Rectangle').click());
    expect(callbacks.onAddShape).toHaveBeenCalledWith(expect.any(Object), 'shape.rectangle');
    await act(async () => button('Objects and layers').click());
    const listButton = (prefix: string) => [...document.body.querySelectorAll('aside[aria-label="ArielCharts overlay list"] button')].find((item) => item.textContent?.startsWith(prefix)) as HTMLButtonElement;
    await act(async () => {
      listButton('shape.rectangle: Left').click();
      listButton('shape.ellipse: Right').dispatchEvent(new MouseEvent('click', { bubbles: true, ctrlKey: true }));
    });
    await act(async () => button('Objects and layers').click());
    await act(async () => button('Connect selection').click());
    expect(callbacks.onAddConnector).toHaveBeenCalledWith('left', 'right');
    await act(async () => button('Frame selection').click());
    expect(callbacks.onAddFrame).toHaveBeenCalledWith(expect.any(Object), ['left', 'right']);
    await act(async () => button('Objects and layers').click());
    await act(async () => listButton('shape.rectangle: Left').click());
    await act(async () => button('Objects and layers').click());
    expect(document.body.querySelector('[aria-label="Connect selection"]')).toBeNull();
    await act(async () => button('Rotate 15°').click());
    expect(callbacks.onUpdate).toHaveBeenCalledWith('left', expect.objectContaining({ geometry: expect.objectContaining({ rotation: 15 }) }));
    await act(async () => button('Objects and layers').click());
    await act(async () => button('Lock Default layer').click());
    expect(callbacks.onUpdateLayer).toHaveBeenCalledWith('default', { locked: true });
    await act(async () => root.unmount());
  });

  it('keeps locked layer content selectable but not editable through visible controls', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} scene={{ version: 1, diagram_id: 'main', layers: [{ id: 'locked', name: 'Locked', order_key: 'a', visible: true, locked: true, export: true }], objects: [{ id: 'shape', kind: 'shape.rectangle', version: 1, order_key: 'a', layer: 'locked', geometry: { x: 0, y: 0, width: 80, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'Locked' }] }} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} />));
    await act(async () => (host.querySelector('[data-testid="overlay-object-shape"]') as HTMLElement).click());
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
    await act(async () => (document.body.querySelector('[aria-label="Objects and layers"]') as HTMLButtonElement).click());
    expect(document.body.textContent).toContain('newer overlay scene is read-only');
    expect((document.body.querySelector('[aria-label="Text"]') as HTMLButtonElement).disabled).toBe(true);
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
