'use client';

import type { CanvasPresenceEntry, CanvasWorldPoint } from '@arielcharts/shared';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  ConnectionLineType,
  Handle,
  MarkerType,
  Position,
  ReactFlow,
  SelectionMode,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type Node,
  type NodeProps,
  type NodeTypes,
  type OnConnectEnd,
  type OnConnectStart,
  type OnNodeDrag,
  type OnNodesChange,
  type Viewport,
} from '@xyflow/react';
import {
  ArrowRightFromLine,
  ClipboardCopy,
  ClipboardPaste,
  Pencil,
  Plus,
  RotateCcw,
  ScanSearch,
  Shapes,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { DiagramClipboardPayload, DiagramClipboardPoint, DiagramEdgeIdentity, DiagramLink, DiagramLinkType, DiagramNode, DiagramNodeShape, DiagramSubgraph, FlowchartSnapshot } from '../lib/diagram-mutations';
import { createDiagramClipboardPayload, getDiagramEdgeIdentity, resolveDiagramEdgeIndex } from '../lib/diagram-mutations';
import { measureUnobscuredCanvasViewport, type ViewportRect } from '../lib/canvas-viewport';
import { shouldCanvasHandleEscape } from '../lib/canvas-keyboard-ownership';
import { getCanvasToolbarStackGeometry, getCanvasToolbarVisibility } from '../lib/canvas-toolbar-stack';
import { applyCanvasTouchGesture, CanvasTouchGestureController, type CanvasTouchGesture } from '../lib/canvas-touch-gesture';
import { getConnectNodeActivation } from '../lib/diagram-connect-state';
import { getCanvasDotGridGeometry } from '../lib/canvas-dot-grid';
import { beginCanvasMousePan, CanvasMousePanController } from '../lib/canvas-mouse-pan';
import { getDiagramEdgeIdentityForFlowEdge, getFlowEdgeId, getVisibleDiagramLinks } from '../lib/diagram-flow-identity';
import type { DiagramNodePositions, NodePositionsSyncMode } from '../lib/diagram-layout';
import {
  applyControlledNodeChanges,
  createControlledNodeComposer,
  reconcileControlledNodeRuntime,
  releaseControlledNodeRuntime,
  type ControlledNodeRuntime,
} from '../lib/reactflow-controlled-node-adapter';
import { reconcileReactFlowViewport } from '../lib/reactflow-viewport-control';
import {
  extractMermaidPresentation,
  getCanvasEdgeMarker,
  getCanvasHandlePaint,
  getCanvasNodePaint,
  type MermaidItemPresentation,
  type MermaidPresentation,
} from '../lib/mermaid-presentation';
import { shouldFitInitialCamera } from '../lib/renderer-camera-policy';
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
  preserveCamera?: boolean;
  readOnly?: boolean;
  selectedNodeIds?: string[];
  svg: string;
  theme?: 'light' | 'dark';
  onAddEdge?: (source: string, target: string, label?: string, type?: DiagramLinkType) => void;
  onAddNode?: (label: string, shape: DiagramNodeShape) => void;
  onAddConnectedNode?: (source: string, label: string, shape: DiagramNodeShape, position: SvgPoint, type: DiagramLinkType) => void;
  onCanvasCursorChange?: (point: CanvasWorldPoint | null) => void;
  onChangeNodeShape?: (nodeId: string, newShape: DiagramNodeShape) => void;
  onDeleteEdge?: (edge: DiagramEdgeIdentity) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  onEditEdgeLabel?: (edge: DiagramEdgeIdentity, label?: string) => void;
  onEditNodeLabel?: (nodeId: string, newLabel: string) => void;
  onGroupNodes?: (nodeIds: string[], label: string) => void;
  onInteractionModeChange?: (mode: 'select' | 'connect') => void;
  onNodeDrag?: (positions: DiagramNodePositions) => void;
  onNodeDragStart?: (positions: DiagramNodePositions) => boolean | void;
  onNodeDragStop?: (positions: DiagramNodePositions) => void;
  onNodePositionsChange?: (positions: DiagramNodePositions, mode?: NodePositionsSyncMode) => void;
  onPasteClipboard?: (clipboard: DiagramClipboardPayload, offset: DiagramClipboardPoint) => void;
  onRedo?: () => void;
  onResetSharedLayout?: () => void;
  onRenderSettled?: () => void;
  onSelectedNodeIdsChange?: (nodeIds: string[]) => void;
  onUngroupNodes?: (subgraphId: string) => void;
  onUndo?: () => void;
  remoteCanvasPresence?: readonly CanvasPresenceEntry[];
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
  remoteSelections: readonly CanvasPresenceEntry[];
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

function getDraggedNodePositions(
  node: MermaidFlowNode | null | undefined,
  nodes: MermaidFlowNode[] | null | undefined,
): DiagramNodePositions | null {
  const positions: DiagramNodePositions = {};
  for (const draggedNode of [...(nodes ?? []), node]) {
    if (!draggedNode?.id || !draggedNode.position) {
      continue;
    }
    positions[draggedNode.id] = { x: draggedNode.position.x, y: draggedNode.position.y };
  }
  return Object.keys(positions).length > 0 ? positions : null;
}
const FLOW_PRO_OPTIONS = { hideAttribution: true };
const FLOW_EDGE_COLOR = 'var(--diagram-item-stroke-fallback)';
const FLOW_HANDLE_POSITIONS = [Position.Top, Position.Right, Position.Bottom, Position.Left] as const;
const GHOST_NODE_WIDTH = 144;
const GHOST_NODE_HEIGHT = 56;
const FlowNodeInteractionContext = createContext<FlowNodeInteractionContextValue | null>(null);

const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;
const EDITOR_MIN_ZOOM = 0.4;
const FIT_PADDING = 64;
const BOTTOM_TOOLBAR_INSET = 12;
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

export function getNodeClickSelection(current: readonly string[], nodeId: string, shiftKey: boolean): string[] {
  if (!shiftKey) {
    return [nodeId];
  }
  return current.includes(nodeId)
    ? current.filter((id) => id !== nodeId)
    : [...current, nodeId];
}

export function getCanonicalSelectionAttribute(nodeIds: readonly string[]): string {
  return JSON.stringify([...nodeIds].sort((left, right) => left.localeCompare(right)));
}

export function getGraphMembershipKey(nodeIds: readonly string[], subgraphIds: readonly string[]): string {
  return JSON.stringify({
    nodeIds: [...nodeIds].sort((left, right) => left.localeCompare(right)),
    subgraphIds: [...subgraphIds].sort((left, right) => left.localeCompare(right)),
  });
}

export function isSameNodeSelection(left: readonly string[], right: readonly string[]): boolean {
  return getCanonicalSelectionAttribute(left) === getCanonicalSelectionAttribute(right);
}

export function getFlowSelectionChange(
  selectedNodes: readonly { id: string }[],
  currentNodeIds: readonly string[],
): string[] | null {
  if (selectedNodes.length === 0 && currentNodeIds.length === 0) {
    return null;
  }

  const currentIds = new Set(currentNodeIds);
  if (selectedNodes.some((node) => !currentIds.has(node.id))) {
    return null;
  }

  return selectedNodes.map((node) => node.id);
}

export function getRendererInteractionMode(
  current: 'select' | 'connect',
  isFlowchart: boolean,
): 'select' | 'connect' {
  return isFlowchart ? current : 'select';
}

export function shouldHandleCanvasShortcut(
  targetIsInCanvas: boolean,
  activeElementIsInCanvas: boolean,
  isTyping: boolean,
): boolean {
  return !isTyping && (targetIsInCanvas || activeElementIsInCanvas);
}

export function shouldHandleCanvasSingleKeyShortcut(
  targetIsCanvas: boolean,
  activeElementIsCanvas: boolean,
): boolean {
  return targetIsCanvas && activeElementIsCanvas;
}

export function getCanvasHistoryShortcut(
  key: string,
  hasModifier: boolean,
  hasShift: boolean,
): 'undo' | 'redo' | null {
  if (!hasModifier || key.toLowerCase() !== 'z') {
    return null;
  }

  return hasShift ? 'redo' : 'undo';
}

export function shouldRestoreCanvasFocusAfterPaste(activeElementIsInCanvas: boolean, activeElementIsBody: boolean): boolean {
  return activeElementIsInCanvas || activeElementIsBody;
}

export function shouldEnableCanvasMarquee(
  canEditStructure: boolean,
  mode: 'select' | 'connect',
  isCoarsePointer: boolean,
): boolean {
  return canEditStructure && mode === 'select' && !isCoarsePointer;
}

function useCoarsePointer(): boolean {
  const [isCoarsePointer, setIsCoarsePointer] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(pointer: coarse)');
    const update = () => { setIsCoarsePointer((current) => current === mediaQuery.matches ? current : mediaQuery.matches); };
    update();
    mediaQuery.addEventListener('change', update);
    return () => { mediaQuery.removeEventListener('change', update); };
  }, []);

  return isCoarsePointer;
}
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

