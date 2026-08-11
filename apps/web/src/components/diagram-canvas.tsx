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
import { getPairedSemanticPanelPlacement, type PairedSemanticPanelPlacement } from '../lib/canvas-semantic-panels';
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
import { getDirtyDraftFields, reconcileCanonicalDraft, sameCanonicalDraft } from '../lib/canonical-draft';
import type { SequenceActivationAction, SequenceArrow, SequenceDiagramSnapshot, SequenceFragmentKind, SequenceMessage, SequenceNote, SequenceParticipant, SequenceParticipantKind } from '../lib/sequence-mutations';
import { getErRelationshipIdentity, type ErAttribute, type ErDiagramSnapshot, type ErRelationship, type ErRelationshipIdentity } from '../lib/er-mutations';
import { CLASS_RELATION_OPTIONS, getClassMemberIdentity, getClassRelationshipIdentity, type ClassDiagramSnapshot, type ClassEntity, type ClassMember, type ClassMemberIdentity, type ClassRelationship, type ClassRelationshipIdentity } from '../lib/class-mutations';
import { getStateTransitionIdentity, type StateDiagramSnapshot, type StateTransition, type StateTransitionIdentity } from '../lib/state-mutations';
import { getRequirementRelationshipIdentity, type RequirementDiagramSnapshot, type RequirementEntity, type RequirementRelationship, type RequirementRelationshipIdentity } from '../lib/requirement-mutations';
import { getArchitectureAlignmentIdentity, getArchitectureEdgeIdentity, type ArchitectureAlignment, type ArchitectureAlignmentIdentity, type ArchitectureDiagramSnapshot, type ArchitectureEdge, type ArchitectureEdgeIdentity, type ArchitectureGroup, type ArchitectureJunction, type ArchitecturePort, type ArchitectureService } from '../lib/architecture-mutations';
import { getC4RelationshipIdentity, type C4Boundary, type C4DiagramSnapshot, type C4Element, type C4Relationship, type C4RelationshipIdentity } from '../lib/c4-mutations';
import { getBlockLinkIdentity, type BlockComposite, type BlockDiagramSnapshot, type BlockLink, type BlockLinkIdentity, type BlockNode } from '../lib/block-mutations';
import { getSwimlaneHandoffIdentity, type Swimlane, type SwimlaneDiagramSnapshot, type SwimlaneHandoff, type SwimlaneHandoffIdentity, type SwimlaneNode } from '../lib/swimlane-mutations';
import { getJourneyTaskIdentity, type JourneyDiagramSnapshot, type JourneyTask, type JourneyTaskIdentity } from '../lib/journey-mutations';
import { getGanttTaskIdentity, type GanttDiagramSnapshot, type GanttTask, type GanttTaskIdentity } from '../lib/gantt-mutations';
import { getTimelineEventIdentity, type TimelineDiagramSnapshot, type TimelineDirection, type TimelineEvent, type TimelineEventIdentity, type TimelinePeriod } from '../lib/timeline-mutations';
import { getGitGraphOperationIdentity, type GitGraphBranch, type GitGraphCheckout, type GitGraphCherryPick, type GitGraphCommit, type GitGraphDiagramSnapshot, type GitGraphMerge, type GitGraphOperationIdentity } from '../lib/gitgraph-mutations';
import type { EventModelingDataBlock, EventModelingDiagramSnapshot, EventModelingTimeframe } from '../lib/event-modeling-mutations';
import type { KanbanCard, KanbanColumn, KanbanDiagramSnapshot } from '../lib/kanban-mutations';
import { getMindmapNodeIdentity, type MindmapDiagramSnapshot, type MindmapNode, type MindmapNodeIdentity, type MindmapNodeShape } from '../lib/mindmap-mutations';
import { getTreeViewNodeIdentity, type TreeViewDiagramSnapshot, type TreeViewNode, type TreeViewNodeIdentity } from '../lib/treeview-mutations';
import { getIshikawaCauseIdentity, type IshikawaCause, type IshikawaCauseIdentity, type IshikawaCauseInput, type IshikawaDiagramSnapshot } from '../lib/ishikawa-mutations';
import { getRailroadRuleIdentity, type RailroadDiagramSnapshot, type RailroadRule, type RailroadRuleIdentity } from '../lib/railroad-mutations';

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
  isClass?: boolean;
  isState?: boolean;
  isRequirement?: boolean;
  isArchitecture?: boolean;
  isC4?: boolean;
  isBlock?: boolean;
  isSwimlane?: boolean;
  isJourney?: boolean;
  isGantt?: boolean;
  isTimeline?: boolean;
  isGitGraph?: boolean;
  isEventModeling?: boolean;
  isKanban?: boolean;
  isMindmap?: boolean;
  isTreeView?: boolean;
  isIshikawa?: boolean;
  isRailroad?: boolean;
  nodePositions?: DiagramNodePositions;
  preserveCamera?: boolean;
  readOnly?: boolean;
  selectedNodeIds?: string[];
  svg: string;
  sequenceParticipants?: readonly SequenceParticipant[];
  sequenceDiagram?: SequenceDiagramSnapshot | null;
  sequenceTextItems?: readonly SequenceSvgTextItem[];
  erDiagram?: ErDiagramSnapshot | null;
  classDiagram?: ClassDiagramSnapshot | null;
  stateDiagram?: StateDiagramSnapshot | null;
  requirementDiagram?: RequirementDiagramSnapshot | null;
  architectureDiagram?: ArchitectureDiagramSnapshot | null;
  c4Diagram?: C4DiagramSnapshot | null;
  blockDiagram?: BlockDiagramSnapshot | null;
  swimlaneDiagram?: SwimlaneDiagramSnapshot | null;
  journeyDiagram?: JourneyDiagramSnapshot | null;
  ganttDiagram?: GanttDiagramSnapshot | null;
  timelineDiagram?: TimelineDiagramSnapshot | null;
  gitGraphDiagram?: GitGraphDiagramSnapshot | null;
  eventModelingDiagram?: EventModelingDiagramSnapshot | null;
  kanbanDiagram?: KanbanDiagramSnapshot | null;
  mindmapDiagram?: MindmapDiagramSnapshot | null;
  treeViewDiagram?: TreeViewDiagramSnapshot | null;
  ishikawaDiagram?: IshikawaDiagramSnapshot | null;
  railroadDiagram?: RailroadDiagramSnapshot | null;
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
  onAddClass?: (name: string) => void;
  onEditClass?: (name: string, patch: Partial<Pick<ClassEntity, 'name' | 'label'>>) => void;
  onDeleteClass?: (name: string) => void;
  onAddClassMember?: (name: string, member: ClassMember) => void;
  onEditClassMember?: (name: string, identity: ClassMemberIdentity, member: ClassMember) => void;
  onDeleteClassMember?: (name: string, identity: ClassMemberIdentity) => void;
  onAddClassAnnotation?: (name: string, annotation: string) => void;
  onDeleteClassAnnotation?: (name: string, annotation: string) => void;
  onAddClassRelationship?: (relationship: ClassRelationship) => void;
  onEditClassRelationship?: (identity: ClassRelationshipIdentity, relationship: ClassRelationship) => void;
  onDeleteClassRelationship?: (identity: ClassRelationshipIdentity) => void;
  onAddState?: (name: string) => void;
  onEditState?: (id: string, patch: { id?: string; label?: string }) => void;
  onDeleteState?: (id: string) => void;
  onAddStateTransition?: (transition: StateTransition) => void;
  onEditStateTransition?: (identity: StateTransitionIdentity, transition: StateTransition) => void;
  onDeleteStateTransition?: (identity: StateTransitionIdentity) => void;
  onAddRequirement?: (requirement: RequirementEntity) => void;
  onEditRequirement?: (name: string, requirement: Partial<Pick<RequirementEntity, 'fields' | 'kind'>> & { name?: string }) => void;
  onDeleteRequirement?: (name: string) => void;
  onAddRequirementRelationship?: (relationship: RequirementRelationship) => void;
  onEditRequirementRelationship?: (identity: RequirementRelationshipIdentity, relationship: RequirementRelationship) => void;
  onDeleteRequirementRelationship?: (identity: RequirementRelationshipIdentity) => void;
  onAddArchitectureGroup?: (group: ArchitectureGroup) => void;
  onEditArchitectureGroup?: (id: string, patch: Partial<ArchitectureGroup> & { id?: string }) => void;
  onDeleteArchitectureGroup?: (id: string) => void;
  onAddArchitectureService?: (service: ArchitectureService) => void;
  onEditArchitectureService?: (id: string, patch: Partial<ArchitectureService> & { id?: string }) => void;
  onDeleteArchitectureService?: (id: string) => void;
  onAddArchitectureJunction?: (junction: ArchitectureJunction) => void;
  onEditArchitectureJunction?: (id: string, patch: Partial<ArchitectureJunction> & { id?: string }) => void;
  onDeleteArchitectureJunction?: (id: string) => void;
  onAddArchitectureEdge?: (edge: ArchitectureEdge) => void;
  onEditArchitectureEdge?: (identity: ArchitectureEdgeIdentity, edge: ArchitectureEdge) => void;
  onDeleteArchitectureEdge?: (identity: ArchitectureEdgeIdentity) => void;
  onAddArchitectureAlignment?: (alignment: ArchitectureAlignment) => void;
  onEditArchitectureAlignment?: (identity: ArchitectureAlignmentIdentity, alignment: ArchitectureAlignment) => void;
  onDeleteArchitectureAlignment?: (identity: ArchitectureAlignmentIdentity) => void;
  onAddC4Element?: (value: C4Element) => void;
  onEditC4Element?: (id: string, value: Partial<C4Element>) => void;
  onDeleteC4Element?: (id: string) => void;
  onMoveC4Element?: (id: string, parentId: string | null) => void;
  onMoveC4Boundary?: (id: string, parentId: string | null) => void;
  onAddC4Boundary?: (value: C4Boundary) => void;
  onEditC4Boundary?: (id: string, value: Partial<C4Boundary>) => void;
  onDeleteC4Boundary?: (id: string) => void;
  onAddC4Relationship?: (value: C4Relationship) => void;
  onEditC4Relationship?: (identity: C4RelationshipIdentity, value: Partial<C4Relationship>) => void;
  onDeleteC4Relationship?: (identity: C4RelationshipIdentity) => void;
  onAddBlockNode?: (value: BlockNode) => void;
  onEditBlockNode?: (id: string, value: Partial<BlockNode>) => void;
  onDeleteBlockNode?: (id: string) => void;
  onMoveBlockNode?: (id: string, parentId: string | null) => void;
  onMoveBlockComposite?: (id: string, parentId: string | null) => void;
  onAddBlockComposite?: (value: Partial<BlockComposite>) => void;
  onEditBlockComposite?: (id: string, value: Partial<BlockComposite>) => void;
  onDeleteBlockComposite?: (id: string) => void;
  onSetBlockColumns?: (value: number) => void;
  onAddBlockLink?: (value: BlockLink) => void;
  onEditBlockLink?: (identity: BlockLinkIdentity, value: Partial<BlockLink>) => void;
  onDeleteBlockLink?: (identity: BlockLinkIdentity) => void;
  onAddSwimlane?: (value: Swimlane) => void;
  onEditSwimlane?: (id: string, value: Partial<Swimlane>) => void;
  onDeleteSwimlane?: (id: string) => void;
  onAddSwimlaneNode?: (value: SwimlaneNode) => void;
  onEditSwimlaneNode?: (id: string, value: Partial<Pick<SwimlaneNode, 'id' | 'label'>>) => void;
  onMoveSwimlaneNode?: (id: string, laneId: string) => void;
  onDeleteSwimlaneNode?: (id: string) => void;
  onAddSwimlaneHandoff?: (value: SwimlaneHandoff) => void;
  onEditSwimlaneHandoff?: (identity: SwimlaneHandoffIdentity, value: Partial<SwimlaneHandoff>) => void;
  onDeleteSwimlaneHandoff?: (identity: SwimlaneHandoffIdentity) => void;
  onAddJourneySection?: (value: { label: string }) => void;
  onDeleteJourneySection?: (label: string) => void;
  onEditJourneySection?: (label: string, value: { label?: string }) => void;
  onMoveJourneySection?: (label: string, direction: 'up' | 'down') => void;
  onAddJourneyTask?: (value: JourneyTask) => void;
  onEditJourneyTask?: (identity: JourneyTaskIdentity, value: Partial<JourneyTask>) => void;
  onDeleteJourneyTask?: (identity: JourneyTaskIdentity) => void;
  onMoveJourneyTask?: (identity: JourneyTaskIdentity, direction: 'up' | 'down') => void;
  onAddGanttSection?: (value: { label: string }) => void;
  onDeleteGanttSection?: (label: string) => void;
  onEditGanttSection?: (label: string, value: { label?: string }) => void;
  onMoveGanttSection?: (label: string, direction: 'up' | 'down') => void;
  onAddGanttTask?: (value: GanttTask) => void;
  onEditGanttTask?: (identity: GanttTaskIdentity, value: Partial<GanttTask>) => void;
  onDeleteGanttTask?: (identity: GanttTaskIdentity) => void;
  onMoveGanttTask?: (identity: GanttTaskIdentity, direction: 'up' | 'down') => void;
  onAddTimelineSection?: (value: { label: string }) => void;
  onDeleteTimelineSection?: (label: string) => void;
  onEditTimelineSection?: (label: string, value: { label?: string }) => void;
  onMoveTimelineSection?: (label: string, direction: 'up' | 'down') => void;
  onAddTimelinePeriod?: (value: { label: string; section: string }) => void;
  onEditTimelinePeriod?: (label: string, value: Partial<TimelinePeriod>) => void;
  onMoveTimelinePeriod?: (label: string, section: string) => void;
  onDeleteTimelinePeriod?: (label: string) => void;
  onAddTimelineEvent?: (value: TimelineEvent) => void;
  onEditTimelineEvent?: (identity: TimelineEventIdentity, value: Partial<TimelineEvent>) => void;
  onDeleteTimelineEvent?: (identity: TimelineEventIdentity) => void;
  onMoveTimelineEvent?: (identity: TimelineEventIdentity, direction: 'up' | 'down') => void;
  onSetTimelineDirection?: (value: TimelineDirection) => void;
  onAddGitGraphCommit?: (value: GitGraphCommit) => void;
  onEditGitGraphCommit?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphCommit>) => void;
  onAddGitGraphBranch?: (value: GitGraphBranch) => void;
  onEditGitGraphBranch?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphBranch>) => void;
  onAddGitGraphCheckout?: (value: GitGraphCheckout) => void;
  onEditGitGraphCheckout?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphCheckout>) => void;
  onAddGitGraphMerge?: (value: GitGraphMerge) => void;
  onEditGitGraphMerge?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphMerge>) => void;
  onAddGitGraphCherryPick?: (value: GitGraphCherryPick) => void;
  onEditGitGraphCherryPick?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphCherryPick>) => void;
  onDeleteGitGraphOperation?: (identity: GitGraphOperationIdentity) => void;
  onMoveGitGraphOperation?: (identity: GitGraphOperationIdentity, direction: 'up' | 'down') => void;
  onAddEventModelingTimeframe?: (value: EventModelingTimeframe) => void;
  onEditEventModelingTimeframe?: (index: string, value: Partial<EventModelingTimeframe>) => void;
  onDeleteEventModelingTimeframe?: (index: string) => void;
  onMoveEventModelingTimeframe?: (index: string, target: number) => void;
  onAddEventModelingEntity?: (name: string) => void;
  onRenameEventModelingEntity?: (name: string, next: string) => void;
  onDeleteEventModelingEntity?: (name: string) => void;
  onAddEventModelingData?: (value: EventModelingDataBlock) => void;
  onEditEventModelingData?: (name: string, value: Partial<EventModelingDataBlock>) => void;
  onDeleteEventModelingData?: (name: string) => void;
  onAddKanbanColumn?: (value: KanbanColumn) => void;
  onEditKanbanColumn?: (id: string, value: Partial<KanbanColumn>) => void;
  onDeleteKanbanColumn?: (id: string) => void;
  onAddKanbanCard?: (value: KanbanCard) => void;
  onEditKanbanCard?: (id: string, value: Partial<Omit<KanbanCard, 'columnId'>>) => void;
  onDeleteKanbanCard?: (id: string) => void;
  onMoveKanbanCard?: (id: string, columnId: string, targetIndex: number) => void;
  onAddMindmapNode?: (value: Omit<MindmapNode, 'parentLabel'>, parent?: MindmapNodeIdentity) => void;
  onEditMindmapNode?: (identity: MindmapNodeIdentity, value: Partial<Omit<MindmapNode, 'parentLabel'>>) => void;
  onDeleteMindmapNode?: (identity: MindmapNodeIdentity) => void;
  onMoveMindmapNode?: (identity: MindmapNodeIdentity, direction: 'up' | 'down') => void;
  onReparentMindmapNode?: (identity: MindmapNodeIdentity, parent: MindmapNodeIdentity) => void;
  onAddTreeViewNode?: (value: Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'>, parent?: TreeViewNodeIdentity) => void;
  onEditTreeViewNode?: (identity: TreeViewNodeIdentity, value: Partial<Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'>>) => void;
  onDeleteTreeViewNode?: (identity: TreeViewNodeIdentity) => void;
  onMoveTreeViewNode?: (identity: TreeViewNodeIdentity, direction: 'up' | 'down') => void;
  onReparentTreeViewNode?: (identity: TreeViewNodeIdentity, parent: TreeViewNodeIdentity) => void;
  onSetIshikawaEffect?: (value: string) => void;
  onEditIshikawaEffect?: (value: string) => void;
  onAddIshikawaCause?: (value: IshikawaCauseInput) => void;
  onEditIshikawaCause?: (identity: IshikawaCauseIdentity, value: Partial<Pick<IshikawaCause, 'label'>>) => void;
  onDeleteIshikawaCause?: (identity: IshikawaCauseIdentity) => void;
  onMoveIshikawaCause?: (identity: IshikawaCauseIdentity, direction: 'up' | 'down') => void;
  onReparentIshikawaCause?: (identity: IshikawaCauseIdentity, parent: IshikawaCauseIdentity | null) => void;
  onAddRailroadRule?: (value: RailroadRule) => void;
  onEditRailroadRule?: (identity: RailroadRuleIdentity, value: Partial<RailroadRule>) => void;
  onRenameRailroadRule?: (identity: RailroadRuleIdentity, name: string) => void;
  onDeleteRailroadRule?: (identity: RailroadRuleIdentity) => void;
  onMoveRailroadRule?: (identity: RailroadRuleIdentity, direction: 'up' | 'down') => void;
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
  isClass = false,
  isState = false,
  isRequirement = false,
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
  onAddClass,
  onEditClass,
  onDeleteClass,
  onAddClassMember,
  onEditClassMember,
  onDeleteClassMember,
  onAddClassAnnotation,
  onDeleteClassAnnotation,
  onAddClassRelationship,
  onEditClassRelationship,
  onDeleteClassRelationship,
  onAddState,
  onEditState,
  onDeleteState,
  onAddStateTransition,
  onEditStateTransition,
  onDeleteStateTransition,
  onAddRequirement,
  onEditRequirement,
  onDeleteRequirement,
  onAddRequirementRelationship,
  onEditRequirementRelationship,
  onDeleteRequirementRelationship,
  onAddArchitectureGroup,
  onEditArchitectureGroup,
  onDeleteArchitectureGroup,
  onAddArchitectureService,
  onEditArchitectureService,
  onDeleteArchitectureService,
  onAddArchitectureJunction,
  onEditArchitectureJunction,
  onDeleteArchitectureJunction,
  onAddArchitectureEdge,
  onEditArchitectureEdge,
  onDeleteArchitectureEdge,
  onAddArchitectureAlignment,
  onEditArchitectureAlignment,
  onDeleteArchitectureAlignment,
  onAddC4Element,
  onEditC4Element,
  onDeleteC4Element,
  onMoveC4Element,
  onMoveC4Boundary,
  onAddC4Boundary,
  onEditC4Boundary,
  onDeleteC4Boundary,
  onAddC4Relationship,
  onEditC4Relationship,
  onDeleteC4Relationship,
  onAddBlockNode,
  onEditBlockNode,
  onDeleteBlockNode,
  onMoveBlockNode,
  onMoveBlockComposite,
  onAddBlockComposite,
  onEditBlockComposite,
  onDeleteBlockComposite,
  onSetBlockColumns,
  onAddBlockLink,
  onEditBlockLink,
  onDeleteBlockLink,
  onAddSwimlane,
  onEditSwimlane,
  onDeleteSwimlane,
  onAddSwimlaneNode,
  onEditSwimlaneNode,
  onMoveSwimlaneNode,
  onDeleteSwimlaneNode,
  onAddSwimlaneHandoff,
  onEditSwimlaneHandoff,
  onDeleteSwimlaneHandoff,
  onAddJourneySection,
  onDeleteJourneySection,
  onEditJourneySection,
  onMoveJourneySection,
  onAddJourneyTask,
  onEditJourneyTask,
  onDeleteJourneyTask,
  onMoveJourneyTask,
  onAddGanttSection,
  onDeleteGanttSection,
  onEditGanttSection,
  onMoveGanttSection,
  onAddGanttTask,
  onEditGanttTask,
  onDeleteGanttTask,
  onMoveGanttTask,
  onAddTimelineSection,
  onDeleteTimelineSection,
  onEditTimelineSection,
  onMoveTimelineSection,
  onAddTimelinePeriod,
  onEditTimelinePeriod,
  onMoveTimelinePeriod,
  onDeleteTimelinePeriod,
  onAddTimelineEvent,
  onEditTimelineEvent,
  onDeleteTimelineEvent,
  onMoveTimelineEvent,
  onSetTimelineDirection,
  onAddGitGraphCommit,
  onEditGitGraphCommit,
  onAddGitGraphBranch,
  onEditGitGraphBranch,
  onAddGitGraphCheckout,
  onEditGitGraphCheckout,
  onAddGitGraphMerge,
  onEditGitGraphMerge,
  onAddGitGraphCherryPick,
  onEditGitGraphCherryPick,
  onDeleteGitGraphOperation,
  onMoveGitGraphOperation,
  onAddEventModelingTimeframe,
  onEditEventModelingTimeframe,
  onDeleteEventModelingTimeframe,
  onMoveEventModelingTimeframe,
  onAddEventModelingEntity,
  onRenameEventModelingEntity,
  onDeleteEventModelingEntity,
  onAddEventModelingData,
  onEditEventModelingData,
  onDeleteEventModelingData,
  onAddKanbanColumn,
  onEditKanbanColumn,
  onDeleteKanbanColumn,
  onAddKanbanCard,
  onEditKanbanCard,
  onDeleteKanbanCard,
  onMoveKanbanCard,
  onAddMindmapNode,
  onEditMindmapNode,
  onDeleteMindmapNode,
  onMoveMindmapNode,
  onReparentMindmapNode,
  onAddTreeViewNode,
  onEditTreeViewNode,
  onDeleteTreeViewNode,
  onMoveTreeViewNode,
  onReparentTreeViewNode,
  onSetIshikawaEffect,
  onEditIshikawaEffect,
  onAddIshikawaCause,
  onEditIshikawaCause,
  onDeleteIshikawaCause,
  onMoveIshikawaCause,
  onReparentIshikawaCause,
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
  classDiagram = null,
  stateDiagram = null,
  requirementDiagram = null,
  architectureDiagram = null,
  isArchitecture = false,
  c4Diagram = null,
  blockDiagram = null,
  swimlaneDiagram = null,
  isC4 = false,
  isBlock = false,
  isSwimlane = false,
  isJourney = false,
  isGantt = false,
  isTimeline = false,
  isGitGraph = false,
  isEventModeling = false,
  isKanban = false,
  isMindmap = false,
  isTreeView = false,
  isIshikawa = false,
  isRailroad = false,
  journeyDiagram = null,
  ganttDiagram = null,
  timelineDiagram = null,
  gitGraphDiagram = null,
  eventModelingDiagram = null,
  kanbanDiagram = null,
  mindmapDiagram = null,
  treeViewDiagram = null,
  ishikawaDiagram = null,
  railroadDiagram = null,
  onAddRailroadRule,
  onEditRailroadRule,
  onRenameRailroadRule,
  onDeleteRailroadRule,
  onMoveRailroadRule,
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
  const hierarchyPanelMaxHeight = getMeasuredSemanticPanelMaxHeight(canvasViewport, erEditorBottom);
  const pairedSemanticPanelPlacement = useMemo(
    () => canvasViewportMeasured ? getPairedSemanticPanelPlacement(canvasSize, canvasViewport, erEditorBottom) : null,
    [canvasSize, canvasViewport, canvasViewportMeasured, erEditorBottom],
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

        {isClass && !readOnly && classDiagram ? (
          <ClassEditorControls
            bottom={erEditorBottom}
            diagram={classDiagram}
            onAddAnnotation={onAddClassAnnotation}
            onAddClass={onAddClass}
            onAddMember={onAddClassMember}
            onAddRelationship={onAddClassRelationship}
            onDeleteAnnotation={onDeleteClassAnnotation}
            onDeleteClass={onDeleteClass}
            onDeleteMember={onDeleteClassMember}
            onDeleteRelationship={onDeleteClassRelationship}
            onEditClass={onEditClass}
            onEditMember={onEditClassMember}
            onEditRelationship={onEditClassRelationship}
          />
        ) : null}
        {isState && !readOnly && stateDiagram ? (
          <StateEditorControls
            bottom={erEditorBottom}
            diagram={stateDiagram}
            onAddState={onAddState}
            onAddTransition={onAddStateTransition}
            onDeleteState={onDeleteState}
            onDeleteTransition={onDeleteStateTransition}
            onEditState={onEditState}
            onEditTransition={onEditStateTransition}
          />
        ) : null}
        {isRequirement && !readOnly && requirementDiagram ? (
          <RequirementEditorControls
            bottom={erEditorBottom}
            diagram={requirementDiagram}
            onAddRequirement={onAddRequirement}
            onAddRelationship={onAddRequirementRelationship}
            onDeleteRequirement={onDeleteRequirement}
            onDeleteRelationship={onDeleteRequirementRelationship}
            onEditRequirement={onEditRequirement}
            onEditRelationship={onEditRequirementRelationship}
          />
        ) : null}
        {isArchitecture && !readOnly && architectureDiagram ? (
          <ArchitectureEditorControls
            bottom={erEditorBottom}
            diagram={architectureDiagram}
            onAddAlignment={onAddArchitectureAlignment}
            onAddEdge={onAddArchitectureEdge}
            onAddGroup={onAddArchitectureGroup}
            onAddJunction={onAddArchitectureJunction}
            onAddService={onAddArchitectureService}
            onDeleteAlignment={onDeleteArchitectureAlignment}
            onDeleteEdge={onDeleteArchitectureEdge}
            onDeleteGroup={onDeleteArchitectureGroup}
            onDeleteJunction={onDeleteArchitectureJunction}
            onDeleteService={onDeleteArchitectureService}
            onEditAlignment={onEditArchitectureAlignment}
            onEditEdge={onEditArchitectureEdge}
            onEditGroup={onEditArchitectureGroup}
            onEditJunction={onEditArchitectureJunction}
            onEditService={onEditArchitectureService}
          />
        ) : null}
        {isC4 && !readOnly && c4Diagram ? <><C4EditorControls bottom={erEditorBottom} diagram={c4Diagram} onAddBoundary={onAddC4Boundary} onAddElement={onAddC4Element} onAddRelationship={onAddC4Relationship} onDeleteBoundary={onDeleteC4Boundary} onDeleteElement={onDeleteC4Element} onDeleteRelationship={onDeleteC4Relationship} onEditBoundary={onEditC4Boundary} onEditElement={onEditC4Element} onEditRelationship={onEditC4Relationship} placement={pairedSemanticPanelPlacement?.editor} /><C4ContainmentControls bottom={erEditorBottom} boundaries={c4Diagram.boundaries} elements={c4Diagram.elements} onMoveBoundary={onMoveC4Boundary} onMoveElement={onMoveC4Element} placement={pairedSemanticPanelPlacement?.containment} /></> : null}
        {isBlock && !readOnly && blockDiagram ? <><BlockEditorControls bottom={erEditorBottom} diagram={blockDiagram} onAddComposite={onAddBlockComposite} onAddLink={onAddBlockLink} onAddNode={onAddBlockNode} onDeleteComposite={onDeleteBlockComposite} onDeleteLink={onDeleteBlockLink} onDeleteNode={onDeleteBlockNode} onEditComposite={onEditBlockComposite} onEditLink={onEditBlockLink} onEditNode={onEditBlockNode} onSetColumns={onSetBlockColumns} placement={pairedSemanticPanelPlacement?.editor} /><BlockContainmentControls bottom={erEditorBottom} composites={blockDiagram.composites} nodes={blockDiagram.nodes} onMoveComposite={onMoveBlockComposite} onMoveNode={onMoveBlockNode} placement={pairedSemanticPanelPlacement?.containment} /></> : null}
        {isSwimlane && !readOnly && swimlaneDiagram ? <SwimlaneEditorControls bottom={erEditorBottom} diagram={swimlaneDiagram} onAddHandoff={onAddSwimlaneHandoff} onAddLane={onAddSwimlane} onAddNode={onAddSwimlaneNode} onDeleteHandoff={onDeleteSwimlaneHandoff} onDeleteLane={onDeleteSwimlane} onDeleteNode={onDeleteSwimlaneNode} onEditHandoff={onEditSwimlaneHandoff} onEditLane={onEditSwimlane} onEditNode={onEditSwimlaneNode} onMoveNode={onMoveSwimlaneNode} /> : null}
        {isJourney && !readOnly && journeyDiagram ? <JourneyEditorControls bottom={erEditorBottom} diagram={journeyDiagram} onAddSection={onAddJourneySection} onAddTask={onAddJourneyTask} onDeleteSection={onDeleteJourneySection} onDeleteTask={onDeleteJourneyTask} onEditSection={onEditJourneySection} onEditTask={onEditJourneyTask} onMoveSection={onMoveJourneySection} onMoveTask={onMoveJourneyTask} /> : null}
        {isGantt && !readOnly && ganttDiagram ? <GanttEditorControls bottom={erEditorBottom} diagram={ganttDiagram} onAddSection={onAddGanttSection} onAddTask={onAddGanttTask} onDeleteSection={onDeleteGanttSection} onDeleteTask={onDeleteGanttTask} onEditSection={onEditGanttSection} onEditTask={onEditGanttTask} onMoveSection={onMoveGanttSection} onMoveTask={onMoveGanttTask} /> : null}
        {isTimeline && !readOnly && timelineDiagram ? <TimelineEditorControls bottom={erEditorBottom} diagram={timelineDiagram} onAddEvent={onAddTimelineEvent} onAddPeriod={onAddTimelinePeriod} onAddSection={onAddTimelineSection} onDeleteEvent={onDeleteTimelineEvent} onDeletePeriod={onDeleteTimelinePeriod} onDeleteSection={onDeleteTimelineSection} onEditEvent={onEditTimelineEvent} onEditPeriod={onEditTimelinePeriod} onEditSection={onEditTimelineSection} onMoveEvent={onMoveTimelineEvent} onMovePeriod={onMoveTimelinePeriod} onMoveSection={onMoveTimelineSection} onSetDirection={onSetTimelineDirection} /> : null}
        {isGitGraph && !readOnly && gitGraphDiagram ? <GitGraphEditorControls bottom={erEditorBottom} diagram={gitGraphDiagram} onAddBranch={onAddGitGraphBranch} onAddCheckout={onAddGitGraphCheckout} onAddCherryPick={onAddGitGraphCherryPick} onAddCommit={onAddGitGraphCommit} onAddMerge={onAddGitGraphMerge} onDelete={onDeleteGitGraphOperation} onEditBranch={onEditGitGraphBranch} onEditCheckout={onEditGitGraphCheckout} onEditCherryPick={onEditGitGraphCherryPick} onEditCommit={onEditGitGraphCommit} onEditMerge={onEditGitGraphMerge} onMove={onMoveGitGraphOperation} /> : null}
        {isEventModeling && !readOnly && eventModelingDiagram ? <EventModelingEditorControls bottom={erEditorBottom} diagram={eventModelingDiagram} onAddData={onAddEventModelingData} onAddEntity={onAddEventModelingEntity} onAddTimeframe={onAddEventModelingTimeframe} onDeleteData={onDeleteEventModelingData} onDeleteEntity={onDeleteEventModelingEntity} onDeleteTimeframe={onDeleteEventModelingTimeframe} onEditData={onEditEventModelingData} onEditTimeframe={onEditEventModelingTimeframe} onMoveTimeframe={onMoveEventModelingTimeframe} onRenameEntity={onRenameEventModelingEntity} /> : null}
        {isKanban && !readOnly && kanbanDiagram ? <KanbanEditorControls bottom={erEditorBottom} diagram={kanbanDiagram} onAddCard={onAddKanbanCard} onAddColumn={onAddKanbanColumn} onDeleteCard={onDeleteKanbanCard} onDeleteColumn={onDeleteKanbanColumn} onEditCard={onEditKanbanCard} onEditColumn={onEditKanbanColumn} onMoveCard={onMoveKanbanCard} /> : null}
        {isMindmap && !readOnly && mindmapDiagram ? <MindmapEditorControls bottom={erEditorBottom} diagram={mindmapDiagram} maxHeight={hierarchyPanelMaxHeight} onAdd={onAddMindmapNode} onDelete={onDeleteMindmapNode} onEdit={onEditMindmapNode} onMove={onMoveMindmapNode} onReparent={onReparentMindmapNode} /> : null}
        {isTreeView && !readOnly && treeViewDiagram ? <TreeViewEditorControls bottom={erEditorBottom} diagram={treeViewDiagram} maxHeight={hierarchyPanelMaxHeight} onAdd={onAddTreeViewNode} onDelete={onDeleteTreeViewNode} onEdit={onEditTreeViewNode} onMove={onMoveTreeViewNode} onReparent={onReparentTreeViewNode} /> : null}
        {isIshikawa && !readOnly && ishikawaDiagram ? <IshikawaEditorControls bottom={erEditorBottom} diagram={ishikawaDiagram} maxHeight={hierarchyPanelMaxHeight} onAdd={onAddIshikawaCause} onDelete={onDeleteIshikawaCause} onEdit={onEditIshikawaCause} onEditEffect={onEditIshikawaEffect ?? onSetIshikawaEffect} onMove={onMoveIshikawaCause} onReparent={onReparentIshikawaCause} /> : null}
        {isRailroad && !readOnly && railroadDiagram ? <RailroadEditorControls bottom={erEditorBottom} diagram={railroadDiagram} maxHeight={hierarchyPanelMaxHeight} onAdd={onAddRailroadRule} onDelete={onDeleteRailroadRule} onEdit={onEditRailroadRule} onMove={onMoveRailroadRule} onRename={onRenameRailroadRule} /> : null}

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

const SEMANTIC_PANEL_STYLE: CSSProperties = {
  background: 'var(--surface-canvas)', border: '1px solid var(--control-border)', borderRadius: 8,
  maxHeight: 'min(58vh, 560px)', overflow: 'auto', padding: 10, pointerEvents: 'auto', position: 'absolute', right: 12,
  width: 'min(400px, calc(100% - 24px))', zIndex: 7,
};
const HIERARCHY_CONTROL_STYLE: CSSProperties = { minHeight: 44, minWidth: 44 };
const SEMANTIC_PANEL_TOP_INSET = 56;
const SEMANTIC_PANEL_MAX_HEIGHT = 480;
function getMeasuredSemanticPanelMaxHeight(viewport: ViewportRect, bottom: number): number { return Math.max(44, Math.min(SEMANTIC_PANEL_MAX_HEIGHT, viewport.height - bottom - SEMANTIC_PANEL_TOP_INSET)); }

function JourneyEditorControls({ bottom, diagram, onAddSection, onAddTask, onDeleteSection, onDeleteTask, onEditSection, onEditTask, onMoveSection, onMoveTask }: { bottom: number; diagram: JourneyDiagramSnapshot; onAddSection?: (value: { label: string }) => void; onAddTask?: (value: JourneyTask) => void; onDeleteSection?: (label: string) => void; onDeleteTask?: (identity: JourneyTaskIdentity) => void; onEditSection?: (label: string, value: { label?: string }) => void; onEditTask?: (identity: JourneyTaskIdentity, value: Partial<JourneyTask>) => void; onMoveSection?: (label: string, direction: 'up' | 'down') => void; onMoveTask?: (identity: JourneyTaskIdentity, direction: 'up' | 'down') => void }) {
  const [section, setSection] = useState('Section');
  const [task, setTask] = useState<JourneyTask>({ actors: ['Customer'], score: 3, section: diagram.sections[0]?.label ?? '', text: 'Task' });
  useEffect(() => {
    setTask((current) => ({ ...current, section: diagram.sections.some((item) => item.label === current.section) ? current.section : diagram.sections[0]?.label ?? '' }));
  }, [diagram.sections]);
  return <aside className="canvas-semantic-editor canvas-journey-editor" data-canvas-pan-exclusion="true" data-testid="journey-editor-controls" style={{ ...SEMANTIC_PANEL_STYLE, bottom }}>
    <strong>User journey</strong>
    <form onSubmit={(event) => { event.preventDefault(); onAddSection?.({ label: section }); }} style={{ display: 'flex', gap: 4, marginTop: 5 }}>
      <input aria-label="New journey section" onChange={(event) => setSection(event.target.value)} value={section} />
      <button type="submit">Add section</button>
    </form>
    <form onSubmit={(event) => { event.preventDefault(); onAddTask?.(task); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
      <select aria-label="New journey task section" onChange={(event) => setTask((current) => ({ ...current, section: event.target.value }))} value={task.section}>
        <option value="">No section</option>{diagram.sections.map((item) => <option key={item.label}>{item.label}</option>)}
      </select>
      <input aria-label="New journey task" onChange={(event) => setTask((current) => ({ ...current, text: event.target.value }))} value={task.text} />
      <input aria-label="New journey score" max="5" min="1" onChange={(event) => setTask((current) => ({ ...current, score: Number(event.target.value) }))} type="number" value={task.score} />
      <input aria-label="New journey actors" onChange={(event) => setTask((current) => ({ ...current, actors: event.target.value.split(',').map((actor) => actor.trim()).filter(Boolean) }))} value={task.actors.join(', ')} />
      <button type="submit">Add task</button>
    </form>
    {diagram.sections.map((item) => <SectionForm family="Journey" item={item} key={item.label} onDelete={onDeleteSection} onSave={onEditSection} onMove={onMoveSection} />)}
    {diagram.tasks.map((item, index) => <JourneyTaskForm identity={getJourneyTaskIdentity(item, index, diagram.tasks)} key={`${index}:${item.text}`} onDelete={onDeleteTask} onMove={onMoveTask} onSave={onEditTask} task={item} />)}
  </aside>;
}
function JourneyTaskForm({ identity, onDelete, onMove, onSave, task }: { identity: JourneyTaskIdentity; onDelete?: (identity: JourneyTaskIdentity) => void; onMove?: (identity: JourneyTaskIdentity, direction: 'up' | 'down') => void; onSave?: (identity: JourneyTaskIdentity, value: Partial<JourneyTask>) => void; task: JourneyTask }) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(task);
  return <form aria-label={`Journey task ${task.text}`} onSubmit={(event) => { event.preventDefault(); onSave?.(identity, draft); resetDraft(); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
    <input aria-label={`Journey task ${task.text} text`} onChange={(event) => updateDraft((current) => ({ ...current, text: event.target.value }))} value={draft.text} />
    <input aria-label={`Journey task ${task.text} score`} max="5" min="1" onChange={(event) => updateDraft((current) => ({ ...current, score: Number(event.target.value) }))} type="number" value={draft.score} />
    <input aria-label={`Journey task ${task.text} actors`} onChange={(event) => updateDraft((current) => ({ ...current, actors: event.target.value.split(',').map((actor) => actor.trim()).filter(Boolean) }))} value={draft.actors.join(', ')} />
    <button type="submit">Save</button>
    <button aria-label={`Move journey task ${task.text} up`} onClick={() => onMove?.(identity, 'up')} type="button">↑</button>
    <button aria-label={`Move journey task ${task.text} down`} onClick={() => onMove?.(identity, 'down')} type="button">↓</button>
    <button aria-label={`Delete journey task ${task.text}`} onClick={() => onDelete?.(identity)} type="button">Delete</button>
  </form>;
}

function GanttEditorControls({ bottom, diagram, onAddSection, onAddTask, onDeleteSection, onDeleteTask, onEditSection, onEditTask, onMoveSection, onMoveTask }: { bottom: number; diagram: GanttDiagramSnapshot; onAddSection?: (value: { label: string }) => void; onAddTask?: (value: GanttTask) => void; onDeleteSection?: (label: string) => void; onDeleteTask?: (identity: GanttTaskIdentity) => void; onEditSection?: (label: string, value: { label?: string }) => void; onEditTask?: (identity: GanttTaskIdentity, value: Partial<GanttTask>) => void; onMoveSection?: (label: string, direction: 'up' | 'down') => void; onMoveTask?: (identity: GanttTaskIdentity, direction: 'up' | 'down') => void }) {
  const [section, setSection] = useState('Section');
  const [task, setTask] = useState<GanttTask>({ end: '1d', id: 'task', section: diagram.sections[0]?.label ?? '', start: '2026-01-01', statuses: [], text: 'Task' });
  useEffect(() => {
    setTask((current) => ({ ...current, section: diagram.sections.some((item) => item.label === current.section) ? current.section : diagram.sections[0]?.label ?? '' }));
  }, [diagram.sections]);
  return <aside className="canvas-semantic-editor canvas-gantt-editor" data-canvas-pan-exclusion="true" data-testid="gantt-editor-controls" style={{ ...SEMANTIC_PANEL_STYLE, bottom }}>
    <strong>Gantt</strong>
    <form onSubmit={(event) => { event.preventDefault(); onAddSection?.({ label: section }); }} style={{ display: 'flex', gap: 4, marginTop: 5 }}>
      <input aria-label="New Gantt section" onChange={(event) => setSection(event.target.value)} value={section} />
      <button type="submit">Add section</button>
    </form>
    <form onSubmit={(event) => { event.preventDefault(); onAddTask?.(task); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
      <select aria-label="New Gantt task section" onChange={(event) => setTask((current) => ({ ...current, section: event.target.value }))} value={task.section}>
        <option value="">No section</option>{diagram.sections.map((item) => <option key={item.label}>{item.label}</option>)}
      </select>
      <input aria-label="New Gantt task" onChange={(event) => setTask((current) => ({ ...current, text: event.target.value }))} value={task.text} />
      <input aria-label="New Gantt task id" onChange={(event) => setTask((current) => ({ ...current, id: event.target.value }))} value={task.id} />
      <input aria-label="New Gantt start or dependency" onChange={(event) => setTask((current) => ({ ...current, start: event.target.value }))} value={task.start} />
      <input aria-label="New Gantt end or duration" onChange={(event) => setTask((current) => ({ ...current, end: event.target.value }))} value={task.end} />
      <GanttStatusControls ariaPrefix="New Gantt task status" statuses={task.statuses} onChange={(statuses) => setTask((current) => ({ ...current, statuses }))} />
      <button type="submit">Add task</button>
    </form>
    {diagram.sections.map((item) => <SectionForm family="Gantt" item={item} key={item.label} onDelete={onDeleteSection} onSave={onEditSection} onMove={onMoveSection} />)}
    {diagram.tasks.map((item, index) => <GanttTaskForm identity={getGanttTaskIdentity(item, index, diagram.tasks)} key={item.id} onDelete={onDeleteTask} onMove={onMoveTask} onSave={onEditTask} sections={diagram.sections.map((entry) => entry.label)} task={item} />)}
  </aside>;
}

function GanttTaskForm({ identity, onDelete, onMove, onSave, sections, task }: { identity: GanttTaskIdentity; onDelete?: (identity: GanttTaskIdentity) => void; onMove?: (identity: GanttTaskIdentity, direction: 'up' | 'down') => void; onSave?: (identity: GanttTaskIdentity, value: Partial<GanttTask>) => void; sections: string[]; task: GanttTask }) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(task);
  return <form aria-label={`Gantt task ${task.id}`} onSubmit={(event) => { event.preventDefault(); onSave?.(identity, draft); resetDraft(); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
    <select aria-label={`Gantt task ${task.id} section`} onChange={(event) => updateDraft((current) => ({ ...current, section: event.target.value }))} value={draft.section}>
      <option value="">No section</option>{sections.map((section) => <option key={section}>{section}</option>)}
    </select>
    <input aria-label={`Gantt task ${task.id} text`} onChange={(event) => updateDraft((current) => ({ ...current, text: event.target.value }))} value={draft.text} />
    <input aria-label={`Gantt task ${task.id} id`} onChange={(event) => updateDraft((current) => ({ ...current, id: event.target.value }))} value={draft.id} />
    <input aria-label={`Gantt task ${task.id} start or dependency`} onChange={(event) => updateDraft((current) => ({ ...current, start: event.target.value }))} value={draft.start} />
    <input aria-label={`Gantt task ${task.id} end or duration`} onChange={(event) => updateDraft((current) => ({ ...current, end: event.target.value }))} value={draft.end} />
    <GanttStatusControls ariaPrefix={`Gantt task ${task.id} status`} statuses={draft.statuses} onChange={(statuses) => updateDraft((current) => ({ ...current, statuses }))} />
    <button type="submit">Save</button>
    <button aria-label={`Move Gantt task ${task.id} up`} onClick={() => onMove?.(identity, 'up')} type="button">↑</button>
    <button aria-label={`Move Gantt task ${task.id} down`} onClick={() => onMove?.(identity, 'down')} type="button">↓</button>
    <button aria-label={`Delete Gantt task ${task.id}`} onClick={() => onDelete?.(identity)} type="button">Delete</button>
  </form>;
}

function GanttStatusControls({ ariaPrefix, onChange, statuses }: { ariaPrefix: string; onChange: (statuses: GanttTask['statuses']) => void; statuses: GanttTask['statuses'] }) {
  const options: GanttTask['statuses'][number][] = ['active', 'done', 'crit', 'milestone'];
  return <>{options.map((status) => <label key={status}>
    <input aria-label={`${ariaPrefix} ${status}`} checked={statuses.includes(status)} onChange={(event) => onChange(event.target.checked ? [...statuses, status] : statuses.filter((candidate) => candidate !== status))} type="checkbox" />
    {status}
  </label>)}</>;
}

function TimelineEditorControls({ bottom, diagram, onAddEvent, onAddPeriod, onAddSection, onDeleteEvent, onDeletePeriod, onDeleteSection, onEditEvent, onEditPeriod, onEditSection, onMoveEvent, onMovePeriod, onMoveSection, onSetDirection }: { bottom: number; diagram: TimelineDiagramSnapshot; onAddEvent?: (value: TimelineEvent) => void; onAddPeriod?: (value: TimelinePeriod) => void; onAddSection?: (value: { label: string }) => void; onDeleteEvent?: (identity: TimelineEventIdentity) => void; onDeletePeriod?: (label: string) => void; onDeleteSection?: (label: string) => void; onEditEvent?: (identity: TimelineEventIdentity, value: Partial<TimelineEvent>) => void; onEditPeriod?: (label: string, value: Partial<TimelinePeriod>) => void; onEditSection?: (label: string, value: { label?: string }) => void; onMoveEvent?: (identity: TimelineEventIdentity, direction: 'up' | 'down') => void; onMovePeriod?: (label: string, section: string) => void; onMoveSection?: (label: string, direction: 'up' | 'down') => void; onSetDirection?: (value: TimelineDirection) => void }) {
  const [section, setSection] = useState('Section');
  const [period, setPeriod] = useState<TimelinePeriod>({ label: '2026', section: diagram.sections[0]?.label ?? '' });
  const [event, setEvent] = useState<TimelineEvent>({ period: diagram.periods[0]?.label ?? '', section: diagram.periods[0]?.section ?? '', text: 'Event' });
  useEffect(() => {
    setPeriod((current) => ({ ...current, section: diagram.sections.some((item) => item.label === current.section) ? current.section : diagram.sections[0]?.label ?? '' }));
    setEvent((current) => {
      const selected = diagram.periods.find((item) => item.label === current.period) ?? diagram.periods[0];
      return selected ? { ...current, period: selected.label, section: selected.section } : { ...current, period: '', section: '' };
    });
  }, [diagram.periods, diagram.sections]);
  return <aside className="canvas-semantic-editor canvas-timeline-editor" data-canvas-pan-exclusion="true" data-testid="timeline-editor-controls" style={{ ...SEMANTIC_PANEL_STYLE, bottom }}>
    <strong>Timeline</strong>
    <label>Direction <select aria-label="Timeline direction" onChange={(event) => onSetDirection?.(event.target.value as TimelineDirection)} value={diagram.direction}><option>LR</option><option>TD</option></select></label>
    <form onSubmit={(event) => { event.preventDefault(); onAddSection?.({ label: section }); }}>
      <input aria-label="New timeline section" onChange={(event) => setSection(event.target.value)} value={section} />
      <button type="submit">Add section</button>
    </form>
    <form onSubmit={(event) => { event.preventDefault(); onAddPeriod?.(period); }}>
      <input aria-label="New timeline period label" onChange={(event) => setPeriod((current) => ({ ...current, label: event.target.value }))} value={period.label} />
      <select aria-label="New timeline period section" onChange={(event) => setPeriod((current) => ({ ...current, section: event.target.value }))} value={period.section}>
        <option value="">Top level</option>{diagram.sections.map((item) => <option key={item.label}>{item.label}</option>)}
      </select>
      <button type="submit">Add period</button>
    </form>
    <form onSubmit={(submitEvent) => { submitEvent.preventDefault(); onAddEvent?.(event); }}>
      <select aria-label="New timeline event period" onChange={(changeEvent) => setEvent((current) => {
        const selected = diagram.periods.find((item) => item.label === changeEvent.target.value);
        return selected ? { ...current, period: selected.label, section: selected.section } : current;
      })} value={event.period}>
        {diagram.periods.map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
      </select>
      <input aria-label="New timeline event" onChange={(changeEvent) => setEvent((current) => ({ ...current, text: changeEvent.target.value }))} value={event.text} />
      <button type="submit">Add event</button>
    </form>
    {diagram.sections.map((item) => <SectionForm family="Timeline" item={item} key={item.label} onDelete={onDeleteSection} onMove={onMoveSection} onSave={onEditSection} />)}
    {diagram.periods.map((item) => <TimelinePeriodForm key={item.label} onDelete={onDeletePeriod} onEdit={onEditPeriod} onMove={onMovePeriod} period={item} sections={diagram.sections.map((section) => section.label)} />)}
    {diagram.events.map((item, index) => <TimelineEventForm identity={getTimelineEventIdentity(item, index, diagram.events)} key={`${index}:${item.text}`} onDelete={onDeleteEvent} onMove={onMoveEvent} onSave={onEditEvent} event={item} />)}
  </aside>;
}

function TimelinePeriodForm({ onDelete, onEdit, onMove, period, sections }: { onDelete?: (label: string) => void; onEdit?: (label: string, value: Partial<TimelinePeriod>) => void; onMove?: (label: string, section: string) => void; period: TimelinePeriod; sections: string[] }) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(period);
  return <form aria-label={`Timeline period ${period.label}`} onSubmit={(event) => { event.preventDefault(); onEdit?.(period.label, draft); resetDraft(); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}>
    <input aria-label={`Timeline period ${period.label} label`} onChange={(event) => updateDraft((current) => ({ ...current, label: event.target.value }))} value={draft.label} />
    <select aria-label={`Timeline period ${period.label} destination`} onChange={(event) => updateDraft((current) => ({ ...current, section: event.target.value }))} value={draft.section}>
      <option value="">Top level</option>{sections.map((section) => <option key={section}>{section}</option>)}
    </select>
    <button type="submit">Save</button>
    <button aria-label={`Move timeline period ${period.label} to top level`} onClick={() => onMove?.(period.label, '')} type="button">Top level</button>
    <button aria-label={`Delete timeline period ${period.label}`} onClick={() => onDelete?.(period.label)} type="button">Delete</button>
  </form>;
}

function TimelineEventForm({ event, identity, onDelete, onMove, onSave }: { event: TimelineEvent; identity: TimelineEventIdentity; onDelete?: (identity: TimelineEventIdentity) => void; onMove?: (identity: TimelineEventIdentity, direction: 'up' | 'down') => void; onSave?: (identity: TimelineEventIdentity, value: Partial<TimelineEvent>) => void }) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(event);
  return <form aria-label={`Timeline event ${event.text}`} onSubmit={(event) => { event.preventDefault(); onSave?.(identity, draft); resetDraft(); }}>
    <input aria-label={`Timeline event ${event.text} text`} onChange={(event) => updateDraft((current) => ({ ...current, text: event.target.value }))} value={draft.text} />
    <button type="submit">Save</button>
    <button aria-label={`Move timeline event ${event.text} up`} onClick={() => onMove?.(identity, 'up')} type="button">↑</button>
    <button aria-label={`Move timeline event ${event.text} down`} onClick={() => onMove?.(identity, 'down')} type="button">↓</button>
    <button aria-label={`Delete timeline event ${event.text}`} onClick={() => onDelete?.(identity)} type="button">Delete</button>
  </form>;
}

function GitGraphEditorControls({ bottom, diagram, onAddBranch, onAddCheckout, onAddCherryPick, onAddCommit, onAddMerge, onDelete, onEditBranch, onEditCheckout, onEditCherryPick, onEditCommit, onEditMerge, onMove }: { bottom: number; diagram: GitGraphDiagramSnapshot; onAddBranch?: (value: GitGraphBranch) => void; onAddCheckout?: (value: GitGraphCheckout) => void; onAddCherryPick?: (value: GitGraphCherryPick) => void; onAddCommit?: (value: GitGraphCommit) => void; onAddMerge?: (value: GitGraphMerge) => void; onDelete?: (identity: GitGraphOperationIdentity) => void; onEditBranch?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphBranch>) => void; onEditCheckout?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphCheckout>) => void; onEditCherryPick?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphCherryPick>) => void; onEditCommit?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphCommit>) => void; onEditMerge?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphMerge>) => void; onMove?: (identity: GitGraphOperationIdentity, direction: 'up' | 'down') => void }) {
  const [commit, setCommit] = useState<GitGraphCommit>({ id: 'commit', tags: [] }); const [branch, setBranch] = useState<GitGraphBranch>({ name: 'feature' }); const [checkout, setCheckout] = useState<GitGraphCheckout>({ branch: 'main', keyword: 'checkout' }); const [merge, setMerge] = useState<GitGraphMerge>({ branch: 'feature', tags: [] }); const [pick, setPick] = useState<GitGraphCherryPick>({ id: 'commit', tags: [] });
  const branches = ['main', ...diagram.operations.filter((operation) => operation.kind === 'branch').map((operation) => operation.value.name)];
  const mergeBranches = branches.filter((name) => name !== 'main');
  useEffect(() => { setCheckout((current) => ({ ...current, branch: branches.includes(current.branch) ? current.branch : 'main' })); setMerge((current) => ({ ...current, branch: mergeBranches.includes(current.branch) ? current.branch : mergeBranches[0] ?? '' })); }, [branches.join('\u0000')]);
  return <aside className="canvas-semantic-editor" data-canvas-pan-exclusion="true" data-testid="gitgraph-editor-controls" style={{ ...SEMANTIC_PANEL_STYLE, bottom }}><strong>GitGraph</strong>
    <form onSubmit={(event) => { event.preventDefault(); onAddCommit?.(commit); }}><input aria-label="New GitGraph commit id" onChange={(event) => setCommit((current) => ({ ...current, id: event.target.value }))} value={commit.id ?? ''} /><select aria-label="New GitGraph commit type" onChange={(event) => setCommit((current) => ({ ...current, type: (event.target.value || undefined) as GitGraphCommit['type'] }))} value={commit.type ?? ''}><option value="">Default type</option><option>HIGHLIGHT</option><option>NORMAL</option><option>REVERSE</option></select><input aria-label="New GitGraph commit tags" onChange={(event) => setCommit((current) => ({ ...current, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) }))} value={commit.tags.join(', ')} /><button type="submit">Add commit</button></form>
    <form onSubmit={(event) => { event.preventDefault(); onAddBranch?.(branch); }}><input aria-label="New GitGraph branch" onChange={(event) => setBranch((current) => ({ ...current, name: event.target.value }))} value={branch.name} /><input aria-label="New GitGraph branch order" onChange={(event) => setBranch((current) => ({ ...current, order: event.target.value ? Number(event.target.value) : undefined }))} type="number" value={branch.order ?? ''} /><button type="submit">Add branch</button></form>
    <form onSubmit={(event) => { event.preventDefault(); onAddCheckout?.(checkout); }}><select aria-label="GitGraph checkout kind" onChange={(event) => setCheckout((current) => ({ ...current, keyword: event.target.value as GitGraphCheckout['keyword'] }))} value={checkout.keyword}><option value="checkout">checkout</option><option value="switch">switch</option></select><select aria-label="GitGraph checkout branch" onChange={(event) => setCheckout((current) => ({ ...current, branch: event.target.value }))} value={checkout.branch}>{branches.map((name) => <option key={name}>{name}</option>)}</select><button type="submit">Add checkout</button></form>
    <form onSubmit={(event) => { event.preventDefault(); onAddMerge?.(merge); }}><select aria-label="GitGraph merge branch" onChange={(event) => setMerge((current) => ({ ...current, branch: event.target.value }))} value={merge.branch}>{mergeBranches.map((name) => <option key={name}>{name}</option>)}</select><input aria-label="GitGraph merge id" onChange={(event) => setMerge((current) => ({ ...current, id: event.target.value || undefined }))} value={merge.id ?? ''} /><select aria-label="GitGraph merge type" onChange={(event) => setMerge((current) => ({ ...current, type: (event.target.value || undefined) as GitGraphMerge['type'] }))} value={merge.type ?? ''}><option value="">Default type</option><option>HIGHLIGHT</option><option>NORMAL</option><option>REVERSE</option></select><input aria-label="GitGraph merge tags" onChange={(event) => setMerge((current) => ({ ...current, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) }))} value={merge.tags.join(', ')} /><button type="submit">Add merge</button></form>
    <form onSubmit={(event) => { event.preventDefault(); onAddCherryPick?.(pick); }}><input aria-label="GitGraph cherry-pick commit id" onChange={(event) => setPick((current) => ({ ...current, id: event.target.value }))} value={pick.id} /><input aria-label="GitGraph cherry-pick parent" onChange={(event) => setPick((current) => ({ ...current, parent: event.target.value || undefined }))} value={pick.parent ?? ''} /><input aria-label="GitGraph cherry-pick tags" onChange={(event) => setPick((current) => ({ ...current, tags: event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) }))} value={pick.tags.join(', ')} /><button type="submit">Add cherry-pick</button></form>
    {diagram.operations.map((operation, index) => <GitGraphOperationForm key={`${index}:${operation.kind}`} identity={getGitGraphOperationIdentity(operation, diagram.operations)} index={index} operation={operation} onDelete={onDelete} onEditBranch={onEditBranch} onEditCheckout={onEditCheckout} onEditCherryPick={onEditCherryPick} onEditCommit={onEditCommit} onEditMerge={onEditMerge} onMove={onMove} />)}
  </aside>;
}
function GitGraphOperationForm({ identity, index, operation, onDelete, onEditBranch, onEditCheckout, onEditCherryPick, onEditCommit, onEditMerge, onMove }: { identity: GitGraphOperationIdentity; index: number; operation: GitGraphDiagramSnapshot['operations'][number]; onDelete?: (identity: GitGraphOperationIdentity) => void; onEditBranch?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphBranch>) => void; onEditCheckout?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphCheckout>) => void; onEditCherryPick?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphCherryPick>) => void; onEditCommit?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphCommit>) => void; onEditMerge?: (identity: GitGraphOperationIdentity, value: Partial<GitGraphMerge>) => void; onMove?: (identity: GitGraphOperationIdentity, direction: 'up' | 'down') => void }) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(operation.value);
  const save = () => { if (operation.kind === 'commit') onEditCommit?.(identity, draft as Partial<GitGraphCommit>); else if (operation.kind === 'branch') onEditBranch?.(identity, draft as Partial<GitGraphBranch>); else if (operation.kind === 'checkout') onEditCheckout?.(identity, draft as Partial<GitGraphCheckout>); else if (operation.kind === 'merge') onEditMerge?.(identity, draft as Partial<GitGraphMerge>); else onEditCherryPick?.(identity, draft as Partial<GitGraphCherryPick>); resetDraft(); };
  const label = `GitGraph ${operation.kind} ${index + 1}`;
  const fields = operation.kind === 'commit'
    ? <><input aria-label={`${label} id`} onChange={(event) => updateDraft((current) => ({ ...(current as GitGraphCommit), id: event.target.value || undefined }))} value={(draft as GitGraphCommit).id ?? ''} /><GitGraphTypeSelect label={`${label} type`} onChange={(type) => updateDraft((current) => ({ ...(current as GitGraphCommit), type }))} value={(draft as GitGraphCommit).type} /><GitGraphTagsInput label={`${label} tags`} onChange={(tags) => updateDraft((current) => ({ ...(current as GitGraphCommit), tags }))} value={(draft as GitGraphCommit).tags} /></>
    : operation.kind === 'branch'
      ? <><input aria-label={`${label} name`} onChange={(event) => updateDraft((current) => ({ ...(current as GitGraphBranch), name: event.target.value }))} value={(draft as GitGraphBranch).name} /><input aria-label={`${label} order`} onChange={(event) => updateDraft((current) => ({ ...(current as GitGraphBranch), order: event.target.value ? Number(event.target.value) : undefined }))} type="number" value={(draft as GitGraphBranch).order ?? ''} /></>
      : operation.kind === 'checkout'
        ? <><select aria-label={`${label} kind`} onChange={(event) => updateDraft((current) => ({ ...(current as GitGraphCheckout), keyword: event.target.value as GitGraphCheckout['keyword'] }))} value={(draft as GitGraphCheckout).keyword}><option value="checkout">checkout</option><option value="switch">switch</option></select><input aria-label={`${label} branch`} onChange={(event) => updateDraft((current) => ({ ...(current as GitGraphCheckout), branch: event.target.value }))} value={(draft as GitGraphCheckout).branch} /></>
        : operation.kind === 'merge'
          ? <><input aria-label={`${label} branch`} onChange={(event) => updateDraft((current) => ({ ...(current as GitGraphMerge), branch: event.target.value }))} value={(draft as GitGraphMerge).branch} /><input aria-label={`${label} id`} onChange={(event) => updateDraft((current) => ({ ...(current as GitGraphMerge), id: event.target.value || undefined }))} value={(draft as GitGraphMerge).id ?? ''} /><GitGraphTypeSelect label={`${label} type`} onChange={(type) => updateDraft((current) => ({ ...(current as GitGraphMerge), type }))} value={(draft as GitGraphMerge).type} /><GitGraphTagsInput label={`${label} tags`} onChange={(tags) => updateDraft((current) => ({ ...(current as GitGraphMerge), tags }))} value={(draft as GitGraphMerge).tags} /></>
          : <><input aria-label={`${label} id`} onChange={(event) => updateDraft((current) => ({ ...(current as GitGraphCherryPick), id: event.target.value }))} value={(draft as GitGraphCherryPick).id} /><input aria-label={`${label} parent`} onChange={(event) => updateDraft((current) => ({ ...(current as GitGraphCherryPick), parent: event.target.value || undefined }))} value={(draft as GitGraphCherryPick).parent ?? ''} /><GitGraphTagsInput label={`${label} tags`} onChange={(tags) => updateDraft((current) => ({ ...(current as GitGraphCherryPick), tags }))} value={(draft as GitGraphCherryPick).tags} /></>;
  return <form aria-label={label} onSubmit={(event) => { event.preventDefault(); save(); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}><strong>{operation.kind}</strong>{fields}<button type="submit">Save</button><button aria-label={`Move ${label} up`} onClick={() => onMove?.(identity, 'up')} type="button">↑</button><button aria-label={`Move ${label} down`} onClick={() => onMove?.(identity, 'down')} type="button">↓</button><button aria-label={`Delete ${label}`} onClick={() => onDelete?.(identity)} type="button">Delete</button></form>;
}
function GitGraphTagsInput({ label, onChange, value }: { label: string; onChange: (tags: string[]) => void; value: string[] }) { return <input aria-label={label} onChange={(event) => onChange(event.target.value.split(',').map((tag) => tag.trim()).filter(Boolean))} value={value.join(', ')} />; }
function GitGraphTypeSelect({ label, onChange, value }: { label: string; onChange: (type: GitGraphCommit['type']) => void; value?: GitGraphCommit['type'] }) { return <select aria-label={label} onChange={(event) => onChange((event.target.value || undefined) as GitGraphCommit['type'])} value={value ?? ''}><option value="">Default type</option><option>HIGHLIGHT</option><option>NORMAL</option><option>REVERSE</option></select>; }

