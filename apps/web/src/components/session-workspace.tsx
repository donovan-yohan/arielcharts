'use client';

import type { ActivityEvent, AwarenessState, Participant, StarterTemplateId } from '@arielcharts/shared';
import { APP_NAME, STARTER_TEMPLATES, getStarterTemplate } from '@arielcharts/shared';
import { basicSetup } from 'codemirror';
import mermaid from 'mermaid';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { Check, ChevronDown } from 'lucide-react';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { DiagramCanvas } from './diagram-canvas';
import { ThemeControl } from './theme-control';
import { useTheme } from './theme-provider';
import { WorkspaceFlyouts } from './workspace-flyouts';
import { WorkspaceFooter } from './workspace-footer';
import { WorkspaceTabStrip, type WorkspaceDiagramTab } from './workspace-tab-strip';
import {
  MutationQueue,
  observeMutationFailure,
  parseFlowchartSnapshot,
  type DiagramLinkType,
  type DiagramNodeShape,
  type FlowchartSnapshot,
} from '../lib/diagram-mutations';
import {
  readNodePositions,
  writeNodePositions,
  type DiagramNodePosition,
  type DiagramNodePositions,
  type NodePositionsSyncMode,
} from '../lib/diagram-layout';
import { classifyDiagramCapability } from '../lib/diagram-capabilities';
import { canUseFlowchartControls, DiagramPreviewRegistry, type DiagramPreview } from '../lib/diagram-preview';
import { collaborationOrigins, createDiagramUndoManager, destroyDiagramUndoManager } from '../lib/collaboration-origins';
import { DragLayoutCommitter, getDragLayoutTeardownOptions } from '../lib/drag-layout';
import { getAcceptedGenericSourceLayoutPolicy, getSourceLayoutPolicy, pruneNodePositions, type SourceLayoutPolicy } from '../lib/source-layout-lifecycle';
import { getSessionPath, getWebsocketServerUrl } from '../lib/session';
import { getMermaidThemeVariables } from '../lib/theme';
import { getNextWorkspaceFlyout, type WorkspaceFlyout } from '../lib/workspace-flyout-state';

const DIAGRAMS_KEY = 'diagrams';
const DIAGRAM_ORDER_KEY = 'diagramOrder';
const DIAGRAM_NAME_KEY = 'name';
const DIAGRAM_MERMAID_TEXT_KEY = 'mermaid';
const DIAGRAM_NODE_POSITIONS_KEY = 'nodePositions';
const ACTIVITY_KEY = 'activity';
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

type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
type CollaborationState = {
  activityArray: Y.Array<ActivityEvent>;
  awareness: AwarenessLike;
  diagramsMap: Y.Map<Y.Map<unknown>>;
  diagramOrder: Y.Array<string>;
  doc: Y.Doc;
  provider: WebsocketProvider;
};

type DiagramTab = WorkspaceDiagramTab;

type ActiveDiagramState = {
  id: string;
  name: string;
  nodePositionsMap: Y.Map<NodePosition>;
  yText: Y.Text;
};

type NodePosition = DiagramNodePosition;

