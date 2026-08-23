// @vitest-environment happy-dom

import React, { act } from 'react';
import { readFileSync } from 'node:fs';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  canShowWorkspaceOnboarding,
  dismissWorkspaceOnboarding,
  getWorkspaceOnboardingDismissalKey,
  isWorkspaceOnboardingDismissed,
  isWorkspaceOnboardingEligible,
  shouldDismissWorkspaceOnboardingForContent,
  WorkspaceOnboarding,
} from './workspace-onboarding';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.replaceChildren();
  window.localStorage.clear();
});

describe('workspace onboarding', () => {
  it('is only eligible for blank or header-only Mermaid without durable overlays', () => {
    expect(isWorkspaceOnboardingEligible('', 0)).toBe(true);
    expect(isWorkspaceOnboardingEligible('flowchart LR\n  %% start later', 0)).toBe(true);
    expect(isWorkspaceOnboardingEligible('sequenceDiagram', 0)).toBe(false);
    expect(isWorkspaceOnboardingEligible('', 1)).toBe(false);
    expect(shouldDismissWorkspaceOnboardingForContent('flowchart LR\n  A --> B', 0)).toBe(true);
    expect(shouldDismissWorkspaceOnboardingForContent('', 1)).toBe(true);
    expect(shouldDismissWorkspaceOnboardingForContent('', 0)).toBe(false);
  });

  it('defers to open flyouts and other local modal owners before handling Escape', () => {
    const blank = { activeDiagramId: 'diagram-a', hasCompetingModal: false, openFlyout: false, overlayCount: 0, source: '' };
    expect(canShowWorkspaceOnboarding(blank)).toBe(true);
    expect(canShowWorkspaceOnboarding({ ...blank, openFlyout: true })).toBe(false);
    expect(canShowWorkspaceOnboarding({ ...blank, hasCompetingModal: true })).toBe(false);
  });

  it('keeps browser dismissal scoped to the exact session and diagram', () => {
    const sessionId = 'session-a';
    const diagramId = 'diagram-a';
    expect(getWorkspaceOnboardingDismissalKey(sessionId, diagramId)).toContain('session-a:diagram-a');
    expect(isWorkspaceOnboardingDismissed(sessionId, diagramId)).toBe(false);
    dismissWorkspaceOnboarding(sessionId, diagramId);
    expect(isWorkspaceOnboardingDismissed(sessionId, diagramId)).toBe(true);
    expect(isWorkspaceOnboardingDismissed(sessionId, 'diagram-b')).toBe(false);
    expect(isWorkspaceOnboardingDismissed('session-b', diagramId)).toBe(false);
  });

  it('keeps a dismissal effective when privacy settings deny local storage', () => {
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Denied', 'SecurityError'); });
    dismissWorkspaceOnboarding('storage-denied-session', 'diagram-a');
    expect(isWorkspaceOnboardingDismissed('storage-denied-session', 'diagram-a')).toBe(true);
    setItem.mockRestore();
  });

  it('offers real entry points and closes without a dialog or focus trap', async () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    const callbacks = {
      onAddStickyNote: vi.fn(),
      onBrowseTemplates: vi.fn(),
      onClose: vi.fn(),
      onDraw: vi.fn(),
      onStartTemplate: vi.fn(),
    };
    await act(async () => root.render(<WorkspaceOnboarding {...callbacks} />));
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(host.querySelector('[data-testid="workspace-onboarding"]')).not.toBeNull();
    const actionLabels = [...host.querySelectorAll('button')].map((button) => button.textContent);
    expect(actionLabels.join(' ')).toContain('Use a service flow');
    expect(actionLabels.join(' ')).toContain('Add a sticky note');
    expect(actionLabels.join(' ')).toContain('Draw on the canvas');
    expect(actionLabels.join(' ')).toContain('Browse Mermaid templates');
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    await act(async () => (host.querySelector('[aria-label="Close getting started"]') as HTMLButtonElement).click());
    expect(callbacks.onClose).toHaveBeenCalledTimes(2);
    await act(async () => root.unmount());
  });

  it('leaves Escape to the focused canvas before dismissing onboarding', async () => {
    const host = document.createElement('div');
    const canvas = document.createElement('div');
    canvas.dataset.testid = 'diagram-canvas';
    canvas.tabIndex = -1;
    document.body.append(canvas, host);
    const root = createRoot(host);
    const onClose = vi.fn();
    await act(async () => root.render(<WorkspaceOnboarding
      onAddStickyNote={vi.fn()}
      onBrowseTemplates={vi.fn()}
      onClose={onClose}
      onDraw={vi.fn()}
      onStartTemplate={vi.fn()}
    />));
    canvas.focus();
    await act(async () => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => root.unmount());
  });

  it('defines compact, high-contrast, and reduced-motion safeguards', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    expect(css).toContain('.workspace-onboarding-close');
    expect(css).toContain('min-height: 44px;');
    expect(css).toContain('@media (max-height: 500px)');
    expect(css).toContain('overscroll-behavior: contain;');
    expect(css).toContain('@media (prefers-reduced-motion: reduce)');
    expect(css).toContain('.workspace-onboarding * { scroll-behavior: auto !important; transition: none !important; }');
    expect(css).toContain('@media (forced-colors: active)');
    expect(css).toContain('background: Canvas; border-color: CanvasText; color: CanvasText; forced-color-adjust: none;');
  });

  it('centers the card over the diagram pane and constrains it against the full pane height', () => {
    const css = readFileSync('src/app/globals.css', 'utf8');
    const onboardingCss = css.slice(css.indexOf('.workspace-onboarding {'));
    // The card centers within the free band below the measured overlay-toolbar
    // lane, so an expanded More lane can never cover it.
    expect(onboardingCss).toMatch(/\.workspace-onboarding\s*\{[^}]*left:\s*50%;[^}]*top:\s*calc\(var\(--overlay-toolbar-safe-top, 16px\) \+ \(100% - var\(--overlay-toolbar-safe-top, 16px\) - 80px\) \/ 2\);[^}]*transform:\s*translate\(-50%,\s*-50%\);[^}]*z-index:\s*18;/u);
    expect(onboardingCss).toMatch(/max-width:\s*min\(370px,\s*calc\(100% - 32px\)\);/u);
    const shortViewportCss = css.slice(css.indexOf('@media (max-height: 500px)'), css.indexOf('@media (prefers-reduced-motion: reduce)'));
    expect(shortViewportCss).toMatch(/\.workspace-onboarding\s*\{[^}]*max-height:\s*calc\(100% - max\(16px,\s*var\(--overlay-toolbar-safe-top, 0px\)\) - 80px\);[^}]*overflow-y:\s*auto;/u);
    expect(shortViewportCss).toMatch(/top:\s*calc\(max\(16px,\s*var\(--overlay-toolbar-safe-top, 0px\)\) \+ \(100% - max\(16px,\s*var\(--overlay-toolbar-safe-top, 0px\)\) - 80px\) \/ 2\);/u);
    expect(css).not.toContain('canvas-toolbar-shortcut');
  });
});
