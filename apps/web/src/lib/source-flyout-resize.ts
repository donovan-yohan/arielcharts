export const SOURCE_FLYOUT_DEFAULT_WIDTH = 345;
export const SOURCE_FLYOUT_MIN_WIDTH = 320;
export const SOURCE_FLYOUT_MAX_WIDTH = 640;
export const SOURCE_FLYOUT_VIEWPORT_INSET = 24;
export const SOURCE_FLYOUT_KEYBOARD_STEP = 24;

export function getSourceFlyoutMaximumWidth(viewportWidth: number): number {
  return Math.max(0, Math.min(SOURCE_FLYOUT_MAX_WIDTH, Math.floor(viewportWidth - SOURCE_FLYOUT_VIEWPORT_INSET)));
}

export function clampSourceFlyoutWidth(width: number, viewportWidth: number): number {
  const maximum = getSourceFlyoutMaximumWidth(viewportWidth);
  if (maximum <= SOURCE_FLYOUT_MIN_WIDTH) {
    return maximum;
  }
  return Math.min(maximum, Math.max(SOURCE_FLYOUT_MIN_WIDTH, Math.round(width)));
}

export function getSourceFlyoutWidthFromPointer(clientX: number, viewportWidth: number): number {
  return clampSourceFlyoutWidth(viewportWidth - clientX, viewportWidth);
}

export function getSourceFlyoutKeyboardWidth(
  width: number,
  viewportWidth: number,
  key: string,
): number | null {
  const maximum = getSourceFlyoutMaximumWidth(viewportWidth);
  switch (key) {
    case 'ArrowLeft':
      return clampSourceFlyoutWidth(width + SOURCE_FLYOUT_KEYBOARD_STEP, viewportWidth);
    case 'ArrowRight':
      return clampSourceFlyoutWidth(width - SOURCE_FLYOUT_KEYBOARD_STEP, viewportWidth);
    case 'Home':
      return clampSourceFlyoutWidth(SOURCE_FLYOUT_MIN_WIDTH, viewportWidth);
    case 'End':
      return maximum;
    default:
      return null;
  }
}