function canStartTouchCanvasGesture(target: EventTarget | null, root: HTMLDivElement): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target.closest('a, button, input, select, textarea, [contenteditable="true"], [role="button"], [data-testid*="toolbar"], .react-flow__node, .react-flow__edge, .react-flow__handle')) {
    return false;
  }

  return root.contains(target);
}

function canStartMouseCanvasPan(target: EventTarget | null, root: HTMLDivElement): boolean {
  if (!(target instanceof Element) || !root.contains(target)) {
    return false;
  }

  return !target.closest('a, button, input, select, textarea, [contenteditable="true"], [role="button"], [data-testid*="toolbar"]');
}

export function DiagramCanvas({
  className,
  emptyMessage = 'start typing mermaid syntax',
  graph,
  interactionMode,
  isFlowchart = true,
  nodePositions,
  preserveCamera = false,
  onAddEdge,
  onAddNode,
  onAddConnectedNode,
  onCanvasCursorChange,
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
  onPasteClipboard,
  onRedo,
  onResetSharedLayout,
  onRenderSettled,
  onSelectedNodeIdsChange,
  onUngroupNodes,
  onUndo,
  readOnly = false,
  remoteCanvasPresence = [],
  selectedNodeIds,
  svg,
  theme = 'dark',
}: DiagramCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgContainerRef = useRef<HTMLDivElement | null>(null);
  const addNodeToolbarRef = useRef<HTMLFormElement | null>(null);
  const controlsToolbarRef = useRef<HTMLDivElement | null>(null);
  const onRenderSettledRef = useRef(onRenderSettled);
  const touchGestureRef = useRef(new CanvasTouchGestureController());
  const nodeButtonRefs = useRef(new Map<string, HTMLElement | null>());
  const [hitMap, setHitMap] = useState<SvgHitMap | null>(null);
  const [mermaidPresentation, setMermaidPresentation] = useState<MermaidPresentation>({ edges: [], nodes: new Map() });
  const [canvasViewport, setCanvasViewport] = useState<ViewportRect>({ height: 0, width: 0, x: 0, y: 0 });
  const [canvasViewportMeasured, setCanvasViewportMeasured] = useState(false);
  const [canvasSize, setCanvasSize] = useState({ height: 0, width: 0 });
  const [addNodeToolbarHeight, setAddNodeToolbarHeight] = useState(0);
  const [controlsToolbarHeight, setControlsToolbarHeight] = useState(0);
  const [uncontrolledNodePositions, setUncontrolledNodePositions] = useState<DiagramNodePositions>({});
  const [liveNodePositions, setLiveNodePositions] = useState<DiagramNodePositions>({});
  const [flowNodeRuntime, setFlowNodeRuntime] = useState<ControlledNodeRuntime>({});
  const activeDragNodeIdsRef = useRef(new Set<string>());
  const controlledNodeComposer = useMemo(() => createControlledNodeComposer<MermaidFlowNode>(), []);
  const persistedNodePositions = nodePositions ?? uncontrolledNodePositions;
  const persistedNodePositionsRef = useRef<DiagramNodePositions>(persistedNodePositions);
  const hasAutoFitInitialRenderRef = useRef(false);
  const suppressCanvasClickRef = useRef(false);
  const suppressCanvasClickResetRef = useRef<number | null>(null);
  const visibleNodePositions = useMemo(
    () => ({ ...persistedNodePositions, ...liveNodePositions }),
    [liveNodePositions, persistedNodePositions],
  );
  const mousePanRef = useRef(new CanvasMousePanController());
  const connectionStartNodeIdRef = useRef<string | null>(null);
  const isControlledSelection = selectedNodeIds !== undefined;
  const [internalSelection, setInternalSelection] = useState<string[]>(selectedNodeIds ?? []);
  const selection = isControlledSelection ? selectedNodeIds : internalSelection;
  const selectionRef = useRef(selection);
  useEffect(() => {
    selectionRef.current = selection;
  }, [selection]);
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
  const isCoarsePointer = useCoarsePointer();
  const clipboardRef = useRef<DiagramClipboardPayload | null>(null);
  const pasteCountRef = useRef(0);
  const pendingPasteFocusRef = useRef(0);
  const [hasCanvasClipboard, setHasCanvasClipboard] = useState(false);
  const onCanvasCursorChangeRef = useRef(onCanvasCursorChange);
  onRenderSettledRef.current = onRenderSettled;
  onCanvasCursorChangeRef.current = onCanvasCursorChange;

  useEffect(() => () => {
    onCanvasCursorChangeRef.current?.(null);
  }, []);

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
  const graphMembershipKey = getGraphMembershipKey(
    graph?.nodes.map((node) => node.id) ?? [],
    graph?.subgraphs.map((subgraph) => subgraph.id) ?? [],
  );
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

  const remoteSelectionsByNodeId = useMemo(() => {
    const selections = new Map<string, CanvasPresenceEntry[]>();
    for (const presence of remoteCanvasPresence) {
      for (const nodeId of presence.canvas.selected_node_ids ?? []) {
        const current = selections.get(nodeId) ?? [];
        current.push(presence);
        selections.set(nodeId, current);
      }
    }
    return selections;
  }, [remoteCanvasPresence]);

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
          remoteSelections: remoteSelectionsByNodeId.get(node.id) ?? [],
          shape: node.shape,
        },
        draggable: isFlowchart && !readOnly,
        focusable: false,
        id: node.id,
        position: { x: bounds.x, y: bounds.y },
        selectable: isFlowchart && !readOnly,
        selected: selection.includes(node.id),
        style: {
          height: bounds.height,
          width: bounds.width,
        },
        type: 'mermaidFlowNode',
      });
    });

    return nextNodes;
  }, [graph, interactiveNodeBounds, isFlowchart, mermaidPresentation.nodes, readOnly, remoteSelectionsByNodeId, selection]);
  const flowNodeIdsRef = useRef<string[]>([]);
  flowNodeIdsRef.current = flowNodes.map((node) => node.id);

  const hasPersistedLayout = Object.keys(persistedNodePositions).length > 0;
  const canEditStructure = isFlowchart && !readOnly;
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
        selectable: canEditStructure,
        selected: selectedEdgeIndex === graphIndex,
        ...getFlowEdgeHandles(link, interactiveNodeBounds, graph.direction),
        ...getFlowEdgePresentation(link, mermaidPresentation.edges[graphIndex]),
        source: link.source,
        target: link.target,
        type: 'smoothstep',
      }));
  }, [graph, interactiveNodeBounds, mermaidPresentation.edges, selectedEdgeIndex]);

  const flowEdgeMarkerColors = useMemo(() => [...new Set([
    FLOW_EDGE_COLOR,
    ...mermaidPresentation.edges.flatMap((presentation) => presentation.stroke ? [presentation.stroke] : []),
  ])], [mermaidPresentation.edges]);

  const useReactFlowRenderer = isFlowchart && flowNodes.length > 0;
  const controlledFlowNodes = useMemo(
    () => controlledNodeComposer.compose(flowNodes, flowNodeRuntime),
    [controlledNodeComposer, flowNodeRuntime, flowNodes],
  );
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
  const canvasToolbarStack = useMemo(() => getCanvasToolbarStackGeometry(canvasSize, canvasViewport, BOTTOM_TOOLBAR_INSET), [canvasSize, canvasViewport]);
  const canvasToolbarVisibility = getCanvasToolbarVisibility(
    canvasViewport.height,
    controlsToolbarHeight,
    addNodeToolbarHeight,
    BOTTOM_TOOLBAR_INSET,
    BOTTOM_TOOLBAR_GAP,
    canvasViewportMeasured,
  );
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
    if (readOnly) {
      return;
    }
    if (isSameNodeSelection(selectionRef.current, nodeIds)) {
      return;
    }
    selectionRef.current = nodeIds;
    onSelectedNodeIdsChange?.(nodeIds);
    if (!isControlledSelection) {
      setInternalSelection(nodeIds);
    }
  }, [isControlledSelection, onSelectedNodeIdsChange, readOnly]);

  const setMode = useCallback((nextMode: 'select' | 'connect') => {
    if (!isFlowchart && nextMode !== 'select') {
      return;
    }
    onInteractionModeChange?.(nextMode);
    if (interactionMode === undefined) {
      setInternalMode(nextMode);
    }
  }, [interactionMode, isFlowchart, onInteractionModeChange]);

  const copySelectedNodes = useCallback(() => {
    if (!canEditStructure || !graph || selectionRef.current.length === 0) {
      return false;
    }

    const renderedPositions = interactiveNodeBounds
      ? Object.fromEntries([...interactiveNodeBounds.entries()].map(([nodeId, bounds]) => [nodeId, { x: bounds.x, y: bounds.y }]))
      : visibleNodePositions;
    const clipboard = createDiagramClipboardPayload(graph, selectionRef.current, renderedPositions);
    if (!clipboard) {
      return false;
    }

    clipboardRef.current = clipboard;
    pasteCountRef.current = 0;
    setHasCanvasClipboard(true);
    return true;
  }, [canEditStructure, graph, interactiveNodeBounds, visibleNodePositions]);

  const pasteClipboard = useCallback(() => {
    if (!canEditStructure || !clipboardRef.current || !onPasteClipboard) {
      return false;
    }

    const canvas = containerRef.current;
    const ownsFocus = Boolean(canvas && document.activeElement instanceof Node && canvas.contains(document.activeElement));
    if (ownsFocus) {
      pendingPasteFocusRef.current += 1;
    }
    pasteCountRef.current += 1;
    const offset = 32 * pasteCountRef.current;
    onPasteClipboard(clipboardRef.current, { x: offset, y: offset });
    return true;
  }, [canEditStructure, onPasteClipboard]);

  const simplifyLayout = useCallback(() => {
    if (!canEditStructure || !hasPersistedLayout) {
      return false;
    }

    if (onResetSharedLayout) {
      onResetSharedLayout();
      return true;
    }

    setNodePositions(() => ({}), 'replace');
    return true;
  }, [canEditStructure, hasPersistedLayout, onResetSharedLayout, setNodePositions]);

  const zoomCanvas = useCallback((factor: number) => {
    setAnimateTransform(false);
    setViewport((current) => ({ ...current, zoom: clamp(current.zoom * factor, MIN_ZOOM, MAX_ZOOM) }));
  }, []);

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
      setHitMap((current) => current === null ? current : null);
      setMermaidPresentation((current) => current.edges.length === 0 && current.nodes.size === 0
        ? current
        : { edges: [], nodes: new Map() });
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

      const expectedNodeIds = graph?.nodes.map((node) => node.id) ?? [];
      const expectedSubgraphIds = graph?.subgraphs.map((subgraph) => subgraph.id) ?? [];
      const nextHitMap = buildSvgHitMap(svgElement, { nodeIds: expectedNodeIds, subgraphIds: expectedSubgraphIds });
      const nextPresentation = extractMermaidPresentation(svgElement, expectedNodeIds);
      setHitMap((current) => areSvgHitMapsEqual(current, nextHitMap) ? current : nextHitMap);
      setMermaidPresentation((current) => areMermaidPresentationsEqual(current, nextPresentation) ? current : nextPresentation);
      onRenderSettledRef.current?.();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [graphMembershipKey, svg]);

  useEffect(() => {
    const pendingFocusGeneration = pendingPasteFocusRef.current;
    if (pendingFocusGeneration === 0) {
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      if (pendingPasteFocusRef.current !== pendingFocusGeneration) {
        return;
      }

      const canvas = containerRef.current;
      const activeElement = document.activeElement;
      const activeElementIsInCanvas = Boolean(canvas && activeElement instanceof Node && canvas.contains(activeElement));
      if (canvas && shouldRestoreCanvasFocusAfterPaste(activeElementIsInCanvas, activeElement === document.body)) {
        canvas.focus({ preventScroll: true });
      }
      pendingPasteFocusRef.current = 0;
    });

    return () => { window.cancelAnimationFrame(frame); };
  }, [svg]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    let frameId = 0;
    const updateViewport = () => {
      const next = measureUnobscuredCanvasViewport(container);
      setCanvasSize((current) => current.height === container.clientHeight && current.width === container.clientWidth
        ? current
        : { height: container.clientHeight, width: container.clientWidth });
      setCanvasViewport((current) => areViewportRectsEqual(current, next) ? current : next);
      setCanvasViewportMeasured(true);
    };
    const scheduleViewportUpdate = () => {
      window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(updateViewport);
    };
    updateViewport();
    const resizeObserver = new ResizeObserver(scheduleViewportUpdate);
    resizeObserver.observe(container);
    const scope = container.closest('.workspace-main') ?? container.parentElement ?? container;
    const observeFlyouts = () => {
      scope.querySelectorAll<HTMLElement>('.workspace-flyout').forEach((flyout) => { resizeObserver.observe(flyout); });
    };
    observeFlyouts();
    const mutationObserver = new MutationObserver(() => {
      observeFlyouts();
      scheduleViewportUpdate();
    });
    mutationObserver.observe(scope, { childList: true });
    return () => {
      window.cancelAnimationFrame(frameId);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
    };
  }, []);

  useLayoutEffect(() => {
    const toolbar = controlsToolbarRef.current;
    if (!toolbar) {
      setControlsToolbarHeight(0);
      return;
    }

    const updateHeight = () => {
      setControlsToolbarHeight((current) => {
        const next = toolbar.getBoundingClientRect().height;
        return current === next ? current : next;
      });
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(toolbar);
    return () => { observer.disconnect(); };
  }, [hasPersistedLayout, isFlowchart, readOnly]);

  useLayoutEffect(() => {
    const toolbar = addNodeToolbarRef.current;
    if (!toolbar) {
      setAddNodeToolbarHeight(0);
      return;
    }

    const updateHeight = () => {
      setAddNodeToolbarHeight((current) => {
        const next = toolbar.getBoundingClientRect().height;
        return current === next ? current : next;
      });
    };
    updateHeight();
    const observer = new ResizeObserver(updateHeight);
    observer.observe(toolbar);
    return () => { observer.disconnect(); };
  }, [isFlowchart, readOnly]);

  useEffect(() => {
    if (!graph || !isFlowchart) {
      activeDragNodeIdsRef.current.clear();
      setLiveNodePositions({});
      setFlowNodeRuntime({});
      return;
    }

    const currentNodeIds = new Set(graph.nodes.map((node) => node.id));
    if ([...activeDragNodeIdsRef.current].some((nodeId) => !currentNodeIds.has(nodeId))) {
      activeDragNodeIdsRef.current.clear();
    }
    setLiveNodePositions((current) => Object.fromEntries(
      Object.entries(current).filter(([nodeId]) => currentNodeIds.has(nodeId)),
    ));
  }, [graph, isFlowchart]);

  useEffect(() => {
    setFlowNodeRuntime((current) => reconcileControlledNodeRuntime(flowNodes, current));
  }, [flowNodes]);

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
    if (!orderedNodeIds.length) {
      setFocusedNodeId(null);
      return;
    }

    if (!focusedNodeId || !orderedNodeIds.includes(focusedNodeId)) {
      setFocusedNodeId(orderedNodeIds[0] ?? null);
    }
  }, [focusedNodeId, orderedNodeIds]);

  useEffect(() => {
    if (!graphBounds || !svg || !shouldFitInitialCamera(preserveCamera, hasAutoFitInitialRenderRef.current, true)) {
      return;
    }

    hasAutoFitInitialRenderRef.current = true;
    fitBoundsToViewport(graphBounds, false);
  }, [fitBoundsToViewport, graphBounds, preserveCamera, svg]);

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

    setMode(getRendererInteractionMode(mode, isFlowchart));
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
  }, [isFlowchart, mode, setMode]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isTypingElement(event.target)) {
        return;
      }

      const canvas = containerRef.current;
      const ownsCanvas = canvas
        ? shouldHandleCanvasShortcut(
          event.target instanceof Node && canvas.contains(event.target),
          document.activeElement instanceof Node && canvas.contains(document.activeElement),
          false,
        )
        : false;

      if (event.code === 'Space' && ownsCanvas) {
        setSpacePressed(true);
      }

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

      if (!ownsCanvas) {
        return;
      }

      const isModifierShortcut = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const canvasContainerOwnsFocus = shouldHandleCanvasSingleKeyShortcut(
        event.target === canvas,
        document.activeElement === canvas,
      );
      const historyShortcut = getCanvasHistoryShortcut(event.key, isModifierShortcut, event.shiftKey);
      if (historyShortcut && !readOnly) {
        event.preventDefault();
        if (historyShortcut === 'undo') {
          onUndo?.();
        } else {
          onRedo?.();
        }
        return;
      }

      if (isModifierShortcut && key === 'c' && canEditStructure) {
        event.preventDefault();
        copySelectedNodes();
        return;
      }

      if (isModifierShortcut && key === 'v' && canEditStructure) {
        event.preventDefault();
        pasteClipboard();
        return;
      }

      if (isModifierShortcut && key === 'a' && canEditStructure && graph) {
        event.preventDefault();
        setSelection(graph.nodes.map((node) => node.id));
        return;
      }

      if (canEditStructure && isModifierShortcut && key === 'g' && selection.length > 0) {
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

      if (!isModifierShortcut && canvasContainerOwnsFocus && canEditStructure && key === 'n') {
        event.preventDefault();
        onAddNode?.(DEFAULT_NEW_NODE_LABEL, DEFAULT_NEW_NODE_SHAPE);
        return;
      }

      if (!isModifierShortcut && canvasContainerOwnsFocus && canEditStructure && key === 'c') {
        event.preventDefault();
        setPendingEdge(null);
        setPendingEdgeLabel('');
        setConnectSourceId(null);
        setMode(mode === 'connect' ? 'select' : 'connect');
        return;
      }

      if (!isModifierShortcut && canvasContainerOwnsFocus && canEditStructure && hasPersistedLayout && key === 's') {
        event.preventDefault();
        simplifyLayout();
        return;
      }

      if (!isModifierShortcut && canvasContainerOwnsFocus && key === 'f') {
        event.preventDefault();
        fitToDiagram(true);
        return;
      }

      if (!isModifierShortcut && canvasContainerOwnsFocus && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        zoomCanvas(1.1);
        return;
      }

      if (!isModifierShortcut && canvasContainerOwnsFocus && event.key === '-') {
        event.preventDefault();
        zoomCanvas(0.9);
        return;
      }

      if (!isModifierShortcut && canvasContainerOwnsFocus && event.key === 'F2' && canEditStructure && selection.length === 1) {
        const selectedNode = nodeById.get(selection[0] ?? '');
        if (selectedNode) {
          event.preventDefault();
          setToolbarOpen(false);
          setEditingNodeId(selectedNode.id);
          setEditingLabel(getNodeText(selectedNode));
        }
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
      const canvas = containerRef.current;
      const ownsCanvas = canvas
        ? shouldHandleCanvasShortcut(
          event.target instanceof Node && canvas.contains(event.target),
          document.activeElement instanceof Node && canvas.contains(document.activeElement),
          isTypingElement(event.target),
        )
        : false;
      if (event.code === 'Space' && ownsCanvas) {
        setSpacePressed(false);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [canEditStructure, copySelectedNodes, fitToDiagram, graph, hasPersistedLayout, mode, nodeById, onAddNode, onDeleteEdge, onDeleteNodes, onRedo, onUndo, onUngroupNodes, pasteClipboard, readOnly, selectedCurrentEdgeIdentity, selection, setMode, setSelection, simplifyLayout, zoomCanvas]);

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

  const applyTouchGesture = useCallback((gesture: CanvasTouchGesture) => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    const rect = container.getBoundingClientRect();
    setAnimateTransform(false);
    setViewport((current) => applyCanvasTouchGesture(current, gesture, rect, MIN_ZOOM, MAX_ZOOM));
  }, []);

  const handleTouchPointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const canvas = containerRef.current;
    if (event.pointerType !== 'touch' || !canvas || !canStartTouchCanvasGesture(event.target, canvas)) {
      return;
    }

    if (!touchGestureRef.current.begin(event.pointerId, { x: event.clientX, y: event.clientY })) {
      return;
    }

    canvas.setPointerCapture(event.pointerId);
  }, []);

  const handleTouchPointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') {
      return;
    }

    const gesture = touchGestureRef.current.move(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!gesture) {
      return;
    }

    event.preventDefault();
    setIsPanning(true);
    applyTouchGesture(gesture);
  }, [applyTouchGesture]);

  const handleTouchPointerEnd = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') {
      return false;
    }

    const remainingPointers = touchGestureRef.current.end(event.pointerId);
    if (remainingPointers === 0) {
      setIsPanning(false);
    }
    return true;
  }, []);

  const handlePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const isMiddleMouse = event.button === 1;
    const isSpacePrimaryPointer = spacePressed && event.button === 0;
    const canvas = containerRef.current;
    if (
      event.pointerType === 'touch'
      || (!isMiddleMouse && !isSpacePrimaryPointer)
      || !canvas
      || !canStartMouseCanvasPan(event.target, canvas)
    ) {
      return false;
    }

    if (!beginCanvasMousePan(
      mousePanRef.current,
      event.currentTarget,
      event.pointerId,
      { x: event.clientX, y: event.clientY },
      viewport,
    )) {
      return false;
    }

    event.preventDefault();
    event.stopPropagation();
    setIsPanning(true);
    return true;
  }, [spacePressed, viewport]);

  const handlePointerDownCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.pointerType === 'touch') {
      handleTouchPointerDown(event);
      return;
    }

    handlePointerDown(event);
  }, [handlePointerDown, handleTouchPointerDown]);

  const handlePointerMove = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!containerRef.current) {
      return;
    }

    const rect = containerRef.current.getBoundingClientRect();
    const point = {
      x: (event.clientX - rect.left - viewport.panX) / viewport.zoom,
      y: (event.clientY - rect.top - viewport.panY) / viewport.zoom,
    };

    if (event.pointerType !== 'touch') {
      onCanvasCursorChange?.(point);
    }

    if (!hitMap) {
      return;
    }

    setCursorPoint(point);

    const nextPan = mousePanRef.current.move(event.pointerId, { x: event.clientX, y: event.clientY });
    if (!nextPan) {
      return;
    }

    setAnimateTransform(false);
    setViewport((current) => ({
      ...current,
      ...nextPan,
    }));
  }, [hitMap, onCanvasCursorChange, viewport.panX, viewport.panY, viewport.zoom]);

  const suppressCanvasClick = useCallback(() => {
    suppressCanvasClickRef.current = true;
    if (suppressCanvasClickResetRef.current !== null) {
      window.clearTimeout(suppressCanvasClickResetRef.current);
    }
    suppressCanvasClickResetRef.current = window.setTimeout(() => {
      suppressCanvasClickRef.current = false;
      suppressCanvasClickResetRef.current = null;
    }, 0);
  }, []);

  const stopPanning = useCallback((pointerId?: number): boolean => {
    const stopped = pointerId === undefined
      ? mousePanRef.current.isActive
      : mousePanRef.current.end(pointerId);
    if (pointerId === undefined) {
      mousePanRef.current.cancel();
    }
    if (stopped) {
      setIsPanning(false);
    }
    return stopped;
  }, []);

  const handlePointerUp = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!handleTouchPointerEnd(event)) {
      if (stopPanning(event.pointerId)) {
        suppressCanvasClick();
      }
    }
  }, [handleTouchPointerEnd, stopPanning, suppressCanvasClick]);

  const handleLostPointerCapture = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!handleTouchPointerEnd(event)) {
      if (stopPanning(event.pointerId)) {
        suppressCanvasClick();
      }
    }
  }, [handleTouchPointerEnd, stopPanning, suppressCanvasClick]);

  useEffect(() => {
    const cancelPanning = () => {
      touchGestureRef.current.reset();
      stopPanning();
      setIsPanning(false);
      setSpacePressed(false);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible') {
        cancelPanning();
      }
    };

    window.addEventListener('blur', cancelPanning);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('blur', cancelPanning);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [stopPanning]);

  useEffect(() => () => {
    if (suppressCanvasClickResetRef.current !== null) {
      window.clearTimeout(suppressCanvasClickResetRef.current);
    }
  }, []);

  const handleCanvasClick = useCallback(() => {
    if (isPanning || suppressCanvasClickRef.current) {
      suppressCanvasClickRef.current = false;
      return;
    }

    setSelection([]);
    setSelectedEdgeIdentity(null);
    setEditingEdgeIdentity(null);
    setToolbarOpen(false);
    setShapePickerOpen(false);
    setEditingNodeId(null);
  }, [isPanning, setSelection]);

  const handleNodeActivation = useCallback((nodeId: string) => {
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

  }, [connectSourceId, interactiveNodeBounds, isFlowchart, mode]);

  const handleNodeClick = useCallback((nodeId: string, shiftKey: boolean) => {
    const currentSelection = selectionRef.current;
    setSelection(getNodeClickSelection(currentSelection, nodeId, shiftKey));
    handleNodeActivation(nodeId);
  }, [handleNodeActivation, setSelection]);

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

  const handleFlowNodesChange = useCallback<OnNodesChange<MermaidFlowNode>>((changes) => {
    setFlowNodeRuntime((current) => applyControlledNodeChanges(
      flowNodes,
      current,
      changes,
      activeDragNodeIdsRef.current,
    ));
  }, [flowNodes]);

  const handleFlowSelectionChange = useCallback(({ nodes }: { nodes: MermaidFlowNode[] }) => {
    if (!canEditStructure) {
      return;
    }

    const nextSelection = getFlowSelectionChange(nodes, flowNodeIdsRef.current);
    if (nextSelection === null) {
      return;
    }

    setSelection(nextSelection);
  }, [canEditStructure, setSelection]);

  const handleFlowNodeDragStart = useCallback<OnNodeDrag<MermaidFlowNode>>((_event, node, nodes) => {
    if (!canEditStructure) {
      return;
    }
    const positions = getDraggedNodePositions(node, nodes);
    if (!positions) {
      return;
    }
    if (onNodeDragStart?.(positions) === false) {
      return;
    }
    Object.keys(positions).forEach((nodeId) => activeDragNodeIdsRef.current.add(nodeId));
    setLiveNodePositions((current) => {
      return { ...current, ...positions };
    });
  }, [canEditStructure, onNodeDragStart]);

  const handleFlowNodeDrag = useCallback<OnNodeDrag<MermaidFlowNode>>((_event, node, nodes) => {
    if (!canEditStructure) {
      return;
    }
    const positions = getDraggedNodePositions(node, nodes);
    if (!positions || !Object.keys(positions).some((nodeId) => activeDragNodeIdsRef.current.has(nodeId))) {
      return;
    }
    setLiveNodePositions((current) => ({ ...current, ...positions }));
    onNodeDrag?.(positions);
  }, [canEditStructure, onNodeDrag]);

  const handleFlowNodeDragStop = useCallback<OnNodeDrag<MermaidFlowNode>>((_event, node, nodes) => {
    if (!canEditStructure) {
      return;
    }
    const positions = getDraggedNodePositions(node, nodes);
    if (!positions) {
      return;
    }
    Object.keys(positions).forEach((nodeId) => activeDragNodeIdsRef.current.delete(nodeId));
    if (onNodeDragStop) {
      onNodeDragStop(positions);
    } else {
      setNodePositions((current) => ({
        ...current,
        ...positions,
      }), 'merge', positions);
    }
    setFlowNodeRuntime((current) => releaseControlledNodeRuntime(current, Object.keys(positions)));
    setLiveNodePositions((current) => {
      const next = { ...current };
      Object.keys(positions).forEach((nodeId) => delete next[nodeId]);
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
  const dotGridGeometry = useMemo(() => getCanvasDotGridGeometry(viewport), [viewport]);
  const dotGridLayerStyle = useMemo<CSSProperties & Record<'--canvas-grid-dot-radius', string>>(() => ({
    '--canvas-grid-dot-radius': dotGridGeometry.dotRadius,
    backgroundPosition: dotGridGeometry.backgroundPosition,
    backgroundSize: dotGridGeometry.backgroundSize,
    inset: 0,
    pointerEvents: 'none',
    position: 'absolute',
    transitionDuration: animateTransform && !useReactFlowRenderer ? '180ms, 180ms, 180ms' : undefined,
    transitionProperty: animateTransform && !useReactFlowRenderer
      ? 'background-position, background-size, --canvas-grid-dot-radius'
      : undefined,
    transitionTimingFunction: animateTransform && !useReactFlowRenderer ? 'ease, ease, ease' : undefined,
  }), [animateTransform, dotGridGeometry, useReactFlowRenderer]);

  const canvasCursor = readOnly ? 'default' : isPanning ? 'grabbing' : mode === 'connect' ? 'crosshair' : spacePressed ? 'grab' : 'default';
  const hasGraphNodes = (graph?.nodes.length ?? 0) > 0;

  return (
    <div
      aria-label="Interactive diagram canvas"
      className={className}
      data-selected-node-ids={getCanonicalSelectionAttribute(selection)}
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
      onPointerDownCapture={handlePointerDownCapture}
      onPointerLeave={() => {
        setCursorPoint(null);
        onCanvasCursorChange?.(null);
      }}
      onPointerMove={handlePointerMove}
      onPointerMoveCapture={handleTouchPointerMove}
      onPointerCancel={handlePointerUp}
      onLostPointerCapture={handleLostPointerCapture}
      onPointerUp={handlePointerUp}
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
        touchAction: 'none',
      }}
      tabIndex={0}
    >
      <div
        aria-hidden="true"
        className="canvas-dot-grid"
        data-testid="canvas-dot-grid"
        style={dotGridLayerStyle}
      />
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
                    border: '1px solid transparent',
                    borderRadius: 12,
                    cursor: readOnly ? 'default' : 'pointer',
                    height: bounds.height,
                    left: bounds.x,
                    opacity: 1,
                    outline: selected || focused ? '2px solid var(--selection)' : 'none',
                    outlineOffset: 3,
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
          <FlowEdgeMarkers colors={flowEdgeMarkerColors} />
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
              multiSelectionKeyCode="Shift"
              nodes={controlledFlowNodes}
              nodesConnectable={canEditStructure}
              nodesDraggable={canEditStructure}
              nodesFocusable={canEditStructure}
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
              onNodesChange={handleFlowNodesChange}
              onSelectionChange={handleFlowSelectionChange}
              onMove={(_event, nextViewport) => {
                setAnimateTransform(false);
                setViewport((current) => reconcileReactFlowViewport(current, nextViewport));
              }}
              onPaneClick={handleCanvasClick}
              panOnDrag={false}
              preventScrolling={false}
              proOptions={FLOW_PRO_OPTIONS}
              selectionKeyCode="Shift"
              selectionMode={SelectionMode.Full}
              selectionOnDrag={shouldEnableCanvasMarquee(canEditStructure, mode, isCoarsePointer)}
              viewport={flowViewport}
              zoomOnDoubleClick={false}
              zoomOnPinch={false}
              zoomOnScroll={false}
            />
          </FlowNodeInteractionContext.Provider>
        </div>
      ) : null}

      <div aria-hidden="true" style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 10 }}>
        {remoteCanvasPresence.flatMap((presence) => {
          const cursor = presence.canvas.cursor;
          if (!cursor) return [];
          return [
            <div
              data-participant-name={presence.participant.name}
              data-testid={`remote-canvas-cursor-${presence.client_id}`}
              key={`remote-canvas-cursor-${presence.client_id}`}
              style={{
                color: presence.participant.color,
                left: (cursor.x * viewport.zoom) + viewport.panX,
                position: 'absolute',
                top: (cursor.y * viewport.zoom) + viewport.panY,
                transform: 'translate(-1px, -1px)',
              }}
            >
              <svg height="14" viewBox="0 0 14 18" width="11">
                <path d="M1 1 12 11 7 12.5 5 17Z" fill="currentColor" stroke="var(--surface-canvas)" strokeWidth="1.4" />
              </svg>
              <span
                style={{
                  background: 'var(--surface-raised)',
                  border: '1px solid currentColor',
                  borderRadius: 3,
                  color: 'var(--ink)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 10,
                  fontWeight: 700,
                  left: 9,
                  lineHeight: 1.2,
                  padding: '2px 4px',
                  position: 'absolute',
                  top: 10,
                  whiteSpace: 'nowrap',
                }}
              >{getCanvasPresenceLabel(presence.participant.name)}</span>
            </div>,
          ];
        })}
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
            ref={addNodeToolbarRef}
            onSubmit={(event) => {
              event.preventDefault();
              addNodeFromToolbar();
            }}
            style={{
              alignItems: 'center',
              background: 'var(--control-surface)',
              border: '1px solid var(--control-border)',
              borderRadius: 10,
              color: 'var(--ink-muted)',
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              left: canvasToolbarStack.left,
              maxWidth: canvasViewport.width > 0 ? Math.max(1, canvasViewport.width - (BOTTOM_TOOLBAR_INSET * 2)) : 'calc(100% - 24px)',
              padding: '8px 10px',
              pointerEvents: 'auto',
              position: 'absolute',
              bottom: canvasToolbarStack.bottom + controlsToolbarHeight + BOTTOM_TOOLBAR_GAP,
              visibility: canvasToolbarVisibility.addNode ? 'visible' : 'hidden',
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
            <ToolbarButton label="Add node to Mermaid text" onClick={addNodeFromToolbar} shortcut="N">
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
              className="canvas-empty-add-button"
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
              }} shortcut="F2">
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
            }} shortcut="C">
              <ArrowRightFromLine size={16} />
            </ToolbarButton>
            {selection.length > 0 ? (
              <ToolbarButton label="Delete selected nodes" onClick={() => { onDeleteNodes?.(selection); }} shortcut="Delete or Backspace" hint="⌫">
                <Trash2 size={16} />
              </ToolbarButton>
            ) : null}
            <ToolbarButton label="Add node" onClick={addDefaultNode} shortcut="N">
              <Plus size={16} />
            </ToolbarButton>
            <ToolbarButton label="Copy selected nodes" onClick={copySelectedNodes} shortcut="Ctrl/Cmd+C" hint="C">
              <ClipboardCopy size={16} />
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
            ref={controlsToolbarRef}
            style={{
              alignItems: 'center',
              background: 'var(--control-surface)',
              border: '1px solid var(--control-border)',
              borderRadius: 8,
              bottom: canvasToolbarStack.bottom,
              color: 'var(--ink-muted)',
              display: 'inline-flex',
              gap: 6,
              maxWidth: canvasViewport.width > 0 ? Math.max(1, canvasViewport.width - (BOTTOM_TOOLBAR_INSET * 2)) : 'calc(100% - 24px)',
              padding: '4px 6px',
              pointerEvents: 'auto',
              position: 'absolute',
              right: canvasToolbarStack.right,
              visibility: canvasToolbarVisibility.controls ? 'visible' : 'hidden',
              zIndex: 30,
            }}
          >
            {isFlowchart && hasPersistedLayout ? (
              <ToolbarButton label="Simplify layout" onClick={() => { simplifyLayout(); }} shortcut="S">
                <RotateCcw size={16} />
              </ToolbarButton>
            ) : null}
            {isFlowchart && hasCanvasClipboard ? (
              <ToolbarButton label="Paste copied nodes" onClick={pasteClipboard} shortcut="Ctrl/Cmd+V" hint="V">
                <ClipboardPaste size={16} />
              </ToolbarButton>
            ) : null}
            <ToolbarButton label="Zoom out" onClick={() => { zoomCanvas(0.9); }} shortcut="−">
              <ZoomOut size={16} />
            </ToolbarButton>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, minWidth: 44, textAlign: 'center' }}>
              {Math.round(viewport.zoom * 100)}%
            </span>
            <ToolbarButton label="Zoom in" onClick={() => { zoomCanvas(1.1); }} shortcut="+">
              <ZoomIn size={16} />
            </ToolbarButton>
            <ToolbarButton label="Fit diagram" onClick={() => { fitToDiagram(true); }} shortcut="F">
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

