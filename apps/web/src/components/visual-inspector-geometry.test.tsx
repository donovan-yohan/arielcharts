// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { OverlayCanvasLayer } from './overlay-canvas-layer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it.each([844, 390])('composes a usable short-height inspector with occupied feedback at %ipx and retires placement on close', async (width) => {
  const frames = new Map<number, FrameRequestCallback>(); let nextFrame = 0; let resize: (() => void) | null = null;
  vi.stubGlobal('ResizeObserver', class { constructor(callback: () => void) { resize = callback; } observe() {} unobserve() {} disconnect() {} });
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => { frames.set(++nextFrame, callback); return nextFrame; });
  vi.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => { frames.delete(id); });
  let feedbackBottom = 190;
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this.dataset.testid === 'diagram-canvas') return { x: 0, y: 80, left: 0, top: 80, right: width, bottom: 360, height: 280, width, toJSON() {} };
    if (this.classList.contains('workspace-feedback-stack')) {
      const left = Number.parseFloat(this.style.getPropertyValue('--inspector-feedback-left')) || 12;
      const feedbackWidth = Number.parseFloat(this.style.getPropertyValue('--inspector-feedback-width')) || width - 24;
      const cap = Number.parseFloat(this.style.getPropertyValue('--inspector-feedback-max-height'));
      const height = Math.min(feedbackBottom - 92, Number.isFinite(cap) ? cap : Infinity);
      return { x: left, y: 92, left, top: 92, right: left + feedbackWidth, bottom: 92 + height, height, width: feedbackWidth, toJSON() {} };
    }
    if (this.classList.contains('overlay-toolbar-primary')) return { x: 0, y: 0, left: 0, top: 0, right: width, bottom: 54, height: 54, width, toJSON() {} };
    return { x: 0, y: 0, left: 0, top: 0, right: 0, bottom: 0, height: 0, width: 0, toJSON() {} };
  });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const noop = () => {};
  const flush = async () => { await act(async () => { const pending = [...frames.values()]; frames.clear(); for (const callback of pending) callback(0); }); };
  try {
    await act(async () => root.render(<div className="workspace-diagram-pane"><div className="workspace-feedback-stack"><div role="alert">Exact parse diagnostic.</div><div role="alert">Independent mutation diagnostic.</div></div><div className="diagram-canvas-shell" style={{ '--canvas-controls-toolbar-safe-bottom': '68px' } as React.CSSProperties}><div data-testid="diagram-canvas"><OverlayCanvasLayer diagramId="main" sessionId="local" scene={{ version: 1, diagram_id: 'main', objects: [], layers: [{ id: 'layer', name: 'Populated layer', visible: true, locked: false, export: true, order_key: 'a' }] }} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} viewport={{ x: 0, y: 0, width, height: 280 }} readOnly={false} onAdd={noop} onAnchor={noop} onCopy={noop} onDelete={noop} onMove={noop} onPaste={noop} onReorder={noop} onUndo={noop} onUpdate={noop} onEditText={noop} onDuplicate={() => null} onBeginComposition={() => null} onCommitComposition={noop} /></div></div></div>));
    await flush();
    for (const label of ['More canvas tools', 'Objects and layers']) await act(async () => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
    await flush();
    const inspector = document.querySelector<HTMLElement>('.overlay-toolbar-inspector')!;
    expect(inspector.dataset.sheet).toBe('true');
    const feedback = host.querySelector<HTMLElement>('.workspace-feedback-stack')!;
    const assertComposition = () => {
      const bounds = feedback.getBoundingClientRect();
      const top = Number.parseFloat(inspector.style.top);
      const height = Number.parseFloat(inspector.style.maxHeight);
      expect(height).toBeGreaterThan(100);
      expect(top + height).toBeLessThan(292);
      expect(bounds.bottom).toBeLessThan(292);
      if (width === 844) {
        expect(height).toBeGreaterThanOrEqual(160);
        expect(Number.parseFloat(inspector.style.left) + Number.parseFloat(inspector.style.width)).toBeLessThanOrEqual(bounds.left);
      } else expect(top).toBeGreaterThanOrEqual(bounds.bottom + 8);
    };
    assertComposition();
    expect(inspector.textContent).toContain('Populated layer');
    expect(inspector.querySelector('button[aria-label="Close objects and layers"]')).not.toBeNull();
    expect(inspector.textContent).toContain('Include ink in composite export');
    feedbackBottom = 230; await act(async () => resize?.()); await flush();
    assertComposition();
    await act(async () => inspector.querySelector<HTMLButtonElement>('button[aria-label="Close objects and layers"]')!.click());
    await flush();
    expect(feedback.dataset.inspectorLayout).toBeUndefined();
    expect(feedback.style.getPropertyValue('--inspector-feedback-max-height')).toBe('');
    await act(async () => document.querySelector<HTMLButtonElement>('button[aria-label="Objects and layers"]')!.click()); await flush();
    host.querySelector('.workspace-feedback-stack')!.remove(); await act(async () => resize?.()); await flush();
    expect(Number.parseFloat(document.querySelector<HTMLElement>('.overlay-toolbar-inspector')!.style.top)).toBe(88);
  } finally { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