function EventModelingEditorControls({ bottom, diagram, onAddData, onAddEntity, onAddTimeframe, onDeleteData, onDeleteEntity, onDeleteTimeframe, onEditData, onEditTimeframe, onMoveTimeframe, onRenameEntity }: { bottom: number; diagram: EventModelingDiagramSnapshot; onAddData?: (value: EventModelingDataBlock) => void; onAddEntity?: (name: string) => void; onAddTimeframe?: (value: EventModelingTimeframe) => void; onDeleteData?: (name: string) => void; onDeleteEntity?: (name: string) => void; onDeleteTimeframe?: (index: string) => void; onEditData?: (name: string, value: Partial<EventModelingDataBlock>) => void; onEditTimeframe?: (index: string, value: Partial<EventModelingTimeframe>) => void; onMoveTimeframe?: (index: string, target: number) => void; onRenameEntity?: (name: string, next: string) => void }) {
  const [entity, setEntity] = useState('Order'); const [timeframe, setTimeframe] = useState<EventModelingTimeframe>({ entity: 'Order', entityType: 'cmd', index: '01', kind: 'tf', links: [] }); const [data, setData] = useState<EventModelingDataBlock>({ name: 'OrderData', dataType: 'json', payload: '  {}\n' });
  useEffect(() => { setTimeframe((current) => ({ ...current, entity: diagram.entities.some((item) => item.name === current.entity) ? current.entity : diagram.entities[0]?.name ?? current.entity, dataId: diagram.dataBlocks.some((item) => item.name === current.dataId) ? current.dataId : undefined, links: current.links.filter((link) => diagram.timeframes.some((item) => item.index === link)) })); }, [diagram.dataBlocks, diagram.entities, diagram.timeframes]);
  return <aside className="canvas-semantic-editor" data-canvas-pan-exclusion="true" data-testid="event-modeling-editor-controls" style={{ ...SEMANTIC_PANEL_STYLE, bottom }}><strong>Event modeling</strong><form onSubmit={(event) => { event.preventDefault(); onAddEntity?.(entity); }}><input aria-label="New Event Modeling entity" onChange={(event) => setEntity(event.target.value)} value={entity} /><button type="submit">Add entity</button></form><form onSubmit={(event) => { event.preventDefault(); onAddTimeframe?.(timeframe); }}><input aria-label="New Event Modeling timeframe index" onChange={(event) => setTimeframe((current) => ({ ...current, index: event.target.value }))} value={timeframe.index} /><EventFrameFields prefix="New Event Modeling timeframe" update={setTimeframe} value={timeframe} entities={diagram.entities.map((item) => item.name)} dataBlocks={diagram.dataBlocks.map((item) => item.name)} /><button type="submit">Add timeframe</button></form><form onSubmit={(event) => { event.preventDefault(); onAddData?.(data); }}><input aria-label="New Event Modeling data name" onChange={(event) => setData((current) => ({ ...current, name: event.target.value }))} value={data.name} /><EventDataTypeSelect label="New Event Modeling data type" onChange={(dataType) => setData((current) => ({ ...current, dataType }))} value={data.dataType} /><textarea aria-label="New Event Modeling data payload" onChange={(event) => setData((current) => ({ ...current, payload: event.target.value }))} value={data.payload} /><button type="submit">Add data</button></form>{diagram.entities.map((item) => <EventEntityForm entity={item.name} key={item.name} onDelete={onDeleteEntity} onRename={onRenameEntity} />)}{diagram.timeframes.map((item, index) => <EventTimeframeForm dataBlocks={diagram.dataBlocks.map((entry) => entry.name)} entities={diagram.entities.map((entry) => entry.name)} index={index} key={item.index} onDelete={onDeleteTimeframe} onMove={onMoveTimeframe} onSave={onEditTimeframe} value={item} />)}{diagram.dataBlocks.map((item) => <EventDataForm data={item} key={item.name} onDelete={onDeleteData} onSave={onEditData} />)}</aside>;
}
function EventEntityForm({ entity, onDelete, onRename }: { entity: string; onDelete?: (value: string) => void; onRename?: (value: string, next: string) => void }) { const { draft, resetDraft, updateDraft } = useCanonicalDraft({ name: entity }); return <form aria-label={`Event Modeling entity ${entity}`} onSubmit={(event) => { event.preventDefault(); onRename?.(entity, draft.name); resetDraft(); }}><input aria-label={`Event Modeling entity ${entity} name`} onChange={(event) => updateDraft(() => ({ name: event.target.value }))} value={draft.name} /><button type="submit">Save</button><button aria-label={`Delete Event Modeling entity ${entity}`} onClick={() => onDelete?.(entity)} type="button">Delete</button></form>; }
function EventFrameFields({ dataBlocks, entities, prefix, update, value }: { dataBlocks: string[]; entities: string[]; prefix: string; update: (value: (current: EventModelingTimeframe) => EventModelingTimeframe) => void; value: EventModelingTimeframe }) { return <><select aria-label={`${prefix} kind`} onChange={(event) => update((current) => ({ ...current, kind: event.target.value as EventModelingTimeframe['kind'] }))} value={value.kind}>{['tf', 'timeframe', 'rf', 'resetframe'].map((kind) => <option key={kind}>{kind}</option>)}</select><select aria-label={`${prefix} type`} onChange={(event) => update((current) => ({ ...current, entityType: event.target.value as EventModelingTimeframe['entityType'] }))} value={value.entityType}>{['cmd', 'command', 'evt', 'event', 'pcr', 'processor', 'readmodel', 'rmo', 'ui'].map((type) => <option key={type}>{type}</option>)}</select><select aria-label={`${prefix} entity`} onChange={(event) => update((current) => ({ ...current, entity: event.target.value }))} value={value.entity}>{entities.map((name) => <option key={name}>{name}</option>)}</select><input aria-label={`${prefix} links`} onChange={(event) => update((current) => ({ ...current, links: event.target.value.split(',').map((link) => link.trim()).filter(Boolean) }))} value={value.links.join(', ')} /><select aria-label={`${prefix} data`} onChange={(event) => update((current) => ({ ...current, dataId: event.target.value || undefined }))} value={value.dataId ?? ''}><option value="">No data</option>{dataBlocks.map((name) => <option key={name}>{name}</option>)}</select></>; }
function EventTimeframeForm({ dataBlocks, entities, index, onDelete, onMove, onSave, value }: { dataBlocks: string[]; entities: string[]; index: number; onDelete?: (value: string) => void; onMove?: (value: string, target: number) => void; onSave?: (index: string, value: Partial<EventModelingTimeframe>) => void; value: EventModelingTimeframe }) { const { draft, resetDraft, updateDraft } = useCanonicalDraft(value); return <form aria-label={`Event Modeling timeframe ${value.index}`} onSubmit={(event) => { event.preventDefault(); onSave?.(value.index, draft); resetDraft(); }}><input aria-label={`Event Modeling timeframe ${value.index} index`} onChange={(event) => updateDraft((current) => ({ ...current, index: event.target.value }))} value={draft.index} /><EventFrameFields dataBlocks={dataBlocks} entities={entities} prefix={`Event Modeling timeframe ${value.index}`} update={updateDraft} value={draft} /><button type="submit">Save</button><button aria-label={`Move Event Modeling timeframe ${value.index} up`} onClick={() => onMove?.(value.index, index - 1)} type="button">↑</button><button aria-label={`Move Event Modeling timeframe ${value.index} down`} onClick={() => onMove?.(value.index, index + 1)} type="button">↓</button><button aria-label={`Delete Event Modeling timeframe ${value.index}`} onClick={() => onDelete?.(value.index)} type="button">Delete</button></form>; }
function EventDataTypeSelect({ label, onChange, value }: { label: string; onChange: (value: EventModelingDataBlock['dataType']) => void; value?: EventModelingDataBlock['dataType'] }) { return <select aria-label={label} onChange={(event) => onChange(event.target.value as EventModelingDataBlock['dataType'])} value={value ?? 'json'}>{['json', 'jsobj', 'figma', 'salt', 'uri', 'md', 'html', 'text'].map((type) => <option key={type}>{type}</option>)}</select>; }
function EventDataForm({ data, onDelete, onSave }: { data: EventModelingDataBlock; onDelete?: (name: string) => void; onSave?: (name: string, value: Partial<EventModelingDataBlock>) => void }) { const { draft, resetDraft, updateDraft } = useCanonicalDraft(data); return <form aria-label={`Event Modeling data ${data.name}`} onSubmit={(event) => { event.preventDefault(); onSave?.(data.name, draft); resetDraft(); }}><input aria-label={`Event Modeling data ${data.name} name`} onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))} value={draft.name} /><EventDataTypeSelect label={`Event Modeling data ${data.name} type`} onChange={(dataType) => updateDraft((current) => ({ ...current, dataType }))} value={draft.dataType} /><textarea aria-label={`Event Modeling data ${data.name} payload`} onChange={(event) => updateDraft((current) => ({ ...current, payload: event.target.value }))} value={draft.payload} /><button type="submit">Save</button><button aria-label={`Delete Event Modeling data ${data.name}`} onClick={() => onDelete?.(data.name)} type="button">Delete</button></form>; }

