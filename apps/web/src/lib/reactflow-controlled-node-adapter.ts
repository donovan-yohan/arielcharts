import { applyNodeChanges, type Node, type NodeChange, type XYPosition } from '@xyflow/react';

type NodeRuntime = {
  dragging?: boolean;
  measured?: Node['measured'];
  position?: XYPosition;
};

type ComposedNodeCacheEntry<NodeType extends Node> = {
  canonical: NodeType;
  composed: NodeType;
  runtime?: NodeRuntime;
};

export type ControlledNodeRuntime = Record<string, NodeRuntime>;

export type ControlledNodeComposer<NodeType extends Node> = {
  compose: (canonicalNodes: NodeType[], runtime: ControlledNodeRuntime) => NodeType[];
};

/** Applies React Flow select diffs to the app-owned canonical selection. */
export function applyControlledSelectionChanges<NodeType extends Node>(
  selectedNodeIds: string[],
  changes: NodeChange<NodeType>[],
): string[] {
  const nextSelection = new Set(selectedNodeIds);
  let changed = false;

  for (const change of changes) {
    if (change.type !== 'select') {
      continue;
    }

    if (change.selected && !nextSelection.has(change.id)) {
      nextSelection.add(change.id);
      changed = true;
    }
    if (!change.selected && nextSelection.delete(change.id)) {
      changed = true;
    }
  }

  return changed ? [...nextSelection] : selectedNodeIds;
}

function samePosition(left: XYPosition | undefined, right: XYPosition | undefined): boolean {
  return left?.x === right?.x && left?.y === right?.y;
}

function sameMeasured(left: Node['measured'] | undefined, right: Node['measured'] | undefined): boolean {
  return left?.width === right?.width && left?.height === right?.height;
}

function sameRuntimeValue(left: NodeRuntime | undefined, right: NodeRuntime | undefined): boolean {
  return left?.dragging === right?.dragging
    && samePosition(left?.position, right?.position)
    && sameMeasured(left?.measured, right?.measured);
}

function hasRuntimeValue(runtime: NodeRuntime): boolean {
  return runtime.measured !== undefined || runtime.position !== undefined;
}

function sameRuntime(left: ControlledNodeRuntime, right: ControlledNodeRuntime): boolean {
  const leftIds = Object.keys(left);
  return leftIds.length === Object.keys(right).length
    && leftIds.every((id) => right[id] !== undefined && sameRuntimeValue(left[id], right[id]));
}

function areEquivalentValues(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) {
    return true;
  }
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => areEquivalentValues(value, right[index]));
  }

  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord);
  return leftKeys.length === Object.keys(rightRecord).length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key)
      && areEquivalentValues(leftRecord[key], rightRecord[key]));
}

function composeControlledNode<NodeType extends Node>(canonical: NodeType, runtime: NodeRuntime | undefined): NodeType {
  if (!runtime) {
    return canonical;
  }

  const shouldUseRuntimePosition = runtime.position !== undefined && runtime.dragging === true;
  return {
    ...canonical,
    ...(runtime.measured === undefined ? {} : { measured: runtime.measured }),
    ...(shouldUseRuntimePosition ? { dragging: true, position: runtime.position } : {}),
  };
}

function runtimeNodeChanges<NodeType extends Node>(
  changes: NodeChange<NodeType>[],
  activeDragNodeIds: ReadonlySet<string>,
): NodeChange<NodeType>[] {
  return changes.filter((change) => {
    if (change.type === 'dimensions') {
      return change.dimensions !== undefined;
    }

    return change.type === 'position' && change.position !== undefined && activeDragNodeIds.has(change.id);
  });
}

/**
 * Keeps React Flow's measurement and actively-dragged position separate from
 * the canonical diagram model. Add/remove/replace/select changes stay canonical.
 */
