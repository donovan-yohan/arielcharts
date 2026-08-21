import type { OverlayGeometry, OverlayWorldPoint } from '@arielcharts/shared';

/** The eight box handles are named in object-local coordinates. */
export type OverlayResizeHandle = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w';
export type OverlayLineEndpoint = 'start' | 'end';

export interface OverlayTransformOptions {
  /** Screen-space deltas are divided by this value before reaching world geometry. */
  zoom: number;
  /** Keep the initial width/height ratio while resizing. */
  shiftKey?: boolean;
  minWidth?: number;
  minHeight?: number;
}

export interface OverlayRotationOptions { shiftKey?: boolean; }

export interface OverlayTransformDraft {
  id: string;
  expectedGeometry: OverlayGeometry;
  startScreen: OverlayWorldPoint;
}

const DEFAULT_MIN_SIZE = 24;
const SNAP_DEGREES = 15;

function finite(value: number): boolean { return Number.isFinite(value); }

function validGeometry(geometry: OverlayGeometry): boolean {
  return finite(geometry.x) && finite(geometry.y) && finite(geometry.width) && finite(geometry.height)
    && finite(geometry.rotation);
}

function point(x: number, y: number): OverlayWorldPoint { return { x, y }; }

function rotate(vector: OverlayWorldPoint, degrees: number): OverlayWorldPoint {
  const radians = (degrees * Math.PI) / 180;
  const cosine = Math.cos(radians); const sine = Math.sin(radians);
  return point((vector.x * cosine) - (vector.y * sine), (vector.x * sine) + (vector.y * cosine));
}

function geometryPoint(geometry: OverlayGeometry, local: OverlayWorldPoint): OverlayWorldPoint {
  const center = point(geometry.x + (geometry.width / 2), geometry.y + (geometry.height / 2));
  const rotated = rotate(point(local.x - (geometry.width / 2), local.y - (geometry.height / 2)), geometry.rotation);
  return point(center.x + rotated.x, center.y + rotated.y);
}

function clampMin(value: number, minimum: number): number { return Math.max(minimum, value); }

function handleAxes(handle: OverlayResizeHandle) {
  return {
    horizontal: handle.includes('e') ? 1 : handle.includes('w') ? -1 : 0,
    vertical: handle.includes('s') ? 1 : handle.includes('n') ? -1 : 0,
  } as const;
}

function oppositeLocal(handle: OverlayResizeHandle, width: number, height: number): OverlayWorldPoint {
  const { horizontal, vertical } = handleAxes(handle);
  return point(horizontal === 1 ? 0 : horizontal === -1 ? width : width / 2, vertical === 1 ? 0 : vertical === -1 ? height : height / 2);
}

function localDeltaFromScreen(delta: OverlayWorldPoint, rotation: number, zoom: number): OverlayWorldPoint {
  if (!finite(zoom) || zoom <= 0) throw new Error('Overlay transform zoom must be positive.');
  return rotate(point(delta.x / zoom, delta.y / zoom), -rotation);
}

/** Keep persisted rotations bounded, so equivalent rotations compare and converge consistently. */
export function normalizeOverlayRotation(rotation: number): number {
  if (!finite(rotation)) throw new Error('Overlay rotation must be finite.');
  const normalized = ((rotation % 360) + 360) % 360;
  return Object.is(normalized, -0) ? 0 : normalized;
}

export function overlayGeometryEqual(left: OverlayGeometry, right: OverlayGeometry): boolean {
  return left.x === right.x && left.y === right.y && left.width === right.width
    && left.height === right.height && left.rotation === right.rotation;
}

export function beginOverlayTransformDraft(id: string, geometry: OverlayGeometry, startScreen: OverlayWorldPoint): OverlayTransformDraft {
  if (!id || !validGeometry(geometry) || !finite(startScreen.x) || !finite(startScreen.y)) throw new Error('Invalid overlay transform draft.');
  return { id, expectedGeometry: structuredClone(geometry), startScreen: structuredClone(startScreen) };
}

/**
 * Rotation-aware resize. The opposite handle (or opposite side midpoint) is
 * invariant in world coordinates. Dragging past it clamps at the minimum
 * extent rather than silently flipping the object and its handle identity.
 */