function KanbanEditorControls({ bottom, diagram, onAddCard, onAddColumn, onDeleteCard, onDeleteColumn, onEditCard, onEditColumn, onMoveCard }: { bottom: number; diagram: KanbanDiagramSnapshot; onAddCard?: (value: KanbanCard) => void; onAddColumn?: (value: KanbanColumn) => void; onDeleteCard?: (id: string) => void; onDeleteColumn?: (id: string) => void; onEditCard?: (id: string, value: Partial<Omit<KanbanCard, 'columnId'>>) => void; onEditColumn?: (id: string, value: Partial<KanbanColumn>) => void; onMoveCard?: (id: string, column: string, target: number) => void }) {
  const [column, setColumn] = useState<KanbanColumn>({ id: 'todo', title: 'Todo' }); const [card, setCard] = useState<KanbanCard>({ columnId: diagram.columns[0]?.id ?? '', id: 'task', metadata: {}, title: 'Task' }); useEffect(() => { setCard((current) => ({ ...current, columnId: diagram.columns.some((item) => item.id === current.columnId) ? current.columnId : diagram.columns[0]?.id ?? '' })); }, [diagram.columns]);
  return <aside className="canvas-semantic-editor" data-canvas-pan-exclusion="true" data-testid="kanban-editor-controls" style={{ ...SEMANTIC_PANEL_STYLE, bottom }}><strong>Kanban</strong><form onSubmit={(event) => { event.preventDefault(); onAddColumn?.(column); }}><input aria-label="New Kanban column id" onChange={(event) => setColumn((current) => ({ ...current, id: event.target.value }))} value={column.id} /><input aria-label="New Kanban column title" onChange={(event) => setColumn((current) => ({ ...current, title: event.target.value }))} value={column.title} /><button type="submit">Add column</button></form><form onSubmit={(event) => { event.preventDefault(); onAddCard?.(card); }}><select aria-label="New Kanban card column" onChange={(event) => setCard((current) => ({ ...current, columnId: event.target.value }))} value={card.columnId}>{diagram.columns.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><input aria-label="New Kanban card id" onChange={(event) => setCard((current) => ({ ...current, id: event.target.value }))} value={card.id} /><input aria-label="New Kanban card title" onChange={(event) => setCard((current) => ({ ...current, title: event.target.value }))} value={card.title} /><button type="submit">Add card</button></form>{diagram.columns.map((item) => <KanbanColumnForm column={item} key={item.id} onDelete={onDeleteColumn} onSave={onEditColumn} />)}{diagram.cards.map((item) => <KanbanCardForm card={item} cards={diagram.cards} columns={diagram.columns} key={item.id} onDelete={onDeleteCard} onMove={onMoveCard} onSave={onEditCard} />)}</aside>;
}
function KanbanColumnForm({ column, onDelete, onSave }: { column: KanbanColumn; onDelete?: (id: string) => void; onSave?: (id: string, value: Partial<KanbanColumn>) => void }) { const { draft, resetDraft, updateDraft } = useCanonicalDraft(column); return <form aria-label={`Kanban column ${column.id}`} onSubmit={(event) => { event.preventDefault(); onSave?.(column.id, draft); resetDraft(); }}><input aria-label={`Kanban column ${column.id} id`} onChange={(event) => updateDraft((current) => ({ ...current, id: event.target.value }))} value={draft.id} /><input aria-label={`Kanban column ${column.id} title`} onChange={(event) => updateDraft((current) => ({ ...current, title: event.target.value }))} value={draft.title} /><button type="submit">Save</button><button aria-label={`Delete Kanban column ${column.id}`} onClick={() => onDelete?.(column.id)} type="button">Delete</button></form>; }
function KanbanCardForm({ card, cards, columns, onDelete, onMove, onSave }: { card: KanbanCard; cards: KanbanCard[]; columns: KanbanColumn[]; onDelete?: (id: string) => void; onMove?: (id: string, column: string, target: number) => void; onSave?: (id: string, value: Partial<Omit<KanbanCard, 'columnId'>>) => void }) { const { draft, resetDraft, updateDraft } = useCanonicalDraft(card); const [metadataKey, setMetadataKey] = useState(''); const [metadataValue, setMetadataValue] = useState(''); const label = `Kanban card ${card.id}`; const addMetadata = () => { if (!metadataKey.trim()) return; updateDraft((current) => ({ ...current, metadata: { ...current.metadata, [metadataKey.trim()]: metadataValue } })); setMetadataKey(''); setMetadataValue(''); }; return <form aria-label={label} onSubmit={(event) => { event.preventDefault(); onSave?.(card.id, { id: draft.id, metadata: draft.metadata, title: draft.title }); resetDraft(); }}><select aria-label={`${label} column`} onChange={(event) => onMove?.(card.id, event.target.value, cards.filter((item) => item.columnId === event.target.value && item.id !== card.id).length)} value={card.columnId}>{columns.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}</select><input aria-label={`${label} id`} onChange={(event) => updateDraft((current) => ({ ...current, id: event.target.value }))} value={draft.id} /><input aria-label={`${label} title`} onChange={(event) => updateDraft((current) => ({ ...current, title: event.target.value }))} value={draft.title} />{Object.entries(draft.metadata).map(([key, value]) => <span key={key}><input aria-label={`${label} metadata ${key} key`} onChange={(event) => updateDraft((current) => { const metadata = { ...current.metadata }; delete metadata[key]; return { ...current, metadata: { ...metadata, [event.target.value]: value } }; })} value={key} /><input aria-label={`${label} metadata ${key} value`} onChange={(event) => updateDraft((current) => ({ ...current, metadata: { ...current.metadata, [key]: event.target.value } }))} value={value} /><button aria-label={`Delete ${label} metadata ${key}`} onClick={() => updateDraft((current) => { const metadata = { ...current.metadata }; delete metadata[key]; return { ...current, metadata }; })} type="button">×</button></span>)}<input aria-label={`${label} new metadata key`} onChange={(event) => setMetadataKey(event.target.value)} value={metadataKey} /><input aria-label={`${label} new metadata value`} onChange={(event) => setMetadataValue(event.target.value)} value={metadataValue} /><button aria-label={`Add ${label} metadata`} onClick={addMetadata} type="button">Add metadata</button><button type="submit">Save</button><button aria-label={`Delete Kanban card ${card.id}`} onClick={() => onDelete?.(card.id)} type="button">Delete</button></form>; }

function hierarchyPath(node: { ancestorLabels?: readonly string[]; label: string }): string { return [...(node.ancestorLabels ?? []), node.label].join(' / '); }
function hierarchyParentIndex<Node extends { ancestorLabels?: readonly string[]; label: string }>(nodes: readonly Node[], node: Node): number {
  const ancestors = node.ancestorLabels ?? []; const parentLabel = ancestors.at(-1); const parentAncestors = ancestors.slice(0, -1);
  return parentLabel === undefined ? -1 : nodes.findIndex((candidate) => candidate.label === parentLabel && (candidate.ancestorLabels ?? []).length === parentAncestors.length && (candidate.ancestorLabels ?? []).every((part, index) => part === parentAncestors[index]));
}
function isInvalidHierarchyParent<Node extends { ancestorLabels?: readonly string[]; label: string }>(nodes: readonly Node[], nodeIndex: number, candidateIndex: number): boolean {
  if (nodeIndex === candidateIndex) return true;
  const node = nodes[nodeIndex]; const candidate = nodes[candidateIndex]; if (!node || !candidate) return true;
  const nodePath = [...(node.ancestorLabels ?? []), node.label]; const candidateAncestors = candidate.ancestorLabels ?? [];
  return candidateAncestors.length >= nodePath.length && nodePath.every((part, index) => candidateAncestors[index] === part);
}
function isSafeHierarchyIdentity(identity: { occurrenceCount: number }): boolean { return identity.occurrenceCount === 1; }

function MindmapEditorControls({ bottom, diagram, maxHeight, onAdd, onDelete, onEdit, onMove, onReparent }: { bottom: number; diagram: MindmapDiagramSnapshot; maxHeight: number; onAdd?: (value: Omit<MindmapNode, 'parentLabel'>, parent?: MindmapNodeIdentity) => void; onDelete?: (identity: MindmapNodeIdentity) => void; onEdit?: (identity: MindmapNodeIdentity, value: Partial<Omit<MindmapNode, 'parentLabel'>>) => void; onMove?: (identity: MindmapNodeIdentity, direction: 'up' | 'down') => void; onReparent?: (identity: MindmapNodeIdentity, parent: MindmapNodeIdentity) => void }) {
  const [node, setNode] = useState<Omit<MindmapNode, 'parentLabel'>>({ classes: [], label: 'Node', shape: 'default' }); const [parentIndex, setParentIndex] = useState(0); useEffect(() => setParentIndex((current) => Math.min(current, Math.max(0, diagram.nodes.length - 1))), [diagram.nodes.length]); const parent = diagram.nodes[parentIndex]; const parentIdentity = parent ? getMindmapNodeIdentity(parent, diagram.nodes) : undefined; const canAdd = parentIdentity ? isSafeHierarchyIdentity(parentIdentity) : false;
  return <aside className="canvas-semantic-editor canvas-hierarchy-editor" data-canvas-pan-exclusion="true" data-testid="mindmap-editor-controls" style={{ ...SEMANTIC_PANEL_STYLE, bottom, maxHeight }}><strong>Mindmap</strong><form onSubmit={(event) => { event.preventDefault(); if (canAdd) onAdd?.(node, parentIdentity); }}><select aria-label="New Mindmap parent" onChange={(event) => setParentIndex(Number(event.target.value))} style={HIERARCHY_CONTROL_STYLE} value={parentIndex}>{diagram.nodes.map((item, index) => <option disabled={!isSafeHierarchyIdentity(getMindmapNodeIdentity(item, diagram.nodes))} key={`${index}:${hierarchyPath(item)}`} value={index}>{hierarchyPath(item)}</option>)}</select><input aria-label="New Mindmap label" onChange={(event) => setNode((current) => ({ ...current, label: event.target.value }))} value={node.label} /><MindmapFields prefix="New Mindmap" update={setNode} value={node} /><button disabled={!canAdd} style={HIERARCHY_CONTROL_STYLE} type="submit">Add node</button></form>{diagram.nodes.map((item, index) => <MindmapNodeForm index={index} key={`${index}:${item.id ?? item.label}:${hierarchyPath(item)}`} node={item} nodes={diagram.nodes} onDelete={onDelete} onEdit={onEdit} onMove={onMove} onReparent={onReparent} />)}</aside>;
}
function MindmapFields({ prefix, update, value }: { prefix: string; update: (value: (current: Omit<MindmapNode, 'parentLabel'>) => Omit<MindmapNode, 'parentLabel'>) => void; value: Omit<MindmapNode, 'parentLabel'> }) { return <><select aria-label={`${prefix} shape`} onChange={(event) => update((current) => ({ ...current, shape: event.target.value as MindmapNodeShape, ...(event.target.value === 'default' ? { id: undefined } : {}) }))} value={value.shape}>{['default', 'square', 'rounded', 'circle', 'bang', 'cloud', 'hexagon'].map((shape) => <option key={shape}>{shape}</option>)}</select>{value.shape !== 'default' ? <input aria-label={`${prefix} id`} onChange={(event) => update((current) => ({ ...current, id: event.target.value || undefined }))} value={value.id ?? ''} /> : null}<input aria-label={`${prefix} classes`} onChange={(event) => update((current) => ({ ...current, classes: event.target.value.split(/\s+/).filter(Boolean) }))} value={value.classes.join(' ')} /><input aria-label={`${prefix} icon`} onChange={(event) => update((current) => ({ ...current, icon: event.target.value || undefined }))} value={value.icon ?? ''} /></>; }
function MindmapNodeForm({ index, node, nodes, onDelete, onEdit, onMove, onReparent }: { index: number; node: MindmapNode; nodes: MindmapNode[]; onDelete?: (identity: MindmapNodeIdentity) => void; onEdit?: (identity: MindmapNodeIdentity, value: Partial<Omit<MindmapNode, 'parentLabel'>>) => void; onMove?: (identity: MindmapNodeIdentity, direction: 'up' | 'down') => void; onReparent?: (identity: MindmapNodeIdentity, parent: MindmapNodeIdentity) => void }) { const { draft, resetDraft, updateDraft } = useCanonicalDraft(node); const label = `Mindmap node ${node.label}`; const identity = getMindmapNodeIdentity(node, nodes); const safe = isSafeHierarchyIdentity(identity); const parentIndex = hierarchyParentIndex(nodes, node); return <form aria-label={label} onSubmit={(event) => { event.preventDefault(); if (safe) onEdit?.(identity, draft); resetDraft(); }}><input aria-label={`${label} label`} disabled={!safe} onChange={(event) => updateDraft((current) => ({ ...current, label: event.target.value }))} value={draft.label} /><MindmapFields prefix={label} update={updateDraft} value={draft} /><select aria-label={`${label} parent`} disabled={!safe || parentIndex < 0} onChange={(event) => { const candidate = Number(event.target.value); const parent = nodes[candidate]; const parentIdentity = parent ? getMindmapNodeIdentity(parent, nodes) : undefined; if (parentIdentity && safe && isSafeHierarchyIdentity(parentIdentity) && !isInvalidHierarchyParent(nodes, index, candidate)) onReparent?.(identity, parentIdentity); }} style={HIERARCHY_CONTROL_STYLE} value={parentIndex}><option value={-1}>Root node</option>{nodes.map((item, candidate) => <option disabled={isInvalidHierarchyParent(nodes, index, candidate) || !isSafeHierarchyIdentity(getMindmapNodeIdentity(item, nodes))} key={`${candidate}:${hierarchyPath(item)}`} value={candidate}>{hierarchyPath(item)}</option>)}</select><button disabled={!safe} style={HIERARCHY_CONTROL_STYLE} type="submit">Save</button><button aria-label={`Move Mindmap node ${node.label} up`} disabled={!safe} onClick={() => onMove?.(identity, 'up')} style={HIERARCHY_CONTROL_STYLE} type="button">↑</button><button aria-label={`Move Mindmap node ${node.label} down`} disabled={!safe} onClick={() => onMove?.(identity, 'down')} style={HIERARCHY_CONTROL_STYLE} type="button">↓</button>{node.parentLabel ? <button aria-label={`Delete Mindmap node ${node.label}`} disabled={!safe} onClick={() => onDelete?.(identity)} style={HIERARCHY_CONTROL_STYLE} type="button">Delete</button> : null}</form>; }

function TreeViewEditorControls({ bottom, diagram, maxHeight, onAdd, onDelete, onEdit, onMove, onReparent }: { bottom: number; diagram: TreeViewDiagramSnapshot; maxHeight: number; onAdd?: (value: Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'>, parent?: TreeViewNodeIdentity) => void; onDelete?: (identity: TreeViewNodeIdentity) => void; onEdit?: (identity: TreeViewNodeIdentity, value: Partial<Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'>>) => void; onMove?: (identity: TreeViewNodeIdentity, direction: 'up' | 'down') => void; onReparent?: (identity: TreeViewNodeIdentity, parent: TreeViewNodeIdentity) => void }) { const [node, setNode] = useState<Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'>>({ classes: [], directory: false, label: 'file.txt', quoted: false }); const [parentIndex, setParentIndex] = useState(0); useEffect(() => setParentIndex((current) => Math.min(current, Math.max(0, diagram.nodes.length - 1))), [diagram.nodes.length]); const parent = diagram.nodes[parentIndex]; const parentIdentity = parent ? getTreeViewNodeIdentity(parent, diagram.nodes) : undefined; const canAdd = parentIdentity ? isSafeHierarchyIdentity(parentIdentity) : false; return <aside className="canvas-semantic-editor canvas-hierarchy-editor" data-canvas-pan-exclusion="true" data-testid="treeview-editor-controls" style={{ ...SEMANTIC_PANEL_STYLE, bottom, maxHeight }}><strong>TreeView</strong><form onSubmit={(event) => { event.preventDefault(); if (canAdd) onAdd?.(node, parentIdentity); }}><select aria-label="New TreeView parent" onChange={(event) => setParentIndex(Number(event.target.value))} style={HIERARCHY_CONTROL_STYLE} value={parentIndex}>{diagram.nodes.map((item, index) => <option disabled={!isSafeHierarchyIdentity(getTreeViewNodeIdentity(item, diagram.nodes))} key={`${index}:${hierarchyPath(item)}`} value={index}>{hierarchyPath(item)}</option>)}</select><TreeViewFields prefix="New TreeView" update={setNode} value={node} /><button disabled={!canAdd} style={HIERARCHY_CONTROL_STYLE} type="submit">Add node</button></form>{diagram.nodes.map((item, index) => <TreeViewNodeForm index={index} key={`${index}:${hierarchyPath(item)}`} node={item} nodes={diagram.nodes} onDelete={onDelete} onEdit={onEdit} onMove={onMove} onReparent={onReparent} />)}</aside>; }
function TreeViewFields({ prefix, update, value }: { prefix: string; update: (value: (current: Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'>) => Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'>) => void; value: Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'> }) { return <><input aria-label={`${prefix} label`} onChange={(event) => update((current) => ({ ...current, label: event.target.value }))} value={value.label} /><label><input aria-label={`${prefix} directory`} checked={value.directory} onChange={(event) => update((current) => ({ ...current, directory: event.target.checked }))} type="checkbox" />Directory</label><label><input aria-label={`${prefix} quoted`} checked={value.quoted} onChange={(event) => update((current) => ({ ...current, quoted: event.target.checked }))} type="checkbox" />Quoted</label><input aria-label={`${prefix} description`} onChange={(event) => update((current) => ({ ...current, description: event.target.value || undefined }))} value={value.description ?? ''} /><input aria-label={`${prefix} classes`} onChange={(event) => update((current) => ({ ...current, classes: event.target.value.split(/\s+/).filter(Boolean) }))} value={value.classes.join(' ')} /><input aria-label={`${prefix} icon`} onChange={(event) => update((current) => ({ ...current, icon: event.target.value || undefined }))} value={value.icon ?? ''} /></>; }
function TreeViewNodeForm({ index, node, nodes, onDelete, onEdit, onMove, onReparent }: { index: number; node: TreeViewNode; nodes: TreeViewNode[]; onDelete?: (identity: TreeViewNodeIdentity) => void; onEdit?: (identity: TreeViewNodeIdentity, value: Partial<Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'>>) => void; onMove?: (identity: TreeViewNodeIdentity, direction: 'up' | 'down') => void; onReparent?: (identity: TreeViewNodeIdentity, parent: TreeViewNodeIdentity) => void }) { const { draft, resetDraft, updateDraft } = useCanonicalDraft(node); const label = `TreeView node ${node.label}`; const identity = getTreeViewNodeIdentity(node, nodes); const safe = isSafeHierarchyIdentity(identity); const parentIndex = hierarchyParentIndex(nodes, node); const editable = { classes: draft.classes, description: draft.description, directory: draft.directory, icon: draft.icon, label: draft.label, quoted: draft.quoted }; return <form aria-label={label} onSubmit={(event) => { event.preventDefault(); if (safe) onEdit?.(identity, editable); resetDraft(); }}><TreeViewFields prefix={label} update={(updater) => updateDraft((current) => ({ ...current, ...updater({ classes: current.classes, description: current.description, directory: current.directory, icon: current.icon, label: current.label, quoted: current.quoted }) }))} value={editable} /><select aria-label={`${label} parent`} disabled={!safe || parentIndex < 0} onChange={(event) => { const candidate = Number(event.target.value); const parent = nodes[candidate]; const parentIdentity = parent ? getTreeViewNodeIdentity(parent, nodes) : undefined; if (parentIdentity && safe && isSafeHierarchyIdentity(parentIdentity) && !isInvalidHierarchyParent(nodes, index, candidate)) onReparent?.(identity, parentIdentity); }} style={HIERARCHY_CONTROL_STYLE} value={parentIndex}><option value={-1}>Root node</option>{nodes.map((item, candidate) => <option disabled={isInvalidHierarchyParent(nodes, index, candidate) || !isSafeHierarchyIdentity(getTreeViewNodeIdentity(item, nodes))} key={`${candidate}:${hierarchyPath(item)}`} value={candidate}>{hierarchyPath(item)}</option>)}</select><button disabled={!safe} style={HIERARCHY_CONTROL_STYLE} type="submit">Save</button><button aria-label={`Move TreeView node ${node.label} up`} disabled={!safe} onClick={() => onMove?.(identity, 'up')} style={HIERARCHY_CONTROL_STYLE} type="button">↑</button><button aria-label={`Move TreeView node ${node.label} down`} disabled={!safe} onClick={() => onMove?.(identity, 'down')} style={HIERARCHY_CONTROL_STYLE} type="button">↓</button>{node.parentLabel ? <button aria-label={`Delete TreeView node ${node.label}`} disabled={!safe} onClick={() => onDelete?.(identity)} style={HIERARCHY_CONTROL_STYLE} type="button">Delete</button> : null}</form>; }

function IshikawaEditorControls({ bottom, diagram, maxHeight, onAdd, onDelete, onEdit, onEditEffect, onMove, onReparent }: { bottom: number; diagram: IshikawaDiagramSnapshot; maxHeight: number; onAdd?: (value: IshikawaCauseInput) => void; onDelete?: (identity: IshikawaCauseIdentity) => void; onEdit?: (identity: IshikawaCauseIdentity, value: Partial<Pick<IshikawaCause, 'label'>>) => void; onEditEffect?: (value: string) => void; onMove?: (identity: IshikawaCauseIdentity, direction: 'up' | 'down') => void; onReparent?: (identity: IshikawaCauseIdentity, parent: IshikawaCauseIdentity | null) => void }) { const [effect, setEffect] = useState(diagram.effect); const [cause, setCause] = useState('Cause'); const [parentIndex, setParentIndex] = useState(-1); useEffect(() => { setEffect(diagram.effect); setParentIndex((current) => Math.min(current, diagram.causes.length - 1)); }, [diagram.causes.length, diagram.effect]); const parent = parentIndex >= 0 ? diagram.causes[parentIndex] : undefined; const parentIdentity = parent ? getIshikawaCauseIdentity(parent, diagram.causes) : null; const canAdd = parentIdentity === null || isSafeHierarchyIdentity(parentIdentity); return <aside className="canvas-semantic-editor canvas-hierarchy-editor" data-canvas-pan-exclusion="true" data-testid="ishikawa-editor-controls" style={{ ...SEMANTIC_PANEL_STYLE, bottom, maxHeight }}><strong>Ishikawa</strong><form onSubmit={(event) => { event.preventDefault(); onEditEffect?.(effect); }}><input aria-label="Ishikawa effect" onChange={(event) => setEffect(event.target.value)} value={effect} /><button style={HIERARCHY_CONTROL_STYLE} type="submit">Save effect</button></form><form onSubmit={(event) => { event.preventDefault(); if (canAdd) onAdd?.({ label: cause, parent: parentIdentity }); }}><input aria-label="New Ishikawa cause" onChange={(event) => setCause(event.target.value)} value={cause} /><select aria-label="New Ishikawa parent" onChange={(event) => setParentIndex(Number(event.target.value))} style={HIERARCHY_CONTROL_STYLE} value={parentIndex}><option value={-1}>Root cause</option>{diagram.causes.map((item, index) => <option disabled={!isSafeHierarchyIdentity(getIshikawaCauseIdentity(item, diagram.causes))} key={`${index}:${hierarchyPath(item)}`} value={index}>{hierarchyPath(item)}</option>)}</select><button disabled={!canAdd} style={HIERARCHY_CONTROL_STYLE} type="submit">Add cause</button></form>{diagram.causes.map((item, index) => <IshikawaCauseForm cause={item} causes={diagram.causes} index={index} key={`${index}:${hierarchyPath(item)}`} onDelete={onDelete} onEdit={onEdit} onMove={onMove} onReparent={onReparent} />)}</aside>; }
function IshikawaCauseForm({ cause, causes, index, onDelete, onEdit, onMove, onReparent }: { cause: IshikawaCause; causes: IshikawaCause[]; index: number; onDelete?: (identity: IshikawaCauseIdentity) => void; onEdit?: (identity: IshikawaCauseIdentity, value: Partial<Pick<IshikawaCause, 'label'>>) => void; onMove?: (identity: IshikawaCauseIdentity, direction: 'up' | 'down') => void; onReparent?: (identity: IshikawaCauseIdentity, parent: IshikawaCauseIdentity | null) => void }) { const { draft, resetDraft, updateDraft } = useCanonicalDraft(cause); const label = `Ishikawa cause ${cause.label}`; const identity = getIshikawaCauseIdentity(cause, causes); const safe = isSafeHierarchyIdentity(identity); const parentIndex = hierarchyParentIndex(causes, cause); return <form aria-label={label} onSubmit={(event) => { event.preventDefault(); if (safe) onEdit?.(identity, { label: draft.label }); resetDraft(); }}><input aria-label={`${label} label`} disabled={!safe} onChange={(event) => updateDraft((current) => ({ ...current, label: event.target.value }))} value={draft.label} /><select aria-label={`${label} parent`} disabled={!safe} onChange={(event) => { const candidate = Number(event.target.value); const parent = candidate < 0 ? null : causes[candidate]; const parentIdentity = parent ? getIshikawaCauseIdentity(parent, causes) : null; if (safe && (parentIdentity === null || isSafeHierarchyIdentity(parentIdentity)) && (candidate < 0 || !isInvalidHierarchyParent(causes, index, candidate))) onReparent?.(identity, parentIdentity); }} style={HIERARCHY_CONTROL_STYLE} value={parentIndex}><option value={-1}>Root cause</option>{causes.map((item, candidate) => <option disabled={isInvalidHierarchyParent(causes, index, candidate) || !isSafeHierarchyIdentity(getIshikawaCauseIdentity(item, causes))} key={`${candidate}:${hierarchyPath(item)}`} value={candidate}>{hierarchyPath(item)}</option>)}</select><button disabled={!safe} style={HIERARCHY_CONTROL_STYLE} type="submit">Save</button><button aria-label={`Move Ishikawa cause ${cause.label} up`} disabled={!safe} onClick={() => onMove?.(identity, 'up')} style={HIERARCHY_CONTROL_STYLE} type="button">↑</button><button aria-label={`Move Ishikawa cause ${cause.label} down`} disabled={!safe} onClick={() => onMove?.(identity, 'down')} style={HIERARCHY_CONTROL_STYLE} type="button">↓</button><button aria-label={`Delete Ishikawa cause ${cause.label}`} disabled={!safe} onClick={() => onDelete?.(identity)} style={HIERARCHY_CONTROL_STYLE} type="button">Delete</button></form>; }

function railroadDialectLabel(notation: RailroadDiagramSnapshot['notation']): string {
  return notation === 'ir' ? 'IR' : notation.toUpperCase();
}

function createRailroadRuleDraft(notation: RailroadDiagramSnapshot['notation']): RailroadRule {
  return {
    definition: notation === 'ir' ? 'terminal("value")' : '"value"',
    name: 'production',
  };
}

function RailroadEditorControls({ bottom, diagram, maxHeight, onAdd, onDelete, onEdit, onMove, onRename }: {
  bottom: number;
  diagram: RailroadDiagramSnapshot;
  maxHeight: number;
  onAdd?: (value: RailroadRule) => void;
  onDelete?: (identity: RailroadRuleIdentity) => void;
  onEdit?: (identity: RailroadRuleIdentity, value: Partial<RailroadRule>) => void;
  onMove?: (identity: RailroadRuleIdentity, direction: 'up' | 'down') => void;
  onRename?: (identity: RailroadRuleIdentity, name: string) => void;
}) {
  const [rule, setRule] = useState<RailroadRule>(() => createRailroadRuleDraft(diagram.notation));
  useEffect(() => { setRule(createRailroadRuleDraft(diagram.notation)); }, [diagram.notation]);
  const dialect = railroadDialectLabel(diagram.notation);

  return <aside
    className="canvas-semantic-editor canvas-railroad-editor"
    data-canvas-pan-exclusion="true"
    data-testid="railroad-editor-controls"
    style={{ ...SEMANTIC_PANEL_STYLE, bottom, maxHeight }}
  >
    <strong>Railroad <small>{dialect} safe subset</small></strong>
    <form aria-label={`New Railroad ${dialect} production`} onSubmit={(event) => { event.preventDefault(); onAdd?.(rule); }} style={{ display: 'grid', gap: 4, marginTop: 5 }}>
      <input aria-label="New Railroad production name" onChange={(event) => setRule((current) => ({ ...current, name: event.target.value }))} style={HIERARCHY_CONTROL_STYLE} value={rule.name} />
      <textarea aria-label="New Railroad production expression" onChange={(event) => setRule((current) => ({ ...current, definition: event.target.value }))} style={HIERARCHY_CONTROL_STYLE} value={rule.definition} />
      <button style={HIERARCHY_CONTROL_STYLE} type="submit">Add production</button>
    </form>
    {diagram.rules.map((rule) => <RailroadRuleForm key={`${rule.name}:${rule.definition}`} notation={diagram.notation} onDelete={onDelete} onEdit={onEdit} onMove={onMove} onRename={onRename} rule={rule} rules={diagram.rules} />)}
  </aside>;
}

function RailroadRuleForm({ notation, onDelete, onEdit, onMove, onRename, rule, rules }: {
  notation: RailroadDiagramSnapshot['notation'];
  onDelete?: (identity: RailroadRuleIdentity) => void;
  onEdit?: (identity: RailroadRuleIdentity, value: Partial<RailroadRule>) => void;
  onMove?: (identity: RailroadRuleIdentity, direction: 'up' | 'down') => void;
  onRename?: (identity: RailroadRuleIdentity, name: string) => void;
  rule: RailroadRule;
  rules: RailroadRule[];
}) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(rule);
  const identity = getRailroadRuleIdentity(rule, rules, notation);
  const safe = identity.occurrenceCount === 1;
  const label = `Railroad production ${rule.name}`;
  const dialect = railroadDialectLabel(notation);

  return <form aria-label={label} onSubmit={(event) => {
    event.preventDefault();
    if (safe) onEdit?.(identity, { definition: draft.definition });
    resetDraft();
  }} style={{ display: 'grid', gap: 4, marginTop: 8 }}>
    <small>{dialect} production</small>
    <input aria-label={`${label} name`} disabled={!safe} onChange={(event) => updateDraft((current) => ({ ...current, name: event.target.value }))} style={HIERARCHY_CONTROL_STYLE} value={draft.name} />
    <textarea aria-label={`${label} expression`} disabled={!safe} onChange={(event) => updateDraft((current) => ({ ...current, definition: event.target.value }))} style={HIERARCHY_CONTROL_STYLE} value={draft.definition} />
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
      <button disabled={!safe} style={HIERARCHY_CONTROL_STYLE} type="submit">Save expression</button>
      <button aria-label={`Rename Railroad production ${rule.name}`} disabled={!safe} onClick={() => { onRename?.(identity, draft.name); resetDraft(); }} style={HIERARCHY_CONTROL_STYLE} type="button">Rename</button>
      <button aria-label={`Move Railroad production ${rule.name} up`} disabled={!safe} onClick={() => onMove?.(identity, 'up')} style={HIERARCHY_CONTROL_STYLE} type="button">↑</button>
      <button aria-label={`Move Railroad production ${rule.name} down`} disabled={!safe} onClick={() => onMove?.(identity, 'down')} style={HIERARCHY_CONTROL_STYLE} type="button">↓</button>
      <button aria-label={`Delete Railroad production ${rule.name}`} disabled={!safe} onClick={() => onDelete?.(identity)} style={HIERARCHY_CONTROL_STYLE} type="button">Delete</button>
    </div>
  </form>;
}

function SectionForm({ family, item, onDelete, onMove, onSave }: { family: string; item: { label: string }; onDelete?: (label: string) => void; onMove?: (label: string, direction: 'up' | 'down') => void; onSave?: (label: string, value: { label?: string }) => void }) { const { draft, resetDraft, updateDraft } = useCanonicalDraft(item); return <form aria-label={`${family} section ${item.label}`} onSubmit={(event) => { event.preventDefault(); onSave?.(item.label, draft); resetDraft(); }}><input aria-label={`${family} section ${item.label} label`} onChange={(event) => updateDraft((current) => ({ ...current, label: event.target.value }))} value={draft.label} /><button type="submit">Save</button><button aria-label={`Move ${family} section ${item.label} up`} onClick={() => onMove?.(item.label, 'up')} type="button">↑</button><button aria-label={`Move ${family} section ${item.label} down`} onClick={() => onMove?.(item.label, 'down')} type="button">↓</button><button aria-label={`Delete ${family} section ${item.label}`} onClick={() => onDelete?.(item.label)} type="button">Delete</button></form>; }

function ClassEditorControls({
  bottom, diagram, onAddAnnotation, onAddClass, onAddMember, onAddRelationship, onDeleteAnnotation, onDeleteClass,
  onDeleteMember, onDeleteRelationship, onEditClass, onEditMember, onEditRelationship,
}: {
  bottom: number; diagram: ClassDiagramSnapshot;
  onAddAnnotation?: (name: string, annotation: string) => void; onAddClass?: (name: string) => void;
  onAddMember?: (name: string, member: ClassMember) => void; onAddRelationship?: (relationship: ClassRelationship) => void;
  onDeleteAnnotation?: (name: string, annotation: string) => void; onDeleteClass?: (name: string) => void;
  onDeleteMember?: (name: string, identity: ClassMemberIdentity) => void; onDeleteRelationship?: (identity: ClassRelationshipIdentity) => void;
  onEditClass?: (name: string, patch: Partial<Pick<ClassEntity, 'name' | 'label'>>) => void;
  onEditMember?: (name: string, identity: ClassMemberIdentity, member: ClassMember) => void;
  onEditRelationship?: (identity: ClassRelationshipIdentity, relationship: ClassRelationship) => void;
}) {
  const [name, setName] = useState('Class');
  const [relationship, setRelationship] = useState<ClassRelationship>({ from: diagram.classes[0]?.name ?? '', relation: '-->', to: diagram.classes[1]?.name ?? diagram.classes[0]?.name ?? '' });
  useEffect(() => { setRelationship((current) => ({ ...current, from: diagram.classes.some((item) => item.name === current.from) ? current.from : diagram.classes[0]?.name ?? '', to: diagram.classes.some((item) => item.name === current.to) ? current.to : diagram.classes[1]?.name ?? diagram.classes[0]?.name ?? '' })); }, [diagram.classes]);
  return <aside className="canvas-semantic-editor canvas-class-editor" data-canvas-pan-exclusion="true" data-testid="class-editor-controls" style={{ ...SEMANTIC_PANEL_STYLE, bottom }}>
    <form onSubmit={(event) => { event.preventDefault(); onAddClass?.(name); setName('Class'); }} style={{ display: 'flex', gap: 6 }}>
      <strong style={{ fontSize: 12, whiteSpace: 'nowrap' }}>Classes</strong><input aria-label="New class" onChange={(event) => setName(event.target.value)} value={name} /><button aria-label="Add class" type="submit">Add</button>
    </form>
    {diagram.classes.map((item) => <ClassEntityForm entity={item} key={item.name} onAddAnnotation={onAddAnnotation} onAddMember={onAddMember} onDeleteAnnotation={onDeleteAnnotation} onDelete={onDeleteClass} onDeleteMember={onDeleteMember} onEdit={onEditClass} onEditMember={onEditMember} />)}
    <section aria-label="Class relationships" style={{ borderTop: '1px solid var(--line-subtle)', marginTop: 10, paddingTop: 8 }}>
      <strong style={{ fontSize: 12 }}>Relationships</strong>
      {diagram.relationships.map((item, index) => <ClassRelationshipForm classes={diagram.classes.map((entry) => entry.name)} key={`${index}:${item.from}:${item.to}:${item.relation}`} onDelete={() => onDeleteRelationship?.(getClassRelationshipIdentity(item, index, diagram.relationships))} onSave={(next) => onEditRelationship?.(getClassRelationshipIdentity(item, index, diagram.relationships), next)} relationship={item} />)}
      {diagram.classes.length > 0 ? <ClassRelationshipForm classes={diagram.classes.map((entry) => entry.name)} onSave={onAddRelationship} relationship={relationship} /> : <small>Add classes before relating them.</small>}
    </section>
  </aside>;
}

function ClassEntityForm({ entity, onAddAnnotation, onAddMember, onDeleteAnnotation, onDelete, onDeleteMember, onEdit, onEditMember }: {
  entity: ClassEntity; onAddAnnotation?: (name: string, annotation: string) => void; onAddMember?: (name: string, member: ClassMember) => void;
  onDeleteAnnotation?: (name: string, annotation: string) => void; onDelete?: (name: string) => void; onDeleteMember?: (name: string, identity: ClassMemberIdentity) => void;
  onEdit?: (name: string, patch: Partial<Pick<ClassEntity, 'name' | 'label'>>) => void; onEditMember?: (name: string, identity: ClassMemberIdentity, member: ClassMember) => void;
}) {
  const [id, setId] = useState(entity.name); const [label, setLabel] = useState(entity.label ?? entity.name); const [member, setMember] = useState('member'); const [annotation, setAnnotation] = useState('');
  return <section style={{ border: '1px solid var(--line-subtle)', borderRadius: 6, marginTop: 8, padding: 7 }}>
    <form onSubmit={(event) => { event.preventDefault(); onEdit?.(entity.name, { name: id, label }); }} style={{ display: 'flex', gap: 4 }}><input aria-label={`Class ${entity.name} id`} onChange={(event) => setId(event.target.value)} value={id} /><input aria-label={`Class ${entity.name} label`} onChange={(event) => setLabel(event.target.value)} value={label} /><button type="submit">Save</button><button aria-label={`Delete class ${entity.name}`} onClick={() => onDelete?.(entity.name)} type="button">Delete</button></form>
    {entity.members.map((item, index) => <ClassMemberForm className={entity.name} identity={getClassMemberIdentity(entity.name, item, index, entity.members)} key={`${index}:${item.name}`} member={item} onDelete={onDeleteMember} onSave={onEditMember} />)}
    <form onSubmit={(event) => { event.preventDefault(); onAddMember?.(entity.name, { name: member }); setMember('member'); }} style={{ display: 'flex', gap: 4, marginTop: 5 }}><input aria-label={`New member for ${entity.name}`} onChange={(event) => setMember(event.target.value)} value={member} /><button type="submit">Add member</button></form>
    {entity.annotations.map((item) => <div key={item}><span>{item}</span><button aria-label={`Delete annotation ${item}`} onClick={() => onDeleteAnnotation?.(entity.name, item)} type="button">×</button></div>)}
    <form onSubmit={(event) => { event.preventDefault(); if (annotation.trim()) onAddAnnotation?.(entity.name, annotation); setAnnotation(''); }} style={{ display: 'flex', gap: 4, marginTop: 5 }}><input aria-label={`New annotation for ${entity.name}`} onChange={(event) => setAnnotation(event.target.value)} value={annotation} /><button type="submit">Add annotation</button></form>
  </section>;
}

function ClassMemberForm({ className, identity, member, onDelete, onSave }: { className: string; identity: ClassMemberIdentity; member: ClassMember; onDelete?: (name: string, identity: ClassMemberIdentity) => void; onSave?: (name: string, identity: ClassMemberIdentity, member: ClassMember) => void }) {
  const [draft, setDraft] = useState(member);
  return <form aria-label={`Member ${member.name} on ${className}`} onSubmit={(event) => { event.preventDefault(); onSave?.(className, identity, draft); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}><input aria-label={`Name for ${member.name}`} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} value={draft.name} /><input aria-label={`Signature for ${member.name}`} onChange={(event) => setDraft((current) => ({ ...current, signature: event.target.value || undefined }))} placeholder="signature" value={draft.signature ?? ''} /><input aria-label={`Return type for ${member.name}`} onChange={(event) => setDraft((current) => ({ ...current, returnType: event.target.value || undefined }))} placeholder="return type" value={draft.returnType ?? ''} /><button type="submit">Save</button><button aria-label={`Delete member ${member.name}`} onClick={() => onDelete?.(className, identity)} type="button">Delete</button></form>;
}

function ClassRelationshipForm({ classes, onDelete, onSave, relationship }: { classes: string[]; onDelete?: () => void; onSave?: (relationship: ClassRelationship) => void; relationship: ClassRelationship }) {
  const [draft, setDraft] = useState(relationship);
  return <form aria-label={`Class relationship ${relationship.from} ${relationship.to}`} onSubmit={(event) => { event.preventDefault(); onSave?.(draft); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}><select aria-label="Class relationship source" onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} value={draft.from}>{classes.map((name) => <option key={name}>{name}</option>)}</select><select aria-label="Class relationship type" onChange={(event) => setDraft((current) => ({ ...current, relation: event.target.value as ClassRelationship['relation'] }))} value={draft.relation}>{CLASS_RELATION_OPTIONS.map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Class relationship target" onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} value={draft.to}>{classes.map((name) => <option key={name}>{name}</option>)}</select><input aria-label="Class relationship label" onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value || undefined }))} placeholder="label" value={draft.label ?? ''} /><button type="submit">{onDelete ? 'Save' : 'Add relationship'}</button>{onDelete ? <button aria-label="Delete class relationship" onClick={onDelete} type="button">Delete</button> : null}</form>;
}

function StateEditorControls({ bottom, diagram, onAddState, onAddTransition, onDeleteState, onDeleteTransition, onEditState, onEditTransition }: {
  bottom: number; diagram: StateDiagramSnapshot; onAddState?: (name: string) => void; onAddTransition?: (transition: StateTransition) => void;
  onDeleteState?: (id: string) => void; onDeleteTransition?: (identity: StateTransitionIdentity) => void; onEditState?: (id: string, patch: { id?: string; label?: string }) => void; onEditTransition?: (identity: StateTransitionIdentity, transition: StateTransition) => void;
}) {
  const editableStates = diagram.states.filter((state) => state.kind === 'state'); const [name, setName] = useState('State');
  const [transition, setTransition] = useState<StateTransition>({ from: editableStates[0]?.id ?? '[*]', to: editableStates[1]?.id ?? editableStates[0]?.id ?? 'State' });
  return <aside className="canvas-semantic-editor canvas-state-editor" data-canvas-pan-exclusion="true" data-testid="state-editor-controls" style={{ ...SEMANTIC_PANEL_STYLE, bottom }}>
    <form onSubmit={(event) => { event.preventDefault(); onAddState?.(name); setName('State'); }} style={{ display: 'flex', gap: 6 }}><strong style={{ fontSize: 12 }}>States</strong><input aria-label="New state" onChange={(event) => setName(event.target.value)} value={name} /><button aria-label="Add state" type="submit">Add</button></form>
    {editableStates.map((state) => <StateNodeForm key={state.id} onDelete={onDeleteState} onSave={onEditState} state={state} />)}
    <section aria-label="State transitions" style={{ borderTop: '1px solid var(--line-subtle)', marginTop: 10, paddingTop: 8 }}><strong style={{ fontSize: 12 }}>Transitions</strong>{diagram.transitions.map((item, index) => <StateTransitionForm key={`${index}:${item.from}:${item.to}:${item.label ?? ''}`} onDelete={() => onDeleteTransition?.(getStateTransitionIdentity(item, index, diagram.transitions))} onSave={(next) => onEditTransition?.(getStateTransitionIdentity(item, index, diagram.transitions), next)} states={diagram.states} transition={item} />)}<StateTransitionForm onSave={onAddTransition} states={diagram.states} transition={transition} /></section>
  </aside>;
}

function StateNodeForm({ onDelete, onSave, state }: { onDelete?: (id: string) => void; onSave?: (id: string, patch: { id?: string; label?: string }) => void; state: StateDiagramSnapshot['states'][number] }) {
  const [id, setId] = useState(state.id); const [label, setLabel] = useState(state.label ?? state.id);
  return <form aria-label={`State ${state.id}`} onSubmit={(event) => { event.preventDefault(); onSave?.(state.id, { id, label }); }} style={{ display: 'flex', gap: 4, marginTop: 5 }}><input aria-label={`State ${state.id} id`} onChange={(event) => setId(event.target.value)} value={id} /><input aria-label={`State ${state.id} label`} onChange={(event) => setLabel(event.target.value)} value={label} /><button type="submit">Save</button><button aria-label={`Delete state ${state.id}`} onClick={() => onDelete?.(state.id)} type="button">Delete</button></form>;
}

function StateTransitionForm({ onDelete, onSave, states, transition }: { onDelete?: () => void; onSave?: (transition: StateTransition) => void; states: readonly StateDiagramSnapshot['states'][number][]; transition: StateTransition }) {
  const [draft, setDraft] = useState(transition); const endpoints = [...new Set(states.map((state) => state.id))];
  return <form aria-label={`State transition ${transition.from} ${transition.to}`} onSubmit={(event) => { event.preventDefault(); onSave?.(draft); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}><select aria-label="State transition source" onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} value={draft.from}>{endpoints.map((id) => <option key={id}>{id}</option>)}</select><span>→</span><select aria-label="State transition target" onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} value={draft.to}>{endpoints.map((id) => <option key={id}>{id}</option>)}</select><input aria-label="State transition label" onChange={(event) => setDraft((current) => ({ ...current, label: event.target.value || undefined }))} placeholder="label" value={draft.label ?? ''} /><button type="submit">{onDelete ? 'Save' : 'Add transition'}</button>{onDelete ? <button aria-label="Delete state transition" onClick={onDelete} type="button">Delete</button> : null}</form>;
}

function RequirementEditorControls({ bottom, diagram, onAddRequirement, onAddRelationship, onDeleteRequirement, onDeleteRelationship, onEditRequirement, onEditRelationship }: {
  bottom: number; diagram: RequirementDiagramSnapshot; onAddRequirement?: (requirement: RequirementEntity) => void; onAddRelationship?: (relationship: RequirementRelationship) => void;
  onDeleteRequirement?: (name: string) => void; onDeleteRelationship?: (identity: RequirementRelationshipIdentity) => void; onEditRequirement?: (name: string, requirement: Partial<Pick<RequirementEntity, 'fields' | 'kind'>> & { name?: string }) => void; onEditRelationship?: (identity: RequirementRelationshipIdentity, relationship: RequirementRelationship) => void;
}) {
  const [name, setName] = useState('req'); const [kind, setKind] = useState<RequirementEntity['kind']>('requirement');
  const [relationship, setRelationship] = useState<RequirementRelationship>({ from: diagram.entities[0]?.name ?? '', kind: 'satisfies', to: diagram.entities[1]?.name ?? diagram.entities[0]?.name ?? '' });
  const nextRequirementId = Math.max(0, ...diagram.entities.map((entity) => Number.parseInt(entity.fields.id ?? '', 10)).filter(Number.isFinite)) + 1;
  return <aside className="canvas-semantic-editor canvas-requirement-editor" data-canvas-pan-exclusion="true" data-testid="requirement-editor-controls" style={{ ...SEMANTIC_PANEL_STYLE, bottom }}>
    <form onSubmit={(event) => { event.preventDefault(); onAddRequirement?.({ kind, name, fields: kind === 'element' ? { type: 'element' } : { id: String(nextRequirementId), text: 'Requirement', risk: 'low', verifyMethod: 'test' } }); setName('req'); }} style={{ display: 'flex', gap: 6 }}><strong style={{ fontSize: 12 }}>Requirements</strong><select aria-label="New requirement type" onChange={(event) => setKind(event.target.value as RequirementEntity['kind'])} value={kind}>{(['requirement', 'functionalRequirement', 'interfaceRequirement', 'performanceRequirement', 'physicalRequirement', 'designConstraint', 'element'] as const).map((value) => <option key={value}>{value}</option>)}</select><input aria-label="New requirement" onChange={(event) => setName(event.target.value)} value={name} /><button aria-label="Add requirement" type="submit">Add</button></form>
    {diagram.entities.map((item) => <RequirementEntityForm entity={item} key={item.name} onDelete={onDeleteRequirement} onSave={onEditRequirement} />)}
    <section aria-label="Requirement relationships" style={{ borderTop: '1px solid var(--line-subtle)', marginTop: 10, paddingTop: 8 }}><strong style={{ fontSize: 12 }}>Relationships</strong>{diagram.relationships.map((item, index) => <RequirementRelationshipForm entities={diagram.entities.map((entry) => entry.name)} key={`${index}:${item.from}:${item.kind}:${item.to}`} onDelete={() => onDeleteRelationship?.(getRequirementRelationshipIdentity(item, index, diagram.relationships))} onSave={(next) => onEditRelationship?.(getRequirementRelationshipIdentity(item, index, diagram.relationships), next)} relationship={item} />)}{diagram.entities.length > 0 ? <RequirementRelationshipForm entities={diagram.entities.map((entry) => entry.name)} onSave={onAddRelationship} relationship={relationship} /> : <small>Add requirements before relating them.</small>}</section>
  </aside>;
}

function RequirementEntityForm({ entity, onDelete, onSave }: { entity: RequirementEntity; onDelete?: (name: string) => void; onSave?: (name: string, entity: Partial<Pick<RequirementEntity, 'fields' | 'kind'>> & { name?: string }) => void }) {
  const [name, setName] = useState(entity.name); const [fields, setFields] = useState(() => Object.entries(entity.fields).map(([key, value]) => `${key}: ${value}`).join('\n'));
  return <form aria-label={`${entity.kind} ${entity.name}`} onSubmit={(event) => { event.preventDefault(); const nextFields = Object.fromEntries(fields.split('\n').map((line) => line.split(/:\s*/u, 2)).filter(([key]) => Boolean(key?.trim())).map(([key, value]) => [key.trim(), value?.trim() ?? ''])); onSave?.(entity.name, { name, fields: nextFields }); }} style={{ border: '1px solid var(--line-subtle)', borderRadius: 6, display: 'grid', gap: 4, marginTop: 8, padding: 7 }}><strong>{entity.kind}: {entity.name}</strong><input aria-label={`Requirement ${entity.name} id`} onChange={(event) => setName(event.target.value)} value={name} /><textarea aria-label={`Fields for ${entity.name}`} onChange={(event) => setFields(event.target.value)} value={fields} /><div><button type="submit">Save</button><button aria-label={`Delete requirement ${entity.name}`} onClick={() => onDelete?.(entity.name)} type="button">Delete</button></div></form>;
}

function RequirementRelationshipForm({ entities, onDelete, onSave, relationship }: { entities: string[]; onDelete?: () => void; onSave?: (relationship: RequirementRelationship) => void; relationship: RequirementRelationship }) {
  const [draft, setDraft] = useState(relationship);
  return <form aria-label={`Requirement relationship ${relationship.from} ${relationship.to}`} onSubmit={(event) => { event.preventDefault(); onSave?.(draft); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}><select aria-label="Requirement relationship source" onChange={(event) => setDraft((current) => ({ ...current, from: event.target.value }))} value={draft.from}>{entities.map((name) => <option key={name}>{name}</option>)}</select><select aria-label="Requirement relationship type" onChange={(event) => setDraft((current) => ({ ...current, kind: event.target.value as RequirementRelationship['kind'] }))} value={draft.kind}>{(['contains', 'copies', 'derives', 'satisfies', 'verifies', 'refines', 'traces'] as const).map((value) => <option key={value}>{value}</option>)}</select><select aria-label="Requirement relationship target" onChange={(event) => setDraft((current) => ({ ...current, to: event.target.value }))} value={draft.to}>{entities.map((name) => <option key={name}>{name}</option>)}</select><button type="submit">{onDelete ? 'Save' : 'Add relationship'}</button>{onDelete ? <button aria-label="Delete requirement relationship" onClick={onDelete} type="button">Delete</button> : null}</form>;
}

function useCanonicalDraft<T extends object>(canonical: T) {
  const canonicalRef = useRef(canonical);
  const [draft, setDraft] = useState(canonical);
  useEffect(() => {
    if (sameCanonicalDraft(canonicalRef.current, canonical)) return;
    const previousCanonical = canonicalRef.current;
    canonicalRef.current = canonical;
    setDraft((current) => {
      const next = reconcileCanonicalDraft(canonical, current, getDirtyDraftFields(current, previousCanonical));
      return sameCanonicalDraft(current, next) ? current : next;
    });
  }, [canonical]);
  const updateDraft = useCallback((update: (current: T) => T) => {
    setDraft((current) => update(current));
  }, []);
  const resetDraft = useCallback(() => {
    setDraft(canonicalRef.current);
  }, []);
  return { draft, resetDraft, updateDraft };
}

function C4EditorControls({
  bottom,
  diagram,
  onAddBoundary,
  onAddElement,
  onAddRelationship,
  onDeleteBoundary,
  onDeleteElement,
  onDeleteRelationship,
  onEditBoundary,
  onEditElement,
  onEditRelationship,
  placement,
}: {
  bottom: number;
  diagram: C4DiagramSnapshot;
  onAddBoundary?: (value: C4Boundary) => void;
  onAddElement?: (value: C4Element) => void;
  onAddRelationship?: (value: C4Relationship) => void;
  onDeleteBoundary?: (id: string) => void;
  onDeleteElement?: (id: string) => void;
  onDeleteRelationship?: (identity: C4RelationshipIdentity) => void;
  onEditBoundary?: (id: string, value: Partial<C4Boundary>) => void;
  onEditElement?: (id: string, value: Partial<C4Element>) => void;
  onEditRelationship?: (
    identity: C4RelationshipIdentity,
    value: Partial<C4Relationship>,
  ) => void;
  placement?: PairedSemanticPanelPlacement["editor"];
}) {
  const [element, setElement] = useState<C4Element>({
    id: "system",
    kind: "System",
    label: "System",
  });
  const [boundary, setBoundary] = useState<C4Boundary>({
    id: "boundary",
    kind: "Boundary",
    label: "Boundary",
  });
  const ids = diagram.elements.map((item) => item.id);
  const [relationship, setRelationship] = useState<C4Relationship>({
    from: ids[0] ?? "",
    to: ids[1] ?? ids[0] ?? "",
    label: "Uses",
  });
  return (
    <aside
      className="canvas-semantic-editor canvas-c4-editor"
      data-canvas-pan-exclusion="true"
      data-testid="c4-editor-controls"
      style={{
        ...SEMANTIC_PANEL_STYLE,
        ...placement,
        bottom: placement?.bottom ?? bottom,
        right: placement ? "auto" : 12,
      }}
    >
      <strong>
        C4 <small>experimental safe subset</small>
      </strong>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onAddElement?.(element);
        }}
        style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}
      >
        <select
          aria-label="New C4 element type"
          onChange={(event) =>
            setElement((current) => ({
              ...current,
              kind: event.target.value as C4Element["kind"],
            }))
          }
          value={element.kind}
        >
          {(
            [
              "Person",
              "Person_Ext",
              "System",
              "System_Ext",
              "SystemDb",
              "SystemDb_Ext",
              "Container",
              "Container_Ext",
              "ContainerDb",
              "ContainerDb_Ext",
              "Component",
              "Component_Ext",
              "ComponentDb",
              "ComponentDb_Ext",
            ] as const
          ).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <input
          aria-label="New C4 element id"
          onChange={(event) =>
            setElement((current) => ({ ...current, id: event.target.value }))
          }
          value={element.id}
        />
        <input
          aria-label="New C4 element label"
          onChange={(event) =>
            setElement((current) => ({ ...current, label: event.target.value }))
          }
          value={element.label}
        />
        <button type="submit">Add element</button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onAddBoundary?.(boundary);
        }}
        style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}
      >
        <select
          aria-label="New C4 boundary type"
          onChange={(event) =>
            setBoundary((current) => ({
              ...current,
              kind: event.target.value as C4Boundary["kind"],
            }))
          }
          value={boundary.kind}
        >
          {(
            [
              "Boundary",
              "Enterprise_Boundary",
              "System_Boundary",
              "Container_Boundary",
            ] as const
          ).map((value) => (
            <option key={value}>{value}</option>
          ))}
        </select>
        <input
          aria-label="New C4 boundary id"
          onChange={(event) =>
            setBoundary((current) => ({ ...current, id: event.target.value }))
          }
          value={boundary.id}
        />
        <input
          aria-label="New C4 boundary label"
          onChange={(event) =>
            setBoundary((current) => ({
              ...current,
              label: event.target.value,
            }))
          }
          value={boundary.label}
        />
        <button type="submit">Add boundary</button>
      </form>
      {diagram.elements.map((item) => (
        <C4ElementForm
          element={item}
          key={item.id}
          onDelete={onDeleteElement}
          onSave={onEditElement}
        />
      ))}
      {diagram.boundaries.map((item) => (
        <C4BoundaryForm
          boundary={item}
          key={item.id}
          onDelete={onDeleteBoundary}
          onSave={onEditBoundary}
        />
      ))}
      <section aria-label="C4 relationships">
        <strong>Relationships</strong>
        {diagram.relationships.map((item, index) => (
          <C4RelationshipForm
            ids={ids}
            key={`${index}:${item.from}:${item.to}:${item.label}`}
            onDelete={() =>
              onDeleteRelationship?.(
                getC4RelationshipIdentity(item, index, diagram.relationships),
              )
            }
            onSave={(value) =>
              onEditRelationship?.(
                getC4RelationshipIdentity(item, index, diagram.relationships),
                value,
              )
            }
            relationship={item}
          />
        ))}
        {ids.length ? (
          <C4RelationshipForm
            ids={ids}
            onSave={onAddRelationship}
            relationship={relationship}
          />
        ) : (
          <small>Add elements before relating them.</small>
        )}
      </section>
    </aside>
  );
}
function C4ElementForm({
  element,
  onDelete,
  onSave,
}: {
  element: C4Element;
  onDelete?: (id: string) => void;
  onSave?: (id: string, value: Partial<C4Element>) => void;
}) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(element);
  return (
    <form
      aria-label={`C4 element ${element.id}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave?.(element.id, draft);
        resetDraft();
      }}
      style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}
    >
      <span>{element.kind}</span>
      <input
        aria-label={`C4 element ${element.id} id`}
        onChange={(event) =>
          updateDraft((current) => ({ ...current, id: event.target.value }))
        }
        value={draft.id}
      />
      <input
        aria-label={`C4 element ${element.id} label`}
        onChange={(event) =>
          updateDraft((current) => ({ ...current, label: event.target.value }))
        }
        value={draft.label}
      />
      <input
        aria-label={`C4 element ${element.id} technology`}
        onChange={(event) =>
          updateDraft((current) => ({
            ...current,
            technology: event.target.value || undefined,
          }))
        }
        placeholder="technology"
        value={draft.technology ?? ""}
      />
      <input
        aria-label={`C4 element ${element.id} description`}
        onChange={(event) =>
          updateDraft((current) => ({
            ...current,
            description: event.target.value || undefined,
          }))
        }
        placeholder="description"
        value={draft.description ?? ""}
      />
      <button type="submit">Save</button>
      <button
        aria-label={`Delete C4 element ${element.id}`}
        onClick={() => onDelete?.(element.id)}
        type="button"
      >
        Delete
      </button>
    </form>
  );
}
function C4BoundaryForm({
  boundary,
  onDelete,
  onSave,
}: {
  boundary: C4Boundary;
  onDelete?: (id: string) => void;
  onSave?: (id: string, value: Partial<C4Boundary>) => void;
}) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(boundary);
  return (
    <form
      aria-label={`C4 boundary ${boundary.id}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave?.(boundary.id, draft);
        resetDraft();
      }}
      style={{ display: "flex", gap: 4, marginTop: 5 }}
    >
      <span>{boundary.kind}</span>
      <input
        aria-label={`C4 boundary ${boundary.id} id`}
        onChange={(event) =>
          updateDraft((current) => ({ ...current, id: event.target.value }))
        }
        value={draft.id}
      />
      <input
        aria-label={`C4 boundary ${boundary.id} label`}
        onChange={(event) =>
          updateDraft((current) => ({ ...current, label: event.target.value }))
        }
        value={draft.label}
      />
      <button type="submit">Save</button>
      <button
        aria-label={`Delete C4 boundary ${boundary.id}`}
        onClick={() => onDelete?.(boundary.id)}
        type="button"
      >
        Delete
      </button>
    </form>
  );
}
function C4RelationshipForm({
  ids,
  onDelete,
  onSave,
  relationship,
}: {
  ids: string[];
  onDelete?: () => void;
  onSave?: (value: C4Relationship) => void;
  relationship: C4Relationship;
}) {
  const [draft, setDraft] = useState(relationship);
  return (
    <form
      aria-label={`C4 relationship ${relationship.from} ${relationship.to}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave?.(draft);
      }}
      style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 5 }}
    >
      <select
        aria-label="C4 relationship source"
        onChange={(event) =>
          setDraft((current) => ({ ...current, from: event.target.value }))
        }
        value={draft.from}
      >
        {ids.map((id) => (
          <option key={id}>{id}</option>
        ))}
      </select>
      <select
        aria-label="C4 relationship target"
        onChange={(event) =>
          setDraft((current) => ({ ...current, to: event.target.value }))
        }
        value={draft.to}
      >
        {ids.map((id) => (
          <option key={id}>{id}</option>
        ))}
      </select>
      <input
        aria-label="C4 relationship label"
        onChange={(event) =>
          setDraft((current) => ({ ...current, label: event.target.value }))
        }
        value={draft.label}
      />
      <input
        aria-label="C4 relationship technology"
        onChange={(event) =>
          setDraft((current) => ({
            ...current,
            technology: event.target.value || undefined,
          }))
        }
        placeholder="technology"
        value={draft.technology ?? ""}
      />
      <button type="submit">{onDelete ? "Save" : "Add relationship"}</button>
      {onDelete ? (
        <button
          aria-label="Delete C4 relationship"
          onClick={onDelete}
          type="button"
        >
          Delete
        </button>
      ) : null}
    </form>
  );
}

function BlockEditorControls({
  bottom,
  diagram,
  onAddComposite,
  onAddLink,
  onAddNode,
  onDeleteComposite,
  onDeleteLink,
  onDeleteNode,
  onEditComposite,
  onEditLink,
  onEditNode,
  onSetColumns,
  placement,
}: {
  bottom: number;
  diagram: BlockDiagramSnapshot;
  onAddComposite?: (value: Partial<BlockComposite>) => void;
  onAddLink?: (value: BlockLink) => void;
  onAddNode?: (value: BlockNode) => void;
  onDeleteComposite?: (id: string) => void;
  onDeleteLink?: (identity: BlockLinkIdentity) => void;
  onDeleteNode?: (id: string) => void;
  onEditComposite?: (id: string, value: Partial<BlockComposite>) => void;
  onEditLink?: (identity: BlockLinkIdentity, value: Partial<BlockLink>) => void;
  onEditNode?: (id: string, value: Partial<BlockNode>) => void;
  onSetColumns?: (value: number) => void;
  placement?: PairedSemanticPanelPlacement["editor"];
}) {
  const [node, setNode] = useState<BlockNode>({
    id: "item",
    label: "Block",
    span: 1,
  });
  const [composite, setComposite] = useState<Partial<BlockComposite>>({
    id: "group",
    span: 1,
  });
  const ids = [...diagram.nodes, ...diagram.composites].map((item) => item.id);
  const [link, setLink] = useState<BlockLink>({
    from: ids[0] ?? "",
    to: ids[1] ?? ids[0] ?? "",
  });
  const [columns, setColumns] = useState(diagram.columns ?? 1);
  return (
    <aside
      className="canvas-semantic-editor canvas-block-editor"
      data-canvas-pan-exclusion="true"
      data-testid="block-editor-controls"
      style={{
        ...SEMANTIC_PANEL_STYLE,
        ...placement,
        bottom: placement?.bottom ?? bottom,
        right: placement ? "auto" : 12,
      }}
    >
      <strong>
        Block <small>beta safe subset</small>
      </strong>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onSetColumns?.(columns);
        }}
      >
        <label>
          columns{" "}
          <input
            aria-label="Block columns"
            min="1"
            onChange={(event) => setColumns(Number(event.target.value))}
            type="number"
            value={columns}
          />
        </label>
        <button type="submit">Set</button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onAddNode?.(node);
        }}
        style={{ display: "flex", gap: 4, marginTop: 5 }}
      >
        <input
          aria-label="New block id"
          onChange={(event) =>
            setNode((current) => ({ ...current, id: event.target.value }))
          }
          value={node.id}
        />
        <input
          aria-label="New block label"
          onChange={(event) =>
            setNode((current) => ({ ...current, label: event.target.value }))
          }
          value={node.label}
        />
        <input
          aria-label="New block span"
          min="1"
          onChange={(event) =>
            setNode((current) => ({
              ...current,
              span: Number(event.target.value),
            }))
          }
          type="number"
          value={node.span}
        />
        <button type="submit">Add block</button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onAddComposite?.(composite);
        }}
        style={{ display: "flex", gap: 4, marginTop: 5 }}
      >
        <input
          aria-label="New block composite id"
          onChange={(event) =>
            setComposite((current) => ({ ...current, id: event.target.value }))
          }
          value={composite.id ?? ""}
        />
        <button type="submit">Add composite</button>
      </form>
      {diagram.nodes.map((item) => (
        <BlockNodeForm
          item={item}
          key={item.id}
          onDelete={onDeleteNode}
          onSave={onEditNode}
        />
      ))}
      {diagram.composites.map((item) => (
        <BlockCompositeForm
          item={item}
          key={item.id}
          onDelete={onDeleteComposite}
          onSave={onEditComposite}
        />
      ))}
      <section aria-label="Block links">
        {diagram.links.map((item, index) => (
          <BlockLinkForm
            ids={ids}
            key={`${index}:${item.from}:${item.to}`}
            link={item}
            onDelete={() =>
              onDeleteLink?.(getBlockLinkIdentity(item, index, diagram.links))
            }
            onSave={(value) =>
              onEditLink?.(
                getBlockLinkIdentity(item, index, diagram.links),
                value,
              )
            }
          />
        ))}
        {ids.length ? (
          <BlockLinkForm ids={ids} link={link} onSave={onAddLink} />
        ) : null}
      </section>
    </aside>
  );
}
function BlockNodeForm({
  item,
  onDelete,
  onSave,
}: {
  item: BlockNode;
  onDelete?: (id: string) => void;
  onSave?: (id: string, value: Partial<BlockNode>) => void;
}) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(item);
  return (
    <form
      aria-label={`Block ${item.id}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave?.(item.id, draft);
        resetDraft();
      }}
      style={{ display: "flex", gap: 4, marginTop: 5 }}
    >
      <input
        aria-label={`Block ${item.id} id`}
        onChange={(event) =>
          updateDraft((current) => ({ ...current, id: event.target.value }))
        }
        value={draft.id}
      />
      <input
        aria-label={`Block ${item.id} label`}
        onChange={(event) =>
          updateDraft((current) => ({ ...current, label: event.target.value }))
        }
        value={draft.label}
      />
      <input
        aria-label={`Block ${item.id} span`}
        min="1"
        onChange={(event) =>
          updateDraft((current) => ({
            ...current,
            span: Number(event.target.value),
          }))
        }
        type="number"
        value={draft.span}
      />
      <button type="submit">Save</button>
      <button
        aria-label={`Delete block ${item.id}`}
        onClick={() => onDelete?.(item.id)}
        type="button"
      >
        Delete
      </button>
    </form>
  );
}
function BlockCompositeForm({
  item,
  onDelete,
  onSave,
}: {
  item: BlockComposite;
  onDelete?: (id: string) => void;
  onSave?: (id: string, value: Partial<BlockComposite>) => void;
}) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(item);
  return (
    <form
      aria-label={`Block composite ${item.id}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave?.(item.id, draft);
        resetDraft();
      }}
      style={{ display: "flex", gap: 4, marginTop: 5 }}
    >
      <span>group</span>
      <input
        aria-label={`Block composite ${item.id} id`}
        onChange={(event) =>
          updateDraft((current) => ({ ...current, id: event.target.value }))
        }
        value={draft.id}
      />
      <input
        aria-label={`Block composite ${item.id} span`}
        min="1"
        onChange={(event) =>
          updateDraft((current) => ({
            ...current,
            span: Number(event.target.value),
          }))
        }
        type="number"
        value={draft.span}
      />
      <input
        aria-label={`Block composite ${item.id} columns`}
        min="1"
        onChange={(event) =>
          updateDraft((current) => ({
            ...current,
            columns: Number(event.target.value),
          }))
        }
        type="number"
        value={draft.columns ?? 1}
      />
      <button type="submit">Save</button>
      <button
        aria-label={`Delete block composite ${item.id}`}
        onClick={() => onDelete?.(item.id)}
        type="button"
      >
        Delete
      </button>
    </form>
  );
}
function BlockLinkForm({
  ids,
  link,
  onDelete,
  onSave,
}: {
  ids: string[];
  link: BlockLink;
  onDelete?: () => void;
  onSave?: (value: BlockLink) => void;
}) {
  const [draft, setDraft] = useState(link);
  return (
    <form
      aria-label={`Block link ${link.from} ${link.to}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave?.(draft);
      }}
      style={{ display: "flex", gap: 4, marginTop: 5 }}
    >
      <select
        aria-label="Block link source"
        onChange={(event) =>
          setDraft((current) => ({ ...current, from: event.target.value }))
        }
        value={draft.from}
      >
        {ids.map((id) => (
          <option key={id}>{id}</option>
        ))}
      </select>
      <select
        aria-label="Block link target"
        onChange={(event) =>
          setDraft((current) => ({ ...current, to: event.target.value }))
        }
        value={draft.to}
      >
        {ids.map((id) => (
          <option key={id}>{id}</option>
        ))}
      </select>
      <button type="submit">{onDelete ? "Save" : "Add link"}</button>
      {onDelete ? (
        <button aria-label="Delete block link" onClick={onDelete} type="button">
          Delete
        </button>
      ) : null}
    </form>
  );
}

