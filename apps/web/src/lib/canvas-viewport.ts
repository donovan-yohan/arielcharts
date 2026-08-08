export interface ViewportRect {
  height: number;
  width: number;
  x: number;
  y: number;
}

interface ClientRectLike {
  bottom: number;
  height: number;
  left: number;
  right: number;
  top: number;
  width: number;
}

export function measureUnobscuredCanvasViewport(
  canvas: HTMLElement,
  occluderSelector = '.workspace-flyout',
): ViewportRect {
  const canvasRect = canvas.getBoundingClientRect();
  const scope = canvas.closest('.workspace-main') ?? canvas.parentElement;
  const occluders = scope
    ? [...scope.querySelectorAll<HTMLElement>(occluderSelector)]
      .map((element) => element.getBoundingClientRect())
      .filter((rect) => rect.width > 0 && rect.height > 0)
    : [];

  return getUnobscuredCanvasViewport(canvasRect, occluders);
}

/** Returns the largest unobscured rectangle in canvas-local coordinates. */
export function getUnobscuredCanvasViewport(
  canvas: ClientRectLike,
  occluders: ClientRectLike[],
): ViewportRect {
  let viewport = { height: canvas.height, width: canvas.width, x: 0, y: 0 };

  for (const occluder of occluders) {
    const localOccluder = {
      bottom: Math.min(canvas.height, occluder.bottom - canvas.top),
      left: Math.max(0, occluder.left - canvas.left),
      right: Math.min(canvas.width, occluder.right - canvas.left),
      top: Math.max(0, occluder.top - canvas.top),
    };
    const intersection = intersect(viewport, localOccluder);
    if (!intersection) {
      continue;
    }

    const candidates = [
      rect(viewport.x, viewport.y, intersection.left - viewport.x, viewport.height),
      rect(intersection.right, viewport.y, (viewport.x + viewport.width) - intersection.right, viewport.height),
      rect(viewport.x, viewport.y, viewport.width, intersection.top - viewport.y),
      rect(viewport.x, intersection.bottom, viewport.width, (viewport.y + viewport.height) - intersection.bottom),
    ].filter((candidate) => candidate.width > 0 && candidate.height > 0);

    viewport = candidates.sort((left, right) => area(right) - area(left))[0] ?? rect(viewport.x, viewport.y, 1, 1);
  }

  return viewport;
}

function intersect(viewport: ViewportRect, occluder: { bottom: number; left: number; right: number; top: number }) {
  const left = Math.max(viewport.x, occluder.left);
  const right = Math.min(viewport.x + viewport.width, occluder.right);
  const top = Math.max(viewport.y, occluder.top);
  const bottom = Math.min(viewport.y + viewport.height, occluder.bottom);
  return right > left && bottom > top ? { bottom, left, right, top } : null;
}

function rect(x: number, y: number, width: number, height: number): ViewportRect {
  return { height, width, x, y };
}

function area(value: ViewportRect): number {
  return value.width * value.height;
}
