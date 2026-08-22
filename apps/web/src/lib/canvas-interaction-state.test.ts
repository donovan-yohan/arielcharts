// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import { coerceCanvasToolForRenderer, getCanvasToolCursor, getCanvasToolShortcut, getCanvasToolShortcutLabel, getCanvasToolShortcutSummary, getMermaidCanvasTool, isOverlayPointerTool, shouldClearCanvasSelectionForPointerTarget } from './canvas-interaction-state';

describe('canvas interaction state', () => {
  it('keeps browser-local tool intent coherent across Mermaid renderers', () => {
    expect(getMermaidCanvasTool('connect', true)).toBe('connect');
    expect(getMermaidCanvasTool('connect', false)).toBe('select');
    expect(getMermaidCanvasTool('rectangle', true)).toBe('select');
    expect(getMermaidCanvasTool('laser', false)).toBe('laser');
    expect(coerceCanvasToolForRenderer('connect', true)).toBe('connect');
    expect(coerceCanvasToolForRenderer('connect', false)).toBe('select');
  });

  it('resolves the canonical unmodified canvas tool map and rejects typing and modifiers', () => {
    expect(Object.entries({ v: 'select', h: 'hand', t: 'text', p: 'pen', e: 'eraser', r: 'rectangle', o: 'ellipse', d: 'diamond', a: 'arrow', l: 'line', k: 'laser', c: 'connect' })).toEqual(
      expect.arrayContaining([
        ['v', 'select'], ['h', 'hand'], ['t', 'text'], ['p', 'pen'], ['e', 'eraser'], ['r', 'rectangle'], ['o', 'ellipse'], ['d', 'diamond'], ['a', 'arrow'], ['l', 'line'], ['k', 'laser'], ['c', 'connect'],
      ]),
    );
    for (const [key, tool] of Object.entries({ v: 'select', h: 'hand', t: 'text', p: 'pen', e: 'eraser', r: 'rectangle', o: 'ellipse', d: 'diamond', a: 'arrow', l: 'line', k: 'laser', c: 'connect' })) {
      expect(getCanvasToolShortcut(key, false)).toBe(tool);
      expect(getCanvasToolShortcut(key.toUpperCase(), false)).toBe(tool);
    }
    expect(getCanvasToolShortcut('Escape', false)).toBe('select');
    expect(getCanvasToolShortcut('v', true)).toBeNull();
    expect(getCanvasToolShortcut('v', false, true)).toBeNull();
    expect(getCanvasToolShortcutLabel('line')).toBe('L');
    expect(getCanvasToolShortcutSummary(['connect'])).toContain('L Line');
    expect(getCanvasToolShortcutSummary(['connect'])).not.toContain('C Connect');
  });

  it('only places overlay pointer tools over the scene and gives each a cursor', () => {
    expect(isOverlayPointerTool('rectangle')).toBe(true);
    expect(isOverlayPointerTool('laser')).toBe(false);
    expect(isOverlayPointerTool('hand')).toBe(false);
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
