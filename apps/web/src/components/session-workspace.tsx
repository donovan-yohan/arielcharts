'use client';

import type { ActivityEvent, AwarenessState, Participant } from '@arielcharts/shared';
import { APP_NAME } from '@arielcharts/shared';
import { basicSetup } from 'codemirror';
import mermaid from 'mermaid';
import { useCallback, useEffect, useRef, useState } from 'react';
import { markdown } from '@codemirror/lang-markdown';
import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';
import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';
import { getSessionPath, getWebsocketServerUrl } from '../lib/session';

const MERMAID_TEXT_KEY = 'mermaid';
const ACTIVITY_KEY = 'activity';
const MAX_ACTIVITY_EVENTS = 100;
const EDIT_ACTIVITY_DEBOUNCE_MS = 900;
const NAME_STORAGE_KEY = 'arielcharts.identity.v1';
const TAB_STORAGE_KEY = 'arielcharts.tab.v1';
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
  doc: Y.Doc;
  provider: WebsocketProvider;
  yText: Y.Text;
};

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
  if (participant.type === 'agent') {
    return 'AI';
  }

  const words = participant.name
    .trim()
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean);

  if (words.length >= 2) {
    return `${words[0]?.[0] ?? ''}${words[1]?.[0] ?? ''}`.toUpperCase();
  }

  const compact = participant.name.replace(/[^a-zA-Z0-9]/g, '');
  return compact.slice(0, 2).toUpperCase() || '??';
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