function SwimlaneEditorControls({
  bottom,
  diagram,
  onAddHandoff,
  onAddLane,
  onAddNode,
  onDeleteHandoff,
  onDeleteLane,
  onDeleteNode,
  onEditHandoff,
  onEditLane,
  onEditNode,
  onMoveNode,
}: {
  bottom: number;
  diagram: SwimlaneDiagramSnapshot;
  onAddHandoff?: (value: SwimlaneHandoff) => void;
  onAddLane?: (value: Swimlane) => void;
  onAddNode?: (value: SwimlaneNode) => void;
  onDeleteHandoff?: (identity: SwimlaneHandoffIdentity) => void;
  onDeleteLane?: (id: string) => void;
  onDeleteNode?: (id: string) => void;
  onEditHandoff?: (
    identity: SwimlaneHandoffIdentity,
    value: Partial<SwimlaneHandoff>,
  ) => void;
  onEditLane?: (id: string, value: Partial<Swimlane>) => void;
  onEditNode?: (
    id: string,
    value: Partial<Pick<SwimlaneNode, "id" | "label">>,
  ) => void;
  onMoveNode?: (id: string, laneId: string) => void;
}) {
  const [lane, setLane] = useState<Swimlane>({ id: "lane", label: "Lane" });
  const [node, setNode] = useState<SwimlaneNode>({
    id: "task",
    label: "Task",
    laneId: diagram.lanes[0]?.id ?? "",
  });
  const ids = diagram.nodes.map((item) => item.id);
  const [handoff, setHandoff] = useState<SwimlaneHandoff>({
    from: ids[0] ?? "",
    to: ids[1] ?? ids[0] ?? "",
  });
  return (
    <aside
      className="canvas-semantic-editor canvas-swimlane-editor"
      data-canvas-pan-exclusion="true"
      data-testid="swimlane-editor-controls"
      style={{ ...SEMANTIC_PANEL_STYLE, bottom }}
    >
      <strong>
        Swimlane <small>beta safe subset</small>
      </strong>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onAddLane?.(lane);
        }}
        style={{ display: "flex", gap: 4, marginTop: 5 }}
      >
        <input
          aria-label="New swimlane id"
          onChange={(event) =>
            setLane((current) => ({ ...current, id: event.target.value }))
          }
          value={lane.id}
        />
        <input
          aria-label="New swimlane label"
          onChange={(event) =>
            setLane((current) => ({ ...current, label: event.target.value }))
          }
          value={lane.label}
        />
        <button type="submit">Add lane</button>
      </form>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onAddNode?.(node);
        }}
        style={{ display: "flex", gap: 4, marginTop: 5 }}
      >
        <select
          aria-label="New swimlane node lane"
          onChange={(event) =>
            setNode((current) => ({ ...current, laneId: event.target.value }))
          }
          value={node.laneId}
        >
          {diagram.lanes.map((item) => (
            <option key={item.id}>{item.id}</option>
          ))}
        </select>
        <input
          aria-label="New swimlane node id"
          onChange={(event) =>
            setNode((current) => ({ ...current, id: event.target.value }))
          }
          value={node.id}
        />
        <input
          aria-label="New swimlane node label"
          onChange={(event) =>
            setNode((current) => ({ ...current, label: event.target.value }))
          }
          value={node.label}
        />
        <button type="submit">Add node</button>
      </form>
      {diagram.lanes.map((item) => (
        <SwimlaneForm
          item={item}
          key={item.id}
          onDelete={onDeleteLane}
          onSave={onEditLane}
        />
      ))}
      {diagram.nodes.map((item) => (
        <SwimlaneNodeForm
          item={item}
          key={item.id}
          lanes={diagram.lanes.map((laneItem) => laneItem.id)}
          onDelete={onDeleteNode}
          onMove={onMoveNode}
          onSave={onEditNode}
        />
      ))}
      <section aria-label="Swimlane handoffs">
        {diagram.handoffs.map((item, index) => (
          <SwimlaneHandoffForm
            ids={ids}
            item={item}
            key={`${index}:${item.from}:${item.to}:${item.label ?? ""}`}
            onDelete={() =>
              onDeleteHandoff?.(
                getSwimlaneHandoffIdentity(item, index, diagram.handoffs),
              )
            }
            onSave={(value) =>
              onEditHandoff?.(
                getSwimlaneHandoffIdentity(item, index, diagram.handoffs),
                value,
              )
            }
          />
        ))}
        {ids.length ? (
          <SwimlaneHandoffForm ids={ids} item={handoff} onSave={onAddHandoff} />
        ) : null}
      </section>
    </aside>
  );
}
function SwimlaneForm({
  item,
  onDelete,
  onSave,
}: {
  item: Swimlane;
  onDelete?: (id: string) => void;
  onSave?: (id: string, value: Partial<Swimlane>) => void;
}) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(item);
  return (
    <form
      aria-label={`Swimlane ${item.id}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave?.(item.id, draft);
        resetDraft();
      }}
      style={{ display: "flex", gap: 4, marginTop: 5 }}
    >
      <input
        aria-label={`Swimlane ${item.id} id`}
        onChange={(event) =>
          updateDraft((current) => ({ ...current, id: event.target.value }))
        }
        value={draft.id}
      />
      <input
        aria-label={`Swimlane ${item.id} label`}
        onChange={(event) =>
          updateDraft((current) => ({ ...current, label: event.target.value }))
        }
        value={draft.label}
      />
      <button type="submit">Save</button>
      <button
        aria-label={`Delete swimlane ${item.id}`}
        onClick={() => onDelete?.(item.id)}
        type="button"
      >
        Delete
      </button>
    </form>
  );
}
function SwimlaneNodeForm({
  item,
  lanes,
  onDelete,
  onMove,
  onSave,
}: {
  item: SwimlaneNode;
  lanes: string[];
  onDelete?: (id: string) => void;
  onMove?: (id: string, laneId: string) => void;
  onSave?: (
    id: string,
    value: Partial<Pick<SwimlaneNode, "id" | "label">>,
  ) => void;
}) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(item);
  return (
    <form
      aria-label={`Swimlane node ${item.id}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave?.(item.id, draft);
        resetDraft();
      }}
      style={{ display: "flex", gap: 4, marginTop: 5 }}
    >
      <input
        aria-label={`Swimlane node ${item.id} id`}
        onChange={(event) =>
          updateDraft((current) => ({ ...current, id: event.target.value }))
        }
        value={draft.id}
      />
      <input
        aria-label={`Swimlane node ${item.id} label`}
        onChange={(event) =>
          updateDraft((current) => ({ ...current, label: event.target.value }))
        }
        value={draft.label}
      />
      <select
        aria-label={`Swimlane node ${item.id} lane`}
        onChange={(event) => onMove?.(item.id, event.target.value)}
        value={item.laneId}
      >
        {lanes.map((id) => (
          <option key={id}>{id}</option>
        ))}
      </select>
      <button type="submit">Save</button>
      <button
        aria-label={`Delete swimlane node ${item.id}`}
        onClick={() => onDelete?.(item.id)}
        type="button"
      >
        Delete
      </button>
    </form>
  );
}
function SwimlaneHandoffForm({
  ids,
  item,
  onDelete,
  onSave,
}: {
  ids: string[];
  item: SwimlaneHandoff;
  onDelete?: () => void;
  onSave?: (value: SwimlaneHandoff) => void;
}) {
  const [draft, setDraft] = useState(item);
  return (
    <form
      aria-label={`Swimlane handoff ${item.from} ${item.to}`}
      onSubmit={(event) => {
        event.preventDefault();
        onSave?.(draft);
      }}
      style={{ display: "flex", gap: 4, marginTop: 5 }}
    >
      <select
        aria-label="Swimlane handoff source"
        onChange={(event) =>
          setDraft((current) => ({ ...current, from: event.target.value }))
        }
        value={draft.from}
      >
        {ids.map((id) => (
          <option key={id}>{id}</option>
        ))}
      </select>
      <select
        aria-label="Swimlane handoff target"
        onChange={(event) =>
          setDraft((current) => ({ ...current, to: event.target.value }))
        }
        value={draft.to}
      >
        {ids.map((id) => (
          <option key={id}>{id}</option>
        ))}
      </select>
      <input
        aria-label="Swimlane handoff label"
        onChange={(event) =>
          setDraft((current) => ({
            ...current,
            label: event.target.value || undefined,
          }))
        }
        placeholder="label"
        value={draft.label ?? ""}
      />
      <button type="submit">{onDelete ? "Save" : "Add handoff"}</button>
      {onDelete ? (
        <button
          aria-label="Delete swimlane handoff"
          onClick={onDelete}
          type="button"
        >
          Delete
        </button>
      ) : null}
    </form>
  );
}

