'use client';

import type { ActivityEvent, AwarenessState, CanvasAwarenessState, CanvasInkPreviewState, CanvasLaserState, CanvasPresenceEntry, CanvasWorldPoint, DiagramRevision, DiagramRevisionSummary, ListDiagramHistoryOutput, Participant, StarterTemplateId } from '@arielcharts/shared';
import { APP_NAME, CHOOSER_STARTER_TEMPLATES, getStarterTemplate } from '@arielcharts/shared';
import { basicSetup } from 'codemirror';
import mermaid from 'mermaid';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { Check, KeyRound, Share2 } from 'lucide-react';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { DiagramCanvas, type CanvasCameraState } from './diagram-canvas';
import { PresenterControls } from './presenter-controls';
import { useTheme } from './theme-provider';
import { WorkspaceFlyouts } from './workspace-flyouts';
import { getCompactCollaboratorOverflowCount, WorkspaceFooter } from './workspace-footer';
import { WorkspaceSettings } from './workspace-settings';
import { WorkspaceExportMenu } from './workspace-export-menu';
import { WorkspaceTabStrip, type WorkspaceDiagramTab } from './workspace-tab-strip';
import {
  canShowWorkspaceOnboarding,
  dismissWorkspaceOnboarding,
  getWorkspaceCanvasGuidance,
  isWorkspaceOnboardingDismissed,
  shouldDismissWorkspaceOnboardingForContent,
  WorkspaceOnboarding,
} from './workspace-onboarding';
import {
  MutationQueue,
  applyDiff,
  getHeaderOnlyFlowchartSnapshot,
  isHeaderOnlyFlowchartSource,
  getPastedClipboardPositions,
  observeMutationFailure,
  parseFlowchartSnapshot,
  type DiagramClipboardPayload,
  type DiagramClipboardPoint,
  type DiagramLinkType,
  type DiagramNodeShape,
  type FlowchartSnapshot,
  type MutationResult,
} from '../lib/diagram-mutations';
import {
  readNodePositions,
  writeNodePositions,
  type DiagramNodePosition,
  type DiagramNodePositions,
  type NodePositionsSyncMode,
} from '../lib/diagram-layout';
import { classifyDiagramCapability, getDiagramCapabilityLabel } from '../lib/diagram-capabilities';
import { canUseErControls, canUseFlowchartControls, canUseSemanticFamilyControls, canUseSequenceControls, DiagramPreviewRegistry, type DiagramPreview } from '../lib/diagram-preview';
import {
  addSequenceMessage,
  addSequenceActivation,
  addSequenceFragment,
  addSequenceNote,
  addSequenceParticipant,
  deleteSequenceMessage,
  deleteSequenceActivation,
  deleteSequenceFragment,
  deleteSequenceNote,
  deleteSequenceParticipant,
  editSequenceActivation,
  editSequenceFragment,
  editSequenceMessage,
  editSequenceNote,
  editSequenceInlineText,
  getSequenceDiagramSnapshot,
  getSequenceParticipants,
  moveSequenceMessage,
  moveSequenceActivation,
  moveSequenceFragment,
  moveSequenceNote,
  moveSequenceParticipant,
  renameSequenceParticipant,
  renameSequenceParticipantId,
  setSequenceAutonumber,
} from '../lib/sequence-mutations';
import {
  addErAttribute,
  addErEntity,
  addErRelationship,
  deleteErAttribute,
  deleteErEntity,
  deleteErRelationship,
  editErAttribute,
  editErRelationship,
  getErDiagramSnapshot,
  moveErAttribute,
  moveErEntity,
  renameErEntity,
} from '../lib/er-mutations';
import {
  addClass, addClassAnnotation, addClassMember, addClassRelationship, deleteClass, deleteClassAnnotation, deleteClassMember,
  deleteClassRelationship, editClass, editClassMember, editClassRelationship, getClassDiagramSnapshot,
} from '../lib/class-mutations';
import {
  addState, addStateTransition, deleteState, deleteStateTransition, editState, editStateTransition, getStateDiagramSnapshot,
} from '../lib/state-mutations';
import {
  addRequirement, addRequirementRelationship, deleteRequirement, deleteRequirementRelationship, editRequirement,
  editRequirementRelationship, getRequirementDiagramSnapshot,
} from '../lib/requirement-mutations';
import {
  addArchitectureAlignment, addArchitectureEdge, addArchitectureGroup, addArchitectureJunction, addArchitectureService,
  deleteArchitectureAlignment, deleteArchitectureEdge, deleteArchitectureGroup, deleteArchitectureJunction, deleteArchitectureService,
  editArchitectureAlignment, editArchitectureEdge, editArchitectureGroup, editArchitectureJunction, editArchitectureService,
  getArchitectureDiagramSnapshot,
} from '../lib/architecture-mutations';
import { addC4Boundary, addC4Element, addC4Relationship, deleteC4Boundary, deleteC4Element, deleteC4Relationship, editC4Boundary, editC4Element, editC4Relationship, getC4DiagramSnapshot, moveC4Boundary, moveC4Element } from '../lib/c4-mutations';
import { addBlockComposite, addBlockLink, addBlockNode, deleteBlockComposite, deleteBlockLink, deleteBlockNode, editBlockComposite, editBlockLink, editBlockNode, getBlockDiagramSnapshot, moveBlockComposite, moveBlockNode, setBlockColumns } from '../lib/block-mutations';
import { addSwimlane, addSwimlaneHandoff, addSwimlaneNode, deleteSwimlane, deleteSwimlaneHandoff, deleteSwimlaneNode, editSwimlane, editSwimlaneHandoff, editSwimlaneNode, getSwimlaneDiagramSnapshot, moveSwimlaneNode } from '../lib/swimlane-mutations';
import { addJourneySection, addJourneyTask, deleteJourneySection, deleteJourneyTask, editJourneySection, editJourneyTask, getJourneyDiagramSnapshot, moveJourneySection, moveJourneyTask } from '../lib/journey-mutations';
import { addGanttSection, addGanttTask, deleteGanttSection, deleteGanttTask, editGanttSection, editGanttTask, getGanttDiagramSnapshot, moveGanttSection, moveGanttTask } from '../lib/gantt-mutations';
import { addTimelineEvent, addTimelinePeriod, addTimelineSection, deleteTimelineEvent, deleteTimelinePeriod, deleteTimelineSection, editTimelineEvent, editTimelinePeriod, editTimelineSection, getTimelineDiagramSnapshot, moveTimelineEvent, moveTimelinePeriod, moveTimelineSection, setTimelineDirection } from '../lib/timeline-mutations';
import { addGitGraphBranch, addGitGraphCheckout, addGitGraphCherryPick, addGitGraphCommit, addGitGraphMerge, deleteGitGraphOperation, editGitGraphBranch, editGitGraphCheckout, editGitGraphCherryPick, editGitGraphCommit, editGitGraphMerge, getGitGraphDiagramSnapshot, moveGitGraphOperation } from '../lib/gitgraph-mutations';
import { addEventModelingDataBlock, addEventModelingEntity, addEventModelingTimeframe, deleteEventModelingDataBlock, deleteEventModelingEntity, deleteEventModelingTimeframe, editEventModelingDataBlock, editEventModelingTimeframe, getEventModelingDiagramSnapshot, moveEventModelingTimeframe, renameEventModelingEntity } from '../lib/event-modeling-mutations';
import { addKanbanCard, addKanbanColumn, deleteKanbanCard, deleteKanbanColumn, editKanbanCard, editKanbanColumn, getKanbanDiagramSnapshot, moveKanbanCard } from '../lib/kanban-mutations';
import { addMindmapNode, deleteMindmapNode, editMindmapNode, getMindmapDiagramSnapshot, moveMindmapNode, reparentMindmapNode } from '../lib/mindmap-mutations';
import { addTreeViewNode, deleteTreeViewNode, editTreeViewNode, getTreeViewDiagramSnapshot, moveTreeViewNode, reparentTreeViewNode } from '../lib/treeview-mutations';
import { addIshikawaCause, deleteIshikawaCause, editIshikawaCause, editIshikawaEffect, getIshikawaDiagramSnapshot, moveIshikawaCause, reparentIshikawaCause, setIshikawaEffect } from '../lib/ishikawa-mutations';
import { addRailroadRule, deleteRailroadRule, editRailroadRule, getRailroadDiagramSnapshot, moveRailroadRule, renameRailroadRule } from '../lib/railroad-mutations';
import { addPieSlice, deletePieSlice, editPieSlice, editPieTitle, getPieDiagramSnapshot, movePieSlice, setPieShowData } from '../lib/pie-mutations';
import { addQuadrantPoint, deleteQuadrantPoint, editQuadrantPoint, editQuadrantTitle, getQuadrantDiagramSnapshot, moveQuadrantPoint, setQuadrantAxis, setQuadrantLabel } from '../lib/quadrant-mutations';
import { addXySeries, deleteXySeries, editXyAxis, editXySeries, editXyTitle, getXyChartDiagramSnapshot, moveXySeries, setXyOrientation } from '../lib/xychart-mutations';
import { addRadarAxis, addRadarCurve, deleteRadarAxis, deleteRadarCurve, editRadarAxis, editRadarCurve, editRadarOptions, editRadarTitle, getRadarDiagramSnapshot, moveRadarAxis, moveRadarCurve } from '../lib/radar-mutations';
import { addSankeyLink, deleteSankeyLink, editSankeyLink, getSankeyDiagramSnapshot, moveSankeyLink, renameSankeyNode } from '../lib/sankey-mutations';
import { addPacketField, deletePacketField, editPacketField, getPacketDiagramSnapshot, movePacketField } from '../lib/packet-mutations';
import { addCynefinItem, addCynefinTransition, deleteCynefinItem, deleteCynefinTransition, editCynefinItem, editCynefinTransition, getCynefinDiagramSnapshot, moveCynefinItem, moveCynefinTransition } from '../lib/cynefin-mutations';
import { addTreemapNode, deleteTreemapNode, editTreemapNode, getTreemapDiagramSnapshot, moveTreemapNode, reparentTreemapNode } from '../lib/treemap-mutations';
import { addVennStyle, addVennSubset, deleteVennStyle, deleteVennSubset, editVennStyle, editVennSubset, getVennDiagramSnapshot, moveVennStyle, moveVennSubset, renameVennSet } from '../lib/venn-mutations';
import { addWardleyEvolution, addWardleyLink, addWardleyNode, addWardleyNote, addWardleyPipeline, deleteWardleyEvolution, deleteWardleyLink, deleteWardleyNode, deleteWardleyNote, deleteWardleyPipeline, editWardleyEvolution, editWardleyLink, editWardleyNode, editWardleyNote, getWardleyDiagramSnapshot, moveWardleyLink, moveWardleyNode, moveWardleyNote, renameWardleyNode } from '../lib/wardley-mutations';
import { addZenUmlControl, addZenUmlMessage, addZenUmlParticipant, deleteZenUmlControl, deleteZenUmlMessage, deleteZenUmlParticipant, editZenUmlControl, editZenUmlMessage, editZenUmlParticipant, getZenUmlDiagramSnapshot, moveZenUmlControl, moveZenUmlMessage, moveZenUmlParticipant } from '../lib/zenuml-mutations';
import { collaborationOrigins, createSourceEditorUndoManager } from '../lib/collaboration-origins';
import { CanvasHistoryCoordinator } from '../lib/canvas-history';
import { DragLayoutCommitter, getDragLayoutTeardownOptions } from '../lib/drag-layout';
import { getAcceptedGenericSourceLayoutPolicy, getSourceLayoutPolicy, pruneNodePositions, type SourceLayoutPolicy } from '../lib/source-layout-lifecycle';
import { getServerHttpUrl, getWebsocketServerUrl } from '../lib/session';
import { listDiagramHistory, readCurrentDiagram, readDiagramRevision, restoreDiagramRevision } from '../lib/history-api';
import { getMermaidRenderId } from '../lib/mermaid-render-id';
import { mermaidSourceLanguage } from '../lib/mermaid-language';
import { formatMermaidForGitHub } from '../lib/github-mermaid';
import { getNextPreviewCameraLock } from '../lib/renderer-camera-policy';
import type { ConnectionState } from '../lib/connection-state';
import { FOCUSABLE_SELECTOR } from '../lib/focusable';
import { getMermaidThemeVariables } from '../lib/theme';
import { getActivityFlyoutViewOnOpen, getNextWorkspaceFlyout, type ActivityFlyoutView, type WorkspaceFlyout } from '../lib/workspace-flyout-state';
import { SOURCE_FLYOUT_DEFAULT_WIDTH } from '../lib/source-flyout-resize';
import { createRoom, getMcpRoomBearer, getRoomSharePath, getRoomShareUrl, rotateRoomKey } from '../lib/room-access-api';
import { completeLocalWorkspacePromotion, publishLocalWorkspace, createLocalWorkspacePersistence, getLocalWorkspaceLoadingCopy, LocalAwareness, type LocalWorkspacePersistence, type LocalWorkspacePhase } from '../lib/local-workspace';
import { useOverlayScene } from '../lib/use-overlay-scene';
import { getOverlayScene } from '../lib/overlay-scene';
import { getZenUmlRuntimePresentation, getZenUmlRuntimeSnapshot, prepareMermaidRuntimeForSource, subscribeZenUmlRuntime } from '../lib/zenuml-runtime';
import {
  CANVAS_CURSOR_INTERVAL_MS,
  areCanvasAwarenessStatesEqual,
  getRemoteCanvasPresence,
  hasCanvasCursorMovedEnough,
  quantizeCanvasCursor,
} from '../lib/canvas-presence';
import { LaserPresencePublisher } from '../lib/laser-presence-publisher';
import { getSafeSessionStorage, readLaserSequenceHighWater, writeLaserSequenceHighWater } from '../lib/laser-sequence-storage';
import { coerceCanvasToolForRenderer, getMermaidCanvasTool, shouldClearCanvasSelectionForPointerTarget, type CanvasTool } from '../lib/canvas-interaction-state';
import { usePresenterFollow } from '../lib/use-presenter-follow';

const DIAGRAMS_KEY = 'diagrams';
const DIAGRAM_ORDER_KEY = 'diagramOrder';
const DIAGRAM_NAME_KEY = 'name';
const DIAGRAM_MERMAID_TEXT_KEY = 'mermaid';
const DIAGRAM_NODE_POSITIONS_KEY = 'nodePositions';
const ACTIVITY_KEY = 'activity';
const PRESENCE_KEY = 'presence';
const MAX_ACTIVITY_EVENTS = 100;
const EDIT_ACTIVITY_DEBOUNCE_MS = 900;
const NAME_STORAGE_KEY = 'arielcharts.identity.v1';
const TAB_STORAGE_KEY = 'arielcharts.tab.v1';
const ACTIVE_DIAGRAM_STORAGE_PREFIX = 'arielcharts.active-diagram.v1:';
const PARTICIPANT_COLORS = ['#38bdf8', '#a78bfa', '#f472b6', '#34d399', '#f59e0b', '#fb7185'];

const connectionLabels: Record<ConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
  reconnecting: 'Reconnecting',
};

type CollaborationState = {
  activityArray: Y.Array<ActivityEvent>;
  awareness: AwarenessLike;
  diagramsMap: Y.Map<Y.Map<unknown>>;
  diagramOrder: Y.Array<string>;
  doc: Y.Doc;
  presenceMap: Y.Map<Participant>;
};

export type WorkspaceMode = 'local' | 'online';
type PromotionState = 'idle' | 'publishing' | 'error';

type DiagramTab = WorkspaceDiagramTab;

type ActiveDiagramState = {
  id: string;
  name: string;
  nodePositionsMap: Y.Map<NodePosition>;
  yText: Y.Text;
};

type NodePosition = DiagramNodePosition;

type AwarenessLike = {
  clientID: number;
  getStates: () => Map<number, unknown>;
  off: (eventName: string, handler: (...args: unknown[]) => void) => void;
  on: (eventName: string, handler: (...args: unknown[]) => void) => void;
  setLocalState: (state: AwarenessState | null) => void;
  setLocalStateField: (field: string, value: unknown) => void;
};

type LocalIdentity = Participant;

function randomSuffix(length: number): string {
  return Math.random().toString(36).slice(2, 2 + length);
}

function pickRandomColor(): string {
  return PARTICIPANT_COLORS[Math.floor(Math.random() * PARTICIPANT_COLORS.length)] ?? PARTICIPANT_COLORS[0] ?? '#38bdf8';
}

function getOrCreateIdentity(): LocalIdentity {
  if (typeof window === 'undefined') {
    return { color: PARTICIPANT_COLORS[0] ?? '#38bdf8', name: 'Human-local', type: 'human' };
  }

  const existingIdentity = window.localStorage.getItem(NAME_STORAGE_KEY);
  let baseName: string;
  let color: string;

  if (existingIdentity) {
    try {
      const parsed = JSON.parse(existingIdentity) as Partial<Participant>;
      baseName = typeof parsed.name === 'string' && parsed.name.length > 0 ? parsed.name : `Human-${randomSuffix(3)}`;
      color = typeof parsed.color === 'string' && parsed.color.length > 0 ? parsed.color : pickRandomColor();
    } catch {
      baseName = `Human-${randomSuffix(3)}`;
      color = pickRandomColor();
    }
  } else {
    baseName = `Human-${randomSuffix(3)}`;
    color = pickRandomColor();
    window.localStorage.setItem(
      NAME_STORAGE_KEY,
      JSON.stringify({ color, name: baseName, type: 'human' satisfies Participant['type'] }),
    );
  }

  let tabId = window.sessionStorage.getItem(TAB_STORAGE_KEY);
  if (!tabId) {
    tabId = randomSuffix(2);
    window.sessionStorage.setItem(TAB_STORAGE_KEY, tabId);
  }

  return {
    color,
    name: `${baseName}-${tabId}`,
    type: 'human',
  };
}

function isParticipant(value: unknown): value is Participant {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const participant = value as Record<string, unknown>;
  return typeof participant.name === 'string'
    && typeof participant.color === 'string'
    && (participant.type === 'human' || participant.type === 'agent');
}

function getParticipantFromAwarenessState(value: unknown): Participant | null {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const awarenessState = value as Partial<AwarenessState>;
  return isParticipant(awarenessState.user) ? awarenessState.user : null;
}

export function getParticipantsFromCollaborationSources(
  awarenessStates: ReadonlyMap<number, unknown>,
  durableParticipants: readonly Participant[],
): Participant[] {
  const liveParticipants = [...awarenessStates.values()]
    .map((value) => getParticipantFromAwarenessState(value))
    .filter((participant): participant is Participant => participant !== null);
  const byName = new Map<string, Participant>();
  for (const participant of durableParticipants) {
    if (participant.type === 'agent' && isParticipant(participant)) {
      byName.set(participant.name, participant);
    }
  }
  for (const participant of liveParticipants) {
    if (!byName.has(participant.name)) byName.set(participant.name, participant);
  }
  return [...byName.values()].sort((left, right) => left.name.localeCompare(right.name));
}

function areParticipantListsEqual(left: readonly Participant[], right: readonly Participant[]): boolean {
  return left.length === right.length && left.every((participant, index) => {
    const candidate = right[index];
    return candidate !== undefined
      && participant.name === candidate.name
      && participant.color === candidate.color
      && participant.type === candidate.type;
  });
}

function formatTimestamp(timestamp: number): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(timestamp);
}

function getParticipantAvatarText(participant: Participant): string {
  const displayName = stripParticipantTabSuffix(participant.name);

  if (participant.type === 'agent') {
    return 'AI';
  }

  const words = displayName
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);

  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
  }

  const compact = displayName.replace(/[^a-zA-Z0-9]/g, '');
  return compact.slice(0, 2).toUpperCase() || '??';
}

export const AGENT_WORKFLOW_REQUIREMENTS = [
  'First call getSession to see the named diagrams, stable IDs, and current session revision.',
  'Create a new tab only with getSession\'s latest revision as expectedRevision.',
  'Immediately before writeDiagram, renameDiagram, or deleteDiagram on an existing tab, call readDiagram and use its latest revision as expectedRevision.',
  'Use listDiagramHistory and readDiagramRevision to inspect prior iterations without changing the diagram.',
  'Immediately before restoreDiagramRevision, call readDiagram again and use that fresh revision.',
  'On a stale-revision error, read the latest diagram, merge deliberately, and retry only with the fresh expectedRevision; never blindly retry or overwrite.',
] as const;

export function reconcileSelectionForAcceptedRender(
  current: string[],
  context: 'detached-preview' | 'live',
  outcome: 'empty' | 'flowchart' | 'sequence' | 'er' | 'generic' | 'invalid',
): string[] {
  return context === 'live' && outcome !== 'flowchart' ? [] : current;
}

export function getLatestDiagramCheckpointId(activity: readonly ActivityEvent[], diagramId: string | null): string | null {
  return diagramId ? activity.find((event) => event.diagram_id === diagramId)?.id ?? null : null;
}

export function shouldApplyHistoryPreviewResponse(
  requestSequence: number,
  latestRequestSequence: number,
  requestedDiagramId: string,
  activeDiagramId: string | null,
  responseDiagramId: string,
): boolean {
  return requestSequence === latestRequestSequence
    && requestedDiagramId === activeDiagramId
    && responseDiagramId === requestedDiagramId;
}

export function getAgentWorkflowPrompt(sessionId: string, mcpUrl: string, roomKey: string): string {
  const bearer = getMcpRoomBearer(sessionId, roomKey);
  return `Connect to my ArielCharts session "${sessionId}" using the MCP server at ${mcpUrl}. Configure that MCP server with the HTTP header "Authorization: Bearer ${bearer}". This session-scoped MCP bearer is distinct from the raw room key people paste into the browser. ${AGENT_WORKFLOW_REQUIREMENTS.join(' ')} Mermaid changes sync collaboratively in real-time. Look up your docs for how to add an MCP server globally.`;
}

function stripParticipantTabSuffix(name: string): string {
  return name.replace(/-[a-z0-9]{2}$/i, '');
}

function getParticipantDisplayName(participant: Participant): string {
  return stripParticipantTabSuffix(participant.name);
}

