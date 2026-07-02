import * as Y from 'yjs';

export type DiagramNodePosition = { x: number; y: number };
export type DiagramNodePositions = Record<string, DiagramNodePosition>;
export type NodePositionsSyncMode = 'merge' | 'replace';

export function isNodePosition(value: unknown): value is DiagramNodePosition {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const position = value as Partial<DiagramNodePosition>;
  return typeof position.x === 'number'
    && Number.isFinite(position.x)
    && typeof position.y === 'number'
    && Number.isFinite(position.y);
}

export function readNodePositions(positionMap: Y.Map<DiagramNodePosition>): DiagramNodePositions {
  const positions = Object.create(null) as DiagramNodePositions;
  for (const [nodeId, position] of Array.from(positionMap.entries())) {
    if (isNodePosition(position)) {
      positions[nodeId] = { x: position.x, y: position.y };
    }
  }
  return positions;
}

export function writeNodePositions(
  positionMap: Y.Map<DiagramNodePosition>,
  positions: DiagramNodePositions,
  mode: NodePositionsSyncMode = 'merge',
): void {
  if (mode === 'replace') {
    for (const nodeId of Array.from(positionMap.keys())) {
      if (!Object.prototype.hasOwnProperty.call(positions, nodeId)) {
        positionMap.delete(nodeId);
      }
    }
  }

  for (const [nodeId, position] of Object.entries(positions)) {
    positionMap.set(nodeId, { x: position.x, y: position.y });
  }
}
