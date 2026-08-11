import { isHeaderOnlyFlowchartSource, parseFlowchartSnapshot } from './diagram-mutations';
import { isErSourceRepresentable } from './er-mutations';
import { isClassSourceRepresentable } from './class-mutations';
import { isArchitectureSourceRepresentable } from './architecture-mutations';
import { isBlockSourceRepresentable } from './block-mutations';
import { isC4SourceRepresentable } from './c4-mutations';
import { isSwimlaneSourceRepresentable } from './swimlane-mutations';
import { isRequirementSourceRepresentable } from './requirement-mutations';
import { isSequenceSourceRepresentable } from './sequence-mutations';
import { isStateSourceRepresentable } from './state-mutations';
import { isJourneySourceRepresentable } from './journey-mutations';
import { isGanttSourceRepresentable } from './gantt-mutations';
import { isTimelineSourceRepresentable } from './timeline-mutations';
import { isGitGraphSourceRepresentable } from './gitgraph-mutations';
import { isEventModelingSourceRepresentable } from './event-modeling-mutations';
import { isKanbanSourceRepresentable } from './kanban-mutations';
import { isMindmapSourceRepresentable } from './mindmap-mutations';
import { isTreeViewSourceRepresentable } from './treeview-mutations';
import { isIshikawaSourceRepresentable } from './ishikawa-mutations';
import { isRailroadSourceRepresentable } from './railroad-mutations';

/** The installed Mermaid detector registry this catalog was audited against. */
export const MERMAID_CAPABILITY_CATALOG_VERSION = '11.16.1';

export type DiagramKind = 'flowchart' | 'sequence' | 'er' | 'generic';
export type DiagramEditingMode = 'canvas' | 'semantic-form' | 'source-only' | 'unavailable-plugin';
export type DiagramAdapterId = 'architecture' | 'block' | 'c4' | 'class' | 'flowchart' | 'sequence' | 'er' | 'requirement' | 'state' | 'swimlane' | 'journey' | 'gantt' | 'timeline' | 'gitgraph' | 'event-modeling' | 'kanban' | 'mindmap' | 'tree-view' | 'ishikawa' | 'railroad' | 'source-only' | 'unavailable-plugin';
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

const ER_OPERATIONS = new Set([
  'add-attribute', 'add-entity', 'add-relationship', 'delete-attribute', 'delete-entity',
  'delete-relationship', 'edit-attribute', 'edit-entity', 'edit-relationship',
  'reorder-attributes', 'reorder-entities',
]);

const ER_ADAPTER: DiagramSourceModelAdapter = {
  id: 'er',
  getOperationResult(source, operation) {
    if (!this.getRepresentability(source).representable) {
      return { supported: false, reason: 'unrepresentable' };
    }
    return ER_OPERATIONS.has(operation)
      ? { supported: true }
      : { supported: false, reason: 'unsupported-operation' };
  },
  getRepresentability: (source) => isErSourceRepresentable(source)
    ? { representable: true }
    : { representable: false, reason: 'unsupported-syntax' },
};

const CLASS_OPERATIONS = new Set([
  'add-annotation', 'add-class', 'add-member', 'add-relationship', 'delete-annotation',
  'delete-class', 'delete-member', 'delete-relationship', 'edit-class', 'edit-member', 'edit-relationship',
]);

const CLASS_ADAPTER: DiagramSourceModelAdapter = {
  id: 'class',
  getOperationResult(source, operation) {
    if (!this.getRepresentability(source).representable) return { supported: false, reason: 'unrepresentable' };
    return CLASS_OPERATIONS.has(operation) ? { supported: true } : { supported: false, reason: 'unsupported-operation' };
  },
  getRepresentability: (source) => isClassSourceRepresentable(source)
    ? { representable: true }
    : { representable: false, reason: 'unsupported-syntax' },
};

const STATE_OPERATIONS = new Set([
  'add-state', 'add-transition', 'delete-state', 'delete-transition', 'edit-state', 'edit-transition',
]);

const STATE_ADAPTER: DiagramSourceModelAdapter = {
  id: 'state',
  getOperationResult(source, operation) {
    if (!this.getRepresentability(source).representable) return { supported: false, reason: 'unrepresentable' };
    return STATE_OPERATIONS.has(operation) ? { supported: true } : { supported: false, reason: 'unsupported-operation' };
  },
  getRepresentability: (source) => isStateSourceRepresentable(source)
    ? { representable: true }
    : { representable: false, reason: 'unsupported-syntax' },
};

const REQUIREMENT_OPERATIONS = new Set([
  'add-requirement', 'add-relationship', 'delete-requirement', 'delete-relationship', 'edit-requirement', 'edit-relationship',
]);

