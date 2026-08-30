// @vitest-environment happy-dom

import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { OverlayGeometry, OverlayObjectRecord } from '@arielcharts/shared';
import type { CanvasTool } from '../lib/canvas-interaction-state';
import { getImmediateOverlayInspectorCap, getPlatformShortcutTitle, incrementalTextChange, inspectorCapacityPx, moveRovingToolbarFocus, OverlayCanvasLayer, OVERLAY_TOOLBAR_ANNOTATE_ACTIONS_HEIGHT, OVERLAY_TOOLBAR_AVAILABLE_HEIGHT_BOTTOM_INSET, OVERLAY_TOOLBAR_COLLAPSED_PILL_HEIGHT, OVERLAY_TOOLBAR_PILL_BORDER, OVERLAY_TOOLBAR_PRIMARY_ROW_HEIGHT, OVERLAY_TOOLBAR_SECONDARY_ACTIONS_HEIGHT, OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_CSS_TOP, OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_TOP_FROM_PILL, OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_TOP_OFFSET, OVERLAY_TOOLBAR_STACKED_INNER_GAP, OVERLAY_TOOLBAR_STACKED_INSPECTOR_TOP_FROM_PILL, resolveOverlayInspectorSafeBottomTop, resolveOverlayToolbarViewport, viewportCenterToWorld } from './overlay-canvas-layer';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('OverlayCanvasLayer', () => {
  it('formats modifier titles with the actual platform glyph while preserving action labels', () => {
    vi.stubGlobal('navigator', { platform: 'MacIntel' });
    expect(getPlatformShortcutTitle('Undo Mermaid change', 'Mod+Z')).toBe('Undo Mermaid change — ⌘+Z');
    vi.stubGlobal('navigator', { platform: 'Linux x86_64' });
    expect(getPlatformShortcutTitle('Undo Mermaid change', 'Mod+Z')).toBe('Undo Mermaid change — Ctrl+Z');
  });

  it('hands real pointer selection and keyboard ownership to overlay objects while preserving Shift toggle and Escape bubbling', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onDuplicateMany = vi.fn(() => ['copy-a', 'copy-b']); const onFitSelection = vi.fn(); const onMoveMany = vi.fn();
    const parentKeyDown = vi.fn();
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onMoveMany, onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(() => null), onDuplicateMany, onBeginComposition: vi.fn(), onCommitComposition: vi.fn(), onFitSelection };
    const object = (id: string, metadata = {}, layer?: string): OverlayObjectRecord => ({ id, kind: 'shape.rectangle', version: 1, order_key: id, geometry: { x: id === 'a' ? 10 : 60, y: 20, width: 30, height: 40, rotation: 0 }, style: {}, metadata, payload: {}, body: '', layer });
    await act(async () => root.render(<div onKeyDown={parentKeyDown}><OverlayCanvasLayer {...callbacks} diagramId="main" readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" tool="select" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', layers: [{ id: 'hidden', name: 'Hidden', order_key: 'z', visible: false, locked: false, export: true }], objects: [object('a'), object('b'), object('locked', { locked: true }), object('hidden', {}, 'hidden')] }} /></div>));
    const owner = host.querySelector<HTMLElement>('[data-testid="overlay-canvas-owner"]')!;
    owner.getBoundingClientRect = () => ({ bottom: 400, height: 400, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const a = host.querySelector<HTMLElement>('[data-testid="overlay-object-a"]')!; const b = host.querySelector<HTMLElement>('[data-testid="overlay-object-b"]')!;
    a.setPointerCapture = vi.fn(); b.setPointerCapture = vi.fn();
    const pointer = (shiftKey = false) => Object.assign(new MouseEvent('pointerdown', { bubbles: true, button: 0, cancelable: true, clientX: 30, clientY: 40, shiftKey }), { pointerId: shiftKey ? 2 : 1 });

    await act(async () => a.dispatchEvent(pointer()));
    expect(document.activeElement).toBe(a); expect(owner.contains(document.activeElement)).toBe(true);
    await act(async () => b.dispatchEvent(pointer(true)));
    expect(document.activeElement).toBe(b); expect(owner.contains(document.activeElement)).toBe(true);
    await act(async () => b.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' })));
    expect(onMoveMany).toHaveBeenCalledWith(['a', 'b'], 1, 0);

    await act(async () => b.dispatchEvent(pointer(true)));
    expect(a.getAttribute('data-selected')).toBe('true'); expect(b.getAttribute('data-selected')).toBeNull();
    await act(async () => b.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Backspace' })));
    expect(callbacks.onDelete).toHaveBeenLastCalledWith(['a']);
    await act(async () => b.dispatchEvent(pointer(true)));
    await act(async () => b.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'Digit2', key: '@', shiftKey: true })));
    expect(onFitSelection).toHaveBeenCalledWith(expect.objectContaining({ x: 10, y: 20, width: 80, height: 40 }));
    await act(async () => b.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key: 'd' })));
    expect(onDuplicateMany).toHaveBeenCalledWith(['a', 'b']);
    await act(async () => b.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key: 'a' })));
    await act(async () => b.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Backspace' })));
    expect(callbacks.onDelete).toHaveBeenLastCalledWith(['a', 'b']);
    await act(async () => b.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })));
    expect(parentKeyDown).toHaveBeenCalled(); expect(host.querySelector('[data-selected="true"]')).toBeNull();
    await act(async () => root.unmount());
  });

  it('selects visible unlocked overlays with Mod+A regardless of the active drawing tool', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onDuplicate = vi.fn(() => null);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate, onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    const object = (id: string): OverlayObjectRecord => ({ id, kind: 'shape.rectangle', version: 1, order_key: id, geometry: { x: 10, y: 20, width: 30, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: '' });
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" tool="rectangle" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [object('a'), object('b')] }} />));
    const owner = host.querySelector<HTMLElement>('[data-testid="overlay-canvas-owner"]')!;
    await act(async () => owner.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key: 'a' })));
    await act(async () => owner.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key: 'd' })));
    expect(onDuplicate).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });

  it('clears overlay selection for Escape and V while preserving the outer Escape path', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const parentKeyDown = vi.fn(); const onToolChange = vi.fn();
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(() => null), onBeginComposition: vi.fn(), onCommitComposition: vi.fn(), onToolChange };
    const shape: OverlayObjectRecord = { id: 'shape', kind: 'shape.rectangle', version: 1, order_key: 'a', geometry: { x: 1, y: 2, width: 100, height: 60, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'Text' };
    await act(async () => root.render(<div onKeyDown={parentKeyDown}><OverlayCanvasLayer {...callbacks} diagramId="main" readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" tool="select" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [shape] }} /></div>));
    const object = host.querySelector<HTMLElement>('[data-testid="overlay-object-shape"]')!;
    const owner = host.querySelector<HTMLElement>('[data-testid="overlay-canvas-owner"]')!;
    await act(async () => object.click());
    expect(object.getAttribute('data-selected')).toBe('true');
    await act(async () => owner.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })));
    expect(parentKeyDown).toHaveBeenCalled();
    expect(object.getAttribute('data-selected')).toBeNull();
    expect(onToolChange).toHaveBeenCalledTimes(1);
    await act(async () => object.click());
    await act(async () => owner.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'v' })));
    expect(object.getAttribute('data-selected')).toBeNull();
    expect(onToolChange).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });

  it('fits an anchored overlay from its rendered world bounds', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onFitSelection = vi.fn();
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(() => null), onBeginComposition: vi.fn(), onCommitComposition: vi.fn(), onFitSelection };
    const anchored: OverlayObjectRecord = { id: 'anchored', kind: 'shape.rectangle', version: 1, order_key: 'a', geometry: { x: 5, y: 7, width: 30, height: 40, rotation: 0 }, anchor: { mermaid_id: 'node-1', offset: { x: 4, y: 6 }, fallback: { x: 5, y: 7 } }, style: {}, metadata: {}, payload: {}, body: '' };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" readOnly={false} semanticAnchors={new Map([['node-1', { x: 50, y: 60 }]])} sessionId="abc123de" tool="select" transform={{ x: 100, y: 200, zoom: 2 }} scene={{ version: 1, diagram_id: 'main', objects: [anchored] }} />));
    const object = host.querySelector<HTMLElement>('[data-testid="overlay-object-anchored"]')!;
    const owner = host.querySelector<HTMLElement>('[data-testid="overlay-canvas-owner"]')!;
    await act(async () => object.click());
    await act(async () => owner.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code: 'Digit2', key: '@', shiftKey: true })));
    expect(onFitSelection).toHaveBeenCalledWith(expect.objectContaining({ x: 54, y: 66, width: 30, height: 40 }));
    await act(async () => root.unmount());
  });

  it('does not select, duplicate, or switch tools while the overlay is read-only', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onDuplicate = vi.fn(() => 'copy'); const onToolChange = vi.fn();
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate, onBeginComposition: vi.fn(), onCommitComposition: vi.fn(), onToolChange };
    const shape: OverlayObjectRecord = { id: 'shape', kind: 'shape.rectangle', version: 1, order_key: 'a', geometry: { x: 1, y: 2, width: 100, height: 60, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'Text' };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" readOnly semanticAnchors={new Map()} sessionId="abc123de" tool="select" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [shape] }} />));
    const object = host.querySelector<HTMLElement>('[data-testid="overlay-object-shape"]')!;
    const owner = host.querySelector<HTMLElement>('[data-testid="overlay-canvas-owner"]')!;
    await act(async () => owner.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key: 'a' })));
    await act(async () => owner.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ctrlKey: true, key: 'd' })));
    await act(async () => owner.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'r' })));
    expect(object.getAttribute('data-selected')).toBeNull();
    expect(onDuplicate).not.toHaveBeenCalled();
    expect(onToolChange).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('does not enter Connect from a keyboard shortcut when Mermaid connections are unavailable', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onToolChange = vi.fn();
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(() => null), onBeginComposition: vi.fn(), onCommitComposition: vi.fn(), onToolChange };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} canConnectMermaidNodes={false} diagramId="main" readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" tool="select" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    const owner = host.querySelector<HTMLElement>('[data-testid="overlay-canvas-owner"]')!;
    await act(async () => owner.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'c' })));
    expect(onToolChange).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('keeps textarea Escape and composing keys out of parent canvas history', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const parentKeyDown = vi.fn();
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(() => null), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    const shape: OverlayObjectRecord = { id: 'shape', kind: 'shape.rectangle', version: 1, order_key: 'a', geometry: { x: 1, y: 2, width: 100, height: 60, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'Text' };
    await act(async () => root.render(<div onKeyDown={parentKeyDown}><OverlayCanvasLayer {...callbacks} diagramId="main" readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" tool="select" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [shape] }} /></div>));
    const object = host.querySelector<HTMLElement>('[data-testid="overlay-object-shape"]')!;
    await act(async () => object.click());
    await act(async () => object.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' })));
    const textarea = object.querySelector<HTMLTextAreaElement>('textarea')!;
    parentKeyDown.mockClear();
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Escape' })));
    expect(parentKeyDown).not.toHaveBeenCalled(); expect(callbacks.onUndo).not.toHaveBeenCalled(); expect(object.querySelector('textarea')).toBeNull();
    const composing = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, isComposing: true, key: 'h' });
    await act(async () => object.dispatchEvent(composing));
    expect(callbacks.onUndo).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('keeps an overlay textarea mounted when Escape arrives during IME composition', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(() => null), onBeginComposition: vi.fn(() => null), onCommitComposition: vi.fn() };
    const shape: OverlayObjectRecord = { id: 'shape', kind: 'shape.rectangle', version: 1, order_key: 'a', geometry: { x: 1, y: 2, width: 100, height: 60, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'Text' };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" tool="select" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [shape] }} />));
    const object = host.querySelector<HTMLElement>('[data-testid="overlay-object-shape"]')!;
    await act(async () => object.click());
    await act(async () => object.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'Enter' })));
    const textarea = object.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => textarea.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true, data: 'に' })));
    await act(async () => textarea.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, isComposing: true, key: 'Escape' })));
    expect(object.querySelector('textarea')).toBe(textarea);
    await act(async () => textarea.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'に' })));
    expect(object.querySelector('textarea')).toBe(textarea);
    await act(async () => root.unmount());
  });

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

  it('caps a stale inspector immediately from the synchronous controls reserve', () => {
    expect(OVERLAY_TOOLBAR_PILL_BORDER).toBe(1);
    expect(OVERLAY_TOOLBAR_PRIMARY_ROW_HEIGHT).toBe(52);
    expect(OVERLAY_TOOLBAR_ANNOTATE_ACTIONS_HEIGHT).toBe(54);
    expect(OVERLAY_TOOLBAR_SECONDARY_ACTIONS_HEIGHT).toBe(54);
    expect(OVERLAY_TOOLBAR_STACKED_INNER_GAP).toBe(0);
    expect(OVERLAY_TOOLBAR_COLLAPSED_PILL_HEIGHT).toBe(54);
    // The sidecar is positioned inside the pill's padding box, so its real top
    // is the pill border plus the `top` globals.css gives it.
    expect(OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_CSS_TOP).toBe(62);
    expect(OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_TOP_OFFSET).toBe(8);
    expect(OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_TOP_FROM_PILL).toBe(63);
    expect(OVERLAY_TOOLBAR_STACKED_INSPECTOR_TOP_FROM_PILL).toBe(161);
    expect(getImmediateOverlayInspectorCap(203, 74, true)).toBe(73);
    expect(getImmediateOverlayInspectorCap(300, 74, false)).toBe(72);
    expect(getImmediateOverlayInspectorCap(128, 74, false)).toBe(0);
    expect(getImmediateOverlayInspectorCap(300, 0, false)).toBeNull();
    // The immediate cap must land on the measured capacity rather than
    // double-count the bottom inset availableHeight has already dropped.
    const pillTop = 120;
    const canvasBottom = 420;
    const controlsSafeBottom = 74;
    const availableHeight = canvasBottom - pillTop - OVERLAY_TOOLBAR_AVAILABLE_HEIGHT_BOTTOM_INSET;
    expect(getImmediateOverlayInspectorCap(availableHeight, controlsSafeBottom, true))
      .toBe(inspectorCapacityPx(pillTop + OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_TOP_FROM_PILL, canvasBottom - controlsSafeBottom));
    expect(getImmediateOverlayInspectorCap(availableHeight, controlsSafeBottom, false))
      .toBe(inspectorCapacityPx(pillTop + OVERLAY_TOOLBAR_STACKED_INSPECTOR_TOP_FROM_PILL, canvasBottom - controlsSafeBottom));
  });

  it('uses a positive published reserve first, otherwise only a visible in-canvas controls rail', () => {
    const canvas = { bottom: 331, top: 108 } as Pick<DOMRect, 'bottom' | 'top'>;
    const visible = { bottom: 319, display: 'flex', top: 265, visibility: 'visible' };
    expect(resolveOverlayInspectorSafeBottomTop(canvas, '74px', visible)).toBe(257);
    expect(resolveOverlayInspectorSafeBottomTop(canvas, '0px', visible)).toBe(257);
    expect(resolveOverlayInspectorSafeBottomTop(canvas, '', visible)).toBe(257);
    expect(resolveOverlayInspectorSafeBottomTop(canvas, 'invalid', { ...visible, display: 'none' })).toBe(323);
    expect(resolveOverlayInspectorSafeBottomTop(canvas, '0px', { ...visible, visibility: 'hidden' })).toBe(323);
    expect(resolveOverlayInspectorSafeBottomTop(canvas, '0px', { ...visible, bottom: 97, top: -117 })).toBe(323);
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
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn(), onToolChange: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" onOnboardingRequestComplete={complete} onboardingRequest={{ id: 2, action: 'pen' }} readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" tool="pen" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
    const surface = host.querySelector<HTMLElement>('[data-testid="ink-drawing-surface"]')!;
    expect(surface).not.toBeNull();
    expect(surface.tabIndex).toBe(-1);
    expect(document.activeElement).toBe(surface);
    expect(complete).toHaveBeenCalledWith(2);
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" onOnboardingRequestComplete={complete} onboardingRequest={{ id: 3, action: 'pen' }} readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" tool="pen" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
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

  it('keeps child controls interactive inside the pointer-transparent rail without bubbling to the canvas ancestor', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onCanvasClick = vi.fn(); const onCanvasPointerDown = vi.fn(); const onAddMermaidNode = vi.fn();
    const callbacks = { onAdd: vi.fn(), onAddMermaidNode, onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn(), onToolChange: vi.fn() };
    await act(async () => root.render(<div onClick={onCanvasClick} onPointerDown={onCanvasPointerDown}><OverlayCanvasLayer {...callbacks} diagramId="main" readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" tool="select" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} /></div>));
    const more = document.body.querySelector<HTMLButtonElement>('[aria-label="More canvas tools"]')!;
    await act(async () => more.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
    await act(async () => more.click());
    const connect = document.body.querySelector<HTMLButtonElement>('[aria-label="Connect Mermaid nodes"]')!;
    await act(async () => connect.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
    await act(async () => connect.click());
    const addNode = document.body.querySelector<HTMLButtonElement>('[aria-label="Add flowchart node"]')!;
    await act(async () => addNode.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true, button: 0 })));
    await act(async () => addNode.click());
    expect(onCanvasPointerDown).not.toHaveBeenCalled();
    expect(onCanvasClick).not.toHaveBeenCalled();
    expect(callbacks.onToolChange).toHaveBeenCalledWith('connect');
    // Adding a Mermaid node is a fire action: it never becomes the active tool.
    expect(onAddMermaidNode).toHaveBeenCalledTimes(1);
    expect(callbacks.onToolChange).toHaveBeenCalledTimes(1);
    expect(addNode.getAttribute('aria-pressed')).toBeNull();
    await act(async () => root.render(<div onClick={onCanvasClick} onPointerDown={onCanvasPointerDown}><OverlayCanvasLayer {...callbacks} canConnectMermaidNodes diagramId="main" readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" tool="connect" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} /></div>));
    expect(connect.disabled).toBe(false);
    expect(connect.getAttribute('aria-pressed')).toBe('true');
    expect(addNode.disabled).toBe(false);
    await act(async () => root.render(<div onClick={onCanvasClick} onPointerDown={onCanvasPointerDown}><OverlayCanvasLayer {...callbacks} canConnectMermaidNodes={false} diagramId="main" readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" tool="connect" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} /></div>));
    expect(connect.disabled).toBe(true);
    expect(connect.getAttribute('aria-pressed')).toBe('false');
    expect(addNode.disabled).toBe(true);
    await act(async () => addNode.click());
    expect(onAddMermaidNode).toHaveBeenCalledTimes(1);
    await act(async () => root.unmount());
  });

  it('suppresses the originating touch-drag click beyond the next animation frame without blocking other tools', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onToolChange = vi.fn();
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn(), onToolChange };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" tool="select" transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    await act(async () => (document.body.querySelector('[data-testid="overlay-toolbar-more-toggle"]') as HTMLButtonElement).click());
    const pointer = (type: string, x: number, pointerId: number) => Object.assign(new Event(type, { bubbles: true, cancelable: true }), { button: 0, clientX: x, pointerId, pointerType: 'touch' });
    const click = (pointerId: number) => Object.assign(new MouseEvent('click', { bubbles: true, cancelable: true }), { pointerId });
    for (const [selector, dragged, other, tool, pointerId] of [
      ['[data-testid="overlay-toolbar-annotate-actions"]', 'Diamond', 'Rectangle', 'rectangle', 12],
      ['[data-testid="overlay-toolbar-primary-tools"]', 'Hand tool', 'Select tool', 'select', 22],
      ['.overlay-toolbar-secondary-actions', 'Highlighter', 'Pen', 'pen', 32],
    ] as const) {
      const rail = document.body.querySelector<HTMLElement>(selector)!;
      const draggedButton = rail.querySelector<HTMLButtonElement>(`[aria-label="${dragged}"]`)!;
      const otherButton = rail.querySelector<HTMLButtonElement>(`[aria-label="${other}"]`)!;
      rail.setPointerCapture = vi.fn(); rail.releasePointerCapture = vi.fn(); rail.hasPointerCapture = vi.fn(() => true);
      await act(async () => { draggedButton.dispatchEvent(pointer('pointerdown', 220, pointerId)); draggedButton.dispatchEvent(pointer('pointermove', 160, pointerId)); draggedButton.dispatchEvent(pointer('pointerup', 160, pointerId)); });
      expect(rail.scrollLeft).toBe(60);
      await act(async () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve())));
      await act(async () => draggedButton.dispatchEvent(click(pointerId)));
      expect(onToolChange).not.toHaveBeenCalled();
      await act(async () => otherButton.dispatchEvent(click(pointerId + 1)));
      expect(onToolChange).toHaveBeenLastCalledWith(tool);
      onToolChange.mockClear();
    }
    await act(async () => root.unmount());
  });

  it('exposes sticky text and a pointer-independent semantic list without interpreting markup', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [{ id: 'sticky', kind: 'annotation.sticky', version: 1, order_key: 'a', geometry: { x: 1, y: 2, width: 180, height: 120, rotation: 0 }, style: { color: '#fef3a6' }, metadata: {}, payload: {}, body: '<script>alert(1)</script>' }] }} />));
    expect(host.querySelector('script')).toBeNull();
    expect(host.textContent).toContain('<script>alert(1)</script>');
    await act(async () => (document.body.querySelector('[aria-label="More canvas tools"]') as HTMLButtonElement).click());
    await act(async () => (document.body.querySelector('[aria-label="Objects and layers"]') as HTMLButtonElement).click());
    expect(document.body.querySelector('[aria-label="ArielCharts overlay list"]')?.textContent).toContain('Sticky note: <script>alert(1)</script>');
    expect(document.body.textContent).toContain('not included in Mermaid source');
    expect(document.body.textContent).toContain('Include ink in composite export');
    await act(async () => root.unmount());
  });
  it('keeps overlay editor chrome hidden until selection while keeping direct transform controls on canvas', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onToolChange: vi.fn(), onUpdate: vi.fn(), onTransform: vi.fn(() => 'applied' as const), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} viewport={{ x: 0, y: 40, width: 400, height: 260 }} scene={{ version: 1, diagram_id: 'main', objects: [{ id: 'shape', kind: 'shape.rectangle', version: 1, order_key: 'a', geometry: { x: 1, y: 2, width: 180, height: 120, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'A label' }] }} />));
    expect((document.body.querySelector('[aria-label="Overlay scene controls"]') as HTMLElement).style.top).toBe('52px');
    const object = host.querySelector<HTMLElement>('[data-testid="overlay-object-shape"]')!;
    expect(object.style.border).toBe('0px');
    expect(document.body.querySelector('[aria-label="Delete overlay"]')).toBeNull();
    expect(document.body.querySelector('[aria-label="More canvas tools"]')).not.toBeNull();
    const primaryTools = document.body.querySelector<HTMLElement>('[data-testid="overlay-toolbar-primary-tools"]')!;
    const more = document.body.querySelector<HTMLButtonElement>('[data-testid="overlay-toolbar-more-toggle"]')!;
    expect(primaryTools).not.toBeNull();
    expect(primaryTools.contains(more)).toBe(false);
    expect(more.getAttribute('aria-expanded')).toBe('false');
    for (const label of ['Select tool', 'Hand tool', 'Connect Mermaid nodes', 'Add flowchart node']) {
      expect(primaryTools.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    }
    for (const label of ['Text', 'Sticky note', 'Rectangle', 'Ellipse', 'Diamond', 'Line', 'Arrow']) {
      expect(document.body.querySelector(`[data-testid="overlay-toolbar-primary"] [aria-label="${label}"]`)).toBeNull();
    }
    expect(document.body.querySelectorAll('[data-testid="overlay-toolbar-primary"] button')).toHaveLength(5);
    expect((document.body.querySelector('[data-testid="overlay-toolbar-secondary"]') as HTMLElement).getAttribute('aria-hidden')).toBe('true');
    await act(async () => more.click());
    expect(document.body.querySelector('[data-testid="overlay-toolbar-more-toggle"]')).toBe(more);
    expect(more.getAttribute('aria-expanded')).toBe('true');
    const annotate = document.body.querySelector<HTMLElement>('[data-testid="overlay-toolbar-annotate-actions"]')!;
    expect(annotate.getAttribute('aria-label')).toBe('Annotation and shape tools');
    expect(annotate.getAttribute('role')).toBe('toolbar');
    for (const label of ['Text', 'Sticky note', 'Rectangle', 'Ellipse', 'Diamond', 'Line', 'Arrow']) {
      expect(annotate.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    }
    for (const label of ['Pen', 'Highlighter', 'Erase stroke', 'Undo canvas change', 'Redo canvas change', 'Objects and layers']) {
      expect(document.body.querySelector(`[aria-label="${label}"]`)).not.toBeNull();
    }
    const secondary = document.body.querySelector<HTMLElement>('[data-testid="overlay-toolbar-secondary"]')!;
    const secondaryActions = secondary.querySelector<HTMLElement>('.overlay-toolbar-secondary-actions')!;
    const layers = secondary.querySelector<HTMLButtonElement>('[aria-label="Objects and layers"]')!;
    expect(secondaryActions.contains(layers)).toBe(true);
    await act(async () => layers.click());
    expect(layers.getAttribute('aria-expanded')).toBe('true');
    expect(document.body.querySelector('[aria-label="Collapse more canvas tools"]')).not.toBeNull();
    await act(async () => layers.click());
    await act(async () => object.click());
    expect(object.style.border).toBe('2px solid');
    expect(document.body.querySelector('[aria-label="Delete overlay"]')).not.toBeNull();
    expect(document.body.querySelectorAll('[data-testid^="overlay-resize-"]')).toHaveLength(8);
    const resize = document.body.querySelector<HTMLElement>('[aria-label="Resize overlay se"]')!;
    expect(resize).not.toBeNull();
    expect(document.body.querySelector('[aria-label="Rotate overlay"]')).not.toBeNull();
    const owner = host.querySelector<HTMLElement>('[data-testid="overlay-canvas-owner"]')!;
    owner.getBoundingClientRect = () => ({ bottom: 400, height: 400, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    resize.setPointerCapture = vi.fn();
    const pointer = (type: string, x: number, y: number) => Object.assign(new MouseEvent(type, { bubbles: true, button: 0, cancelable: true, clientX: x, clientY: y }), { pointerId: 2 });
    await act(async () => { resize.dispatchEvent(pointer('pointerdown', 180, 120)); resize.dispatchEvent(pointer('pointermove', 220, 150)); });
    expect(callbacks.onTransform).not.toHaveBeenCalled();
    await act(async () => resize.dispatchEvent(pointer('pointerup', 220, 150)));
    expect(callbacks.onTransform).toHaveBeenCalledTimes(1);
    expect(callbacks.onTransform).toHaveBeenCalledWith('shape', expect.objectContaining({ height: 120, width: 180 }), expect.objectContaining({ height: 150, width: 220 }));
    await act(async () => root.unmount());
  });

  it('only exposes selected, unlocked transform handles and commits one final box, rotation, or line transform', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onTransform = vi.fn<(id: string, expected: OverlayGeometry, geometry: OverlayGeometry) => 'applied' | 'stale'>(() => 'applied');
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onTransform, onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    const shape = { id: 'shape', kind: 'shape.rectangle' as const, version: 1 as const, order_key: 'a', geometry: { x: 20, y: 20, width: 80, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: '' };
    const line = { id: 'line', kind: 'shape.line' as const, version: 1 as const, order_key: 'b', geometry: { x: 20, y: 20, width: 80, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: '' };
    const render = (objects: OverlayObjectRecord[]) => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects }} />);
    await act(async () => render([shape]));
    const owner = host.querySelector<HTMLElement>('[data-testid="overlay-canvas-owner"]')!;
    owner.getBoundingClientRect = () => ({ bottom: 400, height: 400, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const pointer = (type: string, x: number, y: number) => Object.assign(new MouseEvent(type, { bubbles: true, button: 0, cancelable: true, clientX: x, clientY: y }), { pointerId: 7 });
    expect(document.body.querySelector('[data-testid="overlay-box-transform-controls"]')).toBeNull();
    await act(async () => host.querySelector<HTMLElement>('[data-testid="overlay-object-shape"]')!.click());
    const northwest = document.body.querySelector<HTMLElement>('[aria-label="Resize overlay nw"]')!;
    northwest.setPointerCapture = vi.fn();
    await act(async () => { northwest.dispatchEvent(pointer('pointerdown', 20, 20)); northwest.dispatchEvent(pointer('pointermove', 5, 5)); northwest.dispatchEvent(pointer('pointercancel', 5, 5)); });
    expect(callbacks.onTransform).not.toHaveBeenCalled();
    const rotate = document.body.querySelector<HTMLElement>('[aria-label="Rotate overlay"]')!;
    rotate.setPointerCapture = vi.fn();
    onTransform.mockReturnValueOnce('stale');
    await act(async () => { rotate.dispatchEvent(pointer('pointerdown', 60, 0)); rotate.dispatchEvent(pointer('pointermove', 100, 60)); rotate.dispatchEvent(pointer('pointerup', 100, 60)); });
    expect(callbacks.onTransform).toHaveBeenCalledTimes(1);
    expect(callbacks.onTransform.mock.calls[0]?.[2]).toEqual(expect.objectContaining({ rotation: expect.any(Number) }));
    expect(host.querySelector('[data-testid="overlay-transform-status"]')?.textContent).toBe('Could not transform');
    await act(async () => render([{ ...shape, metadata: { locked: true } }]));
    expect(document.body.querySelector('[data-testid="overlay-box-transform-controls"]')).toBeNull();
    await act(async () => render([line]));
    await act(async () => host.querySelector<HTMLElement>('[data-testid="overlay-object-line"]')!.click());
    expect(document.body.querySelectorAll('[aria-label^="Resize line "]')).toHaveLength(2);
    const endpoint = document.body.querySelector<HTMLElement>('[aria-label="Resize line end"]')!;
    endpoint.setPointerCapture = vi.fn();
    await act(async () => { endpoint.dispatchEvent(pointer('pointerdown', 100, 60)); endpoint.dispatchEvent(pointer('pointermove', 120, 80)); endpoint.dispatchEvent(pointer('pointerup', 120, 80)); });
    expect(callbacks.onTransform).toHaveBeenCalledTimes(2);
    expect(callbacks.onTransform.mock.calls[1]?.[2]).toEqual(expect.objectContaining({ width: 100, height: 60 }));
    await act(async () => root.unmount());
  });

  it('keeps object manipulation in select mode and exposes keyboard transform actions', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onTransform = vi.fn<(id: string, expected: OverlayGeometry, geometry: OverlayGeometry) => 'applied'>(() => 'applied');
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onTransform, onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn(), onToolChange: vi.fn() };
    const shape = { id: 'shape', kind: 'shape.diamond' as const, version: 1 as const, order_key: 'a', geometry: { x: 20, y: 20, width: 80, height: 40, rotation: 45 }, style: {}, metadata: {}, payload: { rotation_model: 'absolute' }, body: '' };
    const render = (tool: CanvasTool) => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} tool={tool} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [shape] }} />);
    await act(async () => render('rectangle'));
    await act(async () => host.querySelector<HTMLElement>('[data-testid="overlay-object-shape"]')!.click());
    expect(document.body.querySelector('[data-testid="overlay-box-transform-controls"]')).toBeNull();
    expect(callbacks.onMove).not.toHaveBeenCalled();
    await act(async () => render('select'));
    await act(async () => host.querySelector<HTMLElement>('[data-testid="overlay-object-shape"]')!.click());
    const east = document.body.querySelector<HTMLElement>('[aria-label="Resize overlay e"]')!;
    const rotate = document.body.querySelector<HTMLElement>('[aria-label="Rotate overlay"]')!;
    const owner = host.querySelector<HTMLElement>('[data-testid="overlay-canvas-owner"]')!;
    owner.getBoundingClientRect = () => ({ bottom: 400, height: 400, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    east.setPointerCapture = vi.fn();
    const pointer = (type: string, x: number, y: number) => Object.assign(new MouseEvent(type, { bubbles: true, button: 0, cancelable: true, clientX: x, clientY: y }), { pointerId: 11 });
    await act(async () => { east.dispatchEvent(pointer('pointerdown', 100, 40)); east.dispatchEvent(pointer('pointermove', 110, 40)); });
    expect(onTransform).not.toHaveBeenCalled();
    await act(async () => east.dispatchEvent(pointer('pointerup', 110, 40)));
    expect(onTransform).toHaveBeenCalledTimes(1);
    await act(async () => east.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' })));
    expect(onTransform).toHaveBeenLastCalledWith('shape', shape.geometry, expect.objectContaining({ width: expect.any(Number) }));
    await act(async () => rotate.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight', shiftKey: true })));
    expect(onTransform).toHaveBeenLastCalledWith('shape', shape.geometry, expect.objectContaining({ rotation: 60 }));
    await act(async () => root.unmount());
  });

  it('renders legacy diamonds at their previous visual rotation and transforms from that basis', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onTransform = vi.fn<(id: string, expected: OverlayGeometry, geometry: OverlayGeometry) => 'applied'>(() => 'applied');
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onTransform, onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    const legacy = { id: 'legacy', kind: 'shape.diamond' as const, version: 1 as const, order_key: 'a', geometry: { x: 20, y: 20, width: 80, height: 80, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: '' };
    const absolute = { ...legacy, id: 'absolute', payload: { rotation_model: 'absolute' } };
    const render = (object: OverlayObjectRecord) => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [object] }} />);
    await act(async () => render(legacy));
    const object = host.querySelector<HTMLElement>('[data-testid="overlay-object-legacy"]')!;
    expect(object.style.transform).toBe('rotate(45deg)');
    await act(async () => object.click());
    const east = document.body.querySelector<HTMLElement>('[aria-label="Resize overlay e"]')!;
    await act(async () => east.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowRight' })));
    expect(onTransform).toHaveBeenLastCalledWith('legacy', legacy.geometry, expect.objectContaining({ rotation: 45 }));
    await act(async () => render(absolute));
    expect(host.querySelector<HTMLElement>('[data-testid="overlay-object-absolute"]')!.style.transform).toBe('rotate(0deg)');
    await act(async () => root.unmount());
  });

  it('keeps the stable direct strip available in compact error layouts', async () => {
    const pane = document.createElement('div'); pane.className = 'workspace-diagram-pane'; document.body.append(pane);
    const canvas = document.createElement('div'); canvas.dataset.testid = 'diagram-canvas'; pane.append(canvas);
    const host = document.createElement('div'); canvas.append(host);
    const banner = document.createElement('div'); banner.className = 'error-banner'; pane.append(banner);
    canvas.getBoundingClientRect = () => ({ bottom: 360, height: 360, left: 0, right: 390, top: 0, width: 390, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    banner.getBoundingClientRect = () => ({ bottom: 56, height: 48, left: 64, right: 382, top: 8, width: 318, x: 64, y: 8, toJSON: () => ({}) }) as DOMRect;
    const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    expect(document.body.querySelectorAll('[aria-label="Select tool"]')).toHaveLength(1);
    expect(document.body.querySelectorAll('[aria-label="Text"]')).toHaveLength(1);
    expect((document.body.querySelector('[data-testid="overlay-toolbar-secondary"]') as HTMLElement).getAttribute('aria-hidden')).toBe('true');
    expect(document.body.querySelector('[aria-label="More canvas tools"]')).not.toBeNull();
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
    const measuredInspectorMaxHeight = Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10);
    expect(measuredInspectorMaxHeight).toBeGreaterThan(280);
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} controlsSafeBottom={74} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    const immediateCap = getImmediateOverlayInspectorCap(Number.parseFloat(toolbar.style.getPropertyValue('--overlay-toolbar-available-height')), 74, false);
    expect(immediateCap).not.toBeNull();
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(Math.min(measuredInspectorMaxHeight, immediateCap!));
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} controlsSafeBottom={500} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(0);
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} controlsSafeBottom={0} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(measuredInspectorMaxHeight);

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
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBeLessThanOrEqual(125);
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(124);

    // The same banner can resize without a child-list record. Its observed
    // geometry still updates placement and capacity together in one frame.
    errorBottom = 360.78125;
    await act(async () => {
      geometryObserver!.callback([], {} as ResizeObserver);
      expect(toolbar.style.top).toBe('338.78125px');
      expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(124);
      expect(frames.size).toBe(1);
      flushFrames();
    });
    expect(toolbar.style.top).toBe('368.78125px');
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(94);

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
    const canvasBounds = () => ({ bottom: 431, height: 323, left: 0, right: 844, top: 108, width: 844, x: 0, y: 108, toJSON: () => ({}) }) as DOMRect;
    const controlsBounds = () => ({ bottom: 419, height: 54, left: 586, right: 832, top: 365, width: 246, x: 586, y: 365, toJSON: () => ({}) }) as DOMRect;
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
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(73);

    const geometryObserver = resizeObservers.find((observer) => !observer.disconnected && observer.targets.includes(canvas));
    const canvasObserver = mutationObservers.find((observer) => !observer.disconnected && observer.targets.includes(canvas));
    expect(geometryObserver).toBeDefined();
    expect(canvasObserver).toBeDefined();
    expect(inspectorCapacityPx(282, 423)).toBe(140);
    oldControlsAttached = false;
    canvas.removeChild(oldControls);
    await act(async () => canvasObserver!.callback([{ target: canvas, type: 'childList' } as unknown as MutationRecord], {} as MutationObserver));
    expect(frames.size).toBe(1);
    let replacementControlsOffCanvas = false;
    let replacementControlsTop = 270;
    const newControls = document.createElement('div'); newControls.dataset.testid = 'canvas-controls-toolbar'; newControls.getBoundingClientRect = () => (replacementControlsOffCanvas
      ? { bottom: 97, height: 214, left: -21, right: -11, top: -117, width: 10, x: -21, y: -117, toJSON: () => ({}) }
      : { bottom: replacementControlsTop + 54, height: 54, left: 586, right: 832, top: replacementControlsTop, width: 246, x: 586, y: replacementControlsTop, toJSON: () => ({}) }) as DOMRect; canvas.append(newControls);
    await act(async () => canvasObserver!.callback([], {} as MutationObserver));
    expect(frames.size).toBe(1);
    await act(async () => flushFrames());
    // Replacement controls may be temporarily absent or move while rendering;
    // the inherited DiagramCanvas reserve remains the sole camera-safe bound.
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(73);
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" readOnly={false} semanticAnchors={new Map()} sessionId="abc123de" transform={{ x: 0, y: 0, zoom: 1 }} viewport={{ height: 100, width: 400, x: 110, y: 14 }} scene={{ version: 1, diagram_id: 'main', objects: [] }} />));
    await act(async () => flushFrames());
    expect(toolbar.style.getPropertyValue('--overlay-toolbar-available-width')).toBe('400px');
    expect(toolbar.style.left).toBe('310px');
    expect(toolbar.style.top).toBe('134px');
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBeGreaterThan(0);
    // A published zero is only a lack of reserve. While the existing control
    // is hidden/off-canvas, the inspector uses the canvas fallback.
    primaryTop = 134;
    canvasStyleHost.style.setProperty('--canvas-controls-toolbar-safe-bottom', '0px');
    replacementControlsTop = 365;
    replacementControlsOffCanvas = true;
    newControls.style.visibility = 'hidden';
    const currentCanvasObserver = mutationObservers.find((observer) => !observer.disconnected && observer.targets.includes(canvas));
    const styleHostObserver = mutationObservers.find((observer) => !observer.disconnected && observer.targets.includes(canvasStyleHost));
    expect(currentCanvasObserver).toBeDefined();
    expect(styleHostObserver).toBeDefined();
    await act(async () => currentCanvasObserver!.callback([{ target: newControls, type: 'attributes' } as unknown as MutationRecord], {} as MutationObserver));
    await act(async () => flushFrames());
    const zeroReserveCapacity = Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10);
    expect(zeroReserveCapacity).toBe(125);
    // The existing control becomes visible in-canvas without replacement. Its
    // attribute record schedules one frame, which publishes the narrowed
    // camera-safe inspector capacity before it can overlap the rail.
    replacementControlsOffCanvas = false;
    newControls.style.visibility = 'visible';
    await act(async () => {
      currentCanvasObserver!.callback([{ target: newControls, type: 'attributes' } as unknown as MutationRecord], {} as MutationObserver);
      expect(frames.size).toBe(1);
      flushFrames();
    });
    const visibleZeroReserveCapacity = Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10);
    expect(visibleZeroReserveCapacity).toBe(59);
    expect(OVERLAY_TOOLBAR_STACKED_INSPECTOR_TOP_FROM_PILL + 136 + visibleZeroReserveCapacity).toBeLessThanOrEqual(replacementControlsTop - 8);
    // Hidden, off-canvas, and absent rails restore full canvas capacity.
    newControls.style.display = 'none';
    await act(async () => currentCanvasObserver!.callback([{ target: newControls, type: 'attributes' } as unknown as MutationRecord], {} as MutationObserver));
    await act(async () => flushFrames());
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(125);
    newControls.style.display = 'flex';
    newControls.style.visibility = 'hidden';
    await act(async () => currentCanvasObserver!.callback([{ target: newControls, type: 'attributes' } as unknown as MutationRecord], {} as MutationObserver));
    await act(async () => flushFrames());
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(125);
    newControls.style.visibility = 'visible';
    replacementControlsOffCanvas = true;
    newControls.className = 'off-canvas';
    await act(async () => currentCanvasObserver!.callback([{ target: newControls, type: 'attributes' } as unknown as MutationRecord], {} as MutationObserver));
    await act(async () => flushFrames());
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(125);
    replacementControlsOffCanvas = false;
    newControls.className = '';
    // An absent publication retains a valid live control rail.
    canvasStyleHost.style.removeProperty('--canvas-controls-toolbar-safe-bottom');
    await act(async () => {
      currentCanvasObserver!.callback([{ target: newControls, type: 'attributes' } as unknown as MutationRecord], {} as MutationObserver);
      styleHostObserver!.callback([{ target: canvasStyleHost, type: 'attributes' } as unknown as MutationRecord], {} as MutationObserver);
    });
    await act(async () => flushFrames());
    expect(Number.parseInt(toolbar.style.getPropertyValue('--overlay-toolbar-inspector-max-height'), 10)).toBe(59);
    await act(async () => root.unmount());
    expect(mutationObservers.every((observer) => observer.disconnected)).toBe(true);
    expect(resizeObservers.every((observer) => observer.disconnected)).toBe(true);
  });

  it('uses one tab stop per toolbar and roves primary, contextual, and inspector actions', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAddMermaidNode: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    const originalScrollIntoView = HTMLElement.prototype.scrollIntoView; const scrollIntoView = vi.fn(); HTMLElement.prototype.scrollIntoView = scrollIntoView;
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="primary" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'primary', objects: [{ id: 'shape', kind: 'shape.rectangle', version: 1, order_key: 'a', geometry: { x: 1, y: 2, width: 180, height: 120, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'A label' }] }} />));
    const primary = document.body.querySelector<HTMLElement>('[data-testid="overlay-toolbar-primary"]')!;
    const select = primary.querySelector<HTMLButtonElement>('[aria-label="Select tool"]')!;
    const hand = primary.querySelector<HTMLButtonElement>('[aria-label="Hand tool"]')!;
    const connect = primary.querySelector<HTMLButtonElement>('[aria-label="Connect Mermaid nodes"]')!;
    const addNode = primary.querySelector<HTMLButtonElement>('[aria-label="Add flowchart node"]')!;
    const inspector = primary.querySelector<HTMLButtonElement>('[aria-label="More canvas tools"]')!;
    expect([...primary.querySelectorAll<HTMLButtonElement>('button')].filter((button) => button.tabIndex === 0)).toHaveLength(1);
    select.focus();
    await act(async () => primary.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' })));
    expect(document.activeElement).toBe(hand); expect(hand.tabIndex).toBe(0); expect(select.tabIndex).toBe(-1);
    await act(async () => primary.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' })));
    expect(document.activeElement).toBe(connect); expect(connect.tabIndex).toBe(0);
    await act(async () => primary.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'ArrowRight' })));
    expect(document.activeElement).toBe(addNode); expect(addNode.tabIndex).toBe(0);
    addNode.disabled = true;
    await act(async () => { await Promise.resolve(); });
    expect(select.tabIndex).toBe(0);
    addNode.remove();
    await act(async () => { await Promise.resolve(); });
    expect(select.tabIndex).toBe(0);
    await act(async () => primary.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key: 'End' })));
    expect(document.activeElement).toBe(inspector); expect(scrollIntoView).toHaveBeenCalled();
    await act(async () => inspector.click());
    const layers = document.body.querySelector<HTMLButtonElement>('[aria-label="Objects and layers"]')!;
    expect(layers).not.toBeNull();
    await act(async () => layers.click());
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
    await act(async () => layers.click());
    expect(document.getElementById('overlay-inspector-primary')).toBeNull();
    await act(async () => (host.querySelector('[data-testid="overlay-object-shape"]') as HTMLElement).click());
    const selectedContext = document.body.querySelector<HTMLElement>('[data-testid="overlay-toolbar-context"]');
    expect(selectedContext).not.toBeNull();
    expect(selectedContext?.getAttribute('role')).toBe('toolbar');
    expect(selectedContext?.getAttribute('aria-label')).toBe('Selected overlay actions');
    expect(selectedContext?.querySelector('[aria-label="Frame selection"]')).not.toBeNull();
    await act(async () => layers.click());
    expect(document.body.querySelector('[data-testid="overlay-toolbar-context"]')).toBeNull();
    expect(document.getElementById('overlay-inspector-primary')).not.toBeNull();
    await act(async () => layers.click());
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
    const callbacks = { onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onRedo: vi.fn(), onToolChange: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} scene={{ version: 1, diagram_id: 'main', objects: [{ id: 'note', kind: 'annotation.text', version: 1, order_key: 'a', geometry: { x: 0, y: 0, width: 80, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'note' }] }} />));
    const controls = document.body.querySelector<HTMLElement>('[data-testid="overlay-controls-owner"]')!;
    const send = (key: string, options: KeyboardEventInit = {}) => controls.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key, ...options }));
    await act(async () => { send('z', { ctrlKey: true }); send('z', { metaKey: true, shiftKey: true }); send('y', { ctrlKey: true }); });
    expect(callbacks.onUndo).toHaveBeenCalledTimes(1); expect(callbacks.onRedo).toHaveBeenCalledTimes(2);
    await act(async () => (document.body.querySelector('[aria-label="More canvas tools"]') as HTMLButtonElement).click());
    await act(async () => (document.body.querySelector('[aria-label="Pen"]') as HTMLButtonElement).click());
    expect(callbacks.onToolChange).toHaveBeenCalledWith('pen');
    await act(async () => { send('v'); });
    expect(callbacks.onToolChange).toHaveBeenLastCalledWith('select');
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

  it('exposes shape, connector, frame, layer, multi-select, and direct rotation controls as real hit targets', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const callbacks = { onAdd: vi.fn(), onAddShape: vi.fn(), onAddConnector: vi.fn(), onAddFrame: vi.fn(), onAddLayer: vi.fn(), onUpdateLayer: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onMoveMany: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onToolChange: vi.fn(), onUpdate: vi.fn(), onTransform: vi.fn(() => 'applied' as const), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn() };
    const scene = { version: 1 as const, diagram_id: 'main', layers: [{ id: 'default', name: 'Default', order_key: 'a', visible: true, locked: false, export: true }], objects: [
      { id: 'left', kind: 'shape.rectangle', version: 1, order_key: 'a', geometry: { x: 0, y: 0, width: 80, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'Left' },
      { id: 'right', kind: 'shape.ellipse', version: 1, order_key: 'b', geometry: { x: 100, y: 0, width: 80, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'Right' },
    ] };
    await act(async () => root.render(<OverlayCanvasLayer {...callbacks} diagramId="main" sessionId="abc123de" readOnly={false} scene={scene} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} />));
    const button = (label: string) => [...document.body.querySelectorAll('button')].find((item) => item.getAttribute('aria-label') === label || item.textContent === label) as HTMLButtonElement;
    await act(async () => button('More canvas tools').click());
    await act(async () => button('Rectangle').click());
    expect(callbacks.onToolChange).toHaveBeenCalledWith('rectangle');
    await act(async () => button('Objects and layers').click());
    const listButton = (prefix: string) => [...document.body.querySelectorAll('aside[aria-label="ArielCharts overlay list"] button')].find((item) => item.textContent?.startsWith(prefix)) as HTMLButtonElement;
    await act(async () => {
      listButton('shape.rectangle: Left').click();
      listButton('shape.ellipse: Right').dispatchEvent(new MouseEvent('click', { bubbles: true, shiftKey: true }));
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
    const owner = host.querySelector<HTMLElement>('[data-testid="overlay-canvas-owner"]')!;
    owner.getBoundingClientRect = () => ({ bottom: 400, height: 400, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    const rotate = document.body.querySelector<HTMLElement>('[aria-label="Rotate overlay"]')!;
    rotate.setPointerCapture = vi.fn();
    const pointer = (type: string, x: number, y: number) => Object.assign(new MouseEvent(type, { bubbles: true, button: 0, cancelable: true, clientX: x, clientY: y }), { pointerId: 6 });
    await act(async () => { rotate.dispatchEvent(pointer('pointerdown', 40, -30)); rotate.dispatchEvent(pointer('pointermove', 80, 20)); rotate.dispatchEvent(pointer('pointerup', 80, 20)); });
    expect(callbacks.onTransform).toHaveBeenCalledWith('left', expect.any(Object), expect.objectContaining({ rotation: expect.any(Number) }));
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
    await act(async () => (document.body.querySelector('[aria-label="More canvas tools"]') as HTMLButtonElement).click());
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
    const render = async (diagramId = 'main', tool = 'pen') => act(async () => root.render(<OverlayCanvasLayer {...props} diagramId={diagramId} scene={{ ...props.scene, diagram_id: diagramId }} tool={tool as 'pen' | 'select'} />));
    const pointer = (surface: HTMLElement, type: string, pointerId: number, x: number, y: number) => {
      const event = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { button: 0, clientX: x, clientY: y, pointerId, pointerType: 'pen', pressure: 0.5 });
      surface.dispatchEvent(event);
    };
    await render();
    const surface = host.querySelector<HTMLElement>('[data-testid="ink-drawing-surface"]')!;
    surface.setPointerCapture = vi.fn();
    const owner = host.querySelector<HTMLElement>('[data-testid="overlay-canvas-owner"]')!;
    owner.getBoundingClientRect = () => ({ bottom: 400, height: 400, left: 0, right: 400, top: 0, width: 400, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
    await act(async () => { pointer(surface, 'pointerdown', 1, 20, 20); pointer(surface, 'pointermove', 1, 80, 60); pointer(surface, 'pointercancel', 1, 80, 60); });
    expect(onAddStroke).not.toHaveBeenCalled();
    expect(onInkPreview).toHaveBeenLastCalledWith(null);
    await act(async () => { pointer(surface, 'pointerdown', 2, 20, 20); pointer(surface, 'pointermove', 2, 80, 60); });
    await render('main', 'select');
    expect(onAddStroke).not.toHaveBeenCalled();
    expect(onInkPreview).toHaveBeenLastCalledWith(null);
    await render('main', 'pen');
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

describe('OverlayCanvasLayer requested selection', () => {
  it('applies a selection request once, acknowledges it, and ignores a repeated request id', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onRequestedSelectionComplete = vi.fn();
    const object = (id: string): OverlayObjectRecord => ({ id, kind: 'shape.rectangle', version: 1, order_key: id, geometry: { x: id === 'a' ? 10 : 60, y: 20, width: 30, height: 40, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: '' });
    const props = {
      diagramId: 'main', sessionId: 'abc123de', readOnly: false,
      scene: { version: 1 as const, diagram_id: 'main', objects: [object('a'), object('b')] },
      transform: { x: 0, y: 0, zoom: 1 }, semanticAnchors: new Map(),
      onAdd: vi.fn(), onAnchor: vi.fn(), onCopy: vi.fn(), onDelete: vi.fn(), onMove: vi.fn(), onPaste: vi.fn(), onReorder: vi.fn(), onUndo: vi.fn(), onUpdate: vi.fn(), onEditText: vi.fn(), onDuplicate: vi.fn(), onBeginComposition: vi.fn(), onCommitComposition: vi.fn(),
      onRequestedSelectionComplete,
    };
    const render = (requestedSelection: { id: number; objectIds: readonly string[] } | null) => act(async () => root.render(
      <OverlayCanvasLayer {...props} requestedSelection={requestedSelection} tool="select" />,
    ));
    const selection = () => ['a', 'b'].filter((id) => host.querySelector(`[data-testid="overlay-object-${id}"]`)?.getAttribute('data-selected') === 'true');

    await render(null);
    expect(selection()).toEqual([]);
    expect(onRequestedSelectionComplete).not.toHaveBeenCalled();

    await render({ id: 1, objectIds: ['b'] });
    expect(selection()).toEqual(['b']);
    expect(onRequestedSelectionComplete).toHaveBeenCalledTimes(1);
    expect(onRequestedSelectionComplete).toHaveBeenLastCalledWith(1);

    await render({ id: 1, objectIds: ['a'] });
    expect(selection()).toEqual(['b']);
    expect(onRequestedSelectionComplete).toHaveBeenCalledTimes(1);

    await render({ id: 2, objectIds: ['a', 'b'] });
    expect(selection()).toEqual(['a', 'b']);
    expect(onRequestedSelectionComplete).toHaveBeenCalledTimes(2);
    expect(onRequestedSelectionComplete).toHaveBeenLastCalledWith(2);
    await act(async () => root.unmount());
  });
});
