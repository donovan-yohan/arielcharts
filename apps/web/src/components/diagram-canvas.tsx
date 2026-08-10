'use client';

import type { CanvasPresenceEntry, CanvasWorldPoint } from '@arielcharts/shared';
import type { CSSProperties, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent, ReactNode } from 'react';
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
import { applyCanvasWheelGesture, getCanvasWheelGesture } from '../lib/canvas-wheel-gesture';
import { getConnectModeSourceId, getConnectNodeActivation } from '../lib/diagram-connect-state';
import { getCanvasDotGridGeometry } from '../lib/canvas-dot-grid';
import { beginCanvasMousePan, CanvasMousePanController } from '../lib/canvas-mouse-pan';
import { getDiagramEdgeIdentityForFlowEdge, getFlowEdgeId, getVisibleDiagramLinks } from '../lib/diagram-flow-identity';
import type { DiagramNodePositions, NodePositionsSyncMode } from '../lib/diagram-layout';
import { canRenameFlowchartSubgraphDeclaration, getFlowchartCanvasBounds, getInteractiveSubgraphBounds, getNestedSubgraphNodeIds, getSubgraphLabel } from '../lib/diagram-subgraphs';
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
  buildSequenceSvgTextHitMap,
  buildSvgHitMap,
  getBoundsCenter,
  getBoundsUnion,
  getNodePortPosition,
  resolveSequenceSvgTextTarget,
  type SvgBounds,
  type SvgHitMap,
  type SvgPoint,
  type SequenceSvgTextItem,
  type SequenceSvgTextTarget,
} from '../lib/svg-hit-map';
import { getSafeToolbarPosition } from '../lib/toolbar-safe-area';
import type { SequenceActivationAction, SequenceArrow, SequenceDiagramSnapshot, SequenceFragmentKind, SequenceMessage, SequenceNote, SequenceParticipant, SequenceParticipantKind } from '../lib/sequence-mutations';
import { getErRelationshipIdentity, type ErAttribute, type ErDiagramSnapshot, type ErRelationship, type ErRelationshipIdentity } from '../lib/er-mutations';

export type DiagramEmptyState = 'chooser' | 'flowchart' | 'sequence' | null;

