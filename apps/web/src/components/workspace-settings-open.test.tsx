// @vitest-environment happy-dom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThemeProvider } from './theme-provider';
import { WorkspaceSettings } from './workspace-settings';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

describe('WorkspaceSettings open state', () => {
  it('reports dialog ownership while open and after Escape closes it', async () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ addEventListener: vi.fn(), matches: false, removeEventListener: vi.fn() })));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    const onOpenChange = vi.fn();
    await act(async () => root.render(<ThemeProvider><WorkspaceSettings agentCount={0} connectionState="connected" displayName="Human" onConnectAgent={vi.fn()} onDisplayNameSave={vi.fn()} onOpenChange={onOpenChange} onResetRoomKey={vi.fn(async () => undefined)} roomKey="room-key" /></ThemeProvider>));
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="workspace-settings-trigger"]')!;
    await act(async () => trigger.click());
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' })));
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    await act(async () => root.unmount());
  });
});
