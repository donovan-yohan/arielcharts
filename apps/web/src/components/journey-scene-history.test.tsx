// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import type { OverlayRevision } from '@arielcharts/shared';
import { OverlayCanvasLayer } from './overlay-canvas-layer';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
it('never offers a server scene restore for local canvas', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  const noop = () => {};
  await act(async () => root.render(<OverlayCanvasLayer diagramId="main" sessionId="local" scene={{ version: 1, diagram_id: 'main', objects: [] }} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} readOnly={false} onAdd={noop} onAnchor={noop} onCopy={noop} onDelete={noop} onMove={noop} onPaste={noop} onReorder={noop} onUndo={noop} onUpdate={noop} onEditText={noop} onDuplicate={() => null} onBeginComposition={() => null} onCommitComposition={noop} />));
  const button = (label: string) => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!;
  await act(async () => button('More canvas tools').click());
  await act(async () => button('Objects and layers').click());
  const restore = document.querySelector<HTMLButtonElement>('button[aria-label^="Restore"]')!;
  expect(restore.disabled).toBe(true);
  expect(document.body.textContent).toContain('Scene history is available online');
  await act(async () => restore.click()); expect(fetcher).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});

type HistoryFixture = { head: string; posts: Array<{ url: string; body: { expected_revision: string } }> };
async function mountOnline(fixture: HistoryFixture) {
  const target: OverlayRevision = { revision_id: 'scene-before', sequence: 1, diagram_id: 'main', timestamp: 1000, actor: { name: 'Fixture author', type: 'human' }, action: 'checkpoint', result_revision: 'previous-head', scene: { version: 1, diagram_id: 'main', objects: [], layers: [] } };
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') { fixture.posts.push({ url, body: JSON.parse(String(init.body)) }); return Response.json({ status: 'restored', scene: target.scene, revision: target }); }
    if (url.endsWith('/history')) return Response.json({ current_revision: fixture.head, revisions: [target] });
    if (url.endsWith('/history/scene-before')) return Response.json({ revision: target });
    return Response.json({ revision: fixture.head, scene: target.scene });
  }));
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const noop = () => {};
  await act(async () => root.render(<OverlayCanvasLayer historyAvailable diagramName="Safe diagram" diagramId="main" sessionId="roomfixture" scene={{ version: 1, diagram_id: 'main', objects: [] }} semanticAnchors={new Map()} transform={{ x: 0, y: 0, zoom: 1 }} readOnly={false} onAdd={noop} onAnchor={noop} onCopy={noop} onDelete={noop} onMove={noop} onPaste={noop} onReorder={noop} onUndo={noop} onUpdate={noop} onEditText={noop} onDuplicate={() => null} onBeginComposition={() => null} onCommitComposition={noop} />));
  for (const label of ['More canvas tools', 'Objects and layers', 'Restore previous canvas scene…']) await act(async () => document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`)!.click());
  return root;
}
const dialogButton = (name: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === name)!;
it('reads real target metadata and cancels without a scene write', async () => {
  const fixture: HistoryFixture = { head: 'accepted-head', posts: [] }; const root = await mountOnline(fixture);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('scene-before');
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Fixture author');
  expect(document.activeElement).toBe(dialogButton('Cancel'));
  await act(async () => dialogButton('Cancel').click()); expect(fixture.posts).toEqual([]);
  await act(async () => root.unmount());
});
it('uses the confirmed target and one fresh checked head for scene restore', async () => {
  const fixture: HistoryFixture = { head: 'accepted-head', posts: [] }; const root = await mountOnline(fixture);
  await act(async () => dialogButton('Restore scene').click());
  expect(fixture.posts).toEqual([{ url: expect.stringContaining('/history/scene-before/restore'), body: { expected_revision: 'accepted-head', actor_name: 'Browser', actor_type: 'human' } }]);
  expect(document.body.textContent).toContain('Canvas scene restored.');
  await act(async () => root.unmount());
});
it('requires renewed review instead of sending a restore after the head changes', async () => {
  const fixture: HistoryFixture = { head: 'accepted-head', posts: [] }; const root = await mountOnline(fixture);
  fixture.head = 'new-head'; await act(async () => dialogButton('Restore scene').click());
  expect(fixture.posts).toEqual([]); expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.textContent).toContain('Review the previous scene again');
  await act(async () => root.unmount());
});