const REQUIREMENT_ADAPTER: DiagramSourceModelAdapter = {
  id: 'requirement',
  getOperationResult(source, operation) {
    if (!this.getRepresentability(source).representable) return { supported: false, reason: 'unrepresentable' };
    return REQUIREMENT_OPERATIONS.has(operation) ? { supported: true } : { supported: false, reason: 'unsupported-operation' };
  },
  getRepresentability: (source) => isRequirementSourceRepresentable(source)
    ? { representable: true }
    : { representable: false, reason: 'unsupported-syntax' },
};

const ARCHITECTURE_OPERATIONS = new Set([
  'add-alignment', 'add-edge', 'add-group', 'add-junction', 'add-service', 'delete-alignment', 'delete-edge',
  'delete-group', 'delete-junction', 'delete-service', 'edit-alignment', 'edit-edge', 'edit-group', 'edit-junction', 'edit-service',
]);

const ARCHITECTURE_ADAPTER: DiagramSourceModelAdapter = {
  id: 'architecture',
  getOperationResult(source, operation) {
    if (!this.getRepresentability(source).representable) return { supported: false, reason: 'unrepresentable' };
    return ARCHITECTURE_OPERATIONS.has(operation) ? { supported: true } : { supported: false, reason: 'unsupported-operation' };
  },
  getRepresentability: (source) => isArchitectureSourceRepresentable(source)
    ? { representable: true }
    : { representable: false, reason: 'unsupported-syntax' },
};
const BLOCK_OPERATIONS = new Set(['add-node', 'edit-node', 'delete-node', 'move-node', 'add-link', 'edit-link', 'delete-link', 'add-composite', 'edit-composite', 'delete-composite', 'move-composite', 'set-columns']);
const C4_OPERATIONS = new Set(['add-element', 'edit-element', 'delete-element', 'move-element', 'add-boundary', 'edit-boundary', 'delete-boundary', 'move-boundary', 'add-relationship', 'edit-relationship', 'delete-relationship']);
const SWIMLANE_OPERATIONS = new Set(['add-lane', 'edit-lane', 'delete-lane', 'add-node', 'edit-node', 'delete-node', 'add-handoff', 'edit-handoff', 'delete-handoff']);

const BLOCK_ADAPTER: DiagramSourceModelAdapter = {
  id: 'block',
  getOperationResult(source, operation) {
    if (!this.getRepresentability(source).representable) return { supported: false, reason: 'unrepresentable' };
    return BLOCK_OPERATIONS.has(operation) ? { supported: true } : { supported: false, reason: 'unsupported-operation' };
  },
  getRepresentability: (source) => isBlockSourceRepresentable(source) ? { representable: true } : { representable: false, reason: 'unsupported-syntax' },
};

const C4_ADAPTER: DiagramSourceModelAdapter = {
  id: 'c4',
  getOperationResult(source, operation) {
    if (!this.getRepresentability(source).representable) return { supported: false, reason: 'unrepresentable' };
    return C4_OPERATIONS.has(operation) ? { supported: true } : { supported: false, reason: 'unsupported-operation' };
  },
  getRepresentability: (source) => isC4SourceRepresentable(source) ? { representable: true } : { representable: false, reason: 'unsupported-syntax' },
};

