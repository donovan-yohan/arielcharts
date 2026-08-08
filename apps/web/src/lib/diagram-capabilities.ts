export type DiagramKind = 'flowchart' | 'generic';

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
    kind: normalizedType.startsWith('flowchart') ? 'flowchart' : 'generic',
  };
}

export function isStructurallyEditableDiagram(capability: DiagramCapability | null): boolean {
  return capability?.kind === 'flowchart';
}
