import React from 'react';
import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { getLocalWorkspaceLoadingCopy } from '../lib/local-workspace';
import { WorkspaceOnboarding } from './workspace-onboarding';
import { getConnectionStatusLabel } from './workspace-settings';
import { WorkspaceFooter } from './workspace-footer';

describe('journey status truth', () => {
  it('keeps online share and prompt action states in sentence case', () => {
    const source = readFileSync(new URL('./session-workspace.tsx', import.meta.url), 'utf8');
    const labels = source.slice(source.indexOf('const shareButtonLabel ='), source.indexOf('const saveDisplayName ='));
    for (const label of ['Reset key to share', 'Copied', 'Copy failed', 'Share', 'Copy']) {
      expect(labels).toContain(`'${label}'`);
    }
  });
  it('does not call preparation ready', () => {
    expect(getLocalWorkspaceLoadingCopy('preparing').detail).not.toMatch(/ready|saved/i);
  });
  it('describes shared notes without a privacy promise', () => {
    const html = renderToStaticMarkup(<WorkspaceOnboarding onAddStickyNote={() => {}} onBrowseTemplates={() => {}} onClose={() => {}} onDraw={() => {}} onStartTemplate={() => {}} />);
    expect(html).not.toContain('private');
    expect(html).toContain('Start a diagram');
  });
  it('does not infer agent work or connection from membership', () => {
    expect(getConnectionStatusLabel('disconnected', 2)).toBe('2 MCP agents in this workspace');
  });
  it('shows the device statement once', () => {
    const html = renderToStaticMarkup(<WorkspaceFooter activityCount={0} activityOpen={false} activityStatusLabel="Saved on this device" connectionState="connected" getAvatarText={() => ''} getParticipantName={() => ''} isLocalWorkspace onActivityToggle={() => {}} participants={[]} saveStatusLabel="Saved on this device" />);
    expect(html.match(/>Saved on this device</g)?.length).toBe(1);
    expect(html).not.toContain('workspace-live-label');
  });
});
