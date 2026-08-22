/**
 * Browser-local canvas intent.  This is deliberately shared by Mermaid and
 * overlay renderers: a tool changes the interaction affordance, never the
 * durable diagram or overlay scene by itself.
 */
export type CanvasTool =
  | 'select'
  | 'hand'
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
export type OverlayCanvasTool = Exclude<CanvasTool, 'connect' | 'laser' | 'hand'>;

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
  return tool !== 'select' && tool !== 'connect' && tool !== 'laser' && tool !== 'hand';
}

export function getCanvasToolCursor(tool: CanvasTool): string {
  switch (tool) {
    case 'select': return 'default';
    case 'hand': return 'grab';
    case 'connect': return 'crosshair';
    case 'laser': return 'none';
    case 'eraser': return 'cell';
    case 'pen':
    case 'highlighter': return 'crosshair';
    default: return 'copy';
  }
}

export const CANVAS_TOOL_SHORTCUTS = {
  a: 'arrow', c: 'connect', d: 'diamond', e: 'eraser', h: 'hand', k: 'laser',
  l: 'line', o: 'ellipse', p: 'pen', r: 'rectangle', t: 'text', v: 'select',
} as const satisfies Record<string, CanvasTool>;

const CANVAS_TOOL_SHORTCUT_LABELS: Partial<Record<CanvasTool, string>> = {
  arrow: 'Arrow',
  connect: 'Connect',
  diamond: 'Diamond',
  ellipse: 'Ellipse',
  eraser: 'Eraser',
  hand: 'Hand',
  laser: 'Laser',
  line: 'Line',
  pen: 'Pen',
  rectangle: 'Rectangle',
  select: 'Select',
  text: 'Text',
};

export function getCanvasToolShortcutLabel(tool: CanvasTool): string {
  const entry = (Object.entries(CANVAS_TOOL_SHORTCUTS) as Array<[string, CanvasTool]>).find(([, value]) => value === tool);
  return entry?.[0].toUpperCase() ?? '';
}

export function getCanvasToolShortcutSummary(exclude: readonly CanvasTool[] = []): string {
  return (Object.entries(CANVAS_TOOL_SHORTCUTS) as Array<[string, CanvasTool]>)
    .filter(([, tool]) => !exclude.includes(tool))
    .map(([key, tool]) => `${key.toUpperCase()} ${CANVAS_TOOL_SHORTCUT_LABELS[tool] ?? tool}`)
    .join(' · ');
}

/** V and Escape are intentionally global canvas exits, except while typing. */
export function getCanvasToolShortcut(key: string, isTyping: boolean, hasModifier = false): CanvasTool | null {
  if (isTyping || hasModifier) return null;
  if (key === 'Escape') return 'select';
  return CANVAS_TOOL_SHORTCUTS[key.toLowerCase() as keyof typeof CANVAS_TOOL_SHORTCUTS] ?? null;
}