const SWIMLANE_ADAPTER: DiagramSourceModelAdapter = {
  id: 'swimlane',
  getOperationResult(source, operation) {
    if (!this.getRepresentability(source).representable) return { supported: false, reason: 'unrepresentable' };
    return SWIMLANE_OPERATIONS.has(operation) ? { supported: true } : { supported: false, reason: 'unsupported-operation' };
  },
  getRepresentability: (source) => isSwimlaneSourceRepresentable(source) ? { representable: true } : { representable: false, reason: 'unsupported-syntax' },
};
const JOURNEY_OPERATIONS = new Set(['add-section', 'edit-section', 'delete-section', 'move-section', 'add-task', 'edit-task', 'delete-task', 'move-task']);
const GANTT_OPERATIONS = new Set(['add-section', 'edit-section', 'delete-section', 'move-section', 'add-task', 'edit-task', 'delete-task', 'move-task']);
const TIMELINE_OPERATIONS = new Set(['set-direction', 'add-section', 'edit-section', 'delete-section', 'move-section', 'add-period', 'edit-period', 'delete-period', 'move-period', 'add-event', 'edit-event', 'delete-event', 'move-event']);
const GITGRAPH_OPERATIONS = new Set(['add-commit', 'edit-commit', 'add-branch', 'edit-branch', 'add-checkout', 'edit-checkout', 'add-merge', 'edit-merge', 'add-cherry-pick', 'edit-cherry-pick', 'delete-operation', 'move-operation']);
const EVENT_MODELING_OPERATIONS = new Set(['add-timeframe', 'edit-timeframe', 'delete-timeframe', 'move-timeframe', 'add-entity', 'rename-entity', 'delete-entity', 'add-data', 'edit-data', 'delete-data']);
const KANBAN_OPERATIONS = new Set(['add-column', 'edit-column', 'delete-column', 'add-card', 'edit-card', 'delete-card', 'move-card', 'set-card-metadata']);
const MINDMAP_OPERATIONS = new Set(['add-node', 'edit-node', 'delete-node', 'move-node', 'reparent-node']);
const TREE_VIEW_OPERATIONS = new Set(['add-node', 'edit-node', 'delete-node', 'move-node', 'reparent-node']);
const ISHIKAWA_OPERATIONS = new Set(['set-effect', 'add-cause', 'edit-cause', 'delete-cause', 'move-cause', 'reparent-cause']);
const RAILROAD_OPERATIONS = new Set(['add-rule', 'edit-rule', 'delete-rule', 'move-rule', 'rename-rule']);
function strictAdapter(id: DiagramAdapterId, operations: ReadonlySet<string>, representable: (source: string) => boolean): DiagramSourceModelAdapter { return { id, getOperationResult(source, operation) { return !representable(source) ? { supported: false, reason: 'unrepresentable' } : operations.has(operation) ? { supported: true } : { supported: false, reason: 'unsupported-operation' }; }, getRepresentability: (source) => representable(source) ? { representable: true } : { representable: false, reason: 'unsupported-syntax' } }; }
const JOURNEY_ADAPTER = strictAdapter('journey', JOURNEY_OPERATIONS, isJourneySourceRepresentable);
const GANTT_ADAPTER = strictAdapter('gantt', GANTT_OPERATIONS, isGanttSourceRepresentable);
const TIMELINE_ADAPTER = strictAdapter('timeline', TIMELINE_OPERATIONS, isTimelineSourceRepresentable);
const GITGRAPH_ADAPTER = strictAdapter('gitgraph', GITGRAPH_OPERATIONS, isGitGraphSourceRepresentable);
const EVENT_MODELING_ADAPTER = strictAdapter('event-modeling', EVENT_MODELING_OPERATIONS, isEventModelingSourceRepresentable);
const KANBAN_ADAPTER = strictAdapter('kanban', KANBAN_OPERATIONS, isKanbanSourceRepresentable);
const MINDMAP_ADAPTER = strictAdapter('mindmap', MINDMAP_OPERATIONS, isMindmapSourceRepresentable);
const TREE_VIEW_ADAPTER = strictAdapter('tree-view', TREE_VIEW_OPERATIONS, isTreeViewSourceRepresentable);
const ISHIKAWA_ADAPTER = strictAdapter('ishikawa', ISHIKAWA_OPERATIONS, isIshikawaSourceRepresentable);
const RAILROAD_ADAPTER = strictAdapter('railroad', RAILROAD_OPERATIONS, isRailroadSourceRepresentable);

/**
 * Every built-in visual Mermaid family in 11.16.1. Aliases, renderer variants,
 * and Railroad's four grammar detector IDs deliberately collapse to one family.
 * `info` is a diagnostic rather than a visual family and is intentionally absent.
 */
