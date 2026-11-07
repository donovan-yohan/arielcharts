// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { WorkspaceConfirmation, WorkspaceInput, WorkspaceRecord, WorkspaceRecordError } from './workspace-controls';
it('owns record identity, visible labels and retained invalid field semantics together', () => {
  const html = renderToStaticMarkup(<WorkspaceRecord aria-label="Slice Revenue" error="Value must be positive."><WorkspaceInput aria-label="Slice value" value="-2" readOnly /><WorkspaceRecordError error="Value must be positive." /></WorkspaceRecord>);
  expect(html).toContain('workspace-record-heading'); expect(html).toContain('Slice Revenue');
  expect(html).toContain('aria-invalid="true"'); expect(html).toContain('aria-describedby=');
  expect(html).toContain('value="-2"');
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('keeps IME Enter inside the native editor instead of committing the outer canvas handler', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const commit = vi.fn();
  await act(async () => root.render(<WorkspaceInput aria-label="Node label" onKeyDown={commit} />));
  const field = host.querySelector('input')!;
  await act(async () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', isComposing: true, bubbles: true })));
  expect(commit).not.toHaveBeenCalled();
  await act(async () => field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })));
  expect(commit).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount()); host.remove();
});

it('owns a focusable pending fallback and keeps both Tab directions and Escape inside the modal', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const cancel = vi.fn(); const confirm = vi.fn();
  try {
    await act(async () => root.render(<WorkspaceConfirmation title="Replace?" confirmLabel="Replace" pending onCancel={cancel} onConfirm={confirm}>Scope</WorkspaceConfirmation>));
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!; expect(document.activeElement).toBe(dialog);
    for (const shiftKey of [false, true]) { const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true }); await act(async () => dialog.dispatchEvent(event)); expect(event.defaultPrevented).toBe(true); expect(document.activeElement).toBe(dialog); }
    await act(async () => dialog.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })));
    expect(cancel).not.toHaveBeenCalled(); expect(confirm).not.toHaveBeenCalled(); expect(host.inert).toBe(true);
  } finally { await act(async () => root.unmount()); expect(host.inert).toBe(false); host.remove(); }
});
