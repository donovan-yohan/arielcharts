import { isHeaderOnlyFlowchartSource, parseFlowchartSnapshot } from './diagram-mutations';
import { isSequenceSourceRepresentable } from './sequence-mutations';

/** The installed Mermaid detector registry this catalog was audited against. */
export const MERMAID_CAPABILITY_CATALOG_VERSION = '11.16.1';

export type DiagramKind = 'flowchart' | 'sequence' | 'generic';
export type DiagramEditingMode = 'canvas' | 'semantic-form' | 'source-only' | 'unavailable-plugin';
export type DiagramAdapterId = 'flowchart' | 'sequence' | 'source-only' | 'unavailable-plugin';
export type MermaidDiagramFamilyId = typeof MERMAID_DIAGRAM_FAMILIES[number]['id'];

export interface MermaidDiagramFamily {
  adapter?: DiagramAdapterId;
  /** Mermaid detector IDs returned by `mermaid.parse`, not authored header text. */
  parserTypes: readonly string[];
  editingMode?: DiagramEditingMode;
  id: string;
  label: string;
}

export interface DiagramCapability {
  adapter?: DiagramAdapterId;
  diagramType: string;
  editingMode?: DiagramEditingMode;
  family?: MermaidDiagramFamilyId | 'unknown' | 'zenuml';
  /** Compatibility surface for the existing canvas renderer boundary. */
  kind: DiagramKind;
  label?: string;
}

export type SourceModelRepresentability =
  | { representable: true }
  | { reason: 'plugin-unavailable' | 'source-only' | 'unsupported-syntax'; representable: false };

export type SourceModelOperationResult =
  | { supported: true }
  | { reason: 'plugin-unavailable' | 'source-only' | 'unrepresentable' | 'unsupported-operation'; supported: false };

/**
 * A family adapter decides whether source is safe for semantic controls. It
 * never owns source: callers still commit its minimal text change through the
 * diagram's existing Y.Text mutation path.
 */
export interface DiagramSourceModelAdapter {
  id: DiagramAdapterId;
  getOperationResult(source: string, operation: string): SourceModelOperationResult;
  getRepresentability(source: string): SourceModelRepresentability;
}

const SOURCE_ONLY_ADAPTER: DiagramSourceModelAdapter = {
  id: 'source-only',
  getOperationResult: () => ({ supported: false, reason: 'source-only' }),
  getRepresentability: () => ({ representable: false, reason: 'source-only' }),
};

const UNAVAILABLE_PLUGIN_ADAPTER: DiagramSourceModelAdapter = {
  id: 'unavailable-plugin',
  getOperationResult: () => ({ supported: false, reason: 'plugin-unavailable' }),
  getRepresentability: () => ({ representable: false, reason: 'plugin-unavailable' }),
};

const FLOWCHART_OPERATIONS = new Set([
  'add-edge', 'add-node', 'change-node-shape', 'delete-edge', 'delete-node',
  'edit-edge-label', 'edit-node-label', 'edit-subgraph-label', 'group-nodes', 'ungroup-nodes',
]);

const FLOWCHART_ADAPTER: DiagramSourceModelAdapter = {
  id: 'flowchart',
  getOperationResult(source, operation) {
    if (!this.getRepresentability(source).representable) {
      return { supported: false, reason: 'unrepresentable' };
    }
    return FLOWCHART_OPERATIONS.has(operation)
      ? { supported: true }
      : { supported: false, reason: 'unsupported-operation' };
  },
  getRepresentability(source) {
    if (isHeaderOnlyFlowchartSource(source)) return { representable: true };
    try {
      parseFlowchartSnapshot(source);
      return { representable: true };
    } catch {
      return { representable: false, reason: 'unsupported-syntax' };
    }
  },
};

const SEQUENCE_OPERATIONS = new Set(['add-message', 'add-participant']);

