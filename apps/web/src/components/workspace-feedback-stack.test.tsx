// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it } from 'vitest';
import { WorkspaceFeedbackStack } from './workspace-feedback-stack';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
it('deduplicates a mounted record error but restores the separate mutation notice when source invalidation hides the record', async () => {
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const render = (local: boolean) => <article className="workspace-diagram-pane">{local ? <small className="semantic-editor-error">Value is invalid.</small> : null}<WorkspaceFeedbackStack mutationError="Value is invalid."><div data-testid="parse-error-banner">Parse error.</div><div data-testid="mutation-error-banner">Value is invalid.</div></WorkspaceFeedbackStack></article>;
  await act(async () => root.render(render(true)));
  expect(host.querySelector('[data-testid="mutation-error-banner"]')).toBeNull();
  expect(host.querySelector('[data-testid="parse-error-banner"]')).not.toBeNull();
  await act(async () => root.render(render(false)));
  expect(host.querySelector('[data-testid="mutation-error-banner"]')).not.toBeNull();
  await act(async () => root.unmount()); host.remove();
});