function FlowEdgeMarkers({ colors }: { colors: string[] }) {
  return (
    <svg aria-hidden="true" focusable="false" style={{ height: 0, position: 'absolute', width: 0 }}>
      <defs>
        {colors.flatMap((color) => {
          const circle = getCanvasEdgeMarker('arrow_circle', color);
          const cross = getCanvasEdgeMarker('arrow_cross', color);
          return [
            <marker
              id={circle.id}
              key={circle.id}
              markerHeight="10"
              markerUnits="strokeWidth"
              markerWidth="10"
              orient="auto"
              refX="9"
              refY="5"
              viewBox="0 0 10 10"
            >
              <circle cx="5" cy="5" fill="var(--surface-canvas)" r="3" stroke={circle.color} strokeWidth="1.6" />
            </marker>,
            <marker
              id={cross.id}
              key={cross.id}
              markerHeight="10"
              markerUnits="strokeWidth"
              markerWidth="10"
              orient="auto"
              refX="9"
              refY="5"
              viewBox="0 0 10 10"
            >
              <path d="M3 3 L7 7 M7 3 L3 7" fill="none" stroke={cross.color} strokeLinecap="round" strokeWidth="1.8" />
            </marker>,
          ];
        })}
      </defs>
    </svg>
  );
}

function MermaidReactFlowNode({ data, id, selected }: NodeProps<MermaidFlowNode>) {
  const interaction = useContext(FlowNodeInteractionContext);
  const focused = interaction?.focusedNodeId === id;
  const label = data.ariaLabel;
  const handleColor = getCanvasHandlePaint(Boolean(selected || focused || interaction?.connectMode));
  const remoteSelection = data.remoteSelections[0];
  const remoteSelectionLabel = remoteSelection
    ? `${getCanvasPresenceLabel(remoteSelection.participant.name)}${data.remoteSelections.length > 1 ? ` +${data.remoteSelections.length - 1}` : ''}`
    : null;

  return (
    <div
      aria-label={label}
      aria-pressed={selected}
      className={`mermaid-flow-node${selected ? ' is-selected' : ''}${focused ? ' is-focused' : ''}`}
      onFocus={() => { interaction?.onFocus(id); }}
      onKeyDown={(event) => { interaction?.onKeyDown(id, event); }}
      ref={(element) => { interaction?.registerNodeElement(id, element); }}
      role="button"
      tabIndex={focused ? 0 : -1}
    >
      {FLOW_HANDLE_POSITIONS.map((position) => (
        <Handle
          className={`mermaid-flow-handle mermaid-flow-handle--${position} mermaid-flow-handle--target`}
          id={getFlowHandleId('target', position)}
          isConnectableStart={false}
          key={`target-${position}`}
          position={position}
          style={{ background: handleColor, borderColor: 'var(--surface-canvas)' }}
          type="target"
        />
      ))}
      <div
        className={`mermaid-flow-node-surface mermaid-flow-node-surface--${getShapeClassName(data.shape)}`}
        style={getCanvasNodePaint(data.presentation)}
      >
        {remoteSelection ? (
          <span
            className={`mermaid-flow-node-remote-outline mermaid-flow-node-remote-outline--${getShapeClassName(data.shape)}`}
            style={{ '--remote-selection-color': remoteSelection.participant.color } as CSSProperties}
          />
        ) : null}
        <span>{data.label}</span>
      </div>
      {remoteSelection && remoteSelectionLabel ? (
        <span
          className="mermaid-flow-node-remote-label"
          data-testid={`remote-node-selection-${id}`}
          style={{ backgroundColor: remoteSelection.participant.color }}
        >{remoteSelectionLabel}</span>
      ) : null}
      {FLOW_HANDLE_POSITIONS.map((position) => (
        <Handle
          className={`mermaid-flow-handle mermaid-flow-handle--${position} mermaid-flow-handle--source`}
          id={getFlowHandleId('source', position)}
          isConnectableEnd={false}
          key={`source-${position}`}
          position={position}
          style={{ background: handleColor, borderColor: 'var(--surface-canvas)' }}
          type="source"
        />
      ))}
    </div>
  );
}