const SEQUENCE_ADAPTER: DiagramSourceModelAdapter = {
  id: 'sequence',
  getOperationResult(source, operation) {
    if (!this.getRepresentability(source).representable) {
      return { supported: false, reason: 'unrepresentable' };
    }
    return SEQUENCE_OPERATIONS.has(operation)
      ? { supported: true }
      : { supported: false, reason: 'unsupported-operation' };
  },
  getRepresentability: (source) => isSequenceSourceRepresentable(source)
    ? { representable: true }
    : { representable: false, reason: 'unsupported-syntax' },
};

/**
 * Every built-in visual Mermaid family in 11.16.1. Aliases, renderer variants,
 * and Railroad's four grammar detector IDs deliberately collapse to one family.
 * `info` is a diagnostic rather than a visual family and is intentionally absent.
 */
export const MERMAID_DIAGRAM_FAMILIES = [
  { id: 'architecture', label: 'Architecture', parserTypes: ['architecture'] },
  { id: 'block', label: 'Block', parserTypes: ['block'] },
  { id: 'c4', label: 'C4', parserTypes: ['c4'] },
  { id: 'class', label: 'Class', parserTypes: ['class', 'classDiagram'] },
  { id: 'cynefin', label: 'Cynefin', parserTypes: ['cynefin'] },
  { id: 'entity-relationship', label: 'Entity relationship', parserTypes: ['er'] },
  { id: 'event-modeling', label: 'Event modeling', parserTypes: ['eventmodeling'] },
  { id: 'flowchart', label: 'Flowchart', parserTypes: ['flowchart', 'flowchart-v2', 'flowchart-elk'], editingMode: 'canvas', adapter: 'flowchart' },
  { id: 'gantt', label: 'Gantt', parserTypes: ['gantt'] },
  { id: 'gitgraph', label: 'Gitgraph', parserTypes: ['gitGraph'] },
  { id: 'ishikawa', label: 'Ishikawa', parserTypes: ['ishikawa'] },
  { id: 'journey', label: 'User journey', parserTypes: ['journey'] },
  { id: 'kanban', label: 'Kanban', parserTypes: ['kanban'] },
  { id: 'mindmap', label: 'Mindmap', parserTypes: ['mindmap'] },
  { id: 'packet', label: 'Packet', parserTypes: ['packet'] },
  { id: 'pie', label: 'Pie', parserTypes: ['pie'] },
  { id: 'quadrant', label: 'Quadrant chart', parserTypes: ['quadrantChart'] },
  { id: 'radar', label: 'Radar', parserTypes: ['radar'] },
  { id: 'railroad', label: 'Railroad', parserTypes: ['railroad', 'railroadEbnf', 'railroadAbnf', 'railroadPeg'] },
  { id: 'requirement', label: 'Requirement', parserTypes: ['requirement'] },
  { id: 'sankey', label: 'Sankey', parserTypes: ['sankey'] },
  { id: 'sequence', label: 'Sequence', parserTypes: ['sequence'], editingMode: 'semantic-form', adapter: 'sequence' },
  { id: 'state', label: 'State', parserTypes: ['state', 'stateDiagram'] },
  { id: 'swimlane', label: 'Swimlane', parserTypes: ['swimlane'] },
  { id: 'timeline', label: 'Timeline', parserTypes: ['timeline'] },
  { id: 'tree-view', label: 'Tree view', parserTypes: ['treeView'] },
  { id: 'treemap', label: 'Treemap', parserTypes: ['treemap'] },
  { id: 'venn', label: 'Venn', parserTypes: ['venn'] },
  { id: 'wardley', label: 'Wardley', parserTypes: ['wardley'] },
  { id: 'xy-chart', label: 'XY chart', parserTypes: ['xychart'] },
] as const satisfies readonly MermaidDiagramFamily[];

/** ZenUML is intentionally catalogued separately because it needs an external Mermaid plugin. */
export const EXTERNAL_MERMAID_PLUGIN_FAMILIES = [
  { id: 'zenuml', label: 'ZenUML', parserTypes: ['zenuml', 'zenUml'] },
] as const;

