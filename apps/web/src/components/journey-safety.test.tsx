// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { WorkspaceExportMenu } from './workspace-export-menu';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => document.body.replaceChildren());
it('refuses retained static preview while preserving source and editable recovery', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<WorkspaceExportMenu activeDiagramName="Safe fixture" mermaidSource={'pie\ninvalid'} mermaidSvg="<svg/>" onImported={vi.fn()} scene={{ version: 1, diagram_id: 'main', objects: [] }} sessionId="local" theme="light" workspace={new Y.Doc()} workspaceMode="local" />));
  await act(async () => host.querySelector('button')!.click());
  const buttons = Array.from(host.querySelectorAll('button'));
  expect(buttons.find((b) => b.textContent === 'Export canvas SVG')?.disabled).toBe(true);
  expect(buttons.find((b) => b.textContent === 'Export Mermaid (.mmd)')?.disabled).toBe(false);
  expect(buttons.find((b) => b.textContent === 'Export editable workspace')?.disabled).toBe(false);
  await act(async () => root.unmount());
});
it('closes export with Escape and restores its trigger', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  await act(async () => root.render(<WorkspaceExportMenu activeDiagramName="Fixture" mermaidSource="" mermaidSvg="" onImported={vi.fn()} scene={null} sessionId="local" theme="light" workspace={null} />));
  const trigger = host.querySelector('button')!;
  await act(async () => trigger.click());
  await act(async () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
  expect(host.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger);
  await act(async () => root.unmount());
});
