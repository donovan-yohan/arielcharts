'use client';

import type { ActivityEvent, AwarenessState, Participant } from '@mermaidflow/shared';
import { APP_NAME } from '@mermaidflow/shared';
import { basicSetup } from 'codemirror';
import mermaid from 'mermaid';
import Link from 'next/link';
import { useEffect, useMemo, useRef, useState } from 'react';
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
const NAME_STORAGE_KEY = 'mermaidflow.identity.v1';
const TAB_STORAGE_KEY = 'mermaidflow.tab.v1';
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

function describeActivity(event: ActivityEvent): string {
  switch (event.action) {
    case 'joined':
      return event.detail ? `joined · ${event.detail}` : 'joined the session';
    case 'left':
      return event.detail ? `left · ${event.detail}` : 'left the session';
    case 'edited':
      return event.detail ? `edited · ${event.detail}` : 'edited the diagram';
    case 'replaced':
      return event.detail ? `replaced · ${event.detail}` : 'replaced the diagram';
    default:
      return event.detail ?? event.action;
  }
}

function upsertActivity(activityArray: Y.Array<ActivityEvent>, event: ActivityEvent) {
  const next = [...activityArray.toArray(), event].slice(-MAX_ACTIVITY_EVENTS);
  if (activityArray.length > 0) {
    activityArray.delete(0, activityArray.length);
  }
  activityArray.insert(0, next);
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
  const [identity, setIdentity] = useState<LocalIdentity | null>(null);
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [mermaidText, setMermaidText] = useState('');
  const [activity, setActivity] = useState<ActivityEvent[]>([]);
  const [lastValidSvg, setLastValidSvg] = useState('');
  const [renderError, setRenderError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');

  const shareUrl = useMemo(() => {
    if (typeof window === 'undefined') {
      return getSessionPath(sessionId);
    }

    return new URL(getSessionPath(sessionId), window.location.origin).toString();
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
    setIdentity(localIdentity);
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
          if (update.docChanged && update.view.hasFocus) {
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
        const { svg } = await mermaid.render(`mermaidflow-${sessionId}-${renderId}`, mermaidText);
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

  const handleCopyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopyState('copied');
    } catch {
      setCopyState('error');
    }
  };

  const activeParticipantCount = participants.length;

  return (
    <main className="session-shell">
      <header className="session-topbar card">
        <div className="topbar-title-group">
          <div>
            <p className="eyebrow">{APP_NAME}</p>
            <h1 data-testid="session-id-header">Session {sessionId}</h1>
          </div>
          <Link className="ghost-link" href="/">
            New session
          </Link>
        </div>

        <div className="topbar-meta">
          <span data-testid="connection-status-badge" className={`status-badge ${connectionState}`}>{connectionLabels[connectionState]}</span>
          <div className="meta-chip">
            <span className="meta-label">Active</span>
            <strong>{activeParticipantCount}</strong>
          </div>
          {identity ? (
            <div className="meta-chip">
              <span className="presence-dot" style={{ backgroundColor: identity.color }} />
              <strong>{identity.name}</strong>
            </div>
          ) : null}
        </div>
      </header>

      <section className="card share-card">
        <div>
          <h2>Share URL</h2>
          <p>Invite another tab or teammate to this exact collaborative session.</p>
        </div>
        <div className="share-row">
          <code data-testid="share-url-control" className="share-url">{shareUrl}</code>
          <button data-testid="copy-share-url-button" className="secondary-button" type="button" onClick={handleCopyShareUrl}>
            {copyState === 'copied' ? 'Copied' : copyState === 'error' ? 'Copy failed' : 'Copy link'}
          </button>
        </div>
      </section>

      <section data-testid="presence-bar" className="presence-strip card" aria-label="Session presence">
        <div>
          <h2>Presence</h2>
          <p>{activeParticipantCount > 0 ? 'Live awareness updates from Yjs' : 'Waiting for collaborators to join.'}</p>
        </div>
        <div className="presence-list">
          {participants.length > 0 ? (
            participants.map((participant) => (
              <div className="presence-pill" key={`${participant.name}-${participant.type}`}>
                <span className="presence-dot" style={{ backgroundColor: participant.color }} />
                <span>{participant.name}</span>
                <span className="presence-type">{participant.type}</span>
              </div>
            ))
          ) : (
            <span className="empty-inline">No active collaborators yet</span>
          )}
        </div>
      </section>

      <section className="workspace-grid">
        <article data-testid="editor-root" className="card panel editor-panel">
          <div className="panel-header">
            <div>
              <h2>Collaborative editor</h2>
              <p>CodeMirror 6 + Yjs keeps the canonical Mermaid text synchronized across tabs.</p>
            </div>
            <span className="meta-chip monospace">{mermaidText.length} chars</span>
          </div>
          <div className="editor-host" ref={editorHostRef} />
        </article>

        <div className="panel-stack">
          <article data-testid="preview-root" className="card panel preview-panel">
            <div className="panel-header">
              <div>
                <h2>Mermaid preview</h2>
                <p>Renders from canonical text and preserves the last valid SVG if parsing fails.</p>
              </div>
            </div>

            {renderError ? (
              <div data-testid="parse-error-banner" className="error-banner" role="status">
                <strong>Preview kept on last valid diagram.</strong>
                <span>{renderError}</span>
              </div>
            ) : null}

            <div className="preview-surface">
              {lastValidSvg ? (
                <div dangerouslySetInnerHTML={{ __html: lastValidSvg }} />
              ) : mermaidText.trim() ? (
                <div className="empty-state">Rendering preview…</div>
              ) : (
                <div className="empty-state">Start typing Mermaid syntax to render a diagram.</div>
              )}
            </div>
          </article>

          <article data-testid="activity-feed" className="card panel activity-panel">
            <div className="panel-header">
              <div>
                <h2>Activity feed</h2>
                <p>Events are read directly from the shared Yjs activity array.</p>
              </div>
            </div>

            {activity.length > 0 ? (
              <ol className="activity-list">
                {activity.map((event) => (
                  <li className="activity-item" key={event.id}>
                    <div className="activity-heading">
                      <strong>{event.actor.name}</strong>
                      <span className="presence-type">{event.actor.type}</span>
                    </div>
                    <p>{describeActivity(event)}</p>
                    <time dateTime={new Date(event.timestamp).toISOString()}>{formatTimestamp(event.timestamp)}</time>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="empty-state small">No activity yet. Join, edit, or let an agent write via MCP.</div>
            )}
          </article>
        </div>
      </section>
    </main>
  );
}
