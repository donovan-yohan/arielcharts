export type DiagramKind = 'flowchart' | 'sequence' | 'generic';

export interface DiagramCapability {
  diagramType: string;
  kind: DiagramKind;
}

/**
 * Mermaid owns syntax detection. ArielCharts only gives structural editing to
 * the family of parser-reported flowchart types it can safely round-trip.
 */
export function classifyDiagramCapability(diagramType: string): DiagramCapability {
  const normalizedType = diagramType.trim().toLocaleLowerCase();

  return {
    diagramType,
    kind: normalizedType.startsWith('flowchart')
      ? 'flowchart'
      : normalizedType === 'sequence' ? 'sequence' : 'generic',
  };
}

export function isStructurallyEditableDiagram(capability: DiagramCapability | null): boolean {
  return capability?.kind === 'flowchart' || capability?.kind === 'sequence';
}