const DEFAULT_FAMILY_VALUES = { adapter: 'source-only', editingMode: 'source-only' } as const;
const FAMILY_BY_PARSER_TYPE = new Map(
  MERMAID_DIAGRAM_FAMILIES.flatMap((family) => family.parserTypes.map((parserType) => [parserType.toLowerCase(), family] as const)),
);
const EXTERNAL_FAMILY_BY_PARSER_TYPE = new Map(
  EXTERNAL_MERMAID_PLUGIN_FAMILIES.flatMap((family) => family.parserTypes.map((parserType) => [parserType.toLowerCase(), family] as const)),
);

export function classifyDiagramCapability(diagramType: string): DiagramCapability {
  const normalizedType = diagramType.trim().toLowerCase();
  const family = FAMILY_BY_PARSER_TYPE.get(normalizedType);
  if (family) {
    const adapter = ('adapter' in family ? family.adapter : undefined) ?? DEFAULT_FAMILY_VALUES.adapter;
    const editingMode = ('editingMode' in family ? family.editingMode : undefined) ?? DEFAULT_FAMILY_VALUES.editingMode;
    return {
      adapter,
      diagramType,
      editingMode,
      family: family.id as MermaidDiagramFamilyId,
      kind: family.id === 'flowchart' ? 'flowchart' : family.id === 'sequence' ? 'sequence' : 'generic',
      label: family.label,
    };
  }

  const externalFamily = EXTERNAL_FAMILY_BY_PARSER_TYPE.get(normalizedType);
  if (externalFamily) {
    return {
      adapter: 'unavailable-plugin', diagramType, editingMode: 'unavailable-plugin', family: 'zenuml', kind: 'generic', label: externalFamily.label,
    };
  }

  return {
    adapter: 'source-only', diagramType, editingMode: 'source-only', family: 'unknown', kind: 'generic', label: 'Mermaid',
  };
}

export function getDiagramSourceModelAdapter(capability: DiagramCapability | null): DiagramSourceModelAdapter {
  const adapter = capability?.adapter
    ?? (capability?.kind === 'flowchart' ? 'flowchart' : capability?.kind === 'sequence' ? 'sequence' : 'source-only');
  switch (adapter) {
    case 'flowchart': return FLOWCHART_ADAPTER;
    case 'sequence': return SEQUENCE_ADAPTER;
    case 'unavailable-plugin': return UNAVAILABLE_PLUGIN_ADAPTER;
    default: return SOURCE_ONLY_ADAPTER;
  }
}

export function getDiagramCapabilityLabel(capability: DiagramCapability | null, source?: string): string {
  if (!capability) return 'Mermaid · source only';
  const label = capability.label ?? (capability.kind === 'flowchart' ? 'Flowchart' : capability.kind === 'sequence' ? 'Sequence' : 'Mermaid');
  const editingMode = capability.editingMode ?? (capability.kind === 'flowchart' ? 'canvas' : capability.kind === 'sequence' ? 'semantic-form' : 'source-only');
  if ((editingMode === 'canvas' || editingMode === 'semantic-form')
    && source !== undefined
    && !getDiagramSourceModelAdapter(capability).getRepresentability(source).representable) {
    return `${label} · source only`;
  }
  switch (editingMode) {
    case 'canvas': return `${label} · editable · canvas`;
    case 'semantic-form': return `${label} · editable · form`;
    case 'unavailable-plugin': return `${label} · plugin unavailable`;
    default: return `${label} · source only`;
  }
}

export function isStructurallyEditableDiagram(capability: DiagramCapability | null): boolean {
  return capability?.editingMode === 'canvas'
    || capability?.editingMode === 'semantic-form'
    || capability?.kind === 'flowchart'
    || capability?.kind === 'sequence';
}
