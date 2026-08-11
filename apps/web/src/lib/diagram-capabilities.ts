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
import { isPieSourceRepresentable } from './pie-mutations';
import { isQuadrantSourceRepresentable } from './quadrant-mutations';
import { isXyChartSourceRepresentable } from './xychart-mutations';
import { isRadarSourceRepresentable } from './radar-mutations';
import { isSankeySourceRepresentable } from './sankey-mutations';
import { isPacketSourceRepresentable } from './packet-mutations';
import { isCynefinSourceRepresentable } from './cynefin-mutations';
import { isTreemapSourceRepresentable } from './treemap-mutations';
import { getVennDiagramSnapshot, isVennSourceRepresentable } from './venn-mutations';
import { isWardleySourceRepresentable } from './wardley-mutations';
import {
  EXTERNAL_MERMAID_PLUGIN_FAMILIES,
  getExternalMermaidDiagramFamily,
  getMermaidDiagramFamily,
  MERMAID_DIAGRAM_CATALOG_VERSION,
  MERMAID_DIAGRAM_FAMILIES,
  type MermaidDiagramFamilyId,
} from '@arielcharts/shared';

/** Backward-compatible browser export for the shared version-pinned catalog. */
export const MERMAID_CAPABILITY_CATALOG_VERSION = MERMAID_DIAGRAM_CATALOG_VERSION;
export { EXTERNAL_MERMAID_PLUGIN_FAMILIES, MERMAID_DIAGRAM_FAMILIES };
export type { MermaidDiagramFamilyId };

export type DiagramKind = 'flowchart' | 'sequence' | 'er' | 'generic';
export type DiagramEditingMode = 'canvas' | 'semantic-form' | 'source-only' | 'unavailable-plugin';
export type DiagramAdapterId = 'architecture' | 'block' | 'c4' | 'class' | 'flowchart' | 'sequence' | 'er' | 'requirement' | 'state' | 'swimlane' | 'journey' | 'gantt' | 'timeline' | 'gitgraph' | 'event-modeling' | 'kanban' | 'mindmap' | 'tree-view' | 'ishikawa' | 'railroad' | 'pie' | 'quadrant' | 'xy-chart' | 'radar' | 'sankey' | 'packet' | 'cynefin' | 'treemap' | 'venn' | 'wardley' | 'source-only' | 'unavailable-plugin';
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
const PIE_OPERATIONS = new Set(['set-title', 'set-show-data', 'add-slice', 'edit-slice', 'delete-slice', 'move-slice']);
const QUADRANT_OPERATIONS = new Set(['set-title', 'set-axis', 'set-quadrant-label', 'add-point', 'edit-point', 'delete-point', 'move-point']);
const XY_CHART_OPERATIONS = new Set(['set-title', 'set-orientation', 'edit-axis', 'add-series', 'edit-series', 'delete-series', 'move-series']);
const RADAR_OPERATIONS = new Set(['set-title', 'edit-options', 'add-axis', 'edit-axis', 'delete-axis', 'move-axis', 'add-curve', 'edit-curve', 'delete-curve', 'move-curve']);
const SANKEY_OPERATIONS = new Set(['add-link', 'edit-link', 'delete-link', 'move-link', 'rename-node']);
const PACKET_OPERATIONS = new Set(['add-field', 'edit-field', 'delete-field', 'move-field']);
const CYNEFIN_OPERATIONS = new Set(['add-item', 'edit-item', 'delete-item', 'move-item', 'add-transition', 'edit-transition', 'delete-transition', 'move-transition']);
const TREEMAP_OPERATIONS = new Set(['add-node', 'edit-node', 'delete-node', 'move-node', 'reparent-node']);
const VENN_OPERATIONS = new Set(['add-subset', 'edit-subset', 'delete-subset', 'move-subset', 'rename-set', 'add-style', 'edit-style', 'delete-style', 'move-style']);
const WARDLEY_OPERATIONS = new Set(['add-node', 'edit-node', 'delete-node', 'move-node', 'rename-node', 'add-link', 'edit-link', 'delete-link', 'move-link', 'add-evolution', 'edit-evolution', 'delete-evolution', 'add-note', 'edit-note', 'delete-note', 'move-note', 'add-pipeline', 'delete-pipeline']);
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
const PIE_ADAPTER = strictAdapter('pie', PIE_OPERATIONS, isPieSourceRepresentable);
const QUADRANT_ADAPTER = strictAdapter('quadrant', QUADRANT_OPERATIONS, isQuadrantSourceRepresentable);
const XY_CHART_ADAPTER = strictAdapter('xy-chart', XY_CHART_OPERATIONS, isXyChartSourceRepresentable);
const RADAR_ADAPTER = strictAdapter('radar', RADAR_OPERATIONS, isRadarSourceRepresentable);
const SANKEY_ADAPTER = strictAdapter('sankey', SANKEY_OPERATIONS, isSankeySourceRepresentable);
const PACKET_ADAPTER = strictAdapter('packet', PACKET_OPERATIONS, isPacketSourceRepresentable);
const CYNEFIN_ADAPTER = strictAdapter('cynefin', CYNEFIN_OPERATIONS, isCynefinSourceRepresentable);
const TREEMAP_ADAPTER = strictAdapter('treemap', TREEMAP_OPERATIONS, isTreemapSourceRepresentable);
/** The panel edits one whitelisted property per authored target; multi-property
 * style lines remain source-only until the form can expose each property. */