export interface DiagramCanvasProps {
  className?: string;
  emptyMessage?: string;
  graph: FlowchartSnapshot | null;
  interactionMode?: 'select' | 'connect';
  emptyState?: DiagramEmptyState;
  isFlowchart?: boolean;
  mermaidSource?: string;
  isSequence?: boolean;
  isEr?: boolean;
  nodePositions?: DiagramNodePositions;
  preserveCamera?: boolean;
  readOnly?: boolean;
  selectedNodeIds?: string[];
  svg: string;
  sequenceParticipants?: readonly SequenceParticipant[];
  sequenceDiagram?: SequenceDiagramSnapshot | null;
  sequenceTextItems?: readonly SequenceSvgTextItem[];
  erDiagram?: ErDiagramSnapshot | null;
  theme?: 'light' | 'dark';
  onAddEdge?: (source: string, target: string, label?: string, type?: DiagramLinkType) => void;
  onAddNode?: (label: string, shape: DiagramNodeShape) => void;
  onAddSequenceMessage?: (from: string, to: string, message: string, arrow?: SequenceArrow) => void;
  onAddSequenceParticipant?: (label: string, kind?: SequenceParticipantKind) => void;
  onAddSequenceNote?: (placement: SequenceNote['placement'], participants: string[], text: string) => void;
  onAddSequenceActivation?: (action: SequenceActivationAction, participant: string) => void;
  onAddSequenceFragment?: (kind: SequenceFragmentKind, label: string) => void;
  onDeleteSequenceParticipant?: (id: string) => void;
  onDeleteSequenceMessage?: (id: string) => void;
  onDeleteSequenceNote?: (id: string) => void;
  onDeleteSequenceActivation?: (id: string) => void;
  onDeleteSequenceFragment?: (id: string) => void;
  onEditSequenceParticipant?: (id: string, label: string) => void;
  onRenameSequenceParticipantId?: (id: string, nextId: string) => void;
  onEditSequenceMessage?: (id: string, patch: Partial<Pick<SequenceMessage, 'from' | 'to' | 'arrow' | 'text'>>) => void;
  onEditSequenceNote?: (id: string, patch: Partial<Pick<SequenceNote, 'placement' | 'participants' | 'text'>>) => void;
  onEditSequenceActivation?: (id: string, action: SequenceActivationAction, participant: string) => void;
  onEditSequenceFragment?: (id: string, label: string) => void;
  onMoveSequenceParticipant?: (id: string, direction: 'up' | 'down') => void;
  onMoveSequenceMessage?: (id: string, direction: 'up' | 'down') => void;
  onMoveSequenceNote?: (id: string, direction: 'up' | 'down') => void;
  onMoveSequenceActivation?: (id: string, direction: 'up' | 'down') => void;
  onMoveSequenceFragment?: (id: string, direction: 'up' | 'down') => void;
  onSetSequenceAutonumber?: (value: string) => void;
  onEditSequenceStatement?: (id: string, text: string) => void;
  onAddErEntity?: (name: string) => void;
  onRenameErEntity?: (currentName: string, nextName: string) => void;
  onDeleteErEntity?: (name: string) => void;
  onMoveErEntity?: (name: string, direction: 'up' | 'down') => void;
  onAddErAttribute?: (entityName: string, attribute: Partial<ErAttribute>) => void;
  onEditErAttribute?: (entityName: string, attributeName: string, attribute: ErAttribute) => void;
  onDeleteErAttribute?: (entityName: string, attributeName: string) => void;
  onMoveErAttribute?: (entityName: string, attributeName: string, direction: 'up' | 'down') => void;
  onAddErRelationship?: (relationship: ErRelationship) => void;
  onEditErRelationship?: (identity: ErRelationshipIdentity, relationship: ErRelationship) => void;
  onDeleteErRelationship?: (identity: ErRelationshipIdentity) => void;
  onAddConnectedNode?: (source: string, label: string, shape: DiagramNodeShape, position: SvgPoint, type: DiagramLinkType) => void;
  onCanvasCursorChange?: (point: CanvasWorldPoint | null) => void;
  onChangeNodeShape?: (nodeId: string, newShape: DiagramNodeShape) => void;
  onChooseDiagramType?: (type: 'flowchart' | 'sequence') => void;
  onDeleteEdge?: (edge: DiagramEdgeIdentity) => void;
  onDeleteNodes?: (nodeIds: string[]) => void;
  onEditEdgeLabel?: (edge: DiagramEdgeIdentity, label?: string) => void;
  onEditNodeLabel?: (nodeId: string, newLabel: string) => void;
  onNodeEditingChange?: (nodeId: string | null) => void;
  onEditSubgraphLabel?: (subgraphId: string, newLabel: string) => void;
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

interface SafariGestureEvent extends Event {
  clientX: number;
  clientY: number;
  scale: number;
}

interface SubgraphDragState {
  begun: boolean;
  initialPositions: DiagramNodePositions;
  latestPositions: DiagramNodePositions;
  origin: SvgPoint;
  pointerId: number;
}

interface MermaidFlowNodeData extends Record<string, unknown> {
  ariaLabel: string;
  label: string;
  presentation: MermaidItemPresentation;
  shape: DiagramNodeShape;
  remoteSelections: readonly CanvasPresenceEntry[];
  remoteEditors: readonly CanvasPresenceEntry[];
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
  targetIsInCanvas: boolean,
  activeElementIsInCanvas: boolean,
  targetIsExcluded: boolean,
  activeElementIsExcluded: boolean,
): boolean {
  return targetIsInCanvas
    && activeElementIsInCanvas
    && !targetIsExcluded
    && !activeElementIsExcluded;
}

export function shouldHandleGlobalCanvasRenameShortcut(
  defaultPrevented: boolean,
  targetHasLocalRenameHandler: boolean,
): boolean {
  return !defaultPrevented && !targetHasLocalRenameHandler;
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

export const CANVAS_PAN_EXCLUSION_SELECTOR = 'a, button, input, select, textarea, form, [contenteditable="true"], [role="button"], [data-canvas-pan-exclusion="true"], [data-subgraph-drag-target="true"], [data-testid*="toolbar"], .react-flow__node, .react-flow__edge, .react-flow__handle';

function canStartTouchCanvasGesture(target: EventTarget | null, root: HTMLDivElement): boolean {
  if (!(target instanceof Element)) {
    return false;
  }

  if (target.closest(CANVAS_PAN_EXCLUSION_SELECTOR)) {
    return false;
  }

  return root.contains(target);
}

function canStartMouseCanvasPan(target: EventTarget | null, root: HTMLDivElement): boolean {
  if (!(target instanceof Element) || !root.contains(target)) {
    return false;
  }

  if (target.closest('[data-subgraph-drag-target="true"]')) {
    return true;
  }

  return !target.closest(CANVAS_PAN_EXCLUSION_SELECTOR);
}

function canHandleCanvasWheel(target: EventTarget | null, root: HTMLDivElement): boolean {
  if (!(target instanceof Element) || !root.contains(target)) {
    return false;
  }

  return !target.closest(CANVAS_PAN_EXCLUSION_SELECTOR);
}

export function DiagramCanvas({
  className,
  emptyMessage = 'start typing mermaid syntax',
  emptyState = null,
  graph,
  interactionMode,
  isFlowchart = true,
  mermaidSource = '',
  isSequence = false,
  isEr = false,
  nodePositions,
  preserveCamera = false,
  onAddEdge,
  onAddNode,
  onAddSequenceMessage,
  onAddSequenceParticipant,
  onAddSequenceNote,
  onAddSequenceActivation,
  onAddSequenceFragment,
  onDeleteSequenceParticipant,
  onDeleteSequenceMessage,
  onDeleteSequenceNote,
  onDeleteSequenceActivation,
  onDeleteSequenceFragment,
  onEditSequenceParticipant,
  onRenameSequenceParticipantId,
  onEditSequenceMessage,
  onEditSequenceNote,
  onEditSequenceActivation,
  onEditSequenceFragment,
  onMoveSequenceParticipant,
  onMoveSequenceMessage,
  onMoveSequenceNote,
  onMoveSequenceActivation,
  onMoveSequenceFragment,
  onSetSequenceAutonumber,
  onEditSequenceStatement,
  onAddErEntity,
  onRenameErEntity,
  onDeleteErEntity,
  onMoveErEntity,
  onAddErAttribute,
  onEditErAttribute,
  onDeleteErAttribute,
  onMoveErAttribute,
  onAddErRelationship,
  onEditErRelationship,
  onDeleteErRelationship,
  onAddConnectedNode,
  onCanvasCursorChange,
  onChangeNodeShape,
  onChooseDiagramType,
  onDeleteEdge,
  onDeleteNodes,
  onEditEdgeLabel,
  onEditNodeLabel,
  onNodeEditingChange,
  onEditSubgraphLabel,
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
  sequenceParticipants = [],
  sequenceDiagram = null,
  sequenceTextItems = [],
  erDiagram = null,
  svg,
  theme = 'dark',
}: DiagramCanvasProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const svgContainerRef = useRef<HTMLDivElement | null>(null);
  const addNodeToolbarRef = useRef<HTMLFormElement | null>(null);
  const controlsToolbarRef = useRef<HTMLDivElement | null>(null);
  const onRenderSettledRef = useRef(onRenderSettled);
  const touchGestureRef = useRef(new CanvasTouchGestureController());
  const safariPinchScaleRef = useRef<number | null>(null);
  const nodeButtonRefs = useRef(new Map<string, HTMLElement | null>());
  const [hitMap, setHitMap] = useState<SvgHitMap | null>(null);
  const [sequenceTextHitMap, setSequenceTextHitMap] = useState<Map<Element, SequenceSvgTextTarget> | null>(null);
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
  const subgraphDragRef = useRef<SubgraphDragState | null>(null);
  const cancelSubgraphEditRef = useRef(false);
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
  const [editingSequenceTarget, setEditingSequenceTarget] = useState<SequenceSvgTextTarget | null>(null);
  const [editingSequenceText, setEditingSequenceText] = useState('');
  const [editingSequenceAnchor, setEditingSequenceAnchor] = useState<{ x: number; y: number; width: number } | null>(null);
  const sequenceEditorOriginRef = useRef<HTMLElement | SVGElement | null>(null);
  const [selectedEdgeIdentity, setSelectedEdgeIdentity] = useState<DiagramEdgeIdentity | null>(null);
  const [editingEdgeIdentity, setEditingEdgeIdentity] = useState<DiagramEdgeIdentity | null>(null);
  const [editingEdgeLabel, setEditingEdgeLabel] = useState('');
  const [selectedSubgraphId, setSelectedSubgraphId] = useState<string | null>(null);
  const [editingSubgraphId, setEditingSubgraphId] = useState<string | null>(null);
  const [editingSubgraphLabel, setEditingSubgraphLabel] = useState('');
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
  const onNodeEditingChangeRef = useRef(onNodeEditingChange);
  onRenderSettledRef.current = onRenderSettled;
  onCanvasCursorChangeRef.current = onCanvasCursorChange;
  onNodeEditingChangeRef.current = onNodeEditingChange;

  useEffect(() => () => {
    onCanvasCursorChangeRef.current?.(null);
    onNodeEditingChangeRef.current?.(null);
  }, []);

  useEffect(() => {
    onNodeEditingChange?.(readOnly ? null : editingNodeId);
  }, [editingNodeId, onNodeEditingChange, readOnly]);

  useEffect(() => {
    if (readOnly && editingNodeId) {
      setEditingNodeId(null);
      setEditingLabel('');
    }
  }, [editingNodeId, readOnly]);

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
  const subgraphById = useMemo(() => new Map(graph?.subgraphs.map((subgraph) => [subgraph.id, subgraph]) ?? []), [graph?.subgraphs]);
  const subgraphMemberNodeIds = useMemo(() => new Map(
    (graph?.subgraphs ?? []).map((subgraph) => [
      subgraph.id,
      getNestedSubgraphNodeIds(subgraph.id, graph?.subgraphs ?? [], graph?.nodeIds ?? []),
    ]),
  ), [graph?.nodeIds, graph?.subgraphs]);
  const interactiveSubgraphBounds = useMemo(() => {
    const next = new Map<string, SvgBounds>();
    if (!hitMap || !interactiveNodeBounds) return next;
    for (const [subgraphId, bounds] of hitMap.subgraphs) {
      next.set(subgraphId, getInteractiveSubgraphBounds(
        bounds,
        hitMap.nodes,
        interactiveNodeBounds,
        subgraphMemberNodeIds.get(subgraphId) ?? [],
      ));
    }
    return next;
  }, [hitMap, interactiveNodeBounds, subgraphMemberNodeIds]);
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
  const useReactFlowRenderer = isFlowchart && Boolean(
    graph?.nodes.some((node) => interactiveNodeBounds?.has(node.id)),
  );

  const graphBounds = useMemo(() => {
    if (!hitMap) {
      return null;
    }

    if (!isFlowchart) {
      return hitMap.viewBox;
    }

    return getFlowchartCanvasBounds(
      interactiveNodeBounds ?? hitMap.nodes,
      hitMap.subgraphs,
      interactiveSubgraphBounds,
      [...hitMap.edges.values()].map((edge) => edge.bounds),
      useReactFlowRenderer,
    ) ?? hitMap.viewBox;
  }, [hitMap, interactiveNodeBounds, interactiveSubgraphBounds, isFlowchart, useReactFlowRenderer]);

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
  const remoteEditorsByNodeId = useMemo(() => {
    const editors = new Map<string, CanvasPresenceEntry[]>();
    for (const presence of remoteCanvasPresence) {
      const nodeId = presence.canvas.editing_node_id;
      if (!nodeId) continue;
      const current = editors.get(nodeId) ?? [];
      current.push(presence);
      editors.set(nodeId, current);
    }
    return editors;
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
          remoteEditors: remoteEditorsByNodeId.get(node.id) ?? [],
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
  }, [graph, interactiveNodeBounds, isFlowchart, mermaidPresentation.nodes, readOnly, remoteEditorsByNodeId, remoteSelectionsByNodeId, selection]);
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

  const selectedSubgraphBounds = selectedSubgraphId
    ? interactiveSubgraphBounds.get(selectedSubgraphId) ?? null
    : null;
  const screenSelectedSubgraphBounds = useMemo(() => (
    selectedSubgraphBounds ? toScreenRect(selectedSubgraphBounds, viewport) : null
  ), [selectedSubgraphBounds, viewport]);
  const selectedSubgraphCanRename = Boolean(
    selectedSubgraphId && canRenameFlowchartSubgraphDeclaration(mermaidSource, selectedSubgraphId),
  );

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
  const erEditorBottom = canvasToolbarStack.bottom + controlsToolbarHeight + BOTTOM_TOOLBAR_GAP;
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
  const selectedSubgraphToolbarPosition = getSafeToolbarPosition({
    anchor: screenSelectedSubgraphBounds
      ? { x: screenSelectedSubgraphBounds.x + (screenSelectedSubgraphBounds.width / 2), y: screenSelectedSubgraphBounds.y }
      : { x: 16, y: 16 },
    canvas: canvasViewport,
    toolbar: { height: 34, width: 44 },
  });
  const subgraphToolbarStyle: CSSProperties = {
    ...toolbarStyle,
    left: selectedSubgraphToolbarPosition.left,
    top: selectedSubgraphToolbarPosition.top,
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

  const toggleConnectMode = useCallback(() => {
    const nextMode = mode === 'connect' ? 'select' : 'connect';
    setPendingEdge(null);
    setPendingEdgeLabel('');
    setConnectSourceId(nextMode === 'connect' ? getConnectModeSourceId(selectionRef.current) : null);
    setMode(nextMode);
  }, [mode, setMode]);

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
      setSequenceTextHitMap((current) => current === null ? current : null);
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
        setSequenceTextHitMap(null);
        setMermaidPresentation({ edges: [], nodes: new Map() });
        return;
      }

      const expectedNodeIds = graph?.nodes.map((node) => node.id) ?? [];
      const expectedSubgraphIds = graph?.subgraphs.map((subgraph) => subgraph.id) ?? [];
      const nextHitMap = buildSvgHitMap(svgElement, { nodeIds: expectedNodeIds, subgraphIds: expectedSubgraphIds });
      const nextSequenceTextHitMap = isSequence
        ? buildSequenceSvgTextHitMap(svgElement, sequenceTextItems)
        : null;
      const nextPresentation = extractMermaidPresentation(svgElement, expectedNodeIds);
      setHitMap((current) => areSvgHitMapsEqual(current, nextHitMap) ? current : nextHitMap);
      setSequenceTextHitMap(nextSequenceTextHitMap);
      setMermaidPresentation((current) => areMermaidPresentationsEqual(current, nextPresentation) ? current : nextPresentation);
      onRenderSettledRef.current?.();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [graphMembershipKey, isSequence, sequenceTextItems, svg]);

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
    if (editingNodeId && !nodeById.has(editingNodeId)) {
      setEditingNodeId(null);
      setEditingLabel('');
    }
  }, [editingNodeId, nodeById]);

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
    if (selectedSubgraphId && !subgraphById.has(selectedSubgraphId)) {
      setSelectedSubgraphId(null);
    }
    if (editingSubgraphId && !subgraphById.has(editingSubgraphId)) {
      setEditingSubgraphId(null);
      setEditingSubgraphLabel('');
    }
  }, [editingSubgraphId, selectedSubgraphId, subgraphById]);

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
    setSelectedSubgraphId(null);
    setEditingSubgraphId(null);
    setEditingSubgraphLabel('');
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
        setSelectedSubgraphId(null);
        setEditingSubgraphId(null);
        setEditingSubgraphLabel('');
        setMode('select');
        canvas?.focus();
      }

      if (!ownsCanvas) {
        return;
      }

      const isModifierShortcut = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      const canvasOwnsSingleKeyFocus = shouldHandleCanvasSingleKeyShortcut(
        event.target instanceof Node && Boolean(canvas?.contains(event.target)),
        document.activeElement instanceof Node && Boolean(canvas?.contains(document.activeElement)),
        isCanvasSingleKeyShortcutExcluded(event.target),
        isCanvasSingleKeyShortcutExcluded(document.activeElement),
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

      if (!isModifierShortcut && canvasOwnsSingleKeyFocus && canEditStructure && key === 'n') {
        event.preventDefault();
        onAddNode?.(DEFAULT_NEW_NODE_LABEL, DEFAULT_NEW_NODE_SHAPE);
        return;
      }

      if (!isModifierShortcut && canvasOwnsSingleKeyFocus && canEditStructure && key === 'c') {
        event.preventDefault();
        toggleConnectMode();
        return;
      }

      if (!isModifierShortcut && canvasOwnsSingleKeyFocus && canEditStructure && hasPersistedLayout && key === 's') {
        event.preventDefault();
        simplifyLayout();
        return;
      }

      if (!isModifierShortcut && canvasOwnsSingleKeyFocus && key === 'f') {
        event.preventDefault();
        fitToDiagram(true);
        return;
      }

      if (!isModifierShortcut && canvasOwnsSingleKeyFocus && (event.key === '+' || event.key === '=')) {
        event.preventDefault();
        zoomCanvas(1.1);
        return;
      }

      if (!isModifierShortcut && canvasOwnsSingleKeyFocus && event.key === '-') {
        event.preventDefault();
        zoomCanvas(0.9);
        return;
      }

      const targetHasLocalRenameHandler = event.target instanceof Element
        && event.target.closest('.react-flow__node, [data-subgraph-drag-target="true"]') !== null;
      if (
        !isModifierShortcut
        && canvasOwnsSingleKeyFocus
        && event.key === 'F2'
        && canEditStructure
        && selection.length === 1
        && shouldHandleGlobalCanvasRenameShortcut(event.defaultPrevented, targetHasLocalRenameHandler)
      ) {
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
  }, [canEditStructure, copySelectedNodes, fitToDiagram, graph, hasPersistedLayout, nodeById, onAddNode, onDeleteEdge, onDeleteNodes, onRedo, onUndo, onUngroupNodes, pasteClipboard, readOnly, selectedCurrentEdgeIdentity, selection, setMode, setSelection, simplifyLayout, toggleConnectMode, zoomCanvas]);

  useEffect(() => {
    if (viewport.zoom >= EDITOR_MIN_ZOOM) {
      return;
    }

    setEditingNodeId(null);
    setShapePickerOpen(false);
  }, [viewport.zoom]);

  const handleCanvasWheel = useCallback((event: WheelEvent) => {
    const container = containerRef.current;
    if (!container || !canHandleCanvasWheel(event.target, container)) {
      return;
    }

    event.preventDefault();
    const rect = container.getBoundingClientRect();
    const gesture = getCanvasWheelGesture(event, { x: event.clientX, y: event.clientY });

    setAnimateTransform(false);
    setViewport((current) => applyCanvasWheelGesture(current, gesture, rect, MIN_ZOOM, MAX_ZOOM));
  }, []);

  const handleSafariGestureStart = useCallback((event: Event) => {
    const container = containerRef.current;
    const gesture = event as SafariGestureEvent;
    if (!container || !canHandleCanvasWheel(event.target, container) || !Number.isFinite(gesture.scale)) {
      return;
    }

    event.preventDefault();
    safariPinchScaleRef.current = gesture.scale;
  }, []);

  const handleSafariGestureChange = useCallback((event: Event) => {
    const container = containerRef.current;
    const gesture = event as SafariGestureEvent;
    const previousScale = safariPinchScaleRef.current;
    if (!container || previousScale === null || !canHandleCanvasWheel(event.target, container) || !Number.isFinite(gesture.scale)) {
      return;
    }

    event.preventDefault();
    safariPinchScaleRef.current = gesture.scale;
    const rect = container.getBoundingClientRect();
    const client = {
      x: Number.isFinite(gesture.clientX) ? gesture.clientX : rect.left + (rect.width / 2),
      y: Number.isFinite(gesture.clientY) ? gesture.clientY : rect.top + (rect.height / 2),
    };

    setAnimateTransform(false);
    setViewport((current) => applyCanvasWheelGesture(current, {
      client,
      kind: 'zoom',
      scale: Math.pow(gesture.scale / previousScale, 0.4),
    }, rect, MIN_ZOOM, MAX_ZOOM));
  }, []);

  const resetSafariGesture = useCallback(() => {
    safariPinchScaleRef.current = null;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) {
      return;
    }

    container.addEventListener('wheel', handleCanvasWheel, { passive: false });
    container.addEventListener('gesturestart', handleSafariGestureStart, { passive: false });
    container.addEventListener('gesturechange', handleSafariGestureChange, { passive: false });
    container.addEventListener('gestureend', resetSafariGesture);
    return () => {
      container.removeEventListener('wheel', handleCanvasWheel);
      container.removeEventListener('gesturestart', handleSafariGestureStart);
      container.removeEventListener('gesturechange', handleSafariGestureChange);
      container.removeEventListener('gestureend', resetSafariGesture);
    };
  }, [handleCanvasWheel, handleSafariGestureChange, handleSafariGestureStart, resetSafariGesture]);

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
    setSelectedSubgraphId(null);
    setEditingSubgraphId(null);
  }, [isPanning, setSelection]);

  const handleFlowPaneClick = useCallback((event: ReactMouseEvent) => {
    event.stopPropagation();
    handleCanvasClick();
  }, [handleCanvasClick]);

  const handleNodeActivation = useCallback((nodeId: string) => {
    if (!isFlowchart) {
      return;
    }
    setShapePickerOpen(false);
    setSelectedEdgeIdentity(null);
    setEditingEdgeIdentity(null);
    setFocusedNodeId(nodeId);
    setToolbarOpen(true);
    setSelectedSubgraphId(null);
    setEditingSubgraphId(null);

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

  const returnSequenceEditorFocus = useCallback(() => {
    const origin = sequenceEditorOriginRef.current;
    sequenceEditorOriginRef.current = null;
    window.requestAnimationFrame(() => {
      if (origin?.isConnected) {
        origin.focus({ preventScroll: true });
        if (document.activeElement === origin) {
          return;
        }
      }
      containerRef.current?.focus({ preventScroll: true });
    });
  }, []);

  const closeSequenceEditor = useCallback((commit: boolean) => {
    const target = editingSequenceTarget;
    if (commit && target) {
      onEditSequenceStatement?.(target.id, editingSequenceText);
    }
    setEditingSequenceTarget(null);
    setEditingSequenceText('');
    setEditingSequenceAnchor(null);
    returnSequenceEditorFocus();
  }, [editingSequenceTarget, editingSequenceText, onEditSequenceStatement, returnSequenceEditorFocus]);

  const openSequenceEditor = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
    if (!isSequence || readOnly || !containerRef.current) {
      return;
    }
    const target = resolveSequenceSvgTextTarget(
      sequenceTextHitMap,
      svgContainerRef.current?.querySelector('svg') ?? null,
      sequenceTextItems,
      event.target,
    );
    if (!target || !(event.target instanceof HTMLElement || event.target instanceof SVGElement)) {
      return;
    }
    const svgTextOrigin = event.target instanceof SVGElement ? event.target.closest('text') : null;
    const origin = svgTextOrigin instanceof SVGElement ? svgTextOrigin : event.target;
    if (origin instanceof HTMLElement) {
      origin.tabIndex = 0;
    } else {
      origin.setAttribute('tabindex', '0');
    }
    const canvasRect = containerRef.current.getBoundingClientRect();
    const rect = event.target.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    sequenceEditorOriginRef.current = origin;
    setEditingSequenceTarget(target);
    setEditingSequenceText(target.text);
    setEditingSequenceAnchor({
      width: Math.max(160, rect.width + 32),
      x: Math.max(8, rect.left - canvasRect.left),
      y: Math.max(8, rect.top - canvasRect.top),
    });
  }, [isSequence, readOnly, sequenceTextHitMap, sequenceTextItems]);

  const selectSubgraph = useCallback((subgraphId: string) => {
    if (!canEditStructure || !subgraphById.has(subgraphId)) return;
    setSelection([]);
    setSelectedEdgeIdentity(null);
    setEditingEdgeIdentity(null);
    setEditingNodeId(null);
    setShapePickerOpen(false);
    setToolbarOpen(false);
    setSelectedSubgraphId(subgraphId);
  }, [canEditStructure, setSelection, subgraphById]);

  const openSubgraphEditor = useCallback((subgraphId: string) => {
    const subgraph = subgraphById.get(subgraphId);
    if (!canEditStructure || !subgraph || !canRenameFlowchartSubgraphDeclaration(mermaidSource, subgraphId)) return;
    cancelSubgraphEditRef.current = false;
    setSelectedSubgraphId(subgraphId);
    setEditingSubgraphId(subgraphId);
    setEditingSubgraphLabel(getSubgraphLabel(subgraph));
  }, [canEditStructure, mermaidSource, subgraphById]);

  const commitSubgraphEdit = useCallback(() => {
    if (cancelSubgraphEditRef.current) {
      cancelSubgraphEditRef.current = false;
      return;
    }
    if (!canEditStructure || !editingSubgraphId) return;
    const current = subgraphById.get(editingSubgraphId);
    onEditSubgraphLabel?.(
      editingSubgraphId,
      editingSubgraphLabel.trim() || (current ? getSubgraphLabel(current) : editingSubgraphId),
    );
    setEditingSubgraphId(null);
    setEditingSubgraphLabel('');
  }, [canEditStructure, editingSubgraphId, editingSubgraphLabel, onEditSubgraphLabel, subgraphById]);

  const handleSubgraphPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>, subgraphId: string) => {
    if (!canEditStructure || spacePressed || event.button !== 0 || !interactiveNodeBounds) return;
    const initialPositions: DiagramNodePositions = {};
    for (const nodeId of subgraphMemberNodeIds.get(subgraphId) ?? []) {
      const bounds = interactiveNodeBounds.get(nodeId);
      if (bounds) initialPositions[nodeId] = { x: bounds.x, y: bounds.y };
    }
    if (Object.keys(initialPositions).length === 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    selectSubgraph(subgraphId);
    subgraphDragRef.current = {
      begun: false,
      initialPositions,
      latestPositions: initialPositions,
      origin: { x: event.clientX, y: event.clientY },
      pointerId: event.pointerId,
    };
  }, [canEditStructure, interactiveNodeBounds, selectSubgraph, spacePressed, subgraphMemberNodeIds]);

  const handleSubgraphPointerMove = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = subgraphDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = (event.clientX - drag.origin.x) / viewport.zoom;
    const dy = (event.clientY - drag.origin.y) / viewport.zoom;
    if (!drag.begun) {
      if ((dx * dx) + (dy * dy) < 9) return;
      if (onNodeDragStart?.(drag.initialPositions) === false) {
        subgraphDragRef.current = null;
        return;
      }
      drag.begun = true;
      Object.keys(drag.initialPositions).forEach((nodeId) => activeDragNodeIdsRef.current.add(nodeId));
    }
    event.preventDefault();
    const positions = Object.fromEntries(Object.entries(drag.initialPositions).map(([nodeId, position]) => [
      nodeId,
      { x: position.x + dx, y: position.y + dy },
    ]));
    drag.latestPositions = positions;
    setLiveNodePositions((current) => ({ ...current, ...positions }));
    onNodeDrag?.(positions);
  }, [onNodeDrag, onNodeDragStart, viewport.zoom]);

  const handleSubgraphPointerEnd = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    const drag = subgraphDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    subgraphDragRef.current = null;
    if (!drag.begun) return;
    const nodeIds = Object.keys(drag.latestPositions);
    nodeIds.forEach((nodeId) => activeDragNodeIdsRef.current.delete(nodeId));
    if (onNodeDragStop) onNodeDragStop(drag.latestPositions);
    else setNodePositions((current) => ({ ...current, ...drag.latestPositions }), 'merge', drag.latestPositions);
    setLiveNodePositions((current) => {
      const next = { ...current };
      nodeIds.forEach((nodeId) => delete next[nodeId]);
      return next;
    });
  }, [onNodeDragStop, setNodePositions]);

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

    if (nextSelection.length > 0) {
      setSelectedSubgraphId(null);
      setEditingSubgraphId(null);
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
      event.stopPropagation();
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
  const sequenceEditorControls = isSequence && !readOnly && emptyState === null ? (
    <SequenceEditorControls
      centered={emptyState === 'sequence'}
      diagram={sequenceDiagram}
      onAddActivation={onAddSequenceActivation}
      onAddFragment={onAddSequenceFragment}
      onAddMessage={onAddSequenceMessage}
      onAddNote={onAddSequenceNote}
      onAddParticipant={onAddSequenceParticipant}
      onDeleteMessage={onDeleteSequenceMessage}
      onDeleteNote={onDeleteSequenceNote}
      onDeleteActivation={onDeleteSequenceActivation}
      onDeleteFragment={onDeleteSequenceFragment}
      onEditActivation={onEditSequenceActivation}
      onEditFragment={onEditSequenceFragment}
      onEditMessage={onEditSequenceMessage}
      onEditNote={onEditSequenceNote}
      onEditParticipant={onEditSequenceParticipant}
      onDeleteParticipant={onDeleteSequenceParticipant}
      onMoveMessage={onMoveSequenceMessage}
      onMoveNote={onMoveSequenceNote}
      onMoveActivation={onMoveSequenceActivation}
      onMoveFragment={onMoveSequenceFragment}
      onMoveParticipant={onMoveSequenceParticipant}
      onRenameParticipantId={onRenameSequenceParticipantId}
      onSetAutonumber={onSetSequenceAutonumber}
      participants={sequenceParticipants}
    />
  ) : null;

  return (
    <div className="diagram-canvas-shell" style={{ display: 'flex', flex: 1, minHeight: 0, position: 'relative' }}>
    <div
      aria-label="Interactive diagram canvas"
      className={className}
      data-panning={spacePressed || isPanning || undefined}
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
      onFocus={(event) => {
        if (event.target === event.currentTarget && event.currentTarget.matches(':focus-visible') && orderedNodeIds[0]) {
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
            aria-hidden={isSequence ? undefined : 'true'}
            className={useReactFlowRenderer
              ? 'diagram-canvas-svg diagram-canvas-svg--reactflow'
              : 'diagram-canvas-svg'}
            dangerouslySetInnerHTML={{ __html: svg }}
            onDoubleClick={openSequenceEditor}
            ref={svgContainerRef}
            style={{ pointerEvents: isSequence ? 'auto' : 'none' }}
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
                    background: selected ? 'color-mix(in srgb, var(--selection) 10%, transparent)' : 'transparent',
                    border: '1px solid transparent',
                    borderRadius: 12,
                    cursor: readOnly ? 'default' : 'pointer',
                    height: bounds.height,
                    left: bounds.x,
                    opacity: 1,
                    outline: selected ? '2px solid var(--selection)' : undefined,
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
                setSelectedSubgraphId(null);
                setEditingSubgraphId(null);
                setSelectedEdgeIdentity(edgeIdentity);
              }}
              onEdgeDoubleClick={(event, edge) => {
                event.stopPropagation();
                const edgeIdentity = graph ? getDiagramEdgeIdentityForFlowEdge(graph.links, edge.id) : null;
                if (edgeIdentity) {
                  setSelectedSubgraphId(null);
                  setEditingSubgraphId(null);
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
              onPaneClick={handleFlowPaneClick}
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

      {useReactFlowRenderer ? (
        <div style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 6 }}>
          {(graph?.subgraphs ?? []).map((subgraph) => {
            const bounds = interactiveSubgraphBounds.get(subgraph.id);
            if (!bounds) return null;
            const screenBounds = toScreenRect(bounds, viewport);
            const selected = selectedSubgraphId === subgraph.id;
            const label = getSubgraphLabel(subgraph);
            const edgeStyle: CSSProperties = {
              cursor: 'grab',
              pointerEvents: 'auto',
              position: 'absolute',
            };
            return (
              <div
                aria-label={`Section ${label}`}
                data-selected={selected ? 'true' : 'false'}
                data-testid={`canvas-subgraph-${subgraph.id}`}
                key={subgraph.id}
                style={{
                  border: selected ? '2px solid var(--selection)' : '1px solid var(--control-border)',
                  height: screenBounds.height,
                  left: screenBounds.x,
                  pointerEvents: 'none',
                  position: 'absolute',
                  top: screenBounds.y,
                  width: screenBounds.width,
                }}
              >
                <button
                  aria-label={`Select section ${label}`}
                  data-subgraph-drag-target="true"
                  data-testid={`canvas-subgraph-header-${subgraph.id}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    selectSubgraph(subgraph.id);
                  }}
                  onDoubleClick={(event) => {
                    event.stopPropagation();
                    openSubgraphEditor(subgraph.id);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      event.stopPropagation();
                      selectSubgraph(subgraph.id);
                      return;
                    }
                    if (event.key !== 'F2') return;
                    event.preventDefault();
                    event.stopPropagation();
                    openSubgraphEditor(subgraph.id);
                  }}
                  onLostPointerCapture={handleSubgraphPointerEnd}
                  onPointerCancel={handleSubgraphPointerEnd}
                  onPointerDown={(event) => { handleSubgraphPointerDown(event, subgraph.id); }}
                  onPointerMove={handleSubgraphPointerMove}
                  onPointerUp={handleSubgraphPointerEnd}
                  style={{
                    background: 'var(--control-surface)',
                    border: selected ? '1px solid var(--selection)' : '1px solid var(--control-border)',
                    borderRadius: 5,
                    color: 'var(--ink)',
                    cursor: canEditStructure ? 'grab' : 'default',
                    fontFamily: 'var(--font-mono)',
                    fontSize: 10,
                    fontWeight: 700,
                    left: '50%',
                    maxWidth: 'calc(100% - 20px)',
                    overflow: 'hidden',
                    padding: '2px 6px',
                    pointerEvents: canEditStructure ? 'auto' : 'none',
                    position: 'absolute',
                    textOverflow: 'ellipsis',
                    top: 0,
                    transform: 'translate(-50%, -50%)',
                    whiteSpace: 'nowrap',
                    zIndex: 2,
                  }}
                  tabIndex={canEditStructure ? 0 : -1}
                  type="button"
                >
                  {label}
                </button>
                {([
                  { left: -4, right: -4, top: -4, height: 8 },
                  { bottom: -4, left: -4, right: -4, height: 8 },
                  { bottom: 4, left: -4, top: 4, width: 8 },
                  { bottom: 4, right: -4, top: 4, width: 8 },
                ] as CSSProperties[]).map((position, index) => (
                  <span
                    aria-hidden="true"
                    data-subgraph-drag-target="true"
                    data-testid={`canvas-subgraph-boundary-${subgraph.id}-${index}`}
                    key={index}
                    onClick={(event) => { event.stopPropagation(); }}
                    onLostPointerCapture={handleSubgraphPointerEnd}
                    onPointerCancel={handleSubgraphPointerEnd}
                    onPointerDown={(event) => { handleSubgraphPointerDown(event, subgraph.id); }}
                    onPointerMove={handleSubgraphPointerMove}
                    onPointerUp={handleSubgraphPointerEnd}
                    style={{
                      ...edgeStyle,
                      ...position,
                      cursor: canEditStructure ? 'grab' : 'default',
                      pointerEvents: canEditStructure ? 'auto' : 'none',
                    }}
                  />
                ))}
              </div>
            );
          })}
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
              {!presence.canvas.editing_node_id ? (
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
              ) : null}
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
        {isFlowchart && !readOnly && emptyState === null ? (
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

        {emptyState === 'chooser' && !readOnly ? (
          <DiagramTypeChooser onChoose={onChooseDiagramType} />
        ) : emptyState === 'flowchart' && !readOnly ? (
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
              Add your first flowchart node
            </button>
          </div>
          ) : emptyState === 'sequence' && !readOnly ? (
            <SequenceEditorControls
              centered
              diagram={sequenceDiagram}
              onAddActivation={onAddSequenceActivation}
              onAddFragment={onAddSequenceFragment}
              onAddMessage={onAddSequenceMessage}
              onAddNote={onAddSequenceNote}
              onAddParticipant={onAddSequenceParticipant}
              onDeleteMessage={onDeleteSequenceMessage}
              onDeleteNote={onDeleteSequenceNote}
              onDeleteActivation={onDeleteSequenceActivation}
              onDeleteFragment={onDeleteSequenceFragment}
              onEditActivation={onEditSequenceActivation}
              onEditFragment={onEditSequenceFragment}
              onEditMessage={onEditSequenceMessage}
              onEditNote={onEditSequenceNote}
              onEditParticipant={onEditSequenceParticipant}
              onDeleteParticipant={onDeleteSequenceParticipant}
              onMoveMessage={onMoveSequenceMessage}
              onMoveNote={onMoveSequenceNote}
              onMoveActivation={onMoveSequenceActivation}
              onMoveFragment={onMoveSequenceFragment}
              onMoveParticipant={onMoveSequenceParticipant}
              onRenameParticipantId={onRenameSequenceParticipantId}
              onSetAutonumber={onSetSequenceAutonumber}
              participants={sequenceParticipants}
            />
          ) : (!svg ? (
          <div className="empty-state" style={{ alignItems: 'center', display: 'flex', height: '100%', justifyContent: 'center' }}>
            {emptyMessage}
          </div>
        ) : null)}

        {isFlowchart && !readOnly && selectedSubgraphId && selectedSubgraphCanRename && screenSelectedSubgraphBounds ? (
          <div aria-label="Selected section toolbar" data-testid="canvas-subgraph-toolbar" style={subgraphToolbarStyle}>
            <ToolbarButton label="Edit section label" onClick={() => { openSubgraphEditor(selectedSubgraphId); }}>
              <Pencil size={16} />
            </ToolbarButton>
          </div>
        ) : null}

        {isEr && !readOnly && erDiagram ? (
          <ErEditorControls
            bottom={erEditorBottom}
            diagram={erDiagram}
            onAddAttribute={onAddErAttribute}
            onAddEntity={onAddErEntity}
            onAddRelationship={onAddErRelationship}
            onDeleteAttribute={onDeleteErAttribute}
            onDeleteEntity={onDeleteErEntity}
            onDeleteRelationship={onDeleteErRelationship}
            onEditAttribute={onEditErAttribute}
            onEditRelationship={onEditErRelationship}
            onMoveAttribute={onMoveErAttribute}
            onMoveEntity={onMoveErEntity}
            onRenameEntity={onRenameErEntity}
          />
        ) : null}

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
              toggleConnectMode();
              setToolbarOpen(true);
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

        {editingSubgraphId && screenSelectedSubgraphBounds ? (
          <div
            style={{
              left: screenSelectedSubgraphBounds.x + Math.max(8, screenSelectedSubgraphBounds.width / 2) - 90,
              pointerEvents: 'auto',
              position: 'absolute',
              top: Math.max(8, screenSelectedSubgraphBounds.y - 18),
              width: 180,
            }}
          >
            <input
              aria-label="Section label"
              autoFocus
              onBlur={commitSubgraphEdit}
              onChange={(event) => { setEditingSubgraphLabel(event.target.value); }}
              onFocus={(event) => { event.currentTarget.select(); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') commitSubgraphEdit();
                if (event.key === 'Escape') {
                  cancelSubgraphEditRef.current = true;
                  setEditingSubgraphId(null);
                  setEditingSubgraphLabel('');
                }
              }}
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
              value={editingSubgraphLabel}
            />
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

        {editingSequenceTarget && editingSequenceAnchor ? (
          <div
            data-canvas-pan-exclusion="true"
            style={{
              left: editingSequenceAnchor.x,
              pointerEvents: 'auto',
              position: 'absolute',
              top: editingSequenceAnchor.y,
              width: editingSequenceAnchor.width,
            }}
          >
            <input
              aria-label={`Edit sequence ${editingSequenceTarget.type}`}
              autoFocus
              onBlur={() => { closeSequenceEditor(true); }}
              onChange={(event) => { setEditingSequenceText(event.target.value); }}
              onFocus={(event) => { event.currentTarget.select(); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  closeSequenceEditor(true);
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  closeSequenceEditor(false);
                }
              }}
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
              value={editingSequenceText}
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
    {sequenceEditorControls}
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
  const handleColor = getCanvasHandlePaint(Boolean(selected || interaction?.connectMode));
  const remoteSelection = data.remoteSelections[0];
  const remoteEditor = data.remoteEditors[0];
  const remotePresence = remoteEditor ?? remoteSelection;
  const remoteSelectionLabel = remoteSelection
    ? `${getCanvasPresenceLabel(remoteSelection.participant.name)}${data.remoteSelections.length > 1 ? ` +${data.remoteSelections.length - 1}` : ''}`
    : null;
  const remoteEditingLabel = remoteEditor
    ? `${getCanvasPresenceLabel(remoteEditor.participant.name)}${data.remoteEditors.length > 1 ? ` +${data.remoteEditors.length - 1}` : ''}`
    : null;
  const remoteLabel = remoteEditingLabel ?? remoteSelectionLabel;

  return (
    <div
      aria-label={label}
      aria-description={remoteEditor && remoteEditingLabel ? `${remoteEditingLabel} is editing this node` : undefined}
      aria-pressed={selected}
      className={`mermaid-flow-node${selected ? ' is-selected' : ''}`}
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
        {remotePresence ? (
          <span
            className={`mermaid-flow-node-remote-outline mermaid-flow-node-remote-outline--${getShapeClassName(data.shape)}`}
            style={{ '--remote-selection-color': remotePresence.participant.color } as CSSProperties}
          />
        ) : null}
        <span>{data.label}</span>
      </div>
      {remotePresence && remoteLabel ? (
        <span
          className={`mermaid-flow-node-remote-label${remoteEditor ? ' is-editing' : ''}`}
          data-testid={remoteEditor ? `remote-node-editing-${id}` : `remote-node-selection-${id}`}
          style={{ backgroundColor: remotePresence.participant.color }}
        >
          <span>{remoteLabel}</span>
          {remoteEditor ? <span aria-hidden="true" className="mermaid-flow-node-remote-editing-dots"><i /><i /><i /></span> : null}
        </span>
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

function DiagramTypeChooser({ onChoose }: { onChoose?: (type: 'flowchart' | 'sequence') => void }) {
  return (
    <div className="canvas-empty-chooser" data-testid="diagram-type-chooser">
      <div className="canvas-empty-chooser-card">
        <span>Start a diagram</span>
        <strong>What are you mapping?</strong>
        <div className="canvas-empty-chooser-actions">
          <button onClick={() => { onChoose?.('flowchart'); }} type="button">
            <ArrowRightFromLine size={18} />
            <span><strong>Flowchart</strong><small>Nodes and connections</small></span>
          </button>
          <button onClick={() => { onChoose?.('sequence'); }} type="button">
            <ScanSearch size={18} />
            <span><strong>Sequence</strong><small>Participants and messages</small></span>
          </button>
        </div>
      </div>
    </div>
  );
}

function SequenceEditorControls({
  centered = false,
  diagram,
  onAddActivation,
  onAddFragment,
  onAddMessage,
  onAddNote,
  onAddParticipant,
  onDeleteActivation,
  onDeleteFragment,
  onDeleteMessage,
  onDeleteNote,
  onDeleteParticipant,
  onEditActivation,
  onEditFragment,
  onEditMessage,
  onEditNote,
  onEditParticipant,
  onMoveMessage,
  onMoveNote,
  onMoveActivation,
  onMoveFragment,
  onMoveParticipant,
  onRenameParticipantId,
  onSetAutonumber,
  participants,
}: {
  centered?: boolean;
  diagram: SequenceDiagramSnapshot | null;
  onAddActivation?: (action: SequenceActivationAction, participant: string) => void;
  onAddFragment?: (kind: SequenceFragmentKind, label: string) => void;
  onAddMessage?: (from: string, to: string, message: string, arrow?: SequenceArrow) => void;
  onAddNote?: (placement: SequenceNote['placement'], participants: string[], text: string) => void;
  onAddParticipant?: (label: string, kind?: SequenceParticipantKind) => void;
  onDeleteActivation?: (id: string) => void;
  onDeleteFragment?: (id: string) => void;
  onDeleteMessage?: (id: string) => void;
  onDeleteNote?: (id: string) => void;
  onDeleteParticipant?: (id: string) => void;
  onEditActivation?: (id: string, action: SequenceActivationAction, participant: string) => void;
  onEditFragment?: (id: string, label: string) => void;
  onEditMessage?: (id: string, patch: Partial<Pick<SequenceMessage, 'from' | 'to' | 'arrow' | 'text'>>) => void;
  onEditNote?: (id: string, patch: Partial<Pick<SequenceNote, 'placement' | 'participants' | 'text'>>) => void;
  onEditParticipant?: (id: string, label: string) => void;
  onMoveMessage?: (id: string, direction: 'up' | 'down') => void;
  onMoveNote?: (id: string, direction: 'up' | 'down') => void;
  onMoveActivation?: (id: string, direction: 'up' | 'down') => void;
  onMoveFragment?: (id: string, direction: 'up' | 'down') => void;
  onMoveParticipant?: (id: string, direction: 'up' | 'down') => void;
  onRenameParticipantId?: (id: string, nextId: string) => void;
  onSetAutonumber?: (value: string) => void;
  participants: readonly SequenceParticipant[];
}) {
  const [participantLabel, setParticipantLabel] = useState('');
  const [participantKind, setParticipantKind] = useState<SequenceParticipantKind>('participant');
  const [message, setMessage] = useState('');
  const [arrow, setArrow] = useState<SequenceArrow>('->>');
  const [from, setFrom] = useState(participants[0]?.id ?? '');
  const [to, setTo] = useState(participants[1]?.id ?? participants[0]?.id ?? '');
  const [note, setNote] = useState('');
  const [activation, setActivation] = useState<SequenceActivationAction>('activate');
  const [fragment, setFragment] = useState<SequenceFragmentKind>('alt');
  const [fragmentLabel, setFragmentLabel] = useState('');
  const [autonumber, setAutonumber] = useState(diagram?.autonumber?.value ?? '');

  useEffect(() => {
    if (!participants.some((participant) => participant.id === from)) setFrom(participants[0]?.id ?? '');
    if (!participants.some((participant) => participant.id === to)) setTo(participants[1]?.id ?? participants[0]?.id ?? '');
  }, [from, participants, to]);

  const addParticipant = () => {
    onAddParticipant?.(participantLabel.trim() || 'Participant', participantKind);
    setParticipantLabel('');
  };
  const addMessage = () => {
    if (!from || !to) return;
    onAddMessage?.(from, to, message.trim() || 'Message', arrow);
    setMessage('');
  };
  const addNote = () => {
    if (!from) return;
    onAddNote?.('over', [from], note.trim() || 'Note');
    setNote('');
  };

  return (
    <div className={centered ? 'canvas-sequence-editor is-centered' : 'canvas-sequence-editor'} data-testid="sequence-editor-controls">
      <form className="canvas-sequence-participant-form" data-canvas-pan-exclusion="true" onSubmit={(event) => { event.preventDefault(); addParticipant(); }}>
        <span>participant</span>
        <select aria-label="New sequence participant kind" onChange={(event) => { setParticipantKind(event.target.value as SequenceParticipantKind); }} value={participantKind}><option value="participant">participant</option><option value="actor">actor</option></select>
        <input
          aria-label="New sequence participant"
          onChange={(event) => { setParticipantLabel(event.target.value); }}
          placeholder="name"
          value={participantLabel}
        />
        <button aria-label="Add sequence participant" onClick={addParticipant} type="button"><Plus size={15} /></button>
      </form>
      {participants.length > 0 ? (
        <form className="canvas-sequence-message-form" data-canvas-pan-exclusion="true" onSubmit={(event) => { event.preventDefault(); addMessage(); }}>
          <span>message</span>
          <select aria-label="Message sender" onChange={(event) => { setFrom(event.target.value); }} value={from}>
            {participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.label}</option>)}
          </select>
          <span aria-hidden="true">→</span>
          <select aria-label="Message recipient" onChange={(event) => { setTo(event.target.value); }} value={to}>
            {participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.label}</option>)}
          </select>
          <select aria-label="Sequence message arrow" onChange={(event) => { setArrow(event.target.value as SequenceArrow); }} value={arrow}>{(['->', '-->', '->>', '-->>', '-x', '--x', '-)', '--)', '<<->>', '<<-->>'] as const).map((value) => <option key={value} value={value}>{value}</option>)}</select>
          <input aria-label="Sequence message" onChange={(event) => { setMessage(event.target.value); }} placeholder="message" value={message} />
          <button aria-label="Add sequence message" onClick={addMessage} type="button"><Plus size={15} /></button>
        </form>
      ) : <small>Add a participant to begin.</small>}
      {participants.length > 0 ? (
        <form className="canvas-sequence-message-form" data-canvas-pan-exclusion="true" onSubmit={(event) => { event.preventDefault(); addNote(); }}>
          <span>note</span>
          <select aria-label="Note participant" onChange={(event) => { setFrom(event.target.value); }} value={from}>{participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.label}</option>)}</select>
          <input aria-label="Sequence note" onChange={(event) => { setNote(event.target.value); }} placeholder="note" value={note} />
          <button aria-label="Add sequence note" type="submit"><Plus size={15} /></button>
        </form>
      ) : null}
      {participants.length > 0 ? (
        <form className="canvas-sequence-message-form" data-canvas-pan-exclusion="true" onSubmit={(event) => { event.preventDefault(); if (from) onAddActivation?.(activation, from); }}>
          <span>activation</span>
          <select aria-label="Sequence activation action" onChange={(event) => { setActivation(event.target.value as SequenceActivationAction); }} value={activation}><option value="activate">activate</option><option value="deactivate">deactivate</option></select>
          <select aria-label="Sequence activation participant" onChange={(event) => { setFrom(event.target.value); }} value={from}>{participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.label}</option>)}</select>
          <button aria-label="Add sequence activation" type="submit"><Plus size={15} /></button>
        </form>
      ) : null}
      <form className="canvas-sequence-message-form" data-canvas-pan-exclusion="true" onSubmit={(event) => { event.preventDefault(); onAddFragment?.(fragment, fragmentLabel); setFragmentLabel(''); }}>
        <span>fragment</span>
        <select aria-label="Sequence fragment kind" onChange={(event) => { setFragment(event.target.value as SequenceFragmentKind); }} value={fragment}>{(['alt', 'opt', 'loop', 'par', 'critical', 'break'] as const).map((kind) => <option key={kind} value={kind}>{kind}</option>)}</select>
        <input aria-label="Sequence fragment label" onChange={(event) => { setFragmentLabel(event.target.value); }} placeholder="condition" value={fragmentLabel} />
        <button aria-label="Add sequence fragment" type="submit"><Plus size={15} /></button>
      </form>
      <form className="canvas-sequence-message-form" data-canvas-pan-exclusion="true" onSubmit={(event) => { event.preventDefault(); onSetAutonumber?.(autonumber); }}>
        <span>autonumber</span><input aria-label="Sequence autonumber" onChange={(event) => { setAutonumber(event.target.value); }} placeholder="optional start" value={autonumber} /><button aria-label="Set sequence autonumber" type="submit">set</button>
      </form>
      {diagram ? <details data-canvas-pan-exclusion="true"><summary>sequence items</summary>
        {diagram.participants.filter((participant) => !participant.implicit).map((participant, index, items) => <div key={participant.id}><input aria-label="Sequence participant label" defaultValue={participant.label} onBlur={(event) => { onEditParticipant?.(participant.id, event.target.value); }} /><input aria-label="Sequence participant id" defaultValue={participant.id} onBlur={(event) => { onRenameParticipantId?.(participant.id, event.target.value); }} /><SequenceMoveButtons deleteLabel={`Delete ${participant.label}`} disabledDown={index === items.length - 1} disabledUp={index === 0} onDelete={() => { onDeleteParticipant?.(participant.id); }} onDown={() => { onMoveParticipant?.(participant.id, 'down'); }} onUp={() => { onMoveParticipant?.(participant.id, 'up'); }} /></div>)}
        {diagram.messages.map((item, index) => <div key={item.id}><select aria-label="Sequence message sender" defaultValue={item.from} onChange={(event) => { onEditMessage?.(item.id, { from: event.target.value }); }}>{participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.label}</option>)}</select><select aria-label="Sequence message recipient" defaultValue={item.to} onChange={(event) => { onEditMessage?.(item.id, { to: event.target.value }); }}>{participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.label}</option>)}</select><select aria-label="Sequence message arrow" defaultValue={item.arrow} onChange={(event) => { onEditMessage?.(item.id, { arrow: event.target.value as SequenceArrow }); }}>{(['->', '-->', '->>', '-->>', '-x', '--x', '-)', '--)', '<<->>', '<<-->>'] as const).map((value) => <option key={value} value={value}>{value}</option>)}</select><input aria-label="Sequence message text" defaultValue={item.text} onBlur={(event) => { onEditMessage?.(item.id, { text: event.target.value }); }} /><SequenceMoveButtons deleteLabel="Delete sequence message" disabledDown={index === diagram.messages.length - 1} disabledUp={index === 0} onDelete={() => { onDeleteMessage?.(item.id); }} onDown={() => { onMoveMessage?.(item.id, 'down'); }} onUp={() => { onMoveMessage?.(item.id, 'up'); }} /></div>)}
        {diagram.notes.map((item, index) => <div key={item.id}><select aria-label="Sequence note placement" defaultValue={item.placement} onChange={(event) => { onEditNote?.(item.id, { placement: event.target.value as SequenceNote['placement'] }); }}><option value="over">over</option><option value="left of">left of</option><option value="right of">right of</option></select><input aria-label="Sequence note targets" defaultValue={item.participants.join(',')} onBlur={(event) => { onEditNote?.(item.id, { participants: event.target.value.split(',').map((id) => id.trim()).filter(Boolean) }); }} /><input aria-label="Sequence note text" defaultValue={item.text} onBlur={(event) => { onEditNote?.(item.id, { text: event.target.value }); }} /><SequenceMoveButtons deleteLabel="Delete sequence note" disabledDown={index === diagram.notes.length - 1} disabledUp={index === 0} onDelete={() => { onDeleteNote?.(item.id); }} onDown={() => { onMoveNote?.(item.id, 'down'); }} onUp={() => { onMoveNote?.(item.id, 'up'); }} /></div>)}
        {diagram.activations.map((item, index) => <div key={item.id}><select aria-label="Sequence activation action" defaultValue={item.action} onChange={(event) => { onEditActivation?.(item.id, event.target.value as SequenceActivationAction, item.participant); }}><option value="activate">activate</option><option value="deactivate">deactivate</option></select><select aria-label="Sequence activation participant" defaultValue={item.participant} onChange={(event) => { onEditActivation?.(item.id, item.action, event.target.value); }}>{participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.label}</option>)}</select><SequenceMoveButtons deleteLabel="Delete sequence activation" disabledDown={index === diagram.activations.length - 1} disabledUp={index === 0} onDelete={() => { onDeleteActivation?.(item.id); }} onDown={() => { onMoveActivation?.(item.id, 'down'); }} onUp={() => { onMoveActivation?.(item.id, 'up'); }} /></div>)}
        {diagram.fragments.map((item, index) => <div key={item.id}><span>{item.kind}</span><input aria-label="Sequence fragment label" defaultValue={item.label} onBlur={(event) => { onEditFragment?.(item.id, event.target.value); }} /><SequenceMoveButtons deleteLabel="Delete sequence fragment" disabledDown={index === diagram.fragments.length - 1} disabledUp={index === 0} onDelete={() => { onDeleteFragment?.(item.id); }} onDown={() => { onMoveFragment?.(item.id, 'down'); }} onUp={() => { onMoveFragment?.(item.id, 'up'); }} /></div>)}
      </details> : null}
    </div>
  );
}

function SequenceMoveButtons({ deleteLabel, disabledDown, disabledUp, onDelete, onDown, onUp }: { deleteLabel: string; disabledDown: boolean; disabledUp: boolean; onDelete: () => void; onDown: () => void; onUp: () => void }) {
  return <><button aria-label="Move up" disabled={disabledUp} onClick={onUp} type="button">↑</button><button aria-label="Move down" disabled={disabledDown} onClick={onDown} type="button">↓</button><button aria-label={deleteLabel} onClick={onDelete} type="button">×</button></>;
}

const ER_CARDINALITY_OPTIONS: Array<{ label: string; value: ErRelationship['leftCardinality'] }> = [
  { label: 'exactly one', value: 'exactly-one' },
  { label: 'zero or one', value: 'zero-or-one' },
  { label: 'one or more', value: 'one-or-more' },
  { label: 'zero or more', value: 'zero-or-more' },
];

function ErEditorControls({
  bottom,
  diagram,
  onAddAttribute,
  onAddEntity,
  onAddRelationship,
  onDeleteAttribute,
  onDeleteEntity,
  onDeleteRelationship,
  onEditAttribute,
  onEditRelationship,
  onMoveAttribute,
  onMoveEntity,
  onRenameEntity,
}: {
  bottom: number;
  diagram: ErDiagramSnapshot;
  onAddAttribute?: (entityName: string, attribute: Partial<ErAttribute>) => void;
  onAddEntity?: (name: string) => void;
  onAddRelationship?: (relationship: ErRelationship) => void;
  onDeleteAttribute?: (entityName: string, attributeName: string) => void;
  onDeleteEntity?: (name: string) => void;
  onDeleteRelationship?: (identity: ErRelationshipIdentity) => void;
  onEditAttribute?: (entityName: string, attributeName: string, attribute: ErAttribute) => void;
  onEditRelationship?: (identity: ErRelationshipIdentity, relationship: ErRelationship) => void;
  onMoveAttribute?: (entityName: string, attributeName: string, direction: 'up' | 'down') => void;
  onMoveEntity?: (name: string, direction: 'up' | 'down') => void;
  onRenameEntity?: (currentName: string, nextName: string) => void;
}) {
  const [entityName, setEntityName] = useState('ENTITY');
  const relationshipDefault = useMemo<ErRelationship>(() => ({
    identifying: true,
    label: 'relates to',
    left: diagram.entities[0]?.name ?? '',
    leftCardinality: 'exactly-one',
    right: diagram.entities[1]?.name ?? diagram.entities[0]?.name ?? '',
    rightCardinality: 'zero-or-more',
  }), [diagram.entities]);

  return (
    <aside className="canvas-er-editor" data-canvas-pan-exclusion="true" data-testid="er-editor-controls" style={{ background: 'var(--surface-canvas)', border: '1px solid var(--control-border)', borderRadius: 8, bottom, maxHeight: 'min(58vh, 560px)', overflow: 'auto', padding: 10, pointerEvents: 'auto', position: 'absolute', right: 12, width: 'min(400px, calc(100% - 24px))', zIndex: 7 }}>
      <form onSubmit={(event) => { event.preventDefault(); onAddEntity?.(entityName); setEntityName('ENTITY'); }} style={{ display: 'flex', gap: 6 }}>
        <strong style={{ fontSize: 12, whiteSpace: 'nowrap' }}>ER entities</strong>
        <input aria-label="New ER entity" onChange={(event) => { setEntityName(event.target.value); }} value={entityName} />
        <button aria-label="Add ER entity" type="submit">Add</button>
      </form>
      <div style={{ display: 'grid', gap: 10, marginTop: 10 }}>
        {diagram.entities.map((entity, index) => (
          <ErEntityControls
            entity={entity}
            entityIndex={index}
            key={entity.name}
            onAddAttribute={onAddAttribute}
            onDeleteAttribute={onDeleteAttribute}
            onDeleteEntity={onDeleteEntity}
            onEditAttribute={onEditAttribute}
            onMoveAttribute={onMoveAttribute}
            onMoveEntity={onMoveEntity}
            onRenameEntity={onRenameEntity}
          />
        ))}
      </div>
      <section aria-label="ER relationships" style={{ borderTop: '1px solid var(--line-subtle)', marginTop: 10, paddingTop: 8 }}>
        <strong style={{ fontSize: 12 }}>Relationships</strong>
        {diagram.relationships.map((relationship, index) => (
          <ErRelationshipForm
            entities={diagram.entities.map((entity) => entity.name)}
            key={`${index}:${relationship.left}:${relationship.right}:${relationship.label}`}
            onDelete={() => { onDeleteRelationship?.(getErRelationshipIdentity(relationship, index)); }}
            onSave={(next) => { onEditRelationship?.(getErRelationshipIdentity(relationship, index), next); }}
            relationship={relationship}
          />
        ))}
        {diagram.entities.length > 0 ? <ErRelationshipForm entities={diagram.entities.map((entity) => entity.name)} key={`new:${relationshipDefault.left}:${relationshipDefault.right}`} onSave={onAddRelationship} relationship={relationshipDefault} /> : <small>Add entities before creating a relationship.</small>}
      </section>
    </aside>
  );
}

function ErEntityControls({
  entity, entityIndex, onAddAttribute, onDeleteAttribute, onDeleteEntity, onEditAttribute, onMoveAttribute, onMoveEntity, onRenameEntity,
}: {
  entity: ErDiagramSnapshot['entities'][number];
  entityIndex: number;
  onAddAttribute?: (entityName: string, attribute: Partial<ErAttribute>) => void;
  onDeleteAttribute?: (entityName: string, attributeName: string) => void;
  onDeleteEntity?: (name: string) => void;
  onEditAttribute?: (entityName: string, attributeName: string, attribute: ErAttribute) => void;
  onMoveAttribute?: (entityName: string, attributeName: string, direction: 'up' | 'down') => void;
  onMoveEntity?: (name: string, direction: 'up' | 'down') => void;
  onRenameEntity?: (currentName: string, nextName: string) => void;
}) {
  const [name, setName] = useState(entity.name);
  const [newAttributeName, setNewAttributeName] = useState('attribute');
  return (
    <section style={{ border: '1px solid var(--line-subtle)', borderRadius: 6, padding: 7 }}>
      <form onSubmit={(event) => { event.preventDefault(); onRenameEntity?.(entity.name, name); }} style={{ display: 'flex', gap: 4 }}>
        <input aria-label={`ER entity ${entity.name}`} onChange={(event) => { setName(event.target.value); }} value={name} />
        <button type="submit">Rename</button>
        <button aria-label={`Move ${entity.name} up`} disabled={entityIndex === 0} onClick={() => { onMoveEntity?.(entity.name, 'up'); }} type="button">↑</button>
        <button aria-label={`Move ${entity.name} down`} onClick={() => { onMoveEntity?.(entity.name, 'down'); }} type="button">↓</button>
        <button aria-label={`Delete ${entity.name} and dependent relationships`} onClick={() => { onDeleteEntity?.(entity.name); }} type="button">Delete</button>
      </form>
      {entity.attributes.map((attribute, index) => (
        <ErAttributeForm
          attribute={attribute}
          entityName={entity.name}
          key={`${attribute.name}:${attribute.type}`}
          onDelete={() => { onDeleteAttribute?.(entity.name, attribute.name); }}
          onMove={(direction) => { onMoveAttribute?.(entity.name, attribute.name, direction); }}
          onSave={(next) => { onEditAttribute?.(entity.name, attribute.name, next); }}
          showMoveUp={index > 0}
        />
      ))}
      <form onSubmit={(event) => { event.preventDefault(); onAddAttribute?.(entity.name, { name: newAttributeName, type: 'string' }); setNewAttributeName('attribute'); }} style={{ display: 'flex', gap: 4, marginTop: 5 }}>
        <input aria-label={`New attribute for ${entity.name}`} onChange={(event) => { setNewAttributeName(event.target.value); }} value={newAttributeName} />
        <button type="submit">Add attribute</button>
      </form>
    </section>
  );
}

function ErAttributeForm({ attribute, entityName, onDelete, onMove, onSave, showMoveUp }: {
  attribute: ErAttribute; entityName: string; onDelete: () => void; onMove: (direction: 'up' | 'down') => void; onSave: (attribute: ErAttribute) => void; showMoveUp: boolean;
}) {
  const [draft, setDraft] = useState(attribute);
  const setKeys = (marker: ErAttribute['keys'][number], checked: boolean) => setDraft((current) => ({ ...current, keys: checked ? [...new Set([...current.keys, marker])] : current.keys.filter((key) => key !== marker) }));
  return <form aria-label={`Attribute ${attribute.name} on ${entityName}`} onSubmit={(event) => { event.preventDefault(); onSave(draft); }} style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
    <input aria-label={`Type for ${attribute.name}`} onChange={(event) => { setDraft((current) => ({ ...current, type: event.target.value })); }} value={draft.type} />
    <input aria-label={`Name for ${attribute.name}`} onChange={(event) => { setDraft((current) => ({ ...current, name: event.target.value })); }} value={draft.name} />
    {(['PK', 'FK', 'UK'] as const).map((marker) => <label key={marker}><input checked={draft.keys.includes(marker)} onChange={(event) => { setKeys(marker, event.target.checked); }} type="checkbox" />{marker}</label>)}
    <input aria-label={`Comment for ${attribute.name}`} onChange={(event) => { setDraft((current) => ({ ...current, comment: event.target.value })); }} placeholder="comment" value={draft.comment ?? ''} />
    <button type="submit">Save</button><button aria-label={`Move ${attribute.name} up`} disabled={!showMoveUp} onClick={() => { onMove('up'); }} type="button">↑</button><button aria-label={`Move ${attribute.name} down`} onClick={() => { onMove('down'); }} type="button">↓</button><button aria-label={`Delete attribute ${attribute.name}`} onClick={onDelete} type="button">Delete</button>
  </form>;
}

function ErRelationshipForm({ entities, onDelete, onSave, relationship }: { entities: string[]; onDelete?: () => void; onSave?: (relationship: ErRelationship) => void; relationship: ErRelationship }) {
  const [draft, setDraft] = useState(relationship);
  return <form aria-label={`Relationship ${relationship.left} ${relationship.right}`} onSubmit={(event) => { event.preventDefault(); onSave?.(draft); }} style={{ alignItems: 'center', display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
    <select aria-label="Relationship left entity" onChange={(event) => { setDraft((current) => ({ ...current, left: event.target.value })); }} value={draft.left}>{entities.map((entity) => <option key={entity} value={entity}>{entity}</option>)}</select>
    <select aria-label="Relationship left cardinality" onChange={(event) => { setDraft((current) => ({ ...current, leftCardinality: event.target.value as ErRelationship['leftCardinality'] })); }} value={draft.leftCardinality}>{ER_CARDINALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    <label><input checked={draft.identifying} onChange={(event) => { setDraft((current) => ({ ...current, identifying: event.target.checked })); }} type="checkbox" />identifying</label>
    <select aria-label="Relationship right cardinality" onChange={(event) => { setDraft((current) => ({ ...current, rightCardinality: event.target.value as ErRelationship['rightCardinality'] })); }} value={draft.rightCardinality}>{ER_CARDINALITY_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
    <select aria-label="Relationship right entity" onChange={(event) => { setDraft((current) => ({ ...current, right: event.target.value })); }} value={draft.right}>{entities.map((entity) => <option key={entity} value={entity}>{entity}</option>)}</select>
    <input aria-label="Relationship label" onChange={(event) => { setDraft((current) => ({ ...current, label: event.target.value })); }} value={draft.label} />
    <button type="submit">{onDelete ? 'Save' : 'Add relationship'}</button>{onDelete ? <button aria-label={`Delete relationship ${relationship.label}`} onClick={onDelete} type="button">Delete</button> : null}
  </form>;
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

function isCanvasSingleKeyShortcutExcluded(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (target.closest('.react-flow__node, [data-subgraph-drag-target="true"]')) return false;
  return Boolean(target.closest('a, button, input, select, textarea, [contenteditable="true"], [role="button"], [data-testid*="toolbar"]'));
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
