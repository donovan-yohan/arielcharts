'use client';

import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  Handle,
  Position,
  ReactFlow,
  type Connection,
  type Node,
  type NodeChange,
  type NodeProps,
  type NodeTypes,
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
import type { DiagramLinkType, DiagramNode, DiagramNodeShape, DiagramSubgraph, FlowchartSnapshot } from '../lib/diagram-mutations';
import {
  buildSvgHitMap,
  getBoundsCenter,
  getBoundsUnion,
  getNodePortPosition,
  type SvgBounds,
  type SvgHitMap,
  type SvgPoint,
} from '../lib/svg-hit-map';

export type DiagramNodePositions = Record<string, SvgPoint>;

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
  onAddEdge?: (source: string, target: string, label?: string, type?: DiagramLinkType) => void;
  onAddNode?: (label: string, shape: DiagramNodeShape) => void;
  onChangeNodeShape?: (nodeId: string, newShape: DiagramNodeShape) => void;
  onDeleteEdge?: (edgeKey: string) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  onEditNodeLabel?: (nodeId: string, newLabel: string) => void;
  onGroupNodes?: (nodeIds: string[], label: string) => void;
  onInteractionModeChange?: (mode: 'select' | 'connect') => void;
  onNodePositionsChange?: (positions: DiagramNodePositions) => void;
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
  shape: DiagramNodeShape;
}

type MermaidFlowNode = Node<MermaidFlowNodeData, 'mermaidFlowNode'>;

interface FlowNodeInteractionContextValue {
  focusedNodeId: string | null;
  onFocus: (nodeId: string) => void;
  onKeyDown: (nodeId: string, event: ReactKeyboardEvent<HTMLElement>) => void;
  registerNodeElement: (nodeId: string, element: HTMLElement | null) => void;
}