function updateStoredIdentity(baseName: string, color: string) {
  window.localStorage.setItem(
    NAME_STORAGE_KEY,
    JSON.stringify({ color, name: baseName, type: 'human' satisfies Participant['type'] }),
  );
}

function renameIdentity(identity: LocalIdentity, baseName: string): LocalIdentity {
  const trimmedBaseName = baseName.trim() || 'Human';
  const tabSuffix = identity.name.match(/-([a-z0-9]{2})$/i)?.[1];

  return {
    ...identity,
    name: tabSuffix ? `${trimmedBaseName}-${tabSuffix}` : trimmedBaseName,
  };
}

function getParticipantBorderStyle(type: Participant['type']): 'solid' | 'dashed' {
  return type === 'agent' ? 'dashed' : 'solid';
}

function countConnectedAgents(participants: Participant[]): number {
  return participants.filter((participant) => participant.type === 'agent').length;
}

export function getAgentCountLabel(agentCount: number): string {
  return `${agentCount} MCP agent${agentCount === 1 ? '' : 's'} connected`;
}

export function getModalWrappedFocusIndex(
  activeElementIndex: number,
  focusableElementCount: number,
  shiftKey: boolean,
): number | null {
  if (focusableElementCount === 0 || activeElementIndex < 0) {
    return null;
  }
  if (shiftKey && activeElementIndex === 0) {
    return focusableElementCount - 1;
  }
  if (!shiftKey && activeElementIndex === focusableElementCount - 1) {
    return 0;
  }
  return null;
}

function describeActivityCompact(event: ActivityEvent): string {
  switch (event.action) {
    case 'joined':
      return 'joined';
    case 'left':
      return 'left';
    case 'edited':
      return 'edited diagram';
    case 'replaced':
      return 'updated diagram';
    default:
      return event.action;
  }
}

function getCompactConnectionLabel(connectionState: ConnectionState): string {
  switch (connectionState) {
    case 'connected':
      return 'synced';
    case 'connecting':
      return 'connecting';
    case 'reconnecting':
      return 'reconnecting';
    case 'disconnected':
      return 'offline';
  }
}

function getActivityColor(event: ActivityEvent, participants: Participant[]): string {
  const actorParticipant = participants.find((participant) => participant.name === event.actor.name);
  return actorParticipant?.color ?? (event.actor.type === 'agent' ? 'var(--agent-accent)' : 'var(--interactive-hover)');
}

function upsertActivity(activityArray: Y.Array<ActivityEvent>, event: ActivityEvent) {
  activityArray.push([event]);
  const overflow = activityArray.length - MAX_ACTIVITY_EVENTS;
  if (overflow > 0) {
    activityArray.delete(0, overflow);
  }
}

function createActivityEvent(
  actor: ActivityEvent['actor'],
  action: ActivityEvent['action'],
  detail?: string,
  diagramId?: string,
): ActivityEvent {
  return {
    action,
    actor: { name: actor.name, type: actor.type },
    detail,
    diagram_id: diagramId,
    id: `${actor.name}-${Date.now()}-${randomSuffix(4)}`,
    timestamp: Date.now(),
  };
}

export function commitLayoutActivityCheckpoint(
  doc: Y.Doc,
  activityArray: Y.Array<ActivityEvent>,
  nodePositionsMap: Y.Map<NodePosition>,
  positions: DiagramNodePositions,
  mode: NodePositionsSyncMode,
  event: ActivityEvent,
  origin: unknown = event.actor.name,
): void {
  doc.transact(() => {
    writeNodePositions(nodePositionsMap, positions, mode);
    upsertActivity(activityArray, event);
  }, origin);
}

function readDiagramTabs(diagrams: Y.Map<Y.Map<unknown>>, order: Y.Array<string>): DiagramTab[] {
  const seen = new Set<string>();
  const tabs: DiagramTab[] = [];
  for (const id of order.toArray()) {
    const diagram = diagrams.get(id);
    if (!diagram || seen.has(id)) continue;
    const name = diagram.get(DIAGRAM_NAME_KEY);
    tabs.push({ id, name: typeof name === 'string' && name.trim() ? name : `Diagram ${id}` });
    seen.add(id);
  }
  for (const [id, diagram] of diagrams.entries()) {
    if (seen.has(id)) continue;
    const name = diagram.get(DIAGRAM_NAME_KEY);
    tabs.push({ id, name: typeof name === 'string' && name.trim() ? name : `Diagram ${id}` });
  }
  return tabs;
}

export function getActiveDiagramName(diagrams: readonly DiagramTab[], diagramId: string | null): string | null {
  return diagramId ? diagrams.find((diagram) => diagram.id === diagramId)?.name ?? null : null;
}

function getActiveDiagramState(collaboration: CollaborationState | null, diagramId: string | null): ActiveDiagramState | null {
  if (!collaboration || !diagramId) return null;
  const diagram = collaboration.diagramsMap.get(diagramId);
  if (!diagram) return null;
  const yText = diagram.get(DIAGRAM_MERMAID_TEXT_KEY);
  const nodePositionsMap = diagram.get(DIAGRAM_NODE_POSITIONS_KEY);
  if (!(yText instanceof Y.Text) || !(nodePositionsMap instanceof Y.Map)) return null;
  const name = diagram.get(DIAGRAM_NAME_KEY);
  return { id: diagramId, name: typeof name === 'string' ? name : `Diagram ${diagramId}`, yText, nodePositionsMap: nodePositionsMap as Y.Map<NodePosition> };
}

