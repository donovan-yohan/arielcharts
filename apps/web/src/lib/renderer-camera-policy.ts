export type PreviewCameraEvent = 'diagram-changed' | 'live-render-accepted' | 'preview-entered' | 'preview-exited';

export function getNextPreviewCameraLock(current: boolean, event: PreviewCameraEvent): boolean {
  if (event === 'preview-entered') {
    return true;
  }
  if (event === 'preview-exited') {
    return current;
  }
  return false;
}

export function shouldFitInitialCamera(
  preserveCamera: boolean,
  hasFittedInitialCamera: boolean,
  hasRenderableDiagram: boolean,
): boolean {
  return !preserveCamera && !hasFittedInitialCamera && hasRenderableDiagram;
}