const FLOW_NODE_TYPES: NodeTypes = {
  mermaidFlowNode: MermaidReactFlowNode,
};
const FLOW_DEFAULT_VIEWPORT = { x: 0, y: 0, zoom: 1 };
const FLOW_PRO_OPTIONS = { hideAttribution: true };
const FlowNodeInteractionContext = createContext<FlowNodeInteractionContextValue | null>(null);

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const EDITOR_MIN_ZOOM = 0.4;
const FIT_PADDING = 64;
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
  color: '#8b949e',
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
  onChangeNodeShape,
  onDeleteNodes,
  onEditNodeLabel,
  onGroupNodes,
  onInteractionModeChange,
  onNodePositionsChange,
  onSelectedNodeIdsChange,
  onUngroupNodes,
  readOnly = false,
  selectedNodeIds,
  svg,
}: DiagramCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgContainerRef = useRef<HTMLDivElement | null>(null);
  const nodeButtonRefs = useRef(new Map<string, HTMLElement | null>());
  const [hitMap, setHitMap] = useState<SvgHitMap | null>(null);
  const [uncontrolledNodePositions, setUncontrolledNodePositions] = useState<DiagramNodePositions>({});
  const manualNodePositions = nodePositions ?? uncontrolledNodePositions;
  const dragStateRef = useRef<{ originX: number; originY: number; startPanX: number; startPanY: number } | null>(null);
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
  const [shapePickerOpen, setShapePickerOpen] = useState(false);
  const [connectSourceId, setConnectSourceId] = useState<string | null>(null);
  const [cursorPoint, setCursorPoint] = useState<SvgPoint | null>(null);
  const [pendingEdge, setPendingEdge] = useState<PendingEdge | null>(null);
  const [pendingEdgeLabel, setPendingEdgeLabel] = useState('');
  const [groupPromptValue, setGroupPromptValue] = useState('');
  const [showGroupPrompt, setShowGroupPrompt] = useState(false);
  const [newNodeLabel, setNewNodeLabel] = useState(DEFAULT_NEW_NODE_LABEL);
  const [newNodeShape, setNewNodeShape] = useState<DiagramNodeShape>(DEFAULT_NEW_NODE_SHAPE);
  const [selectedConnectionType, setSelectedConnectionType] = useState<DiagramLinkType>('arrow_point');
  const [focusedNodeId, setFocusedNodeId] = useState<string | null>(null);
  const [toolbarOpen, setToolbarOpen] = useState(false);

  const setNodePositions = useCallback((update: (current: DiagramNodePositions) => DiagramNodePositions) => {
    const next = update(manualNodePositions);
    if (next === manualNodePositions) {
      return;
    }

    if (nodePositions === undefined) {
      setUncontrolledNodePositions(next);
    }
    onNodePositionsChange?.(next);
  }, [manualNodePositions, nodePositions, onNodePositionsChange]);

  const interactiveNodeBounds = useMemo(() => {
    if (!hitMap) {
      return null;
    }

    const boundsByNodeId = new Map(hitMap.nodes);
    Object.entries(manualNodePositions).forEach(([nodeId, position]) => {
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
  }, [hitMap, manualNodePositions]);

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

    const allBounds = [
      ...hitMap.nodes.values(),
      ...hitMap.subgraphs.values(),
      ...[...hitMap.edges.values()].map((edge) => edge.bounds),
    ];

    return getBoundsUnion(allBounds);
  }, [hitMap]);

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
          shape: node.shape,
        },
        draggable: !readOnly,
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
  }, [graph, interactiveNodeBounds, readOnly, selection]);

  const manualLayoutActive = Object.keys(manualNodePositions).length > 0;
  const useReactFlowRenderer = isFlowchart && flowNodes.length > 0;

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

  const displayedToolbarRect = screenSelectionBounds ?? { height: 0, width: 0, x: 16, y: 16 };
  const toolbarStyle: CSSProperties = {
    alignItems: 'center',
    background: '#161b22',
    border: '1px solid #30363d',
    borderRadius: 8,
    boxShadow: '0 12px 32px rgba(2, 6, 23, 0.45)',
    display: 'inline-flex',
    gap: 6,
    left: Math.max(12, displayedToolbarRect.x + (displayedToolbarRect.width / 2) - 88),
    padding: '4px 6px',
    pointerEvents: 'auto',
    position: 'absolute',
    top: screenSelectionBounds ? Math.max(12, screenSelectionBounds.y - 40) : 12,
    zIndex: 30,
  };

  const setSelection = useCallback((nodeIds: string[]) => {
    onSelectedNodeIdsChange?.(nodeIds);
    if (!isControlledSelection) {
      setInternalSelection(nodeIds);
    }
  }, [isControlledSelection, onSelectedNodeIdsChange]);

  const setMode = useCallback((nextMode: 'select' | 'connect') => {
    onInteractionModeChange?.(nextMode);
    if (interactionMode === undefined) {
      setInternalMode(nextMode);
    }
  }, [interactionMode, onInteractionModeChange]);

  const fitToDiagram = useCallback((animated: boolean) => {
    const container = containerRef.current;
    if (!container || !graphBounds) {
      return;
    }

    const availableWidth = Math.max(1, container.clientWidth - (FIT_PADDING * 2));
    const availableHeight = Math.max(1, container.clientHeight - (FIT_PADDING * 2));
    const zoom = clamp(
      Math.min(availableWidth / Math.max(graphBounds.width, 1), availableHeight / Math.max(graphBounds.height, 1)),
      MIN_ZOOM,
      MAX_ZOOM,
    );

    const panX = ((container.clientWidth - (graphBounds.width * zoom)) / 2) - (graphBounds.x * zoom);
    const panY = ((container.clientHeight - (graphBounds.height * zoom)) / 2) - (graphBounds.y * zoom);

    setAnimateTransform(animated);
    setViewport({ panX, panY, zoom });
  }, [graphBounds]);

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
      return;
    }

    let frameId = 0;
    frameId = window.requestAnimationFrame(() => {
      const svgElement = svgContainerRef.current?.querySelector('svg');
      if (!svgElement) {
        setHitMap(null);
        return;
      }

      setHitMap(buildSvgHitMap(svgElement));
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [svg]);

  useEffect(() => {
    if (!graph) {
      if (Object.keys(manualNodePositions).length > 0) {
        setNodePositions(() => ({}));
      }
      return;
    }

    const currentNodeIds = new Set(graph.nodes.map((node) => node.id));
    setNodePositions((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([nodeId]) => currentNodeIds.has(nodeId)),
      );

      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [graph, manualNodePositions, setNodePositions]);

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
    if (!orderedNodeIds.length) {
      setFocusedNodeId(null);
      return;
    }

    if (!focusedNodeId || !orderedNodeIds.includes(focusedNodeId)) {
      setFocusedNodeId(orderedNodeIds[0] ?? null);
    }
  }, [focusedNodeId, orderedNodeIds]);

  useEffect(() => {
    if (!graphBounds || !svg) {
      return;
    }

    fitToDiagram(false);
  }, [fitToDiagram, graphBounds, svg]);

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
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingElement(event.target)) {
        return;
      }

      if (event.code === 'Space') {
        setSpacePressed(true);
      }

      if (event.key === 'Escape') {
        setShapePickerOpen(false);
        setPendingEdge(null);
        setPendingEdgeLabel('');
        setShowGroupPrompt(false);
        setConnectSourceId(null);
        setCursorPoint(null);
        setToolbarOpen(false);
        setMode('select');
        containerRef.current?.focus();
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'g' && selection.length > 0 && !readOnly) {
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

      if ((event.key === 'Delete' || event.key === 'Backspace') && selection.length > 0 && !readOnly) {
        event.preventDefault();
        onDeleteNodes?.(selection);
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
  }, [editingNodeId, graph, onDeleteNodes, onUngroupNodes, readOnly, selection, setMode]);

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
    setToolbarOpen(false);
    setShapePickerOpen(false);
    setEditingNodeId(null);
  }, [isPanning, setSelection]);

  const handleNodeClick = useCallback((nodeId: string, shiftKey: boolean) => {
    setShapePickerOpen(false);
    setFocusedNodeId(nodeId);
    setToolbarOpen(true);

    if (mode === 'connect') {
      if (!connectSourceId) {
        setConnectSourceId(nodeId);
        return;
      }

      if (connectSourceId === nodeId) {
        return;
      }

      const sourceBounds = interactiveNodeBounds?.get(connectSourceId);
      const targetBounds = interactiveNodeBounds?.get(nodeId);
      const midpoint = sourceBounds && targetBounds
        ? {
            x: (getBoundsCenter(sourceBounds).x + getBoundsCenter(targetBounds).x) / 2,
            y: (getBoundsCenter(sourceBounds).y + getBoundsCenter(targetBounds).y) / 2,
          }
        : { x: 0, y: 0 };

      setPendingEdge({ midpoint, source: connectSourceId, target: nodeId });
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
  }, [connectSourceId, interactiveNodeBounds, mode, selection, setSelection]);

  const commitNodeEdit = useCallback(() => {
    if (!editingNodeId) {
      return;
    }

    onEditNodeLabel?.(editingNodeId, editingLabel.trim() || editingNodeId);
    setEditingNodeId(null);
  }, [editingLabel, editingNodeId, onEditNodeLabel]);

  const commitPendingEdge = useCallback((label?: string) => {
    if (!pendingEdge) {
      return;
    }

    onAddEdge?.(pendingEdge.source, pendingEdge.target, label, selectedConnectionType);
    setPendingEdge(null);
    setPendingEdgeLabel('');
    setMode('select');
  }, [onAddEdge, pendingEdge, selectedConnectionType, setMode]);

  const handleFlowNodesChange = useCallback((changes: NodeChange<MermaidFlowNode>[]) => {
    const movedNodes = changes.filter((change) => change.type === 'position' && change.position);
    if (movedNodes.length === 0) {
      return;
    }

    setNodePositions((current) => {
      const next = { ...current };
      movedNodes.forEach((change) => {
        if (change.type === 'position' && change.position) {
          next[change.id] = change.position;
        }
      });
      return next;
    });
  }, [setNodePositions]);

  const handleFlowConnect = useCallback((connection: Connection) => {
    if (!connection.source || !connection.target || connection.source === connection.target) {
      return;
    }

    onAddEdge?.(connection.source, connection.target, undefined, selectedConnectionType);
  }, [onAddEdge, selectedConnectionType]);

  const addDefaultNode = useCallback(() => {
    onAddNode?.(DEFAULT_NEW_NODE_LABEL, DEFAULT_NEW_NODE_SHAPE);
  }, [onAddNode]);

  const addNodeFromToolbar = useCallback(() => {
    onAddNode?.(newNodeLabel.trim() || DEFAULT_NEW_NODE_LABEL, newNodeShape);
    setNewNodeLabel(DEFAULT_NEW_NODE_LABEL);
  }, [newNodeLabel, newNodeShape, onAddNode]);

  const openNodeEditor = useCallback((node: DiagramNode) => {
    setToolbarOpen(false);
    setEditingNodeId(node.id);
    setEditingLabel(getNodeText(node));
  }, []);

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
      setSelection([nodeId]);
      setToolbarOpen(true);
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
  }, [moveFocus, nodeById, openNodeEditor, readOnly, setSelection]);

  const flowNodeInteraction = useMemo<FlowNodeInteractionContextValue>(() => ({
    focusedNodeId,
    onFocus: setFocusedNodeId,
    onKeyDown: handleNodeKeyDown,
    registerNodeElement,
  }), [focusedNodeId, handleNodeKeyDown, registerNodeElement]);

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
        background: '#0d1117',
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
            className={useReactFlowRenderer ? 'diagram-canvas-svg diagram-canvas-svg--reactflow' : 'diagram-canvas-svg'}
            dangerouslySetInnerHTML={{ __html: svg }}
            ref={svgContainerRef}
            style={{ pointerEvents: 'none' }}
          />
        ) : null}

        {useReactFlowRenderer ? (
          <div className="diagram-reactflow-layer">
            <FlowNodeInteractionContext.Provider value={flowNodeInteraction}>
              <ReactFlow
                colorMode="dark"
                connectOnClick={false}
                defaultViewport={FLOW_DEFAULT_VIEWPORT}
                maxZoom={1}
                minZoom={1}
                nodes={flowNodes}
                nodesConnectable={!readOnly}
                nodesDraggable={!readOnly}
                nodeTypes={FLOW_NODE_TYPES}
                onConnect={handleFlowConnect}
                onNodeClick={(event, node) => {
                  event.stopPropagation();
                  handleNodeClick(node.id, event.shiftKey);
                }}
                onNodeDoubleClick={(event, node) => {
                  event.stopPropagation();
                  const diagramNode = nodeById.get(node.id);
                  if (diagramNode && !readOnly) {
                    openNodeEditor(diagramNode);
                  }
                }}
                onNodesChange={handleFlowNodesChange}
                panOnDrag={false}
                preventScrolling={false}
                proOptions={FLOW_PRO_OPTIONS}
                selectionOnDrag={false}
                zoomOnDoubleClick={false}
                zoomOnPinch={false}
                zoomOnScroll={false}
              />
            </FlowNodeInteractionContext.Provider>
          </div>
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
                    background: selected ? 'rgba(56, 189, 248, 0.08)' : focused ? 'rgba(148, 163, 184, 0.06)' : 'rgba(255, 255, 255, 0.01)',
                    border: selected || focused ? '2px solid #38bdf8' : '1px solid transparent',
                    borderRadius: 12,
                    boxShadow: selected || focused ? '0 0 0 4px rgba(56,189,248,0.25)' : 'none',
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
                      background: '#38bdf8',
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

      <div aria-hidden="true" style={{ inset: 0, pointerEvents: 'none', position: 'absolute' }}>
        {rubberBandPoints ? (
          <svg style={{ height: '100%', width: '100%' }}>
            <line
              stroke="#38bdf8"
              strokeDasharray={pendingEdge ? undefined : '6 4'}
              strokeWidth={2}
              x1={rubberBandPoints.from.x}
              x2={rubberBandPoints.to.x}
              y1={rubberBandPoints.from.y}
              y2={rubberBandPoints.to.y}
            />
          </svg>
        ) : null}

        {mode === 'connect' ? (
          <div
            style={{
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 16,
              color: '#8b949e',
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              left: '50%',
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

      <div onClick={(event) => { event.stopPropagation(); }} style={{ inset: 0, pointerEvents: 'none', position: 'absolute' }}>
        {isFlowchart && !readOnly ? (
          <form
            aria-label="Add Mermaid node"
            onSubmit={(event) => {
              event.preventDefault();
              addNodeFromToolbar();
            }}
            style={{
              alignItems: 'center',
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 10,
              boxShadow: '0 12px 32px rgba(2, 6, 23, 0.35)',
              color: '#8b949e',
              display: 'flex',
              gap: 8,
              left: 12,
              padding: '8px 10px',
              pointerEvents: 'auto',
              position: 'absolute',
              bottom: 12,
              zIndex: 20,
            }}
          >
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>add node</span>
            <input
              aria-label="New node label"
              onChange={(event) => { setNewNodeLabel(event.target.value); }}
              placeholder="label"
              style={{
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: 6,
                color: '#c9d1d9',
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                outline: 'none',
                padding: '5px 7px',
                width: 140,
              }}
              value={newNodeLabel}
            />
            <select
              aria-label="New node shape"
              onChange={(event) => { setNewNodeShape(event.target.value as DiagramNodeShape); }}
              style={{
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: 6,
                color: '#c9d1d9',
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
                background: '#161b22',
                border: '1px solid #30363d',
                borderRadius: 999,
                color: '#e2e8f0',
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
          <div style={toolbarStyle}>
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
                  background: '#161b22',
                  border: '1px solid #30363d',
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
                        onChangeNodeShape?.(selection[0]!, shape.value);
                        setShapePickerOpen(false);
                      }}
                      style={{
                        alignItems: 'center',
                        background: 'transparent',
                        border: active ? '1px solid #38bdf8' : '1px solid #30363d',
                        borderRadius: 4,
                        color: active ? '#e2e8f0' : '#8b949e',
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

        {!readOnly ? (
          <div
            style={{
              alignItems: 'center',
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 8,
              bottom: 12,
              color: '#8b949e',
              display: 'inline-flex',
              gap: 6,
              padding: '4px 6px',
              pointerEvents: 'auto',
              position: 'absolute',
              right: 12,
            }}
          >
            {manualLayoutActive ? (
              <ToolbarButton label="Clean layout to Mermaid" onClick={() => { setNodePositions(() => ({})); }}>
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
                background: '#0d1117',
                border: '1px solid #30363d',
                borderBottomColor: '#38bdf8',
                borderRadius: 8,
                color: '#c9d1d9',
                outline: 'none',
                padding: '8px 10px',
                width: '100%',
              }}
              value={editingLabel}
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
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: 8,
                color: '#c9d1d9',
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
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: 8,
                color: '#c9d1d9',
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
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 8,
              color: '#8b949e',
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
                background: '#0d1117',
                border: '1px solid #30363d',
                borderRadius: 6,
                color: '#c9d1d9',
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

function MermaidReactFlowNode({ data, id, selected }: NodeProps<MermaidFlowNode>) {
  const interaction = useContext(FlowNodeInteractionContext);
  const focused = interaction?.focusedNodeId === id;
  const label = data.ariaLabel;

  return (
    <div
      aria-label={label}
      aria-pressed={selected}
      className={`mermaid-flow-node mermaid-flow-node--${getShapeClassName(data.shape)}${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}`}
      onFocus={() => { interaction?.onFocus(id); }}
      onKeyDown={(event) => { interaction?.onKeyDown(id, event); }}
      ref={(element) => { interaction?.registerNodeElement(id, element); }}
      role="button"
      tabIndex={focused ? 0 : -1}
    >
      <Handle position={Position.Left} type="target" />
      <span>{data.label}</span>
      <Handle position={Position.Right} type="source" />
    </div>
  );
}

function ToolbarButton({ children, label, onClick }: { children: ReactNode; label: string; onClick: () => void }) {
  return (
    <button aria-label={label} onClick={onClick} style={TOOLBAR_BUTTON_STYLE} title={label} type="button">
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

function getNodeAriaLabel(shape: string, label: string): string {
  return `${shape}: ${label}`;
}

function getShapeClassName(shape: DiagramNodeShape): string {
  return shape.replace(/[^a-z0-9_-]/gi, '').toLowerCase() || 'rect';
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
  const common = { fill: 'transparent', stroke: '#8b949e', strokeWidth: 1.4 };

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
