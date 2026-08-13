// @vitest-environment happy-dom

import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY } from '../lib/local-workspace';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ checkRoomAccess: vi.fn(), exchangeRoomKey: vi.fn(), replace: vi.fn(), workspace: vi.fn(() => <div>workspace</div>) }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('../lib/room-access-api', async (importOriginal) => ({
  ...await importOriginal<typeof import('../lib/room-access-api')>(),
  checkRoomAccess: mocks.checkRoomAccess,
  exchangeRoomKey: mocks.exchangeRoomKey,
}));
vi.mock('./session-workspace', () => ({ SessionWorkspace: mocks.workspace }));

import { RoomGate } from './room-gate';

afterEach(() => {
  document.body.replaceChildren();
  window.localStorage.clear();
  mocks.checkRoomAccess.mockReset();
  mocks.exchangeRoomKey.mockReset();
  mocks.replace.mockReset();
  mocks.workspace.mockClear();
});

describe('RoomGate promotion handoff recovery', () => {
  it('preserves an archived handoff after a generic cookie-access failure', async () => {
    window.localStorage.setItem(LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY, JSON.stringify({ session_id: 'abc123de' }));
    mocks.checkRoomAccess.mockRejectedValueOnce(new Error('revoked'));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);

    await act(async () => { root.render(<RoomGate sessionId="abc123de" />); await Promise.resolve(); });

    expect(window.localStorage.getItem(LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY)).toBe(JSON.stringify({ session_id: 'abc123de' }));
    expect(mocks.workspace).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('preserves the handoff after an invalid manually entered key', async () => {
    window.localStorage.setItem(LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY, JSON.stringify({ session_id: 'abc123de' }));
    mocks.checkRoomAccess.mockRejectedValueOnce(new Error('no cookie'));
    mocks.exchangeRoomKey.mockRejectedValueOnce(new Error('wrong key'));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);

    await act(async () => { root.render(<RoomGate sessionId="abc123de" />); await Promise.resolve(); });
    const input = host.querySelector<HTMLInputElement>('#room-key-input')!;
    await act(async () => {
      // Bypass React's value tracker so the native input event exercises the
      // controlled field's actual onChange path.
      Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!.call(input, 'wrong key');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve();
      host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      await Promise.resolve();
    });

    expect(mocks.exchangeRoomKey).toHaveBeenCalledWith('abc123de', 'wrong key');
    expect(window.localStorage.getItem(LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY)).toBe(JSON.stringify({ session_id: 'abc123de' }));
    await act(async () => root.unmount());
  });

  it('returns to local editing only after the user explicitly chooses the archived workspace', async () => {
    window.localStorage.setItem(LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY, JSON.stringify({ session_id: 'abc123de' }));
    mocks.checkRoomAccess.mockRejectedValueOnce(new Error('unavailable'));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);

    await act(async () => { root.render(<RoomGate sessionId="abc123de" />); await Promise.resolve(); });
    await act(async () => { (host.querySelector('button.secondary-button') as HTMLButtonElement).click(); });

    expect(window.localStorage.getItem(LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY)).toBeNull();
    expect(mocks.replace).toHaveBeenCalledWith('/');
    await act(async () => root.unmount());
  });
});