function C4ContainmentControls({
  bottom,
  boundaries,
  elements,
  onMoveBoundary,
  onMoveElement,
  placement,
}: {
  bottom: number;
  boundaries: C4Boundary[];
  elements: C4Element[];
  onMoveBoundary?: (id: string, parentId: string | null) => void;
  onMoveElement?: (id: string, parentId: string | null) => void;
  placement?: PairedSemanticPanelPlacement["containment"];
}) {
  return (
    <aside
      data-canvas-pan-exclusion="true"
      data-testid="c4-containment-controls"
      style={{
        ...SEMANTIC_PANEL_STYLE,
        ...placement,
        bottom: placement?.bottom ?? bottom,
        left: placement?.left ?? 12,
        right: "auto",
      }}
    >
      <strong>C4 containment</strong>
      {elements.map((element) => (
        <label key={element.id}>
          {element.id}
          <select
            aria-label={`C4 element ${element.id} boundary`}
            onChange={(event) =>
              onMoveElement?.(element.id, event.target.value || null)
            }
            value={element.parentId ?? ""}
          >
            <option value="">top level</option>
            {boundaries.map(({ id }) => (
              <option key={id}>{id}</option>
            ))}
          </select>
        </label>
      ))}
      {boundaries.map((boundary) => (
        <label key={boundary.id}>
          {boundary.id}
          <select
            aria-label={`C4 boundary ${boundary.id} parent`}
            onChange={(event) =>
              onMoveBoundary?.(boundary.id, event.target.value || null)
            }
            value={boundary.parentId ?? ""}
          >
            <option value="">top level</option>
            {boundaries
              .filter(({ id }) => id !== boundary.id)
              .map(({ id }) => (
                <option key={id}>{id}</option>
              ))}
          </select>
        </label>
      ))}
    </aside>
  );
}

