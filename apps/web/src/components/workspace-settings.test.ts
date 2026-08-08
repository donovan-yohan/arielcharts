import { describe, expect, it } from 'vitest';
import {
  getConnectionStatusLabel,
  getConnectionActionLabel,
  getResolvedAppearanceLabel,
  getSettingsDisplayName,
  shouldCloseOnSettingsTab,
  shouldCloseWorkspaceSettings,
  shouldInterceptWorkspaceSettingsEscape,
  shouldReturnFocusAfterOutsidePointer,
} from './workspace-settings';

describe('WorkspaceSettings helpers', () => {
  it('keeps the existing display-name fallback semantics', () => {
    expect(getSettingsDisplayName('  Ada  ')).toBe('Ada');
    expect(getSettingsDisplayName('   ')).toBe('Human');
  });

  it('describes active agents ahead of ordinary connection state', () => {
    expect(getConnectionStatusLabel('connected', 1)).toBe('1 MCP agent working');
    expect(getConnectionStatusLabel('connected', 2)).toBe('2 MCP agents working');
    expect(getConnectionStatusLabel('connected', 0)).toBe('Ready for agents');
    expect(getConnectionStatusLabel('reconnecting', 0)).toBe('Reconnecting session');
    expect(getConnectionStatusLabel('disconnected', 0)).toBe('Session offline');
  });

  it('intercepts Escape only while the settings dialog is open', () => {
    expect(shouldCloseWorkspaceSettings('Escape')).toBe(true);
    expect(shouldCloseWorkspaceSettings('Enter')).toBe(false);
    expect(shouldInterceptWorkspaceSettingsEscape('Escape', true)).toBe(true);
    expect(shouldInterceptWorkspaceSettingsEscape('Escape', false)).toBe(false);
  });

  it('exposes the resolved whiteboard or chalkboard appearance in the trigger name', () => {
    expect(getResolvedAppearanceLabel('light')).toBe('Whiteboard');
    expect(getResolvedAppearanceLabel('dark')).toBe('Chalkboard');
  });

  it('uses the connection surface for details only when an agent is active', () => {
    expect(getConnectionActionLabel(0)).toBe('Connect my agent');
    expect(getConnectionActionLabel(1)).toBe('Connection details');
  });

  it('allows native Tab escape only at the dialog boundaries', () => {
    expect(shouldCloseOnSettingsTab(0, 5, true)).toBe(true);
    expect(shouldCloseOnSettingsTab(4, 5, false)).toBe(true);
    expect(shouldCloseOnSettingsTab(2, 5, false)).toBe(false);
    expect(shouldCloseOnSettingsTab(-1, 5, false)).toBe(false);
  });

  it('returns focus only when an outside pointer target is inert', () => {
    expect(shouldReturnFocusAfterOutsidePointer(false)).toBe(true);
    expect(shouldReturnFocusAfterOutsidePointer(true)).toBe(false);
  });
});
