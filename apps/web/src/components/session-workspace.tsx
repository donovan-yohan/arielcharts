'use client';

import type { ActivityEvent, AwarenessState, Participant } from '@arielcharts/shared';
import { APP_NAME } from '@arielcharts/shared';
import { basicSetup } from 'codemirror';
import mermaid from 'mermaid';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { Activity, Check, ChevronDown, Code2, Pencil, Plus, X } from 'lucide-react';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { DiagramCanvas } from './diagram-canvas';
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
import { getSessionPath, getWebsocketServerUrl } from '../lib/session';

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
type WorkspaceFlyout = 'source' | 'activity' | null;

type CollaborationState = {
  activityArray: Y.Array<ActivityEvent>;
  awareness: AwarenessLike;
  diagramsMap: Y.Map<Y.Map<unknown>>;
  diagramOrder: Y.Array<string>;
  doc: Y.Doc;
  provider: WebsocketProvider;
};

type DiagramTab = { id: string; name: string };

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
  return actorParticipant?.color ?? (event.actor.type === 'agent' ? '#3fb950' : '#58a6ff');
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

export function SessionWorkspace({ sessionId }: { sessionId: string }) {
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const editorThemeRef = useRef(new Compartment());
  const renderSequenceRef = useRef(0);
  const activeRenderRef = useRef<{ diagramId: string; sequence: number; source: string } | null>(null);
  const previewRegistryRef = useRef(new DiagramPreviewRegistry());
  const joinedActivityRef = useRef(false);
  const editDebounceRef = useRef<number | null>(null);
  const currentIdentityRef = useRef<LocalIdentity | null>(null);
  const addActivityRef = useRef<((action: ActivityEvent['action'], detail?: string) => void) | null>(null);
  const mutationQueueRef = useRef<MutationQueue | null>(null);
  const diagramTabRefs = useRef(new Map<string, HTMLButtonElement>());
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
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'strict' });
  }, []);

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

    addActivityRef.current = (action, detail) => {
      const actor = currentIdentityRef.current;
      if (!actor) {
        return;
      }

      doc.transact(() => {
        upsertActivity(activityArray, {
          action,
          actor: { name: actor.name, type: actor.type },
          detail,
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
      setMermaidText(activeDiagram.yText.toString());
    };
    const syncNodePositions = () => {
      setNodePositions(readNodePositions(activeDiagram.nodePositionsMap));
    };
    syncText();
    syncNodePositions();
    setPreview(previewRegistryRef.current.get(activeDiagram.id));
    setRenderError(previewRegistryRef.current.getError(activeDiagram.id));
    setSelectedNodeIds([]);
    setInteractionMode('select');
    mutationQueueRef.current = new MutationQueue(activeDiagram.yText, { transactionOrigin: 'visual' });
    activeDiagram.yText.observe(syncText);
    activeDiagram.nodePositionsMap.observe(syncNodePositions);

    return () => {
      activeDiagram.yText.unobserve(syncText);
      activeDiagram.nodePositionsMap.unobserve(syncNodePositions);
      mutationQueueRef.current = null;
    };
  }, [activeDiagram]);

  useEffect(() => {
    if (openFlyout !== 'source' || !collaboration || !activeDiagram || !editorHostRef.current) {
      return;
    }

    const handleLocalEdit = () => {
      if (editDebounceRef.current !== null) {
        window.clearTimeout(editDebounceRef.current);
      }

      editDebounceRef.current = window.setTimeout(() => {
        addActivityRef.current?.('edited', 'Updated the diagram');
      }, EDIT_ACTIVITY_DEBOUNCE_MS);
    };

    const editorTheme = EditorView.theme({
      '&': {
        backgroundColor: '#0b1325',
        color: '#e2e8f0',
        fontSize: '14px',
        height: '100%',
      },
      '.cm-content': {
        caretColor: '#f8fafc',
        fontFamily: 'var(--font-mono)',
        minHeight: '100%',
        padding: '1rem',
      },
      '.cm-gutters': {
        backgroundColor: '#111c33',
        borderRight: '1px solid rgba(148, 163, 184, 0.15)',
        color: '#94a3b8',
      },
      '.cm-activeLine, .cm-activeLineGutter': {
        backgroundColor: 'rgba(56, 189, 248, 0.08)',
      },
      '.cm-selectionBackground': {
        backgroundColor: 'rgba(96, 165, 250, 0.22) !important',
      },
      '.cm-cursor, .cm-dropCursor': {
        borderLeftColor: '#f8fafc',
      },
      '.cm-panels': {
        backgroundColor: '#111c33',
        color: '#e2e8f0',
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
        yCollab(activeDiagram.yText, collaboration.awareness, { undoManager: new Y.UndoManager(activeDiagram.yText, { trackedOrigins: new Set([null]) }) }),
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
  }, [activeDiagramId, mermaidText, sessionId]);

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
      if (event.key === 'Escape') setOpenFlyout(null);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => { document.removeEventListener('keydown', handleKeyDown); };
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
    }, 'visual-layout');
  }, [activeDiagram, collaboration]);

  const handleSingleNodePositionChange = useCallback((nodeId: string, position: NodePosition) => {
    handleNodePositionsChange({ [nodeId]: position }, 'merge');
  }, [handleNodePositionsChange]);

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

  const createBlankDiagram = useCallback(() => {
    if (!collaboration) return;
    const id = createDiagramId();
    // The stable-ID suffix keeps independently created blank tabs uniquely
    // named even when two collaborators click + before their CRDT updates meet.
    const name = `Untitled ${id.slice(-4)}`;
    collaboration.doc.transact(() => {
      const diagram = new Y.Map<unknown>();
      diagram.set(DIAGRAM_NAME_KEY, name);
      diagram.set(DIAGRAM_MERMAID_TEXT_KEY, new Y.Text());
      diagram.set(DIAGRAM_NODE_POSITIONS_KEY, new Y.Map<NodePosition>());
      collaboration.diagramsMap.set(id, diagram);
      collaboration.diagramOrder.push([id]);
    }, 'tab-create');
    setActiveDiagramId(id);
    addActivityRef.current?.('created', `Created ${name}`);
  }, [collaboration]);

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
    addActivityRef.current?.('renamed', `Renamed ${current.name} to ${normalizedName}`);
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
    if (deleted) addActivityRef.current?.('deleted', `Deleted ${deleted.name}`);
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
                          backgroundColor: participant.type === 'agent' ? '#0d1117' : participant.color,
                          borderColor: participant.type === 'agent' ? '#3fb950' : '#0d1117',
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
                        backgroundColor: participant.type === 'agent' ? '#0d1117' : participant.color,
                        borderColor: participant.type === 'agent' ? '#3fb950' : '#0d1117',
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

      <nav aria-label="Session diagrams" className="workspace-diagram-tabs" data-testid="diagram-tab-bar">
        <div aria-orientation="horizontal" className="workspace-diagram-tab-list" role="tablist">
          {diagrams.map((diagram) => {
            const active = diagram.id === activeDiagramId;
            const renaming = diagram.id === renamingDiagramId;
            return (
              <div className={`workspace-diagram-tab${active ? ' is-active' : ''}`} key={diagram.id} role="presentation">
                {renaming ? (
                  <input
                    aria-label="Diagram name"
                    autoFocus
                    className="workspace-diagram-tab-input"
                    onBlur={commitDiagramName}
                    onChange={(event) => { setDiagramNameDraft(event.target.value); }}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') commitDiagramName();
                      if (event.key === 'Escape') { setRenamingDiagramId(null); setDiagramNameDraft(''); }
                    }}
                    value={diagramNameDraft}
                  />
                ) : (
                  <button
                    aria-controls="diagram-workspace"
                    aria-selected={active}
                    className="workspace-diagram-tab-button"
                    id={`diagram-tab-${diagram.id}`}
                    onClick={() => { setActiveDiagramId(diagram.id); }}
                    onDoubleClick={() => { setRenamingDiagramId(diagram.id); setDiagramNameDraft(diagram.name); }}
                    onKeyDown={(event) => { handleDiagramTabKeyDown(event, diagram.id); }}
                    ref={(element) => {
                      if (element) diagramTabRefs.current.set(diagram.id, element);
                      else diagramTabRefs.current.delete(diagram.id);
                    }}
                    role="tab"
                    tabIndex={active ? 0 : -1}
                    title={`${diagram.name} (${diagram.id}) — double click to rename`}
                    type="button"
                  >
                    {active ? <span aria-hidden="true" className="workspace-tab-active-dot" /> : null}
                    <span>{diagram.name}</span>
                  </button>
                )}
                {active && !renaming ? (
                  <button
                    aria-label={`Rename ${diagram.name}`}
                    className="workspace-diagram-tab-action"
                    onClick={() => { setRenamingDiagramId(diagram.id); setDiagramNameDraft(diagram.name); }}
                    type="button"
                  ><Pencil aria-hidden="true" size={13} /></button>
                ) : null}
                {active && !renaming && diagrams.length > 1 ? (
                  <button aria-label={`Delete ${diagram.name}`} className="workspace-diagram-tab-action workspace-diagram-tab-delete" onClick={() => { deleteActiveDiagram(diagram.id); }} type="button"><X aria-hidden="true" size={14} /></button>
                ) : null}
              </div>
            );
          })}
          <button aria-label="Create blank diagram" className="workspace-diagram-tab-add" data-testid="create-diagram-tab" onClick={createBlankDiagram} title="New blank diagram" type="button"><Plus aria-hidden="true" size={18} /></button>
        </div>
        <div className="workspace-diagram-tab-tools">
          <button
            aria-controls="source-flyout"
            aria-expanded={openFlyout === 'source'}
            className={`workspace-source-toggle${openFlyout === 'source' ? ' is-active' : ''}`}
            data-testid="source-flyout-toggle"
            onClick={() => { setOpenFlyout((current) => current === 'source' ? null : 'source'); }}
            type="button"
          ><Code2 aria-hidden="true" size={15} /><span>{openFlyout === 'source' ? 'hide source' : 'show source'}</span></button>
          <span className="workspace-diagram-mode" data-testid="diagram-mode"><span aria-hidden="true" />{diagramModeLabel}</span>
        </div>
      </nav>

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
            onNodePositionsChange={handleNodePositionsChange}
            onSelectedNodeIdsChange={setSelectedNodeIds}
            onUngroupNodes={(id) => mutationQueueRef.current?.ungroupSubgraph(id)}
            selectedNodeIds={selectedNodeIds}
            svg={preview?.svg ?? ''}
          />
        </article>

        {openFlyout === 'source' ? (
          <aside aria-label="Mermaid source" className="workspace-flyout" data-testid="source-flyout" id="source-flyout">
            <header className="workspace-flyout-header">
              <div><Code2 aria-hidden="true" size={16} /><span>Mermaid source</span></div>
              <button aria-label="Close source panel" className="workspace-icon-button" onClick={() => { setOpenFlyout(null); }} type="button"><X aria-hidden="true" size={16} /></button>
            </header>
            <div className="workspace-flyout-meta">
              <span>{getActiveDiagramName(diagrams, activeDiagramId) ?? 'No diagram selected'}</span>
              <span data-testid="connection-status-badge">{editorStatusLabel}</span>
            </div>
            <div className="editor-host workspace-flyout-editor" data-testid="editor-root" ref={editorHostRef} />
          </aside>
        ) : null}

        {openFlyout === 'activity' ? (
          <aside aria-label="Activity history" className="workspace-flyout workspace-activity-flyout" data-testid="activity-flyout" id="activity-flyout">
            <header className="workspace-flyout-header">
              <div><Activity aria-hidden="true" size={16} /><span>Activity history</span></div>
              <button aria-label="Close activity history" className="workspace-icon-button" onClick={() => { setOpenFlyout(null); }} type="button"><X aria-hidden="true" size={16} /></button>
            </header>
            <div className="workspace-flyout-meta"><span>Latest activity</span><span>{activity.length}</span></div>
            {activity.length > 0 ? (
              <ol className="activity-list" data-testid="activity-feed">
                {activity.map((event, index) => (
                  <li className={`activity-item${index === 0 ? ' is-current' : ''}`} key={event.id}>
                    <span aria-hidden="true" className="activity-timeline-marker" style={{ borderColor: getActivityColor(event, participants) }} />
                    <div className="activity-item-content">
                      <div className="activity-item-heading">
                        <span className={event.actor.type === 'agent' ? 'activity-agent-badge' : ''}>{event.actor.name}</span>
                        <time className="activity-time" dateTime={new Date(event.timestamp).toISOString()}>{formatTimestamp(event.timestamp)}</time>
                      </div>
                      <strong>{describeActivityCompact(event)}</strong>
                      {event.detail ? <span className="activity-detail">{event.detail}</span> : null}
                    </div>
                  </li>
                ))}
              </ol>
            ) : <div className="empty-inline">no activity yet</div>}
          </aside>
        ) : null}
      </section>

      <footer className="workspace-footer" data-testid="workspace-footer">
        <div className="workspace-footer-left">
          <button
            aria-controls="activity-flyout"
            aria-expanded={openFlyout === 'activity'}
            className={`workspace-footer-toggle${openFlyout === 'activity' ? ' is-active' : ''}`}
            data-testid="activity-flyout-toggle"
            onClick={() => { setOpenFlyout((current) => current === 'activity' ? null : 'activity'); }}
            type="button"
          ><Activity aria-hidden="true" size={15} /><span>activity</span><b>{activity.length}</b><ChevronDown aria-hidden="true" size={14} /></button>
          <span className="workspace-collaborator-count">{activityStatusLabel}</span>
          <div aria-label="Active collaborators" className="workspace-footer-avatars">
            {participants.map((participant) => (
              <span
                aria-label={`${getParticipantDisplayName(participant)}, ${participant.type}`}
                className={`workspace-footer-avatar workspace-footer-avatar-${participant.type}`}
                key={`${participant.name}-${participant.type}-footer`}
                style={{ backgroundColor: participant.type === 'agent' ? '#5b2a86' : participant.color }}
                title={getParticipantDisplayName(participant)}
              >{getParticipantAvatarText(participant)}</span>
            ))}
          </div>
        </div>
        <div aria-live="polite" className="workspace-save-status" data-testid="live-save-status">
          <span aria-hidden="true" className={`workspace-save-dot workspace-save-dot-${connectionState}`} />
          <span>{saveStatusLabel}</span><span className="workspace-live-label">live</span>
        </div>
      </footer>

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
