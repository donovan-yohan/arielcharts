'use client';

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  ConnectionLineType,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnConnectEnd,
  type OnConnectStart,
  type OnNodeDrag,
  type Viewport,
} from '@xyflow/react';
import {
  ArrowRightFromLine,
  Pencil,
  Plus,
  RotateCcw,
  ScanSearch,
  Shapes,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { DiagramEdgeIdentity, DiagramLink, DiagramLinkType, DiagramNode, DiagramNodeShape, DiagramSubgraph, FlowchartSnapshot } from '../lib/diagram-mutations';
import { getDiagramEdgeIdentity, resolveDiagramEdgeIndex } from '../lib/diagram-mutations';
import { measureUnobscuredCanvasViewport, type ViewportRect } from '../lib/canvas-viewport';
import { shouldCanvasHandleEscape } from '../lib/canvas-keyboard-ownership';
import { getConnectNodeActivation } from '../lib/diagram-connect-state';
import { getDiagramEdgeIdentityForFlowEdge, getFlowEdgeId, getVisibleDiagramLinks } from '../lib/diagram-flow-identity';
import type { DiagramNodePositions, NodePositionsSyncMode } from '../lib/diagram-layout';
import {
  extractMermaidPresentation,
  getCanvasHandlePaint,
  getCanvasNodePaint,
  type MermaidItemPresentation,
  type MermaidPresentation,
} from '../lib/mermaid-presentation';
import { getRendererKind, shouldFitRendererKindTransition } from '../lib/renderer-camera-policy';
import {
  buildSvgHitMap,
  getBoundsCenter,
  getBoundsUnion,
  getNodePortPosition,
  type SvgBounds,
  type SvgHitMap,
  type SvgPoint,
} from '../lib/svg-hit-map';
import { getSafeToolbarPosition } from '../lib/toolbar-safe-area';

export interface DiagramCanvasProps {
  className?: string;
  emptyMessage?: string;
  graph: FlowchartSnapshot | null;
  interactionMode?: 'select' | 'connect';
  isFlowchart?: boolean;
  nodePositions?: DiagramNodePositions;
  readOnly?: boolean;
  selectedNodeIds?: string[];
  svg: string;
  theme?: 'light' | 'dark';
  onAddEdge?: (source: string, target: string, label?: string, type?: DiagramLinkType) => void;
  onAddNode?: (label: string, shape: DiagramNodeShape) => void;
  onAddConnectedNode?: (source: string, label: string, shape: DiagramNodeShape, position: SvgPoint, type: DiagramLinkType) => void;
  onChangeNodeShape?: (nodeId: string, newShape: DiagramNodeShape) => void;
  onDeleteEdge?: (edge: DiagramEdgeIdentity) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  onEditEdgeLabel?: (edge: DiagramEdgeIdentity, label?: string) => void;
  onEditNodeLabel?: (nodeId: string, newLabel: string) => void;
  onGroupNodes?: (nodeIds: string[], label: string) => void;
  onInteractionModeChange?: (mode: 'select' | 'connect') => void;
  onNodeDrag?: (nodeId: string, position: SvgPoint) => void;
  onNodeDragStart?: (nodeId: string, position: SvgPoint) => void;
  onNodeDragStop?: (nodeId: string, position: SvgPoint) => void;
  onNodePositionsChange?: (positions: DiagramNodePositions, mode?: NodePositionsSyncMode) => void;
  onSelectedNodeIdsChange?: (nodeIds: string[]) => void;
  onUngroupNodes?: (subgraphId: string) => void;
}

interface ViewportState {
  panX: number;
  panY: number;
  zoom: number;
}

interface ScreenRect extends SvgBounds {}

interface PendingEdge {
  midpoint: SvgPoint;
  source: string;
  target: string;
}

interface MermaidFlowNodeData extends Record<string, unknown> {
  ariaLabel: string;
  label: string;
  presentation: MermaidItemPresentation;
  shape: DiagramNodeShape;
}

type MermaidFlowNode = Node<MermaidFlowNodeData, 'mermaidFlowNode'>;

interface FlowNodeInteractionContextValue {
  connectMode: boolean;
  focusedNodeId: string | null;
  onFocus: (nodeId: string) => void;
  onKeyDown: (nodeId: string, event: ReactKeyboardEvent<HTMLElement>) => void;
  registerNodeElement: (nodeId: string, element: HTMLElement | null) => void;
}

const FLOW_NODE_TYPES: NodeTypes = {
  mermaidFlowNode: MermaidReactFlowNode,
};
const FLOW_PRO_OPTIONS = { hideAttribution: true };
const FLOW_EDGE_COLOR = 'var(--diagram-item-stroke-fallback)';
const FLOW_EDGE_MARKER_CIRCLE_ID = 'arielcharts-flow-edge-circle';
const FLOW_EDGE_MARKER_CROSS_ID = 'arielcharts-flow-edge-cross';
const FLOW_HANDLE_POSITIONS = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const;
const GHOST_NODE_WIDTH = 144;
const GHOST_NODE_HEIGHT = 56;
const FlowNodeInteractionContext = createContext<FlowNodeInteractionContextValue | null>(null);

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const EDITOR_MIN_ZOOM = 0.4;
const FIT_PADDING = 64;
const BOTTOM_TOOLBAR_INSET = 12;
const BOTTOM_CONTROLS_HEIGHT = 34;
const BOTTOM_TOOLBAR_GAP = 8;
const DEFAULT_NEW_NODE_LABEL = 'New Node';
const DEFAULT_NEW_NODE_SHAPE: DiagramNodeShape = 'rect';
const SHAPE_OPTIONS: Array<{ label: string; value: DiagramNodeShape }> = [
  { label: 'rect', value: 'rect' },
  { label: 'round', value: 'round' },
  { label: 'diamond', value: 'diamond' },
  { label: 'circle', value: 'circle' },
  { label: 'ellipse', value: 'ellipse' },
  { label: 'hexagon', value: 'hexagon' },
  { label: 'stadium', value: 'stadium' },
  { label: 'subroutine', value: 'subroutine' },
  { label: 'cylinder', value: 'cylinder' },
  { label: 'trapezoid', value: 'trapezoid' },
];
const CONNECTION_TYPE_OPTIONS: Array<{ label: string; value: DiagramLinkType }> = [
  { label: 'arrow', value: 'arrow_point' },
  { label: 'open', value: 'arrow_open' },
  { label: 'circle', value: 'arrow_circle' },
  { label: 'cross', value: 'arrow_cross' },
];
const TOOLBAR_BUTTON_STYLE: CSSProperties = {
  alignItems: 'center',
  background: 'transparent',
  border: 'none',
  borderRadius: 4,
  color: 'var(--ink-muted)',
  display: 'inline-flex',
  height: 24,
  justifyContent: 'center',
  padding: 0,
  pointerEvents: 'auto',
  width: 24,
};

export function DiagramCanvas({
  className,
  emptyMessage = 'start typing mermaid syntax',
  graph,
  interactionMode,
  isFlowchart = true,
  nodePositions,
  onAddEdge,
  onAddNode,
  onAddConnectedNode,
  onChangeNodeShape,
  onDeleteEdge,
  onDeleteNodes,
  onEditEdgeLabel,
  onEditNodeLabel,
  onGroupNodes,
  onInteractionModeChange,
  onNodeDrag,
  onNodeDragStart,
  onNodeDragStop,
  onNodePositionsChange,
  onSelectedNodeIdsChange,
  onUngroupNodes,
  readOnly = false,
  selectedNodeIds,
  svg,
  theme = 'dark',
}: DiagramCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgContainerRef = useRef<HTMLDivElement | null>(null);
  const nodeButtonRefs = useRef(new Map<string, HTMLElement | null>());
  const [hitMap, setHitMap] = useState<SvgHitMap | null>(null);
  const [mermaidPresentation, setMermaidPresentation] = useState<MermaidPresentation>({ edges: [], nodes: new Map() });
  const [canvasViewport, setCanvasViewport] = useState<ViewportRect>({ height: 0, width: 0, x: 0, y: 0 });
  const [canvasSize, setCanvasSize] = useState({ height: 0, width: 0 });
  const [uncontrolledNodePositions, setUncontrolledNodePositions] = useState<DiagramNodePositions>({});
  const [liveNodePositions, setLiveNodePositions] = useState<DiagramNodePositions>({});
  const activeDragNodeIdsRef = useRef(new Set<string>());
  const persistedNodePositions = nodePositions ?? uncontrolledNodePositions;
  const persistedNodePositionsRef = useRef<DiagramNodePositions>(persistedNodePositions);
  const hasAutoFitInitialRenderRef = useRef(false);
  const previousRendererKindRef = useRef<ReturnType<typeof getRendererKind> | null>(null);
  const pendingRendererKindFitAfterRenderRef = useRef<number | null>(null);
  const [renderedSvgRevision, setRenderedSvgRevision] = useState(0);
  const visibleNodePositions = useMemo(
    () => ({ ...persistedNodePositions, ...liveNodePositions }),
    [liveNodePositions, persistedNodePositions],
  );
  const dragStateRef = useRef<{ originX: number; originY: number; startPanX: number; startPanY: number } | null>(null);
  const connectionStartNodeIdRef = useRef<string | null>(null);
  const isControlledSelection = selectedNodeIds !== undefined;
  const [internalSelection, setInternalSelection] = useState<string[]>(selectedNodeIds ?? []);
  const selection = isControlledSelection ? selectedNodeIds : internalSelection;
  const [internalMode, setInternalMode] = useState<'select' | 'connect'>(interactionMode ?? 'select');
  const mode = interactionMode ?? internalMode;
  const [viewport, setViewport] = useState<ViewportState>({ panX: 24, panY: 24, zoom: 1 });
  const [animateTransform, setAnimateTransform] = useState(false);
  const [isPanning, setIsPanning] = useState(false);
  const [spacePressed, setSpacePressed] = useState(false);
  const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
  const [editingLabel, setEditingLabel] = useState('');
  const [selectedEdgeIdentity, setSelectedEdgeIdentity] = useState<DiagramEdgeIdentity | null>(null);
  const [editingEdgeIdentity, setEditingEdgeIdentity] = useState<DiagramEdgeIdentity | null>(null);
  const [editingEdgeLabel, setEditingEdgeLabel] = useState('');
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [connectionPreviewSourceId, setConnectionPreviewSourceId] = useState<string | null>(null);
  const [cursorPoint, setCursorPoint] = useState<SvgPoint | null>(null);
  const [pendingEdge, setPendingEdge] = useState<PendingEdge | null>(null);
  const [pendingEdgeLabel, setPendingEdgeLabel] = useState('');
  const [groupPromptValue, setGroupPromptValue] = useState('');
  const [showGroupPrompt, setShowGroupPrompt] = useState(false);
  const [newNodeLabel, setNewNodeLabel] = useState('');
  const [newNodeShape, setNewNodeShape] = useState<DiagramNodeShape>(DEFAULT_NEW_NODE_SHAPE);
  const [selectedConnectionType, setSelectedConnectionType] = useState<DiagramLinkType>('arrow_point');
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [toolbarOpen, setToolbarOpen] = useState(false);

  const setNodePositions = useCallback((
    update: (current: DiagramNodePositions) => DiagramNodePositions,
    mode: NodePositionsSyncMode = 'merge',
    syncPositions?: DiagramNodePositions | null,
  ) => {
    const currentPositions = persistedNodePositionsRef.current;
    const next = update(currentPositions);
    if (next === currentPositions) {
      return;
    }

    persistedNodePositionsRef.current = next;
    if (nodePositions === undefined) {
      setUncontrolledNodePositions(next);
    }
    if (syncPositions !== null) {
      onNodePositionsChange?.(syncPositions ?? (mode === 'remove' ? {} : next), mode);
    }
  }, [nodePositions, onNodePositionsChange]);

  useEffect(() => {
    persistedNodePositionsRef.current = persistedNodePositions;
  }, [persistedNodePositions]);

  const interactiveNodeBounds = useMemo(() => {
    if (!hitMap) {
      return null;
    }

    const boundsByNodeId = new Map(hitMap.nodes);
    Object.entries(visibleNodePositions).forEach(([nodeId, position]) => {
      const bounds = boundsByNodeId.get(nodeId);
      if (!bounds) {
        return;
      }

      boundsByNodeId.set(nodeId, {
        ...bounds,
        x: position.x,
        y: position.y,
      });
    });

    return boundsByNodeId;
  }, [hitMap, visibleNodePositions]);

  const orderedNodeIds = useMemo(() => {
    if (graph?.nodes.length) {
      return graph.nodes.map((node) => node.id).filter((nodeId) => interactiveNodeBounds?.has(nodeId) ?? false);
    }

    return interactiveNodeBounds ? [...interactiveNodeBounds.keys()] : [];
  }, [graph?.nodes, interactiveNodeBounds]);

  const connectionMap = useMemo(() => {
    const incoming = new Map<string, string[]>();
    const outgoing = new Map<string, string[]>();

    graph?.links.forEach((link) => {
      outgoing.set(link.source, [...(outgoing.get(link.source) ?? []), link.target]);
      incoming.set(link.target, [...(incoming.get(link.target) ?? []), link.source]);
    });

    return { incoming, outgoing };
  }, [graph?.links]);

  const nodeById = useMemo(() => new Map(graph?.nodes.map((node) => [node.id, node]) ?? []), [graph?.nodes]);
  const selectedEdgeIndex = useMemo(() => (
    graph && selectedEdgeIdentity ? resolveDiagramEdgeIndex(graph.links, selectedEdgeIdentity, { includeLabel: false }) : null
  ), [graph, selectedEdgeIdentity]);
  const editingEdgeIndex = useMemo(() => (
    graph && editingEdgeIdentity ? resolveDiagramEdgeIndex(graph.links, editingEdgeIdentity, { includeLabel: false }) : null
  ), [editingEdgeIdentity, graph]);
  const selectedCurrentEdgeIdentity = useMemo(() => {
    if (!graph || selectedEdgeIndex === null) {
      return null;
    }

    const edge = graph.links[selectedEdgeIndex];
    return edge ? getDiagramEdgeIdentity(edge, selectedEdgeIndex) : null;
  }, [graph, selectedEdgeIndex]);

  const selectedBounds = useMemo(() => {
    if (!hitMap || selection.length === 0) {
      return null;
    }

    const boundsList = selection
      .map((nodeId) => interactiveNodeBounds?.get(nodeId))
      .filter((bounds): bounds is SvgBounds => bounds !== undefined);

    return getBoundsUnion(boundsList);
  }, [hitMap, interactiveNodeBounds, selection]);

  const graphBounds = useMemo(() => {
    if (!hitMap) {
      return null;
    }

    if (!isFlowchart) {
      return hitMap.viewBox;
    }

    const nodeBounds = interactiveNodeBounds ? [...interactiveNodeBounds.values()] : [...hitMap.nodes.values()];
    const allBounds = nodeBounds.length > 0
      ? [...nodeBounds, ...hitMap.subgraphs.values()]
      : [...hitMap.subgraphs.values(), ...[...hitMap.edges.values()].map((edge) => edge.bounds)];

    return getBoundsUnion(allBounds) ?? hitMap.viewBox;
  }, [hitMap, interactiveNodeBounds, isFlowchart]);

  const flowNodes = useMemo<MermaidFlowNode[]>(() => {
    if (!graph || !interactiveNodeBounds) {
      return [];
    }

    const nextNodes: MermaidFlowNode[] = [];
    graph.nodes.forEach((node) => {
      const bounds = interactiveNodeBounds.get(node.id);
      if (!bounds) {
        return;
      }

      const nodeLabel = getNodeText(node);
      const ariaLabel = getNodeAriaLabel(node.shape, nodeLabel);
      nextNodes.push({
        ariaLabel,
        data: {
          ariaLabel,
          label: nodeLabel,
          presentation: mermaidPresentation.nodes.get(node.id) ?? {},
          shape: node.shape,
        },
        draggable: isFlowchart && !readOnly,
        focusable: false,
        id: node.id,
        position: { x: bounds.x, y: bounds.y },
        selectable: true,
        selected: selection.includes(node.id),
        style: {
          height: bounds.height,
          width: bounds.width,
        },
        type: 'mermaidFlowNode',
      });
    });

    return nextNodes;
  }, [graph, interactiveNodeBounds, isFlowchart, mermaidPresentation.nodes, readOnly, selection]);

  const hasPersistedLayout = Object.keys(persistedNodePositions).length > 0;
  const canEditStructure = isFlowchart && !readOnly;
  const rendererKind = getRendererKind(isFlowchart);

  const flowEdges = useMemo<Edge[]>(() => {
    if (!graph || !interactiveNodeBounds) {
      return [];
    }

    return getVisibleDiagramLinks(graph.links, interactiveNodeBounds)
      .map(({ graphIndex, link }) => ({
        animated: false,
        data: { index: graphIndex },
        id: getFlowEdgeId(graphIndex),
        label: getLinkText(link),
        selectable: true,
        selected: selectedEdgeIndex === graphIndex,
        ...getFlowEdgeHandles(link, interactiveNodeBounds, graph.direction),
        ...getFlowEdgePresentation(link, mermaidPresentation.edges[graphIndex]),
        source: link.source,
        target: link.target,
        type: 'smoothstep',
      }));
  }, [graph, interactiveNodeBounds, mermaidPresentation.edges, selectedEdgeIndex]);

  const useReactFlowRenderer = isFlowchart && flowNodes.length > 0;
  const flowViewport = useMemo<Viewport>(() => ({
    x: viewport.panX,
    y: viewport.panY,
    zoom: viewport.zoom,
  }), [viewport.panX, viewport.panY, viewport.zoom]);

  const screenSelectionBounds = useMemo(() => {
    if (!selectedBounds) {
      return null;
    }

    return toScreenRect(selectedBounds, viewport);
  }, [selectedBounds, viewport]);

  const editingNode = useMemo(() => {
    if (!graph || !editingNodeId) {
      return null;
    }

    return nodeById.get(editingNodeId) ?? null;
  }, [editingNodeId, graph, nodeById]);

  const editingNodeBounds = useMemo(() => {
    if (!hitMap || !editingNodeId) {
      return null;
    }

    const bounds = interactiveNodeBounds?.get(editingNodeId);
    return bounds ? toScreenRect(bounds, viewport) : null;
  }, [editingNodeId, hitMap, interactiveNodeBounds, viewport]);

  const selectedEdge = selectedEdgeIndex === null ? null : graph?.links[selectedEdgeIndex] ?? null;
  const selectedEdgeMidpoint = useMemo(() => (
    selectedEdge && interactiveNodeBounds ? getEdgeMidpoint(selectedEdge, interactiveNodeBounds) : null
  ), [interactiveNodeBounds, selectedEdge]);
  const selectedEdgeToolbarPosition = useMemo(() => {
    const midpoint = selectedEdgeMidpoint ? toScreenPoint(selectedEdgeMidpoint, viewport) : { x: 12, y: 12 };
    return getSafeToolbarPosition({
      anchor: midpoint,
      canvas: canvasViewport,
      toolbar: { height: 34, width: 84 },
    });
  }, [canvasViewport, selectedEdgeMidpoint, viewport]);

  const editingEdgeMidpoint = useMemo(() => {
    if (editingEdgeIndex === null || !graph || !interactiveNodeBounds) {
      return null;
    }

    const edge = graph.links[editingEdgeIndex];
    return edge ? getEdgeMidpoint(edge, interactiveNodeBounds) : null;
  }, [editingEdgeIndex, graph, interactiveNodeBounds]);

  const connectSourceBounds = useMemo(() => {
    if (!connectSourceId || !interactiveNodeBounds) {
      return null;
    }

    return interactiveNodeBounds.get(connectSourceId) ?? null;
  }, [connectSourceId, interactiveNodeBounds]);

  const connectSourcePort = useMemo(() => {
    if (!connectSourceBounds) {
      return null;
    }

    return getNodePortPosition(connectSourceBounds, 'right');
  }, [connectSourceBounds]);

  const rubberBandPoints = useMemo(() => {
    if (!connectSourcePort || !cursorPoint) {
      return null;
    }

    return {
      from: toScreenPoint(connectSourcePort, viewport),
      to: toScreenPoint(cursorPoint, viewport),
    };
  }, [connectSourcePort, cursorPoint, viewport]);

  const connectionGhostRect = useMemo(() => {
    if (!connectionPreviewSourceId || !cursorPoint || readOnly) {
      return null;
    }

    return toScreenRect({
      height: GHOST_NODE_HEIGHT,
      width: GHOST_NODE_WIDTH,
      x: cursorPoint.x - (GHOST_NODE_WIDTH / 2),
      y: cursorPoint.y - (GHOST_NODE_HEIGHT / 2),
    }, viewport);
  }, [connectionPreviewSourceId, cursorPoint, readOnly, viewport]);

  const displayedToolbarRect = screenSelectionBounds ?? { height: 0, width: 0, x: 16, y: 16 };
  const selectedToolbarPosition = getSafeToolbarPosition({
    anchor: {
      x: displayedToolbarRect.x + (displayedToolbarRect.width / 2),
      y: displayedToolbarRect.y,
    },
    canvas: canvasViewport,
    toolbar: { height: 34, width: 188 },
  });
  const toolbarStyle: CSSProperties = {
    alignItems: 'center',
    background: 'var(--control-surface)',
    border: '1px solid var(--control-border)',
    borderRadius: 8,
    boxShadow: 'var(--shadow-elevated)',
    display: 'inline-flex',
    gap: 6,
    left: selectedToolbarPosition.left,
    maxWidth: canvasViewport.width > 0 ? Math.max(1, canvasViewport.width - (BOTTOM_TOOLBAR_INSET * 2)) : 'calc(100% - 24px)',
    padding: '4px 6px',
    pointerEvents: 'auto',
    position: 'absolute',
    top: selectedToolbarPosition.top,
    zIndex: 30,
  };

  const setSelection = useCallback((nodeIds: string[]) => {
    onSelectedNodeIdsChange?.(nodeIds);
    if (!isControlledSelection) {
      setInternalSelection(nodeIds);
    }
  }, [isControlledSelection, onSelectedNodeIdsChange]);

  const setMode = useCallback((nextMode: 'select' | 'connect') => {
    if (!isFlowchart && nextMode !== 'select') {
      return;
    }
    onInteractionModeChange?.(nextMode);
    if (interactionMode === undefined) {
      setInternalMode(nextMode);
    }
  }, [interactionMode, isFlowchart, onInteractionModeChange]);

  const fitBoundsToViewport = useCallback((bounds: SvgBounds, animated: boolean) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const visibleViewport = measureUnobscuredCanvasViewport(container);
    const availableWidth = Math.max(1, visibleViewport.width - (FIT_PADDING * 2));
    const availableHeight = Math.max(1, visibleViewport.height - (FIT_PADDING * 2));
    const zoom = clamp(
      Math.min(availableWidth / Math.max(bounds.width, 1), availableHeight / Math.max(bounds.height, 1)),
      MIN_ZOOM,
      MAX_ZOOM,
    );

    const panX = visibleViewport.x + ((visibleViewport.width - (bounds.width * zoom)) / 2) - (bounds.x * zoom);
    const panY = visibleViewport.y + ((visibleViewport.height - (bounds.height * zoom)) / 2) - (bounds.y * zoom);

    setAnimateTransform(animated);
    setViewport({ panX, panY, zoom });
  }, []);

  const fitToDiagram = useCallback((animated: boolean) => {
    if (!graphBounds) {
      return;
    }

    fitBoundsToViewport(graphBounds, animated);
  }, [fitBoundsToViewport, graphBounds]);

  const focusNode = useCallback((nodeId: string | null) => {
    if (!nodeId) {
      return;
    }

    setFocusedNodeId(nodeId);
    window.requestAnimationFrame(() => {
      nodeButtonRefs.current.get(nodeId)?.focus();
    });
  }, []);

  const moveFocus = useCallback((currentNodeId: string, direction: 'up' | 'down' | 'left' | 'right') => {
    if (!interactiveNodeBounds) {
      return;
    }

    const currentBounds = interactiveNodeBounds.get(currentNodeId);
    if (!currentBounds) {
      return;
    }

    const currentCenter = getBoundsCenter(currentBounds);
    const directionalCandidates = direction === 'left' || direction === 'up'
      ? connectionMap.incoming.get(currentNodeId) ?? []
      : connectionMap.outgoing.get(currentNodeId) ?? [];
    const connectedCandidates = Array.from(new Set([
      ...directionalCandidates,
      ...(connectionMap.incoming.get(currentNodeId) ?? []),
      ...(connectionMap.outgoing.get(currentNodeId) ?? []),
    ])).filter((candidateId) => candidateId !== currentNodeId && interactiveNodeBounds.has(candidateId));

    const ranked = connectedCandidates
      .map((candidateId) => {
        const bounds = interactiveNodeBounds.get(candidateId);
        if (!bounds) {
          return null;
        }

        const center = getBoundsCenter(bounds);
        const dx = center.x - currentCenter.x;
        const dy = center.y - currentCenter.y;
        const matchesDirection = (
          (direction === 'right' && dx > 0)
          || (direction === 'left' && dx < 0)
          || (direction === 'down' && dy > 0)
          || (direction === 'up' && dy < 0)
        );
        const primaryDistance = direction === 'left' || direction === 'right' ? Math.abs(dx) : Math.abs(dy);
        const crossDistance = direction === 'left' || direction === 'right' ? Math.abs(dy) : Math.abs(dx);

        return {
          candidateId,
          crossDistance,
          matchesDirection,
          primaryDistance,
        };
      })
      .filter((candidate): candidate is { candidateId: string; crossDistance: number; matchesDirection: boolean; primaryDistance: number } => candidate !== null)
      .sort((left, right) => {
        if (left.matchesDirection !== right.matchesDirection) {
          return left.matchesDirection ? -1 : 1;
        }
        if (left.primaryDistance !== right.primaryDistance) {
          return left.primaryDistance - right.primaryDistance;
        }
        return left.crossDistance - right.crossDistance;
      });

    focusNode(ranked[0]?.candidateId ?? null);
  }, [connectionMap.incoming, connectionMap.outgoing, focusNode, interactiveNodeBounds]);

  useEffect(() => {
    if (!selectedNodeIds) {
      return;
    }

    setInternalSelection(selectedNodeIds);
  }, [selectedNodeIds]);

  useEffect(() => {
    if (interactionMode) {
      setInternalMode(interactionMode);
    }
  }, [interactionMode]);

  useEffect(() => {
    if (!svg || !svgContainerRef.current) {
      setHitMap(null);
      setMermaidPresentation({ edges: [], nodes: new Map() });
      return;
    }

    let frameId = 0;
    frameId = window.requestAnimationFrame(() => {
      const svgElement = svgContainerRef.current?.querySelector('svg');
      if (!svgElement) {
        setHitMap(null);
        setMermaidPresentation({ edges: [], nodes: new Map() });
        return;
      }

      setHitMap(buildSvgHitMap(svgElement));
      setMermaidPresentation(extractMermaidPresentation(svgElement));
      setRenderedSvgRevision((revision) => revision + 1);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [svg]);

  useEffect(() => {
    const previousRendererKind = previousRendererKindRef.current;
    previousRendererKindRef.current = rendererKind;
    if (shouldFitRendererKindTransition(previousRendererKind, rendererKind)) {
      pendingRendererKindFitAfterRenderRef.current = renderedSvgRevision;
    }
  }, [rendererKind, renderedSvgRevision]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const updateViewport = () => {
      const next = measureUnobscuredCanvasViewport(container);
      setCanvasSize((current) => current.height === container.clientHeight && current.width === container.clientWidth
        ? current
        : { height: container.clientHeight, width: container.clientWidth });
      setCanvasViewport((current) => areViewportRectsEqual(current, next) ? current : next);
    };
    updateViewport();
    const resizeObserver = new ResizeObserver(updateViewport);
    resizeObserver.observe(container);
    const mutationObserver = new MutationObserver(updateViewport);
    mutationObserver.observe(container.closest('.workspace-main') ?? container.parentElement ?? container, { childList: true });
    return () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (!graph) {
      setNodePositions((current) => (Object.keys(current).length > 0 ? {} : current), 'merge', null);
      setLiveNodePositions({});
      return;
    }

    const currentNodeIds = new Set(graph.nodes.map((node) => node.id));
    const removedPositions: DiagramNodePositions = {};
    setNodePositions((current) => {
      const next: DiagramNodePositions = {};
      for (const [nodeId, position] of Object.entries(current)) {
        if (currentNodeIds.has(nodeId)) {
          next[nodeId] = position;
        } else {
          removedPositions[nodeId] = position;
        }
      }

      return Object.keys(next).length === Object.keys(current).length ? current : next;
    }, 'remove', removedPositions);
    setLiveNodePositions((current) => Object.fromEntries(
      Object.entries(current).filter(([nodeId]) => currentNodeIds.has(nodeId)),
    ));
  }, [graph, setNodePositions]);

  useEffect(() => {
    if (selection.length === 0) {
      setToolbarOpen(false);
      return;
    }

    if (!selection.includes(focusedNodeId ?? '')) {
      setFocusedNodeId(selection[0] ?? null);
    }
  }, [focusedNodeId, selection]);

  useEffect(() => {
    if (selectedEdgeIdentity && selectedEdgeIndex === null) {
      setSelectedEdgeIdentity(null);
    }
    if (editingEdgeIdentity && editingEdgeIndex === null) {
      setEditingEdgeIdentity(null);
      setEditingEdgeLabel('');
    }
  }, [editingEdgeIdentity, editingEdgeIndex, selectedEdgeIdentity, selectedEdgeIndex]);

  useEffect(() => {
    if (orderedNodeIds.length === 0 && graph) {
      hasAutoFitInitialRenderRef.current = false;
    }
  }, [graph, orderedNodeIds.length]);

  useEffect(() => {
    if (!orderedNodeIds.length) {
      setFocusedNodeId(null);
      return;
    }

    if (!focusedNodeId || !orderedNodeIds.includes(focusedNodeId)) {
      setFocusedNodeId(orderedNodeIds[0] ?? null);
    }
  }, [focusedNodeId, orderedNodeIds]);

  useEffect(() => {
    if (!graphBounds || !svg || hasAutoFitInitialRenderRef.current) {
      return;
    }

    hasAutoFitInitialRenderRef.current = true;
    fitBoundsToViewport(graphBounds, false);
  }, [fitBoundsToViewport, graphBounds, svg]);

  useEffect(() => {
    const fitAfterRevision = pendingRendererKindFitAfterRenderRef.current;
    if (fitAfterRevision === null || renderedSvgRevision <= fitAfterRevision || !graphBounds || !svg) {
      return;
    }

    pendingRendererKindFitAfterRenderRef.current = null;
    fitBoundsToViewport(graphBounds, false);
  }, [fitBoundsToViewport, graphBounds, renderedSvgRevision, svg]);

  useEffect(() => {
    if (!animateTransform) {
      return;
    }

    const timeout = window.setTimeout(() => {
      setAnimateTransform(false);
    }, 180);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [animateTransform]);

  useEffect(() => {
    if (isFlowchart) {
      return;
    }

    setSelection([]);
    setMode('select');
    setToolbarOpen(false);
    setShapePickerOpen(false);
    setEditingNodeId(null);
    setEditingEdgeIdentity(null);
    setEditingEdgeLabel('');
    setSelectedEdgeIdentity(null);
    setPendingEdge(null);
    setPendingEdgeLabel('');
    setConnectSourceId(null);
    connectionStartNodeIdRef.current = null;
    setConnectionPreviewSourceId(null);
    setShowGroupPrompt(false);
  }, [isFlowchart, setMode, setSelection]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingElement(event.target)) {
        return;
      }

      if (event.code === 'Space') {
        setSpacePressed(true);
      }

      const canvas = containerRef.current;
      const ownsEscape = canvas
        ? shouldCanvasHandleEscape(
          event.target instanceof Node && canvas.contains(event.target),
          document.activeElement !== null && canvas.contains(document.activeElement),
        )
        : false;

      if (event.key === 'Escape' && ownsEscape) {
        setShapePickerOpen(false);
        setPendingEdge(null);
        setPendingEdgeLabel('');
        setShowGroupPrompt(false);
        setConnectSourceId(null);
        connectionStartNodeIdRef.current = null;
        setConnectionPreviewSourceId(null);
        setCursorPoint(null);
        setToolbarOpen(false);
        setSelectedEdgeIdentity(null);
        setEditingEdgeIdentity(null);
        setEditingEdgeLabel('');
        setMode('select');
        canvas?.focus();
      }

      if (canEditStructure && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g' && selection.length > 0) {
        event.preventDefault();

        if (event.shiftKey) {
          const selectedSubgraph = graph?.subgraphs.find((subgraph) => selection.some((nodeId) => subgraph.nodes.includes(nodeId)));
          if (selectedSubgraph) {
            onUngroupNodes?.(selectedSubgraph.id);
          }
          return;
        }

        setGroupPromptValue('');
        setShowGroupPrompt(true);
      }

      if ((event.key === 'Delete' || event.key === 'Backspace') && canEditStructure) {
        if (selection.length > 0) {
          event.preventDefault();
          onDeleteNodes?.(selection);
          return;
        }

        if (selectedCurrentEdgeIdentity) {
          event.preventDefault();
          onDeleteEdge?.(selectedCurrentEdgeIdentity);
          setSelectedEdgeIdentity(null);
        }
      }
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.code === 'Space') {
        setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [canEditStructure, editingNodeId, graph, onDeleteEdge, onDeleteNodes, onUngroupNodes, selectedCurrentEdgeIdentity, selection, setMode]);

  useEffect(() => {
    if (viewport.zoom >= EDITOR_MIN_ZOOM) {
      return;
    }

    setEditingNodeId(null);
    setShapePickerOpen(false);
  }, [viewport.zoom]);

  const handleWheel = useCallback((event: React.WheelEvent<HTMLDivElement>) => {
    if (!containerRef.current) {
      return;
    }

    event.preventDefault();
    const rect = containerRef.current.getBoundingClientRect();
    const clientX = event.clientX - rect.left;
    const clientY = event.clientY - rect.top;
    const canvasX = (clientX - viewport.panX) / viewport.zoom;
    const canvasY = (clientY - viewport.panY) / viewport.zoom;
    const scaleFactor = event.deltaY > 0 ? 0.9 : 1.1;
    const zoom = clamp(viewport.zoom * scaleFactor, MIN_ZOOM, MAX_ZOOM);

    setAnimateTransform(false);
    setViewport({
      panX: clientX - (canvasX * zoom),
      panY: clientY - (canvasY * zoom),
      zoom,
    });
  }, [viewport.panX, viewport.panY, viewport.zoom]);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if ((event.button !== 1 && !spacePressed) || !containerRef.current) {
      return;
    }

    event.preventDefault();
    dragStateRef.current = {
      originX: event.clientX,
      originY: event.clientY,
      startPanX: viewport.panX,
      startPanY: viewport.panY,
    };
    setIsPanning(true);
  }, [spacePressed, viewport.panX, viewport.panY]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!containerRef.current || !hitMap) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const point = {
      x: (event.clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (event.clientY - rect.top - viewport.panY) / viewport.zoom,
    };

    setCursorPoint(point);

    if (!dragStateRef.current) {
      return;
    }

    const dx = event.clientX - dragStateRef.current.originX;
    const dy = event.clientY - dragStateRef.current.originY;
    setAnimateTransform(false);
    setViewport((current) => ({
      ...current,
      panX: (dragStateRef.current?.startPanX ?? current.panX) + dx,
      panY: (dragStateRef.current?.startPanY ?? current.panY) + dy,
    }));
  }, [hitMap, viewport.panX, viewport.panY, viewport.zoom]);

  const stopPanning = useCallback(() => {
    dragStateRef.current = null;
    setIsPanning(false);
  }, []);

  const handleCanvasClick = useCallback(() => {
    if (isPanning) {
      return;
    }

    setSelection([]);
    setSelectedEdgeIdentity(null);
    setEditingEdgeIdentity(null);
    setToolbarOpen(false);
    setShapePickerOpen(false);
    setEditingNodeId(null);
  }, [isPanning, setSelection]);

  const handleNodeClick = useCallback((nodeId: string, shiftKey: boolean) => {
    if (!isFlowchart) {
      return;
    }
    setShapePickerOpen(false);
    setSelectedEdgeIdentity(null);
    setEditingEdgeIdentity(null);
    setFocusedNodeId(nodeId);
    setToolbarOpen(true);

    if (mode === 'connect') {
      const activation = getConnectNodeActivation(nodeId, connectSourceId, interactiveNodeBounds);
      if (activation.kind === 'choose-source') {
        setConnectSourceId(activation.nodeId);
        return;
      }
      if (activation.kind === 'noop') {
        return;
      }
      setPendingEdge(activation.edge);
      setPendingEdgeLabel('');
      setConnectSourceId(null);
      return;
    }

    if (shiftKey) {
      setSelection(selection.includes(nodeId)
        ? selection.filter((id) => id !== nodeId)
        : [...selection, nodeId]);
      return;
    }

    setSelection([nodeId]);
  }, [connectSourceId, interactiveNodeBounds, isFlowchart, mode, selection, setSelection]);

  const commitNodeEdit = useCallback(() => {
    if (!canEditStructure || !editingNodeId) {
      return;
    }

    onEditNodeLabel?.(editingNodeId, editingLabel.trim() || editingNodeId);
    setEditingNodeId(null);
  }, [canEditStructure, editingLabel, editingNodeId, onEditNodeLabel]);

  const commitEdgeEdit = useCallback(() => {
    if (!canEditStructure || !editingEdgeIdentity) {
      return;
    }

    onEditEdgeLabel?.(editingEdgeIdentity, editingEdgeLabel.trim() || undefined);
    setEditingEdgeIdentity(null);
    setEditingEdgeLabel('');
  }, [canEditStructure, editingEdgeIdentity, editingEdgeLabel, onEditEdgeLabel]);

  const openEdgeEditor = useCallback((edge: DiagramEdgeIdentity) => {
    const edgeIndex = graph ? resolveDiagramEdgeIndex(graph.links, edge, { includeLabel: false }) : null;
    const currentEdge = edgeIndex === null ? null : graph?.links[edgeIndex];
    if (!canEditStructure || !currentEdge) {
      return;
    }

    setEditingEdgeIdentity(edge);
    setEditingEdgeLabel(getLinkText(currentEdge) ?? '');
  }, [canEditStructure, graph]);

  const commitPendingEdge = useCallback((label?: string) => {
    if (!canEditStructure || !pendingEdge) {
      return;
    }

    onAddEdge?.(pendingEdge.source, pendingEdge.target, label, selectedConnectionType);
    setPendingEdge(null);
    setPendingEdgeLabel('');
    setMode('select');
  }, [canEditStructure, onAddEdge, pendingEdge, selectedConnectionType, setMode]);

  const handleFlowNodeDragStart = useCallback<OnNodeDrag<MermaidFlowNode>>((_event, node) => {
    if (!canEditStructure) {
      return;
    }
    activeDragNodeIdsRef.current.add(node.id);
    setLiveNodePositions((current) => {
      return { ...current, [node.id]: node.position };
    });
    onNodeDragStart?.(node.id, node.position);
  }, [canEditStructure, onNodeDragStart]);

  const handleFlowNodeDrag = useCallback<OnNodeDrag<MermaidFlowNode>>((_event, node) => {
    if (!canEditStructure || !activeDragNodeIdsRef.current.has(node.id)) {
      return;
    }
    setLiveNodePositions((current) => ({ ...current, [node.id]: node.position }));
    onNodeDrag?.(node.id, node.position);
  }, [canEditStructure, onNodeDrag]);

  const handleFlowNodeDragStop = useCallback<OnNodeDrag<MermaidFlowNode>>((_event, node) => {
    if (!canEditStructure) {
      return;
    }
    activeDragNodeIdsRef.current.delete(node.id);
    if (onNodeDragStop) {
      onNodeDragStop(node.id, node.position);
    } else {
      setNodePositions((current) => ({
        ...current,
        [node.id]: node.position,
      }), 'merge', { [node.id]: node.position });
    }
    setLiveNodePositions((current) => {
      const next = { ...current };
      delete next[node.id];
      return next;
    });
  }, [canEditStructure, onNodeDragStop, setNodePositions]);

  const handleFlowConnectStart = useCallback<OnConnectStart>((_event, params) => {
    if (!canEditStructure) {
      return;
    }
    connectionStartNodeIdRef.current = params.nodeId ?? null;
    setConnectionPreviewSourceId(params.nodeId ?? null);
    setToolbarOpen(false);
  }, [canEditStructure]);

  const handleFlowConnectEnd = useCallback<OnConnectEnd>((event, connectionState: FinalConnectionState) => {
    const sourceNodeId = connectionStartNodeIdRef.current;
    connectionStartNodeIdRef.current = null;
    setConnectionPreviewSourceId(null);

    if (!canEditStructure || !sourceNodeId || connectionState.isValid) {
      return;
    }

    const clientPoint = getClientPoint(event);
    if (!clientPoint || !containerRef.current) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const dropPoint = {
      x: (clientPoint.x - rect.left - viewport.panX) / viewport.zoom,
      y: (clientPoint.y - rect.top - viewport.panY) / viewport.zoom,
    };
    const nodePosition = {
      x: dropPoint.x - (GHOST_NODE_WIDTH / 2),
      y: dropPoint.y - (GHOST_NODE_HEIGHT / 2),
    };

    onAddConnectedNode?.(sourceNodeId, DEFAULT_NEW_NODE_LABEL, DEFAULT_NEW_NODE_SHAPE, nodePosition, selectedConnectionType);
  }, [canEditStructure, onAddConnectedNode, selectedConnectionType, viewport.panX, viewport.panY, viewport.zoom]);

  const handleFlowConnect = useCallback((connection: Connection) => {
    connectionStartNodeIdRef.current = null;
    setConnectionPreviewSourceId(null);
    if (!canEditStructure || !connection.source || !connection.target || connection.source === connection.target || !interactiveNodeBounds) {
      return;
    }

    const midpoint = getEdgeMidpoint({
      source: connection.source,
      target: connection.target,
    }, interactiveNodeBounds) ?? { x: 0, y: 0 };

    setPendingEdge({ midpoint, source: connection.source, target: connection.target });
    setPendingEdgeLabel('');
  }, [canEditStructure, interactiveNodeBounds]);

  const addDefaultNode = useCallback(() => {
    if (!canEditStructure) {
      return;
    }
    onAddNode?.(DEFAULT_NEW_NODE_LABEL, DEFAULT_NEW_NODE_SHAPE);
  }, [canEditStructure, onAddNode]);

  const addNodeFromToolbar = useCallback(() => {
    if (!canEditStructure) {
      return;
    }
    onAddNode?.(newNodeLabel.trim() || DEFAULT_NEW_NODE_LABEL, newNodeShape);
    setNewNodeLabel('');
  }, [canEditStructure, newNodeLabel, newNodeShape, onAddNode]);

  const openNodeEditor = useCallback((node: DiagramNode) => {
    if (!canEditStructure) {
      return;
    }
    setToolbarOpen(false);
    setEditingNodeId(node.id);
    setEditingLabel(getNodeText(node));
  }, [canEditStructure]);

  const registerNodeElement = useCallback((nodeId: string, element: HTMLElement | null) => {
    if (element) {
      nodeButtonRefs.current.set(nodeId, element);
      return;
    }

    nodeButtonRefs.current.delete(nodeId);
  }, []);

  const handleNodeKeyDown = useCallback((nodeId: string, event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(nodeId, 'up');
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveFocus(nodeId, 'down');
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      moveFocus(nodeId, 'left');
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      moveFocus(nodeId, 'right');
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      handleNodeClick(nodeId, false);
    }
    if (event.key === 'F2') {
      event.preventDefault();
      const node = nodeById.get(nodeId);
      if (node && !readOnly) {
        openNodeEditor(node);
      }
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setToolbarOpen(false);
      containerRef.current?.focus();
    }
  }, [handleNodeClick, moveFocus, nodeById, openNodeEditor, readOnly]);

  const flowNodeInteraction = useMemo<FlowNodeInteractionContextValue>(() => ({
    connectMode: mode === 'connect',
    focusedNodeId,
    onFocus: setFocusedNodeId,
    onKeyDown: handleNodeKeyDown,
    registerNodeElement,
  }), [focusedNodeId, handleNodeKeyDown, mode, registerNodeElement]);

  const transformStyle: CSSProperties = {
    inset: 0,
    position: 'absolute',
    transform: `translate(${viewport.panX}px, ${viewport.panY}px) scale(${viewport.zoom})`,
    transformOrigin: '0 0',
    transition: animateTransform ? 'transform 180ms ease' : undefined,
  };

  const canvasCursor = readOnly ? 'default' : isPanning ? 'grabbing' : mode === 'connect' ? 'crosshair' : spacePressed ? 'grab' : 'default';
  const hasGraphNodes = (graph?.nodes.length ?? 0) > 0;

  return (
    <div
      aria-label="Interactive diagram canvas"
      className={className}
      data-testid="diagram-canvas"
      onClick={(event) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest('button, input, select, [role="button"]')) return;
        handleCanvasClick();
      }}
      onDoubleClick={(event) => {
        if (event.target === containerRef.current) {
          fitToDiagram(true);
        }
      }}
      onPointerDown={handlePointerDown}
      onPointerLeave={() => { setCursorPoint(null); }}
      onPointerMove={handlePointerMove}
      onPointerUp={stopPanning}
      onWheel={handleWheel}
      onFocus={(event) => {
        if (event.target === event.currentTarget && orderedNodeIds[0]) {
          focusNode(orderedNodeIds[0]);
        }
      }}
      ref={containerRef}
      role="application"
      style={{
        background: 'var(--surface-canvas)',
        cursor: canvasCursor,
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
      tabIndex={0}
    >
      <div style={transformStyle}>
        {svg ? (
          <div
            aria-hidden="true"
            className={useReactFlowRenderer
              ? 'diagram-canvas-svg diagram-canvas-svg--reactflow'
              : 'diagram-canvas-svg'}
            dangerouslySetInnerHTML={{ __html: svg }}
            ref={svgContainerRef}
            style={{ pointerEvents: 'none' }}
          />
        ) : null}

        {isFlowchart && hitMap && !useReactFlowRenderer ? (
          <div style={{ inset: 0, position: 'absolute' }}>
            {[...hitMap.nodes.entries()].map(([nodeId, bounds]) => {
              const node = nodeById.get(nodeId) ?? null;
              const selected = selection.includes(nodeId);
              const focused = focusedNodeId === nodeId;
              const ariaLabel = node ? getNodeAriaLabel(node.shape, getNodeText(node)) : getNodeAriaLabel('node', nodeId);

              return (
                <button
                  aria-label={ariaLabel}
                  className="diagram-node-target"
                  key={nodeId}
                  onFocus={() => { setFocusedNodeId(nodeId); }}
                  onClick={(event) => {
                    event.stopPropagation();
                    handleNodeClick(nodeId, event.shiftKey);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    if (!node || readOnly) {
                      return;
                    }
                    openNodeEditor(node);
                  }}
                  onKeyDown={(event) => { handleNodeKeyDown(nodeId, event); }}
                  ref={(element) => { registerNodeElement(nodeId, element); }}
                  role="button"
                  style={{
                    background: selected ? 'color-mix(in srgb, var(--selection) 10%, transparent)' : focused ? 'color-mix(in srgb, var(--ink-muted) 8%, transparent)' : 'transparent',
                    border: selected || focused ? '2px solid var(--selection)' : '1px solid transparent',
                    borderRadius: 12,
                    boxShadow: selected || focused ? '0 0 0 4px color-mix(in srgb, var(--selection) 25%, transparent)' : 'none',
                    cursor: readOnly ? 'default' : 'pointer',
                    height: bounds.height,
                    left: bounds.x,
                    opacity: 1,
                    padding: 0,
                    position: 'absolute',
                    top: bounds.y,
                    width: bounds.width,
                  }}
                  tabIndex={focused ? 0 : -1}
                  type="button"
                />
              );
            })}

            {mode === 'connect' && !readOnly ? (
              [...hitMap.nodes.entries()].map(([nodeId, bounds]) => {
                const ports = [
                  getNodePortPosition(bounds, 'top'),
                  getNodePortPosition(bounds, 'right'),
                  getNodePortPosition(bounds, 'bottom'),
                  getNodePortPosition(bounds, 'left'),
                ];

                return ports.map((port, index) => (
                  <span
                    aria-hidden="true"
                    key={`${nodeId}-port-${index}`}
                    style={{
                      background: 'var(--selection)',
                      borderRadius: '50%',
                      height: 6,
                      left: port.x - 3,
                      position: 'absolute',
                      top: port.y - 3,
                      width: 6,
                    }}
                  />
                ));
              })
            ) : null}
          </div>
        ) : null}
      </div>

      {useReactFlowRenderer ? (
        <div className="diagram-reactflow-layer">
          <FlowEdgeMarkers />
          <FlowNodeInteractionContext.Provider value={flowNodeInteraction}>
            <ReactFlow
              colorMode={theme}
              autoPanOnConnect
              autoPanOnNodeDrag
              connectOnClick={false}
              connectionLineStyle={{ stroke: 'var(--selection)', strokeWidth: 2 }}
              connectionLineType={ConnectionLineType.SmoothStep}
              edges={flowEdges}
              fitView={false}
              maxZoom={MAX_ZOOM}
              minZoom={MIN_ZOOM}
              nodes={flowNodes}
              nodesConnectable={canEditStructure}
              nodesDraggable={canEditStructure}
              nodeTypes={FLOW_NODE_TYPES}
              onConnect={handleFlowConnect}
              onConnectEnd={handleFlowConnectEnd}
              onConnectStart={handleFlowConnectStart}
              onEdgeClick={(event, edge) => {
                event.stopPropagation();
                const edgeIdentity = graph ? getDiagramEdgeIdentityForFlowEdge(graph.links, edge.id) : null;
                if (!edgeIdentity) {
                  return;
                }
                setSelection([]);
                setToolbarOpen(false);
                setShapePickerOpen(false);
                setEditingNodeId(null);
                setSelectedEdgeIdentity(edgeIdentity);
              }}
              onEdgeDoubleClick={(event, edge) => {
                event.stopPropagation();
                const edgeIdentity = graph ? getDiagramEdgeIdentityForFlowEdge(graph.links, edge.id) : null;
                if (edgeIdentity) {
                  setSelectedEdgeIdentity(edgeIdentity);
                  openEdgeEditor(edgeIdentity);
                }
              }}
              onNodeClick={(event, node) => {
                event.stopPropagation();
                handleNodeClick(node.id, event.shiftKey);
              }}
              onNodeDoubleClick={(event, node) => {
                event.stopPropagation();
                const diagramNode = nodeById.get(node.id);
                if (diagramNode && canEditStructure) {
                  openNodeEditor(diagramNode);
                }
              }}
              onNodeDrag={handleFlowNodeDrag}
              onNodeDragStart={handleFlowNodeDragStart}
              onNodeDragStop={handleFlowNodeDragStop}
              onMove={(_event, nextViewport) => {
                setAnimateTransform(false);
                setViewport((current) => ({
                  panX: nextViewport.x,
                  panY: nextViewport.y,
                  zoom: current.zoom,
                }));
              }}
              onPaneClick={handleCanvasClick}
              panOnDrag={false}
              preventScrolling={false}
              proOptions={FLOW_PRO_OPTIONS}
              selectionOnDrag={false}
              viewport={flowViewport}
              zoomOnDoubleClick={false}
              zoomOnPinch={false}
              zoomOnScroll={false}
            />
          </FlowNodeInteractionContext.Provider>
        </div>
      ) : null}

      <div aria-hidden="true" style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 10 }}>
        {rubberBandPoints ? (
          <svg style={{ height: '100%', width: '100%' }}>
            <line
              stroke="var(--selection)"
              strokeDasharray={pendingEdge ? undefined : '6 4'}
              strokeWidth={2}
              x1={rubberBandPoints.from.x}
              x2={rubberBandPoints.to.x}
              y1={rubberBandPoints.from.y}
              y2={rubberBandPoints.to.y}
            />
          </svg>
        ) : null}

        {connectionGhostRect ? (
          <div
            style={{
              alignItems: 'center',
              background: 'color-mix(in srgb, var(--control-surface) 80%, transparent)',
              border: '1px dashed var(--selection)',
              borderRadius: 10,
              color: 'var(--ink)',
              display: 'flex',
              fontSize: 13,
              fontWeight: 600,
              height: connectionGhostRect.height,
              justifyContent: 'center',
              left: connectionGhostRect.x,
              position: 'absolute',
              top: connectionGhostRect.y,
              width: connectionGhostRect.width,
            }}
          >
            {DEFAULT_NEW_NODE_LABEL}
          </div>
        ) : null}

        {mode === 'connect' ? (
          <div
            style={{
              background: 'var(--control-surface)',
              border: '1px solid var(--control-border)',
              borderRadius: 16,
              color: 'var(--ink-muted)',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              left: canvasViewport.width > 0 ? canvasViewport.x + (canvasViewport.width / 2) : '50%',
              padding: '6px 12px',
              position: 'absolute',
              top: 12,
              transform: 'translateX(-50%)',
            }}
          >
            {connectSourceId ? 'click target node [esc cancel]' : 'click source node [esc cancel]'}
          </div>
        ) : null}
      </div>

      <div onClick={(event) => { event.stopPropagation(); }} style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 20 }}>
        {isFlowchart && !readOnly ? (
          <form
            aria-label="Add Mermaid node"
            data-testid="canvas-add-node-toolbar"
            onSubmit={(event) => {
              event.preventDefault();
              addNodeFromToolbar();
            }}
            style={{
              alignItems: 'center',
              background: 'var(--control-surface)',
              border: '1px solid var(--control-border)',
              borderRadius: 10,
              boxShadow: 'var(--shadow-elevated)',
              color: 'var(--ink-muted)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              left: canvasViewport.x + BOTTOM_TOOLBAR_INSET,
              maxWidth: canvasViewport.width > 0 ? Math.max(1, canvasViewport.width - (BOTTOM_TOOLBAR_INSET * 2)) : 'calc(100% - 24px)',
              padding: '8px 10px',
              pointerEvents: 'auto',
              position: 'absolute',
              bottom: BOTTOM_TOOLBAR_INSET + BOTTOM_CONTROLS_HEIGHT + BOTTOM_TOOLBAR_GAP,
              zIndex: 20,
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>add node</span>
            <input
              aria-label="New node label"
              onChange={(event) => { setNewNodeLabel(event.target.value); }}
              placeholder="label"
              style={{
                background: 'var(--surface-canvas)',
                border: '1px solid var(--control-border)',
                borderRadius: 6,
                color: 'var(--ink)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                outline: 'none',
                padding: '5px 7px',
                width: 'clamp(80px, 38vw, 140px)',
              }}
              value={newNodeLabel}
            />
            <select
              aria-label="New node shape"
              onChange={(event) => { setNewNodeShape(event.target.value as DiagramNodeShape); }}
              style={{
                background: 'var(--surface-canvas)',
                border: '1px solid var(--control-border)',
                borderRadius: 6,
                color: 'var(--ink)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                padding: '5px 7px',
              }}
              value={newNodeShape}
            >
              {SHAPE_OPTIONS.map((shape) => (
                <option key={shape.value} value={shape.value}>{shape.label}</option>
              ))}
            </select>
            <ToolbarButton label="Add node to Mermaid text" onClick={addNodeFromToolbar}>
              <Plus size={16} />
            </ToolbarButton>
          </form>
        ) : null}

        {(!hasGraphNodes && isFlowchart && !readOnly) ? (
          <div
            style={{
              alignItems: 'center',
              display: 'flex',
              height: '100%',
              justifyContent: 'center',
              pointerEvents: 'none',
            }}
          >
            <button
              onClick={addDefaultNode}
              style={{
                background: 'var(--control-surface)',
                border: '1px solid var(--control-border)',
                borderRadius: 999,
                color: 'var(--ink)',
                padding: '10px 16px',
                pointerEvents: 'auto',
              }}
              type="button"
            >
              Add your first node
            </button>
          </div>
        ) : (!svg ? (
          <div className="empty-state" style={{ alignItems: 'center', display: 'flex', height: '100%', justifyContent: 'center' }}>
            {emptyMessage}
          </div>
        ) : null)}

        {isFlowchart && !readOnly && toolbarOpen && selection.length > 0 ? (
          <div data-testid="canvas-node-toolbar" style={toolbarStyle}>
            {selection.length === 1 ? (
              <ToolbarButton label="Edit label" onClick={() => {
                const selectedNode = selection[0] ? nodeById.get(selection[0]) : undefined;
                if (selectedNode) {
                  openNodeEditor(selectedNode);
                }
              }}>
                <Pencil size={16} />
              </ToolbarButton>
            ) : null}
            {selection.length === 1 ? (
              <ToolbarButton label="Change shape" onClick={() => { setShapePickerOpen((current) => !current); }}>
                <Shapes size={16} />
              </ToolbarButton>
            ) : null}
            <ToolbarButton label="Connect nodes" onClick={() => {
              setPendingEdge(null);
              setPendingEdgeLabel('');
              setConnectSourceId(null);
              setToolbarOpen(true);
              setMode(mode === 'connect' ? 'select' : 'connect');
            }}>
              <ArrowRightFromLine size={16} />
            </ToolbarButton>
            {selection.length > 0 ? (
              <ToolbarButton label="Delete selected nodes" onClick={() => { onDeleteNodes?.(selection); }}>
                <Trash2 size={16} />
              </ToolbarButton>
            ) : null}
            <ToolbarButton label="Add node" onClick={addDefaultNode}>
              <Plus size={16} />
            </ToolbarButton>

            {shapePickerOpen && selection.length === 1 ? (
              <div
                style={{
                  background: 'var(--control-surface)',
                  border: '1px solid var(--control-border)',
                  borderRadius: 8,
                  display: 'grid',
                  gap: 8,
                  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                  left: 0,
                  marginTop: 8,
                  padding: 8,
                  position: 'absolute',
                  top: '100%',
                  width: 160,
                }}
              >
                {SHAPE_OPTIONS.map((shape) => {
                  const currentNode = selection[0] ? nodeById.get(selection[0]) : undefined;
                  const active = currentNode?.shape === shape.value;

                  return (
                    <button
                      key={shape.value}
                      onClick={() => {
                        if (canEditStructure) {
                          onChangeNodeShape?.(selection[0]!, shape.value);
                        }
                        setShapePickerOpen(false);
                      }}
                      style={{
                        alignItems: 'center',
                        background: 'transparent',
                        border: active ? '1px solid var(--selection)' : '1px solid var(--control-border)',
                        borderRadius: 4,
                        color: active ? 'var(--ink)' : 'var(--ink-muted)',
                        display: 'grid',
                        gap: 4,
                        justifyItems: 'center',
                        minHeight: 40,
                        padding: 6,
                      }}
                      type="button"
                    >
                      <ShapePreview shape={shape.value} />
                      <span style={{ fontSize: 10 }}>{shape.label}</span>
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        {isFlowchart && !readOnly && selectedCurrentEdgeIdentity && selectedEdgeMidpoint ? (
          <div
            aria-label="Selected edge toolbar"
            data-testid="canvas-edge-toolbar"
            style={{
              alignItems: 'center',
              background: 'var(--control-surface)',
              border: '1px solid var(--control-border)',
              borderRadius: 8,
              boxShadow: 'var(--shadow-elevated)',
              display: 'inline-flex',
              gap: 6,
              left: selectedEdgeToolbarPosition.left,
              maxWidth: canvasViewport.width > 0 ? Math.max(1, canvasViewport.width - (BOTTOM_TOOLBAR_INSET * 2)) : 'calc(100% - 24px)',
              padding: '4px 6px',
              pointerEvents: 'auto',
              position: 'absolute',
              top: selectedEdgeToolbarPosition.top,
              zIndex: 30,
            }}
          >
            <ToolbarButton label="Edit edge label" onClick={() => { openEdgeEditor(selectedCurrentEdgeIdentity); }}>
              <Pencil size={16} />
            </ToolbarButton>
            <ToolbarButton label="Delete selected edge" onClick={() => {
              onDeleteEdge?.(selectedCurrentEdgeIdentity);
              setSelectedEdgeIdentity(null);
            }}>
              <Trash2 size={16} />
            </ToolbarButton>
          </div>
        ) : null}

        {!readOnly ? (
          <div
            data-testid="canvas-controls-toolbar"
            style={{
              alignItems: 'center',
              background: 'var(--control-surface)',
              border: '1px solid var(--control-border)',
              borderRadius: 8,
              bottom: BOTTOM_TOOLBAR_INSET,
              color: 'var(--ink-muted)',
              display: 'inline-flex',
              gap: 6,
              maxWidth: canvasViewport.width > 0 ? Math.max(1, canvasViewport.width - (BOTTOM_TOOLBAR_INSET * 2)) : 'calc(100% - 24px)',
              padding: '4px 6px',
              pointerEvents: 'auto',
              position: 'absolute',
              right: Math.max(BOTTOM_TOOLBAR_INSET, canvasSize.width - (canvasViewport.x + canvasViewport.width) + BOTTOM_TOOLBAR_INSET),
            }}
          >
            {isFlowchart && hasPersistedLayout ? (
              <ToolbarButton label="Reset shared layout to Mermaid" onClick={() => { setNodePositions(() => ({}), 'replace'); }}>
                <RotateCcw size={16} />
              </ToolbarButton>
            ) : null}
            <ToolbarButton label="Zoom out" onClick={() => {
              setViewport((current) => ({ ...current, zoom: clamp(current.zoom * 0.9, MIN_ZOOM, MAX_ZOOM) }));
            }}>
              <ZoomOut size={16} />
            </ToolbarButton>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, minWidth: 44, textAlign: 'center' }}>
              {Math.round(viewport.zoom * 100)}%
            </span>
            <ToolbarButton label="Zoom in" onClick={() => {
              setViewport((current) => ({ ...current, zoom: clamp(current.zoom * 1.1, MIN_ZOOM, MAX_ZOOM) }));
            }}>
              <ZoomIn size={16} />
            </ToolbarButton>
            <ToolbarButton label="Fit diagram" onClick={() => { fitToDiagram(true); }}>
              <ScanSearch size={16} />
            </ToolbarButton>
          </div>
        ) : null}

        {editingNode && editingNodeBounds ? (
          <div
            style={{
              left: editingNodeBounds.x,
              pointerEvents: 'auto',
              position: 'absolute',
              top: editingNodeBounds.y + (editingNodeBounds.height / 2) - 18,
              width: Math.max(120, editingNodeBounds.width),
            }}
          >
            <input
              autoFocus
              onBlur={commitNodeEdit}
              onChange={(event) => { setEditingLabel(event.target.value); }}
              onFocus={(event) => { event.currentTarget.select(); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitNodeEdit();
                }
                if (event.key === 'Escape') {
                  setEditingNodeId(null);
                }
              }}
              placeholder="node label"
              style={{
                background: 'var(--surface-canvas)',
                border: '1px solid var(--control-border)',
                borderBottomColor: 'var(--selection)',
                borderRadius: 8,
                color: 'var(--ink)',
                outline: 'none',
                padding: '8px 10px',
                width: '100%',
              }}
              value={editingLabel}
            />
          </div>
        ) : null}

        {editingEdgeIndex !== null && editingEdgeMidpoint ? (
          <div
            style={{
              left: toScreenPoint(editingEdgeMidpoint, viewport).x - 90,
              pointerEvents: 'auto',
              position: 'absolute',
              top: toScreenPoint(editingEdgeMidpoint, viewport).y - 18,
              width: 180,
            }}
          >
            <input
              aria-label="Edge label"
              autoFocus
              onBlur={commitEdgeEdit}
              onChange={(event) => { setEditingEdgeLabel(event.target.value); }}
              onFocus={(event) => { event.currentTarget.select(); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitEdgeEdit();
                }
                if (event.key === 'Escape') {
                  setEditingEdgeIdentity(null);
                  setEditingEdgeLabel('');
                }
              }}
              placeholder="edge label"
              style={{
                background: 'var(--surface-canvas)',
                border: '1px solid var(--control-border)',
                borderBottomColor: 'var(--selection)',
                borderRadius: 8,
                color: 'var(--ink)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                outline: 'none',
                padding: '8px 10px',
                width: '100%',
              }}
              value={editingEdgeLabel}
            />
          </div>
        ) : null}

        {pendingEdge ? (
          <div
            style={{
              left: toScreenPoint(pendingEdge.midpoint, viewport).x - 90,
              pointerEvents: 'auto',
              position: 'absolute',
              top: toScreenPoint(pendingEdge.midpoint, viewport).y - 18,
              width: 180,
            }}
          >
            <input
              autoFocus
              onBlur={() => { commitPendingEdge(pendingEdgeLabel.trim() || undefined); }}
              onChange={(event) => { setPendingEdgeLabel(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  commitPendingEdge(pendingEdgeLabel.trim() || undefined);
                }
                if (event.key === 'Escape') {
                  commitPendingEdge(undefined);
                }
              }}
              placeholder="label (optional)"
              style={{
                background: 'var(--surface-canvas)',
                border: '1px solid var(--control-border)',
                borderRadius: 8,
                color: 'var(--ink)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                outline: 'none',
                padding: '8px 10px',
                width: '100%',
              }}
              value={pendingEdgeLabel}
            />
          </div>
        ) : null}

        {showGroupPrompt && screenSelectionBounds ? (
          <div
            style={{
              left: screenSelectionBounds.x + Math.max(0, (screenSelectionBounds.width / 2) - 90),
              pointerEvents: 'auto',
              position: 'absolute',
              top: Math.max(12, screenSelectionBounds.y - 44),
              width: 180,
            }}
          >
            <input
              autoFocus
              onBlur={() => {
                onGroupNodes?.(selection, groupPromptValue.trim() || 'New Group');
                setShowGroupPrompt(false);
              }}
              onChange={(event) => { setGroupPromptValue(event.target.value); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  onGroupNodes?.(selection, groupPromptValue.trim() || 'New Group');
                  setShowGroupPrompt(false);
                }
                if (event.key === 'Escape') {
                  setShowGroupPrompt(false);
                }
              }}
              placeholder="group name"
              style={{
                background: 'var(--surface-canvas)',
                border: '1px solid var(--control-border)',
                borderRadius: 8,
                color: 'var(--ink)',
                fontFamily: 'var(--font-mono)',
                fontSize: 12,
                outline: 'none',
                padding: '8px 10px',
                width: '100%',
              }}
              value={groupPromptValue}
            />
          </div>
        ) : null}

        {mode === 'connect' ? (
          <div
            style={{
              alignItems: 'center',
              background: 'var(--control-surface)',
              border: '1px solid var(--control-border)',
              borderRadius: 8,
              color: 'var(--ink-muted)',
              display: 'inline-flex',
              gap: 6,
              left: 12,
              padding: '4px 6px',
              pointerEvents: 'auto',
              position: 'absolute',
              top: 56,
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>edge</span>
            <select
              onChange={(event) => { setSelectedConnectionType(event.target.value as DiagramLinkType); }}
              style={{
                background: 'var(--surface-canvas)',
                border: '1px solid var(--control-border)',
                borderRadius: 6,
                color: 'var(--ink)',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                padding: '4px 6px',
              }}
              value={selectedConnectionType}
            >
              {CONNECTION_TYPE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function FlowEdgeMarkers() {
  return (
    <svg aria-hidden="true" focusable="false" style={{ height: 0, position: 'absolute', width: 0 }}>
      <defs>
        <marker
          id={FLOW_EDGE_MARKER_CIRCLE_ID}
          markerHeight="10"
          markerUnits="strokeWidth"
          markerWidth="10"
          orient="auto"
          refX="9"
          refY="5"
          viewBox="0 0 10 10"
        >
          <circle cx="5" cy="5" fill="var(--surface-canvas)" r="3" stroke={FLOW_EDGE_COLOR} strokeWidth="1.6" />
        </marker>
        <marker
          id={FLOW_EDGE_MARKER_CROSS_ID}
          markerHeight="10"
          markerUnits="strokeWidth"
          markerWidth="10"
          orient="auto"
          refX="9"
          refY="5"
          viewBox="0 0 10 10"
        >
          <path d="M3 3 L7 7 M7 3 L3 7" fill="none" stroke={FLOW_EDGE_COLOR} strokeLinecap="round" strokeWidth="1.8" />
        </marker>
      </defs>
    </svg>
  );
}

function MermaidReactFlowNode({ data, id, selected }: NodeProps<MermaidFlowNode>) {
  const interaction = useContext(FlowNodeInteractionContext);
  const focused = interaction?.focusedNodeId === id;
  const label = data.ariaLabel;
  const handleColor = getCanvasHandlePaint(Boolean(selected || focused || interaction?.connectMode));

  return (
    <div
      aria-label={label}
      aria-pressed={selected}
      className={`mermaid-flow-node mermaid-flow-node--${getShapeClassName(data.shape)}${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}`}
      onFocus={() => { interaction?.onFocus(id); }}
      onKeyDown={(event) => { interaction?.onKeyDown(id, event); }}
      ref={(element) => { interaction?.registerNodeElement(id, element); }}
      role="button"
      style={getCanvasNodePaint(data.presentation)}
      tabIndex={focused ? 0 : -1}
    >
      {FLOW_HANDLE_POSITIONS.map((position) => (
        <Handle
          className={`mermaid-flow-handle mermaid-flow-handle--${position} mermaid-flow-handle--target`}
          id={getFlowHandleId('target', position)}
          key={`target-${position}`}
          position={position}
          style={{ background: handleColor, borderColor: 'var(--surface-canvas)' }}
          type="target"
        />
      ))}
      <span>{data.label}</span>
      {FLOW_HANDLE_POSITIONS.map((position) => (
        <Handle
          className={`mermaid-flow-handle mermaid-flow-handle--${position} mermaid-flow-handle--source`}
          id={getFlowHandleId('source', position)}
          key={`source-${position}`}
          position={position}
          style={{ background: handleColor, borderColor: 'var(--surface-canvas)' }}
          type="source"
        />
      ))}
    </div>
  );
}

function ToolbarButton({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button aria-label={label} data-testid={`canvas-action-${toTestId(label)}`} onClick={onClick} style={TOOLBAR_BUTTON_STYLE} title={label} type="button">
      {children}
    </button>
  );
}

function getNodeText(node: DiagramNode): string {
  return typeof node.text === 'string' ? node.text : node.text?.text ?? node.id;
}

function getLinkText(link: { text?: string | { text?: string } }): string | undefined {
  if (typeof link.text === 'string') {
    return link.text;
  }

  return link.text?.text;
}

function getFlowEdgePresentation(link: DiagramLink, presentation: MermaidItemPresentation = {}): Pick<Edge, 'markerEnd' | 'style'> {
  const strokeWidth = link.stroke === 'thick' ? 3 : 1.8;
  const strokeDasharray = link.stroke === 'dotted' ? '5 5' : undefined;
  const style: CSSProperties = {
    stroke: presentation.stroke ?? FLOW_EDGE_COLOR,
    strokeDasharray: presentation.strokeDasharray ?? strokeDasharray,
    strokeWidth: presentation.strokeWidth ?? strokeWidth,
  };
  const markerColor = presentation.stroke ?? FLOW_EDGE_COLOR;

  switch (link.type) {
    case 'arrow_open':
      return { markerEnd: { color: markerColor, type: MarkerType.Arrow }, style };
    case 'arrow_circle':
      return { markerEnd: FLOW_EDGE_MARKER_CIRCLE_ID, style };
    case 'arrow_cross':
      return { markerEnd: FLOW_EDGE_MARKER_CROSS_ID, style };
    case 'arrow_point':
    default:
      return { markerEnd: { color: markerColor, type: MarkerType.ArrowClosed }, style };
  }
}

function getNodeAriaLabel(shape: string | undefined, label: string): string {
  return `${shape ?? 'node'}: ${label}`;
}

function getShapeClassName(shape?: DiagramNodeShape): string {
  return shape?.replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'rect';
}

function toTestId(label: string): string {
  return label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function areViewportRectsEqual(left: ViewportRect, right: ViewportRect): boolean {
  return left.height === right.height
    && left.width === right.width
    && left.x === right.x
    && left.y === right.y;
}

function isTypingElement(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return target instanceof HTMLInputElement
    || target instanceof HTMLTextAreaElement
    || target instanceof HTMLSelectElement
    || target.isContentEditable;
}

function ShapePreview({ shape }: { shape: DiagramNodeShape }) {
  return (
    <svg aria-hidden="true" height="18" viewBox="0 0 28 18" width="24">
      {renderShape(shape)}
    </svg>
  );
}

function renderShape(shape: DiagramNodeShape) {
  const common = { fill: 'transparent', stroke: 'var(--ink-muted)', strokeWidth: 1.4 };

  switch (shape) {
    case 'circle':
    case 'doublecircle':
      return <circle cx="14" cy="9" r="6" {...common} />;
    case 'ellipse':
      return <ellipse cx="14" cy="9" rx="9" ry="6" {...common} />;
    case 'diamond':
      return <path d="M14 2 L24 9 L14 16 L4 9 Z" {...common} />;
    case 'hexagon':
      return <path d="M7 2 H21 L26 9 L21 16 H7 L2 9 Z" {...common} />;
    case 'stadium':
      return <rect height="12" rx="6" width="22" x="3" y="3" {...common} />;
    case 'subroutine':
      return (
        <>
          <rect height="12" rx="2" width="22" x="3" y="3" {...common} />
          <path d="M8 3 V15 M20 3 V15" {...common} />
        </>
      );
    case 'cylinder':
      return (
        <>
          <ellipse cx="14" cy="4" rx="9" ry="3" {...common} />
          <path d="M5 4 V14 C5 16 23 16 23 14 V4" {...common} />
          <ellipse cx="14" cy="14" rx="9" ry="3" {...common} />
        </>
      );
    case 'trapezoid':
      return <path d="M6 3 H22 L25 15 H3 Z" {...common} />;
    case 'round':
      return <rect height="12" rx="4" width="22" x="3" y="3" {...common} />;
    default:
      return <rect height="12" rx="2" width="22" x="3" y="3" {...common} />;
  }
}

function getEdgeMidpoint(edge: Pick<DiagramLink, 'source' | 'target'>, nodeBounds: Map<string, SvgBounds>): SvgPoint | null {
  const sourceBounds = nodeBounds.get(edge.source);
  const targetBounds = nodeBounds.get(edge.target);
  if (!sourceBounds || !targetBounds) {
    return null;
  }

  const sourceCenter = getBoundsCenter(sourceBounds);
  const targetCenter = getBoundsCenter(targetBounds);
  return {
    x: (sourceCenter.x + targetCenter.x) / 2,
    y: (sourceCenter.y + targetCenter.y) / 2,
  };
}

function getFlowHandleId(type: 'source' | 'target', position: Position): string {
  return `${type}-${position}`;
}

function getFlowEdgeHandles(
  link: DiagramLink,
  nodeBounds: Map<string, SvgBounds>,
  direction: FlowchartSnapshot['direction'],
): Pick<Edge, 'sourceHandle' | 'targetHandle'> {
  const sourceBounds = nodeBounds.get(link.source);
  const targetBounds = nodeBounds.get(link.target);
  let sourcePosition: Position;
  let targetPosition: Position;

  if (sourceBounds && targetBounds) {
    const sourceCenter = getBoundsCenter(sourceBounds);
    const targetCenter = getBoundsCenter(targetBounds);
    const dx = targetCenter.x - sourceCenter.x;
    const dy = targetCenter.y - sourceCenter.y;

    if (Math.abs(dx) >= Math.abs(dy)) {
      sourcePosition = dx >= 0 ? Position.Right : Position.Left;
      targetPosition = dx >= 0 ? Position.Left : Position.Right;
    } else {
      sourcePosition = dy >= 0 ? Position.Bottom : Position.Top;
      targetPosition = dy >= 0 ? Position.Top : Position.Bottom;
    }
  } else {
    const fallback = getFlowPortPositions(direction);
    sourcePosition = fallback.source;
    targetPosition = fallback.target;
  }

  return {
    sourceHandle: getFlowHandleId('source', sourcePosition),
    targetHandle: getFlowHandleId('target', targetPosition),
  };
}

function getFlowPortPositions(direction: FlowchartSnapshot['direction']): { source: Position; target: Position } {
  switch (direction) {
    case 'BT':
      return { source: Position.Top, target: Position.Bottom };
    case 'LR':
      return { source: Position.Right, target: Position.Left };
    case 'RL':
      return { source: Position.Left, target: Position.Right };
    case 'TD':
    default:
      return { source: Position.Bottom, target: Position.Top };
  }
}

function getClientPoint(event: MouseEvent | TouchEvent): SvgPoint | null {
  if ('changedTouches' in event) {
    const touch = event.changedTouches[0];
    return touch ? { x: touch.clientX, y: touch.clientY } : null;
  }

  return { x: event.clientX, y: event.clientY };
}

function toScreenRect(bounds: SvgBounds, viewport: ViewportState): ScreenRect {
  return {
    height: bounds.height * viewport.zoom,
    width: bounds.width * viewport.zoom,
    x: (bounds.x * viewport.zoom) + viewport.panX,
    y: (bounds.y * viewport.zoom) + viewport.panY,
  };
}

function toScreenPoint(point: SvgPoint, viewport: ViewportState): SvgPoint {
  return {
    x: (point.x * viewport.zoom) + viewport.panX,
    y: (point.y * viewport.zoom) + viewport.panY,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