const VENN_ADAPTER = strictAdapter('venn', VENN_OPERATIONS, (source) => {
  if (!isVennSourceRepresentable(source)) return false;
  return getVennDiagramSnapshot(source).styles.every((style) => style.properties.length === 1);
});
const WARDLEY_ADAPTER = strictAdapter('wardley', WARDLEY_OPERATIONS, isWardleySourceRepresentable);

/** Browser-only semantic adapters remain intentionally separate from shared catalog metadata. */
const ADAPTER_BY_FAMILY: Readonly<Record<MermaidDiagramFamilyId, DiagramAdapterId>> = {
  architecture: 'architecture', block: 'block', c4: 'c4', class: 'class', cynefin: 'cynefin',
  'entity-relationship': 'er', 'event-modeling': 'event-modeling', flowchart: 'flowchart', gantt: 'gantt',
  gitgraph: 'gitgraph', ishikawa: 'ishikawa', journey: 'journey', kanban: 'kanban', mindmap: 'mindmap',
  packet: 'packet', pie: 'pie', quadrant: 'quadrant', radar: 'radar', railroad: 'railroad',
  requirement: 'requirement', sankey: 'sankey', sequence: 'sequence', state: 'state', swimlane: 'swimlane',
  timeline: 'timeline', 'tree-view': 'tree-view', treemap: 'treemap', venn: 'venn', wardley: 'wardley',
  'xy-chart': 'xy-chart',
};

export function classifyDiagramCapability(diagramType: string): DiagramCapability {
  const family = getMermaidDiagramFamily(diagramType);
  if (family) {
    return {
      adapter: ADAPTER_BY_FAMILY[family.id],
      diagramType,
      editingMode: family.editingModel,
      family: family.id,
      kind: family.id === 'flowchart' ? 'flowchart' : family.id === 'sequence' ? 'sequence' : family.id === 'entity-relationship' ? 'er' : 'generic',
      label: family.label,
    };
  }

  const externalFamily = getExternalMermaidDiagramFamily(diagramType);
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
    case 'pie': return PIE_ADAPTER;
    case 'quadrant': return QUADRANT_ADAPTER;
    case 'xy-chart': return XY_CHART_ADAPTER;
    case 'radar': return RADAR_ADAPTER;
    case 'sankey': return SANKEY_ADAPTER;
    case 'packet': return PACKET_ADAPTER;
    case 'cynefin': return CYNEFIN_ADAPTER;
    case 'treemap': return TREEMAP_ADAPTER;
case 'venn': return VENN_ADAPTER;
case 'wardley': return WARDLEY_ADAPTER;
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
