// @vitest-environment happy-dom

import React, { StrictMode, act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({
  createRoom: vi.fn(),
  replace: vi.fn(),
}));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('../lib/room-access-api', () => ({
  createRoom: mocks.createRoom,
  getRoomSharePath: (sessionId: string, roomKey: string) => `/s/${sessionId}#roomKey=${roomKey}`,
}));

import { AutoPrivateWorkspace, resetAutoPrivateRoomRequest } from './auto-private-workspace';

function deferred<T>() {
  let reject!: (error: unknown) => void;
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((nextResolve, nextReject) => { resolve = nextResolve; reject = nextReject; });
  return { promise, reject, resolve };
}

afterEach(() => {
  resetAutoPrivateRoomRequest();
  mocks.createRoom.mockReset();
  mocks.replace.mockReset();
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe('AutoPrivateWorkspace', () => {
  it('deduplicates React StrictMode effect replays and replace-navigates with the fragment-only key', async () => {
    const request = deferred<{ roomKey: string; sessionId: string }>();
    mocks.createRoom.mockReturnValueOnce(request.promise);
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);

    await act(async () => { root.render(<StrictMode><AutoPrivateWorkspace /></StrictMode>); });
    expect(mocks.createRoom).toHaveBeenCalledTimes(1);
    expect(host.querySelector('[aria-busy="true"]')?.textContent).toContain('Creating your private workspace');

    await act(async () => { request.resolve({ roomKey: 'raw-key', sessionId: 'abc123de' }); await Promise.resolve(); });
    expect(mocks.replace).toHaveBeenCalledWith('/s/abc123de#roomKey=raw-key');
    await act(async () => root.unmount());
  });

  it('shows a bounded retry and creates a fresh request only after that explicit action', async () => {
    const first = deferred<{ roomKey: string; sessionId: string }>();
    const second = deferred<{ roomKey: string; sessionId: string }>();
    mocks.createRoom.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);

    await act(async () => { root.render(<AutoPrivateWorkspace />); });
    await act(async () => { first.reject(new Error('content-free')); await Promise.resolve(); });
    const retry = host.querySelector<HTMLButtonElement>('[data-testid="retry-auto-private-workspace"]');
    expect(retry).not.toBeNull();
    expect(mocks.createRoom).toHaveBeenCalledTimes(1);
    await act(async () => retry?.click());
    expect(mocks.createRoom).toHaveBeenCalledTimes(2);

    await act(async () => { second.resolve({ roomKey: 'retry-key', sessionId: 'def456gh' }); await Promise.resolve(); });
    expect(mocks.replace).toHaveBeenCalledWith('/s/def456gh#roomKey=retry-key');
    await act(async () => root.unmount());
  });

  it('does not navigate from a late response after the route unmounts', async () => {
    const request = deferred<{ roomKey: string; sessionId: string }>();
    let signal: AbortSignal | undefined;
    mocks.createRoom.mockImplementationOnce((nextSignal?: AbortSignal) => {
      signal = nextSignal;
      return request.promise;
    });
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);

    await act(async () => { root.render(<AutoPrivateWorkspace />); });
    await act(async () => root.unmount());
    await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
    expect(signal?.aborted).toBe(true);
    await act(async () => { request.resolve({ roomKey: 'late-key', sessionId: 'late1234' }); await Promise.resolve(); });
    expect(mocks.replace).not.toHaveBeenCalled();
  });
});
