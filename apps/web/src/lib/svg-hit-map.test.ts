import { describe, expect, it } from 'vitest';
import {
  buildSequenceSvgTextHitMap,
  extractMermaidEntityId,
  getMermaidEdgeKey,
  isMermaidFlowchartEntityDomId,
  resolveMermaidNodeId,
  resolveMermaidSubgraphId,
} from './svg-hit-map';

function createSequenceSvgCandidates(candidates: Record<string, Element[]>): SVGSVGElement {
  return { querySelectorAll(selector: string) { return candidates[selector] ?? []; } } as unknown as SVGSVGElement;
}

describe('Mermaid SVG entity compatibility', () => {
  it('keeps legacy and render-prefixed flowchart node ids canonical', () => {
    expect(resolveMermaidNodeId('flowchart-Browser-0', ['Browser'])).toBe('Browser');
    expect(resolveMermaidNodeId('arielcharts-session-main-4-flowchart-Browser-API-0', ['Browser', 'Browser-API'])).toBe('Browser-API');
    expect(resolveMermaidNodeId('arielcharts-session-main-4-flowchart-Apple-0', ['A', 'Apple'])).toBe('Apple');
    expect(resolveMermaidNodeId('flowchart-Apple-0', ['A'])).toBe('Apple');
    expect(extractMermaidEntityId('arielcharts-session-main-4-flowchart-Browser-0')).toBe('Browser');
  });

  it('resolves render-prefixed cluster ids against known subgraphs', () => {
    expect(resolveMermaidSubgraphId('arielcharts-session-main-4-Core', ['Core'])).toBe('Core');
    expect(resolveMermaidSubgraphId('Core', ['Core'])).toBe('Core');
    expect(resolveMermaidSubgraphId('arielcharts-session-main-4-Apple', ['A'])).toBe('arielcharts-session-main-4-Apple');
  });

  it('prefers canonical Mermaid edge data ids and identifies prefixed node selector ids', () => {
    expect(getMermaidEdgeKey([null, 'L_A_B_0', 'edge-dom-id'], 2)).toBe('L_A_B_0');
    expect(getMermaidEdgeKey([null, '', undefined], 2)).toBe('edge-2');
    expect(isMermaidFlowchartEntityDomId('arielcharts-session-main-4-flowchart-Browser-0')).toBe(true);
  });
});

describe('sequence SVG text hit map', () => {
  it('projects renderer category and source order without inspecting rendered labels', () => {
    const participant = { querySelectorAll: () => [] } as unknown as Element;
    const message = { querySelectorAll: () => [] } as unknown as Element;
    const note = { querySelectorAll: () => [] } as unknown as Element;
    const fragment = { querySelectorAll: () => [] } as unknown as Element;
    const hitMap = buildSequenceSvgTextHitMap(createSequenceSvgCandidates({
      '.messageText': [message], 'g[data-et="control-structure"]': [fragment], 'g[data-et="note"]': [note], 'g[data-et="participant"]': [participant],
    }), [
      { id: 'statement:4', text: 'Alpha', type: 'participant' }, { id: 'statement:9', text: 'request', type: 'message' }, { id: 'statement:12', text: 'details', type: 'note' }, { id: 'statement:18', text: 'succeeds', type: 'fragment' },
    ]);
    expect(hitMap?.get(participant)).toEqual({ id: 'statement:4', text: 'Alpha', type: 'participant' });
    expect(hitMap?.get(message)).toEqual({ id: 'statement:9', text: 'request', type: 'message' });
    expect(hitMap?.get(note)).toEqual({ id: 'statement:12', text: 'details', type: 'note' });
    expect(hitMap?.get(fragment)).toEqual({ id: 'statement:18', text: 'succeeds', type: 'fragment' });
  });

  it('withholds editing for duplicate source identities or missing renderer candidates', () => {
    const candidate = { querySelectorAll: () => [] } as unknown as Element;
    const svg = createSequenceSvgCandidates({ '.messageText': [candidate], 'g[data-et="control-structure"]': [], 'g[data-et="note"]': [], 'g[data-et="participant"]': [] });
    expect(buildSequenceSvgTextHitMap(svg, [{ id: 'statement:4', text: 'first', type: 'message' }, { id: 'statement:4', text: 'second', type: 'message' }])).toBeNull();
    expect(buildSequenceSvgTextHitMap(svg, [])).toBeNull();
  });
});
