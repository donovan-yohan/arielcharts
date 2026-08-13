import { createHash, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { addOverlayObject, getOverlayScene } from './overlay-scene';
import {
  WorkspaceBundleError,
  applyWorkspaceBundleLocally,
  canonicalJson,
  decodeWorkspaceBundleEnvelope,
  decodeWorkspaceBundle,
  downloadBlob,
  encodeWorkspaceBundle,
  snapshotWorkspaceBundle,
} from './workspace-bundle';

if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function workspace(): Y.Doc {
  const doc = new Y.Doc(); const diagram = new Y.Map<unknown>();
  diagram.set('name', 'Threat model'); diagram.set('mermaid', new Y.Text('flowchart LR\n  A-->B  '));
  diagram.set('nodePositions', new Y.Map([['A', { x: 12, y: 24 }]]));
  doc.getMap<Y.Map<unknown>>('diagrams').set('main', diagram); doc.getArray<string>('diagramOrder').push(['main']);
  addOverlayObject(doc, 'main', { id: 'note', kind: 'annotation.sticky', version: 1, order_key: 'a', layer: 'default', geometry: { x: 30, y: 40, width: 160, height: 90, rotation: 0 }, style: {}, metadata: { export: 'arielcharts-only' }, payload: {}, body: 'private review note' });
  addOverlayObject(doc, 'main', { id: 'stroke', kind: 'ink.stroke', version: 1, order_key: 'b', layer: 'default', geometry: { x: 0, y: 0, width: 10, height: 10, rotation: 0 }, style: { color: '#2563eb', width: 2, opacity: 1 }, metadata: { export: 'composite-export' }, payload: { mode: 'pen', composite_export: true, points: [{ x: 1, y: 1 }, { x: 9, y: 9 }] } });
  return doc;
}

describe('workspace bundles', () => {
  function signPayload(payload: unknown) {
    return {
      format: 'arielcharts.workspace' as const,
      version: 1 as const,
      payload,
      integrity: { algorithm: 'SHA-256' as const, value: createHash('sha256').update(canonicalJson(payload)).digest('hex') },
    };
  }

  it('keeps the download anchor and object URL alive through the browser handoff, then cleans both up', async () => {
    vi.useFakeTimers();
    const anchor = { href: '', download: '', rel: '', click: vi.fn(), remove: vi.fn() } as unknown as HTMLAnchorElement;
    const append = vi.fn();
    vi.stubGlobal('document', { body: { append }, createElement: vi.fn(() => anchor) });
    vi.stubGlobal('window', { setTimeout: globalThis.setTimeout.bind(globalThis) });
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);

    downloadBlob('workspace.mmd', new Blob(['source'], { type: 'text/vnd.mermaid; charset=utf-8' }));

    expect(createObjectURL).toHaveBeenCalledOnce();
    expect(append).toHaveBeenCalledWith(anchor);
    expect(anchor.click).toHaveBeenCalledOnce();
    expect(anchor.remove).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(999);
    expect(anchor.remove).not.toHaveBeenCalled();
    expect(revokeObjectURL).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(anchor.remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:download');
  });

  it('round-trips stable IDs, exact source bytes, layout, layers, and current overlay kinds without transient state', async () => {
    const source = workspace(); source.getMap('presence').set('leak', { cookie: 'nope' }); source.getArray('activity').push([{ private: 'history' }]);
    const encoded = await encodeWorkspaceBundle(snapshotWorkspaceBundle(source));
    expect(encoded).not.toContain('cookie'); expect(encoded).not.toContain('history');
    const decoded = await decodeWorkspaceBundle(encoded);
    expect(decoded.diagrams[0]?.mermaid.source).toBe('flowchart LR\n  A-->B  ');
    expect(decoded.diagrams[0]?.layout.positions).toMatchObject({ A: { x: 12, y: 24 } });
    expect(decoded.diagrams[0]?.overlay.objects.map(({ id }) => id)).toEqual(['note', 'stroke']);
  });

  it('rejects tampered, truncated, oversized, and newer payloads before the document changes', async () => {
    const encoded = await encodeWorkspaceBundle(snapshotWorkspaceBundle(workspace()));
    const before = workspace(); const signature = () => JSON.stringify(snapshotWorkspaceBundle(before));
    const baseline = signature();
    const tampered = JSON.parse(encoded) as { payload: { diagrams: Array<{ name: string }> } }; tampered.payload.diagrams[0]!.name = 'changed';
    for (const input of [JSON.stringify(tampered), encoded.slice(0, -9), 'x'.repeat(192 * 1024 + 1), JSON.stringify({ ...JSON.parse(encoded), version: 2 })]) {
      await expect(decodeWorkspaceBundle(input)).rejects.toBeInstanceOf(WorkspaceBundleError);
      expect(signature()).toBe(baseline);
    }
  });

  it('fails closed on unknown fields, path-like IDs, and invalid overlay payloads', async () => {
    const raw = JSON.parse(await encodeWorkspaceBundle(snapshotWorkspaceBundle(workspace()))) as Record<string, unknown>;
    await expect(decodeWorkspaceBundle(JSON.stringify({ ...raw, room_key: 'secret' }))).rejects.toThrow(/not an ArielCharts/u);
    const payload = raw.payload as { diagrams: Array<{ id: string; overlay: { objects: unknown[] } }> };
    payload.diagrams[0]!.id = '../main';
    await expect(decodeWorkspaceBundle(JSON.stringify(raw))).rejects.toThrow(/integrity|catalog|overlay/u);
  });

  it('applies a validated local import in catalog order', async () => {
    const source = workspace();
    const second = new Y.Map<unknown>();
    second.set('name', 'Second'); second.set('mermaid', new Y.Text('sequenceDiagram'));
    second.set('nodePositions', new Y.Map<unknown>());
    source.getMap<Y.Map<unknown>>('diagrams').set('second', second);
    source.getArray<string>('diagramOrder').push(['second']);
    getOverlayScene(source, 'second', true);
    const bundle = await decodeWorkspaceBundleEnvelope(await encodeWorkspaceBundle(snapshotWorkspaceBundle(source)));
    bundle.payload.order = ['second', 'main'];
    const target = new Y.Doc();
    applyWorkspaceBundleLocally(target, bundle);
    expect(target.getArray<string>('diagramOrder').toArray()).toEqual(['second', 'main']);
  });

  it('rejects signed empty catalogs and whitespace-only names before local mutation', async () => {
    const target = workspace();
    const before = JSON.stringify(snapshotWorkspaceBundle(target));
    const validPayload = structuredClone(snapshotWorkspaceBundle(workspace()));
    const empty = { ...validPayload, diagrams: [], order: [] };
    const whitespace = structuredClone(validPayload);
    whitespace.diagrams[0]!.name = ' \t ';

    for (const bundle of [signPayload(empty), signPayload(whitespace)]) {
      await expect(decodeWorkspaceBundleEnvelope(JSON.stringify(bundle))).rejects.toBeInstanceOf(WorkspaceBundleError);
      expect(JSON.stringify(snapshotWorkspaceBundle(target))).toBe(before);
    }
  });

});