export function resizeOverlayGeometry(
  origin: OverlayGeometry,
  handle: OverlayResizeHandle,
  screenDelta: OverlayWorldPoint,
  options: OverlayTransformOptions,
): OverlayGeometry {
  if (!validGeometry(origin) || !finite(screenDelta.x) || !finite(screenDelta.y)) throw new Error('Invalid overlay resize.');
  const minimumWidth = Math.max(0, options.minWidth ?? DEFAULT_MIN_SIZE);
  const minimumHeight = Math.max(0, options.minHeight ?? DEFAULT_MIN_SIZE);
  const { horizontal, vertical } = handleAxes(handle);
  const delta = localDeltaFromScreen(screenDelta, origin.rotation, options.zoom);
  let width = origin.width + (horizontal * delta.x);
  let height = origin.height + (vertical * delta.y);

  if (options.shiftKey && origin.width > 0 && origin.height > 0 && (horizontal || vertical)) {
    const horizontalChange = horizontal ? Math.abs(delta.x / origin.width) : -1;
    const verticalChange = vertical ? Math.abs(delta.y / origin.height) : -1;
    if (horizontalChange >= verticalChange) {
      width = origin.width + (horizontal * delta.x);
      height = origin.height * (width / origin.width);
    } else {
      height = origin.height + (vertical * delta.y);
      width = origin.width * (height / origin.height);
    }
    const scale = Math.max(minimumWidth / width, minimumHeight / height, 1);
    if (scale > 1) { width *= scale; height *= scale; }
  } else {
    width = horizontal ? clampMin(width, minimumWidth) : origin.width;
    height = vertical ? clampMin(height, minimumHeight) : origin.height;
  }

  // Aspect-locked dimensions must remain positive before min-size correction.
  width = Math.max(minimumWidth, width);
  height = Math.max(minimumHeight, height);
  if (options.shiftKey && origin.width > 0 && origin.height > 0) {
    const ratio = origin.width / origin.height;
    if (horizontal && !vertical) height = Math.max(minimumHeight, width / ratio);
    else if (vertical && !horizontal) width = Math.max(minimumWidth, height * ratio);
    else {
      const scale = Math.max(width / origin.width, height / origin.height);
      width = Math.max(minimumWidth, origin.width * scale);
      height = Math.max(minimumHeight, origin.height * scale);
    }
  }

  const fixed = geometryPoint(origin, oppositeLocal(handle, origin.width, origin.height));
  const nextOpposite = oppositeLocal(handle, width, height);
  const nextCenterOffset = rotate(point(nextOpposite.x - (width / 2), nextOpposite.y - (height / 2)), origin.rotation);
  return {
    x: fixed.x - nextCenterOffset.x - (width / 2),
    y: fixed.y - nextCenterOffset.y - (height / 2),
    width,
    height,
    rotation: normalizeOverlayRotation(origin.rotation),
  };
}

/** Lines/arrows are endpoint vectors: x/y is start and width/height is end-start. */
export function resizeOverlayLineEndpoint(
  origin: OverlayGeometry,
  endpoint: OverlayLineEndpoint,
  screenDelta: OverlayWorldPoint,
  zoom: number,
): OverlayGeometry {
  if (!validGeometry(origin) || !finite(screenDelta.x) || !finite(screenDelta.y) || !finite(zoom) || zoom <= 0) throw new Error('Invalid overlay line resize.');
  const delta = point(screenDelta.x / zoom, screenDelta.y / zoom);
  if (endpoint === 'end') return { ...origin, width: origin.width + delta.x, height: origin.height + delta.y, rotation: 0 };
  return { ...origin, x: origin.x + delta.x, y: origin.y + delta.y, width: origin.width - delta.x, height: origin.height - delta.y, rotation: 0 };
}

/** Pointer angles are measured from the geometry centre. Shift snaps to 15°. */
export function rotateOverlayGeometry(
  origin: OverlayGeometry,
  centerScreen: OverlayWorldPoint,
  startScreen: OverlayWorldPoint,
  currentScreen: OverlayWorldPoint,
  options: OverlayRotationOptions = {},
): OverlayGeometry {
  if (!validGeometry(origin) || ![centerScreen, startScreen, currentScreen].every((item) => finite(item.x) && finite(item.y))) throw new Error('Invalid overlay rotation.');
  const start = Math.atan2(startScreen.y - centerScreen.y, startScreen.x - centerScreen.x) * (180 / Math.PI);
  const current = Math.atan2(currentScreen.y - centerScreen.y, currentScreen.x - centerScreen.x) * (180 / Math.PI);
  let rotation = origin.rotation + current - start;
  if (options.shiftKey) rotation = Math.round(rotation / SNAP_DEGREES) * SNAP_DEGREES;
  return { ...origin, rotation: normalizeOverlayRotation(rotation) };
}

export function resizeOverlayDraft(draft: OverlayTransformDraft, handle: OverlayResizeHandle, currentScreen: OverlayWorldPoint, options: OverlayTransformOptions): OverlayGeometry {
  return resizeOverlayGeometry(draft.expectedGeometry, handle, point(currentScreen.x - draft.startScreen.x, currentScreen.y - draft.startScreen.y), options);
}

export function resizeOverlayLineDraft(draft: OverlayTransformDraft, endpoint: OverlayLineEndpoint, currentScreen: OverlayWorldPoint, zoom: number): OverlayGeometry {
  return resizeOverlayLineEndpoint(draft.expectedGeometry, endpoint, point(currentScreen.x - draft.startScreen.x, currentScreen.y - draft.startScreen.y), zoom);
}

export function rotateOverlayDraft(draft: OverlayTransformDraft, centerScreen: OverlayWorldPoint, currentScreen: OverlayWorldPoint, options: OverlayRotationOptions = {}): OverlayGeometry {
  return rotateOverlayGeometry(draft.expectedGeometry, centerScreen, draft.startScreen, currentScreen, options);
}
