import {
  getAcceptedGenericSourceLayoutPolicy,
  getSourceLayoutPolicy,
  type SourceLayoutPolicy,
} from '@arielcharts/shared';
import type { DiagramNodePositions } from './diagram-layout';

export { getAcceptedGenericSourceLayoutPolicy, getSourceLayoutPolicy, type SourceLayoutPolicy };

export function pruneNodePositions(
  positions: DiagramNodePositions,
  allowedNodeIds: ReadonlySet<string>,
): { removed: DiagramNodePositions; retained: DiagramNodePositions } {
  const removed: DiagramNodePositions = {};
  const retained: DiagramNodePositions = {};
  for (const [nodeId, position] of Object.entries(positions)) {
    if (allowedNodeIds.has(nodeId)) {
      retained[nodeId] = position;
    } else {
      removed[nodeId] = position;
    }
  }
  return { removed, retained };
}
