import type { CanvasCamera } from './canvas-touch-gesture';

const DOT_RADIUS = 1;
const GRID_SPACING = 20;

export interface CanvasDotGridGeometry {
  backgroundPosition: string;
  backgroundSize: string;
  dotRadius: string;
}

function formatPixel(value: number): string {
  return `${Number(value.toFixed(4))}px`;
}

export function getCanvasDotGridGeometry(camera: CanvasCamera): CanvasDotGridGeometry {
  const spacing = GRID_SPACING * camera.zoom;
  const radius = DOT_RADIUS * camera.zoom;
  const positionX = camera.panX - (spacing / 2);
  const positionY = camera.panY - (spacing / 2);

  return {
    backgroundPosition: `${formatPixel(positionX)} ${formatPixel(positionY)}`,
    backgroundSize: `${formatPixel(spacing)} ${formatPixel(spacing)}`,
    dotRadius: formatPixel(radius),
  };
}
