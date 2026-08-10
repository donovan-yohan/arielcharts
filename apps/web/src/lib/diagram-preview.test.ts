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
