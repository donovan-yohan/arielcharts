import type { OverlayGeometry, OverlayObjectRecord, OverlayWorldPoint } from '@arielcharts/shared';

export const INK_MAX_DURABLE_POINTS = 512;
export const INK_MAX_PREVIEW_POINTS = 64;
/** Per-stroke persistence/transport budget; renderer work is at most one segment per point. */
export const INK_MAX_SERIALIZED_BYTES = 48 * 1024;
export const INK_RENDER_FRAME_POINT_BUDGET = INK_MAX_DURABLE_POINTS;
export const INK_PREVIEW_INTERVAL_MS = 125;
export const INK_GRID_SIZE = 0.25;
export const INK_MAX_WORLD_COORDINATE = 1_000_000;
export const INK_MAX_GEOMETRY_COORDINATE = INK_MAX_WORLD_COORDINATE + 32;
export const INK_MAX_GEOMETRY_SIZE = (INK_MAX_WORLD_COORDINATE * 2) + 64;

export interface InkPoint extends OverlayWorldPoint { pressure?: number }
export type InkMode = 'pen' | 'highlighter';

function finiteCoordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= INK_MAX_WORLD_COORDINATE;
}

export function quantizeInkPoint(point: InkPoint): InkPoint {
  return {
    x: Math.round(point.x / INK_GRID_SIZE) * INK_GRID_SIZE,
    y: Math.round(point.y / INK_GRID_SIZE) * INK_GRID_SIZE,
    ...(typeof point.pressure === 'number' && Number.isFinite(point.pressure)
      ? { pressure: Math.min(1, Math.max(0, Math.round(point.pressure * 100) / 100)) } : {}),
  };
}

function perpendicularDistance(point: InkPoint, start: InkPoint, end: InkPoint): number {
  const dx = end.x - start.x; const dy = end.y - start.y;
  if (dx === 0 && dy === 0) return Math.hypot(point.x - start.x, point.y - start.y);
  return Math.abs(dy * point.x - dx * point.y + end.x * start.y - end.y * start.x) / Math.hypot(dx, dy);
}

/** Deterministic RDP reduction followed by even sampling makes one bounded immutable commit. */
export function simplifyInkPoints(raw: readonly InkPoint[], maxPoints = INK_MAX_DURABLE_POINTS, tolerance = 0.75): InkPoint[] {
  const points = raw.map(quantizeInkPoint).filter((point, index, all) => index === 0 || point.x !== all[index - 1]!.x || point.y !== all[index - 1]!.y);
  if (points.length <= 2) return points;
  const kept = new Uint8Array(points.length); kept[0] = 1; kept[points.length - 1] = 1;
  const visit = (first: number, last: number) => {
    let largest = tolerance; let index = -1;
    for (let current = first + 1; current < last; current += 1) {
      const distance = perpendicularDistance(points[current]!, points[first]!, points[last]!);
      if (distance > largest) { largest = distance; index = current; }
    }
    if (index >= 0) { kept[index] = 1; visit(first, index); visit(index, last); }
  };
  visit(0, points.length - 1);
  const simplified = points.filter((_point, index) => kept[index] === 1);
  if (simplified.length <= maxPoints) return simplified;
  return Array.from({ length: maxPoints }, (_value, index) => simplified[Math.round(index * (simplified.length - 1) / (maxPoints - 1))]!);
}

export function inkGeometry(points: readonly InkPoint[], width: number): OverlayGeometry {
  const xs = points.map(({ x }) => x); const ys = points.map(({ y }) => y);
  const padding = Math.max(1, width / 2);
  const minX = Math.min(...xs) - padding; const maxX = Math.max(...xs) + padding;
  const minY = Math.min(...ys) - padding; const maxY = Math.max(...ys) + padding;
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY, rotation: 0 };
}

function matchesInkGeometry(geometry: OverlayGeometry, points: readonly InkPoint[], width: number): boolean {
  if (![geometry.x, geometry.y, geometry.width, geometry.height, geometry.rotation].every(Number.isFinite)
    || Math.abs(geometry.x) > INK_MAX_GEOMETRY_COORDINATE || Math.abs(geometry.y) > INK_MAX_GEOMETRY_COORDINATE
    || geometry.width < 0 || geometry.height < 0 || geometry.width > INK_MAX_GEOMETRY_SIZE || geometry.height > INK_MAX_GEOMETRY_SIZE
    || geometry.rotation !== 0) return false;
  const expected = inkGeometry(points, width);
  return Math.abs(geometry.x - expected.x) <= 0.001
    && Math.abs(geometry.y - expected.y) <= 0.001
    && Math.abs(geometry.width - expected.width) <= 0.001
    && Math.abs(geometry.height - expected.height) <= 0.001;
}

export function validInkObject(object: OverlayObjectRecord): boolean {
  if (object.kind !== 'ink.stroke' || object.version !== 1 || object.body !== undefined) return false;
  const payload = object.payload as { points?: unknown; mode?: unknown; composite_export?: unknown };
  const points = Array.isArray(payload.points) ? payload.points as InkPoint[] : [];
  return (payload.mode === 'pen' || payload.mode === 'highlighter')
    && typeof payload.composite_export === 'boolean'
    && points.length >= 2 && points.length <= INK_MAX_DURABLE_POINTS
    && points.every((point) => {
      const candidate = point as InkPoint;
      const pressure = candidate.pressure;
      return Boolean(point) && typeof point === 'object'
        && finiteCoordinate(candidate.x) && finiteCoordinate(candidate.y)
        && (pressure === undefined || (typeof pressure === 'number' && Number.isFinite(pressure) && pressure >= 0 && pressure <= 1));
    })
    && typeof object.style.color === 'string' && object.style.color.length <= 32
    && typeof object.style.width === 'number' && Number.isFinite(object.style.width) && object.style.width > 0 && object.style.width <= 64
    && typeof object.style.opacity === 'number' && Number.isFinite(object.style.opacity) && object.style.opacity >= 0 && object.style.opacity <= 1
    && matchesInkGeometry(object.geometry, points, object.style.width)
    && new TextEncoder().encode(JSON.stringify({ geometry: object.geometry, style: object.style, payload })).byteLength <= INK_MAX_SERIALIZED_BYTES;
}