export function SessionWorkspace({ sessionId }: { sessionId: string }) {
  const editorHostRef = useRef<HTMLDivElement | null>(null);
  const editorViewRef = useRef<EditorView | null>(null);
  const editorThemeRef = useRef(new Compartment());
  const renderSequenceRef = useRef(0);
  const joinedActivityRef = useRef(false);
  const editDebounceRef = useRef<number | null>(null);
  const currentIdentityRef = useRef<LocalIdentity | null>(null);
  const addActivityRef = useRef<((action: ActivityEvent['action'], detail?: string) => void) | null>(null);

  const [collaboration, setCollaboration] = useState<CollaborationState | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>('connecting');
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [mermaidText, setMermaidText] = useState('');
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [lastValidSvg, setLastValidSvg] = useState('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [promptCopyState, setPromptCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [shareUrl, setShareUrl] = useState(() => getSessionPath(sessionId));
  const [showConnectModal, setShowConnectModal] = useState(false);

  useEffect(() => {
    setShareUrl(getSessionPath(sessionId));

    if (typeof window !== 'undefined') {
      setShareUrl(new URL(getSessionPath(sessionId), window.location.origin).toString());
    }
  }, [sessionId]);

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
    const yText = doc.getText(MERMAID_TEXT_KEY);
    const activityArray = doc.getArray<ActivityEvent>(ACTIVITY_KEY);
    const localIdentity = getOrCreateIdentity();
    currentIdentityRef.current = localIdentity;
    awareness.setLocalState({ user: localIdentity });

    const syncText = () => {
      setMermaidText(yText.toString());
    };

    const syncActivity = () => {
      setActivity(activityArray.toArray().slice().reverse());
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

    syncText();
    syncActivity();
    syncParticipants();

    yText.observe(syncText);
    activityArray.observe(syncActivity);
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

    setCollaboration({ activityArray, awareness, doc, provider, yText });

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
      yText.unobserve(syncText);
      activityArray.unobserve(syncActivity);
      awareness.setLocalState(null);
      provider.destroy();
      doc.destroy();
      addActivityRef.current = null;
      currentIdentityRef.current = null;
      joinedActivityRef.current = false;
      setCollaboration(null);
    };
  }, [sessionId]);

  useEffect(() => {
    if (!collaboration || !editorHostRef.current) {
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
      doc: collaboration.yText.toString(),
      extensions: [
        basicSetup,
        markdown(),
        EditorView.lineWrapping,
        keymap.of(yUndoManagerKeymap),
        editorThemeRef.current.of(editorTheme),
        yCollab(collaboration.yText, collaboration.awareness, { undoManager: new Y.UndoManager(collaboration.yText) }),
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
  }, [collaboration]);

  useEffect(() => {
    let isCancelled = false;
    const renderId = renderSequenceRef.current + 1;
    renderSequenceRef.current = renderId;

    const renderPreview = async () => {
      if (!mermaidText.trim()) {
        if (!isCancelled) {
          setRenderError(null);
          setLastValidSvg('');
        }
        return;
      }

      try {
        await mermaid.parse(mermaidText);
        const { svg } = await mermaid.render(`arielcharts-${sessionId}-${renderId}`, mermaidText);
        if (!isCancelled) {
          setLastValidSvg(svg);
          setRenderError(null);
        }
      } catch (error) {
        if (!isCancelled) {
          setRenderError(error instanceof Error ? error.message : 'Mermaid could not parse the diagram.');
        }
      }
    };

    void renderPreview();

    return () => {
      isCancelled = true;
    };
  }, [mermaidText, sessionId]);

  useEffect(() => {
    if (copyState === 'idle') {
      return;
    }

    const timeout = window.setTimeout(() => {
      setCopyState('idle');
    }, 1_500);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [copyState]);

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
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };

  const handleCopySessionId = async () => {
    try {
      await navigator.clipboard.writeText(sessionId);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };

  const getAgentPrompt = useCallback(() => {
    const mcpUrl = typeof window !== 'undefined'
      ? `${window.location.origin}/mcp`
      : 'https://arielcharts.donovanyohan.com/mcp';
    return `Connect to my ArielCharts session "${sessionId}" using the MCP server at ${mcpUrl}. You can read and write Mermaid diagrams collaboratively in real-time. Look up your docs for how to add an MCP server globally.`;
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

  const activeParticipantCount = participants.length;
  const connectedAgentCount = countConnectedAgents(participants);
  const editorStatusLabel = getCompactConnectionLabel(connectionState);
  const activityStatusLabel = `${activeParticipantCount} collaborator${activeParticipantCount === 1 ? '' : 's'}`;
  const shareButtonLabel = copyState === 'copied' ? 'copied' : copyState === 'error' ? 'copy failed' : 'share';
  const promptCopyLabel = promptCopyState === 'copied' ? 'copied' : promptCopyState === 'error' ? 'copy failed' : 'copy';

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
          <div data-testid="share-url-control" className="workspace-session-chip">
            <span className="workspace-session-url monospace">{sessionId}</span>
            <button
              className="workspace-copy-button"
              data-testid="copy-session-id-button"
              type="button"
              onClick={handleCopySessionId}
            >
              copy
            </button>
          </div>
          {connectedAgentCount > 0 ? (
            <div className="workspace-mcp-status" aria-label={`MCP: ${connectedAgentCount} agents connected`}>
              <span className="workspace-mcp-dot" />
              <span>{`MCP: ${connectedAgentCount} agent${connectedAgentCount === 1 ? '' : 's'} connected`}</span>
            </div>
          ) : null}
        </div>

        <div className="workspace-topbar-right">
          <div data-testid="presence-bar" className="workspace-presence-avatars" aria-label="Session presence">
            {participants.length > 0 ? (
              participants.map((participant, index) => (
                <div
                  className={`workspace-avatar workspace-avatar-${participant.type}`}
                  key={`${participant.name}-${participant.type}`}
                  style={{
                    backgroundColor: participant.type === 'agent' ? '#0d1117' : participant.color,
                    borderColor: participant.type === 'agent' ? '#3fb950' : '#0d1117',
                    borderStyle: getParticipantBorderStyle(participant.type),
                    zIndex: participants.length - index,
                  }}
                  title={participant.name}
                >
                  {getParticipantAvatarText(participant)}
                </div>
              ))
            ) : (
              <div className="workspace-avatar workspace-avatar-empty">--</div>
            )}
          </div>
          <button className="workspace-share-button" type="button" onClick={handleCopyShareUrl}>
            {shareButtonLabel}
          </button>
        </div>
      </header>

      <section className="workspace-main">
        <article data-testid="editor-root" className="workspace-pane workspace-editor-pane">
          <div className="workspace-pane-header">
            <span>mermaid source</span>
            <span data-testid="connection-status-badge">{editorStatusLabel}</span>
          </div>
          <div className="editor-host" ref={editorHostRef} />
        </article>

        <article data-testid="preview-root" className="workspace-pane workspace-diagram-pane">
          <div className="workspace-pane-header">
            <span>preview</span>
            <span>live</span>
          </div>

          {renderError ? (
            <div data-testid="parse-error-banner" className="error-banner" role="status">
              <strong>preview kept on last valid diagram</strong>
              <span>{renderError}</span>
            </div>
          ) : null}

          <div className="preview-surface">
            {lastValidSvg ? (
              <div dangerouslySetInnerHTML={{ __html: lastValidSvg }} />
            ) : mermaidText.trim() ? (
              <div className="empty-state">rendering preview…</div>
            ) : (
              <div className="empty-state">start typing mermaid syntax</div>
            )}
          </div>
        </article>
      </section>

      <section data-testid="activity-feed" className="workspace-pane workspace-activity-pane">
        <div className="workspace-pane-header">
          <span>activity</span>
          <span>{activityStatusLabel}</span>
        </div>

        {activity.length > 0 ? (
          <ol className="activity-list">
            {activity.map((event) => (
              <li className="activity-item" key={event.id}>
                <time className="activity-time" dateTime={new Date(event.timestamp).toISOString()}>
                  {formatTimestamp(event.timestamp)}
                </time>
                <span className="activity-dot" style={{ backgroundColor: getActivityColor(event, participants) }} />
                <span className="activity-text">
                  {event.actor.type === 'agent' ? (
                    <span className="activity-agent-badge">{event.actor.name}</span>
                  ) : (
                    <strong>{event.actor.name}</strong>
                  )}{' '}
                  {describeActivityCompact(event)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <div className="empty-inline">no activity yet</div>
        )}
      </section>

      {showConnectModal ? (
        <div className="modal-backdrop" onClick={() => { setShowConnectModal(false); }}>
          <div className="modal-dialog" onClick={(event) => { event.stopPropagation(); }}>
            <div className="modal-header">
              <span className="modal-title">Connect your agent</span>
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
