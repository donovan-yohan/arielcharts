import type { FlowchartLink } from 'mermaid-ast';
import { getDiagramEdgeIdentity } from './diagram-mutations';
import type { DiagramEdgeIdentity } from './diagram-mutations';

export interface IndexedDiagramLink<TLink extends Pick<FlowchartLink, 'source' | 'target'> = FlowchartLink> {
  graphIndex: number;
  link: TLink;
}

export function getFlowEdgeId(index: number): string {
  return `edge-${index}`;
}

export function getFlowEdgeIndex(edgeId: string): number | null {
  const match = /^edge-(\d+)$/.exec(edgeId);
  if (!match) {
    return null;
  }

  return Number.parseInt(match[1]!, 10);
}

export function getVisibleDiagramLinks<TLink extends Pick<FlowchartLink, 'source' | 'target'>>(
  links: readonly TLink[],
  nodeBounds: Pick<ReadonlyMap<string, unknown>, 'has'>,
): Array<IndexedDiagramLink<TLink>> {
  return links
    .map((link, graphIndex) => ({ graphIndex, link }))
    .filter(({ link }) => nodeBounds.has(link.source) && nodeBounds.has(link.target));
}

export function getDiagramEdgeIdentityForFlowEdge(
  links: readonly FlowchartLink[],
  edgeId: string,
): DiagramEdgeIdentity | null {
  const edgeIndex = getFlowEdgeIndex(edgeId);
  const diagramEdge = edgeIndex === null ? null : links[edgeIndex];

  return edgeIndex === null || !diagramEdge
    ? null
    : getDiagramEdgeIdentity(diagramEdge, edgeIndex);
}
