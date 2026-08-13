'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { createRoom, getRoomSharePath, type CreatedRoom } from '../lib/room-access-api';

type AutoRoomLease = {
  promise: Promise<CreatedRoom>;
  release: () => void;
};

type SharedAutoRoomRequest = {
  abortTimer: number | null;
  consumers: number;
  controller: AbortController;
  pending: boolean;
  promise: Promise<CreatedRoom>;
};

let sharedRequest: SharedAutoRoomRequest | null = null;

function releaseAutoRoomRequest(request: SharedAutoRoomRequest): void {
  request.consumers = Math.max(0, request.consumers - 1);
  if (request.consumers !== 0 || request.abortTimer !== null) return;

  // React StrictMode immediately replays an effect cleanup/setup pair. A
  // deferred abort keeps that development probe one logical root visit while
  // still cancelling a request when the route is genuinely abandoned.
  request.abortTimer = window.setTimeout(() => {
    request.abortTimer = null;
    if (request.consumers !== 0) return;
    if (request.pending) request.controller.abort();
    if (sharedRequest === request) sharedRequest = null;
  }, 0);
}

export function acquireAutoPrivateRoomRequest(): AutoRoomLease {
  if (!sharedRequest) {
    const controller = new AbortController();
    const request: SharedAutoRoomRequest = {
      abortTimer: null,
      consumers: 0,
      controller,
      pending: true,
      promise: createRoom(undefined, controller.signal),
    };
    request.promise.finally(() => { request.pending = false; }).catch(() => undefined);
    sharedRequest = request;
  }

  const request = sharedRequest;
  if (request.abortTimer !== null) {
    window.clearTimeout(request.abortTimer);
    request.abortTimer = null;
  }
  request.consumers += 1;
  let released = false;
  return {
    promise: request.promise,
    release: () => {
      if (released) return;
      released = true;
      releaseAutoRoomRequest(request);
    },
  };
}

export function resetAutoPrivateRoomRequest(): void {
  const request = sharedRequest;
  sharedRequest = null;
  if (!request) return;
  if (request.abortTimer !== null) window.clearTimeout(request.abortTimer);
  if (request.pending) request.controller.abort();
}

export function AutoPrivateWorkspace() {
  const router = useRouter();
  const [attempt, setAttempt] = useState(0);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    const lease = acquireAutoPrivateRoomRequest();
    lease.promise.then((room) => {
      if (active) router.replace(getRoomSharePath(room.sessionId, room.roomKey));
    }).catch(() => {
      if (active) setFailed(true);
    });
    return () => {
      active = false;
      lease.release();
    };
  }, [attempt, router]);

  const retry = () => {
    resetAutoPrivateRoomRequest();
    setFailed(false);
    setAttempt((current) => current + 1);
  };

  return (
    <main aria-busy={!failed} aria-live="polite" className="room-gate-shell" data-testid="auto-private-workspace">
      <section aria-labelledby="auto-private-workspace-title" className="room-gate-card">
        <p className="eyebrow">Private workspace</p>
        <h1 id="auto-private-workspace-title">{failed ? 'Private workspace unavailable' : 'Creating your private workspace…'}</h1>
        {failed ? <>
          <p role="alert">A private workspace could not be created. Try again.</p>
          <button className="primary-button" data-testid="retry-auto-private-workspace" onClick={retry} type="button">Retry</button>
        </> : <p>Your private workspace is being prepared.</p>}
      </section>
    </main>
  );
}
