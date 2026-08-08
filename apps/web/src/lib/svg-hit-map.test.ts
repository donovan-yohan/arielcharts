import { describe, expect, it } from 'vitest';
import {
  extractMermaidEntityId,
  getMermaidEdgeKey,
  isMermaidFlowchartEntityDomId,
  resolveMermaidNodeId,
  resolveMermaidSubgraphId,
} from './svg-hit-map';

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
