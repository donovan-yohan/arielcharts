'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LOCAL_WORKSPACE_ID, readLocalWorkspaceHandoff } from '../lib/local-workspace';
import { getSessionPath } from '../lib/session';
import { SessionWorkspace } from './session-workspace';

/**
 * Root-route boundary for promoted local work. A handoff pointer means the
 * IndexedDB document is an archive, never a second editable workspace.
 */
export function LocalWorkspaceGate() {
  const router = useRouter();
  const [state, setState] = useState<'checking' | 'local' | 'resuming'>('checking');

  useEffect(() => {
    const sessionId = readLocalWorkspaceHandoff();
    if (!sessionId) {
      setState('local');
      return;
    }
    setState('resuming');
    router.replace(getSessionPath(sessionId));
  }, [router]);

  if (state !== 'local') {
    return (
      <main aria-busy="true" aria-live="polite" className="room-gate-shell" data-testid="local-workspace-handoff-loader">
        <section className="room-gate-card">
          <p className="eyebrow">Online workspace</p>
          <h1>{state === 'resuming' ? 'Resuming your shared workspace…' : 'Opening your workspace…'}</h1>
          <p>{state === 'resuming' ? 'Checking this browser’s private room access.' : 'Checking for a saved workspace handoff.'}</p>
        </section>
      </main>
    );
  }

  return <SessionWorkspace initialRoomKey={null} sessionId={LOCAL_WORKSPACE_ID} workspaceMode="local" />;
}