export function applyControlledNodeChanges<NodeType extends Node>(
  canonicalNodes: NodeType[],
  runtime: ControlledNodeRuntime,
  changes: NodeChange<NodeType>[],
  activeDragNodeIds: ReadonlySet<string>,
): ControlledNodeRuntime {
  const applicableChanges = runtimeNodeChanges(changes, activeDragNodeIds);
  if (applicableChanges.length === 0) {
    return reconcileControlledNodeRuntime(canonicalNodes, runtime);
  }

  const canonicalIds = new Set(canonicalNodes.map((node) => node.id));
  const next: ControlledNodeRuntime = {};
  for (const [id, value] of Object.entries(runtime)) {
    if (canonicalIds.has(id)) {
      next[id] = { ...value };
    }
  }

  const changedNodes = applyNodeChanges(applicableChanges, composeControlledNodes(canonicalNodes, next));
  const positionChangeIds = new Set(applicableChanges.filter((change) => change.type === 'position').map((change) => change.id));
  const dimensionChangeIds = new Set(applicableChanges.filter((change) => change.type === 'dimensions').map((change) => change.id));

  for (const node of changedNodes) {
    if (!positionChangeIds.has(node.id) && !dimensionChangeIds.has(node.id)) {
      continue;
    }

    const previous = next[node.id] ?? {};
    const updated: NodeRuntime = { ...previous };
    if (dimensionChangeIds.has(node.id)) {
      updated.measured = node.measured;
    }
    if (positionChangeIds.has(node.id)) {
      updated.position = node.position;
      updated.dragging = node.dragging === true;
    }
    next[node.id] = updated;
  }

  return reconcileControlledNodeRuntime(canonicalNodes, next);
}

/** Releases local drag ownership after its single durable flush, retaining measurement. */
export function releaseControlledNodeRuntime(
  runtime: ControlledNodeRuntime,
  nodeIds: Iterable<string>,
): ControlledNodeRuntime {
  const releasedNodeIds = new Set(nodeIds);
  const next: ControlledNodeRuntime = {};

  for (const [id, value] of Object.entries(runtime)) {
    const nextValue = releasedNodeIds.has(id)
      ? { measured: value.measured }
      : value;
    if (hasRuntimeValue(nextValue)) {
      next[id] = nextValue;
    }
  }

  return sameRuntime(runtime, next) ? runtime : next;
}

/** Drops runtime state for ids no longer present in the canonical diagram. */
export function reconcileControlledNodeRuntime<NodeType extends Node>(
  canonicalNodes: NodeType[],
  runtime: ControlledNodeRuntime,
): ControlledNodeRuntime {
  const canonicalIds = new Set(canonicalNodes.map((node) => node.id));
  const next: ControlledNodeRuntime = {};

  for (const [id, value] of Object.entries(runtime)) {
    if (canonicalIds.has(id) && hasRuntimeValue(value)) {
      next[id] = value;
    }
  }

  return sameRuntime(runtime, next) ? runtime : next;
}

/** Canonical domain fields always win; only React Flow view-runtime fields overlay them. */
export function composeControlledNodes<NodeType extends Node>(
  canonicalNodes: NodeType[],
  runtime: ControlledNodeRuntime,
): NodeType[] {
  return canonicalNodes.map((canonical) => composeControlledNode(canonical, runtime[canonical.id]));
}

/**
 * Reuses an unchanged stable-id node object while another node is dragged.
 * This keeps React Flow from re-adopting every node on each pointer update.
 */
export function createControlledNodeComposer<NodeType extends Node>(): ControlledNodeComposer<NodeType> {
  const cache = new Map<string, ComposedNodeCacheEntry<NodeType>>();

  return {
    compose(canonicalNodes, runtime) {
      const currentIds = new Set<string>();
      const composedNodes = canonicalNodes.map((canonical) => {
        currentIds.add(canonical.id);
        const runtimeValue = runtime[canonical.id];
        const cached = cache.get(canonical.id);
        if (cached
          && areEquivalentValues(cached.canonical, canonical)
          && sameRuntimeValue(cached.runtime, runtimeValue)) {
          return cached.composed;
        }

        const composed = composeControlledNode(canonical, runtimeValue);
        cache.set(canonical.id, { canonical, composed, runtime: runtimeValue });
        return composed;
      });

      for (const id of cache.keys()) {
        if (!currentIds.has(id)) {
          cache.delete(id);
        }
      }
      return composedNodes;
    },
  };
}