export const MERMAID_DIAGRAM_FAMILIES = [
  { id: 'architecture', label: 'Architecture', parserTypes: ['architecture'], editingMode: 'semantic-form', adapter: 'architecture' },
  { id: 'block', label: 'Block', parserTypes: ['block'], editingMode: 'semantic-form', adapter: 'block' },
  { id: 'c4', label: 'C4', parserTypes: ['c4'], editingMode: 'semantic-form', adapter: 'c4' },
  { id: 'class', label: 'Class', parserTypes: ['class', 'classDiagram'], editingMode: 'semantic-form', adapter: 'class' },
  { id: 'cynefin', label: 'Cynefin', parserTypes: ['cynefin'] },
  { id: 'entity-relationship', label: 'Entity relationship', parserTypes: ['er'], editingMode: 'semantic-form', adapter: 'er' },
  { id: 'event-modeling', label: 'Event modeling', parserTypes: ['eventmodeling'], editingMode: 'semantic-form', adapter: 'event-modeling' },
  { id: 'flowchart', label: 'Flowchart', parserTypes: ['flowchart', 'flowchart-v2', 'flowchart-elk'], editingMode: 'canvas', adapter: 'flowchart' },
  { id: 'gantt', label: 'Gantt', parserTypes: ['gantt'], editingMode: 'semantic-form', adapter: 'gantt' },
  { id: 'gitgraph', label: 'Gitgraph', parserTypes: ['gitGraph'], editingMode: 'semantic-form', adapter: 'gitgraph' },
  { id: 'ishikawa', label: 'Ishikawa', parserTypes: ['ishikawa'], editingMode: 'semantic-form', adapter: 'ishikawa' },
  { id: 'journey', label: 'User journey', parserTypes: ['journey'], editingMode: 'semantic-form', adapter: 'journey' },
  { id: 'kanban', label: 'Kanban', parserTypes: ['kanban'], editingMode: 'semantic-form', adapter: 'kanban' },
  { id: 'mindmap', label: 'Mindmap', parserTypes: ['mindmap'], editingMode: 'semantic-form', adapter: 'mindmap' },
  { id: 'packet', label: 'Packet', parserTypes: ['packet'] },
  { id: 'pie', label: 'Pie', parserTypes: ['pie'] },
  { id: 'quadrant', label: 'Quadrant chart', parserTypes: ['quadrantChart'] },
  { id: 'radar', label: 'Radar', parserTypes: ['radar'] },
  { id: 'railroad', label: 'Railroad', parserTypes: ['railroad', 'railroadEbnf', 'railroadAbnf', 'railroadPeg'], editingMode: 'semantic-form', adapter: 'railroad' },
  { id: 'requirement', label: 'Requirement', parserTypes: ['requirement'], editingMode: 'semantic-form', adapter: 'requirement' },
  { id: 'sankey', label: 'Sankey', parserTypes: ['sankey'] },
  { id: 'sequence', label: 'Sequence', parserTypes: ['sequence'], editingMode: 'semantic-form', adapter: 'sequence' },
  { id: 'state', label: 'State', parserTypes: ['state', 'stateDiagram'], editingMode: 'semantic-form', adapter: 'state' },
  { id: 'swimlane', label: 'Swimlane', parserTypes: ['swimlane'], editingMode: 'semantic-form', adapter: 'swimlane' },
  { id: 'timeline', label: 'Timeline', parserTypes: ['timeline'], editingMode: 'semantic-form', adapter: 'timeline' },
  { id: 'tree-view', label: 'Tree view', parserTypes: ['treeView'], editingMode: 'semantic-form', adapter: 'tree-view' },
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
      kind: family.id === 'flowchart' ? 'flowchart' : family.id === 'sequence' ? 'sequence' : family.id === 'entity-relationship' ? 'er' : 'generic',
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
    ?? (capability?.kind === 'flowchart' ? 'flowchart' : capability?.kind === 'sequence' ? 'sequence' : capability?.kind === 'er' ? 'er' : 'source-only');
  switch (adapter) {
    case 'flowchart': return FLOWCHART_ADAPTER;
    case 'sequence': return SEQUENCE_ADAPTER;
    case 'er': return ER_ADAPTER;
    case 'class': return CLASS_ADAPTER;
    case 'state': return STATE_ADAPTER;
    case 'requirement': return REQUIREMENT_ADAPTER;
    case 'architecture': return ARCHITECTURE_ADAPTER;
    case 'block': return BLOCK_ADAPTER;
    case 'c4': return C4_ADAPTER;
    case 'swimlane': return SWIMLANE_ADAPTER;
    case 'journey': return JOURNEY_ADAPTER;
    case 'gantt': return GANTT_ADAPTER;
    case 'timeline': return TIMELINE_ADAPTER;
    case 'gitgraph': return GITGRAPH_ADAPTER;
    case 'event-modeling': return EVENT_MODELING_ADAPTER;
    case 'kanban': return KANBAN_ADAPTER;
    case 'mindmap': return MINDMAP_ADAPTER;
    case 'tree-view': return TREE_VIEW_ADAPTER;
    case 'ishikawa': return ISHIKAWA_ADAPTER;
    case 'railroad': return RAILROAD_ADAPTER;
    case 'unavailable-plugin': return UNAVAILABLE_PLUGIN_ADAPTER;
    default: return SOURCE_ONLY_ADAPTER;
  }
}

export function getDiagramCapabilityLabel(capability: DiagramCapability | null, source?: string): string {
  if (!capability) return 'Mermaid · source only';
  const label = capability.label ?? (capability.kind === 'flowchart' ? 'Flowchart' : capability.kind === 'sequence' ? 'Sequence' : capability.kind === 'er' ? 'Entity relationship' : 'Mermaid');
  const editingMode = capability.editingMode ?? (capability.kind === 'flowchart' ? 'canvas' : capability.kind === 'sequence' || capability.kind === 'er' ? 'semantic-form' : 'source-only');
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
    || capability?.kind === 'sequence'
    || capability?.kind === 'er';
}
