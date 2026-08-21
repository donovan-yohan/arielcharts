// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { coerceCanvasToolForRenderer, getCanvasToolCursor, getCanvasToolShortcut, getMermaidCanvasTool, isOverlayPointerTool, shouldClearCanvasSelectionForPointerTarget } from './canvas-interaction-state';

describe('canvas interaction state', () => {
  it('keeps browser-local tool intent coherent across Mermaid renderers', () => {
    expect(getMermaidCanvasTool('connect', true)).toBe('connect');
    expect(getMermaidCanvasTool('connect', false)).toBe('select');
    expect(getMermaidCanvasTool('rectangle', true)).toBe('select');
    expect(getMermaidCanvasTool('laser', false)).toBe('laser');
    expect(coerceCanvasToolForRenderer('connect', true)).toBe('connect');
    expect(coerceCanvasToolForRenderer('connect', false)).toBe('select');
  });

  it('reserves V and Escape for returning the editable canvas to select', () => {
    expect(getCanvasToolShortcut('v', false)).toBe('select');
    expect(getCanvasToolShortcut('Escape', false)).toBe('select');
    expect(getCanvasToolShortcut('v', true)).toBeNull();
  });

  it('only places overlay pointer tools over the scene and gives each a cursor', () => {
    expect(isOverlayPointerTool('rectangle')).toBe(true);
    expect(isOverlayPointerTool('laser')).toBe(false);
    expect(getCanvasToolCursor('rectangle')).toBe('copy');
    expect(getCanvasToolCursor('eraser')).toBe('cell');
  });

  it('preserves selection for portalled canvas chrome while unrelated outside targets still clear it', () => {
    const canvas = document.createElement('div');
    const canvasChild = document.createElement('button'); canvas.append(canvasChild);
    const toolbar = document.createElement('div'); toolbar.dataset.canvasSelectionPreserving = 'true';
    const toolbarChild = document.createElement('button'); toolbar.append(toolbarChild);
    const outside = document.createElement('button');
    expect(shouldClearCanvasSelectionForPointerTarget(canvasChild, canvas)).toBe(false);
    expect(shouldClearCanvasSelectionForPointerTarget(toolbarChild, canvas)).toBe(false);
    expect(shouldClearCanvasSelectionForPointerTarget(outside, canvas)).toBe(true);
  });
});