function BlockContainmentControls({ bottom, composites, nodes, onMoveComposite, onMoveNode, placement }: {
  bottom: number;
  composites: BlockComposite[];
  nodes: BlockNode[];
  onMoveComposite?: (id: string, parentId: string | null) => void;
  onMoveNode?: (id: string, parentId: string | null) => void;
  placement?: PairedSemanticPanelPlacement['containment'];
}) {
  return <aside data-canvas-pan-exclusion="true" data-testid="block-containment-controls" style={{ ...SEMANTIC_PANEL_STYLE, ...placement, bottom: placement?.bottom ?? bottom, left: placement?.left ?? 12, right: 'auto' }}>
    <strong>Block containment</strong>
    {nodes.map((node) => <label key={node.id}>{node.id}<select aria-label={`Block ${node.id} composite`} onChange={(event) => onMoveNode?.(node.id, event.target.value || null)} value={node.parentId ?? ''}><option value="">top level</option>{composites.map(({ id }) => <option key={id}>{id}</option>)}</select></label>)}
    {composites.map((composite) => <label key={composite.id}>{composite.id}<select aria-label={`Block composite ${composite.id} parent`} onChange={(event) => onMoveComposite?.(composite.id, event.target.value || null)} value={composite.parentId ?? ''}><option value="">top level</option>{composites.filter(({ id }) => id !== composite.id).map(({ id }) => <option key={id}>{id}</option>)}</select></label>)}
  </aside>;
}

