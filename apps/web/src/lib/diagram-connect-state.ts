import { getBoundsCenter, type SvgBounds, type SvgPoint } from './svg-hit-map';

export type ConnectNodeActivation =
  | { kind: 'choose-source'; nodeId: string }
  | { kind: 'choose-target'; edge: { midpoint: SvgPoint; source: string; target: string } }
  | { kind: 'noop' };

/** Resolve pointer and keyboard node activation through the same connect flow. */
export function getConnectNodeActivation(
  nodeId: string,
  sourceNodeId: string | null,
  nodeBounds: ReadonlyMap<string, SvgBounds> | null,
): ConnectNodeActivation {
  if (!sourceNodeId) return { kind: 'choose-source', nodeId };
  if (sourceNodeId === nodeId) return { kind: 'noop' };

  const sourceCenter = nodeBounds && nodeBounds.get(sourceNodeId) ? getBoundsCenter(nodeBounds.get(sourceNodeId)!) : null;
  const targetCenter = nodeBounds && nodeBounds.get(nodeId) ? getBoundsCenter(nodeBounds.get(nodeId)!) : null;
  return {
    kind: 'choose-target',
    edge: {
      midpoint: sourceCenter && targetCenter ? {
        x: (sourceCenter.x + targetCenter.x) / 2,
        y: (sourceCenter.y + targetCenter.y) / 2,
      } : { x: 0, y: 0 },
      source: sourceNodeId,
      target: nodeId,
    },
  };
}
