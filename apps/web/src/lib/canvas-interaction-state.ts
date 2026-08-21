/**
 * Browser-local canvas intent.  This is deliberately shared by Mermaid and
 * overlay renderers: a tool changes the interaction affordance, never the
 * durable diagram or overlay scene by itself.
 */
export type CanvasTool =
  | 'select'
  | 'connect'
  | 'laser'
  | 'text'
  | 'sticky'
  | 'rectangle'
  | 'ellipse'
  | 'diamond'
  | 'line'
  | 'arrow'
  | 'pen'
  | 'highlighter'
  | 'eraser';

export type MermaidCanvasTool = Extract<CanvasTool, 'select' | 'connect' | 'laser'>;
export type OverlayCanvasTool = Exclude<CanvasTool, 'connect' | 'laser'>;

export const CANVAS_SELECTION_PRESERVING_SELECTOR = '[data-canvas-selection-preserving="true"]';

/** Portalled canvas controls are local canvas chrome, not outside click-away targets. */
export function shouldClearCanvasSelectionForPointerTarget(target: EventTarget | null, canvas: HTMLElement | null): boolean {
  if (!(target instanceof Node) || canvas?.contains(target)) return false;
  const element = target instanceof Element ? target : target.parentElement;
  return !element?.closest(CANVAS_SELECTION_PRESERVING_SELECTOR);
}

export function getMermaidCanvasTool(tool: CanvasTool, isFlowchart: boolean): MermaidCanvasTool {
  if (tool === 'connect') return isFlowchart ? tool : 'select';
  return tool === 'laser' ? tool : 'select';
}

export function coerceCanvasToolForRenderer(tool: CanvasTool, isFlowchart: boolean): CanvasTool {
  return tool === 'connect' && !isFlowchart ? 'select' : tool;
}

export function isOverlayPointerTool(tool: CanvasTool): tool is Exclude<OverlayCanvasTool, 'select'> {
  return tool !== 'select' && tool !== 'connect' && tool !== 'laser';
}

export function getCanvasToolCursor(tool: CanvasTool): string {
  switch (tool) {
    case 'select': return 'default';
    case 'connect': return 'crosshair';
    case 'laser': return 'none';
    case 'eraser': return 'cell';
    case 'pen':
    case 'highlighter': return 'crosshair';
    default: return 'copy';
  }
}

/** V and Escape are intentionally global canvas exits, except while typing. */
export function getCanvasToolShortcut(key: string, isTyping: boolean): CanvasTool | null {
  if (isTyping) return null;
  return key === 'Escape' || key.toLowerCase() === 'v' ? 'select' : null;
}