type AwarenessLike = {
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

function getParticipantsFromAwareness(awareness: AwarenessLike): Participant[] {
  return [...awareness.getStates().values()]
    .map((value) => getParticipantFromAwarenessState(value))
    .filter((participant): participant is Participant => participant !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
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

export function getAgentWorkflowPrompt(sessionId: string, mcpUrl: string): string {
  return `Connect to my ArielCharts session "${sessionId}" using the MCP server at ${mcpUrl}. First call getSession to see the named diagrams and stable IDs. Create a named diagram for each distinct flow by passing getSession's latest revision as expectedRevision. Before changing any existing tab, call readDiagram and pass its latest revision as expectedRevision to writeDiagram; on a stale-revision error, readDiagram again, merge the current source, and retry. Mermaid changes sync collaboratively in real-time. Look up your docs for how to add an MCP server globally.`;
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
  const existing = new Set(existingNames.map((name) => name.trim().toLocaleLowerCase()));
  const suffixes = [diagramId.slice(-4), diagramId.slice(-8), diagramId];
  for (const suffix of suffixes) {
    const candidate = `${defaultName} ${suffix}`.trim();
    if (!existing.has(candidate.toLocaleLowerCase())) return candidate;
  }
  let duplicateIndex = 2;
  while (existing.has(`${defaultName} ${diagramId} ${duplicateIndex}`.toLocaleLowerCase())) {
    duplicateIndex += 1;
  }
  return `${defaultName} ${diagramId} ${duplicateIndex}`;
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

export function SessionWorkspace({ sessionId }: { sessionId: string }) {
  const { resolvedTheme } = useTheme();
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const editorThemeRef = useRef(new Compartment());
  const renderSequenceRef = useRef(0);
  const activeRenderRef = useRef<{ diagramId: string; sequence: number; source: string } | null>(null);
  const previewRegistryRef = useRef(new DiagramPreviewRegistry());
  const joinedActivityRef = useRef(false);
  const editDebounceRef = useRef<number | null>(null);
  const currentIdentityRef = useRef<LocalIdentity | null>(null);
  const addActivityRef = useRef<((action: ActivityEvent['action'], detail?: string, diagramId?: string) => void) | null>(null);
  const mutationQueueRef = useRef<MutationQueue | null>(null);
  const undoManagerRef = useRef<Y.UndoManager | null>(null);
  const dragCommitterRef = useRef<DragLayoutCommitter | null>(null);
  const diagramTabRefs = useRef(new Map<string, HTMLButtonElement>());
  const flyoutOriginRef = useRef<HTMLButtonElement | null>(null);
  const pendingFlyoutReturnFocusRef = useRef<HTMLButtonElement | null>(null);
  const activityCloseRef = useRef<HTMLButtonElement | null>(null);
  const renameCancelledRef = useRef(false);

  const [collaboration, setCollaboration] = useState<CollaborationState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [diagrams, setDiagrams] = useState<DiagramTab[]>([]);
  const [activeDiagramId, setActiveDiagramId] = useState<string | null>(null);
  const [mermaidText, setMermaidText] = useState('');
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [preview, setPreview] = useState<DiagramPreview | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [shareCopyState, setShareCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [promptCopyState, setPromptCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState(() => getSessionPath(sessionId));
  const [showConnectModal, setShowConnectModal] = useState(false);
  const [nodePositions, setNodePositions] = useState<DiagramNodePositions>({});
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([]);
  const [interactionMode, setInteractionMode] = useState<'select' | 'connect'>('select');
  const [renamingParticipantName, setRenamingParticipantName] = useState<string | null>(null);
  const [displayNameDraft, setDisplayNameDraft] = useState('');
  const [renamingDiagramId, setRenamingDiagramId] = useState<string | null>(null);
  const [diagramNameDraft, setDiagramNameDraft] = useState('');
  const [openFlyout, setOpenFlyout] = useState<WorkspaceFlyout>(null);

  const activeDiagram = useMemo(
    () => getActiveDiagramState(collaboration, activeDiagramId),
    [activeDiagramId, collaboration],
  );

  const runMutation = useCallback((mutation: Promise<unknown>) => {
    setMutationError(null);
    observeMutationFailure(mutation, (error) => {
      setMutationError(error instanceof Error ? error.message : 'The diagram update could not be applied.');
    });
  }, []);

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
    setOpenFlyout(null);
  }, []);

  const toggleFlyout = useCallback((flyout: Exclude<WorkspaceFlyout, null>, origin: HTMLButtonElement) => {
    const nextFlyout = getNextWorkspaceFlyout(openFlyout, flyout);
    if (!nextFlyout) {
      closeFlyout();
      return;
    }
    flyoutOriginRef.current = origin;
    setOpenFlyout(nextFlyout);
  }, [closeFlyout, openFlyout]);

  useEffect(() => {
    setShareUrl(getSessionPath(sessionId));
    previewRegistryRef.current.reset();
    setPreview(null);
    setRenderError(null);

    if (typeof window !== 'undefined') {
      setShareUrl(new URL(getSessionPath(sessionId), window.location.origin).toString());
    }
  }, [sessionId]);

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
    });
  }, [resolvedTheme]);

  useEffect(() => {
    const doc = new Y.Doc();
    const provider = new WebsocketProvider(getWebsocketServerUrl(), sessionId, doc, {
      maxBackoffTime: 2_500,
      resyncInterval: 10_000,
    });
    const awareness = provider.awareness as AwarenessLike;
    const diagramsMap = doc.getMap<Y.Map<unknown>>(DIAGRAMS_KEY);
    const diagramOrder = doc.getArray<string>(DIAGRAM_ORDER_KEY);
    const activityArray = doc.getArray<ActivityEvent>(ACTIVITY_KEY);
    const localIdentity = getOrCreateIdentity();
    currentIdentityRef.current = localIdentity;
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

    const syncParticipants = () => {
      setParticipants(getParticipantsFromAwareness(awareness));
    };

    let hadConnected = false;

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

      setConnectionState(provider.shouldConnect ? 'reconnecting' : 'disconnected');
    };

    const handleReconnectSignal = () => {
      if (provider.shouldConnect) {
        setConnectionState(hadConnected ? 'reconnecting' : 'connecting');
      }
    };

    addActivityRef.current = (action, detail, diagramId) => {
      const actor = currentIdentityRef.current;
      if (!actor) {
        return;
      }

      doc.transact(() => {
        upsertActivity(activityArray, {
          action,
          actor: { name: actor.name, type: actor.type },
          detail,
          diagram_id: diagramId,
          id: `${actor.name}-${Date.now()}-${randomSuffix(4)}`,
          timestamp: Date.now(),
        });
      }, actor.name);
    };

    syncActivity();
    syncDiagrams();
    syncParticipants();

    activityArray.observe(syncActivity);
    diagramsMap.observeDeep(syncDiagrams);
    diagramOrder.observe(syncDiagrams);
    awareness.on('change', syncParticipants);
    provider.on('status', handleStatus);
    provider.on('connection-close', handleReconnectSignal);
    provider.on('connection-error', handleReconnectSignal);
    provider.on('sync', (isSynced: boolean) => {
      if (isSynced && !joinedActivityRef.current) {
        joinedActivityRef.current = true;
        addActivityRef.current?.('joined', 'Opened the session');
      }
    });

    setCollaboration({ activityArray, awareness, diagramsMap, diagramOrder, doc, provider });

    return () => {
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
      provider.off('status', handleStatus);
      provider.off('connection-close', handleReconnectSignal);
      provider.off('connection-error', handleReconnectSignal);
      activityArray.unobserve(syncActivity);
      diagramsMap.unobserveDeep(syncDiagrams);
      diagramOrder.unobserve(syncDiagrams);
      awareness.setLocalState(null);
      provider.destroy();
      doc.destroy();
      addActivityRef.current = null;
      currentIdentityRef.current = null;
      joinedActivityRef.current = false;
      setCollaboration(null);
      setDiagrams([]);
      setActiveDiagramId(null);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!activeDiagram) {
      dragCommitterRef.current?.destroy();
      dragCommitterRef.current = null;
      if (undoManagerRef.current) {
        destroyDiagramUndoManager(undoManagerRef.current);
        undoManagerRef.current = null;
      }
      mutationQueueRef.current = null;
      setMermaidText('');
      setNodePositions({});
      setPreview(null);
      setRenderError(null);
      setSelectedNodeIds([]);
      setInteractionMode('select');
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
    const undoManager = createDiagramUndoManager(activeDiagram.yText, activeDiagram.nodePositionsMap);
    undoManagerRef.current = undoManager;
    mutationQueueRef.current = new MutationQueue(activeDiagram.yText, { transactionOrigin: collaborationOrigins.visual });
    const dragCommitter = new DragLayoutCommitter((positions) => {
      collaboration?.doc.transact(() => {
        writeNodePositions(activeDiagram.nodePositionsMap, positions, 'merge');
      }, collaborationOrigins.visualLayout);
    });
    dragCommitterRef.current = dragCommitter;
    syncText();
    syncNodePositions();
    setPreview(previewRegistryRef.current.get(activeDiagram.id));
    setRenderError(previewRegistryRef.current.getError(activeDiagram.id));
    setSelectedNodeIds([]);
    setInteractionMode('select');
    activeDiagram.yText.observe(syncText);
    activeDiagram.nodePositionsMap.observe(syncNodePositions);

    return () => {
      activeDiagram.yText.unobserve(syncText);
      activeDiagram.nodePositionsMap.unobserve(syncNodePositions);
      dragCommitter.destroy(getDragLayoutTeardownOptions(collaboration?.diagramsMap.has(activeDiagram.id) ?? false));
      if (dragCommitterRef.current === dragCommitter) {
        dragCommitterRef.current = null;
      }
      destroyDiagramUndoManager(undoManager);
      if (undoManagerRef.current === undoManager) {
        undoManagerRef.current = null;
      }
      mutationQueueRef.current = null;
    };
  }, [activeDiagram, applySourceLayoutPolicy, collaboration]);

  useEffect(() => {
    const undoManager = undoManagerRef.current;
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
        markdown(),
        EditorView.lineWrapping,
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
    const renderId = renderSequenceRef.current + 1;
    renderSequenceRef.current = renderId;
    const diagramId = activeDiagramId;
    const renderToken = diagramId ? { diagramId, sequence: renderId, source: mermaidText } : null;
    activeRenderRef.current = renderToken;

    const isCurrentRender = () => (
      renderToken !== null
      && activeRenderRef.current?.diagramId === renderToken.diagramId
      && activeRenderRef.current?.sequence === renderToken.sequence
      && activeRenderRef.current?.source === renderToken.source
    );

    const renderPreview = async () => {
      if (!mermaidText.trim()) {
        if (diagramId && isCurrentRender()) {
          previewRegistryRef.current.clear(diagramId);
          setRenderError(null);
          setPreview(null);
          setSelectedNodeIds([]);
          setInteractionMode('select');
        }
        return;
      }

      try {
        const parseResult = await mermaid.parse(mermaidText);
        const capability = classifyDiagramCapability(parseResult.diagramType);
        if (capability.kind === 'generic' && diagramId && isCurrentRender()) {
          applySourceLayoutPolicy(getAcceptedGenericSourceLayoutPolicy());
        }
        const { svg } = await mermaid.render(`arielcharts-${sessionId}-${diagramId ?? 'none'}-${renderId}`, mermaidText);
        let snapshot: FlowchartSnapshot | null = null;
        if (capability.kind === 'flowchart') {
          try {
            snapshot = parseFlowchartSnapshot(mermaidText);
          } catch {
            snapshot = null;
          }
        }
        if (diagramId && isCurrentRender()) {
          const nextPreview = { capability, diagramId, flowchartSnapshot: snapshot, source: mermaidText, svg };
          previewRegistryRef.current.set(nextPreview);
          setPreview(nextPreview);
          setRenderError(null);
        }
      } catch (error) {
        if (isCurrentRender()) {
          const message = error instanceof Error ? error.message : 'Mermaid could not parse the diagram.';
          if (diagramId) {
            previewRegistryRef.current.setError(diagramId, message);
          }
          setRenderError(message);
        }
      }
    };

    void renderPreview();
  }, [activeDiagramId, applySourceLayoutPolicy, mermaidText, resolvedTheme, sessionId]);

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

  const handleCopyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setShareCopyState('copied');
    } catch {
      setShareCopyState('error');
    }
  };

  const getAgentPrompt = useCallback(() => {
    const mcpUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/mcp`
      : 'https://arielcharts.donovanyohan.com/mcp';
    return getAgentWorkflowPrompt(sessionId, mcpUrl);
  }, [sessionId]);

  const handleCopyAgentPrompt = async () => {
    try {
      await navigator.clipboard.writeText(getAgentPrompt());
      setPromptCopyState('copied');
    } catch {
      setPromptCopyState('error');
    }
  };

  useEffect(() => {
    if (!showConnectModal) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setShowConnectModal(false);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [showConnectModal]);

  useEffect(() => {
    if (!openFlyout) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeFlyout();
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
  const connectedAgentCount = countConnectedAgents(participants);
  const editorStatusLabel = getCompactConnectionLabel(connectionState);
  const activityStatusLabel = `${activeParticipantCount} collaborator${activeParticipantCount === 1 ? '' : 's'}`;
  const saveStatusLabel = connectionState === 'connected'
    ? 'All changes saved'
    : connectionState === 'disconnected'
      ? 'Offline'
      : 'Saving changes…';
  const isFlowchart = canUseFlowchartControls(mermaidText, preview);
  const diagramModeLabel = isFlowchart
    ? 'Flowchart · editable'
    : 'Mermaid · source only';
  const shareButtonLabel = shareCopyState === 'copied' ? 'copied' : shareCopyState === 'error' ? 'copy failed' : 'share';
  const promptCopyLabel = promptCopyState === 'copied' ? 'copied' : promptCopyState === 'error' ? 'copy failed' : 'copy';

  const commitDisplayName = useCallback(() => {
    if (renameCancelledRef.current) {
      renameCancelledRef.current = false;
      return;
    }

    const currentIdentity = currentIdentityRef.current;
    if (!currentIdentity || !collaboration) {
      setRenamingParticipantName(null);
      return;
    }

    const nextBaseName = displayNameDraft.trim() || 'Human';
    const updatedIdentity = renameIdentity(currentIdentity, nextBaseName);

    updateStoredIdentity(nextBaseName, updatedIdentity.color);
    currentIdentityRef.current = updatedIdentity;
    collaboration.awareness.setLocalStateField('user', updatedIdentity);
    setDisplayNameDraft(stripParticipantTabSuffix(updatedIdentity.name));
    setRenamingParticipantName(null);
  }, [collaboration, displayNameDraft]);

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

  const handleSingleNodePositionChange = useCallback((nodeId: string, position: NodePosition) => {
    handleNodePositionsChange({ [nodeId]: position }, 'merge');
  }, [handleNodePositionsChange]);

  const handleNodeDragStart = useCallback((positions: DiagramNodePositions) => {
    const accepted = dragCommitterRef.current?.begin(Object.keys(positions)) ?? false;
    if (accepted) {
      undoManagerRef.current?.stopCapturing();
    }
    return accepted;
  }, []);

  const handleNodeDrag = useCallback((positions: DiagramNodePositions) => {
    const committer = dragCommitterRef.current;
    if (!committer) {
      return;
    }
    committer.update(positions);
  }, []);

  const handleNodeDragStop = useCallback((positions: DiagramNodePositions) => {
    const committer = dragCommitterRef.current;
    if (committer?.finish(positions)) {
      undoManagerRef.current?.stopCapturing();
    }
  }, []);

  const handleAddConnectedNode = useCallback((source: string, label: string, shape: DiagramNodeShape, position: NodePosition, type: DiagramLinkType) => {
    const queue = mutationQueueRef.current;
    if (!queue) {
      return;
    }
    runMutation(queue.addConnectedNode(source, label, { shape, type })
      .then(({ nodeId }) => {
        if (!nodeId) {
          return;
        }
        handleSingleNodePositionChange(nodeId, position);
        setSelectedNodeIds([nodeId]);
      }));
  }, [handleSingleNodePositionChange, runMutation]);

  const focusDiagramTab = useCallback((diagramId: string) => {
    setActiveDiagramId(diagramId);
    window.requestAnimationFrame(() => { diagramTabRefs.current.get(diagramId)?.focus(); });
  }, []);

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
    }, 'tab-create');
    focusDiagramTab(creation.id);
    addActivityRef.current?.('created', `Created ${creation.name}`, creation.id);
  }, [collaboration, focusDiagramTab]);

  const commitDiagramName = useCallback(() => {
    if (!collaboration || !renamingDiagramId) return;
    const normalizedName = diagramNameDraft.trim().replace(/\s+/gu, ' ');
    const current = diagrams.find((diagram) => diagram.id === renamingDiagramId);
    const isDuplicate = diagrams.some((diagram) => diagram.id !== renamingDiagramId && diagram.name.toLocaleLowerCase() === normalizedName.toLocaleLowerCase());
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

  return (
    <main className="workspace-shell">
      <header className="workspace-topbar">
        <div className="workspace-topbar-left">
          <span className="workspace-logo">{APP_NAME}</span>
          <button
            className="workspace-connect-button"
            type="button"
            onClick={() => { setShowConnectModal(true); }}
          >
            connect my agent
          </button>
          {connectedAgentCount > 0 ? (
            <div className="workspace-mcp-status" aria-label={`MCP: ${connectedAgentCount} agents connected`} data-testid="mcp-status">
              <span className="workspace-mcp-dot" />
              <span>{connectedAgentCount === 1 ? 'MCP agent working' : `${connectedAgentCount} MCP agents working`}</span>
              <ChevronDown aria-hidden="true" size={14} />
            </div>
          ) : null}
        </div>

        <div className="workspace-topbar-right">
          <ThemeControl />
          <div data-testid="presence-bar" className="workspace-presence-avatars" aria-label="Session presence">
            {participants.length > 0 ? (
              participants.map((participant, index) => (
                <div
                  className="workspace-avatar-stack-item"
                  key={`${participant.name}-${participant.type}`}
                >
                  {participant.name === currentIdentityRef.current?.name ? (
                    <>
                      <button
                        aria-expanded={renamingParticipantName === participant.name}
                        aria-haspopup="dialog"
                        className={`workspace-avatar workspace-avatar-${participant.type} workspace-avatar-button`}
                        onClick={() => {
                          const displayName = getParticipantDisplayName(participant);
                          setDisplayNameDraft(displayName);
                          setRenamingParticipantName((current) => current === participant.name ? null : participant.name);
                        }}
                        style={{
                          backgroundColor: participant.type === 'agent' ? 'var(--agent-surface)' : participant.color,
                          borderColor: participant.type === 'agent' ? 'var(--agent-border)' : 'var(--surface-inset)',
                          borderStyle: getParticipantBorderStyle(participant.type),
                          zIndex: participants.length - index,
                        }}
                        title={`${getParticipantDisplayName(participant)} (click to rename)`}
                        type="button"
                      >
                        {getParticipantAvatarText(participant)}
                      </button>

                      {renamingParticipantName === participant.name ? (
                        <div className="workspace-avatar-popover" role="dialog" aria-label="Rename display name">
                          <input
                            autoFocus
                            className="workspace-avatar-input"
                            onBlur={commitDisplayName}
                            onChange={(event) => { setDisplayNameDraft(event.target.value); }}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') {
                                commitDisplayName();
                              }
                              if (event.key === 'Escape') {
                                renameCancelledRef.current = true;
                                setDisplayNameDraft(getParticipantDisplayName(participant));
                                setRenamingParticipantName(null);
                              }
                            }}
                            value={displayNameDraft}
                          />
                        </div>
                      ) : null}
                    </>
                  ) : (
                    <div
                      className={`workspace-avatar workspace-avatar-${participant.type}`}
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
                  )}
                </div>
              ))
            ) : (
              <div className="workspace-avatar workspace-avatar-empty">--</div>
            )}
          </div>
          <button className="workspace-share-button" data-testid="share-session-button" type="button" onClick={handleCopyShareUrl}>
            <span>{shareButtonLabel}</span>
            {shareCopyState === 'copied' ? <Check aria-hidden="true" size={13} /> : null}
          </button>
        </div>
      </header>

      <WorkspaceTabStrip
        activeDiagramId={activeDiagramId}
        diagramModeLabel={diagramModeLabel}
        diagramNameDraft={diagramNameDraft}
        diagrams={diagrams}
        onActiveDiagramChange={setActiveDiagramId}
        onCommitDiagramName={commitDiagramName}
        onCreateDiagram={createDiagramFromTemplate}
        onDeleteDiagram={deleteActiveDiagram}
        onDiagramKeyDown={handleDiagramTabKeyDown}
        onDiagramNameDraftChange={setDiagramNameDraft}
        onRenameDiagram={(diagram) => { setRenamingDiagramId(diagram.id); setDiagramNameDraft(diagram.name); }}
        onRenameDismiss={() => { setRenamingDiagramId(null); setDiagramNameDraft(''); }}
        onSourceToggle={(origin) => { toggleFlyout('source', origin); }}
        registerTabButton={(diagramId, element) => {
          if (element) diagramTabRefs.current.set(diagramId, element);
          else diagramTabRefs.current.delete(diagramId);
        }}
        renamingDiagramId={renamingDiagramId}
        sourceOpen={openFlyout === 'source'}
        starterTemplates={STARTER_TEMPLATES}
      />

      <section aria-labelledby={activeDiagramId ? `diagram-tab-${activeDiagramId}` : undefined} className="workspace-main" data-testid="canvas-first-workspace" id="diagram-workspace" role="tabpanel">
        <article data-testid="preview-root" className="workspace-pane workspace-diagram-pane">
          {renderError ? (
            <div data-testid="parse-error-banner" className="error-banner" role="status">
              <strong>preview kept on last valid diagram</strong>
              <span>{renderError}</span>
            </div>
          ) : null}

          {mutationError ? (
            <div data-testid="mutation-error-banner" className="error-banner" role="status">
              <strong>diagram update not applied</strong>
              <span>{mutationError}</span>
            </div>
          ) : null}

          <DiagramCanvas
            key={activeDiagramId ?? 'no-active-diagram'}
            className="diagram-canvas"
            emptyMessage={mermaidText.trim() ? 'rendering preview…' : 'start typing mermaid syntax'}
            graph={preview?.flowchartSnapshot ?? null}
            interactionMode={interactionMode}
            isFlowchart={isFlowchart}
            nodePositions={nodePositions}
            onAddEdge={(source, target, label, type) => mutationQueueRef.current?.addEdge(source, target, { label, type })}
            onAddNode={(label, shape) => mutationQueueRef.current?.addNode(label, { shape })}
            onAddConnectedNode={handleAddConnectedNode}
            onChangeNodeShape={(nodeId, shape) => mutationQueueRef.current?.changeNodeShape(nodeId, shape)}
            onDeleteNodes={(ids) => {
              for (const id of ids) {
                void mutationQueueRef.current?.removeNode(id);
              }
            }}
            onDeleteEdge={(edge) => {
              const queue = mutationQueueRef.current;
              if (queue) {
                runMutation(queue.removeEdgeByIdentity(edge));
              }
            }}
            onEditEdgeLabel={(edge, label) => {
              const queue = mutationQueueRef.current;
              if (queue) {
                runMutation(queue.editEdgeLabelByIdentity(edge, label));
              }
            }}
            onEditNodeLabel={(nodeId, label) => mutationQueueRef.current?.editNodeLabel(nodeId, label)}
            onGroupNodes={(ids, label) => mutationQueueRef.current?.groupNodes(ids, label)}
            onInteractionModeChange={setInteractionMode}
            onNodeDrag={handleNodeDrag}
            onNodeDragStart={handleNodeDragStart}
            onNodeDragStop={handleNodeDragStop}
            onNodePositionsChange={handleNodePositionsChange}
            onSelectedNodeIdsChange={setSelectedNodeIds}
            onUngroupNodes={(id) => mutationQueueRef.current?.ungroupSubgraph(id)}
            selectedNodeIds={selectedNodeIds}
            svg={preview?.svg ?? ''}
            theme={resolvedTheme}
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
          openFlyout={openFlyout}
          participants={participants}
        />
      </section>

      <WorkspaceFooter
        activityCount={activity.length}
        activityOpen={openFlyout === 'activity'}
        activityStatusLabel={activityStatusLabel}
        connectionState={connectionState}
        getAvatarText={getParticipantAvatarText}
        getParticipantName={getParticipantDisplayName}
        onActivityToggle={(origin) => { toggleFlyout('activity', origin); }}
        participants={participants}
        saveStatusLabel={saveStatusLabel}
      />

      {showConnectModal ? (
        <div className="modal-backdrop" onClick={() => { setShowConnectModal(false); }}>
          <div className="modal-dialog" role="dialog" aria-modal="true" aria-labelledby="connect-agent-title" onClick={(event) => { event.stopPropagation(); }}>
            <div className="modal-header">
              <span className="modal-title" id="connect-agent-title">Connect your agent</span>
              <button className="modal-close" type="button" onClick={() => { setShowConnectModal(false); }} aria-label="Close">
                &times;
              </button>
            </div>
            <div className="modal-body">
              <div className="modal-prompt-block">
                <pre className="modal-prompt-text">{getAgentPrompt()}</pre>
                <button className="workspace-copy-button modal-prompt-copy" type="button" onClick={handleCopyAgentPrompt}>
                  {promptCopyLabel}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
