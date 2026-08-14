// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSemanticControlsSafeBottom, observeCanvasControlsSafeBottom, observeCanvasToolbarSafeLane } from './diagram-canvas';
import { inspectorCapacityPx } from './overlay-canvas-layer';

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
  constructor(_callback: ResizeObserverCallback) {}
  disconnect() {}
  observe(_target: Element) {}
  unobserve(_target: Element) {}
}

afterEach(() => {
  document.body.replaceChildren();
  TestMutationObserver.instances = [];
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

  it('republishes the visible recovery rail without making semantic placement observer-driven', () => {
    vi.stubGlobal('MutationObserver', TestMutationObserver);
    vi.stubGlobal('ResizeObserver', TestResizeObserver);

    const shell = document.createElement('div');
    const canvas = document.createElement('div');
    const controls = document.createElement('div');
    shell.append(canvas); canvas.append(controls); document.body.append(shell);
    canvas.getBoundingClientRect = () => ({ bottom: 331, top: 108 }) as DOMRect;
    controls.getBoundingClientRect = () => ({ bottom: 319, top: 265 }) as DOMRect;
    controls.style.display = 'flex';
    controls.style.visibility = 'hidden';

    const stop = observeCanvasControlsSafeBottom(canvas, controls, shell, 8);
    expect(shell.style.getPropertyValue('--canvas-controls-toolbar-safe-bottom')).toBe('0px');
    expect(inspectorCapacityPx(182, 331 - 8)).toBe(140);
    // Semantic panels keep the current toolbar layout reserve synchronously;
    // their placement must not wait for this rendered-rail observer.
    expect(getSemanticControlsSafeBottom(true, 12, 54, 8)).toBe(74);

    controls.style.visibility = 'visible';
    const controlsObserver = TestMutationObserver.instances.find((observer) => observer.observed.some(({ target }) => target === controls));
    expect(controlsObserver).toBeDefined();
    controlsObserver!.trigger();
    // The writer is synchronous with the observer callback: no component
    // rerender is required before OverlayCanvasLayer can read this reserve.
    expect(shell.style.getPropertyValue('--canvas-controls-toolbar-safe-bottom')).toBe('74px');
    expect(inspectorCapacityPx(182, 331 - 74)).toBe(74);
    stop();
  });
});
