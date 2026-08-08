'use client';

import { Settings } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { ConnectionState } from '../lib/connection-state';
import { FOCUSABLE_SELECTOR } from '../lib/focusable';
import type { ResolvedTheme, ThemePreference } from '../lib/theme';
import { useTheme } from './theme-provider';

const THEME_OPTIONS: ReadonlyArray<{
  description: string;
  label: string;
  value: ThemePreference;
}> = [
  { description: 'Follow this device', label: 'System', value: 'system' },
  { description: 'Whiteboard', label: 'Light', value: 'light' },
  { description: 'Chalkboard', label: 'Dark', value: 'dark' },
];

export interface WorkspaceSettingsProps {
  agentCount: number;
  connectionState: ConnectionState;
  displayName: string;
  onConnectAgent: (returnFocusTarget: HTMLButtonElement) => void;
  onDisplayNameSave: (displayName: string) => void;
}

export function getSettingsDisplayName(displayName: string): string {
  return displayName.trim() || 'Human';
}

export function getConnectionStatusLabel(connectionState: ConnectionState, agentCount: number): string {
  if (agentCount > 0) {
    return agentCount === 1 ? '1 MCP agent working' : `${agentCount} MCP agents working`;
  }

  switch (connectionState) {
    case 'connected':
      return 'Ready for agents';
    case 'connecting':
      return 'Connecting session';
    case 'reconnecting':
      return 'Reconnecting session';
    case 'disconnected':
      return 'Session offline';
  }
}

export function shouldCloseWorkspaceSettings(key: string): boolean {
  return key === 'Escape';
}

export function shouldInterceptWorkspaceSettingsEscape(key: string, isOpen: boolean): boolean {
  return isOpen && shouldCloseWorkspaceSettings(key);
}

export function getResolvedAppearanceLabel(theme: ResolvedTheme): 'Whiteboard' | 'Chalkboard' {
  return theme === 'light' ? 'Whiteboard' : 'Chalkboard';
}

export function getConnectionActionLabel(agentCount: number): 'Connect my agent' | 'Connection details' {
  return agentCount > 0 ? 'Connection details' : 'Connect my agent';
}

export function shouldCloseOnSettingsTab(
  activeElementIndex: number,
  tabStopCount: number,
  shiftKey: boolean,
): boolean {
  if (activeElementIndex < 0 || tabStopCount === 0) {
    return false;
  }

  return shiftKey ? activeElementIndex === 0 : activeElementIndex === tabStopCount - 1;
}

export function shouldReturnFocusAfterOutsidePointer(isInteractiveTarget: boolean): boolean {
  return !isInteractiveTarget;
}

const INTERACTIVE_TARGET_SELECTOR = [
  'a[href]',
  'button',
  'input',
  'select',
  'textarea',
  'summary',
  '[contenteditable="true"]',
  '[role="button"]',
  '[role="link"]',
  '[role="application"]',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

function isInteractiveTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(INTERACTIVE_TARGET_SELECTOR) !== null;
}

