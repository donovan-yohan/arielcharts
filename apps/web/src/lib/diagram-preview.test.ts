import { describe, expect, it } from 'vitest';
import { canUseFlowchartControls, DiagramPreviewRegistry, type DiagramPreview } from './diagram-preview';

const flowchartPreview: DiagramPreview = {
  capability: { diagramType: 'flowchart-v2', kind: 'flowchart' },
  diagramId: 'flow',
  flowchartSnapshot: { direction: 'TD', links: [], nodeIds: [], nodes: [], subgraphs: [] },
  source: 'flowchart TD\nA-->B',
  svg: '<svg />',
};

describe('DiagramPreviewRegistry', () => {
  it('permits structural controls only for the current representable flowchart source', () => {
    expect(canUseFlowchartControls('', null)).toBe(true);
    expect(canUseFlowchartControls(flowchartPreview.source, flowchartPreview)).toBe(true);
    expect(canUseFlowchartControls('flowchart TD\nA-->', flowchartPreview)).toBe(false);
    expect(canUseFlowchartControls('sequenceDiagram\nA->>B: request', flowchartPreview)).toBe(false);
    expect(canUseFlowchartControls(flowchartPreview.source, { ...flowchartPreview, flowchartSnapshot: null })).toBe(false);
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
      capability: { diagramType: 'sequence', kind: 'generic' },
      diagramId: 'api',
      flowchartSnapshot: null,
      source: 'sequenceDiagram\nBrowser->>Gateway: request',
      svg: '<svg id="api" />',
    });

    expect(previews.get('flow')?.svg).toContain('flow');
    expect(previews.get('api')?.capability.kind).toBe('generic');
    previews.clear('flow');
    expect(previews.get('flow')).toBeNull();
    expect(previews.get('api')?.svg).toContain('api');
  });

  it('prunes deleted tabs and their failures so an ID can be safely recreated', () => {
    const previews = new DiagramPreviewRegistry();
    previews.set({
      capability: { diagramType: 'sequence', kind: 'generic' },
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
      capability: { diagramType: 'sequence', kind: 'generic' },
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
