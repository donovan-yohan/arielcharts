'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { APP_NAME } from '@arielcharts/shared';
import { createRoom, getRoomReferencePath, getRoomSharePath, parseRoomReference } from '../lib/room-access-api';

export function LandingPageClient() {
  const router = useRouter();
  const [joinValue, setJoinValue] = useState('');
  const [createPending, setCreatePending] = useState(false);
  const [createFailed, setCreateFailed] = useState(false);
  const parsedJoin = useMemo(() => parseRoomReference(joinValue), [joinValue]);
  const joinValueIsValid = joinValue.trim().length === 0 || parsedJoin !== null;

  const handleCreate = async () => {
    if (createPending) {
      return;
    }
    setCreatePending(true);
    setCreateFailed(false);
    try {
      const room = await createRoom();
      router.push(getRoomSharePath(room.sessionId, room.roomKey));
    } catch {
      setCreateFailed(true);
      setCreatePending(false);
    }
  };

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!parsedJoin) {
      return;
    }
    router.push(getRoomReferencePath(parsedJoin));
  };

  return (
    <main className="landing-shell">
      <section className="landing-hero card">
        <p className="eyebrow">{APP_NAME}</p>
        <h1>Collaborative Mermaid diagrams for humans and agents</h1>
        <p className="hero-copy">
          Start a shared session, invite a teammate with a URL, and watch the diagram editor, preview,
          presence, and activity feed stay in sync.
        </p>

        <div className="landing-actions">
          <button data-testid="create-session-cta" className="primary-button" disabled={createPending} type="button" onClick={() => { void handleCreate(); }}>
            {createPending ? 'Creating private room…' : 'Create private room'}
          </button>
        </div>
        {createFailed ? <p className="field-help error-text" role="alert">The private room could not be created. Try again.</p> : null}
      </section>

      <section className="landing-panel card">
        <div>
          <h2>Join an existing session</h2>
          <p>Paste a session ID or the full private share link.</p>
        </div>

        <form className="join-form" onSubmit={handleJoin}>
          <label className="field-label" htmlFor="session-id-input">
            Session ID or share link
          </label>
          <input
            data-testid="join-session-input"
            id="session-id-input"
            autoCapitalize="none"
            autoComplete="off"
            autoCorrect="off"
            className="text-input"
            inputMode="text"
            onChange={(event) => {
              setJoinValue(event.target.value);
            }}
            placeholder="a7x9k2mn or https://…/s/a7x9k2mn#roomKey=…"
            spellCheck={false}
            value={joinValue}
          />
          <p className={`field-help${joinValueIsValid ? '' : ' error-text'}`}>
            IDs use 6–32 letters, digits, <code>_</code>, or <code>-</code>. Share links include the room key privately after <code>#</code>.
          </p>
          <button data-testid="join-session-button" className="primary-button" disabled={parsedJoin === null} type="submit">
            Open room
          </button>
        </form>
      </section>
    </main>
  );
}
