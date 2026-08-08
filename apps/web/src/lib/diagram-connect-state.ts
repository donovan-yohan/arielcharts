import { getBoundsCenter, type SvgBounds, type SvgPoint } from './svg-hit-map';

export type ConnectNodeActivation =
  | { kind: 'choose-source'; nodeId: string }
  | { kind: 'choose-target'; edge: { midpoint: SvgPoint; source: string; target: string } }
  | { kind: 'noop' };

/** Resolve a node activation while the canvas is in connect mode. */
export function getConnectNodeActivation(
  nodeId: string,
  sourceNodeId: string | null,
  nodeBounds: ReadonlyMap<string, SvgBounds> | null,
): ConnectNodeActivation {
  if (!sourceNodeId) {
    return { kind: 'choose-source', nodeId };
  }

  if (sourceNodeId === nodeId) {
    return { kind: 'noop' };
  }

  const sourceBounds = nodeBounds?.get(sourceNodeId);
  const targetBounds = nodeBounds?.get(nodeId);
  const sourceCenter = sourceBounds ? getBoundsCenter(sourceBounds) : null;
  const targetCenter = targetBounds ? getBoundsCenter(targetBounds) : null;
  const midpoint = sourceCenter && targetCenter
    ? {
        x: (sourceCenter.x + targetCenter.x) / 2,
        y: (sourceCenter.y + targetCenter.y) / 2,
      }
    : { x: 0, y: 0 };

  return {
    edge: {
      midpoint,
      source: sourceNodeId,
      target: nodeId,
    },
    kind: 'choose-target',
  };
}