function ArchitectureEditorControls({ bottom, diagram, onAddAlignment, onAddEdge, onAddGroup, onAddJunction, onAddService, onDeleteAlignment, onDeleteEdge, onDeleteGroup, onDeleteJunction, onDeleteService, onEditAlignment, onEditEdge, onEditGroup, onEditJunction, onEditService }: {
  bottom: number; diagram: ArchitectureDiagramSnapshot;
  onAddAlignment?: (value: ArchitectureAlignment) => void; onAddEdge?: (value: ArchitectureEdge) => void; onAddGroup?: (value: ArchitectureGroup) => void; onAddJunction?: (value: ArchitectureJunction) => void; onAddService?: (value: ArchitectureService) => void;
  onDeleteAlignment?: (value: ArchitectureAlignmentIdentity) => void; onDeleteEdge?: (value: ArchitectureEdgeIdentity) => void; onDeleteGroup?: (id: string) => void; onDeleteJunction?: (id: string) => void; onDeleteService?: (id: string) => void;
  onEditAlignment?: (identity: ArchitectureAlignmentIdentity, value: ArchitectureAlignment) => void; onEditEdge?: (identity: ArchitectureEdgeIdentity, value: ArchitectureEdge) => void; onEditGroup?: (id: string, value: Partial<ArchitectureGroup> & { id?: string }) => void; onEditJunction?: (id: string, value: Partial<ArchitectureJunction> & { id?: string }) => void; onEditService?: (id: string, value: Partial<ArchitectureService> & { id?: string }) => void;
}) {
  const [kind, setKind] = useState('service'); const [id, setId] = useState('service');
  const ids = [...diagram.groups, ...diagram.services, ...diagram.junctions].map((item) => item.id);
  const [edge, setEdge] = useState<ArchitectureEdge>({ from: ids[0] ?? '', fromGroup: diagram.groups.some((item) => item.id === ids[0]), fromInto: false, fromPort: 'R', to: ids[1] ?? ids[0] ?? '', toGroup: diagram.groups.some((item) => item.id === (ids[1] ?? ids[0])), toInto: true, toPort: 'L' });
  const [alignment, setAlignment] = useState<ArchitectureAlignment>({ direction: 'row', members: ids.slice(0, 2) });
  const add = () => { if (kind === 'group') onAddGroup?.({ icon: 'cloud', id, title: id }); else if (kind === 'junction') onAddJunction?.({ id }); else onAddService?.({ icon: 'server', id, title: id }); };
  return <aside className="canvas-semantic-editor canvas-architecture-editor" data-canvas-pan-exclusion="true" data-testid="architecture-editor-controls" style={{ ...SEMANTIC_PANEL_STYLE, bottom }}>
    <form onSubmit={(event) => { event.preventDefault(); add(); }}><strong>Architecture</strong><select aria-label="New architecture item type" onChange={(event) => setKind(event.target.value)} value={kind}><option>service</option><option>group</option><option>junction</option></select><input aria-label="New architecture item" onChange={(event) => setId(event.target.value)} value={id} /><button type="submit">Add</button></form>
    {diagram.groups.map((item) => <ArchitectureGroupEditor group={item} groups={diagram.groups.map((group) => group.id)} key={item.id} onDelete={onDeleteGroup} onSave={onEditGroup} />)}
    {diagram.services.map((item) => <ArchitectureServiceEditor groups={diagram.groups.map((group) => group.id)} key={item.id} onDelete={onDeleteService} onSave={onEditService} service={item} />)}
    {diagram.junctions.map((item) => <ArchitectureJunctionEditor groups={diagram.groups.map((group) => group.id)} junction={item} key={item.id} onDelete={onDeleteJunction} onSave={onEditJunction} />)}
    <section aria-label="Architecture edges"><strong>Edges</strong>{diagram.edges.map((item) => <ArchitectureEdgeEditor edge={item} groups={new Set(diagram.groups.map((group) => group.id))} ids={ids} key={[item.from, item.fromPort, item.to, item.toPort].join(':')} onDelete={() => onDeleteEdge?.(getArchitectureEdgeIdentity(item, diagram.edges))} onSave={(value) => onEditEdge?.(getArchitectureEdgeIdentity(item, diagram.edges), value)} />)}{ids.length > 1 ? <ArchitectureEdgeEditor edge={edge} groups={new Set(diagram.groups.map((group) => group.id))} ids={ids} onSave={onAddEdge} /> : null}</section>
    <section aria-label="Architecture alignments"><strong>Alignment</strong>{diagram.alignments.map((item) => <ArchitectureAlignmentEditor alignment={item} key={[item.direction, ...item.members].join(':')} onDelete={() => onDeleteAlignment?.(getArchitectureAlignmentIdentity(item, diagram.alignments))} onSave={(value) => onEditAlignment?.(getArchitectureAlignmentIdentity(item, diagram.alignments), value)} />)}{ids.length > 1 ? <ArchitectureAlignmentEditor alignment={alignment} onSave={onAddAlignment} /> : null}</section>
  </aside>;
}

