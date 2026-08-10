// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import {
  buildSequenceSvgTextHitMap,
  extractMermaidEntityId,
  getMermaidEdgeKey,
  isMermaidFlowchartEntityDomId,
  resolveSequenceSvgTextTarget,
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
  it('projects renderer category and source order without inspecting repeated rendered labels', () => {
    const participant = { querySelectorAll: () => [] } as unknown as Element;
    const duplicateParticipant = { querySelectorAll: () => [] } as unknown as Element;
    const message = { querySelectorAll: () => [] } as unknown as Element;
    const duplicateMessage = { querySelectorAll: () => [] } as unknown as Element;
    const note = { querySelectorAll: () => [] } as unknown as Element;
    const duplicateNote = { querySelectorAll: () => [] } as unknown as Element;
    const fragment = { querySelectorAll: () => [] } as unknown as Element;
    const duplicateFragment = { querySelectorAll: () => [] } as unknown as Element;
    const hitMap = buildSequenceSvgTextHitMap(createSequenceSvgCandidates({
      '.messageText': [message, duplicateMessage], 'g[data-et="control-structure"]': [fragment, duplicateFragment], 'g[data-et="note"]': [note, duplicateNote], 'g[data-et="participant"]': [participant, duplicateParticipant],
    }), [
      { id: 'statement:4', text: 'repeated', type: 'participant' }, { id: 'statement:5', text: 'repeated', type: 'participant' },
      { id: 'statement:9', text: 'repeated', type: 'message' }, { id: 'statement:10', text: 'repeated', type: 'message' },
      { id: 'statement:12', text: 'repeated', type: 'note' }, { id: 'statement:13', text: 'repeated', type: 'note' },
      { id: 'statement:18', text: 'repeated', type: 'fragment' }, { id: 'statement:19', text: 'repeated', type: 'fragment' },
    ]);
    expect(hitMap?.get(participant)).toEqual({ id: 'statement:4', text: 'repeated', type: 'participant' });
    expect(hitMap?.get(duplicateParticipant)).toEqual({ id: 'statement:5', text: 'repeated', type: 'participant' });
    expect(hitMap?.get(message)).toEqual({ id: 'statement:9', text: 'repeated', type: 'message' });
    expect(hitMap?.get(duplicateMessage)).toEqual({ id: 'statement:10', text: 'repeated', type: 'message' });
    expect(hitMap?.get(note)).toEqual({ id: 'statement:12', text: 'repeated', type: 'note' });
    expect(hitMap?.get(duplicateNote)).toEqual({ id: 'statement:13', text: 'repeated', type: 'note' });
    expect(hitMap?.get(fragment)).toEqual({ id: 'statement:18', text: 'repeated', type: 'fragment' });
    expect(hitMap?.get(duplicateFragment)).toEqual({ id: 'statement:19', text: 'repeated', type: 'fragment' });
  });

  it('withholds editing for duplicate source identities or any renderer/source cardinality mismatch', () => {
    const candidate = { querySelectorAll: () => [] } as unknown as Element;
    const extraCandidate = { querySelectorAll: () => [] } as unknown as Element;
    const svg = createSequenceSvgCandidates({ '.messageText': [candidate], 'g[data-et="control-structure"]': [], 'g[data-et="note"]': [], 'g[data-et="participant"]': [] });
    const rendererWithExtraMessage = createSequenceSvgCandidates({ '.messageText': [candidate, extraCandidate], 'g[data-et="control-structure"]': [], 'g[data-et="note"]': [], 'g[data-et="participant"]': [] });
    expect(buildSequenceSvgTextHitMap(svg, [{ id: 'statement:4', text: 'first', type: 'message' }, { id: 'statement:4', text: 'second', type: 'message' }])).toBeNull();
    expect(buildSequenceSvgTextHitMap(rendererWithExtraMessage, [{ id: 'statement:4', text: 'first', type: 'message' }])).toBeNull();
    expect(buildSequenceSvgTextHitMap(svg, [])).toBeNull();
  });

  it('maps note-only statements while withholding Mermaid implicit participants with no source declaration', () => {
    const implicitA = { querySelectorAll: () => [] } as unknown as Element;
    const implicitB = { querySelectorAll: () => [] } as unknown as Element;
    const firstNote = { querySelectorAll: () => [] } as unknown as Element;
    const secondNote = { querySelectorAll: () => [] } as unknown as Element;
    const hitMap = buildSequenceSvgTextHitMap(createSequenceSvgCandidates({
      '.messageText': [], 'g[data-et="control-structure"]': [], 'g[data-et="note"]': [firstNote, secondNote], 'g[data-et="participant"]': [implicitA, implicitB],
    }), [
      { id: 'statement:2', text: 'hello', type: 'note' },
      { id: 'statement:3', text: 'from semantic control', type: 'note' },
    ]);
    expect(hitMap?.get(firstNote)).toEqual({ id: 'statement:2', text: 'hello', type: 'note' });
    expect(hitMap?.get(secondNote)).toEqual({ id: 'statement:3', text: 'from semantic control', type: 'note' });
    expect(hitMap?.has(implicitA)).toBe(false);
  });

  it('rebuilds only a stale map against the live SVG and keeps mismatched live output fail-closed', () => {
    const item = { id: 'statement:4', text: 'Alpha', type: 'participant' as const };
    const staleSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const staleParticipant = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    staleParticipant.dataset.et = 'participant';
    staleParticipant.append(document.createElementNS('http://www.w3.org/2000/svg', 'text'));
    staleSvg.append(staleParticipant);
    const staleMap = buildSequenceSvgTextHitMap(staleSvg, [item]);

    const liveSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    const liveParticipant = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    liveParticipant.dataset.et = 'participant';
    const liveText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    liveParticipant.append(liveText);
    liveSvg.append(liveParticipant);

    expect(resolveSequenceSvgTextTarget(staleMap, liveSvg, [item], liveText)).toEqual(item);
    expect(resolveSequenceSvgTextTarget(staleMap, liveSvg, [], liveText)).toBeNull();
  });
});