function ToolbarButton({
  children,
  disabled = false,
  label,
  onClick,
  hint,
  shortcut,
}: {
  children: ReactNode;
  disabled?: boolean;
  label: string;
  onClick: () => void;
  hint?: string;
  shortcut?: string;
}) {
  const title = shortcut ? `${label} (${shortcut})` : label;
  return (
    <button aria-label={label} className="canvas-toolbar-button" data-testid={`canvas-action-${toTestId(label)}`} disabled={disabled} onClick={onClick} style={{ ...TOOLBAR_BUTTON_STYLE, opacity: disabled ? 0.45 : 1, position: 'relative' }} title={title} type="button">
      {children}
      {shortcut ? <span aria-hidden="true" className="canvas-toolbar-shortcut">{hint ?? shortcut}</span> : null}
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

export function getFlowEdgePresentation(link: DiagramLink, presentation: MermaidItemPresentation = {}): Pick<Edge, 'markerEnd' | 'style'> {
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
      return { markerEnd: getCanvasEdgeMarker('arrow_circle', markerColor).id, style };
    case 'arrow_cross':
      return { markerEnd: getCanvasEdgeMarker('arrow_cross', markerColor).id, style };
    case 'arrow_point':
    default:
      return { markerEnd: { color: markerColor, type: MarkerType.ArrowClosed }, style };
  }
}

function getCanvasPresenceLabel(name: string): string {
  return name.replace(/-[a-z0-9]{2}$/i, '');
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

export function areSvgHitMapsEqual(left: SvgHitMap | null, right: SvgHitMap | null): boolean {
  if (left === right) {
    return true;
  }
  if (!left || !right || !areBoundsEqual(left.viewBox, right.viewBox)) {
    return false;
  }

  return areBoundsMapsEqual(left.nodes, right.nodes)
    && areBoundsMapsEqual(left.subgraphs, right.subgraphs)
    && areBoundsMapsEqual(
      new Map([...left.edges.entries()].map(([id, edge]) => [id, edge.bounds])),
      new Map([...right.edges.entries()].map(([id, edge]) => [id, edge.bounds])),
    );
}

export function areMermaidPresentationsEqual(left: MermaidPresentation, right: MermaidPresentation): boolean {
  if (left.edges.length !== right.edges.length || left.nodes.size !== right.nodes.size) {
    return false;
  }

  return left.edges.every((edge, index) => areMermaidItemPresentationsEqual(edge, right.edges[index]))
    && [...left.nodes.entries()].every(([id, presentation]) => areMermaidItemPresentationsEqual(presentation, right.nodes.get(id)));
}

function areBoundsMapsEqual(left: ReadonlyMap<string, SvgBounds>, right: ReadonlyMap<string, SvgBounds>): boolean {
  return left.size === right.size
    && [...left.entries()].every(([id, bounds]) => areBoundsEqual(bounds, right.get(id)));
}

function areBoundsEqual(left: SvgBounds | undefined, right: SvgBounds | undefined): boolean {
  return left?.height === right?.height
    && left?.width === right?.width
    && left?.x === right?.x
    && left?.y === right?.y;
}

function areMermaidItemPresentationsEqual(left: MermaidItemPresentation | undefined, right: MermaidItemPresentation | undefined): boolean {
  return left?.fill === right?.fill
    && left?.stroke === right?.stroke
    && left?.strokeDasharray === right?.strokeDasharray
    && left?.strokeWidth === right?.strokeWidth
    && left?.text === right?.text;
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
