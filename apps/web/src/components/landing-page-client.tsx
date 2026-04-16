'use client';

import { FormEvent, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { APP_NAME } from '@mermaidflow/shared';
import { getSessionPath, isValidSessionId, randomSessionId } from '../lib/session';

export function LandingPageClient() {
  const router = useRouter();
  const suggestedSessionId = useMemo(() => randomSessionId(), []);
  const [joinId, setJoinId] = useState('');
  const normalizedJoinId = joinId.trim().toLowerCase();
  const joinIdIsValid = normalizedJoinId.length === 0 || isValidSessionId(normalizedJoinId);

  const handleCreate = () => {
    router.push(getSessionPath(randomSessionId()));
  };

  const handleJoin = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!isValidSessionId(normalizedJoinId)) {
      return;
    }

    router.push(getSessionPath(normalizedJoinId));
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
          <button data-testid="create-session-cta" className="primary-button" type="button" onClick={handleCreate}>
            Create new session
          </button>
          <a data-testid="open-suggested-session-cta" className="secondary-button" href={getSessionPath(suggestedSessionId)}>
            Open suggested session
          </a>
        </div>

        <div className="landing-hint">
          <span>Suggested ID</span>
          <code data-testid="suggested-session-id">{suggestedSessionId}</code>
        </div>
      </section>

      <section className="landing-panel card">
        <div>
          <h2>Join an existing session</h2>
          <p>Paste a session ID or share link suffix to reconnect to an existing workspace.</p>
        </div>

        <form className="join-form" onSubmit={handleJoin}>
          <label className="field-label" htmlFor="session-id-input">
            Session ID
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
              setJoinId(event.target.value);
            }}
            placeholder="a7x9k2mn"
            spellCheck={false}
            value={joinId}
          />
          <p className={`field-help${joinIdIsValid ? '' : ' error-text'}`}>
            Use 6-32 lowercase letters, digits, <code>_</code>, or <code>-</code>.
          </p>
          <button data-testid="join-session-button" className="primary-button" disabled={!isValidSessionId(normalizedJoinId)} type="submit">
            Join session
          </button>
        </form>
      </section>
    </main>
  );
}
