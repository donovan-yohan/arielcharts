import type { FlowchartSnapshot } from './diagram-mutations';
import { getDiagramSourceModelAdapter, type DiagramCapability } from './diagram-capabilities';

export interface DiagramPreview {
  capability: DiagramCapability;
  diagramId: string;
  flowchartSnapshot: FlowchartSnapshot | null;
  source: string;
  svg: string;
}

export function canUseFlowchartControls(source: string, preview: DiagramPreview | null): boolean {
  if (!source.trim()) {
    return false;
  }

  return preview?.source === source
    && preview.capability.kind === 'flowchart'
    && preview.flowchartSnapshot !== null
    && getDiagramSourceModelAdapter(preview.capability).getRepresentability(source).representable;
}

export function canUseSequenceControls(source: string, preview: DiagramPreview | null): boolean {
  return preview?.source === source
    && preview.capability.kind === 'sequence'
    && getDiagramSourceModelAdapter(preview.capability).getRepresentability(source).representable;
}

export function canUseErControls(source: string, preview: DiagramPreview | null): boolean {
  return preview?.source === source
    && preview.capability.kind === 'er'
    && getDiagramSourceModelAdapter(preview.capability).getRepresentability(source).representable;
}

/** Semantic families share only their current-preview gate; each owns its grammar. */
export function canUseSemanticFamilyControls(source: string, preview: DiagramPreview | null, adapter: 'architecture' | 'block' | 'c4' | 'class' | 'state' | 'requirement' | 'swimlane' | 'journey' | 'gantt' | 'timeline' | 'gitgraph' | 'event-modeling' | 'kanban' | 'mindmap' | 'tree-view' | 'ishikawa' | 'railroad'): boolean {
  return preview?.source === source
    && preview.capability.adapter === adapter
    && getDiagramSourceModelAdapter(preview.capability).getRepresentability(source).representable;
}

/** Last-known-good previews are intentionally local and isolated by stable tab id. */
export class DiagramPreviewRegistry {
  private readonly previews = new Map<string, DiagramPreview>();
  private readonly errors = new Map<string, string>();

  clear(diagramId: string): void {
    this.previews.delete(diagramId);
    this.errors.delete(diagramId);
  }

  get(diagramId: string): DiagramPreview | null {
    return this.previews.get(diagramId) ?? null;
  }

  set(preview: DiagramPreview): void {
    this.previews.set(preview.diagramId, preview);
    this.errors.delete(preview.diagramId);
  }

  getError(diagramId: string): string | null {
    return this.errors.get(diagramId) ?? null;
  }

  setError(diagramId: string, error: string): void {
    this.errors.set(diagramId, error);
  }

  prune(diagramIds: Iterable<string>): void {
    const retainedIds = new Set(diagramIds);
    for (const diagramId of this.previews.keys()) {
      if (!retainedIds.has(diagramId)) this.previews.delete(diagramId);
    }
    for (const diagramId of this.errors.keys()) {
      if (!retainedIds.has(diagramId)) this.errors.delete(diagramId);
    }
  }

  reset(): void {
    this.previews.clear();
    this.errors.clear();
  }
}
