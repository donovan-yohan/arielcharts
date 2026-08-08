import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { MutationQueue, parseFlowchartSnapshot } from './diagram-mutations';
import { getDiagramEdgeIdentityForFlowEdge, getFlowEdgeId, getVisibleDiagramLinks } from './diagram-flow-identity';

function setText(yText: Y.Text, text: string) {
  yText.delete(0, yText.length);
  yText.insert(0, text);
}

const threeEdgeDiagram = 'flowchart LR\n  A --> B\n  B --> C\n  C --> D\n';
const boundsMissingFirstEdgeSource = new Map<string, unknown>([
  ['B', {}],
  ['C', {}],
  ['D', {}],
]);

describe('React Flow edge identity', () => {
  it('keeps the canonical graph link index when earlier links are filtered', () => {
    const snapshot = parseFlowchartSnapshot(threeEdgeDiagram);

    const visibleLinks = getVisibleDiagramLinks(snapshot.links, boundsMissingFirstEdgeSource);

    expect(visibleLinks).toHaveLength(2);
    expect(visibleLinks[0]?.graphIndex).toBe(1);
    expect(getFlowEdgeId(visibleLinks[0]!.graphIndex)).toBe('edge-1');
    expect(visibleLinks[0]?.link.source).toBe('B');
    expect(visibleLinks[0]?.link.target).toBe('C');
  });

  it('selects, edits, and deletes the visible edge by canonical identity instead of filtered index', async () => {
    const doc = new Y.Doc();
    const yText = doc.getText('mermaid');
    setText(yText, threeEdgeDiagram);

    const snapshot = parseFlowchartSnapshot(yText.toString());
    const visibleLinks = getVisibleDiagramLinks(snapshot.links, boundsMissingFirstEdgeSource);
    const visibleEdgeId = getFlowEdgeId(visibleLinks[0]!.graphIndex);
    const selected = getDiagramEdgeIdentityForFlowEdge(snapshot.links, visibleEdgeId);
    expect(selected?.index).toBe(1);
    expect(selected?.source).toBe('B');
    expect(selected?.target).toBe('C');

    const queue = new MutationQueue(yText);
    const edited = await queue.editEdgeLabelByIdentity(selected!, 'visible');

    expect(edited.snapshot.links[0]?.source).toBe('A');
    expect(edited.snapshot.links[0]?.target).toBe('B');
    expect(edited.snapshot.links[0]?.text?.text).toBeUndefined();
    expect(edited.snapshot.links[1]?.source).toBe('B');
    expect(edited.snapshot.links[1]?.target).toBe('C');
    expect(edited.snapshot.links[1]?.text?.text).toBe('visible');

    const refreshed = getDiagramEdgeIdentityForFlowEdge(edited.snapshot.links, visibleEdgeId);
    const deleted = await queue.removeEdgeByIdentity(refreshed!);

    expect(deleted.snapshot.links).toHaveLength(2);
    expect(deleted.snapshot.links[0]?.source).toBe('A');
    expect(deleted.snapshot.links[0]?.target).toBe('B');
    expect(deleted.snapshot.links[1]?.source).toBe('C');
    expect(deleted.snapshot.links[1]?.target).toBe('D');
  });
});
