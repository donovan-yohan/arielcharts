const MIN_CANVAS_ZOOM = 0.2;
const MAX_CANVAS_ZOOM = 4;

export function getCameraPerturbationKey(transformStyle: string | null): '=' | '-' {
  const zoom = Number(transformStyle?.match(/scale\(([-+\d.eE]+)\)/u)?.[1]);
  if (!Number.isFinite(zoom)) {
    throw new Error(`Could not read React Flow zoom from ${JSON.stringify(transformStyle)}.`);
  }
  return zoom - MIN_CANVAS_ZOOM <= MAX_CANVAS_ZOOM - zoom ? '=' : '-';
}
