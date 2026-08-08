export type DiagramRendererKind = 'editable' | 'static';
export type PreviewCameraEvent = 'diagram-changed' | 'live-render-accepted' | 'preview-entered' | 'preview-exited';

export function getRendererKind(isFlowchart: boolean): DiagramRendererKind {
  return isFlowchart ? 'editable' : 'static';
}

export function shouldFitRendererKindTransition(
  previous: DiagramRendererKind | null,
  next: DiagramRendererKind,
): boolean {
  return previous !== null && previous !== next;
}

export function getNextPreviewCameraLock(current: boolean, event: PreviewCameraEvent): boolean {
  if (event === 'preview-entered') {
    return true;
  }
  if (event === 'preview-exited') {
    return current;
  }
  return false;
}

export function shouldResetInitialCameraFit(preserveCamera: boolean, nodeCount: number, hasGraph: boolean): boolean {
  return !preserveCamera && nodeCount === 0 && hasGraph;
}