export function WorkspaceSettings({
  agentCount,
  connectionState,
  displayName,
  onConnectAgent,
  onDisplayNameSave,
}: WorkspaceSettingsProps) {
  const { preference, resolvedTheme, setPreference } = useTheme();
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const displayNameInputRef = useRef<HTMLInputElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [isOpen, setIsOpen] = useState(false);
  const [draftName, setDraftName] = useState(displayName);

  const close = useCallback((returnFocus = true) => {
    setIsOpen(false);
    if (returnFocus) {
      window.requestAnimationFrame(() => { triggerRef.current?.focus({ preventScroll: true }); });
    }
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setDraftName(displayName);
    window.requestAnimationFrame(() => { displayNameInputRef.current?.focus({ preventScroll: true }); });
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (shouldInterceptWorkspaceSettingsEscape(event.key, isOpen)) {
        event.preventDefault();
        event.stopPropagation();
        close();
        return;
      }

      if (event.key !== 'Tab' || !dialogRef.current?.contains(document.activeElement)) {
        return;
      }

      const tabStops = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)];
      const activeElementIndex = tabStops.indexOf(document.activeElement as HTMLElement);
      if (shouldCloseOnSettingsTab(activeElementIndex, tabStops.length, event.shiftKey)) {
        close(false);
      }
    };
    const handlePointerDown = (event: PointerEvent) => {
      if (
        event.target instanceof Node
        && !dialogRef.current?.contains(event.target)
        && !triggerRef.current?.contains(event.target)
      ) {
        close(shouldReturnFocusAfterOutsidePointer(isInteractiveTarget(event.target)));
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    document.addEventListener('pointerdown', handlePointerDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
      document.removeEventListener('pointerdown', handlePointerDown);
    };
  }, [close, isOpen]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onDisplayNameSave(getSettingsDisplayName(draftName));
    close();
  };

  const handleConnectAgent = () => {
    const returnFocusTarget = triggerRef.current;
    if (!returnFocusTarget) {
      return;
    }
    close(false);
    onConnectAgent(returnFocusTarget);
  };

  return (
    <div className="workspace-settings">
      <button
        aria-controls="workspace-settings-dialog"
        aria-expanded={isOpen}
        aria-haspopup="dialog"
        aria-label={`Open workspace settings, ${getResolvedAppearanceLabel(resolvedTheme)}`}
        className="workspace-settings-trigger"
        data-testid="workspace-settings-trigger"
        onClick={() => { setIsOpen((open) => !open); }}
        ref={triggerRef}
        title="Settings"
        type="button"
      >
        <Settings aria-hidden="true" size={18} />
      </button>

      {isOpen ? (
        <div
          aria-labelledby="workspace-settings-title"
          className="workspace-settings-dialog"
          data-testid="workspace-settings-dialog"
          id="workspace-settings-dialog"
          ref={dialogRef}
          role="dialog"
          tabIndex={-1}
        >
          <div className="workspace-settings-heading">
            <h2 id="workspace-settings-title">Settings</h2>
            <button className="workspace-settings-close" onClick={() => { close(); }} type="button">Close</button>
          </div>

          <form className="workspace-settings-section" onSubmit={handleSubmit}>
            <h3>You</h3>
            <label className="workspace-settings-label" htmlFor="workspace-display-name">Display name</label>
            <input
              className="workspace-settings-name-input"
              id="workspace-display-name"
              onChange={(event) => { setDraftName(event.target.value); }}
              ref={displayNameInputRef}
              value={draftName}
            />
            <div className="workspace-settings-actions">
              <button onClick={() => { setDraftName(displayName); close(); }} type="button">Cancel</button>
              <button type="submit">Save name</button>
            </div>
          </form>

          <section aria-labelledby="workspace-agent-connection-heading" className="workspace-settings-section">
            <h3 id="workspace-agent-connection-heading">Agent connection</h3>
            <p className="workspace-settings-status" data-connection-state={connectionState} data-testid="workspace-agent-status">
              {getConnectionStatusLabel(connectionState, agentCount)}
            </p>
            <button className="workspace-settings-connect" onClick={handleConnectAgent} type="button">
              {getConnectionActionLabel(agentCount)}
            </button>
          </section>

          <fieldset className="workspace-settings-section workspace-settings-appearance">
            <legend>Appearance</legend>
            {THEME_OPTIONS.map((option) => (
              <label className="workspace-settings-theme-option" key={option.value}>
                <input
                  checked={preference === option.value}
                  name="workspace-theme-preference"
                  onChange={() => { setPreference(option.value); }}
                  type="radio"
                  value={option.value}
                />
                <span>{option.label}</span>
                <small>{option.description}</small>
              </label>
            ))}
          </fieldset>
        </div>
      ) : null}
    </div>
  );
}
