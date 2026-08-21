// @vitest-environment happy-dom

import React, { act } from 'react';
import type { CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSemanticControlsSafeBottom, observeCanvasToolbarSafeLane } from './diagram-canvas';
import { inspectorCapacityPx } from './overlay-canvas-layer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ObservedTarget = { options: MutationObserverInit; target: Node };

class TestMutationObserver {
  static instances: TestMutationObserver[] = [];
  readonly observed: ObservedTarget[] = [];

  constructor(private readonly callback: MutationCallback) {
    TestMutationObserver.instances.push(this);
  }

  disconnect() {
    this.observed.length = 0;
  }

  observe(target: Node, options: MutationObserverInit) {
    this.observed.push({ options, target });
  }

  trigger() {
    this.callback([], this as unknown as MutationObserver);
  }
}

class TestResizeObserver {
  static instances: TestResizeObserver[] = [];
  readonly observed: Element[] = [];
  readonly unobserved: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) { TestResizeObserver.instances.push(this); }
  disconnect() { this.disconnected = true; this.observed.length = 0; }
  observe(target: Element) { this.observed.push(target); }
  unobserve(target: Element) { this.unobserved.push(target); this.observed.splice(this.observed.indexOf(target), 1); }
  trigger() { this.callback([], this as unknown as ResizeObserver); }
}

afterEach(() => {
  document.body.replaceChildren();
  TestMutationObserver.instances = [];
  TestResizeObserver.instances = [];
  vi.unstubAllGlobals();
});

describe('mounted canvas toolbar safe-lane observer', () => {
  it('republishes for a contextual-row insertion and drops a replaced portal toolbar', () => {
    vi.stubGlobal('MutationObserver', TestMutationObserver);
    vi.stubGlobal('ResizeObserver', TestResizeObserver);

    const diagramPane = document.createElement('div');
    const shell = document.createElement('div');
    const canvas = document.createElement('div');
    diagramPane.append(shell); shell.append(canvas); document.body.append(diagramPane);
    canvas.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;

    let firstBottom = 146;
    const firstToolbar = document.createElement('div');
    firstToolbar.className = 'overlay-icon-toolbar';
    firstToolbar.dataset.overlayDiagramId = 'main';
    firstToolbar.getBoundingClientRect = () => ({ bottom: firstBottom }) as DOMRect;
    document.body.append(firstToolbar);

    const stop = observeCanvasToolbarSafeLane(canvas, 'main', vi.fn());
    expect(canvas.style.getPropertyValue('--overlay-toolbar-safe-top')).toBe('54px');

    const toolbarObserver = TestMutationObserver.instances.find((observer) => observer.observed.some(({ target }) => target === firstToolbar));
    expect(toolbarObserver).toBeDefined();
    firstBottom = 238;
    firstToolbar.append(document.createElement('div'));
    toolbarObserver!.trigger();
    expect(canvas.style.getPropertyValue('--overlay-toolbar-safe-top')).toBe('146px');

    let secondBottom = 178;
    const secondToolbar = document.createElement('div');
    secondToolbar.className = 'overlay-icon-toolbar';
    secondToolbar.dataset.overlayDiagramId = 'main';
    secondToolbar.getBoundingClientRect = () => ({ bottom: secondBottom }) as DOMRect;
    document.body.replaceChild(secondToolbar, firstToolbar);
    const portalObserver = TestMutationObserver.instances.find((observer) => observer.observed.some(({ target }) => target === document.body));
    expect(portalObserver).toBeDefined();
    portalObserver!.trigger();
    expect(toolbarObserver!.observed.map(({ target }) => target)).toEqual([secondToolbar]);
    expect(canvas.style.getPropertyValue('--overlay-toolbar-safe-top')).toBe('86px');

    secondBottom = 218;
    secondToolbar.append(document.createElement('div'));
    toolbarObserver!.trigger();
    expect(canvas.style.getPropertyValue('--overlay-toolbar-safe-top')).toBe('126px');
    stop();
  });

  it('commits the controls safe-bottom declaratively with visibility', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const CanvasShell = ({ controlsVisible }: { controlsVisible: boolean }) => <div
      data-testid="canvas-shell"
      style={{ '--canvas-controls-toolbar-safe-bottom': `${getSemanticControlsSafeBottom(controlsVisible, 12, 54, 8)}px` } as CSSProperties}
    />;
    await act(async () => root.render(<CanvasShell controlsVisible={false} />));
    const shell = host.querySelector<HTMLElement>('[data-testid="canvas-shell"]')!;
    expect(shell.style.getPropertyValue('--canvas-controls-toolbar-safe-bottom')).toBe('0px');
    expect(inspectorCapacityPx(182, 331 - 8)).toBe(140);
    await act(async () => root.render(<CanvasShell controlsVisible />));
    expect(shell.style.getPropertyValue('--canvas-controls-toolbar-safe-bottom')).toBe('74px');
    expect(inspectorCapacityPx(182, 331 - 74)).toBe(74);
    await act(async () => root.unmount());
  });
});