function ArchitectureGroupEditor({ group, groups, onDelete, onSave }: { group: ArchitectureGroup; groups: string[]; onDelete?: (id: string) => void; onSave?: (id: string, patch: Partial<ArchitectureGroup> & { id?: string }) => void }) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(group);
  return <form aria-label={`Architecture group ${group.id} editor`} onSubmit={(event) => { event.preventDefault(); onSave?.(group.id, draft); resetDraft(); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}><span>group</span><input aria-label={`Architecture group ${group.id} id`} onChange={(event) => updateDraft((current) => ({ ...current, id: event.target.value }))} value={draft.id} /><input aria-label={`Architecture group ${group.id} title`} onChange={(event) => updateDraft((current) => ({ ...current, title: event.target.value || undefined }))} value={draft.title ?? ''} /><input aria-label={`Architecture group ${group.id} icon`} onChange={(event) => updateDraft((current) => ({ ...current, icon: event.target.value || undefined }))} value={draft.icon ?? ''} /><select aria-label={`Architecture group ${group.id} parent`} onChange={(event) => updateDraft((current) => ({ ...current, parentId: event.target.value || undefined }))} value={draft.parentId ?? ''}><option value="">top level</option>{groups.filter((id) => id !== group.id).map((id) => <option key={id}>{id}</option>)}</select><button type="submit">Save</button><button aria-label={`Delete architecture group ${group.id}`} onClick={() => onDelete?.(group.id)} type="button">Delete</button></form>;
}

function ArchitectureServiceEditor({ groups, onDelete, onSave, service }: { groups: string[]; onDelete?: (id: string) => void; onSave?: (id: string, patch: Partial<ArchitectureService> & { id?: string }) => void; service: ArchitectureService }) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(service);
  return <form aria-label={`Architecture service ${service.id} editor`} onSubmit={(event) => { event.preventDefault(); onSave?.(service.id, draft); resetDraft(); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}><span>service</span><input aria-label={`Architecture service ${service.id} id`} onChange={(event) => updateDraft((current) => ({ ...current, id: event.target.value }))} value={draft.id} /><input aria-label={`Architecture service ${service.id} title`} onChange={(event) => updateDraft((current) => ({ ...current, title: event.target.value || undefined }))} value={draft.title ?? ''} /><input aria-label={`Architecture service ${service.id} icon`} onChange={(event) => updateDraft((current) => ({ ...current, icon: event.target.value || undefined }))} value={draft.icon ?? ''} /><select aria-label={`Architecture service ${service.id} parent`} onChange={(event) => updateDraft((current) => ({ ...current, parentId: event.target.value || undefined }))} value={draft.parentId ?? ''}><option value="">top level</option>{groups.map((id) => <option key={id}>{id}</option>)}</select><button type="submit">Save</button><button aria-label={`Delete architecture service ${service.id}`} onClick={() => onDelete?.(service.id)} type="button">Delete</button></form>;
}

function ArchitectureJunctionEditor({ groups, junction, onDelete, onSave }: { groups: string[]; junction: ArchitectureJunction; onDelete?: (id: string) => void; onSave?: (id: string, patch: Partial<ArchitectureJunction> & { id?: string }) => void }) {
  const { draft, resetDraft, updateDraft } = useCanonicalDraft(junction);
  return <form aria-label={`Architecture junction ${junction.id} editor`} onSubmit={(event) => { event.preventDefault(); onSave?.(junction.id, draft); resetDraft(); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}><span>junction</span><input aria-label={`Architecture junction ${junction.id} id`} onChange={(event) => updateDraft((current) => ({ ...current, id: event.target.value }))} value={draft.id} /><select aria-label={`Architecture junction ${junction.id} parent`} onChange={(event) => updateDraft((current) => ({ ...current, parentId: event.target.value || undefined }))} value={draft.parentId ?? ''}><option value="">top level</option>{groups.map((id) => <option key={id}>{id}</option>)}</select><button type="submit">Save</button><button aria-label={`Delete architecture junction ${junction.id}`} onClick={() => onDelete?.(junction.id)} type="button">Delete</button></form>;
}

function ArchitectureEdgeEditor({ edge, groups, ids, onDelete, onSave }: { edge: ArchitectureEdge; groups: ReadonlySet<string>; ids: string[]; onDelete?: () => void; onSave?: (value: ArchitectureEdge) => void }) {
  const [draft, setDraft] = useState(edge);
  const update = (side: 'from' | 'to', id: string) => setDraft((current) => side === 'from' ? { ...current, from: id, fromGroup: groups.has(id) } : { ...current, to: id, toGroup: groups.has(id) });
  const signature = onDelete ? `${edge.from}:${edge.fromPort}:${edge.to}:${edge.toPort}` : 'new';
  return <form aria-label={`Architecture edge ${signature} editor`} onSubmit={(event) => { event.preventDefault(); onSave?.(draft); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}><select aria-label={`Architecture edge ${signature} source`} onChange={(event) => update('from', event.target.value)} value={draft.from}>{ids.map((id) => <option key={id}>{id}</option>)}</select><select aria-label={`Architecture edge ${signature} source port`} onChange={(event) => setDraft((current) => ({ ...current, fromPort: event.target.value as ArchitecturePort }))} value={draft.fromPort}>{(['L', 'R', 'T', 'B'] as const).map((port) => <option key={port}>{port}</option>)}</select><label><input checked={draft.fromInto} onChange={(event) => setDraft((current) => ({ ...current, fromInto: event.target.checked }))} type="checkbox" />into source</label><label><input checked={draft.toInto} onChange={(event) => setDraft((current) => ({ ...current, toInto: event.target.checked }))} type="checkbox" />into target</label><select aria-label={`Architecture edge ${signature} target port`} onChange={(event) => setDraft((current) => ({ ...current, toPort: event.target.value as ArchitecturePort }))} value={draft.toPort}>{(['L', 'R', 'T', 'B'] as const).map((port) => <option key={port}>{port}</option>)}</select><select aria-label={`Architecture edge ${signature} target`} onChange={(event) => update('to', event.target.value)} value={draft.to}>{ids.map((id) => <option key={id}>{id}</option>)}</select><button type="submit">{onDelete ? 'Save' : 'Add edge'}</button>{onDelete ? <button aria-label={`Delete architecture edge ${signature}`} onClick={onDelete} type="button">Delete</button> : null}</form>;
}

function ArchitectureAlignmentEditor({ alignment, onDelete, onSave }: { alignment: ArchitectureAlignment; onDelete?: () => void; onSave?: (value: ArchitectureAlignment) => void }) {
  const [direction, setDirection] = useState(alignment.direction); const [members, setMembers] = useState(alignment.members.join(', '));
  const signature = onDelete ? `${alignment.direction}:${alignment.members.join(':')}` : 'new';
  return <form aria-label={`Architecture alignment ${signature} editor`} onSubmit={(event) => { event.preventDefault(); onSave?.({ direction, members: members.split(',').map((value) => value.trim()).filter(Boolean) }); }} style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 5 }}><select aria-label={`Architecture alignment ${signature} direction`} onChange={(event) => setDirection(event.target.value as ArchitectureAlignment['direction'])} value={direction}><option value="row">row</option><option value="column">column</option></select><input aria-label={`Architecture alignment ${signature} members`} onChange={(event) => setMembers(event.target.value)} value={members} /><button type="submit">{onDelete ? 'Save' : 'Add alignment'}</button>{onDelete ? <button aria-label={`Delete architecture alignment ${signature}`} onClick={onDelete} type="button">Delete</button> : null}</form>;
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