function createDiagramId(): string {
  return `diagram_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
}

export function getTemplateDiagramName(defaultName: string, diagramId: string, existingNames: readonly string[]): string {
  const existing = new Set(existingNames.map(getDiagramNameKey));
  const suffixes = [diagramId.slice(-4), diagramId.slice(-8), diagramId];
  for (const suffix of suffixes) {
    const candidate = normalizeDiagramName(`${defaultName} ${suffix}`);
    if (!existing.has(getDiagramNameKey(candidate))) return candidate;
  }
  let duplicateIndex = 2;
  while (existing.has(getDiagramNameKey(`${defaultName} ${diagramId} ${duplicateIndex}`))) {
    duplicateIndex += 1;
  }
  return normalizeDiagramName(`${defaultName} ${diagramId} ${duplicateIndex}`);
}

function normalizeDiagramName(name: string): string {
  return name.trim().replace(/\s+/gu, ' ');
}

function getDiagramNameKey(name: string): string {
  return normalizeDiagramName(name).toLowerCase();
}

export function getTemplateDiagramCreation(templateId: StarterTemplateId, diagramId: string, existingNames: readonly string[]) {
  const template = getStarterTemplate(templateId);
  if (!template) {
    throw new Error(`Unknown starter template: ${templateId}`);
  }
  return {
    id: diagramId,
    name: getTemplateDiagramName(template.defaultName, diagramId, existingNames),
    source: template.source,
  };
}

function seedBlankDiagramCatalog(doc: Y.Doc, diagramsMap: Y.Map<Y.Map<unknown>>, diagramOrder: Y.Array<string>): void {
  if (readDiagramTabs(diagramsMap, diagramOrder).length > 0) return;
  const id = createDiagramId();
  doc.transact(() => {
    const diagram = new Y.Map<unknown>();
    diagram.set(DIAGRAM_NAME_KEY, 'Untitled diagram');
    diagram.set(DIAGRAM_MERMAID_TEXT_KEY, new Y.Text());
    diagram.set(DIAGRAM_NODE_POSITIONS_KEY, new Y.Map<NodePosition>());
    diagramsMap.set(id, diagram);
    diagramOrder.push([id]);
    getOverlayScene(doc, id, true);
  }, 'local-workspace-seed');
}

export function applyLocalCanvasToolChange(
  tool: CanvasTool,
  stopFollowing: () => void,
  setTool: (tool: CanvasTool) => void,
): void {
  stopFollowing();
  setTool(tool);
}

export function SessionWorkspace({
  initialRoomKey,
  sessionId,
  workspaceMode = 'online',
}: {
  initialRoomKey: string | null;
  sessionId: string;
  workspaceMode?: WorkspaceMode;
}) {
  const router = useRouter();
  const { resolvedTheme } = useTheme();
  const zenUmlRuntime = useSyncExternalStore(subscribeZenUmlRuntime, getZenUmlRuntimeSnapshot, getZenUmlRuntimeSnapshot);
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const editorThemeRef = useRef(new Compartment());
  const renderSequenceRef = useRef(0);
  const activeRenderRef = useRef<{ diagramId: string; previewKey: string; sequence: number; source: string } | null>(null);
  const previewRegistryRef = useRef(new DiagramPreviewRegistry());
  const joinedActivityRef = useRef(false);
  const editDebounceRef = useRef<number | null>(null);
  const currentIdentityRef = useRef<LocalIdentity | null>(null);
  const addActivityRef = useRef<((action: ActivityEvent['action'], detail?: string, diagramId?: string) => void) | null>(null);
  const mutationQueueRef = useRef<MutationQueue | null>(null);
  const canvasHistoryRef = useRef<CanvasHistoryCoordinator | null>(null);
  const sourceUndoManagerRef = useRef<Y.UndoManager | null>(null);
  const dragCommitterRef = useRef<DragLayoutCommitter | null>(null);
  const dragHistoryActionRef = useRef<ReturnType<CanvasHistoryCoordinator['beginAction']> | null>(null);
  const diagramTabRefs = useRef(new Map<string, HTMLButtonElement>());
  const diagramCameraSessionRef = useRef({ cameras: new Map<string, CanvasCameraState>(), sessionId });
  if (diagramCameraSessionRef.current.sessionId !== sessionId) {
    diagramCameraSessionRef.current = { cameras: new Map<string, CanvasCameraState>(), sessionId };
  }
  const flyoutOriginRef = useRef<HTMLButtonElement | null>(null);
  const pendingFlyoutReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const activityCloseRef = useRef<HTMLButtonElement | null>(null);
  const connectModalCloseRef = useRef<HTMLButtonElement | null>(null);
  const connectModalDialogRef = useRef<HTMLDivElement | null>(null);
  const connectModalReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const historyRequestSequenceRef = useRef(0);
  const historyPreviewRequestSequenceRef = useRef(0);
  const historyPreviewRef = useRef<DiagramRevision | null>(null);
  const historyRefreshCheckpointRef = useRef<string | null>(null);
  const restoreOriginRef = useRef<HTMLButtonElement | null>(null);
  const restoreConfirmRef = useRef<HTMLButtonElement | null>(null);
  const activeDiagramIdRef = useRef<string | null>(null);
  const activeTouchLabelRef = useRef<HTMLElement | null>(null);
  const touchLabelTimeoutRef = useRef<number | null>(null);
  const canvasHistoryNoticeTimeoutRef = useRef<number | null>(null);
  const selectedNodeIdsRef = useRef<string[]>([]);
  const editingNodeIdRef = useRef<string | null>(null);
  const localCanvasCursorRef = useRef<CanvasWorldPoint | null>(null);
  const localCanvasPresenceRef = useRef<CanvasAwarenessState | null>(null);
  const pendingCanvasCursorRef = useRef<CanvasWorldPoint | null>(null);
  const lastPublishedCanvasCursorRef = useRef<CanvasWorldPoint | null>(null);
  const lastCanvasCursorPublishedAtRef = useRef(0);
  const canvasCursorTimerRef = useRef<number | null>(null);
  const canvasPresenceReadyDiagramIdRef = useRef<string | null>(null);
  const localLaserRef = useRef<CanvasLaserState | null>(null);
  const localInkPreviewRef = useRef<CanvasInkPreviewState | null>(null);
  const laserPublisherRef = useRef<LaserPresencePublisher | null>(null);
  const inkPreviewSequenceRef = useRef(0);
  const localPersistenceRef = useRef<LocalWorkspacePersistence | null>(null);

  const [collaboration, setCollaboration] = useState<CollaborationState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [localWorkspacePhase, setLocalWorkspacePhase] = useState<LocalWorkspacePhase>(workspaceMode === 'local' ? 'restoring' : 'ready');
  const [promotionState, setPromotionState] = useState<PromotionState>('idle');
  const [promotionError, setPromotionError] = useState<string | null>(null);
  const [displayName, setDisplayName] = useState('Human');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [remoteCanvasPresence, setRemoteCanvasPresence] = useState<CanvasPresenceEntry[]>([]);
  const [localLaser, setLocalLaser] = useState<CanvasLaserState | null>(null);
  const [diagrams, setDiagrams] = useState<DiagramTab[]>([]);
  const [activeDiagramId, setActiveDiagramId] = useState<string | null>(null);
  const [activeDiagramIdentityVersion, setActiveDiagramIdentityVersion] = useState(0);
  const [mermaidText, setMermaidText] = useState('');
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [preview, setPreview] = useState<DiagramPreview | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [shareCopyState, setShareCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [promptCopyState, setPromptCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [sourceGitHubCopyState, setSourceGitHubCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [roomKey, setRoomKey] = useState<string | null>(initialRoomKey);
  const [roomKeyAnnouncement, setRoomKeyAnnouncement] = useState('');
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [nodePositions, setNodePositions] = useState<DiagramNodePositions>({});
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  // Canvas intent is browser-local and shared by Mermaid and overlay renderers.
  // A renderer receives its supported projection; neither renderer owns a
  // second mode state or relies on window events to switch the other one.
  const [canvasTool, setCanvasTool] = useState<CanvasTool>('select');
  const [renamingDiagramId, setRenamingDiagramId] = useState<string | null>(null);
  const [diagramNameDraft, setDiagramNameDraft] = useState('');
  const [openFlyout, setOpenFlyout] = useState<WorkspaceFlyout>(null);
  const [sourceFlyoutWidth, setSourceFlyoutWidth] = useState(SOURCE_FLYOUT_DEFAULT_WIDTH);
  const [activityFlyoutView, setActivityFlyoutView] = useState<ActivityFlyoutView>('history');
  const [diagramHistory, setDiagramHistory] = useState<ListDiagramHistoryOutput | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyPreview, setHistoryPreview] = useState<DiagramRevision | null>(null);
  const [historyPreviewRender, setHistoryPreviewRender] = useState<DiagramPreview | null>(null);
  const [historyPreviewError, setHistoryPreviewError] = useState<string | null>(null);
  const [historyPreviewCameraLock, setHistoryPreviewCameraLock] = useState(false);
  const [awaitingLivePreviewAfterHistory, setAwaitingLivePreviewAfterHistory] = useState(false);
  const [restoreCandidate, setRestoreCandidate] = useState<DiagramRevisionSummary | null>(null);
  const [restorePending, setRestorePending] = useState(false);
  const [restoreError, setRestoreError] = useState<string | null>(null);
  const [touchLabelStatus, setTouchLabelStatus] = useState<{ label: string } | null>(null);
  const [canvasHistoryNotice, setCanvasHistoryNotice] = useState<string | null>(null);
  const [canvasHistory, setCanvasHistory] = useState<CanvasHistoryCoordinator | null>(null);
  const [onboardingDismissalVersion, setOnboardingDismissalVersion] = useState(0);
  const [onboardingRequest, setOnboardingRequest] = useState<{ diagramId: string; id: number; action: 'sticky' | 'pen' } | null>(null);
  const [onboardingTextEditId, setOnboardingTextEditId] = useState<string | null>(null);
  const [templatePickerOpenRequest, setTemplatePickerOpenRequest] = useState(0);
  const [templatePickerOpen, setTemplatePickerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const selectPresentedDiagram = useCallback((diagramId: string) => { setActiveDiagramId(diagramId); }, []);
  const presenterFollow = usePresenterFollow(collaboration?.awareness ?? null, activeDiagramId, selectPresentedDiagram);
  const handleCanvasToolChange = useCallback((tool: CanvasTool) => {
    applyLocalCanvasToolChange(tool, presenterFollow.stopFollowing, setCanvasTool);
  }, [presenterFollow.stopFollowing]);
  const handleCanvasCameraChange = useCallback((camera: CanvasCameraState) => {
    if (activeDiagramId) diagramCameraSessionRef.current.cameras.set(activeDiagramId, camera);
    presenterFollow.onCameraChange(camera);
  }, [activeDiagramId, presenterFollow.onCameraChange]);

  useEffect(() => {
    const retainedDiagramIds = new Set(diagrams.map((diagram) => diagram.id));
    for (const diagramId of diagramCameraSessionRef.current.cameras.keys()) {
      if (!retainedDiagramIds.has(diagramId)) diagramCameraSessionRef.current.cameras.delete(diagramId);
    }
  }, [diagrams]);

  useEffect(() => {
    if (presenterFollow.followingClientId === null) return;
    const leaveOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') presenterFollow.stopFollowing();
    };
    window.addEventListener('keydown', leaveOnEscape);
    return () => window.removeEventListener('keydown', leaveOnEscape);
  }, [presenterFollow.followingClientId, presenterFollow.stopFollowing]);

  useEffect(() => {
    if (historyPreview !== null || connectionState !== 'connected') {
      presenterFollow.stopFollowing();
      presenterFollow.stopPresenting();
    }
  }, [connectionState, historyPreview, presenterFollow.stopFollowing, presenterFollow.stopPresenting]);

  const activeDiagram = useMemo(
    () => getActiveDiagramState(collaboration, activeDiagramId),
    [activeDiagramId, activeDiagramIdentityVersion, collaboration],
  );
  // `mermaidText` is presentation state synchronized in an effect. On a tab
  // switch it can briefly describe the previous diagram, so onboarding
  // eligibility must read the exact current Y.Text instead.
  const activeDiagramSource = activeDiagram?.yText.toString() ?? '';
  const overlayController = useOverlayScene(collaboration?.doc ?? null, activeDiagramId, canvasHistory, historyPreview === null);
  // Like source, derive onboarding eligibility from the active durable scene
  // rather than the controller's last rendered scene during a tab transition.
  const activeOverlayCount = collaboration && activeDiagramId
    ? getOverlayScene(collaboration.doc, activeDiagramId)?.objects.size ?? 0
    : 0;
  // The coordinator is scoped to this concrete Y.Map, not merely an id. An
  // import can replace the scene map under a stable diagram id.
  const overlaySceneIdentity = useMemo(() => {
    if (!collaboration || !activeDiagramId) return null;
    return getOverlayScene(collaboration.doc, activeDiagramId)?.scene ?? null;
  }, [activeDiagramId, collaboration, overlayController?.scene]);

  useEffect(() => {
    sourceUndoManagerRef.current?.destroy();
    sourceUndoManagerRef.current = null;
    if (!activeDiagram || !collaboration) return;
    const manager = createSourceEditorUndoManager(activeDiagram.yText);
    sourceUndoManagerRef.current = manager;
    return () => {
      manager.destroy();
      if (sourceUndoManagerRef.current === manager) sourceUndoManagerRef.current = null;
    };
  }, [activeDiagram, collaboration]);

  useEffect(() => {
    canvasHistoryRef.current?.destroy();
    canvasHistoryRef.current = null;
    if (!activeDiagram || !collaboration) return;
    // Scene replacement is an import boundary: detach the old journal without
    // touching CodeMirror's source-owned history.
    getOverlayScene(collaboration.doc, activeDiagram.id, true);
    const history = new CanvasHistoryCoordinator(collaboration.doc, activeDiagram.id, activeDiagram.yText, activeDiagram.nodePositionsMap);
    canvasHistoryRef.current = history;
    setCanvasHistory(history);
    return () => {
      if (dragHistoryActionRef.current) history.cancelAction(dragHistoryActionRef.current);
      dragHistoryActionRef.current = null;
      history.destroy();
      if (canvasHistoryRef.current === history) canvasHistoryRef.current = null;
      setCanvasHistory((current) => current === history ? null : current);
    };
  }, [activeDiagram, collaboration, overlaySceneIdentity]);

  useEffect(() => {
    activeDiagramIdRef.current = activeDiagramId;
  }, [activeDiagramId]);

  useEffect(() => {
    historyPreviewRef.current = historyPreview;
  }, [historyPreview]);

  useEffect(() => {
    if (!collaboration) {
      setRemoteCanvasPresence([]);
      return;
    }
    setRemoteCanvasPresence(getRemoteCanvasPresence(
      collaboration.awareness.getStates(),
      collaboration.awareness.clientID,
      activeDiagramId,
    ));
  }, [activeDiagramId, collaboration]);

  useEffect(() => {
    selectedNodeIdsRef.current = selectedNodeIds;
  }, [selectedNodeIds]);

  useEffect(() => () => {
    if (touchLabelTimeoutRef.current !== null) {
      window.clearTimeout(touchLabelTimeoutRef.current);
    }
    if (canvasCursorTimerRef.current !== null) {
      window.clearTimeout(canvasCursorTimerRef.current);
    }
  }, []);

  const renderedMermaidText = historyPreview?.mermaid_text ?? mermaidText;
  const renderedPreview = historyPreview
    ? historyPreviewRender
    : awaitingLivePreviewAfterHistory ? null : preview;
  const renderedNodePositions = historyPreview?.node_positions ?? nodePositions;
  const latestDiagramCheckpointId = useMemo(
    () => getLatestDiagramCheckpointId(activity, activeDiagramId),
    [activeDiagramId, activity],
  );

  const runMutation = useCallback((mutation: Promise<unknown>) => {
    setMutationError(null);
    observeMutationFailure(mutation, (error) => {
      setMutationError(error instanceof Error ? error.message : 'The diagram update could not be applied.');
    });
  }, []);

  const publishCanvasPresence = useCallback((
    cursor: CanvasWorldPoint | null,
    selectedNodeIds: readonly string[],
    editingNodeId = editingNodeIdRef.current,
  ) => {
    const diagramId = activeDiagramIdRef.current;
    if (!collaboration || !diagramId || historyPreviewRef.current !== null) {
      return;
    }

    const laser = localLaserRef.current;
    const inkPreview = localInkPreviewRef.current;
    const next: CanvasAwarenessState | null = cursor || selectedNodeIds.length > 0 || editingNodeId || laser || inkPreview
      ? {
        diagram_id: diagramId,
        ...(cursor ? { cursor } : {}),
        ...(selectedNodeIds.length > 0 ? { selected_node_ids: [...selectedNodeIds] } : {}),
        ...(editingNodeId ? { editing_node_id: editingNodeId } : {}),
        ...(laser ? { laser } : {}),
        ...(inkPreview ? { ink_preview: inkPreview } : {}),
      }
      : null;
    if (areCanvasAwarenessStatesEqual(localCanvasPresenceRef.current, next)) {
      return;
    }
    localCanvasPresenceRef.current = next;
    collaboration.awareness.setLocalStateField('canvas', next);
  }, [collaboration]);

  const publishCanvasPresenceRef = useRef(publishCanvasPresence);
  useEffect(() => { publishCanvasPresenceRef.current = publishCanvasPresence; }, [publishCanvasPresence]);

  useEffect(() => {
    const storage = typeof window === 'undefined' ? null : getSafeSessionStorage(window);
    const initialSequence = readLaserSequenceHighWater(storage, sessionId);
    const publisher = new LaserPresencePublisher((laser) => {
      writeLaserSequenceHighWater(storage, sessionId, laser.sequence);
      localLaserRef.current = laser;
      setLocalLaser(laser.active ? laser : null);
      publishCanvasPresenceRef.current(localCanvasCursorRef.current, selectedNodeIdsRef.current);
      if (!laser.active) {
        localLaserRef.current = null;
        publishCanvasPresenceRef.current(localCanvasCursorRef.current, selectedNodeIdsRef.current);
      }
    }, initialSequence);
    laserPublisherRef.current = publisher;
    return () => {
      publisher.destroy();
      if (laserPublisherRef.current === publisher) laserPublisherRef.current = null;
    };
  }, [collaboration?.awareness.clientID, sessionId]);

  const handleLaserChange = useCallback((value: { active: boolean; point?: CanvasWorldPoint }) => {
    if (value.active && value.point) laserPublisherRef.current?.move(value.point);
    else laserPublisherRef.current?.stop();
  }, []);

  const handleInkPreviewChange = useCallback((preview: CanvasInkPreviewState | null) => {
    localInkPreviewRef.current = preview;
    publishCanvasPresence(localCanvasCursorRef.current, selectedNodeIdsRef.current);
  }, [publishCanvasPresence]);

  const nextInkPreviewSequence = useCallback(() => {
    inkPreviewSequenceRef.current += 1;
    return inkPreviewSequenceRef.current;
  }, []);

  const handleNodeEditingChange = useCallback((nodeId: string | null) => {
    if (editingNodeIdRef.current === nodeId) {
      return;
    }
    editingNodeIdRef.current = nodeId;
    publishCanvasPresence(localCanvasCursorRef.current, selectedNodeIdsRef.current, nodeId);
  }, [publishCanvasPresence]);

  const flushCanvasCursor = useCallback(() => {
    if (canvasCursorTimerRef.current !== null) {
      window.clearTimeout(canvasCursorTimerRef.current);
      canvasCursorTimerRef.current = null;
    }
    const cursor = pendingCanvasCursorRef.current;
    if (!cursor) {
      return;
    }
    pendingCanvasCursorRef.current = null;
    localCanvasCursorRef.current = cursor;
    lastPublishedCanvasCursorRef.current = cursor;
    lastCanvasCursorPublishedAtRef.current = Date.now();
    publishCanvasPresence(cursor, selectedNodeIdsRef.current);
  }, [publishCanvasPresence]);

  const handleCanvasCursorChange = useCallback((point: CanvasWorldPoint | null) => {
    if (point === null) {
      if (canvasCursorTimerRef.current !== null) {
        window.clearTimeout(canvasCursorTimerRef.current);
        canvasCursorTimerRef.current = null;
      }
      pendingCanvasCursorRef.current = null;
      localCanvasCursorRef.current = null;
      lastPublishedCanvasCursorRef.current = null;
      publishCanvasPresence(null, selectedNodeIdsRef.current);
      return;
    }

    const cursor = quantizeCanvasCursor(point);
    const previous = pendingCanvasCursorRef.current ?? lastPublishedCanvasCursorRef.current;
    if (!hasCanvasCursorMovedEnough(previous, cursor)) {
      return;
    }

    pendingCanvasCursorRef.current = cursor;
    const remainingDelay = CANVAS_CURSOR_INTERVAL_MS - (Date.now() - lastCanvasCursorPublishedAtRef.current);
    if (remainingDelay <= 0 || canvasCursorTimerRef.current === null) {
      if (remainingDelay <= 0) {
        flushCanvasCursor();
      } else {
        canvasCursorTimerRef.current = window.setTimeout(flushCanvasCursor, remainingDelay);
      }
    }
  }, [flushCanvasCursor, publishCanvasPresence]);

  const clearCanvasPresence = useCallback((preserveEditingNode = false) => {
    if (canvasCursorTimerRef.current !== null) {
      window.clearTimeout(canvasCursorTimerRef.current);
      canvasCursorTimerRef.current = null;
    }
    pendingCanvasCursorRef.current = null;
    localCanvasCursorRef.current = null;
    lastPublishedCanvasCursorRef.current = null;
    if (!preserveEditingNode) {
      editingNodeIdRef.current = null;
    }
    localCanvasPresenceRef.current = null;
    localLaserRef.current = null;
    localInkPreviewRef.current = null;
    setLocalLaser(null);
    if (collaboration) {
      collaboration.awareness.setLocalStateField('canvas', null);
    }
  }, [collaboration]);

  const suspendCanvasPresence = useCallback(() => {
    if (canvasCursorTimerRef.current !== null) {
      window.clearTimeout(canvasCursorTimerRef.current);
      canvasCursorTimerRef.current = null;
    }
    pendingCanvasCursorRef.current = null;
    editingNodeIdRef.current = null;
    localCanvasPresenceRef.current = null;
    localLaserRef.current = null;
    localInkPreviewRef.current = null;
    setLocalLaser(null);
    if (collaboration) {
      collaboration.awareness.setLocalStateField('canvas', null);
    }
  }, [collaboration]);

  useEffect(() => {
    clearCanvasPresence();
    canvasPresenceReadyDiagramIdRef.current = null;
  }, [activeDiagramId, clearCanvasPresence]);

  useEffect(() => {
    if (historyPreview !== null) {
      // A detached revision is a local inspection surface. It must not leave
      // the live canvas cursor or selection visible to collaborators. Preserve
      // the last live point so a keyboard-only preview can resume afterward.
      suspendCanvasPresence();
    }
  }, [historyPreview, suspendCanvasPresence]);

  useEffect(() => {
    const clearSelectionOutsideCanvas = (event: PointerEvent) => {
      if (selectedNodeIdsRef.current.length === 0) {
        return;
      }
      const canvas = document.querySelector<HTMLElement>('[data-testid="diagram-canvas"]');
      if (!shouldClearCanvasSelectionForPointerTarget(event.target, canvas)) {
        return;
      }
      setSelectedNodeIds([]);
      publishCanvasPresence(localCanvasCursorRef.current, []);
    };
    document.addEventListener('pointerdown', clearSelectionOutsideCanvas, true);
    return () => { document.removeEventListener('pointerdown', clearSelectionOutsideCanvas, true); };
  }, [publishCanvasPresence]);

  useEffect(() => {
    if (!collaboration || !activeDiagramId || historyPreview !== null || connectionState === 'disconnected') {
      return;
    }
    if (canvasPresenceReadyDiagramIdRef.current !== activeDiagramId) {
      // The active-tab effect clears local selection immediately after a tab
      // switch. Do not briefly publish the previous tab's selection under the
      // new diagram id while that reset is pending.
      if (selectedNodeIds.length > 0) {
        return;
      }
      canvasPresenceReadyDiagramIdRef.current = activeDiagramId;
    }
    publishCanvasPresence(localCanvasCursorRef.current, selectedNodeIds);
  }, [activeDiagramId, collaboration, connectionState, historyPreview, publishCanvasPresence, selectedNodeIds]);

  useEffect(() => {
    const clearInactiveCanvasPresence = () => { clearCanvasPresence(true); };
    const resumeCanvasPresence = () => {
      if (document.visibilityState !== 'hidden') {
        publishCanvasPresence(localCanvasCursorRef.current, selectedNodeIdsRef.current);
      }
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        clearInactiveCanvasPresence();
      } else {
        resumeCanvasPresence();
      }
    };
    window.addEventListener('blur', clearInactiveCanvasPresence);
    window.addEventListener('focus', resumeCanvasPresence);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      window.removeEventListener('blur', clearInactiveCanvasPresence);
      window.removeEventListener('focus', resumeCanvasPresence);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [clearCanvasPresence, publishCanvasPresence]);

  useEffect(() => {
    if (connectionState === 'reconnecting' || connectionState === 'disconnected') {
      clearCanvasPresence(true);
    }
  }, [clearCanvasPresence, connectionState]);

  const runVisualSourceMutation = useCallback((mutation: Promise<MutationResult>, detail = 'Updated the diagram on canvas') => {
    const diagramId = activeDiagramId;
    runMutation(mutation.then((result) => {
      if (diagramId && result.nextText !== result.previousText) {
        addActivityRef.current?.('edited', detail, diagramId);
      }
      return result;
    }));
  }, [activeDiagramId, runMutation]);

  const mutateCanvasSourceDetailed = useCallback((mutate: (source: string) => string, detail: string) => {
    if (!activeDiagram || !collaboration || historyPreview !== null) {
      return { applied: false, error: 'The diagram update is unavailable right now.' };
    }
    try {
      const previousText = activeDiagram.yText.toString();
      const nextText = mutate(previousText);
      setMutationError(null);
      if (nextText === previousText) return { applied: true };
      collaboration.doc.transact(() => {
        applyDiff(activeDiagram.yText, nextText, previousText);
      }, collaborationOrigins.visual);
      addActivityRef.current?.('edited', detail, activeDiagram.id);
      return { applied: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The diagram update could not be applied.';
      setMutationError(message);
      return { applied: false, error: message };
    }
  }, [activeDiagram, collaboration, historyPreview]);

  const mutateCanvasSource = useCallback(
    (mutate: (source: string) => string, detail: string) => mutateCanvasSourceDetailed(mutate, detail).applied,
    [mutateCanvasSourceDetailed],
  );

  const refreshDiagramHistory = useCallback(async () => {
    if (workspaceMode === 'local') {
      setDiagramHistory(null);
      setHistoryLoading(false);
      return;
    }
    if (!activeDiagramId) {
      return;
    }
    const requestSequence = historyRequestSequenceRef.current + 1;
    historyRequestSequenceRef.current = requestSequence;
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const nextHistory = await listDiagramHistory(sessionId, activeDiagramId);
      if (historyRequestSequenceRef.current === requestSequence) {
        setDiagramHistory(nextHistory);
      }
    } catch (error) {
      if (historyRequestSequenceRef.current === requestSequence) {
        setHistoryError(error instanceof Error ? error.message : 'Could not load revision history.');
      }
    } finally {
      if (historyRequestSequenceRef.current === requestSequence) {
        setHistoryLoading(false);
      }
    }
  }, [activeDiagramId, sessionId, workspaceMode]);

  const applySourceLayoutPolicy = useCallback((policy: SourceLayoutPolicy) => {
    const committer = dragCommitterRef.current;
    if (!committer || !activeDiagram) {
      return;
    }

    committer.setAllowedNodeIds(policy.nodeIds);
    if (!policy.pruneDurablePositions) {
      return;
    }

    const { removed } = pruneNodePositions(readNodePositions(activeDiagram.nodePositionsMap), policy.nodeIds);
    if (Object.keys(removed).length === 0 || !collaboration) {
      return;
    }
    collaboration.doc.transact(() => {
      writeNodePositions(activeDiagram.nodePositionsMap, removed, 'remove');
    }, collaborationOrigins.reconciliation);
  }, [activeDiagram, collaboration]);

  const closeFlyout = useCallback(() => {
    pendingFlyoutReturnFocusRef.current = flyoutOriginRef.current;
    if (historyPreview !== null) {
      setAwaitingLivePreviewAfterHistory(true);
    }
    setHistoryPreview(null);
    setHistoryPreviewRender(null);
    setHistoryPreviewError(null);
    setHistoryPreviewCameraLock((current) => getNextPreviewCameraLock(current, 'preview-exited'));
    setRestoreCandidate(null);
    setRestoreError(null);
    historyPreviewRequestSequenceRef.current += 1;
    setOpenFlyout(null);
  }, [historyPreview]);

  const toggleFlyout = useCallback((flyout: Exclude<WorkspaceFlyout, null>, origin: HTMLButtonElement) => {
    const nextFlyout = getNextWorkspaceFlyout(openFlyout, flyout);
    if (!nextFlyout) {
      closeFlyout();
      return;
    }
    flyoutOriginRef.current = origin;
    if (openFlyout === 'activity' && flyout !== 'activity') {
      if (historyPreview !== null) {
        setAwaitingLivePreviewAfterHistory(true);
      }
      setHistoryPreview(null);
      setHistoryPreviewRender(null);
      setHistoryPreviewError(null);
      setHistoryPreviewCameraLock((current) => getNextPreviewCameraLock(current, 'preview-exited'));
      setRestoreCandidate(null);
      setRestoreError(null);
      historyPreviewRequestSequenceRef.current += 1;
    }
    if (flyout === 'activity') {
      setActivityFlyoutView(getActivityFlyoutViewOnOpen(openFlyout, flyout));
    }
    setOpenFlyout(nextFlyout);
  }, [closeFlyout, historyPreview, openFlyout]);

  useEffect(() => {
    setRoomKey(initialRoomKey);
    setRoomKeyAnnouncement('');
    previewRegistryRef.current.reset();
    setPreview(null);
    setRenderError(null);
  }, [initialRoomKey, sessionId]);

  useEffect(() => {
    if (!activeDiagramId) return;
    window.localStorage.setItem(`${ACTIVE_DIAGRAM_STORAGE_PREFIX}${sessionId}`, activeDiagramId);
  }, [activeDiagramId, sessionId]);

  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: 'base',
      themeVariables: getMermaidThemeVariables(resolvedTheme),
      securityLevel: 'strict',
      cynefin: { seed: 55 },
    });
  }, [resolvedTheme]);

  useEffect(() => {
    const doc = new Y.Doc();
    let persistence: ReturnType<typeof createLocalWorkspacePersistence> | null = null;
    try {
      if (workspaceMode === 'local') persistence = createLocalWorkspacePersistence(doc);
    } catch {
      setLocalWorkspacePhase('storage-error');
      doc.destroy();
      return undefined;
    }
    localPersistenceRef.current = persistence;
    const provider = workspaceMode === 'online' ? new WebsocketProvider(getWebsocketServerUrl(), sessionId, doc, {
      maxBackoffTime: 2_500,
      resyncInterval: 10_000,
    }) : null;
    const awareness = (provider?.awareness ?? new LocalAwareness(doc.clientID)) as AwarenessLike;
    const diagramsMap = doc.getMap<Y.Map<unknown>>(DIAGRAMS_KEY);
    const diagramOrder = doc.getArray<string>(DIAGRAM_ORDER_KEY);
    const activityArray = doc.getArray<ActivityEvent>(ACTIVITY_KEY);
    const presenceMap = doc.getMap<Participant>(PRESENCE_KEY);
    let cancelled = false;
    let dispose = () => {
      awareness.setLocalState(null);
      provider?.destroy();
      persistence?.destroy();
      if (localPersistenceRef.current === persistence) localPersistenceRef.current = null;
      doc.destroy();
    };

    const initialize = () => {
      if (cancelled) return;
    const localIdentity = getOrCreateIdentity();
    currentIdentityRef.current = localIdentity;
    setDisplayName(stripParticipantTabSuffix(localIdentity.name));
    awareness.setLocalState({ user: localIdentity });

    const syncActivity = () => {
      setActivity(activityArray.toArray().slice().reverse());
    };

    const syncDiagrams = () => {
      const tabs = readDiagramTabs(diagramsMap, diagramOrder);
      previewRegistryRef.current.prune(tabs.map((tab) => tab.id));
      setDiagrams(tabs);
      setActiveDiagramId((current) => {
        if (current && tabs.some((tab) => tab.id === current)) return current;
        const stored = window.localStorage.getItem(`${ACTIVE_DIAGRAM_STORAGE_PREFIX}${sessionId}`);
        return tabs.some((tab) => tab.id === stored) ? stored : (tabs[0]?.id ?? null);
      });
    };
    const syncDiagramMap: Parameters<typeof diagramsMap.observe>[0] = (event) => {
      const activeId = activeDiagramIdRef.current;
      if (activeId && event.keysChanged.has(activeId)) {
        setActiveDiagramIdentityVersion((current) => current + 1);
      }
    };

    const syncParticipants = () => {
      const nextParticipants = getParticipantsFromCollaborationSources(
        awareness.getStates(),
        [...presenceMap.values()],
      );
      setParticipants((current) => areParticipantListsEqual(current, nextParticipants) ? current : nextParticipants);
    };

    const syncRemoteCanvasPresence = () => {
      const nextPresence = getRemoteCanvasPresence(awareness.getStates(), awareness.clientID, activeDiagramIdRef.current);
      setRemoteCanvasPresence(nextPresence);
    };

    let hadConnected = workspaceMode === 'local';

    if (workspaceMode === 'local') {
      setConnectionState('connected');
    }

    const handleStatus = ({ status }: { status: 'connected' | 'connecting' | 'disconnected' }) => {
      if (status === 'connected') {
        hadConnected = true;
        setConnectionState('connected');
        return;
      }

      if (status === 'connecting') {
        setConnectionState(hadConnected ? 'reconnecting' : 'connecting');
        return;
      }

      setConnectionState(provider?.shouldConnect ? 'reconnecting' : 'disconnected');
    };

    const handleReconnectSignal = () => {
      if (provider?.shouldConnect) {
        setConnectionState(hadConnected ? 'reconnecting' : 'connecting');
      }
    };

    addActivityRef.current = (action, detail, diagramId) => {
      const actor = currentIdentityRef.current;
      if (!actor) {
        return;
      }

      doc.transact(() => {
        upsertActivity(activityArray, createActivityEvent(actor, action, detail, diagramId));
      }, actor.name);
    };

    syncActivity();
    syncDiagrams();
    syncParticipants();
    syncRemoteCanvasPresence();

    activityArray.observe(syncActivity);
    diagramsMap.observeDeep(syncDiagrams);
    diagramsMap.observe(syncDiagramMap);
    diagramOrder.observe(syncDiagrams);
    presenceMap.observe(syncParticipants);
    awareness.on('change', syncParticipants);
    awareness.on('change', syncRemoteCanvasPresence);
    provider?.on('status', handleStatus);
    provider?.on('connection-close', handleReconnectSignal);
    provider?.on('connection-error', handleReconnectSignal);
    provider?.on('sync', (isSynced: boolean) => {
      if (isSynced && !joinedActivityRef.current) {
        joinedActivityRef.current = true;
        addActivityRef.current?.('joined', 'Opened the session');
      }
    });

    setCollaboration({ activityArray, awareness, diagramsMap, diagramOrder, doc, presenceMap });
    if (workspaceMode === 'local') setLocalWorkspacePhase('ready');

    dispose = () => {
      if (editDebounceRef.current !== null) {
        window.clearTimeout(editDebounceRef.current);
      }
      // This effect owns the provider/doc lifetime. Flush before either can be
      // destroyed; active-tab cleanup may run before or after this one.
      dragCommitterRef.current?.destroy();
      dragCommitterRef.current = null;
      if (joinedActivityRef.current) {
        addActivityRef.current?.('left', 'Closed the session');
      }
      awareness.off('change', syncParticipants);
      awareness.off('change', syncRemoteCanvasPresence);
      provider?.off('status', handleStatus);
      provider?.off('connection-close', handleReconnectSignal);
      provider?.off('connection-error', handleReconnectSignal);
      activityArray.unobserve(syncActivity);
      diagramsMap.unobserveDeep(syncDiagrams);
      diagramsMap.unobserve(syncDiagramMap);
      diagramOrder.unobserve(syncDiagrams);
      presenceMap.unobserve(syncParticipants);
      awareness.setLocalState(null);
      provider?.destroy();
      persistence?.destroy();
      if (localPersistenceRef.current === persistence) localPersistenceRef.current = null;
      doc.destroy();
      addActivityRef.current = null;
      currentIdentityRef.current = null;
      setDisplayName('Human');
      joinedActivityRef.current = false;
      setCollaboration(null);
      setDiagrams([]);
      setActiveDiagramId(null);
      setRemoteCanvasPresence([]);
    };
    };

    if (persistence) {
      setLocalWorkspacePhase('restoring');
      void persistence.whenSynced.then(() => {
        if (cancelled) return;
        seedBlankDiagramCatalog(doc, diagramsMap, diagramOrder);
        setLocalWorkspacePhase('preparing');
        window.requestAnimationFrame(initialize);
      }).catch(() => {
        if (!cancelled) setLocalWorkspacePhase('storage-error');
      });
    } else {
      initialize();
    }

    return () => {
      cancelled = true;
      dispose();
    };
  }, [sessionId, workspaceMode]);

  useEffect(() => {
    historyPreviewRequestSequenceRef.current += 1;
    setHistoryPreview(null);
    setHistoryPreviewRender(null);
    setHistoryPreviewError(null);
    setHistoryPreviewCameraLock((current) => getNextPreviewCameraLock(current, 'diagram-changed'));
    setAwaitingLivePreviewAfterHistory(false);
    setRestoreCandidate(null);
    setRestoreError(null);
    setDiagramHistory(null);
    if (!activeDiagram || !collaboration) {
      dragCommitterRef.current?.destroy();
      dragCommitterRef.current = null;
      mutationQueueRef.current = null;
      setMermaidText('');
      setNodePositions({});
      setPreview(null);
      setRenderError(null);
      setSelectedNodeIds([]);
      setCanvasTool('select');
      return;
    }

    const syncText = () => {
      const source = activeDiagram.yText.toString();
      applySourceLayoutPolicy(getSourceLayoutPolicy(source));
      setMermaidText(source);
    };
    const syncNodePositions = () => {
      setNodePositions(readNodePositions(activeDiagram.nodePositionsMap));
    };
    mutationQueueRef.current = new MutationQueue(activeDiagram.yText, {
      onAfterApplyError: (error) => {
        setMutationError(error instanceof Error ? error.message : 'The diagram update could not be fully applied.');
      },
      transactionOrigin: collaborationOrigins.visual,
    });
    const dragCommitter = new DragLayoutCommitter((positions) => {
      const commit = () => collaboration?.doc.transact(() => {
        writeNodePositions(activeDiagram.nodePositionsMap, positions, 'merge');
      }, collaborationOrigins.visualLayout);
      const action = dragHistoryActionRef.current;
      if (action) canvasHistoryRef.current?.runAction(action, commit); else commit();
    });
    dragCommitterRef.current = dragCommitter;
    syncText();
    syncNodePositions();
    setPreview(previewRegistryRef.current.get(activeDiagram.id));
    setRenderError(previewRegistryRef.current.getError(activeDiagram.id));
    setSelectedNodeIds([]);
    setCanvasTool('select');
    activeDiagram.yText.observe(syncText);
    activeDiagram.nodePositionsMap.observe(syncNodePositions);

    return () => {
      activeDiagram.yText.unobserve(syncText);
      activeDiagram.nodePositionsMap.unobserve(syncNodePositions);
      dragCommitter.destroy(getDragLayoutTeardownOptions(collaboration?.diagramsMap.has(activeDiagram.id) ?? false));
      if (dragCommitterRef.current === dragCommitter) {
        dragCommitterRef.current = null;
      }
      mutationQueueRef.current = null;
    };
  }, [activeDiagram, applySourceLayoutPolicy, collaboration]);

  useEffect(() => {
    const undoManager = sourceUndoManagerRef.current;
    if (openFlyout !== 'source' || !collaboration || !activeDiagram || !editorHostRef.current || !undoManager) {
      return;
    }

    const handleLocalEdit = () => {
      if (editDebounceRef.current !== null) {
        window.clearTimeout(editDebounceRef.current);
      }

      editDebounceRef.current = window.setTimeout(() => {
        addActivityRef.current?.('edited', 'Updated the diagram', activeDiagram.id);
      }, EDIT_ACTIVITY_DEBOUNCE_MS);
    };

    const editorTheme = EditorView.theme({
      '&': {
        backgroundColor: 'var(--surface-inset)',
        color: 'var(--ink)',
        fontSize: '14px',
        height: '100%',
      },
      '.cm-content': {
        caretColor: 'var(--ink-strong)',
        fontFamily: 'var(--font-mono)',
        minHeight: '100%',
        padding: '1rem',
      },
      '.cm-gutters': {
        backgroundColor: 'var(--surface-muted)',
        borderRight: '1px solid var(--line-subtle)',
        color: 'var(--ink-muted)',
      },
      '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: 'var(--selection-muted)',
      },
      '.cm-selectionBackground': {
        backgroundColor: 'var(--selection-shadow) !important',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: 'var(--ink-strong)',
      },
      '.cm-panels': {
        backgroundColor: 'var(--surface-muted)',
        color: 'var(--ink)',
      },
    });

    const editorState = EditorState.create({
      doc: activeDiagram.yText.toString(),
      extensions: [
        basicSetup,
        mermaidSourceLanguage,
        keymap.of(yUndoManagerKeymap),
        editorThemeRef.current.of(editorTheme),
        yCollab(activeDiagram.yText, collaboration.awareness, { undoManager }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged && update.transactions.some((tr) => tr.isUserEvent('input'))) {
            handleLocalEdit();
          }
        }),
      ],
    });

    const editorView = new EditorView({
      parent: editorHostRef.current,
      state: editorState,
    });

    editorViewRef.current = editorView;
    window.requestAnimationFrame(() => { editorView.focus(); });

    return () => {
      editorView.destroy();
      editorViewRef.current = null;
    };
  }, [activeDiagram, collaboration, openFlyout]);

  useEffect(() => {
    if (workspaceMode === 'local' && openFlyout === 'activity' && activityFlyoutView !== 'activity') {
      setActivityFlyoutView('activity');
    }
  }, [activityFlyoutView, openFlyout, workspaceMode]);

  useEffect(() => {
    if (workspaceMode === 'local') return;
    if (openFlyout !== 'activity' || !activeDiagramId) {
      return;
    }
    historyRefreshCheckpointRef.current = `${activeDiagramId}:${latestDiagramCheckpointId ?? 'none'}`;
    void refreshDiagramHistory();
  }, [activeDiagramId, openFlyout, refreshDiagramHistory, workspaceMode]);

  useEffect(() => {
    if (workspaceMode === 'local') return;
    if (openFlyout !== 'activity' || !activeDiagramId) {
      return;
    }
    const checkpointKey = `${activeDiagramId}:${latestDiagramCheckpointId ?? 'none'}`;
    if (historyRefreshCheckpointRef.current === checkpointKey) {
      return;
    }
    historyRefreshCheckpointRef.current = checkpointKey;
    setHistoryLoading(true);
    setHistoryError(null);
    const timeout = window.setTimeout(() => { void refreshDiagramHistory(); }, 180);
    return () => { window.clearTimeout(timeout); };
  }, [activeDiagramId, latestDiagramCheckpointId, openFlyout, refreshDiagramHistory, workspaceMode]);

  useEffect(() => {
    const renderId = renderSequenceRef.current + 1;
    renderSequenceRef.current = renderId;
    const diagramId = activeDiagramId;
    const previewKey = historyPreview ? `${diagramId ?? 'none'}:revision:${historyPreview.revision_id}` : (diagramId ?? 'none');
    const source = historyPreview?.mermaid_text ?? mermaidText;
    const renderToken = diagramId ? { diagramId, previewKey, sequence: renderId, source } : null;
    activeRenderRef.current = renderToken;

    const isCurrentRender = () => (
      renderToken !== null
      && activeRenderRef.current?.diagramId === renderToken.diagramId
      && activeRenderRef.current?.previewKey === renderToken.previewKey
      && activeRenderRef.current?.sequence === renderToken.sequence
      && activeRenderRef.current?.source === renderToken.source
    );

    const renderPreview = async () => {
      if (!source.trim()) {
        if (diagramId && isCurrentRender()) {
          setSelectedNodeIds((current) => reconcileSelectionForAcceptedRender(
            current,
            historyPreview ? 'detached-preview' : 'live',
            'empty',
          ));
          if (historyPreview) {
            setHistoryPreviewRender(null);
            setHistoryPreviewError(null);
          } else {
            previewRegistryRef.current.clear(diagramId);
            setRenderError(null);
            setPreview(null);
            setCanvasTool('select');
            setAwaitingLivePreviewAfterHistory(false);
            setHistoryPreviewCameraLock((current) => getNextPreviewCameraLock(current, 'live-render-accepted'));
          }
        }
        return;
      }

      try {
        const runtimePreparation = prepareMermaidRuntimeForSource(source);
        if (runtimePreparation) await runtimePreparation;
        const sourceIsHeaderOnlyFlowchart = isHeaderOnlyFlowchartSource(source);
        const headerOnlyFlowchartSnapshot = sourceIsHeaderOnlyFlowchart
          ? getHeaderOnlyFlowchartSnapshot(source)
          : null;
        const capability = headerOnlyFlowchartSnapshot
          ? classifyDiagramCapability('flowchart')
          : classifyDiagramCapability((await mermaid.parse(source)).diagramType);
        if (!historyPreview && capability.kind !== 'flowchart' && diagramId && isCurrentRender()) {
          applySourceLayoutPolicy(getAcceptedGenericSourceLayoutPolicy());
        }
        let snapshot: FlowchartSnapshot | null = headerOnlyFlowchartSnapshot;
        if (capability.kind === 'flowchart' && snapshot === null) {
          try {
            snapshot = parseFlowchartSnapshot(source);
          } catch {
            snapshot = null;
          }
        }
        const svg = sourceIsHeaderOnlyFlowchart
          ? ''
          : (await mermaid.render(getMermaidRenderId(sessionId, previewKey, renderId), source)).svg;
        if (diagramId && isCurrentRender()) {
          setSelectedNodeIds((current) => reconcileSelectionForAcceptedRender(
            current,
            historyPreview ? 'detached-preview' : 'live',
            capability.kind,
          ));
          const nextPreview = { capability, diagramId, flowchartSnapshot: snapshot, source, svg };
          if (historyPreview) {
            setHistoryPreviewRender(nextPreview);
            setHistoryPreviewError(null);
          } else {
            previewRegistryRef.current.set(nextPreview);
            setPreview(nextPreview);
            setRenderError(null);
            setAwaitingLivePreviewAfterHistory(false);
          }
        }
      } catch (error) {
        if (isCurrentRender()) {
          const message = error instanceof Error ? error.message : 'Mermaid could not parse the diagram.';
          if (diagramId && !historyPreview) {
            previewRegistryRef.current.setError(diagramId, message);
          }
          if (historyPreview) {
            setHistoryPreviewError(message);
          } else {
            setRenderError(message);
            setAwaitingLivePreviewAfterHistory(false);
            setHistoryPreviewCameraLock((current) => getNextPreviewCameraLock(current, 'live-render-accepted'));
          }
          setSelectedNodeIds((current) => reconcileSelectionForAcceptedRender(
            current,
            historyPreview ? 'detached-preview' : 'live',
            'invalid',
          ));
        }
      }
    };

    void renderPreview();
  }, [activeDiagramId, applySourceLayoutPolicy, historyPreview, mermaidText, resolvedTheme, sessionId]);

  useEffect(() => {
    if (shareCopyState === 'idle') {
      return;
    }

    const timeout = window.setTimeout(() => {
      setShareCopyState('idle');
    }, 1_500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [shareCopyState]);

  useEffect(() => {
    if (promptCopyState === 'idle') {
      return;
    }

    const timeout = window.setTimeout(() => {
      setPromptCopyState('idle');
    }, 1_500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [promptCopyState]);

  useEffect(() => {
    if (sourceGitHubCopyState === 'idle') {
      return;
    }

    const timeout = window.setTimeout(() => {
      setSourceGitHubCopyState('idle');
    }, 1_500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [sourceGitHubCopyState]);

  const handleCopyShareUrl = async () => {
    if (!roomKey) {
      return;
    }
    try {
      await navigator.clipboard.writeText(getRoomShareUrl(window.location.origin, sessionId, roomKey));
      setShareCopyState('copied');
    } catch {
      setShareCopyState('error');
    }
  };

  const handleCopyGitHubMermaid = useCallback(async () => {
    if (!activeDiagram) {
      return;
    }
    try {
      await navigator.clipboard.writeText(formatMermaidForGitHub(activeDiagram.yText.toString()));
      setSourceGitHubCopyState('copied');
    } catch {
      setSourceGitHubCopyState('error');
    }
  }, [activeDiagram]);

  const cancelHistoryPreview = useCallback(() => {
    if (historyPreview !== null) {
      setAwaitingLivePreviewAfterHistory(true);
    }
    setHistoryPreview(null);
    setHistoryPreviewRender(null);
    setHistoryPreviewError(null);
    setHistoryPreviewCameraLock((current) => getNextPreviewCameraLock(current, 'preview-exited'));
    historyPreviewRequestSequenceRef.current += 1;
  }, [historyPreview]);

  const previewHistoryRevision = useCallback(async (revision: DiagramRevisionSummary) => {
    if (!activeDiagramId || revision.diagram_id !== activeDiagramId) {
      return;
    }
    const requestSequence = historyPreviewRequestSequenceRef.current + 1;
    historyPreviewRequestSequenceRef.current = requestSequence;
    const requestedDiagramId = activeDiagramId;
    setHistoryPreviewError(null);
    try {
      const snapshot = await readDiagramRevision(sessionId, requestedDiagramId, revision.revision_id);
      if (shouldApplyHistoryPreviewResponse(
        requestSequence,
        historyPreviewRequestSequenceRef.current,
        requestedDiagramId,
        activeDiagramIdRef.current,
        snapshot.diagram_id,
      )) {
        setAwaitingLivePreviewAfterHistory(false);
        setHistoryPreviewCameraLock((current) => getNextPreviewCameraLock(current, 'preview-entered'));
        setHistoryPreview(snapshot);
      }
    } catch (error) {
      if (requestSequence === historyPreviewRequestSequenceRef.current && activeDiagramIdRef.current === requestedDiagramId) {
        setHistoryPreviewError(error instanceof Error ? error.message : 'Could not load that revision preview.');
      }
    }
  }, [activeDiagramId, sessionId]);

  const requestHistoryRestore = useCallback((revision: DiagramRevisionSummary, origin: HTMLButtonElement) => {
    restoreOriginRef.current = origin;
    setRestoreCandidate(revision);
    setRestoreError(null);
  }, []);

  const returnFocusToRestoreOrigin = useCallback(() => {
    const origin = restoreOriginRef.current;
    window.requestAnimationFrame(() => {
      if (origin?.isConnected) {
        origin.focus({ preventScroll: true });
      }
    });
  }, []);

  const cancelHistoryRestore = useCallback(() => {
    setRestoreCandidate(null);
    setRestoreError(null);
    returnFocusToRestoreOrigin();
  }, [returnFocusToRestoreOrigin]);

  useEffect(() => {
    if (!restoreCandidate) {
      return;
    }
    const frame = window.requestAnimationFrame(() => { restoreConfirmRef.current?.focus({ preventScroll: true }); });
    return () => { window.cancelAnimationFrame(frame); };
  }, [restoreCandidate]);

  const confirmHistoryRestore = useCallback(async () => {
    const actor = currentIdentityRef.current;
    if (!activeDiagramId || !restoreCandidate || !actor) {
      return;
    }

    setRestorePending(true);
    setRestoreError(null);
    let shouldRefreshHistory = false;
    try {
      // A restore is deliberately never retried from an old list response.
      const current = await readCurrentDiagram(sessionId, activeDiagramId);
      const result = await restoreDiagramRevision(
        sessionId,
        activeDiagramId,
        restoreCandidate.revision_id,
        current.revision,
        actor,
      );
      if (result.status === 'stale') {
        cancelHistoryPreview();
        setRestoreCandidate(null);
        setRestoreError('This diagram changed while you were reviewing it. History is refreshing; review the new head and confirm again.');
        shouldRefreshHistory = true;
        return;
      }
      cancelHistoryPreview();
      setRestoreCandidate(null);
      shouldRefreshHistory = true;
    } catch (error) {
      setRestoreCandidate(null);
      setRestoreError(error instanceof Error ? `${error.message} Review the latest head before restoring.` : 'Restore could not be applied. Review the latest head before restoring.');
      shouldRefreshHistory = true;
    } finally {
      setRestorePending(false);
      returnFocusToRestoreOrigin();
      if (shouldRefreshHistory) {
        void refreshDiagramHistory();
      }
    }
  }, [activeDiagramId, cancelHistoryPreview, refreshDiagramHistory, restoreCandidate, returnFocusToRestoreOrigin, sessionId]);

  const getAgentPrompt = useCallback(() => {
    if (!roomKey) {
      return null;
    }
    const mcpUrl = `${getServerHttpUrl()}/mcp`;
    return getAgentWorkflowPrompt(sessionId, mcpUrl, roomKey);
  }, [roomKey, sessionId]);

  const handleCopyAgentPrompt = async () => {
    const prompt = getAgentPrompt();
    if (!prompt) {
      return;
    }
    try {
      await navigator.clipboard.writeText(prompt);
      setPromptCopyState('copied');
    } catch {
      setPromptCopyState('error');
    }
  };

  const handleCanvasRenderSettled = useCallback(() => {
    if (historyPreview === null && !awaitingLivePreviewAfterHistory) {
      setHistoryPreviewCameraLock((current) => getNextPreviewCameraLock(current, 'live-render-accepted'));
    }
  }, [awaitingLivePreviewAfterHistory, historyPreview]);

  const closeConnectModal = useCallback(() => {
    setShowConnectModal(false);
    const returnFocusTarget = connectModalReturnFocusRef.current;
    window.requestAnimationFrame(() => {
      if (returnFocusTarget?.isConnected) {
        returnFocusTarget.focus({ preventScroll: true });
      }
    });
  }, []);

  const openConnectModal = useCallback((returnFocusTarget: HTMLButtonElement) => {
    connectModalReturnFocusRef.current = returnFocusTarget;
    setShowConnectModal(true);
  }, []);

  const resetRoomKey = useCallback(async () => {
    try {
      const replacement = await rotateRoomKey(sessionId);
      setRoomKey(replacement);
      setShareCopyState('idle');
      setPromptCopyState('idle');
      setRoomKeyAnnouncement('Room key reset. All previously authorized browsers and agents were revoked; share the replacement key to reconnect them.');
    } catch (error) {
      setRoomKeyAnnouncement('The room key could not be reset. Try again.');
      throw error;
    }
  }, [sessionId]);

  const promoteLocalWorkspace = useCallback(async () => {
    if (workspaceMode !== 'local' || !collaboration || promotionState === 'publishing') return;
    setPromotionState('publishing');
    setPromotionError(null);
    try {
      const result = await publishLocalWorkspace(collaboration.doc, createRoom);
      if (result.status === 'changed-before-request') {
        setPromotionState('error');
        setPromotionError('Your workspace changed before publishing started. It remains local and editable; try sharing again when you are ready.');
        return;
      }
      if (result.status === 'changed-during-request') {
        setPromotionState('error');
        setPromotionError('Your workspace changed while publishing. It remains local and editable. A secure room was created from the earlier snapshot, but it is not connected to this draft.');
        return;
      }
      // This non-secret pointer is written before navigation. The IndexedDB
      // document intentionally remains as an archived recovery copy.
      completeLocalWorkspacePromotion(result.room, (room) => {
        router.replace(getRoomSharePath(room.sessionId, room.roomKey));
      });
    } catch {
      setPromotionState('error');
      setPromotionError('Your workspace is still saved on this device. Publishing could not finish, so we did not leave this page. If a secure room was created, reopening ArielCharts will resume it from this browser.');
    }
  }, [collaboration, promotionState, router, workspaceMode]);

  useEffect(() => {
    if (!showConnectModal) {
      return;
    }

    window.requestAnimationFrame(() => { connectModalCloseRef.current?.focus({ preventScroll: true }); });

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeConnectModal();
        return;
      }
      if (event.key !== 'Tab' || !connectModalDialogRef.current?.contains(document.activeElement)) {
        return;
      }
      const focusableElements = [...connectModalDialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      const activeElementIndex = focusableElements.indexOf(document.activeElement as HTMLElement);
      const nextIndex = getModalWrappedFocusIndex(activeElementIndex, focusableElements.length, event.shiftKey);
      if (nextIndex !== null) {
        event.preventDefault();
        focusableElements[nextIndex]?.focus({ preventScroll: true });
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [closeConnectModal, showConnectModal]);

  useEffect(() => {
    if (!openFlyout) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        if (event.defaultPrevented) return;
        const canvas = document.querySelector<HTMLElement>('[data-testid="diagram-canvas"]');
        const canvasOwnsEscape = canvas !== null && (
          (event.target instanceof Node && canvas.contains(event.target))
          || (document.activeElement instanceof Node && canvas.contains(document.activeElement))
        );
        // The canvas owns Escape while its interaction surface is focused: it
        // must always be able to leave laser/ink even if a source flyout stays
        // open. A flyout-focused Escape continues to close that flyout.
        if (canvasOwnsEscape) return;
        event.preventDefault();
        closeFlyout();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); };
  }, [closeFlyout, openFlyout]);

  useEffect(() => {
    if (openFlyout !== null) {
      return;
    }
    const origin = pendingFlyoutReturnFocusRef.current;
    if (!origin) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      pendingFlyoutReturnFocusRef.current = null;
      if (origin.isConnected) {
        origin.focus({ preventScroll: true });
      }
    });
    return () => { window.cancelAnimationFrame(frame); };
  }, [openFlyout]);

  useEffect(() => {
    if (openFlyout !== 'activity') {
      return;
    }
    window.requestAnimationFrame(() => { activityCloseRef.current?.focus(); });
  }, [openFlyout]);

  const activeParticipantCount = participants.length;
  const overflowCollaboratorCount = getCompactCollaboratorOverflowCount(activeParticipantCount);
  const connectedAgentCount = countConnectedAgents(participants);
  const isLocalWorkspace = workspaceMode === 'local';
  const editorStatusLabel = isLocalWorkspace ? 'saved on device' : getCompactConnectionLabel(connectionState);
  const activityStatusLabel = isLocalWorkspace
    ? 'saved on this device'
    : `${activeParticipantCount} collaborator${activeParticipantCount === 1 ? '' : 's'}`;
  const saveStatusLabel = isLocalWorkspace
    ? 'Saved on this device'
    : connectionState === 'connected'
    ? 'All changes saved'
    : connectionState === 'disconnected'
      ? 'Offline'
      : 'Saving changes…';
  const isFlowchart = canUseFlowchartControls(renderedMermaidText, renderedPreview);
  const isSequence = canUseSequenceControls(renderedMermaidText, renderedPreview);
  useEffect(() => {
    setCanvasTool((current) => coerceCanvasToolForRenderer(current, isFlowchart));
  }, [isFlowchart]);
  const isEr = canUseErControls(renderedMermaidText, renderedPreview);
  const isClass = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'class');
  const isState = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'state');
  const isRequirement = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'requirement');
  const isArchitecture = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'architecture');
  const isC4 = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'c4');
  const isBlock = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'block');
  const isSwimlane = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'swimlane');
  const isJourney = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'journey');
  const isGantt = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'gantt');
  const isTimeline = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'timeline');
  const isGitGraph = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'gitgraph');
  const isEventModeling = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'event-modeling');
  const isKanban = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'kanban');
  const isMindmap = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'mindmap');
  const isTreeView = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'tree-view');
  const isIshikawa = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'ishikawa');
  const isRailroad = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'railroad');
  const isPie = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'pie');
  const isQuadrant = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'quadrant');
  const isXyChart = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'xy-chart');
  const isRadar = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'radar');
  const isSankey = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'sankey');
  const isPacket = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'packet');
  const isCynefin = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'cynefin');
  const isTreemap = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'treemap');
  const isVenn = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'venn');
  const isWardley = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'wardley');
  const isZenUml = canUseSemanticFamilyControls(renderedMermaidText, renderedPreview, 'zenuml');
  const sequenceParticipants = useMemo(
    () => isSequence ? getSequenceParticipants(renderedMermaidText) : [],
    [isSequence, renderedMermaidText],
  );
  const sequenceDiagram = useMemo(() => {
    if (!isSequence) return null;
    try {
      return getSequenceDiagramSnapshot(renderedMermaidText);
    } catch {
      return null;
    }
  }, [isSequence, renderedMermaidText]);
  const sequenceTextItems = useMemo(() => sequenceDiagram ? [
    ...sequenceDiagram.participants.flatMap((participant) => participant.declarationId ? [{ id: participant.declarationId, text: participant.label, type: 'participant' as const }] : []),
    ...sequenceDiagram.messages.map((message) => ({ id: message.id, text: message.text, type: 'message' as const })),
    ...sequenceDiagram.notes.map((note) => ({ id: note.id, text: note.text, type: 'note' as const })),
    ...sequenceDiagram.fragments.map((fragment) => ({ id: fragment.id, text: fragment.label, type: 'fragment' as const })),
  ] : [], [renderedMermaidText, sequenceDiagram]);
  const erDiagram = useMemo(() => isEr ? getErDiagramSnapshot(renderedMermaidText) : null, [isEr, renderedMermaidText]);
  const classDiagram = useMemo(() => isClass ? getClassDiagramSnapshot(renderedMermaidText) : null, [isClass, renderedMermaidText]);
  const stateDiagram = useMemo(() => isState ? getStateDiagramSnapshot(renderedMermaidText) : null, [isState, renderedMermaidText]);
  const requirementDiagram = useMemo(() => isRequirement ? getRequirementDiagramSnapshot(renderedMermaidText) : null, [isRequirement, renderedMermaidText]);
  const architectureDiagram = useMemo(() => isArchitecture ? getArchitectureDiagramSnapshot(renderedMermaidText) : null, [isArchitecture, renderedMermaidText]);
  const c4Diagram = useMemo(() => isC4 ? getC4DiagramSnapshot(renderedMermaidText) : null, [isC4, renderedMermaidText]);
  const blockDiagram = useMemo(() => isBlock ? getBlockDiagramSnapshot(renderedMermaidText) : null, [isBlock, renderedMermaidText]);
  const swimlaneDiagram = useMemo(() => isSwimlane ? getSwimlaneDiagramSnapshot(renderedMermaidText) : null, [isSwimlane, renderedMermaidText]);
  const journeyDiagram = useMemo(() => isJourney ? getJourneyDiagramSnapshot(renderedMermaidText) : null, [isJourney, renderedMermaidText]);
  const ganttDiagram = useMemo(() => isGantt ? getGanttDiagramSnapshot(renderedMermaidText) : null, [isGantt, renderedMermaidText]);
  const timelineDiagram = useMemo(() => isTimeline ? getTimelineDiagramSnapshot(renderedMermaidText) : null, [isTimeline, renderedMermaidText]);
  const gitGraphDiagram = useMemo(() => isGitGraph ? getGitGraphDiagramSnapshot(renderedMermaidText) : null, [isGitGraph, renderedMermaidText]);
  const eventModelingDiagram = useMemo(() => isEventModeling ? getEventModelingDiagramSnapshot(renderedMermaidText) : null, [isEventModeling, renderedMermaidText]);
  const kanbanDiagram = useMemo(() => isKanban ? getKanbanDiagramSnapshot(renderedMermaidText) : null, [isKanban, renderedMermaidText]);
  const mindmapDiagram = useMemo(() => isMindmap ? getMindmapDiagramSnapshot(renderedMermaidText) : null, [isMindmap, renderedMermaidText]);
  const treeViewDiagram = useMemo(() => isTreeView ? getTreeViewDiagramSnapshot(renderedMermaidText) : null, [isTreeView, renderedMermaidText]);
  const ishikawaDiagram = useMemo(() => isIshikawa ? getIshikawaDiagramSnapshot(renderedMermaidText) : null, [isIshikawa, renderedMermaidText]);
  const railroadDiagram = useMemo(() => isRailroad ? getRailroadDiagramSnapshot(renderedMermaidText) : null, [isRailroad, renderedMermaidText]);
  const pieDiagram = useMemo(() => isPie ? getPieDiagramSnapshot(renderedMermaidText) : null, [isPie, renderedMermaidText]);
  const quadrantDiagram = useMemo(() => isQuadrant ? getQuadrantDiagramSnapshot(renderedMermaidText) : null, [isQuadrant, renderedMermaidText]);
  const xyChartDiagram = useMemo(() => isXyChart ? getXyChartDiagramSnapshot(renderedMermaidText) : null, [isXyChart, renderedMermaidText]);
  const radarDiagram = useMemo(() => isRadar ? getRadarDiagramSnapshot(renderedMermaidText) : null, [isRadar, renderedMermaidText]);
  const sankeyDiagram = useMemo(() => isSankey ? getSankeyDiagramSnapshot(renderedMermaidText) : null, [isSankey, renderedMermaidText]);
  const packetDiagram = useMemo(() => isPacket ? getPacketDiagramSnapshot(renderedMermaidText) : null, [isPacket, renderedMermaidText]);
  const cynefinDiagram = useMemo(() => isCynefin ? getCynefinDiagramSnapshot(renderedMermaidText) : null, [isCynefin, renderedMermaidText]);
  const treemapDiagram = useMemo(() => isTreemap ? getTreemapDiagramSnapshot(renderedMermaidText) : null, [isTreemap, renderedMermaidText]);
  const vennDiagram = useMemo(() => isVenn ? getVennDiagramSnapshot(renderedMermaidText) : null, [isVenn, renderedMermaidText]);
  const wardleyDiagram = useMemo(() => isWardley ? getWardleyDiagramSnapshot(renderedMermaidText) : null, [isWardley, renderedMermaidText]);
  const zenUmlDiagram = useMemo(() => isZenUml ? getZenUmlDiagramSnapshot(renderedMermaidText) : null, [isZenUml, renderedMermaidText]);
  const zenUmlPresentation = getZenUmlRuntimePresentation(renderedMermaidText, zenUmlRuntime);
  const isHeaderOnlyFlowchart = isHeaderOnlyFlowchartSource(renderedMermaidText);
  const emptyState = !renderedMermaidText.trim()
    ? 'chooser' as const
    : isFlowchart && isHeaderOnlyFlowchart
      ? 'chooser' as const
      : isSequence && sequenceParticipants.length === 0 ? 'sequence' as const : null;
  const diagramModeLabel = !renderedMermaidText.trim()
    ? 'Choose diagram type'
    : zenUmlPresentation.modeLabel
      ? zenUmlPresentation.modeLabel
    : getDiagramCapabilityLabel(
      renderedPreview?.source === renderedMermaidText ? renderedPreview.capability : null,
      renderedMermaidText,
    );
  const shareButtonLabel = !roomKey
    ? 'reset key to share'
    : shareCopyState === 'copied' ? 'copied' : shareCopyState === 'error' ? 'copy failed' : 'share';
  const promptCopyLabel = promptCopyState === 'copied' ? 'copied' : promptCopyState === 'error' ? 'copy failed' : 'copy';

  const saveDisplayName = useCallback((displayName: string) => {
    const currentIdentity = currentIdentityRef.current;
    if (!currentIdentity || !collaboration) {
      return;
    }

    const nextBaseName = displayName.trim() || 'Human';
    const updatedIdentity = renameIdentity(currentIdentity, nextBaseName);

    updateStoredIdentity(nextBaseName, updatedIdentity.color);
    currentIdentityRef.current = updatedIdentity;
    setDisplayName(stripParticipantTabSuffix(updatedIdentity.name));
    collaboration.awareness.setLocalStateField('user', updatedIdentity);
  }, [collaboration]);

  const handleNodePositionsChange = useCallback((positions: DiagramNodePositions, mode: NodePositionsSyncMode = 'merge') => {
    setNodePositions((current) => {
      if (mode === 'replace') {
        return positions;
      }

      if (mode === 'remove') {
        const next = { ...current };
        for (const nodeId of Object.keys(positions)) {
          delete next[nodeId];
        }
        return next;
      }

      return { ...current, ...positions };
    });

    if (!collaboration || !activeDiagram) {
      return;
    }

    collaboration.doc.transact(() => {
      writeNodePositions(activeDiagram.nodePositionsMap, positions, mode);
    }, collaborationOrigins.visualLayout);
  }, [activeDiagram, collaboration]);

  const handleNodeDragStart = useCallback((positions: DiagramNodePositions) => {
    const accepted = dragCommitterRef.current?.begin(Object.keys(positions)) ?? false;
    if (accepted) dragHistoryActionRef.current = canvasHistoryRef.current?.beginAction() ?? null;
    return accepted;
  }, [collaboration]);

  const handleNodeDrag = useCallback((positions: DiagramNodePositions) => {
    const committer = dragCommitterRef.current;
    if (!committer) {
      return;
    }
    committer.update(positions);
  }, []);

  const handleNodeDragStop = useCallback((positions: DiagramNodePositions) => {
    const committer = dragCommitterRef.current;
    const finished = committer?.finish(positions) ?? false;
    if (dragHistoryActionRef.current) canvasHistoryRef.current?.endAction(dragHistoryActionRef.current);
    dragHistoryActionRef.current = null;
    if (finished) {
      if (activeDiagramId) {
        addActivityRef.current?.('edited', 'Moved diagram nodes', activeDiagramId);
      }
    }
  }, [activeDiagramId, collaboration]);

  const handleAddConnectedNode = useCallback((source: string, label: string, shape: DiagramNodeShape, position: NodePosition, type: DiagramLinkType) => {
    const queue = mutationQueueRef.current;
    const diagram = activeDiagram;
    const actor = currentIdentityRef.current;
    if (!queue || !diagram || !collaboration || !actor) {
      return;
    }
    const history = canvasHistoryRef.current;
    const historyAction = history?.beginAction() ?? null;
    const mutation = queue.addConnectedNode(source, label, { shape, type }, (apply) => {
      if (historyAction) history?.runAction(historyAction, apply); else apply();
    });
    runMutation(mutation.then((result) => {
      if (typeof result.nodeId === 'string') {
        const nodeId = result.nodeId;
        const commit = () => commitLayoutActivityCheckpoint(
          collaboration.doc, collaboration.activityArray, diagram.nodePositionsMap, { [nodeId]: position }, 'merge',
          createActivityEvent(actor, 'edited', 'Updated the diagram on canvas', diagram.id), collaborationOrigins.visualLayout,
        );
        if (historyAction) history?.runAction(historyAction, commit); else commit();
        setSelectedNodeIds([nodeId]);
      }
      return result;
    }).finally(() => { if (historyAction) history?.endAction(historyAction); }));
  }, [activeDiagram, collaboration, runMutation]);

  const handlePasteClipboard = useCallback((clipboard: DiagramClipboardPayload, offset: DiagramClipboardPoint) => {
    const queue = mutationQueueRef.current;
    const diagram = activeDiagram;
    const actor = currentIdentityRef.current;
    if (!queue || !diagram || !collaboration || !actor) {
      return;
    }
    const history = canvasHistoryRef.current;
    const historyAction = history?.beginAction() ?? null;

    const mutation = queue.pasteClipboard(clipboard, {
      onApplied: (result) => {
        const commit = () => commitLayoutActivityCheckpoint(
          collaboration.doc, collaboration.activityArray, diagram.nodePositionsMap, getPastedClipboardPositions(clipboard, result.idMap, offset), 'merge',
          createActivityEvent(actor, 'edited', 'Pasted diagram nodes on canvas', diagram.id), collaborationOrigins.visualLayout,
        );
        if (historyAction) history?.runAction(historyAction, commit); else commit();
      },
    }, (apply) => { if (historyAction) history?.runAction(historyAction, apply); else apply(); });

    runMutation(mutation.then((result) => {
      setSelectedNodeIds(result.pastedNodeIds);
      return result;
    }).finally(() => { if (historyAction) history?.endAction(historyAction); }));
  }, [activeDiagram, collaboration, runMutation]);

  const handleResetSharedLayout = useCallback(() => {
    const diagram = activeDiagram;
    const actor = currentIdentityRef.current;
    if (!diagram || !collaboration || !actor) {
      return;
    }

    commitLayoutActivityCheckpoint(
      collaboration.doc,
      collaboration.activityArray,
      diagram.nodePositionsMap,
      {},
      'replace',
      createActivityEvent(actor, 'edited', 'Reset shared layout to Mermaid', diagram.id),
      collaborationOrigins.visualLayout,
    );
  }, [activeDiagram, collaboration]);

  const showCanvasHistoryNotice = useCallback((message: string) => {
    if (canvasHistoryNoticeTimeoutRef.current !== null) window.clearTimeout(canvasHistoryNoticeTimeoutRef.current);
    setCanvasHistoryNotice(message);
    canvasHistoryNoticeTimeoutRef.current = window.setTimeout(() => {
      canvasHistoryNoticeTimeoutRef.current = null;
      setCanvasHistoryNotice(null);
    }, 3_200);
  }, []);

  useEffect(() => () => {
    if (canvasHistoryNoticeTimeoutRef.current !== null) window.clearTimeout(canvasHistoryNoticeTimeoutRef.current);
  }, []);

  const handleCanvasUndo = useCallback(() => {
    if (historyPreview !== null) {
      return;
    }
    const result = canvasHistoryRef.current?.undo();
    if (result === 'stale') showCanvasHistoryNotice('Could not undo — this item changed since your edit.');
  }, [historyPreview, showCanvasHistoryNotice]);

  const handleCanvasRedo = useCallback(() => {
    if (historyPreview !== null) {
      return;
    }
    const result = canvasHistoryRef.current?.redo();
    if (result === 'stale') showCanvasHistoryNotice('Could not redo — this item changed since your edit.');
  }, [historyPreview, showCanvasHistoryNotice]);

  useEffect(() => {
    if (!activeDiagramId) {
      return;
    }
    let frame = 0;
    const revealActiveTab = () => {
      const tab = diagramTabRefs.current.get(activeDiagramId);
      const tabContainer = tab?.closest<HTMLElement>('.workspace-diagram-tab');
      const scroller = tabContainer?.closest<HTMLElement>('.workspace-diagram-tab-scroller');
      if (!tabContainer || !scroller) {
        tab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        return;
      }
      const tabRect = tabContainer.getBoundingClientRect();
      const scrollerRect = scroller.getBoundingClientRect();
      const tabLeft = scroller.scrollLeft + tabRect.left - scrollerRect.left;
      const tabRight = scroller.scrollLeft + tabRect.right - scrollerRect.left;
      const visibleLeft = scroller.scrollLeft;
      const visibleRight = visibleLeft + scroller.clientWidth;
      if (tabRight > visibleRight) {
        scroller.scrollLeft = tabRight - scroller.clientWidth;
      } else if (tabLeft < visibleLeft) {
        scroller.scrollLeft = tabLeft;
      }
    };
    const scheduleReveal = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(revealActiveTab);
    };
    const tab = diagramTabRefs.current.get(activeDiagramId);
    const tabContainer = tab?.closest<HTMLElement>('.workspace-diagram-tab');
    const scroller = tabContainer?.closest<HTMLElement>('.workspace-diagram-tab-scroller');
    const resizeObserver = new ResizeObserver(scheduleReveal);
    if (tabContainer) resizeObserver.observe(tabContainer);
    if (scroller) resizeObserver.observe(scroller);
    scheduleReveal();
    return () => {
      window.cancelAnimationFrame(frame);
      resizeObserver.disconnect();
    };
  }, [activeDiagramId, diagrams]);

  const focusDiagramTab = useCallback((diagramId: string) => {
    presenterFollow.stopFollowing();
    setActiveDiagramId(diagramId);
    window.requestAnimationFrame(() => { diagramTabRefs.current.get(diagramId)?.focus(); });
  }, [presenterFollow.stopFollowing]);

  const handleDiagramTabKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>, diagramId: string) => {
    const index = diagrams.findIndex((diagram) => diagram.id === diagramId);
    if (index < 0) return;
    let nextIndex: number | null = null;
    if (event.key === 'ArrowRight') nextIndex = (index + 1) % diagrams.length;
    if (event.key === 'ArrowLeft') nextIndex = (index - 1 + diagrams.length) % diagrams.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = diagrams.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    focusDiagramTab(diagrams[nextIndex]!.id);
  }, [diagrams, focusDiagramTab]);

  const createDiagramFromTemplate = useCallback((templateId: StarterTemplateId) => {
    if (!collaboration) return;
    const creation = getTemplateDiagramCreation(
      templateId,
      createDiagramId(),
      readDiagramTabs(collaboration.diagramsMap, collaboration.diagramOrder).map((diagram) => diagram.name),
    );
    collaboration.doc.transact(() => {
      const diagram = new Y.Map<unknown>();
      diagram.set(DIAGRAM_NAME_KEY, creation.name);
      diagram.set(DIAGRAM_MERMAID_TEXT_KEY, new Y.Text(creation.source));
      diagram.set(DIAGRAM_NODE_POSITIONS_KEY, new Y.Map<NodePosition>());
      collaboration.diagramsMap.set(creation.id, diagram);
      collaboration.diagramOrder.push([creation.id]);
      getOverlayScene(collaboration.doc, creation.id, true);
    }, 'tab-create');
    focusDiagramTab(creation.id);
    addActivityRef.current?.('created', `Created ${creation.name}`, creation.id);
  }, [collaboration, focusDiagramTab]);

  const onboardingDismissed = useMemo(() => activeDiagramId
    ? isWorkspaceOnboardingDismissed(sessionId, activeDiagramId)
    : false, [activeDiagramId, onboardingDismissalVersion, sessionId]);
  const onboardingVisible = canShowWorkspaceOnboarding({
    activeDiagramId,
    hasCompetingModal: showConnectModal || restoreCandidate !== null || historyPreview !== null || templatePickerOpen || settingsOpen,
    openFlyout: openFlyout !== null,
    overlayCount: activeOverlayCount,
    source: activeDiagramSource,
  }) && !onboardingDismissed;

  const canvasGuidance = getWorkspaceCanvasGuidance({
    emptyMessage: renderedMermaidText.trim() ? 'Rendering your diagram…' : 'Start from a template, or open Source to write Mermaid.',
    emptyState,
    onboardingVisible,
  });

  const dismissOnboarding = useCallback(() => {
    if (activeDiagramId) dismissWorkspaceOnboarding(sessionId, activeDiagramId);
    setOnboardingDismissalVersion((version) => version + 1);
  }, [activeDiagramId, sessionId]);

  // A blank workspace may regain an empty source later, but once its owner has
  // created durable Mermaid or canvas content it is no longer a new canvas.
  useEffect(() => {
    if (!activeDiagramId || !shouldDismissWorkspaceOnboardingForContent(activeDiagramSource, activeOverlayCount)) return;
    if (isWorkspaceOnboardingDismissed(sessionId, activeDiagramId)) return;
    dismissWorkspaceOnboarding(sessionId, activeDiagramId);
    setOnboardingDismissalVersion((version) => version + 1);
  }, [activeDiagramId, activeDiagramSource, activeOverlayCount, sessionId]);

  const startOnboardingOverlayAction = useCallback((action: 'sticky' | 'pen') => {
    if (!activeDiagramId) return;
    dismissOnboarding();
    setOnboardingRequest((current) => ({ diagramId: activeDiagramId, id: (current?.id ?? 0) + 1, action }));
  }, [activeDiagramId, dismissOnboarding]);

  const browseOnboardingTemplates = useCallback(() => {
    dismissOnboarding();
    setTemplatePickerOpenRequest((request) => request + 1);
  }, [dismissOnboarding]);

  const startOnboardingTemplate = useCallback(() => {
    dismissOnboarding();
    createDiagramFromTemplate('service-flowchart');
  }, [createDiagramFromTemplate, dismissOnboarding]);

  useEffect(() => {
    if (openFlyout === null && !showConnectModal && restoreCandidate === null && historyPreview === null && !templatePickerOpen && !settingsOpen) return;
    setOnboardingRequest(null);
    setOnboardingTextEditId(null);
  }, [historyPreview, openFlyout, restoreCandidate, settingsOpen, showConnectModal, templatePickerOpen]);

  useEffect(() => {
    setOnboardingRequest((request) => request?.diagramId === activeDiagramId ? request : null);
    setOnboardingTextEditId(null);
  }, [activeDiagramId]);

  const commitDiagramName = useCallback(() => {
    if (!collaboration || !renamingDiagramId) return;
    const normalizedName = normalizeDiagramName(diagramNameDraft);
    const current = diagrams.find((diagram) => diagram.id === renamingDiagramId);
    const isDuplicate = diagrams.some((diagram) => diagram.id !== renamingDiagramId && getDiagramNameKey(diagram.name) === getDiagramNameKey(normalizedName));
    if (!normalizedName || isDuplicate || !current) {
      setRenamingDiagramId(null);
      setDiagramNameDraft('');
      return;
    }
    collaboration.doc.transact(() => {
      collaboration.diagramsMap.get(renamingDiagramId)?.set(DIAGRAM_NAME_KEY, normalizedName);
    }, 'tab-rename');
    addActivityRef.current?.('renamed', `Renamed ${current.name} to ${normalizedName}`, renamingDiagramId);
    setRenamingDiagramId(null);
    setDiagramNameDraft('');
  }, [collaboration, diagramNameDraft, diagrams, renamingDiagramId]);

  const deleteActiveDiagram = useCallback((diagramId: string) => {
    if (!collaboration || diagrams.length <= 1) return;
    const index = diagrams.findIndex((diagram) => diagram.id === diagramId);
    const deleted = diagrams[index];
    collaboration.doc.transact(() => {
      collaboration.diagramsMap.delete(diagramId);
      const orderIndex = collaboration.diagramOrder.toArray().indexOf(diagramId);
      if (orderIndex >= 0) collaboration.diagramOrder.delete(orderIndex, 1);
    }, 'tab-delete');
    if (activeDiagramId === diagramId) {
      setActiveDiagramId(diagrams[index + 1]?.id ?? diagrams[index - 1]?.id ?? null);
    }
    if (deleted) addActivityRef.current?.('deleted', `Deleted ${deleted.name}`, diagramId);
  }, [activeDiagramId, collaboration, diagrams]);

  const handleTouchLabelPointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch' || !(event.target instanceof Element)) {
      return;
    }

    const labelTarget = event.target.closest<HTMLElement>('.workspace-touch-label');
    if (!labelTarget) {
      return;
    }

    const label = labelTarget.dataset.touchLabel ?? labelTarget.getAttribute('aria-label');
    if (!label) {
      return;
    }

    activeTouchLabelRef.current?.removeAttribute('data-touch-label-visible');
    if (touchLabelTimeoutRef.current !== null) {
      window.clearTimeout(touchLabelTimeoutRef.current);
    }

    activeTouchLabelRef.current = labelTarget;
    labelTarget.setAttribute('data-touch-label-visible', 'true');
    setTouchLabelStatus({ label });
    touchLabelTimeoutRef.current = window.setTimeout(() => {
      labelTarget.removeAttribute('data-touch-label-visible');
      if (activeTouchLabelRef.current === labelTarget) {
        activeTouchLabelRef.current = null;
      }
      touchLabelTimeoutRef.current = null;
      setTouchLabelStatus(null);
    }, 1_200);
  }, []);

  const handleTouchLabelPointerRelease = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    if (event.pointerType !== 'touch') {
      return;
    }
    const labelTarget = activeTouchLabelRef.current;
    labelTarget?.removeAttribute('data-touch-label-visible');
    if (activeTouchLabelRef.current === labelTarget) {
      activeTouchLabelRef.current = null;
    }
  }, []);

  if (workspaceMode === 'local' && localWorkspacePhase !== 'ready') {
    const loadingCopy = getLocalWorkspaceLoadingCopy(localWorkspacePhase);
    return (
      <main aria-busy={localWorkspacePhase !== 'storage-error'} aria-live="polite" className="room-gate-shell" data-testid="local-workspace-loader">
        <section aria-labelledby="local-workspace-loader-title" className="room-gate-card">
          <p className="eyebrow">{loadingCopy.eyebrow}</p>
          <h1 id="local-workspace-loader-title">{loadingCopy.title}</h1>
          <p role={localWorkspacePhase === 'storage-error' ? 'alert' : undefined}>{loadingCopy.detail}</p>
        </section>
      </main>
    );
  }

  return (
    <main
      className="workspace-shell"
      inert={promotionState === 'publishing' ? true : undefined}
      onPointerCancelCapture={handleTouchLabelPointerRelease}
      onPointerDownCapture={handleTouchLabelPointerDown}
      onPointerUpCapture={handleTouchLabelPointerRelease}
    >
      <header className="workspace-topbar">
        <div className="workspace-topbar-left">
          <span className="workspace-logo">{APP_NAME}</span>
        </div>

        <div className="workspace-topbar-right">
          <PresenterControls
            disabled={isLocalWorkspace || historyPreview !== null || connectionState !== 'connected'}
            followedPeer={presenterFollow.followedPeer}
            incomingSpotlight={presenterFollow.incomingSpotlight}
            onAcceptSpotlight={presenterFollow.acceptSpotlight}
            onFollow={presenterFollow.startFollowing}
            onIgnoreSpotlight={presenterFollow.ignoreSpotlight}
            onSpotlight={presenterFollow.requestSpotlight}
            onStart={presenterFollow.startPresenting}
            onStop={presenterFollow.stopPresenting}
            onStopFollowing={presenterFollow.stopFollowing}
            peers={presenterFollow.peers}
            presenting={presenterFollow.presenting}
          />
          <div data-testid="presence-bar" className="workspace-presence-avatars" aria-label={isLocalWorkspace ? 'This device' : 'Session presence'}>
            {participants.length > 0 ? (
              participants.map((participant, index) => (
                <div
                  className="workspace-avatar-stack-item"
                  key={`${participant.name}-${participant.type}`}
                >
                  <div
                    aria-label={`${getParticipantDisplayName(participant)}, ${participant.type}`}
                    className={`workspace-avatar workspace-avatar-${participant.type}`}
                    role="img"
                    style={{
                      backgroundColor: participant.type === 'agent' ? 'var(--agent-surface)' : participant.color,
                      borderColor: participant.type === 'agent' ? 'var(--agent-border)' : 'var(--surface-inset)',
                      borderStyle: getParticipantBorderStyle(participant.type),
                      zIndex: participants.length - index,
                    }}
                    title={getParticipantDisplayName(participant)}
                  >
                    {getParticipantAvatarText(participant)}
                  </div>
                </div>
              ))
            ) : (
              <div className="workspace-avatar workspace-avatar-empty">--</div>
            )}
            {overflowCollaboratorCount > 0 ? (
              <span aria-label={`${overflowCollaboratorCount} more collaborators`} className="workspace-collaborator-overflow" data-testid="topbar-collaborator-overflow">+{overflowCollaboratorCount}</span>
            ) : null}
          </div>
          <button
            aria-label={isLocalWorkspace ? 'Go online and share this workspace' : roomKey ? 'Copy private room link' : 'Room key unavailable. Reset it in Settings to share'}
            className="workspace-share-button workspace-touch-label"
            data-touch-label={isLocalWorkspace ? 'Go online & share' : roomKey ? 'Copy link' : 'Room key unavailable'}
            data-testid="share-session-button"
            disabled={promotionState === 'publishing' || (!isLocalWorkspace && !roomKey)}
            title={isLocalWorkspace ? 'Create a private online room from this device workspace' : roomKey ? 'Copy private room link' : 'Reset the room key in Settings before sharing'}
            type="button"
            onClick={isLocalWorkspace ? () => { void promoteLocalWorkspace(); } : handleCopyShareUrl}
          >
            {isLocalWorkspace || roomKey ? <Share2 aria-hidden="true" size={15} /> : <KeyRound aria-hidden="true" size={15} />}
            <span>{isLocalWorkspace ? promotionState === 'publishing' ? 'Publishing…' : 'Go online & share' : shareButtonLabel}</span>
            {shareCopyState === 'copied' ? <Check aria-hidden="true" size={13} /> : null}
          </button>
          <WorkspaceExportMenu
            activeDiagramName={getActiveDiagramName(diagrams, activeDiagramId)}
            mermaidSource={mermaidText}
            mermaidSvg={historyPreview ? '' : (preview?.svg ?? '')}
            onImported={() => {
              addActivityRef.current?.('replaced', 'Imported an editable workspace');
            }}
            scene={overlayController?.scene ?? null}
            sessionId={sessionId}
            theme={resolvedTheme}
            workspace={collaboration?.doc ?? null}
            workspaceMode={workspaceMode}
          />
          <WorkspaceSettings
            agentCount={connectedAgentCount}
            connectionState={connectionState}
            displayName={displayName}
            onConnectAgent={isLocalWorkspace ? () => { void promoteLocalWorkspace(); } : openConnectModal}
            onDisplayNameSave={saveDisplayName}
            onOpenChange={setSettingsOpen}
            onResetRoomKey={resetRoomKey}
            roomKey={roomKey}
            workspaceMode={workspaceMode}
            publishing={promotionState === 'publishing'}
          />
        </div>
      </header>

      {promotionError ? (
        <p className="workspace-promotion-error" data-testid="workspace-promotion-error" role="alert">{promotionError}</p>
      ) : null}

      <WorkspaceTabStrip
        activeDiagramId={activeDiagramId}
        diagramModeLabel={diagramModeLabel}
        diagramNameDraft={diagramNameDraft}
        diagrams={diagrams}
        onActiveDiagramChange={(diagramId) => { presenterFollow.stopFollowing(); setActiveDiagramId(diagramId); }}
        onCommitDiagramName={commitDiagramName}
        onCreateDiagram={createDiagramFromTemplate}
        onDeleteDiagram={deleteActiveDiagram}
        onDiagramKeyDown={handleDiagramTabKeyDown}
        onDiagramNameDraftChange={setDiagramNameDraft}
        onRenameDiagram={(diagram) => { setRenamingDiagramId(diagram.id); setDiagramNameDraft(diagram.name); }}
        onRenameDismiss={() => { setRenamingDiagramId(null); setDiagramNameDraft(''); }}
        onSourceToggle={(origin) => { toggleFlyout('source', origin); }}
        onTemplatePickerOpenChange={setTemplatePickerOpen}
        registerTabButton={(diagramId, element) => {
          if (element) diagramTabRefs.current.set(diagramId, element);
          else diagramTabRefs.current.delete(diagramId);
        }}
        renamingDiagramId={renamingDiagramId}
        sourceOpen={openFlyout === 'source'}
        starterTemplates={CHOOSER_STARTER_TEMPLATES}
        templatePickerOpenRequest={templatePickerOpenRequest}
      />

      <section aria-labelledby={activeDiagramId ? `diagram-tab-${activeDiagramId}` : undefined} className="workspace-main" data-testid="canvas-first-workspace" id="diagram-workspace" role="tabpanel">
        <article data-testid="preview-root" className="workspace-pane workspace-diagram-pane">
          {zenUmlPresentation.loading && openFlyout !== 'source' ? (
            <div data-testid="zenuml-loading-banner" className="error-banner is-loading" role="status">
              <strong>loading ZenUML renderer</strong>
              <span>The bundled plugin is loading for this diagram only.</span>
            </div>
          ) : null}
          {(renderError || historyPreviewError)
            && !zenUmlPresentation.loading
            && openFlyout !== 'source' ? (
            <div data-testid="parse-error-banner" className="error-banner" role="status">
              <strong>preview kept on last valid diagram</strong>
              <span>{historyPreviewError ?? renderError}</span>
            </div>
          ) : null}

          {mutationError ? (
            <div data-testid="mutation-error-banner" className="error-banner" role="status">
              <strong>diagram update not applied</strong>
              <span>{mutationError}</span>
            </div>
          ) : null}

          {onboardingVisible ? <WorkspaceOnboarding
            onAddStickyNote={() => { startOnboardingOverlayAction('sticky'); }}
            onBrowseTemplates={browseOnboardingTemplates}
            onClose={dismissOnboarding}
            onDraw={() => { startOnboardingOverlayAction('pen'); }}
            onStartTemplate={startOnboardingTemplate}
          /> : null}

          <DiagramCanvas
            key={activeDiagramId ?? 'no-active-diagram'}
            className="diagram-canvas"
            emptyMessage={canvasGuidance.emptyMessage}
            emptyState={canvasGuidance.emptyState}
            graph={renderedPreview?.flowchartSnapshot ?? null}
            interactionMode={getMermaidCanvasTool(canvasTool, isFlowchart)}
            isFlowchart={isFlowchart}
            mermaidSource={renderedMermaidText}
            isSequence={isSequence}
            isEr={isEr}
            isClass={isClass}
            isState={isState}
            isRequirement={isRequirement}
            isArchitecture={isArchitecture}
            architectureDiagram={architectureDiagram}
            isC4={isC4}
            c4Diagram={c4Diagram}
            isBlock={isBlock}
            blockDiagram={blockDiagram}
            isSwimlane={isSwimlane}
            swimlaneDiagram={swimlaneDiagram}
            isJourney={isJourney}
            journeyDiagram={journeyDiagram}
            isGantt={isGantt}
            ganttDiagram={ganttDiagram}
            isTimeline={isTimeline}
            timelineDiagram={timelineDiagram}
            isGitGraph={isGitGraph}
            gitGraphDiagram={gitGraphDiagram}
            isEventModeling={isEventModeling}
            eventModelingDiagram={eventModelingDiagram}
            isKanban={isKanban}
            kanbanDiagram={kanbanDiagram}
            isMindmap={isMindmap}
            mindmapDiagram={mindmapDiagram}
            isTreeView={isTreeView}
            treeViewDiagram={treeViewDiagram}
            isIshikawa={isIshikawa}
            ishikawaDiagram={ishikawaDiagram}
            isRailroad={isRailroad}
            railroadDiagram={railroadDiagram}
            isPie={isPie}
            pieDiagram={pieDiagram}
            isQuadrant={isQuadrant}
            quadrantDiagram={quadrantDiagram}
            isXyChart={isXyChart}
            xyChartDiagram={xyChartDiagram}
            isRadar={isRadar}
            radarDiagram={radarDiagram}
            isSankey={isSankey}
            sankeyDiagram={sankeyDiagram}
            isPacket={isPacket}
            packetDiagram={packetDiagram}
            isCynefin={isCynefin}
            cynefinDiagram={cynefinDiagram}
            isTreemap={isTreemap}
            treemapDiagram={treemapDiagram}
            isVenn={isVenn}
            vennDiagram={vennDiagram}
            isWardley={isWardley}
            wardleyDiagram={wardleyDiagram}
            isZenUml={isZenUml}
            zenUmlDiagram={zenUmlDiagram}
            initialCamera={activeDiagramId ? diagramCameraSessionRef.current.cameras.get(activeDiagramId) : undefined}
            nodePositions={renderedNodePositions}
            overlay={overlayController && activeDiagramId ? {
              diagramId: activeDiagramId,
              sessionId,
              scene: overlayController.scene,
              readOnly: historyPreview !== null,
              onAdd: overlayController.add,
              onAddShape: overlayController.addShape,
              onAddConnector: overlayController.addConnector,
              onAddFrame: overlayController.addFrame,
              onAddLayer: overlayController.addLayer,
              onUpdateLayer: overlayController.updateLayer,
              onAssignLayer: overlayController.assignLayer,
              onReorderLayer: overlayController.reorderLayer,
              onAnchor: overlayController.anchor,
              onCopy: overlayController.copy,
              onDelete: overlayController.remove,
              onMove: overlayController.move,
              onMoveMany: overlayController.moveMany,
              onAlign: overlayController.align,
              onDistribute: overlayController.distribute,
              onPaste: overlayController.paste,
              onReorder: overlayController.reorder,
              onUndo: handleCanvasUndo,
              onRedo: handleCanvasRedo,
              onUpdate: overlayController.update,
              onTransform: overlayController.transform,
              onEditText: overlayController.editText,
              onDuplicate: overlayController.duplicate,
              onDuplicateMany: overlayController.duplicateMany,
              onBeginComposition: overlayController.beginComposition,
              onCommitComposition: overlayController.commitComposition,
              onAddStroke: overlayController.addStroke,
              onInkPreview: historyPreview === null ? handleInkPreviewChange : () => undefined,
              tool: coerceCanvasToolForRenderer(canvasTool, isFlowchart),
              onToolChange: handleCanvasToolChange,
              nextInkPreviewSequence,
              remoteInkPreviews: historyPreview === null ? remoteCanvasPresence.flatMap((presence) => presence.canvas.ink_preview ? [{ id: String(presence.client_id), color: presence.participant.color, preview: presence.canvas.ink_preview }] : []) : [],
              onboardingRequest: onboardingRequest?.diagramId === activeDiagramId ? onboardingRequest : null,
              onOnboardingRequestComplete: (requestId, createdTextId) => {
                if (onboardingRequest?.id !== requestId) return;
                setOnboardingRequest(null);
                if (createdTextId) setOnboardingTextEditId(createdTextId);
              },
              requestedTextEditId: onboardingTextEditId,
              onRequestedTextEditComplete: (id) => {
                setOnboardingTextEditId((current) => current === id ? null : current);
              },
            } : undefined}
            preserveCamera={historyPreviewCameraLock}
            readOnly={historyPreview !== null}
            remoteCanvasPresence={historyPreview === null ? remoteCanvasPresence : []}
            localLaser={historyPreview === null ? localLaser : null}
            localParticipant={currentIdentityRef.current ?? { color: '#ef4444', name: displayName, type: 'human' }}
            followedCamera={presenterFollow.followedCamera}
            onCameraChange={handleCanvasCameraChange}
            onLocalCanvasInteraction={presenterFollow.stopFollowing}
            onAddEdge={(source, target, label, type) => {
              const queue = mutationQueueRef.current;
              if (queue) runVisualSourceMutation(queue.addEdge(source, target, { label, type }));
            }}
            onAddNode={(label, shape) => {
              const queue = mutationQueueRef.current;
              if (queue) runVisualSourceMutation(queue.addNode(label, { shape }));
            }}
            onAddSequenceMessage={(from, to, message, arrow) => {
              mutateCanvasSource((source) => addSequenceMessage(source, from, to, message, arrow), 'Added a sequence message');
            }}
            onAddSequenceParticipant={(label, kind) => {
              mutateCanvasSource((source) => addSequenceParticipant(source, label, kind), 'Added a sequence participant');
            }}
            onAddSequenceNote={(placement, participantIds, text) => {
              mutateCanvasSource((source) => addSequenceNote(source, placement, participantIds, text), 'Added a sequence note');
            }}
            onAddSequenceActivation={(action, participant) => {
              mutateCanvasSource((source) => addSequenceActivation(source, action, participant), 'Added a sequence activation');
            }}
            onAddSequenceFragment={(kind, label) => {
              mutateCanvasSource((source) => addSequenceFragment(source, kind, label), 'Added a sequence fragment');
            }}
            onDeleteSequenceParticipant={(id) => {
              mutateCanvasSource((source) => deleteSequenceParticipant(source, id), 'Deleted a sequence participant');
            }}
            onDeleteSequenceMessage={(id) => {
              mutateCanvasSource((source) => deleteSequenceMessage(source, id), 'Deleted a sequence message');
            }}
            onDeleteSequenceNote={(id) => {
              mutateCanvasSource((source) => deleteSequenceNote(source, id), 'Deleted a sequence note');
            }}
            onDeleteSequenceActivation={(id) => {
              mutateCanvasSource((source) => deleteSequenceActivation(source, id), 'Deleted a sequence activation');
            }}
            onDeleteSequenceFragment={(id) => {
              mutateCanvasSource((source) => deleteSequenceFragment(source, id), 'Deleted a sequence fragment');
            }}
            onEditSequenceParticipant={(id, label) => {
              mutateCanvasSource((source) => renameSequenceParticipant(source, id, label), 'Renamed a sequence participant');
            }}
            onRenameSequenceParticipantId={(id, nextId) => {
              mutateCanvasSource((source) => renameSequenceParticipantId(source, id, nextId), 'Renamed a sequence participant identifier');
            }}
            onEditSequenceMessage={(id, patch) => {
              mutateCanvasSource((source) => editSequenceMessage(source, id, patch), 'Edited a sequence message');
            }}
            onEditSequenceNote={(id, patch) => {
              mutateCanvasSource((source) => editSequenceNote(source, id, patch), 'Edited a sequence note');
            }}
            onEditSequenceActivation={(id, action, participant) => {
              mutateCanvasSource((source) => editSequenceActivation(source, id, { action, participant }), 'Edited a sequence activation');
            }}
            onEditSequenceFragment={(id, label) => {
              mutateCanvasSource((source) => editSequenceFragment(source, id, label), 'Edited a sequence fragment');
            }}
            onMoveSequenceParticipant={(id, direction) => {
              mutateCanvasSource((source) => moveSequenceParticipant(source, id, direction), 'Reordered sequence participants');
            }}
            onMoveSequenceMessage={(id, direction) => {
              mutateCanvasSource((source) => moveSequenceMessage(source, id, direction), 'Reordered sequence messages');
            }}
            onMoveSequenceNote={(id, direction) => {
              mutateCanvasSource((source) => moveSequenceNote(source, id, direction), 'Reordered sequence notes');
            }}
            onMoveSequenceActivation={(id, direction) => {
              mutateCanvasSource((source) => moveSequenceActivation(source, id, direction), 'Reordered sequence activations');
            }}
            onMoveSequenceFragment={(id, direction) => {
              mutateCanvasSource((source) => moveSequenceFragment(source, id, direction), 'Reordered sequence fragments');
            }}
            onSetSequenceAutonumber={(value) => {
              mutateCanvasSource((source) => setSequenceAutonumber(source, value), 'Updated sequence autonumbering');
            }}
            onEditSequenceStatement={(id, text) => {
              mutateCanvasSource((source) => editSequenceInlineText(source, id, text), 'Edited a sequence statement');
            }}
            onAddErEntity={(name) => {
              mutateCanvasSource((source) => addErEntity(source, name), 'Added an ER entity');
            }}
            onRenameErEntity={(currentName, nextName) => {
              mutateCanvasSource((source) => renameErEntity(source, currentName, nextName), 'Renamed an ER entity');
            }}
            onDeleteErEntity={(name) => {
              mutateCanvasSource((source) => deleteErEntity(source, name), 'Deleted an ER entity and dependent relationships');
            }}
            onMoveErEntity={(name, direction) => {
              mutateCanvasSource((source) => moveErEntity(source, name, direction), 'Reordered ER entities');
            }}
            onAddErAttribute={(entityName, attribute) => {
              mutateCanvasSource((source) => addErAttribute(source, entityName, attribute), 'Added an ER attribute');
            }}
            onEditErAttribute={(entityName, attributeName, attribute) => {
              mutateCanvasSource((source) => editErAttribute(source, entityName, attributeName, attribute), 'Edited an ER attribute');
            }}
            onDeleteErAttribute={(entityName, attributeName) => {
              mutateCanvasSource((source) => deleteErAttribute(source, entityName, attributeName), 'Deleted an ER attribute');
            }}
            onMoveErAttribute={(entityName, attributeName, direction) => {
              mutateCanvasSource((source) => moveErAttribute(source, entityName, attributeName, direction), 'Reordered ER attributes');
            }}
            onAddErRelationship={(relationship) => {
              mutateCanvasSource((source) => addErRelationship(source, relationship), 'Added an ER relationship');
            }}
            onEditErRelationship={(identity, relationship) => {
              mutateCanvasSource((source) => editErRelationship(source, identity, relationship), 'Edited an ER relationship');
            }}
            onDeleteErRelationship={(identity) => {
              mutateCanvasSource((source) => deleteErRelationship(source, identity), 'Deleted an ER relationship');
            }}
            onAddClass={(name) => { mutateCanvasSource((source) => addClass(source, name), 'Added a class'); }}
            onEditClass={(name, patch) => { mutateCanvasSource((source) => editClass(source, name, patch), 'Edited a class'); }}
            onDeleteClass={(name) => { mutateCanvasSource((source) => deleteClass(source, name), 'Deleted a class and dependent relationships'); }}
            onAddClassMember={(name, member) => { mutateCanvasSource((source) => addClassMember(source, name, member), 'Added a class member'); }}
            onEditClassMember={(name, identity, member) => { mutateCanvasSource((source) => editClassMember(source, name, identity, member), 'Edited a class member'); }}
            onDeleteClassMember={(name, identity) => { mutateCanvasSource((source) => deleteClassMember(source, name, identity), 'Deleted a class member'); }}
            onAddClassAnnotation={(name, annotation) => { mutateCanvasSource((source) => addClassAnnotation(source, name, annotation), 'Added a class annotation'); }}
            onDeleteClassAnnotation={(name, annotation) => { mutateCanvasSource((source) => deleteClassAnnotation(source, name, annotation), 'Deleted a class annotation'); }}
            onAddClassRelationship={(relationship) => { mutateCanvasSource((source) => addClassRelationship(source, relationship), 'Added a class relationship'); }}
            onEditClassRelationship={(identity, relationship) => { mutateCanvasSource((source) => editClassRelationship(source, identity, relationship), 'Edited a class relationship'); }}
            onDeleteClassRelationship={(identity) => { mutateCanvasSource((source) => deleteClassRelationship(source, identity), 'Deleted a class relationship'); }}
            onAddState={(name) => { mutateCanvasSource((source) => addState(source, name), 'Added a state'); }}
            onEditState={(id, patch) => { mutateCanvasSource((source) => editState(source, id, patch), 'Edited a state'); }}
            onDeleteState={(id) => { mutateCanvasSource((source) => deleteState(source, id), 'Deleted a state and dependent transitions'); }}
            onAddStateTransition={(transition) => { mutateCanvasSource((source) => addStateTransition(source, transition), 'Added a state transition'); }}
            onEditStateTransition={(identity, transition) => { mutateCanvasSource((source) => editStateTransition(source, identity, transition), 'Edited a state transition'); }}
            onDeleteStateTransition={(identity) => { mutateCanvasSource((source) => deleteStateTransition(source, identity), 'Deleted a state transition'); }}
            onAddRequirement={(requirement) => { mutateCanvasSource((source) => addRequirement(source, requirement), 'Added a requirement'); }}
            onEditRequirement={(name, requirement) => { mutateCanvasSource((source) => editRequirement(source, name, requirement), 'Edited a requirement'); }}
            onDeleteRequirement={(name) => { mutateCanvasSource((source) => deleteRequirement(source, name), 'Deleted a requirement and dependent relationships'); }}
            onAddRequirementRelationship={(relationship) => { mutateCanvasSource((source) => addRequirementRelationship(source, relationship), 'Added a requirement relationship'); }}
            onEditRequirementRelationship={(identity, relationship) => { mutateCanvasSource((source) => editRequirementRelationship(source, identity, relationship), 'Edited a requirement relationship'); }}
            onDeleteRequirementRelationship={(identity) => { mutateCanvasSource((source) => deleteRequirementRelationship(source, identity), 'Deleted a requirement relationship'); }}
            onAddArchitectureGroup={(group) => { mutateCanvasSource((source) => addArchitectureGroup(source, group), 'Added an architecture group'); }}
            onEditArchitectureGroup={(id, patch) => { mutateCanvasSource((source) => editArchitectureGroup(source, id, patch), 'Edited an architecture group'); }}
            onDeleteArchitectureGroup={(id) => { mutateCanvasSource((source) => deleteArchitectureGroup(source, id), 'Deleted an architecture group'); }}
            onAddArchitectureService={(service) => { mutateCanvasSource((source) => addArchitectureService(source, service), 'Added an architecture service'); }}
            onEditArchitectureService={(id, patch) => { mutateCanvasSource((source) => editArchitectureService(source, id, patch), 'Edited an architecture service'); }}
            onDeleteArchitectureService={(id) => { mutateCanvasSource((source) => deleteArchitectureService(source, id), 'Deleted an architecture service'); }}
            onAddArchitectureJunction={(junction) => { mutateCanvasSource((source) => addArchitectureJunction(source, junction), 'Added an architecture junction'); }}
            onEditArchitectureJunction={(id, patch) => { mutateCanvasSource((source) => editArchitectureJunction(source, id, patch), 'Edited an architecture junction'); }}
            onDeleteArchitectureJunction={(id) => { mutateCanvasSource((source) => deleteArchitectureJunction(source, id), 'Deleted an architecture junction'); }}
            onAddArchitectureEdge={(edge) => { mutateCanvasSource((source) => addArchitectureEdge(source, edge), 'Added an architecture edge'); }}
            onEditArchitectureEdge={(identity, edge) => { mutateCanvasSource((source) => editArchitectureEdge(source, identity, edge), 'Edited an architecture edge'); }}
            onDeleteArchitectureEdge={(identity) => { mutateCanvasSource((source) => deleteArchitectureEdge(source, identity), 'Deleted an architecture edge'); }}
            onAddArchitectureAlignment={(alignment) => { mutateCanvasSource((source) => addArchitectureAlignment(source, alignment), 'Added an architecture alignment'); }}
            onEditArchitectureAlignment={(identity, alignment) => { mutateCanvasSource((source) => editArchitectureAlignment(source, identity, alignment), 'Edited an architecture alignment'); }}
            onDeleteArchitectureAlignment={(identity) => { mutateCanvasSource((source) => deleteArchitectureAlignment(source, identity), 'Deleted an architecture alignment'); }}
            onAddC4Element={(value) => { mutateCanvasSource((source) => addC4Element(source, value), 'Added a C4 element'); }}
            onEditC4Element={(id, value) => { mutateCanvasSource((source) => editC4Element(source, id, value), 'Edited a C4 element'); }}
            onDeleteC4Element={(id) => { mutateCanvasSource((source) => deleteC4Element(source, id), 'Deleted a C4 element'); }}
            onMoveC4Element={(id, parentId) => { mutateCanvasSource((source) => moveC4Element(source, id, parentId), 'Moved a C4 element'); }}
            onMoveC4Boundary={(id, parentId) => { mutateCanvasSource((source) => moveC4Boundary(source, id, parentId), 'Moved a C4 boundary'); }}
            onAddC4Boundary={(value) => { mutateCanvasSource((source) => addC4Boundary(source, value), 'Added a C4 boundary'); }}
            onEditC4Boundary={(id, value) => { mutateCanvasSource((source) => editC4Boundary(source, id, value), 'Edited a C4 boundary'); }}
            onDeleteC4Boundary={(id) => { mutateCanvasSource((source) => deleteC4Boundary(source, id), 'Deleted a C4 boundary'); }}
            onAddC4Relationship={(value) => { mutateCanvasSource((source) => addC4Relationship(source, value), 'Added a C4 relationship'); }}
            onEditC4Relationship={(identity, value) => { mutateCanvasSource((source) => editC4Relationship(source, identity, value), 'Edited a C4 relationship'); }}
            onDeleteC4Relationship={(identity) => { mutateCanvasSource((source) => deleteC4Relationship(source, identity), 'Deleted a C4 relationship'); }}
            onAddBlockNode={(value) => { mutateCanvasSource((source) => addBlockNode(source, value), 'Added a block node'); }}
            onEditBlockNode={(id, value) => { mutateCanvasSource((source) => editBlockNode(source, id, value), 'Edited a block node'); }}
            onDeleteBlockNode={(id) => { mutateCanvasSource((source) => deleteBlockNode(source, id), 'Deleted a block node'); }}
            onMoveBlockNode={(id, parentId) => { mutateCanvasSource((source) => moveBlockNode(source, id, parentId), 'Moved a block'); }}
            onMoveBlockComposite={(id, parentId) => { mutateCanvasSource((source) => moveBlockComposite(source, id, parentId), 'Moved a block composite'); }}
            onAddBlockComposite={(value) => { mutateCanvasSource((source) => addBlockComposite(source, value), 'Added a block composite'); }}
            onEditBlockComposite={(id, value) => { mutateCanvasSource((source) => editBlockComposite(source, id, value), 'Edited a block composite'); }}
            onDeleteBlockComposite={(id) => { mutateCanvasSource((source) => deleteBlockComposite(source, id), 'Deleted a block composite'); }}
            onSetBlockColumns={(value) => { mutateCanvasSource((source) => setBlockColumns(source, value), 'Set block columns'); }}
            onAddBlockLink={(value) => { mutateCanvasSource((source) => addBlockLink(source, value), 'Added a block link'); }}
            onEditBlockLink={(identity, value) => { mutateCanvasSource((source) => editBlockLink(source, identity, value), 'Edited a block link'); }}
            onDeleteBlockLink={(identity) => { mutateCanvasSource((source) => deleteBlockLink(source, identity), 'Deleted a block link'); }}
            onAddSwimlane={(value) => { mutateCanvasSource((source) => addSwimlane(source, value), 'Added a swimlane lane'); }}
            onEditSwimlane={(id, value) => { mutateCanvasSource((source) => editSwimlane(source, id, value), 'Edited a swimlane lane'); }}
            onDeleteSwimlane={(id) => { mutateCanvasSource((source) => deleteSwimlane(source, id), 'Deleted a swimlane lane'); }}
            onAddSwimlaneNode={(value) => { mutateCanvasSource((source) => addSwimlaneNode(source, value), 'Added a swimlane node'); }}
            onEditSwimlaneNode={(id, value) => { mutateCanvasSource((source) => editSwimlaneNode(source, id, value), 'Edited a swimlane node'); }}
            onMoveSwimlaneNode={(id, laneId) => { mutateCanvasSource((source) => moveSwimlaneNode(source, id, laneId), 'Moved a swimlane node'); }}
            onDeleteSwimlaneNode={(id) => { mutateCanvasSource((source) => deleteSwimlaneNode(source, id), 'Deleted a swimlane node'); }}
            onAddSwimlaneHandoff={(value) => { mutateCanvasSource((source) => addSwimlaneHandoff(source, value), 'Added a swimlane handoff'); }}
            onEditSwimlaneHandoff={(identity, value) => { mutateCanvasSource((source) => editSwimlaneHandoff(source, identity, value), 'Edited a swimlane handoff'); }}
            onDeleteSwimlaneHandoff={(identity) => { mutateCanvasSource((source) => deleteSwimlaneHandoff(source, identity), 'Deleted a swimlane handoff'); }}
            onAddJourneySection={(value) => { mutateCanvasSource((source) => addJourneySection(source, value), 'Added a journey section'); }}
            onDeleteJourneySection={(label) => { mutateCanvasSource((source) => deleteJourneySection(source, label), 'Deleted a journey section'); }}
            onEditJourneySection={(label, value) => { mutateCanvasSource((source) => editJourneySection(source, label, value), 'Edited a journey section'); }}
            onMoveJourneySection={(label, direction) => { mutateCanvasSource((source) => moveJourneySection(source, label, direction), 'Reordered journey sections'); }}
            onAddJourneyTask={(value) => { mutateCanvasSource((source) => addJourneyTask(source, value), 'Added a journey task'); }}
            onEditJourneyTask={(identity, value) => { mutateCanvasSource((source) => editJourneyTask(source, identity, value), 'Edited a journey task'); }}
            onDeleteJourneyTask={(identity) => { mutateCanvasSource((source) => deleteJourneyTask(source, identity), 'Deleted a journey task'); }}
            onMoveJourneyTask={(identity, direction) => { mutateCanvasSource((source) => moveJourneyTask(source, identity, direction), 'Reordered journey tasks'); }}
            onAddGanttSection={(value) => { mutateCanvasSource((source) => addGanttSection(source, value), 'Added a Gantt section'); }}
            onDeleteGanttSection={(label) => { mutateCanvasSource((source) => deleteGanttSection(source, label), 'Deleted a Gantt section'); }}
            onEditGanttSection={(label, value) => { mutateCanvasSource((source) => editGanttSection(source, label, value), 'Edited a Gantt section'); }}
            onMoveGanttSection={(label, direction) => { mutateCanvasSource((source) => moveGanttSection(source, label, direction), 'Reordered Gantt sections'); }}
            onAddGanttTask={(value) => { mutateCanvasSource((source) => addGanttTask(source, value), 'Added a Gantt task'); }}
            onEditGanttTask={(identity, value) => { mutateCanvasSource((source) => editGanttTask(source, identity, value), 'Edited a Gantt task'); }}
            onDeleteGanttTask={(identity) => { mutateCanvasSource((source) => deleteGanttTask(source, identity), 'Deleted a Gantt task'); }}
            onMoveGanttTask={(identity, direction) => { mutateCanvasSource((source) => moveGanttTask(source, identity, direction), 'Reordered Gantt tasks'); }}
            onAddTimelineSection={(value) => { mutateCanvasSource((source) => addTimelineSection(source, value), 'Added a timeline section'); }}
            onDeleteTimelineSection={(label) => { mutateCanvasSource((source) => deleteTimelineSection(source, label), 'Deleted a timeline section'); }}
            onEditTimelineSection={(label, value) => { mutateCanvasSource((source) => editTimelineSection(source, label, value), 'Edited a timeline section'); }}
            onMoveTimelineSection={(label, direction) => { mutateCanvasSource((source) => moveTimelineSection(source, label, direction), 'Reordered timeline sections'); }}
            onAddTimelinePeriod={(value) => { mutateCanvasSource((source) => addTimelinePeriod(source, value), 'Added a timeline period'); }}
            onEditTimelinePeriod={(label, value) => { mutateCanvasSource((source) => editTimelinePeriod(source, label, value), 'Edited a timeline period'); }}
            onMoveTimelinePeriod={(label, section) => { mutateCanvasSource((source) => moveTimelinePeriod(source, label, section), 'Moved a timeline period'); }}
            onDeleteTimelinePeriod={(label) => { mutateCanvasSource((source) => deleteTimelinePeriod(source, label), 'Deleted a timeline period'); }}
            onAddTimelineEvent={(value) => { mutateCanvasSource((source) => addTimelineEvent(source, value), 'Added a timeline event'); }}
            onEditTimelineEvent={(identity, value) => { mutateCanvasSource((source) => editTimelineEvent(source, identity, value), 'Edited a timeline event'); }}
            onDeleteTimelineEvent={(identity) => { mutateCanvasSource((source) => deleteTimelineEvent(source, identity), 'Deleted a timeline event'); }}
            onMoveTimelineEvent={(identity, direction) => { mutateCanvasSource((source) => moveTimelineEvent(source, identity, direction), 'Reordered timeline events'); }}
            onSetTimelineDirection={(value) => { mutateCanvasSource((source) => setTimelineDirection(source, value), 'Updated timeline direction'); }}
            onAddGitGraphCommit={(value) => { mutateCanvasSource((source) => addGitGraphCommit(source, value), 'Added a GitGraph commit'); }}
            onEditGitGraphCommit={(index, value) => { mutateCanvasSource((source) => editGitGraphCommit(source, index, value), 'Edited a GitGraph commit'); }}
            onAddGitGraphBranch={(value) => { mutateCanvasSource((source) => addGitGraphBranch(source, value), 'Added a GitGraph branch'); }}
            onEditGitGraphBranch={(index, value) => { mutateCanvasSource((source) => editGitGraphBranch(source, index, value), 'Edited a GitGraph branch'); }}
            onAddGitGraphCheckout={(value) => { mutateCanvasSource((source) => addGitGraphCheckout(source, value), 'Added a GitGraph checkout'); }}
            onEditGitGraphCheckout={(index, value) => { mutateCanvasSource((source) => editGitGraphCheckout(source, index, value), 'Edited a GitGraph checkout'); }}
            onAddGitGraphMerge={(value) => { mutateCanvasSource((source) => addGitGraphMerge(source, value), 'Added a GitGraph merge'); }}
            onEditGitGraphMerge={(index, value) => { mutateCanvasSource((source) => editGitGraphMerge(source, index, value), 'Edited a GitGraph merge'); }}
            onAddGitGraphCherryPick={(value) => { mutateCanvasSource((source) => addGitGraphCherryPick(source, value), 'Added a GitGraph cherry-pick'); }}
            onEditGitGraphCherryPick={(index, value) => { mutateCanvasSource((source) => editGitGraphCherryPick(source, index, value), 'Edited a GitGraph cherry-pick'); }}
            onDeleteGitGraphOperation={(index) => { mutateCanvasSource((source) => deleteGitGraphOperation(source, index), 'Deleted a GitGraph operation'); }}
            onMoveGitGraphOperation={(from, to) => { mutateCanvasSource((source) => moveGitGraphOperation(source, from, to), 'Reordered GitGraph history'); }}
            onAddEventModelingTimeframe={(value) => { mutateCanvasSource((source) => addEventModelingTimeframe(source, value), 'Added an Event Modeling timeframe'); }}
            onEditEventModelingTimeframe={(index, value) => { mutateCanvasSource((source) => editEventModelingTimeframe(source, index, value), 'Edited an Event Modeling timeframe'); }}
            onDeleteEventModelingTimeframe={(index) => { mutateCanvasSource((source) => deleteEventModelingTimeframe(source, index), 'Deleted an Event Modeling timeframe'); }}
            onMoveEventModelingTimeframe={(index, target) => { mutateCanvasSource((source) => moveEventModelingTimeframe(source, index, target), 'Reordered Event Modeling timeframes'); }}
            onAddEventModelingEntity={(name) => { mutateCanvasSource((source) => addEventModelingEntity(source, name), 'Added an Event Modeling entity'); }}
            onRenameEventModelingEntity={(name, next) => { mutateCanvasSource((source) => renameEventModelingEntity(source, name, next), 'Renamed an Event Modeling entity'); }}
            onDeleteEventModelingEntity={(name) => { mutateCanvasSource((source) => deleteEventModelingEntity(source, name), 'Deleted an Event Modeling entity'); }}
            onAddEventModelingData={(value) => { mutateCanvasSource((source) => addEventModelingDataBlock(source, value), 'Added an Event Modeling data block'); }}
            onEditEventModelingData={(name, value) => { mutateCanvasSource((source) => editEventModelingDataBlock(source, name, value), 'Edited an Event Modeling data block'); }}
            onDeleteEventModelingData={(name) => { mutateCanvasSource((source) => deleteEventModelingDataBlock(source, name), 'Deleted an Event Modeling data block'); }}
            onAddKanbanColumn={(value) => { mutateCanvasSource((source) => addKanbanColumn(source, value), 'Added a Kanban column'); }}
            onEditKanbanColumn={(id, value) => { mutateCanvasSource((source) => editKanbanColumn(source, id, value), 'Edited a Kanban column'); }}
            onDeleteKanbanColumn={(id) => { mutateCanvasSource((source) => deleteKanbanColumn(source, id), 'Deleted a Kanban column'); }}
            onAddKanbanCard={(value) => { mutateCanvasSource((source) => addKanbanCard(source, value), 'Added a Kanban card'); }}
            onEditKanbanCard={(id, value) => { mutateCanvasSource((source) => editKanbanCard(source, id, value), 'Edited a Kanban card'); }}
            onDeleteKanbanCard={(id) => { mutateCanvasSource((source) => deleteKanbanCard(source, id), 'Deleted a Kanban card'); }}
            onMoveKanbanCard={(id, column, target) => { mutateCanvasSource((source) => moveKanbanCard(source, id, column, target), 'Moved a Kanban card'); }}
            onAddMindmapNode={(value, parent) => { mutateCanvasSource((source) => addMindmapNode(source, value, parent), 'Added a Mindmap node'); }}
            onEditMindmapNode={(identity, value) => { mutateCanvasSource((source) => editMindmapNode(source, identity, value), 'Edited a Mindmap node'); }}
            onDeleteMindmapNode={(identity) => { mutateCanvasSource((source) => deleteMindmapNode(source, identity), 'Deleted a Mindmap node'); }}
            onMoveMindmapNode={(identity, direction) => { mutateCanvasSource((source) => moveMindmapNode(source, identity, direction), 'Reordered Mindmap nodes'); }}
            onReparentMindmapNode={(identity, parent) => { mutateCanvasSource((source) => reparentMindmapNode(source, identity, parent), 'Reparented a Mindmap node'); }}
            onAddTreeViewNode={(value, parent) => { mutateCanvasSource((source) => addTreeViewNode(source, value, parent), 'Added a TreeView node'); }}
            onEditTreeViewNode={(identity, value) => { mutateCanvasSource((source) => editTreeViewNode(source, identity, value), 'Edited a TreeView node'); }}
            onDeleteTreeViewNode={(identity) => { mutateCanvasSource((source) => deleteTreeViewNode(source, identity), 'Deleted a TreeView node'); }}
            onMoveTreeViewNode={(identity, direction) => { mutateCanvasSource((source) => moveTreeViewNode(source, identity, direction), 'Reordered TreeView nodes'); }}
            onReparentTreeViewNode={(identity, parent) => { mutateCanvasSource((source) => reparentTreeViewNode(source, identity, parent), 'Reparented a TreeView node'); }}
            onSetIshikawaEffect={(value) => { mutateCanvasSource((source) => setIshikawaEffect(source, value), 'Updated the Ishikawa effect'); }}
            onEditIshikawaEffect={(value) => { mutateCanvasSource((source) => editIshikawaEffect(source, value), 'Edited the Ishikawa effect'); }}
            onAddIshikawaCause={(value) => { mutateCanvasSource((source) => addIshikawaCause(source, value), 'Added an Ishikawa cause'); }}
            onEditIshikawaCause={(identity, value) => { mutateCanvasSource((source) => editIshikawaCause(source, identity, value), 'Edited an Ishikawa cause'); }}
            onDeleteIshikawaCause={(identity) => { mutateCanvasSource((source) => deleteIshikawaCause(source, identity), 'Deleted an Ishikawa cause'); }}
            onMoveIshikawaCause={(identity, direction) => { mutateCanvasSource((source) => moveIshikawaCause(source, identity, direction), 'Reordered Ishikawa causes'); }}
            onReparentIshikawaCause={(identity, parent) => { mutateCanvasSource((source) => reparentIshikawaCause(source, identity, parent), 'Reparented an Ishikawa cause'); }}
            onAddRailroadRule={(rule) => { mutateCanvasSource((source) => addRailroadRule(source, rule), 'Added a Railroad rule'); }}
            onEditRailroadRule={(identity, patch) => { mutateCanvasSource((source) => editRailroadRule(source, identity, patch), 'Edited a Railroad rule'); }}
            onRenameRailroadRule={(identity, name) => { mutateCanvasSource((source) => renameRailroadRule(source, identity, name), 'Renamed a Railroad rule'); }}
            onDeleteRailroadRule={(identity) => { mutateCanvasSource((source) => deleteRailroadRule(source, identity), 'Deleted a Railroad rule'); }}
            onMoveRailroadRule={(identity, direction) => { mutateCanvasSource((source) => moveRailroadRule(source, identity, direction), 'Reordered Railroad rules'); }}
            onEditPieTitle={(title) => { mutateCanvasSource((source) => editPieTitle(source, title), 'Updated the Pie title'); }}
            onSetPieShowData={(showData) => { mutateCanvasSource((source) => setPieShowData(source, showData), 'Updated Pie value labels'); }}
            onAddPieSlice={(slice) => mutateCanvasSource((source) => addPieSlice(source, slice), 'Added a Pie slice')}
            onEditPieSlice={(identity, patch) => mutateCanvasSource((source) => editPieSlice(source, identity, patch), 'Edited a Pie slice')}
            onDeletePieSlice={(identity) => { mutateCanvasSource((source) => deletePieSlice(source, identity), 'Deleted a Pie slice'); }}
            onMovePieSlice={(identity, direction) => { mutateCanvasSource((source) => movePieSlice(source, identity, direction), 'Reordered Pie slices'); }}
            onEditQuadrantTitle={(title) => { mutateCanvasSource((source) => editQuadrantTitle(source, title), 'Updated the Quadrant title'); }}
            onSetQuadrantAxis={(axis, value) => { mutateCanvasSource((source) => setQuadrantAxis(source, axis, value), 'Updated a Quadrant axis'); }}
            onSetQuadrantLabel={(quadrant, label) => { mutateCanvasSource((source) => setQuadrantLabel(source, quadrant, label), 'Updated a Quadrant label'); }}
            onAddQuadrantPoint={(point) => mutateCanvasSource((source) => addQuadrantPoint(source, point), 'Added a Quadrant point')}
            onEditQuadrantPoint={(identity, patch) => mutateCanvasSource((source) => editQuadrantPoint(source, identity, patch), 'Edited a Quadrant point')}
            onDeleteQuadrantPoint={(identity) => { mutateCanvasSource((source) => deleteQuadrantPoint(source, identity), 'Deleted a Quadrant point'); }}
            onMoveQuadrantPoint={(identity, direction) => { mutateCanvasSource((source) => moveQuadrantPoint(source, identity, direction), 'Reordered Quadrant points'); }}
            onEditXyTitle={(title) => { mutateCanvasSource((source) => editXyTitle(source, title), 'Updated the XY chart title'); }}
            onSetXyOrientation={(orientation) => { mutateCanvasSource((source) => setXyOrientation(source, orientation), 'Updated the XY chart orientation'); }}
            onEditXyAxis={(axis, value) => mutateCanvasSource((source) => editXyAxis(source, axis, value), 'Updated an XY chart axis')}
            onAddXySeries={(series) => mutateCanvasSource((source) => addXySeries(source, series), 'Added an XY chart series')}
            onEditXySeries={(identity, patch) => mutateCanvasSource((source) => editXySeries(source, identity, patch), 'Edited an XY chart series')}
            onDeleteXySeries={(identity) => { mutateCanvasSource((source) => deleteXySeries(source, identity), 'Deleted an XY chart series'); }}
            onMoveXySeries={(identity, direction) => { mutateCanvasSource((source) => moveXySeries(source, identity, direction), 'Reordered XY chart series'); }}
            onEditRadarTitle={(title) => { mutateCanvasSource((source) => editRadarTitle(source, title), 'Updated the Radar title'); }}
            onEditRadarOptions={(patch) => mutateCanvasSource((source) => editRadarOptions(source, patch), 'Updated Radar options')}
            onAddRadarAxis={(axis, values) => mutateCanvasSource((source) => addRadarAxis(source, axis, values), 'Added a Radar axis')}
            onEditRadarAxis={(identity, patch) => { mutateCanvasSource((source) => editRadarAxis(source, identity, patch), 'Edited a Radar axis'); }}
            onDeleteRadarAxis={(identity) => { mutateCanvasSource((source) => deleteRadarAxis(source, identity), 'Deleted a Radar axis'); }}
            onMoveRadarAxis={(identity, direction) => { mutateCanvasSource((source) => moveRadarAxis(source, identity, direction), 'Reordered Radar axes'); }}
            onAddRadarCurve={(curve) => mutateCanvasSource((source) => addRadarCurve(source, curve), 'Added a Radar curve')}
            onEditRadarCurve={(identity, patch) => mutateCanvasSource((source) => editRadarCurve(source, identity, patch), 'Edited a Radar curve')}
            onDeleteRadarCurve={(identity) => { mutateCanvasSource((source) => deleteRadarCurve(source, identity), 'Deleted a Radar curve'); }}
            onMoveRadarCurve={(identity, direction) => { mutateCanvasSource((source) => moveRadarCurve(source, identity, direction), 'Reordered Radar curves'); }}
            onAddSankeyLink={(link) => mutateCanvasSource((source) => addSankeyLink(source, link), 'Added a Sankey link')}
            onEditSankeyLink={(identity, patch) => mutateCanvasSource((source) => editSankeyLink(source, identity, patch), 'Edited a Sankey link')}
            onDeleteSankeyLink={(identity) => { mutateCanvasSource((source) => deleteSankeyLink(source, identity), 'Deleted a Sankey link'); }}
            onMoveSankeyLink={(identity, direction) => { mutateCanvasSource((source) => moveSankeyLink(source, identity, direction), 'Reordered Sankey links'); }}
            onRenameSankeyNode={(identity, label) => mutateCanvasSource((source) => renameSankeyNode(source, identity, label), 'Renamed a Sankey node')}
            onAddPacketField={(field) => mutateCanvasSource((source) => addPacketField(source, field), 'Added a Packet field')}
            onEditPacketField={(identity, patch) => mutateCanvasSource((source) => editPacketField(source, identity, patch), 'Edited a Packet field')}
            onDeletePacketField={(identity) => { mutateCanvasSource((source) => deletePacketField(source, identity), 'Deleted a Packet field'); }}
            onMovePacketField={(identity, direction) => { mutateCanvasSource((source) => movePacketField(source, identity, direction), 'Reordered Packet fields'); }}
            onAddCynefinItem={(item) => mutateCanvasSource((source) => addCynefinItem(source, item), `Added an item to the ${item.domain} Cynefin domain`)}
            onEditCynefinItem={(identity, patch) => mutateCanvasSource((source) => editCynefinItem(source, identity, patch), 'Edited a Cynefin item')}
            onDeleteCynefinItem={(identity) => { mutateCanvasSource((source) => deleteCynefinItem(source, identity), 'Deleted a Cynefin item'); }}
            onMoveCynefinItem={(identity, domain, targetIndex) => { mutateCanvasSource((source) => moveCynefinItem(source, identity, domain, targetIndex), `Moved a Cynefin item to the ${domain} domain`); }}
            onAddCynefinTransition={(transition) => mutateCanvasSource((source) => addCynefinTransition(source, transition), 'Added a Cynefin transition')}
            onEditCynefinTransition={(identity, patch) => mutateCanvasSource((source) => editCynefinTransition(source, identity, patch), 'Edited a Cynefin transition')}
            onDeleteCynefinTransition={(identity) => { mutateCanvasSource((source) => deleteCynefinTransition(source, identity), 'Deleted a Cynefin transition'); }}
            onMoveCynefinTransition={(identity, direction) => { mutateCanvasSource((source) => moveCynefinTransition(source, identity, direction), 'Reordered Cynefin transitions'); }}
            onAddTreemapNode={(node, parent) => mutateCanvasSourceDetailed((source) => addTreemapNode(source, node, parent), 'Added a Treemap node')}
            onEditTreemapNode={(identity, patch) => mutateCanvasSourceDetailed((source) => editTreemapNode(source, identity, patch), 'Edited a Treemap node')}
            onDeleteTreemapNode={(identity) => mutateCanvasSourceDetailed((source) => deleteTreemapNode(source, identity), 'Deleted a Treemap subtree')}
            onMoveTreemapNode={(identity, direction) => mutateCanvasSourceDetailed((source) => moveTreemapNode(source, identity, direction), 'Reordered Treemap node')}
            onReparentTreemapNode={(identity, parent) => mutateCanvasSourceDetailed((source) => reparentTreemapNode(source, identity, parent), 'Moved Treemap subtree')}
            onAddVennSubset={(subset) => mutateCanvasSourceDetailed((source) => addVennSubset(source, subset), 'Added a Venn subset')}
            onEditVennSubset={(identity, patch) => mutateCanvasSourceDetailed((source) => editVennSubset(source, identity, patch), 'Edited a Venn subset')}
            onDeleteVennSubset={(identity) => mutateCanvasSourceDetailed((source) => deleteVennSubset(source, identity), 'Deleted a Venn subset')}
            onMoveVennSubset={(identity, direction) => mutateCanvasSourceDetailed((source) => moveVennSubset(source, identity, direction), 'Reordered Venn subset')}
            onRenameVennSet={(identity, value) => mutateCanvasSourceDetailed((source) => renameVennSet(source, identity, value), 'Renamed a Venn set')}
            onAddVennStyle={(style) => mutateCanvasSourceDetailed((source) => addVennStyle(source, style), 'Added a Venn style')}
            onEditVennStyle={(identity, patch) => mutateCanvasSourceDetailed((source) => editVennStyle(source, identity, patch), 'Edited a Venn style')}
            onDeleteVennStyle={(identity) => mutateCanvasSourceDetailed((source) => deleteVennStyle(source, identity), 'Deleted a Venn style')}
            onMoveVennStyle={(identity, direction) => mutateCanvasSourceDetailed((source) => moveVennStyle(source, identity, direction), 'Reordered Venn style')}
            onAddWardleyNode={(node) => mutateCanvasSourceDetailed((source) => addWardleyNode(source, node), 'Added a Wardley node')}
            onEditWardleyNode={(identity, patch) => mutateCanvasSourceDetailed((source) => editWardleyNode(source, identity, patch), 'Edited a Wardley node')}
            onRenameWardleyNode={(identity, name) => mutateCanvasSourceDetailed((source) => renameWardleyNode(source, identity, name), 'Renamed a Wardley node')}
            onDeleteWardleyNode={(identity) => mutateCanvasSourceDetailed((source) => deleteWardleyNode(source, identity), 'Deleted a Wardley node')}
            onMoveWardleyNode={(identity, direction) => mutateCanvasSourceDetailed((source) => moveWardleyNode(source, identity, direction), 'Reordered Wardley nodes')}
            onAddWardleyLink={(link) => mutateCanvasSourceDetailed((source) => addWardleyLink(source, link), 'Added a Wardley link')}
            onEditWardleyLink={(identity, patch) => mutateCanvasSourceDetailed((source) => editWardleyLink(source, identity, patch), 'Edited a Wardley link')}
            onDeleteWardleyLink={(identity) => mutateCanvasSourceDetailed((source) => deleteWardleyLink(source, identity), 'Deleted a Wardley link')}
            onMoveWardleyLink={(identity, direction) => mutateCanvasSourceDetailed((source) => moveWardleyLink(source, identity, direction), 'Reordered Wardley links')}
            onAddWardleyEvolution={(evolution) => mutateCanvasSourceDetailed((source) => addWardleyEvolution(source, evolution), 'Added a Wardley evolution')}
            onEditWardleyEvolution={(identity, patch) => mutateCanvasSourceDetailed((source) => editWardleyEvolution(source, identity, patch), 'Edited a Wardley evolution')}
            onDeleteWardleyEvolution={(identity) => mutateCanvasSourceDetailed((source) => deleteWardleyEvolution(source, identity), 'Deleted a Wardley evolution')}
            onAddWardleyNote={(note) => mutateCanvasSourceDetailed((source) => addWardleyNote(source, note), 'Added a Wardley note')}
            onEditWardleyNote={(identity, patch) => mutateCanvasSourceDetailed((source) => editWardleyNote(source, identity, patch), 'Edited a Wardley note')}
            onDeleteWardleyNote={(identity) => mutateCanvasSourceDetailed((source) => deleteWardleyNote(source, identity), 'Deleted a Wardley note')}
            onMoveWardleyNote={(identity, direction) => mutateCanvasSourceDetailed((source) => moveWardleyNote(source, identity, direction), 'Reordered Wardley notes')}
            onAddWardleyPipeline={(pipeline) => mutateCanvasSourceDetailed((source) => addWardleyPipeline(source, pipeline), 'Added a Wardley pipeline')}
            onDeleteWardleyPipeline={(identity) => mutateCanvasSourceDetailed((source) => deleteWardleyPipeline(source, identity), 'Deleted a Wardley pipeline')}
            onAddZenUmlParticipant={(participant) => mutateCanvasSourceDetailed((source) => addZenUmlParticipant(source, participant), 'Added a ZenUML participant')}
            onEditZenUmlParticipant={(identity, patch) => mutateCanvasSourceDetailed((source) => editZenUmlParticipant(source, identity, patch), 'Edited a ZenUML participant')}
            onDeleteZenUmlParticipant={(identity) => mutateCanvasSourceDetailed((source) => deleteZenUmlParticipant(source, identity), 'Deleted a ZenUML participant')}
            onMoveZenUmlParticipant={(identity, direction) => mutateCanvasSourceDetailed((source) => moveZenUmlParticipant(source, identity, direction), 'Reordered ZenUML participants')}
            onAddZenUmlMessage={(message, parent) => mutateCanvasSourceDetailed((source) => addZenUmlMessage(source, message, parent), 'Added a ZenUML message')}
            onEditZenUmlMessage={(identity, patch) => mutateCanvasSourceDetailed((source) => editZenUmlMessage(source, identity, patch), 'Edited a ZenUML message')}
            onDeleteZenUmlMessage={(identity) => mutateCanvasSourceDetailed((source) => deleteZenUmlMessage(source, identity), 'Deleted a ZenUML message')}
            onMoveZenUmlMessage={(identity, direction) => mutateCanvasSourceDetailed((source) => moveZenUmlMessage(source, identity, direction), 'Reordered ZenUML messages')}
            onAddZenUmlControl={(control, parent) => mutateCanvasSourceDetailed((source) => addZenUmlControl(source, control, parent), 'Added a ZenUML control')}
            onEditZenUmlControl={(identity, patch) => mutateCanvasSourceDetailed((source) => editZenUmlControl(source, identity, patch), 'Edited a ZenUML control')}
            onDeleteZenUmlControl={(identity) => mutateCanvasSourceDetailed((source) => deleteZenUmlControl(source, identity), 'Deleted a ZenUML control')}
            onMoveZenUmlControl={(identity, direction) => mutateCanvasSourceDetailed((source) => moveZenUmlControl(source, identity, direction), 'Reordered ZenUML controls')}
            onAddConnectedNode={handleAddConnectedNode}
            onCanvasCursorChange={handleCanvasCursorChange}
            onLaserChange={handleLaserChange}
            onChangeNodeShape={(nodeId, shape) => {
              const queue = mutationQueueRef.current;
              if (queue) runVisualSourceMutation(queue.changeNodeShape(nodeId, shape));
            }}
            onChooseDiagramType={(type) => {
              if (type === 'flowchart') {
                const queue = mutationQueueRef.current;
                if (queue) runVisualSourceMutation(queue.addNode(), 'Started a flowchart diagram');
              } else {
                mutateCanvasSource(() => 'sequenceDiagram', 'Started a sequence diagram');
              }
            }}
            onDeleteNodes={(ids) => {
              for (const id of ids) {
                const queue = mutationQueueRef.current;
                if (queue) runVisualSourceMutation(queue.removeNode(id));
              }
            }}
            onDeleteEdge={(edge) => {
              const queue = mutationQueueRef.current;
              if (queue) {
                runVisualSourceMutation(queue.removeEdgeByIdentity(edge));
              }
            }}
            onEditEdgeLabel={(edge, label) => {
              const queue = mutationQueueRef.current;
              if (queue) {
                runVisualSourceMutation(queue.editEdgeLabelByIdentity(edge, label));
              }
            }}
            onEditNodeLabel={(nodeId, label) => {
              const queue = mutationQueueRef.current;
              if (queue) runVisualSourceMutation(queue.editNodeLabel(nodeId, label));
            }}
            onNodeEditingChange={handleNodeEditingChange}
            onEditSubgraphLabel={(subgraphId, label) => {
              const queue = mutationQueueRef.current;
              if (queue) runVisualSourceMutation(queue.editSubgraphLabel(subgraphId, label), 'Renamed a diagram section');
            }}
            onGroupNodes={(ids, label) => {
              const queue = mutationQueueRef.current;
              if (queue) runVisualSourceMutation(queue.groupNodes(ids, label));
            }}
            onInteractionModeChange={handleCanvasToolChange}
            onCanvasToolChange={handleCanvasToolChange}
            onNodeDrag={handleNodeDrag}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={handleNodeDragStop}
            onNodePositionsChange={handleNodePositionsChange}
            onPasteClipboard={handlePasteClipboard}
            onRedo={handleCanvasRedo}
            onResetSharedLayout={handleResetSharedLayout}
            onRenderSettled={handleCanvasRenderSettled}
            onSelectedNodeIdsChange={setSelectedNodeIds}
            onUngroupNodes={(id) => {
              const queue = mutationQueueRef.current;
              if (queue) runVisualSourceMutation(queue.ungroupSubgraph(id));
            }}
            selectedNodeIds={selectedNodeIds}
            sequenceParticipants={sequenceParticipants}
            sequenceDiagram={sequenceDiagram}
            sequenceTextItems={sequenceTextItems}
            erDiagram={erDiagram}
            classDiagram={classDiagram}
            stateDiagram={stateDiagram}
            requirementDiagram={requirementDiagram}
            svg={renderedPreview?.svg ?? ''}
            theme={resolvedTheme}
            onUndo={handleCanvasUndo}
          />
        </article>

        <WorkspaceFlyouts
          activeDiagramName={getActiveDiagramName(diagrams, activeDiagramId) ?? 'No diagram selected'}
          activity={activity}
          activityCloseRef={activityCloseRef}
          closeFlyout={closeFlyout}
          editorHostRef={editorHostRef}
          editorStatusLabel={editorStatusLabel}
          getActivityColor={getActivityColor}
          getActivityDescription={describeActivityCompact}
          getTimestampLabel={formatTimestamp}
          history={diagramHistory}
          historyError={historyError}
          historyLoading={historyLoading}
          historyView={activityFlyoutView}
          historyAvailable={!isLocalWorkspace}
          onCancelPreview={cancelHistoryPreview}
          onCopyGitHubMermaid={handleCopyGitHubMermaid}
          onHistoryViewChange={setActivityFlyoutView}
          onPreviewRevision={previewHistoryRevision}
          onRestoreCancel={cancelHistoryRestore}
          onRestoreConfirm={confirmHistoryRestore}
          onRestoreRequest={requestHistoryRestore}
          openFlyout={openFlyout}
          participants={participants}
          previewError={historyPreviewError}
          previewRevision={historyPreview}
          restoreCandidate={restoreCandidate}
          restoreError={restoreError}
          restorePending={restorePending}
          restoreConfirmRef={restoreConfirmRef}
          sourceError={historyPreviewError ?? renderError}
          sourceFlyoutWidth={sourceFlyoutWidth}
          sourceGitHubCopyState={sourceGitHubCopyState}
          onSourceFlyoutWidthChange={setSourceFlyoutWidth}
        />
      </section>

      <WorkspaceFooter
        activityCount={activity.length}
        activityOpen={openFlyout === 'activity'}
        activityStatusLabel={activityStatusLabel}
        connectionState={connectionState}
        getAvatarText={getParticipantAvatarText}
        getParticipantName={getParticipantDisplayName}
        isLocalWorkspace={isLocalWorkspace}
        onActivityToggle={(origin) => { toggleFlyout('activity', origin); }}
        participants={participants}
        saveStatusLabel={saveStatusLabel}
      />

      <div
        aria-atomic="true"
        aria-live="polite"
        className={`workspace-touch-label-status${touchLabelStatus ? ' is-visible' : ''}`}
        data-testid="workspace-touch-label-status"
        role="status"
      >{touchLabelStatus?.label ?? ''}</div>

      <div
        aria-atomic="true"
        aria-live="polite"
        className={`workspace-touch-label-status${canvasHistoryNotice ? ' is-visible' : ''}`}
        data-testid="canvas-history-status"
        role="status"
      >{canvasHistoryNotice ?? ''}</div>

      <p aria-live="polite" className="visually-hidden">{roomKeyAnnouncement}</p>

      {showConnectModal ? (
        <div className="modal-backdrop" onClick={closeConnectModal}>
          <div className="modal-dialog" ref={connectModalDialogRef} role="dialog" aria-modal="true" aria-labelledby="connect-agent-title" onClick={(event) => { event.stopPropagation(); }}>
            <div className="modal-header">
              <span className="modal-title" id="connect-agent-title">Agent connection</span>
              <button className="modal-close" ref={connectModalCloseRef} type="button" onClick={closeConnectModal} aria-label="Close">
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-connection-details" data-testid="agent-connection-details">
                <p><span>Session status</span><strong>{connectionLabels[connectionState]}</strong></p>
                <p><span>Agents</span><strong>{getAgentCountLabel(connectedAgentCount)}</strong></p>
              </div>
              {roomKey ? (
                <div className="modal-prompt-block">
                  <pre className="modal-prompt-text">{getAgentPrompt()}</pre>
                  <button className="workspace-copy-button modal-prompt-copy" type="button" onClick={handleCopyAgentPrompt}>
                    {promptCopyLabel}
                  </button>
                </div>
              ) : (
                <p className="modal-key-unavailable" role="status">
                  This browser has room access through its cookie, but no shareable key in memory. Open Settings and reset the room key before copying agent instructions.
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
