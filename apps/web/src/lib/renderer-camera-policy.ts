export type DiagramRendererKind = 'editable' | 'static';

export function getRendererKind(isFlowchart: boolean): DiagramRendererKind {
  return isFlowchart ? 'editable' : 'static';
}

export function shouldFitRendererKindTransition(
  previous: DiagramRendererKind | null,
  next: DiagramRendererKind,
): boolean {
  return previous !== null && previous !== next;
}
