'use client';

import React, { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { checkRoomAccess, clearRoomKeyFragment, exchangeRoomKey, readRoomKeyFragment, RoomAccessApiError } from '../lib/room-access-api';
import { clearLocalWorkspaceHandoff, readLocalWorkspaceHandoff } from '../lib/local-workspace';
import { SessionWorkspace } from './session-workspace';

export type RoomGateState =
  | { status: 'checking' }
  | { status: 'locked'; failed: boolean }
  | { status: 'authorized'; roomKey: string | null };

export function canMountProtectedWorkspace(state: RoomGateState): state is Extract<RoomGateState, { status: 'authorized' }> {
  return state.status === 'authorized';
}

export function shouldClearRoomKeyFragmentAfterExchangeError(error: unknown): boolean {
  return error instanceof RoomAccessApiError && error.status === 401;
}

export function RoomGateView({
  gateState,
  isSubmitting,
  onRoomKeyChange,
  onUseArchivedWorkspace,
  onSubmit,
  roomKeyDraft,
  sessionId,
  canUseArchivedWorkspace = false,
}: {
  canUseArchivedWorkspace?: boolean;
  gateState: RoomGateState;
  isSubmitting: boolean;
  onRoomKeyChange: (value: string) => void;
  onUseArchivedWorkspace?: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  roomKeyDraft: string;
  sessionId: string;
}) {
  if (canMountProtectedWorkspace(gateState)) {
    return <SessionWorkspace initialRoomKey={gateState.roomKey} sessionId={sessionId} />;
  }

  if (gateState.status === 'checking') {
    return (
      <main aria-busy="true" aria-live="polite" className="room-gate-shell">
        <section className="room-gate-card">
          <p className="eyebrow">Private room</p>
          <h1>Checking room access…</h1>
          <p>Your diagram stays closed until this browser is authorized.</p>
        </section>
      </main>
    );
  }

  return (
    <main className="room-gate-shell">
      <section aria-labelledby="room-gate-title" className="room-gate-card">
        <p className="eyebrow">Private room</p>
        <h1 id="room-gate-title">Enter the room key</h1>
        <p>Paste the key from the shared ArielCharts link. Room access failures look the same for everyone.</p>
        <form className="room-gate-form" onSubmit={onSubmit}>
          <label className="field-label" htmlFor="room-key-input">Room key</label>
          <input
            aria-describedby={gateState.failed ? 'room-key-error' : undefined}
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            className="text-input"
            id="room-key-input"
            name="room-key"
            onChange={(event) => { onRoomKeyChange(event.target.value); }}
            spellCheck={false}
            type="password"
            value={roomKeyDraft}
          />
          {gateState.failed ? (
            <p className="field-help error-text" id="room-key-error" role="alert">Room access could not be verified. Check the key and try again.</p>
          ) : null}
          <button className="primary-button" disabled={isSubmitting || roomKeyDraft.trim().length === 0} type="submit">
            {isSubmitting ? 'Checking…' : 'Open room'}
          </button>
          {canUseArchivedWorkspace && onUseArchivedWorkspace ? (
            <button className="secondary-button" type="button" onClick={onUseArchivedWorkspace}>Use archived device workspace</button>
          ) : null}
        </form>
      </section>
    </main>
  );
}

export function RoomGate({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [gateState, setGateState] = useState<RoomGateState>({ status: 'checking' });
  const [roomKeyDraft, setRoomKeyDraft] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    const fragmentKey = readRoomKeyFragment(window.location.hash);

    const authorize = async () => {
      if (fragmentKey) {
        try {
          await exchangeRoomKey(sessionId, fragmentKey, controller.signal);
          if (!controller.signal.aborted) {
            clearRoomKeyFragment(window.location, window.history);
            setGateState({ status: 'authorized', roomKey: fragmentKey });
          }
          return;
        } catch (error) {
          if (controller.signal.aborted) {
            return;
          }
          if (shouldClearRoomKeyFragmentAfterExchangeError(error)) {
            clearRoomKeyFragment(window.location, window.history);
          }
          // A stale shared key must not lock out a browser whose current
          // HttpOnly cookie is still valid.
          try {
            await checkRoomAccess(sessionId, controller.signal);
            if (!controller.signal.aborted) {
              setGateState({ status: 'authorized', roomKey: null });
            }
            return;
          } catch {
            if (!controller.signal.aborted) {
              setGateState({ status: 'locked', failed: true });
            }
            return;
          }
        }
      }

      try {
        await checkRoomAccess(sessionId, controller.signal);
        if (!controller.signal.aborted) {
          setGateState({ status: 'authorized', roomKey: null });
        }
      } catch {
        if (!controller.signal.aborted) {
          setGateState({ status: 'locked', failed: false });
        }
      }
    };

    void authorize();
    return () => { controller.abort(); };
  }, [sessionId]);

  const submitRoomKey = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const candidate = roomKeyDraft.trim();
    if (!candidate || isSubmitting) {
      return;
    }
    setIsSubmitting(true);
    setGateState({ status: 'locked', failed: false });
    try {
      await exchangeRoomKey(sessionId, candidate);
      setRoomKeyDraft('');
      setGateState({ status: 'authorized', roomKey: candidate });
    } catch {
      setRoomKeyDraft('');
      setGateState({ status: 'locked', failed: true });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <RoomGateView
      gateState={gateState}
      isSubmitting={isSubmitting}
      onRoomKeyChange={setRoomKeyDraft}
      canUseArchivedWorkspace={readLocalWorkspaceHandoff() === sessionId}
      onUseArchivedWorkspace={() => {
        // Returning to the archive is deliberately user initiated: access,
        // network, and key errors must never silently create a local fork.
        clearLocalWorkspaceHandoff(sessionId);
        router.replace('/');
      }}
      onSubmit={(event) => { void submitRoomKey(event); }}
      roomKeyDraft={roomKeyDraft}
      sessionId={sessionId}
    />
  );
}
