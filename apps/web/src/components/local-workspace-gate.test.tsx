// @vitest-environment happy-dom

import React, { act } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY } from '../lib/local-workspace';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mocks = vi.hoisted(() => ({ replace: vi.fn(), workspace: vi.fn(() => <div data-testid="local-workspace">local workspace</div>) }));

vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('./session-workspace', () => ({ SessionWorkspace: mocks.workspace }));

import { LocalWorkspaceGate } from './local-workspace-gate';

afterEach(() => {
  document.body.replaceChildren();
  window.localStorage.clear();
  mocks.replace.mockReset();
  mocks.workspace.mockClear();
});

describe('LocalWorkspaceGate', () => {
  it('resumes a recorded online handoff without constructing an editable local workspace', async () => {
    window.localStorage.setItem(LOCAL_WORKSPACE_HANDOFF_STORAGE_KEY, JSON.stringify({ session_id: 'abc123de' }));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);

    await act(async () => { root.render(<LocalWorkspaceGate />); await Promise.resolve(); });

    expect(mocks.replace).toHaveBeenCalledWith('/s/abc123de');
    expect(mocks.workspace).not.toHaveBeenCalled();
    expect(host.textContent).toContain('Resuming your shared workspace');
    await act(async () => root.unmount());
  });

  it('opens local editing only when no online handoff exists', async () => {
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    await act(async () => { root.render(<LocalWorkspaceGate />); await Promise.resolve(); });
    expect(mocks.replace).not.toHaveBeenCalled();
    expect(mocks.workspace).toHaveBeenCalledWith(expect.objectContaining({ initialRoomKey: null, sessionId: 'local', workspaceMode: 'local' }), undefined);
    await act(async () => root.unmount());
  });
});
