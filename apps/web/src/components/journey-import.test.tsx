// @vitest-environment happy-dom
import React, { act } from 'react';
import { webcrypto } from 'node:crypto';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { snapshotWorkspaceBundle, encodeWorkspaceBundle, canonicalJson } from '../lib/workspace-bundle';
import { captureWorkspaceConsentScope } from '../lib/workspace-consent';
import { getOverlayScene } from '../lib/overlay-scene';
import { WorkspaceExportMenu } from './workspace-export-menu';
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });
function fixture(source: string) {
  const doc = new Y.Doc(); const diagram = new Y.Map<unknown>();
  diagram.set('name', 'Safe fixture'); diagram.set('mermaid', new Y.Text(source)); diagram.set('nodePositions', new Y.Map());
  doc.getMap('diagrams').set('main', diagram); doc.getArray('diagramOrder').push(['main']); getOverlayScene(doc, 'main', true); return doc;
}
async function chooseBundle(workspace: Y.Doc, mode: 'local' | 'online' = 'local', expectConfirmation = true) {
  vi.stubGlobal('crypto', webcrypto);
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host); const onImported = vi.fn();
  await act(async () => root.render(<WorkspaceExportMenu activeDiagramName="Safe fixture" mermaidSource="flowchart LR" mermaidSvg="" onImported={onImported} scene={null} sessionId="fixture" theme="light" workspace={workspace} workspaceMode={mode} />));
  await act(async () => host.querySelector('button')!.click());
  const text = await encodeWorkspaceBundle(snapshotWorkspaceBundle(fixture('pie\n"Imported" : 3')));
  const input = host.querySelector<HTMLInputElement>('input[type="file"]')!;
  Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'safe.arielcharts', size: text.length, text: async () => text }] });
  await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })); await new Promise((resolve) => setTimeout(resolve, 30)); });
  if (expectConfirmation) expect(document.querySelector('[role="dialog"]')?.textContent).toContain('safe.arielcharts');
  return { host, root, onImported };
}
const action = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === text)!;
it('does not replace any document content until confirmed, and Cancel preserves exact bytes', async () => {
  const doc = fixture('flowchart LR\nA-->B'); const before = Y.encodeStateAsUpdate(doc);
  const { root, onImported } = await chooseBundle(doc);
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before); expect(document.activeElement).toBe(action('Cancel'));
  await act(async () => { action('Cancel').dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); action('Cancel').click(); });
  expect(document.querySelector('[role="menu"]')).not.toBeNull();
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before); expect(onImported).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
it('confirms one local atomic bundle replacement', async () => {
  const doc = fixture('flowchart LR\nA-->B'); const { root, onImported } = await chooseBundle(doc);
  await act(async () => action('Replace workspace').click());
  expect(snapshotWorkspaceBundle(doc).diagrams[0]?.mermaid.source).toBe('pie\n"Imported" : 3'); expect(onImported).toHaveBeenCalledTimes(1);
  await act(async () => root.unmount());
});
it('retires confirmation after a local target change instead of replacing the new content', async () => {
  const doc = fixture('flowchart LR\nA-->B'); const { root, onImported } = await chooseBundle(doc);
  const source = (doc.getMap<Y.Map<unknown>>('diagrams').get('main')!.get('mermaid') as Y.Text); source.insert(source.length, '\nB-->C');
  const before = Y.encodeStateAsUpdate(doc); await act(async () => action('Replace workspace').click());
  expect(Y.encodeStateAsUpdate(doc)).toEqual(before); expect(onImported).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.textContent).toContain('Workspace changed'); await act(async () => root.unmount());
});
it('uses the reviewed online revision once and requires renewed review on conflict', async () => {
  const doc = fixture('flowchart LR\nA-->B');
  const content = canonicalJson(JSON.parse(captureWorkspaceConsentScope(doc, 'fixture').content));
  const fetcher = vi.fn(async (_url: string, init?: RequestInit) => init?.method === 'POST' ? Response.json({ error: 'Workspace changed', revision: 'new-head' }, { status: 409 }) : Response.json({ revision: 'confirmed-head', content })); vi.stubGlobal('fetch', fetcher);
  const { root, onImported } = await chooseBundle(doc, 'online');
  await act(async () => action('Replace workspace').click());
  const posts = fetcher.mock.calls.filter(([, init]) => init?.method === 'POST'); expect(posts).toHaveLength(1);
  expect(JSON.parse(String(posts[0]![1]?.body)).expected_revision).toBe('confirmed-head');
  expect(onImported).not.toHaveBeenCalled(); expect(document.querySelector('[role="dialog"]')).toBeNull();
  await act(async () => root.unmount());
});

for (const kind of ['source', 'tab', 'overlay']) it(`refuses a server head with unseen ${kind} content before confirmation`, async () => {
  const doc = fixture('flowchart LR\nA-->B'); const server = new Y.Doc(); Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
  if (kind === 'source') (server.getMap<Y.Map<unknown>>('diagrams').get('main')!.get('mermaid') as Y.Text).insert(0, '%% unseen\n');
  if (kind === 'tab') { const extra = new Y.Map(); extra.set('name', 'Unseen'); extra.set('mermaid', new Y.Text('pie')); extra.set('nodePositions', new Y.Map()); server.getMap('diagrams').set('unseen', extra); server.getArray('diagramOrder').push(['unseen']); }
  if (kind === 'overlay') server.getMap<Y.Map<unknown>>('overlays').get('main')!.set('future-cell', 'unseen');
  const content = canonicalJson(JSON.parse(captureWorkspaceConsentScope(server, 'fixture').content));
  const fetcher = vi.fn(async () => Response.json({ revision: 'unseen-head', content })); vi.stubGlobal('fetch', fetcher);
  const before = Y.encodeStateAsUpdate(doc); const { root, onImported } = await chooseBundle(doc, 'online', false);
  try {
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.textContent).toContain('not match'); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(onImported).not.toHaveBeenCalled(); expect(Y.encodeStateAsUpdate(doc)).toEqual(before);
  } finally { await act(async () => root.unmount()); doc.destroy(); server.destroy(); }
});
