import type { AwarenessState, CanvasAwarenessState, CanvasLaserState, CanvasPresenceEntry, CanvasWorldPoint, Participant } from '@arielcharts/shared';

export const CANVAS_CURSOR_INTERVAL_MS = 75;
export const CANVAS_CURSOR_GRID_SIZE = 4;
export const CANVAS_CURSOR_MIN_DISTANCE = 4;
// 80 active samples/10s leaves one third of the shared awareness budget for
// immediate stop, cursor, selection, and editor-presence transitions.
export const CANVAS_LASER_INTERVAL_MS = 125;
export const CANVAS_LASER_GRID_SIZE = 2;

function isParticipant(value: unknown): value is Participant {
  if (!value || typeof value !== 'object') return false;
  const participant = value as Partial<Participant>;
  return typeof participant.name === 'string'
    && typeof participant.color === 'string'
    && (participant.type === 'human' || participant.type === 'agent');
}

function isFinitePoint(value: unknown): value is CanvasWorldPoint {
  if (!value || typeof value !== 'object') return false;
  const point = value as Partial<CanvasWorldPoint>;
  return typeof point.x === 'number'
    && Number.isFinite(point.x)
    && typeof point.y === 'number'
    && Number.isFinite(point.y);
}

function getCanvasAwarenessState(value: unknown): CanvasAwarenessState | null {
  if (!value || typeof value !== 'object') return null;
  const canvas = value as Partial<CanvasAwarenessState>;
  if (typeof canvas.diagram_id !== 'string' || canvas.diagram_id.length === 0) return null;
  if (canvas.cursor !== undefined && !isFinitePoint(canvas.cursor)) return null;
  if (canvas.selected_node_ids !== undefined
    && (!Array.isArray(canvas.selected_node_ids) || canvas.selected_node_ids.some((id) => typeof id !== 'string' || id.length === 0))) {
    return null;
  }
  if (canvas.editing_node_id !== undefined
    && (typeof canvas.editing_node_id !== 'string' || canvas.editing_node_id.length === 0)) {
    return null;
  }
  if (canvas.laser !== undefined && !isCanvasLaserState(canvas.laser)) return null;
  return {
    diagram_id: canvas.diagram_id,
    ...(canvas.cursor ? { cursor: canvas.cursor } : {}),
    ...(canvas.selected_node_ids ? { selected_node_ids: [...new Set(canvas.selected_node_ids)] } : {}),
    ...(canvas.editing_node_id ? { editing_node_id: canvas.editing_node_id } : {}),
    ...(canvas.laser ? { laser: canvas.laser } : {}),
  };
}

export function isCanvasLaserState(value: unknown): value is CanvasLaserState {
  if (!value || typeof value !== 'object') return false;
  const laser = value as Partial<CanvasLaserState>;
  if (typeof laser.active !== 'boolean' || !Number.isSafeInteger(laser.sequence) || (laser.sequence ?? -1) < 0) return false;
  return laser.active ? isFinitePoint(laser.point) : laser.point === undefined;
}

export function quantizeLaserPoint(point: CanvasWorldPoint): CanvasWorldPoint {
  return {
    x: Math.round(point.x / CANVAS_LASER_GRID_SIZE) * CANVAS_LASER_GRID_SIZE,
    y: Math.round(point.y / CANVAS_LASER_GRID_SIZE) * CANVAS_LASER_GRID_SIZE,
  };
}

export function quantizeCanvasCursor(point: CanvasWorldPoint): CanvasWorldPoint {
  return {
    x: Math.round(point.x / CANVAS_CURSOR_GRID_SIZE) * CANVAS_CURSOR_GRID_SIZE,
    y: Math.round(point.y / CANVAS_CURSOR_GRID_SIZE) * CANVAS_CURSOR_GRID_SIZE,
  };
}

export function hasCanvasCursorMovedEnough(previous: CanvasWorldPoint | null, next: CanvasWorldPoint): boolean {
  if (!previous) return true;
  const dx = next.x - previous.x;
  const dy = next.y - previous.y;
  return (dx * dx) + (dy * dy) >= CANVAS_CURSOR_MIN_DISTANCE * CANVAS_CURSOR_MIN_DISTANCE;
}

export function getRemoteCanvasPresence(
  states: ReadonlyMap<number, unknown>,
  localClientId: number,
  activeDiagramId: string | null,
): CanvasPresenceEntry[] {
  if (!activeDiagramId) return [];
  const entries: CanvasPresenceEntry[] = [];
  for (const [clientId, state] of states) {
    if (clientId === localClientId || !state || typeof state !== 'object') continue;
    const awareness = state as Partial<AwarenessState>;
    if (!isParticipant(awareness.user)) continue;
    const canvas = getCanvasAwarenessState(awareness.canvas);
    if (!canvas || canvas.diagram_id !== activeDiagramId) continue;
    entries.push({ client_id: clientId, participant: awareness.user, canvas });
  }
  return entries.sort((left, right) => left.client_id - right.client_id);
}

export function areCanvasAwarenessStatesEqual(left: CanvasAwarenessState | null, right: CanvasAwarenessState | null): boolean {
  if (left === right) return true;
  if (!left || !right || left.diagram_id !== right.diagram_id) return false;
  if (left.cursor?.x !== right.cursor?.x || left.cursor?.y !== right.cursor?.y) return false;
  if (left.laser?.active !== right.laser?.active
    || left.laser?.sequence !== right.laser?.sequence
    || left.laser?.point?.x !== right.laser?.point?.x
    || left.laser?.point?.y !== right.laser?.point?.y) return false;
  const leftSelection = left.selected_node_ids ?? [];
  const rightSelection = right.selected_node_ids ?? [];
  return left.editing_node_id === right.editing_node_id
    && leftSelection.length === rightSelection.length
    && leftSelection.every((nodeId, index) => nodeId === rightSelection[index]);
}
