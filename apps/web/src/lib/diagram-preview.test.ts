import { describe, expect, it } from 'vitest';
import { canUseErControls, canUseFlowchartControls, canUseSemanticFamilyControls, canUseSequenceControls, DiagramPreviewRegistry, type DiagramPreview } from './diagram-preview';

const flowchartPreview: DiagramPreview = {
  capability: { diagramType: 'flowchart-v2', kind: 'flowchart' },
  diagramId: 'flow',
  flowchartSnapshot: { direction: 'TD', links: [], nodeIds: [], nodes: [], subgraphs: [] },
  source: 'flowchart TD\nA-->B',
  svg: '<svg />',
};

describe('DiagramPreviewRegistry', () => {
  it('permits structural controls only for the current representable flowchart source', () => {
    expect(canUseFlowchartControls('', null)).toBe(false);
    expect(canUseFlowchartControls(flowchartPreview.source, flowchartPreview)).toBe(true);
    expect(canUseFlowchartControls('flowchart TD\nA-->', flowchartPreview)).toBe(false);
    expect(canUseFlowchartControls('sequenceDiagram\nA->>B: request', flowchartPreview)).toBe(false);
    expect(canUseFlowchartControls(flowchartPreview.source, { ...flowchartPreview, flowchartSnapshot: null })).toBe(false);
  });

  it('permits sequence controls only for the current parser-confirmed source', () => {
    const sequencePreview: DiagramPreview = {
      capability: { diagramType: 'sequence', kind: 'sequence' },
      diagramId: 'sequence',
      flowchartSnapshot: null,
      source: 'sequenceDiagram\nA->>B: request',
      svg: '<svg />',
    };
    expect(canUseSequenceControls(sequencePreview.source, sequencePreview)).toBe(true);
    expect(canUseSequenceControls('sequenceDiagram', sequencePreview)).toBe(false);
    expect(canUseSequenceControls('', null)).toBe(false);

    const headerOnlyPreview = { ...sequencePreview, source: 'sequenceDiagram' };
    expect(canUseSequenceControls(headerOnlyPreview.source, headerOnlyPreview)).toBe(true);

    const quotedParticipantPreview = {
      ...sequencePreview,
      source: 'sequenceDiagram\nparticipant "Web browser" as Browser\n"Web browser"->>API: request',
    };
    expect(canUseSequenceControls(quotedParticipantPreview.source, quotedParticipantPreview)).toBe(false);
  });

  it('permits ER controls only for a current parser-confirmed representable source', () => {
    const erPreview: DiagramPreview = {
      capability: { diagramType: 'er', kind: 'er' }, diagramId: 'schema', flowchartSnapshot: null,
      source: 'erDiagram\n  CUSTOMER {\n    int id PK\n  }', svg: '<svg />',
    };
    expect(canUseErControls(erPreview.source, erPreview)).toBe(true);
    expect(canUseErControls('erDiagram\n  CUSTOMER ||--o{ ORDER : places', { ...erPreview, source: 'erDiagram\n  CUSTOMER ||--o{ ORDER : places' })).toBe(false);
    expect(canUseErControls(erPreview.source, { ...erPreview, source: 'erDiagram\n  direction LR' })).toBe(false);
  });

  it('gates each new semantic family by both current parser result and its own strict adapter', () => {
    const classPreview: DiagramPreview = { capability: { adapter: 'class', diagramType: 'class', kind: 'generic' }, diagramId: 'class', flowchartSnapshot: null, source: 'classDiagram\n  class Account', svg: '<svg />' };
    const statePreview: DiagramPreview = { capability: { adapter: 'state', diagramType: 'state', kind: 'generic' }, diagramId: 'state', flowchartSnapshot: null, source: 'stateDiagram-v2\n  [*] --> Ready', svg: '<svg />' };
    const requirementPreview: DiagramPreview = { capability: { adapter: 'requirement', diagramType: 'requirement', kind: 'generic' }, diagramId: 'requirement', flowchartSnapshot: null, source: 'requirementDiagram\n  requirement req {\n    id: 1\n    text: Example\n    risk: low\n    verifyMethod: test\n  }', svg: '<svg />' };
    expect(canUseSemanticFamilyControls(classPreview.source, classPreview, 'class')).toBe(true);
    expect(canUseSemanticFamilyControls(statePreview.source, statePreview, 'state')).toBe(true);
    expect(canUseSemanticFamilyControls(requirementPreview.source, requirementPreview, 'requirement')).toBe(true);
    expect(canUseSemanticFamilyControls('stateDiagram-v2\n  state Parent {\n    [*] --> Child\n  }', { ...statePreview, source: 'stateDiagram-v2\n  state Parent {\n    [*] --> Child\n  }' }, 'state')).toBe(false);
    expect(canUseSemanticFamilyControls(classPreview.source, classPreview, 'state')).toBe(false);
    const timelinePreview: DiagramPreview = { capability: { adapter: 'timeline', diagramType: 'timeline', kind: 'generic' }, diagramId: 'timeline', flowchartSnapshot: null, source: 'timeline\n  2026 : Started', svg: '<svg />' };
    expect(canUseSemanticFamilyControls(timelinePreview.source, timelinePreview, 'timeline')).toBe(true);
    expect(canUseSemanticFamilyControls('timeline\n  accTitle: advanced', { ...timelinePreview, source: 'timeline\n  accTitle: advanced' }, 'timeline')).toBe(false);
    const gitGraphPreview: DiagramPreview = { capability: { adapter: 'gitgraph', diagramType: 'gitGraph', kind: 'generic' }, diagramId: 'git', flowchartSnapshot: null, source: 'gitGraph\n  commit id: "base"', svg: '<svg />' };
    const eventPreview: DiagramPreview = { capability: { adapter: 'event-modeling', diagramType: 'eventmodeling', kind: 'generic' }, diagramId: 'event', flowchartSnapshot: null, source: 'eventmodeling\n  entity Order', svg: '<svg />' };
    const kanbanPreview: DiagramPreview = { capability: { adapter: 'kanban', diagramType: 'kanban', kind: 'generic' }, diagramId: 'kanban', flowchartSnapshot: null, source: 'kanban\n  todo[Todo]', svg: '<svg />' };
    expect(canUseSemanticFamilyControls(gitGraphPreview.source, gitGraphPreview, 'gitgraph')).toBe(true);
    expect(canUseSemanticFamilyControls(eventPreview.source, eventPreview, 'event-modeling')).toBe(true);
    expect(canUseSemanticFamilyControls(kanbanPreview.source, kanbanPreview, 'kanban')).toBe(true);
    const mindmapPreview: DiagramPreview = { capability: { adapter: 'mindmap', diagramType: 'mindmap', kind: 'generic' }, diagramId: 'mindmap', flowchartSnapshot: null, source: 'mindmap\n  Root\n    Child', svg: '<svg />' };
    const treeViewPreview: DiagramPreview = { capability: { adapter: 'tree-view', diagramType: 'treeView', kind: 'generic' }, diagramId: 'tree', flowchartSnapshot: null, source: 'treeView-beta\n  Root\n    child.txt', svg: '<svg />' };
    const ishikawaPreview: DiagramPreview = { capability: { adapter: 'ishikawa', diagramType: 'ishikawa', kind: 'generic' }, diagramId: 'fish', flowchartSnapshot: null, source: 'ishikawa-beta\n  Effect\n  Cause', svg: '<svg />' };
    const railroadPreview: DiagramPreview = { capability: { adapter: 'railroad', diagramType: 'railroad', kind: 'generic' }, diagramId: 'grammar', flowchartSnapshot: null, source: 'railroad-ebnf-beta\n  start = "x" ;', svg: '<svg />' };
    expect(canUseSemanticFamilyControls(mindmapPreview.source, mindmapPreview, 'mindmap')).toBe(true);
    expect(canUseSemanticFamilyControls(treeViewPreview.source, treeViewPreview, 'tree-view')).toBe(true);
    expect(canUseSemanticFamilyControls(ishikawaPreview.source, ishikawaPreview, 'ishikawa')).toBe(true);
    expect(canUseSemanticFamilyControls(railroadPreview.source, railroadPreview, 'railroad')).toBe(true);
    expect(canUseSemanticFamilyControls('railroad-beta\n  start = optional(terminal("x"));', { ...railroadPreview, source: 'railroad-beta\n  start = optional(terminal("x"));' }, 'railroad')).toBe(false);
    expect(canUseSemanticFamilyControls('mindmap\n  Root\n    Child:::inline', { ...mindmapPreview, source: 'mindmap\n  Root\n    Child:::inline' }, 'mindmap')).toBe(false);
    const numericPreviews: DiagramPreview[] = [
      { capability: { adapter: 'pie', diagramType: 'pie', kind: 'generic' }, diagramId: 'pie', flowchartSnapshot: null, source: 'pie\n  "A" : 1', svg: '<svg />' },
      { capability: { adapter: 'quadrant', diagramType: 'quadrantChart', kind: 'generic' }, diagramId: 'quadrant', flowchartSnapshot: null, source: 'quadrantChart\n  A: [0.5, 0.5]', svg: '<svg />' },
      { capability: { adapter: 'xy-chart', diagramType: 'xychart', kind: 'generic' }, diagramId: 'xy', flowchartSnapshot: null, source: 'xychart-beta\n  x-axis ["A", "B"]\n  y-axis 0 --> 3\n  line [1, 2]', svg: '<svg />' },
      { capability: { adapter: 'radar', diagramType: 'radar', kind: 'generic' }, diagramId: 'radar', flowchartSnapshot: null, source: 'radar-beta\n  axis a\n  axis b\n  axis c\n  curve one { 1, 2, 3 }', svg: '<svg />' },
      { capability: { adapter: 'sankey', diagramType: 'sankey', kind: 'generic' }, diagramId: 'sankey', flowchartSnapshot: null, source: 'sankey-beta\nSource,Target,2.5', svg: '<svg />' },
      { capability: { adapter: 'packet', diagramType: 'packet', kind: 'generic' }, diagramId: 'packet', flowchartSnapshot: null, source: 'packet-beta\n  0-7: "Header"\n  8-15: "Body"', svg: '<svg />' },
      { capability: { adapter: 'cynefin', diagramType: 'cynefin', kind: 'generic' }, diagramId: 'cynefin', flowchartSnapshot: null, source: 'cynefin-beta\n  complex\n    "Emergent"', svg: '<svg />' },
      { capability: { adapter: 'treemap', diagramType: 'treemap', kind: 'generic' }, diagramId: 'treemap', flowchartSnapshot: null, source: 'treemap-beta\n  "Root"\n    "Leaf": 1', svg: '<svg />' },
      { capability: { adapter: 'venn', diagramType: 'venn', kind: 'generic' }, diagramId: 'venn', flowchartSnapshot: null, source: 'venn-beta\n  set A: 1\n  set B: 1\n  union A, B: 0.5', svg: '<svg />' },
    ];
    for (const preview of numericPreviews) {
      expect(canUseSemanticFamilyControls(preview.source, preview, preview.capability.adapter as 'pie' | 'quadrant' | 'xy-chart' | 'radar' | 'sankey' | 'packet' | 'cynefin' | 'treemap' | 'venn')).toBe(true);
      expect(canUseSemanticFamilyControls(`${preview.source}\n  unsupported syntax`, { ...preview, source: `${preview.source}\n  unsupported syntax` }, preview.capability.adapter as 'pie' | 'quadrant' | 'xy-chart' | 'radar' | 'sankey' | 'packet' | 'cynefin' | 'treemap' | 'venn')).toBe(false);
      expect(canUseSemanticFamilyControls(`${preview.source}\n`, preview, preview.capability.adapter as 'pie' | 'quadrant' | 'xy-chart' | 'radar' | 'sankey' | 'packet' | 'cynefin' | 'treemap' | 'venn')).toBe(false);
    }
    const omittedVennValue: DiagramPreview = { capability: { adapter: 'venn', diagramType: 'venn', kind: 'generic' }, diagramId: 'venn-defaults', flowchartSnapshot: null, source: 'venn-beta\n  set A\n  set B\n  union A, B', svg: '<svg />' };
    expect(canUseSemanticFamilyControls(omittedVennValue.source, omittedVennValue, 'venn')).toBe(true);
    const multiPropertyVenn = 'venn-beta\n  set A\n  style A fill:#fff,stroke:#000';
    expect(canUseSemanticFamilyControls(multiPropertyVenn, { ...omittedVennValue, source: multiPropertyVenn }, 'venn')).toBe(false);
  });

  it('isolates last-known-good previews by stable diagram id', () => {
    const previews = new DiagramPreviewRegistry();
    previews.set({
      capability: { diagramType: 'flowchart-v2', kind: 'flowchart' },
      diagramId: 'flow',
      flowchartSnapshot: null,
      source: 'flowchart TD\nA-->B',
      svg: '<svg id="flow" />',
    });
    previews.set({
      capability: { diagramType: 'sequence', kind: 'sequence' },
      diagramId: 'api',
      flowchartSnapshot: null,
      source: 'sequenceDiagram\nBrowser->>Gateway: request',
      svg: '<svg id="api" />',
    });

    expect(previews.get('flow')?.svg).toContain('flow');
    expect(previews.get('api')?.capability.kind).toBe('sequence');
    previews.clear('flow');
    expect(previews.get('flow')).toBeNull();
    expect(previews.get('api')?.svg).toContain('api');
  });

  it('prunes deleted tabs and their failures so an ID can be safely recreated', () => {
    const previews = new DiagramPreviewRegistry();
    previews.set({
      capability: { diagramType: 'sequence', kind: 'sequence' },
      diagramId: 'deleted',
      flowchartSnapshot: null,
      source: 'sequenceDiagram',
      svg: '<svg id="deleted" />',
    });
    previews.setError('deleted', 'invalid source');
    previews.setError('retained', 'still invalid');

    previews.prune(['retained']);
    expect(previews.get('deleted')).toBeNull();
    expect(previews.getError('deleted')).toBeNull();
    expect(previews.getError('retained')).toBe('still invalid');

    previews.set({
      capability: { diagramType: 'flowchart-v2', kind: 'flowchart' },
      diagramId: 'deleted',
      flowchartSnapshot: null,
      source: 'flowchart TD',
      svg: '<svg id="recreated" />',
    });
    expect(previews.get('deleted')?.svg).toContain('recreated');
    expect(previews.getError('deleted')).toBeNull();
  });

  it('resets previews and errors between sessions', () => {
    const previews = new DiagramPreviewRegistry();
    previews.set({
      capability: { diagramType: 'sequence', kind: 'sequence' },
      diagramId: 'main',
      flowchartSnapshot: null,
      source: 'sequenceDiagram',
      svg: '<svg />',
    });
    previews.setError('main', 'old session error');

    previews.reset();
    expect(previews.get('main')).toBeNull();
    expect(previews.getError('main')).toBeNull();
  });
});
