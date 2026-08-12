import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createActivityEvent } from './activity.js';
import { COLLABORATION_BUDGETS } from './document-admission.js';
import type { ActivityEvent } from '@arielcharts/shared';
import { SessionStore } from './persistence.js';
import { SessionManager } from './session-manager.js';

async function createResources() {
  const dataDir = await mkdtemp(join(tmpdir(), 'arielcharts-cleanup-'));
  let store: SessionStore | undefined;
  return {
    dataDir,
    createManager: () => {
      store = new SessionStore(dataDir);
      return new SessionManager(store);
    },
    get store() {
      if (!store) throw new Error('Create a manager before accessing its store.');
      return store;
    },
    async cleanup() { await rm(dataDir, { recursive: true, force: true }); },
  };
}

function activity(action: ActivityEvent['action']) {
  return createActivityEvent({ action, actorName: 'agent', actorType: 'agent' });
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => { resolve = next; });
  return { promise, resolve };
}

function setOverlayObject(doc: Y.Doc, diagramId: string, id: string, text: string, kind = 'foundation.card'): void {
  const scene = doc.getMap<Y.Map<unknown>>('overlays').get(diagramId)!;
  const objects = scene.get('objects') as Y.Map<Y.Map<unknown>>;
  const object = new Y.Map<unknown>();
  object.set('kind', kind);
  object.set('version', 1);
  object.set('order_key', id);
  object.set('geometry', { x: 10, y: 20, width: 100, height: 40, rotation: 0 });
  object.set('style', {});
  object.set('metadata', {});
  object.set('payload', { text });
  objects.set(id, object);
  if (kind === 'annotation.text' || kind === 'annotation.sticky') {
    const body = new Y.Text(); object.set('body', body); body.insert(0, text);
  }
}

describe('SessionManager multi-diagram persistence and invariants', () => {
  let resources: Awaited<ReturnType<typeof createResources>>;
  let manager: SessionManager;
  beforeEach(async () => { resources = await createResources(); manager = resources.createManager(); });
  afterEach(async () => { await manager.close(); await resources.cleanup(); });

  it('initializes exactly one durable main diagram when concurrent callers open a new session', async () => {
    await Promise.all(Array.from({ length: 12 }, () => manager.getOrCreateSession('abc123de')));
    await expect(manager.getSession('abc123de')).resolves.toMatchObject({ diagrams: [{ id: 'main', name: 'Main' }] });
  });

  it('persists ordered named diagrams and their independent Mermaid source across eviction and reload', async () => {
    await manager.getOrCreateSession('abc123de');
    const initial = await manager.getSession('abc123de');
    const api = await manager.createDiagram('abc123de', 'API flow', 'sequenceDiagram\n  Browser->>API: POST', initial.revision, activity('created'));
    const main = await manager.readDiagram('abc123de', 'main');
    await manager.writeDiagram('abc123de', 'main', 'flowchart LR\n  Human-->Editor', main.diagram.revision, activity('replaced'));

    const session = await manager.getOrCreateSession('abc123de');
    const removed = await manager.cleanupExpiredSessions({ ttlMs: 0, diskTtlMs: Infinity, now: session.lastAccessedAt + 1 });
    expect(removed).toEqual(['abc123de']);

    await expect(manager.readSession('abc123de')).resolves.toMatchObject({
      diagrams: [
        { id: 'main', name: 'Main', mermaid_text: 'flowchart LR\n  Human-->Editor' },
        { id: api.id, name: 'API flow', mermaid_text: 'sequenceDiagram\n  Browser->>API: POST' },
      ],
    });
  });

  it('treats the revision as an optimistic concurrency invariant', async () => {
    await manager.getOrCreateSession('abc123de');
    const firstRead = await manager.readDiagram('abc123de', 'main');
    const write = await manager.writeDiagram('abc123de', 'main', 'timeline\n  now : request', firstRead.diagram.revision, activity('replaced'));
    await expect(manager.renameDiagram('abc123de', 'main', 'Requests', firstRead.diagram.revision, activity('renamed'))).rejects.toThrow('Stale diagram revision');
    await expect(manager.renameDiagram('abc123de', 'main', 'Requests', write.revision, activity('renamed'))).resolves.toMatchObject({ name: 'Requests' });
  });

  it('applies the durable source budget before MCP-owned mutations touch the live document', async () => {
    await manager.getOrCreateSession('abc123de');
    const current = await manager.readDiagram('abc123de', 'main');
    await expect(manager.writeDiagram(
      'abc123de',
      'main',
      'x'.repeat(COLLABORATION_BUDGETS.totalTextBytes + 1),
      current.diagram.revision,
      activity('replaced'),
    )).rejects.toThrow('Mermaid source exceeds the collaborative document text budget');
    await expect(manager.readDiagram('abc123de', 'main')).resolves.toMatchObject({ diagram: { mermaid_text: '' } });
  });

  it('enforces normalized unique names and prevents last-tab deletion', async () => {
    await manager.getOrCreateSession('abc123de');
    const initial = await manager.getSession('abc123de');
    await expect(manager.createDiagram('abc123de', ' MAIN ', '', initial.revision, activity('created'))).rejects.toThrow('Diagram name already exists');
    await expect(manager.deleteDiagram('abc123de', 'main', initial.diagrams[0]!.revision, activity('deleted'))).rejects.toThrow('must retain at least one diagram');
  });

  it('deterministically reconciles same-name browser updates from two Yjs documents', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const initial = await manager.getSession('abc123de');
    const first = await manager.createDiagram('abc123de', 'First', '', initial.revision, activity('created'));
    const afterFirst = await manager.getSession('abc123de');
    const second = await manager.createDiagram('abc123de', 'Second', '', afterFirst.revision, activity('created'));
    const baseline = Y.encodeStateAsUpdate(state.doc);
    const browserA = new Y.Doc();
    const browserB = new Y.Doc();
    Y.applyUpdate(browserA, baseline);
    Y.applyUpdate(browserB, baseline);

    browserA.getMap<Y.Map<unknown>>('diagrams').get(first.id)?.set('name', 'Checkout flow');
    browserB.getMap<Y.Map<unknown>>('diagrams').get(second.id)?.set('name', ' checkout   flow ');
    Y.applyUpdate(state.doc, Y.encodeStateAsUpdate(browserA, Y.encodeStateVector(state.doc)));
    Y.applyUpdate(state.doc, Y.encodeStateAsUpdate(browserB, Y.encodeStateVector(state.doc)));

    const reconciled = (await manager.getSession('abc123de')).diagrams.filter((diagram) => diagram.id === first.id || diagram.id === second.id);
    const loserId = [first.id, second.id].sort((left, right) => left.localeCompare(right))[1]!;
    expect(reconciled.find((diagram) => diagram.id === loserId)?.name).toContain(loserId.slice(-4));
    const names = reconciled.map((diagram) => diagram.name);
    expect(new Set(names.map((name) => name.toLocaleLowerCase())).size).toBe(names.length);
  });

  it('repairs raw removal of every tab by reseeding one reachable main diagram', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const browser = new Y.Doc();
    Y.applyUpdate(browser, Y.encodeStateAsUpdate(state.doc));
    browser.transact(() => {
      browser.getMap('diagrams').delete('main');
      const order = browser.getArray<string>('diagramOrder');
      order.delete(0, order.length);
    });

    Y.applyUpdate(state.doc, Y.encodeStateAsUpdate(browser, Y.encodeStateVector(state.doc)));

    await expect(manager.getSession('abc123de')).resolves.toMatchObject({
      diagrams: [{ id: 'main', name: 'Main' }],
    });
  });

  it('repairs and persists a malformed stored catalog on a lazy session read', async () => {
    await manager.close();
    const malformed = new Y.Doc();
    malformed.getMap('diagrams');
    malformed.getArray<string>('diagramOrder').push(['orphan']);
    const store = new SessionStore(resources.dataDir);
    await store.set({
      id: 'abc123de',
      title: 'Broken',
      activity: [],
      participants: [],
      encodedState: Buffer.from(Y.encodeStateAsUpdate(malformed)).toString('base64'),
      updatedAt: 1,
    });
    await store.close();
    manager = resources.createManager();

    await expect(manager.getSession('abc123de')).resolves.toMatchObject({
      diagrams: [{ id: 'main', name: 'Main' }],
    });
    await manager.close();
    manager = resources.createManager();
    await expect(manager.getSession('abc123de')).resolves.toMatchObject({
      diagrams: [{ id: 'main', name: 'Main' }],
    });
  });

  it('refuses an oversized persisted update before constructing a live document', async () => {
    await manager.close();
    const store = new SessionStore(resources.dataDir);
    await store.set({
      id: 'abc123de',
      title: 'Oversized',
      activity: [],
      participants: [],
      encodedState: Buffer.alloc(COLLABORATION_BUDGETS.sessionStateBytes + 1, 1).toString('base64'),
      updatedAt: 1,
    });
    await store.close();
    manager = resources.createManager();

    await expect(manager.getSession('abc123de')).rejects.toThrow('Persisted session rejected: document_state_too_large');
  });

  it('fails closed when persisted reserved roots have the wrong collection type', async () => {
    await manager.close();
    const malformed = new Y.Doc();
    malformed.getMap('activity').set('not', 'an array');
    const store = new SessionStore(resources.dataDir);
    await store.set({
      id: 'abc123de',
      title: 'Malformed root',
      activity: [],
      participants: [],
      encodedState: Buffer.from(Y.encodeStateAsUpdate(malformed)).toString('base64'),
      updatedAt: 1,
    });
    await store.close();
    manager = resources.createManager();

    await expect(manager.getSession('abc123de')).rejects.toThrow('Persisted session rejected: invalid_reserved_root');
  });

  it('preserves a newer overlay scene unchanged across persisted reload', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const baselineId = (await manager.listOverlayHistory('abc123de', 'main')).revisions[0]!.revision_id;
    state.doc.transact(() => {
      const scene = new Y.Map<unknown>();
      scene.set('version', 2);
      const objects = new Y.Map<Y.Map<unknown>>();
      const standardLooking = new Y.Map<unknown>();
      standardLooking.set('kind', 'future.card');
      standardLooking.set('version', 1);
      standardLooking.set('order_key', 'a');
      standardLooking.set('geometry', { x: 1, y: 2, width: 3, height: 4, rotation: 0 });
      standardLooking.set('style', {});
      standardLooking.set('metadata', {});
      standardLooking.set('payload', { text: 'future' });
      objects.set('future-object', standardLooking);
      scene.set('objects', objects);
      const opaque = new Y.Map<unknown>();
      opaque.set('newer', true);
      scene.set('opaque_newer_field', opaque);
      state.doc.getMap<Y.Map<unknown>>('overlays').set('main', scene);
    });
    await manager.persistSession(state);
    await expect(manager.readOverlayScene('abc123de', 'main')).rejects.toThrow('Unsupported overlay scene version: 2');
    await expect(manager.listOverlayHistory('abc123de', 'main')).rejects.toThrow('Unsupported overlay scene version: 2');
    await expect(manager.restoreOverlayRevision('abc123de', 'main', baselineId, 'unused', { name: 'Ada', type: 'human' }))
      .rejects.toThrow('Unsupported overlay scene version: 2');
    await manager.cleanupExpiredSessions({ ttlMs: 0, diskTtlMs: Infinity, now: state.lastAccessedAt + 1 });

    const restored = await manager.getOrCreateSession('abc123de');
    const scene = restored.doc.getMap<Y.Map<unknown>>('overlays').get('main');
    expect(scene?.get('version')).toBe(2);
    expect(((scene?.get('objects') as Y.Map<Y.Map<unknown>>).get('future-object')?.get('payload') as { text: string }).text).toBe('future');
    expect((scene?.get('opaque_newer_field') as Y.Map<unknown>).get('newer')).toBe(true);
  });

  it('fails closed on unsupported v1 objects without projecting, restoring, or rewriting the raw record', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const baselineId = (await manager.listOverlayHistory('abc123de', 'main')).revisions[0]!.revision_id;
    state.doc.transact(() => setOverlayObject(state.doc, 'main', 'future', 'opaque'));
    const object = ((state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('future'))!;
    object.set('kind', 'future.tool');
    object.set('payload', { opaque: { keep: true } });
    await manager.persistSession(state);
    const before = Buffer.from(Y.encodeStateAsUpdate(state.doc));
    await expect(manager.readOverlayScene('abc123de', 'main')).rejects.toThrow('Unsupported overlay object: future.tool@1');
    await expect(manager.listOverlayHistory('abc123de', 'main')).rejects.toThrow('Unsupported overlay object: future.tool@1');
    await expect(manager.restoreOverlayRevision('abc123de', 'main', baselineId, 'unused', { name: 'Ada', type: 'human' }))
      .rejects.toThrow('Unsupported overlay object: future.tool@1');
    expect(Buffer.from(Y.encodeStateAsUpdate(state.doc))).toEqual(before);
    expect(object.get('payload')).toEqual({ opaque: { keep: true } });
    await manager.cleanupExpiredSessions({ ttlMs: 0, diskTtlMs: Infinity, now: state.lastAccessedAt + 1 });
    const reloaded = await manager.getOrCreateSession('abc123de');
    const restoredObject = ((reloaded.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('future'))!;
    expect(restoredObject.get('kind')).toBe('future.tool');
    expect(restoredObject.get('payload')).toEqual({ opaque: { keep: true } });
  });

  it('exposes an opaque v1 sibling but fails closed for every MCP mutation without dropping raw data', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    state.doc.transact(() => {
      setOverlayObject(state.doc, 'main', 'opaque', 'keep');
      const opaque = ((state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('opaque'))!;
      opaque.set('kind', 'future.tool'); opaque.set('payload', { opaque: { retain: true } }); opaque.set('future_field', { retain: true });
    });
    await manager.persistSession(state);
    const sourceBefore = await manager.readDiagram('abc123de', 'main');
    const current = await manager.readMcpOverlayScene('abc123de', 'main');
    expect(current).toMatchObject({ writable: false, objects: [], opaque_objects: [{ id: 'opaque', kind: 'future.tool', version: 1 }] });
    await expect(manager.createMcpOverlayObject('abc123de', 'main', current.overlay_revision, {
      id: 'known', kind: 'foundation.card', version: 1, order_key: 'z',
      geometry: { x: 1, y: 2, width: 40, height: 20, rotation: 0 }, style: {}, metadata: {}, payload: { text: 'known' },
    })).rejects.toThrow('read-only through MCP');
    const rawOpaque = ((state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('opaque'))!;
    expect(rawOpaque.get('payload')).toEqual({ opaque: { retain: true } });
    expect(rawOpaque.get('future_field')).toEqual({ retain: true });
    expect((await manager.readDiagram('abc123de', 'main')).diagram).toEqual(sourceBefore.diagram);
    await manager.close(); manager = resources.createManager();
    await expect(manager.readMcpOverlayScene('abc123de', 'main')).resolves.toMatchObject({
      objects: [], opaque_objects: [{ id: 'opaque', kind: 'future.tool' }],
    });
  });

  it('makes browser-valid but MCP-unrepresentable v1 objects opaque without disclosing their raw identifier or payload', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const longId = '😺'.repeat(80);
    const oversizedPayload = Object.fromEntries(Array.from({ length: 33 }, (_, index) => [`field-${index}`, index]));
    const largePayloadValue = 'x'.repeat(8_193);
    const nestedText = new Y.Text('browser-only nested text');
    const nestedMap = new Y.Map<unknown>(); nestedMap.set('browser', 'only');
    state.doc.transact(() => {
      setOverlayObject(state.doc, 'main', longId, 'safe-browser-value');
      const long = ((state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get(longId))!;
      long.set('order_key', 'long-id-order');
      setOverlayObject(state.doc, 'main', 'many-payload-fields', 'safe-browser-value');
      ((state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('many-payload-fields'))!.set('payload', oversizedPayload);
      setOverlayObject(state.doc, 'main', 'large-payload-value', 'safe-browser-value');
      ((state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('large-payload-value'))!.set('payload', { value: largePayloadValue });
      setOverlayObject(state.doc, 'main', 'nested-y-text', 'safe-browser-value');
      ((state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('nested-y-text'))!.set('payload', { nestedText });
      setOverlayObject(state.doc, 'main', 'nested-y-map', 'safe-browser-value');
      ((state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('nested-y-map'))!.set('payload', { nestedMap });
    });

    const first = await manager.readMcpOverlayScene('abc123de', 'main');
    expect(first).toMatchObject({ writable: false, objects: [] });
    expect(first.opaque_objects).toContainEqual({ id: 'many-payload-fields', kind: 'foundation.card', version: 1 });
    expect(first.opaque_objects).toContainEqual({ id: 'large-payload-value', kind: 'foundation.card', version: 1 });
    expect(first.opaque_objects).toContainEqual({ id: 'nested-y-text', kind: 'foundation.card', version: 1 });
    expect(first.opaque_objects).toContainEqual({ id: 'nested-y-map', kind: 'foundation.card', version: 1 });
    const longMarker = first.opaque_objects.find(({ id }) => id !== 'many-payload-fields')!;
    expect(Buffer.byteLength(longMarker.id, 'utf8')).toBeLessThanOrEqual(COLLABORATION_BUDGETS.identifierBytes);
    expect(longMarker.id).not.toBe(longId);
    expect(JSON.stringify(first)).not.toContain(longId);
    expect(JSON.stringify(first)).not.toContain('field-32');
    expect(JSON.stringify(first)).not.toContain(largePayloadValue);
    expect(JSON.stringify(first)).not.toContain('browser-only nested text');
    await expect(manager.readMcpOverlayObject('abc123de', 'main', longMarker.id)).resolves.toMatchObject({ status: 'opaque', writable: false, object: { id: longMarker.id } });
    const listed = await manager.listMcpOverlayObjects('abc123de', 'main');
    expect(listed.writable).toBe(false);
    expect(listed.objects).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'many-payload-fields', opaque: true }),
      expect.objectContaining({ id: 'large-payload-value', opaque: true }),
      expect.objectContaining({ id: 'nested-y-text', opaque: true }),
      expect.objectContaining({ id: 'nested-y-map', opaque: true }),
      expect.objectContaining({ id: longMarker.id, opaque: true }),
    ]));
    await expect(manager.readMcpOverlayObject('abc123de', 'main', 'large-payload-value')).resolves.toMatchObject({ status: 'opaque', writable: false });

    const beforeRaw = Buffer.from(Y.encodeStateAsUpdate(state.doc));
    await expect(manager.createMcpOverlayObject('abc123de', 'main', first.overlay_revision, {
      id: 'agent-object', kind: 'foundation.card', version: 1, order_key: 'agent-object',
      geometry: { x: 0, y: 0, width: 10, height: 10, rotation: 0 }, style: {}, metadata: {}, payload: {},
    })).rejects.toThrow('read-only through MCP');
    expect(Buffer.from(Y.encodeStateAsUpdate(state.doc))).toEqual(beforeRaw);

    const rawLong = ((state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get(longId))!;
    rawLong.set('payload', { changed: true });
    const second = await manager.readMcpOverlayScene('abc123de', 'main');
    expect(second.overlay_revision).not.toBe(first.overlay_revision);
    expect(((state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('many-payload-fields'))!.get('payload')).toEqual(oversizedPayload);
    // Nested shared payload data is browser/Yjs-admissible but not supported
    // by the legacy snapshot serializer used by this fixture's teardown.
    // Remove only those two probe objects after MCP has proved it never cloned
    // them; the long-ID and plain oversized browser values remain durable.
    state.doc.transact(() => {
      const objects = state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>;
      objects.delete('nested-y-text'); objects.delete('nested-y-map');
    });
  });

  it('changes the raw MCP revision when opaque data changes, without treating it as writable', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    state.doc.transact(() => setOverlayObject(state.doc, 'main', 'opaque', 'first'));
    const opaque = ((state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('opaque'))!;
    opaque.set('kind', 'future.tool'); opaque.set('payload', { opaque: 'first' });
    const first = await manager.readMcpOverlayScene('abc123de', 'main');
    opaque.set('payload', { opaque: 'second' });
    const second = await manager.readMcpOverlayScene('abc123de', 'main');
    expect(first.writable).toBe(false); expect(second.writable).toBe(false);
    expect(second.overlay_revision).not.toBe(first.overlay_revision);
  });

  it('fingerprints opaque nested Y shared types by canonical raw scene bytes', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    state.doc.transact(() => setOverlayObject(state.doc, 'main', 'opaque', 'first'));
    const opaque = ((state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('opaque'))!;
    opaque.set('kind', 'future.tool');
    const future = new Y.XmlElement('future'); future.setAttribute('variant', 'one'); opaque.set('future_shared', future);
    const first = await manager.readMcpOverlayScene('abc123de', 'main');
    future.setAttribute('variant', 'two');
    const second = await manager.readMcpOverlayScene('abc123de', 'main');
    expect(second.overlay_revision).not.toBe(first.overlay_revision);
  });

  it('admits the exact participant insertion with an overlay mutation before touching the live scene', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    state.doc.transact(() => {
      const presence = state.doc.getMap<{ name: string; color: string; type: 'agent' }>('presence');
      for (let index = 0; index < COLLABORATION_BUDGETS.participantsPerSession; index += 1) {
        presence.set(`agent-${index}`, { name: `agent-${index}`, color: '#123456', type: 'agent' });
      }
    });
    const current = await manager.readMcpOverlayScene('abc123de', 'main');
    await expect(manager.createMcpOverlayObject('abc123de', 'main', current.overlay_revision, {
      id: 'rejected', kind: 'foundation.card', version: 1, order_key: 'a',
      geometry: { x: 0, y: 0, width: 10, height: 10, rotation: 0 }, style: {}, metadata: {}, payload: {},
    }, [{ name: 'one-too-many', color: '#654321', type: 'agent' }])).rejects.toThrow('Overlay mutation exceeds collaboration limits');
    expect((await manager.readMcpOverlayScene('abc123de', 'main')).objects).toEqual([]);
    expect(state.doc.getMap('presence').has('one-too-many')).toBe(false);
  });

  it('fails closed for a newer MCP scene and honors browser overlay locks', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const scene = state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!;
    scene.set('version', 2);
    const newer = await manager.readMcpOverlayScene('abc123de', 'main');
    expect(newer).toMatchObject({ version: 2, writable: false, objects: [], opaque_objects: [] });
    await expect(manager.createMcpOverlayObject('abc123de', 'main', newer.overlay_revision, {
      id: 'blocked', kind: 'foundation.card', version: 1, order_key: 'a',
      geometry: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, style: {}, metadata: {}, payload: {},
    })).rejects.toThrow('read-only through MCP');

    scene.set('version', 1);
    const layers = scene.get('layers') as Y.Map<Y.Map<unknown>>;
    layers.get('default')!.set('locked', true);
    const locked = await manager.readMcpOverlayScene('abc123de', 'main');
    await expect(manager.createMcpOverlayObject('abc123de', 'main', locked.overlay_revision, {
      id: 'blocked', kind: 'foundation.card', version: 1, order_key: 'a',
      geometry: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, style: {}, metadata: {}, payload: {},
    })).rejects.toThrow('Overlay layer is locked');
  });

  it('does not resurrect an overlay scene when its diagram is deleted during restore history lookup', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const initial = await manager.getSession('abc123de');
    const extra = await manager.createDiagram('abc123de', 'Race', '', initial.revision, activity('created'));
    state.doc.transact(() => setOverlayObject(state.doc, extra.id, 'note', 'saved'));
    await manager.persistSession(state);
    const current = await manager.readOverlayScene('abc123de', extra.id);
    const target = (await manager.listOverlayHistory('abc123de', extra.id)).revisions.at(-1)!;
    const originalGet = resources.store.getOverlayRevision.bind(resources.store);
    const readStarted = deferred();
    const continueRead = deferred();
    let pauseOnce = true;
    resources.store.getOverlayRevision = async (...args) => {
      if (pauseOnce) { pauseOnce = false; readStarted.resolve(); await continueRead.promise; }
      return originalGet(...args);
    };
    const restore = manager.restoreOverlayRevision('abc123de', extra.id, target.revision_id, current.revision, { name: 'Ada', type: 'human' });
    await readStarted.promise;
    await manager.deleteDiagram('abc123de', extra.id, extra.revision, activity('deleted'));
    continueRead.resolve();
    await expect(restore).rejects.toThrow(`Diagram not found: ${extra.id}`);
    expect(state.doc.getMap('overlays').has(extra.id)).toBe(false);
    expect(await resources.store.listOverlayHistory('abc123de', extra.id)).toEqual([]);
  });

  it('rejects oversized overlay restore actor names before reading or changing history', async () => {
    await manager.getOrCreateSession('abc123de');
    const current = await manager.readOverlayScene('abc123de', 'main');
    const target = (await manager.listOverlayHistory('abc123de', 'main')).revisions[0]!;
    const before = await resources.store.listOverlayHistory('abc123de', 'main');
    await expect(manager.restoreOverlayRevision('abc123de', 'main', target.revision_id, current.revision, { name: 'x'.repeat(257), type: 'human' }))
      .rejects.toThrow('identifier budget');
    expect(await resources.store.listOverlayHistory('abc123de', 'main')).toEqual(before);
  });

  it('versions and restores overlay scenes independently from Mermaid source', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const sessionRevisionBefore = (await manager.getSession('abc123de')).revision;
    const sourceBefore = (await manager.readDiagram('abc123de', 'main')).diagram;
    const baseline = await manager.readOverlayScene('abc123de', 'main');
    expect(baseline.scene.objects).toEqual([]);

    state.doc.transact(() => setOverlayObject(state.doc, 'main', 'note-a', 'first'));
    await manager.persistSession(state);
    const changed = await manager.readOverlayScene('abc123de', 'main');
    expect(changed.revision).not.toBe(baseline.revision);
    expect((await manager.getSession('abc123de')).revision).toBe(sessionRevisionBefore);
    expect((await manager.readDiagram('abc123de', 'main')).diagram.revision).toBe(sourceBefore.revision);

    const written = await manager.writeDiagram('abc123de', 'main', 'flowchart LR\n  A-->B', sourceBefore.revision, activity('edited'));
    const sourceHistory = await manager.listDiagramHistory('abc123de', 'main');
    const sourceBaseline = sourceHistory.revisions.at(-1)!;
    await manager.restoreDiagramRevision('abc123de', 'main', sourceBaseline.revision_id, written.revision, activity('restored'));
    expect(await manager.readOverlayScene('abc123de', 'main')).toEqual(changed);
    const history = await manager.listOverlayHistory('abc123de', 'main');
    expect(history.revisions.map(({ action }) => action)).toEqual(['checkpoint', 'baseline']);

    const result = await manager.restoreOverlayRevision(
      'abc123de',
      'main',
      history.revisions.at(-1)!.revision_id,
      changed.revision,
      { name: 'Ada', type: 'human' },
    );
    expect(result).toMatchObject({ status: 'restored', scene: { objects: [] }, revision: { action: 'restored' } });
    expect((await manager.readDiagram('abc123de', 'main')).diagram).toEqual(sourceBefore);
    await expect(manager.restoreOverlayRevision('abc123de', 'main', history.revisions[0]!.revision_id, changed.revision, { name: 'Ada', type: 'human' }))
      .resolves.toMatchObject({ status: 'stale' });
  });

  it('snapshots and restores annotation Y.Text bodies without changing Mermaid source', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const sourceBefore = (await manager.readDiagram('abc123de', 'main')).diagram;
    state.doc.transact(() => setOverlayObject(state.doc, 'main', 'annotation', 'first body', 'annotation.sticky'));
    await manager.persistSession(state);
    const first = await manager.readOverlayScene('abc123de', 'main');
    expect(first.scene.objects[0]).toMatchObject({ kind: 'annotation.sticky', body: 'first body' });
    const raw = ((state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('annotation')!.get('body')) as Y.Text;
    raw.insert(raw.length, ' changed');
    await manager.persistSession(state);
    const current = await manager.readOverlayScene('abc123de', 'main');
    const target = (await manager.listOverlayHistory('abc123de', 'main')).revisions.find(({ result_revision }) => result_revision === first.revision)!;
    await expect(manager.restoreOverlayRevision('abc123de', 'main', target.revision_id, current.revision, { name: 'Ada', type: 'human' }))
      .resolves.toMatchObject({ status: 'restored', scene: { objects: [{ body: 'first body' }] } });
    const restoredBody = ((state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!.get('objects') as Y.Map<Y.Map<unknown>>).get('annotation')!.get('body')) as Y.Text;
    expect(restoredBody.toString()).toBe('first body');
    expect((await manager.readDiagram('abc123de', 'main')).diagram).toEqual(sourceBefore);
    await manager.close(); manager = resources.createManager();
    await expect(manager.readOverlayScene('abc123de', 'main')).resolves.toMatchObject({ scene: { objects: [{ body: 'first body' }] } });
  });

  it('persists, histories, restores, and reloads shapes, connectors, frames, and named layers without touching Mermaid', async () => {
    const state = await manager.getOrCreateSession('abc123de'); const sourceBefore = (await manager.readDiagram('abc123de', 'main')).diagram;
    const scene = state.doc.getMap<Y.Map<unknown>>('overlays').get('main')!; const objects = scene.get('objects') as Y.Map<Y.Map<unknown>>;
    const add = (id: string, kind: string, payload: Record<string, unknown>, body?: string) => { const item = new Y.Map<unknown>(); item.set('kind', kind); item.set('version', 1); item.set('order_key', id); item.set('layer', 'facilitation'); item.set('geometry', { x: id === 'right' ? 120 : 0, y: 0, width: 100, height: 60, rotation: 0 }); item.set('style', {}); item.set('metadata', { export: 'composite-export' }); item.set('payload', payload); if (body !== undefined) item.set('body', new Y.Text(body)); objects.set(id, item); };
    const layers = new Y.Map<Y.Map<unknown>>(); const layer = new Y.Map<unknown>(); layer.set('id', 'facilitation'); layer.set('name', 'Facilitation'); layer.set('order_key', 'a'); layer.set('visible', true); layer.set('locked', false); layer.set('export', true); layers.set('facilitation', layer); scene.set('layers', layers);
    add('left', 'shape.rectangle', { shape: 'rectangle' }, 'Left'); add('right', 'shape.ellipse', { shape: 'ellipse' }, 'Right'); add('edge', 'connector.overlay', { start_id: 'left', end_id: 'right', start_fallback: { x: 50, y: 30 }, end_fallback: { x: 170, y: 30 } }); add('frame', 'frame.section', { members: ['left', 'right', 'edge'] });
    await manager.persistSession(state); const first = await manager.readOverlayScene('abc123de', 'main');
    expect(first.scene.layers?.some((entry) => entry.id === 'facilitation' && entry.name === 'Facilitation')).toBe(true);
    expect(first.scene.objects).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'shape.rectangle', body: 'Left' }), expect.objectContaining({ kind: 'connector.overlay' }), expect.objectContaining({ kind: 'frame.section' })]));
    (objects.get('left')!.get('body') as Y.Text).insert(4, ' changed'); await manager.persistSession(state); const current = await manager.readOverlayScene('abc123de', 'main');
    const history = await manager.listOverlayHistory('abc123de', 'main'); const target = history.revisions.find(({ result_revision }) => result_revision === first.revision)!;
    const restored = await manager.restoreOverlayRevision('abc123de', 'main', target.revision_id, current.revision, { name: 'Ada', type: 'human' });
    expect(restored).toMatchObject({ status: 'restored', scene: { objects: expect.arrayContaining([expect.objectContaining({ kind: 'shape.rectangle', body: 'Left' })]) } });
    if (restored.status === 'restored') expect(restored.scene.layers?.some(({ id }) => id === 'facilitation')).toBe(true);
    expect((await manager.readDiagram('abc123de', 'main')).diagram).toEqual(sourceBefore);
    await manager.close(); manager = resources.createManager();
    const reloaded = await manager.readOverlayScene('abc123de', 'main');
    expect(reloaded.scene.layers?.some(({ id }) => id === 'facilitation')).toBe(true);
    expect(reloaded.scene.objects).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'connector.overlay' }), expect.objectContaining({ kind: 'frame.section' })]));
  });

  it('atomically erases a deleted diagram overlay scene and its private overlay history', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const initial = await manager.getSession('abc123de');
    const extra = await manager.createDiagram('abc123de', 'Extra', '', initial.revision, activity('created'));
    state.doc.transact(() => setOverlayObject(state.doc, extra.id, 'note', 'erase me'));
    await manager.persistSession(state);
    expect(await resources.store.listOverlayHistory('abc123de', extra.id)).toHaveLength(2);
    await manager.deleteDiagram('abc123de', extra.id, extra.revision, activity('deleted'));
    expect(state.doc.getMap('overlays').has(extra.id)).toBe(false);
    expect(await resources.store.listOverlayHistory('abc123de', extra.id)).toEqual([]);
    expect((await resources.store.listOverlayHistoryMetadata('abc123de')).some(({ diagramId }) => diagramId === extra.id)).toBe(false);
  });

  it('repairs combined malformed structure, order, and duplicate names before snapshot and reload', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const browser = new Y.Doc();
    Y.applyUpdate(browser, Y.encodeStateAsUpdate(state.doc));
    browser.transact(() => {
      const diagrams = browser.getMap<Y.Map<unknown>>('diagrams');
      const main = diagrams.get('main')!;
      main.set('name', ' Duplicate ');
      main.set('mermaid', 'sequenceDiagram\n  Browser->>API: request');
      main.set('nodePositions', ['not', 'a', 'map']);
      diagrams.set('invalid', 'not-a-diagram' as unknown as Y.Map<unknown>);
      const concurrent = new Y.Map<unknown>();
      concurrent.set('name', 'duplicate');
      concurrent.set('mermaid', new Y.Text('flowchart LR\n  Browser-->Gateway'));
      concurrent.set('nodePositions', new Y.Map());
      diagrams.set('concurrent', concurrent);
      browser.getArray<string>('diagramOrder').push(['invalid', 'concurrent', 'main', 'concurrent']);
    });

    Y.applyUpdate(state.doc, Y.encodeStateAsUpdate(browser, Y.encodeStateVector(state.doc)));

    const live = await manager.getSession('abc123de');
    expect(live.diagrams.map((diagram) => diagram.id)).toEqual(['main', 'concurrent']);
    expect(new Set(live.diagrams.map((diagram) => diagram.name.toLocaleLowerCase())).size).toBe(2);
    await expect(manager.readDiagram('abc123de', 'main')).resolves.toMatchObject({
      diagram: { name: 'Duplicate (main)', mermaid_text: 'sequenceDiagram\n  Browser->>API: request' },
    });
    await expect(manager.readDiagram('abc123de', 'concurrent')).resolves.toMatchObject({
      diagram: { name: 'duplicate', mermaid_text: 'flowchart LR\n  Browser-->Gateway' },
    });

    await manager.persistSession(state);
    await manager.close();
    manager = resources.createManager();
    await expect(manager.getSession('abc123de')).resolves.toMatchObject({
      diagrams: [
        { id: 'main', name: 'Duplicate (main)' },
        { id: 'concurrent', name: 'duplicate' },
      ],
    });
  });

  it('does not reseed a malformed main entry when a valid concurrent tab remains', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const browser = new Y.Doc();
    Y.applyUpdate(browser, Y.encodeStateAsUpdate(state.doc));
    browser.transact(() => {
      const diagrams = browser.getMap<Y.Map<unknown>>('diagrams');
      diagrams.set('main', 'malformed-main' as unknown as Y.Map<unknown>);
      const concurrent = new Y.Map<unknown>();
      concurrent.set('name', 'Concurrent');
      concurrent.set('mermaid', new Y.Text('sequenceDiagram\n  Browser->>API: request'));
      concurrent.set('nodePositions', new Y.Map());
      diagrams.set('concurrent', concurrent);
      const order = browser.getArray<string>('diagramOrder');
      order.delete(0, order.length);
      order.insert(0, ['main', 'concurrent']);
    });

    Y.applyUpdate(state.doc, Y.encodeStateAsUpdate(browser, Y.encodeStateVector(state.doc)));

    await expect(manager.getSession('abc123de')).resolves.toMatchObject({
      diagrams: [{ id: 'concurrent', name: 'Concurrent' }],
    });
  });

  it('canonicalizes raw duplicate and orphan order entries without dropping live diagrams', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const initial = await manager.getSession('abc123de');
    const first = await manager.createDiagram('abc123de', 'First', '', initial.revision, activity('created'));
    const afterFirst = await manager.getSession('abc123de');
    const second = await manager.createDiagram('abc123de', 'Second', '', afterFirst.revision, activity('created'));
    const browser = new Y.Doc();
    Y.applyUpdate(browser, Y.encodeStateAsUpdate(state.doc));
    browser.transact(() => {
      const order = browser.getArray<string>('diagramOrder');
      order.delete(0, order.length);
      order.insert(0, [second.id, 'orphan', second.id]);
    });

    Y.applyUpdate(state.doc, Y.encodeStateAsUpdate(browser, Y.encodeStateVector(state.doc)));

    const ids = (await manager.getSession('abc123de')).diagrams.map((diagram) => diagram.id);
    expect(ids).toEqual([second.id, ...['main', first.id].sort((left, right) => left.localeCompare(right))]);
  });

  it('preserves a concurrent raw creation while repairing a raw last-tab deletion', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const deletion = new Y.Doc();
    const creation = new Y.Doc();
    const baseline = Y.encodeStateAsUpdate(state.doc);
    Y.applyUpdate(deletion, baseline);
    Y.applyUpdate(creation, baseline);

    deletion.transact(() => {
      deletion.getMap('diagrams').delete('main');
      const order = deletion.getArray<string>('diagramOrder');
      order.delete(0, order.length);
    });
    creation.transact(() => {
      const diagram = new Y.Map<unknown>();
      diagram.set('name', 'Concurrent');
      diagram.set('mermaid', new Y.Text('sequenceDiagram\n  Browser->>API: request'));
      diagram.set('nodePositions', new Y.Map());
      creation.getMap<Y.Map<unknown>>('diagrams').set('concurrent', diagram);
      creation.getArray<string>('diagramOrder').push(['concurrent']);
    });

    Y.applyUpdate(state.doc, Y.encodeStateAsUpdate(deletion, Y.encodeStateVector(state.doc)));
    Y.applyUpdate(state.doc, Y.encodeStateAsUpdate(creation, Y.encodeStateVector(state.doc)));

    const diagrams = (await manager.getSession('abc123de')).diagrams;
    expect(diagrams).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'main', name: 'Main' }),
      expect.objectContaining({ id: 'concurrent', name: 'Concurrent' }),
    ]));
  });

  it('preserves browser and MCP activity appended from concurrent document states', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const browser = new Y.Doc();
    Y.applyUpdate(browser, Y.encodeStateAsUpdate(state.doc));
    const browserEvent = createActivityEvent({ action: 'edited', actorName: 'browser', actorType: 'human' });
    browser.getArray('activity').push([browserEvent]);

    const current = await manager.readDiagram('abc123de', 'main');
    await manager.writeDiagram('abc123de', 'main', 'flowchart LR\n  A-->B', current.diagram.revision, activity('replaced'));
    Y.applyUpdate(state.doc, Y.encodeStateAsUpdate(browser, Y.encodeStateVector(state.doc)));

    const activityIds = (await manager.readSession('abc123de'))?.activity.map((event) => event.id) ?? [];
    expect(activityIds).toContain(browserEvent.id);
    expect(activityIds).toHaveLength(2);
    expect(new Set(activityIds).size).toBe(activityIds.length);
  });

  it('creates idempotent browser checkpoints with normalized source and finite sorted layout only', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const diagram = state.doc.getMap<Y.Map<unknown>>('diagrams').get('main')!;
    const source = diagram.get('mermaid') as Y.Text;
    const positions = diagram.get('nodePositions') as Y.Map<unknown>;
    const marker = { ...activity('edited'), diagram_id: 'main' };

    state.doc.transact(() => {
      source.insert(source.length, 'flowchart LR\n  Browser-->API');
      positions.set('z', { x: 30, y: 40 });
      positions.set('a', { x: 10, y: 20 });
      positions.set('discard', { x: Number.POSITIVE_INFINITY, y: 10 });
      state.doc.getArray('activity').push([marker]);
    });
    await manager.persistSession(state);
    await manager.persistSession(state);

    const history = await manager.listDiagramHistory('abc123de', 'main');
    expect(history.revisions).toHaveLength(2);
    const captured = await manager.readDiagramRevision('abc123de', 'main', history.revisions[0]!.revision_id);
    expect(captured).toMatchObject({ action: 'edited', activity_id: marker.id, mermaid_text: 'flowchart LR\n  Browser-->API' });
    expect(Object.keys(captured.node_positions)).toEqual(['a', 'z']);
    expect(captured.node_positions).toEqual({ a: { x: 10, y: 20 }, z: { x: 30, y: 40 } });

    await manager.close();
    manager = resources.createManager();
    await expect(manager.listDiagramHistory('abc123de', 'main')).resolves.toMatchObject({
      revisions: [
        { action: 'edited', activity_id: marker.id },
        { action: 'baseline', origin: 'system' },
      ],
    });
  });

  it('restores an immutable source and layout without renaming, while layout-only changes reject stale restore', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const initial = await manager.readDiagram('abc123de', 'main');
    await manager.writeDiagram('abc123de', 'main', 'flowchart LR\n  Browser-->API', initial.diagram.revision, activity('replaced'));
    const diagram = state.doc.getMap<Y.Map<unknown>>('diagrams').get('main')!;
    const positions = diagram.get('nodePositions') as Y.Map<unknown>;
    const marker = { ...activity('edited'), diagram_id: 'main' };
    state.doc.transact(() => {
      positions.set('Browser', { x: 12, y: 24 });
      state.doc.getArray('activity').push([marker]);
    });
    await manager.persistSession(state);
    const target = (await manager.listDiagramHistory('abc123de', 'main')).revisions.find((revision) => revision.activity_id === marker.id)!;

    const beforeReplacement = await manager.readDiagram('abc123de', 'main');
    await manager.writeDiagram('abc123de', 'main', 'sequenceDiagram\n  Browser->>API: changed', beforeReplacement.diagram.revision, activity('replaced'));
    const beforeRename = await manager.readDiagram('abc123de', 'main');
    await manager.renameDiagram('abc123de', 'main', 'Current diagram name', beforeRename.diagram.revision, activity('renamed'));
    const head = await manager.readDiagram('abc123de', 'main');

    const restored = await manager.restoreDiagramRevision('abc123de', 'main', target.revision_id, head.diagram.revision, activity('restored'));
    expect(restored).toMatchObject({
      status: 'restored',
      diagram: { name: 'Current diagram name', mermaid_text: 'flowchart LR\n  Browser-->API' },
      revision: { restored_from_revision_id: target.revision_id },
    });
    expect([...positions.entries()]).toEqual([['Browser', { x: 12, y: 24 }]]);

    const current = await manager.readDiagram('abc123de', 'main');
    const historyBeforeStale = await manager.listDiagramHistory('abc123de', 'main');
    const activityBeforeStale = (await manager.readSession('abc123de'))!.activity.length;
    positions.set('Peer', { x: 36, y: 48 });
    const stale = await manager.restoreDiagramRevision('abc123de', 'main', target.revision_id, current.diagram.revision, activity('restored'));
    expect(stale).toMatchObject({ status: 'stale', current_revision: expect.any(String) });
    expect([...positions.entries()]).toEqual([
      ['Browser', { x: 12, y: 24 }],
      ['Peer', { x: 36, y: 48 }],
    ]);
    expect((await manager.listDiagramHistory('abc123de', 'main')).revisions).toHaveLength(historyBeforeStale.revisions.length);
    expect((await manager.readSession('abc123de'))!.activity).toHaveLength(activityBeforeStale);
  });

  it('treats a revision that changes while restore reads its target as stale without writing', async () => {
    await manager.getOrCreateSession('abc123de');
    const initial = await manager.readDiagram('abc123de', 'main');
    const targetEvent = activity('replaced');
    await manager.writeDiagram('abc123de', 'main', 'flowchart LR\n  Saved-->Target', initial.diagram.revision, targetEvent);
    const target = (await manager.listDiagramHistory('abc123de', 'main')).revisions.find((revision) => revision.activity_id === targetEvent.id)!;
    const head = await manager.readDiagram('abc123de', 'main');
    await manager.writeDiagram('abc123de', 'main', 'flowchart LR\n  Head-->BeforeRestore', head.diagram.revision, activity('replaced'));
    const expected = await manager.readDiagram('abc123de', 'main');

    const originalGetRevision = resources.store.getDiagramRevision.bind(resources.store);
    const targetReadStarted = deferred();
    const continueTargetRead = deferred();
    let pauseOnce = true;
    resources.store.getDiagramRevision = async (...args) => {
      if (pauseOnce) {
        pauseOnce = false;
        targetReadStarted.resolve();
        await continueTargetRead.promise;
      }
      return originalGetRevision(...args);
    };

    const restore = manager.restoreDiagramRevision('abc123de', 'main', target.revision_id, expected.diagram.revision, activity('restored'));
    await targetReadStarted.promise;
    await manager.writeDiagram('abc123de', 'main', 'flowchart LR\n  Peer-->Wins', expected.diagram.revision, activity('replaced'));
    continueTargetRead.resolve();

    await expect(restore).resolves.toMatchObject({
      status: 'stale',
      current: { mermaid_text: 'flowchart LR\n  Peer-->Wins' },
    });
    await expect(manager.readDiagram('abc123de', 'main')).resolves.toMatchObject({
      diagram: { mermaid_text: 'flowchart LR\n  Peer-->Wins' },
    });
    expect((await manager.readSession('abc123de'))!.activity.some((event) => event.action === 'restored')).toBe(false);
  });

  it('serializes overlapping persistence so checkpoint sequences and session snapshots never roll back', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const diagram = state.doc.getMap<Y.Map<unknown>>('diagrams').get('main')!;
    const source = diagram.get('mermaid') as Y.Text;
    const firstEvent = { ...activity('edited'), diagram_id: 'main' };
    const secondEvent = { ...activity('edited'), diagram_id: 'main' };
    const originalPersist = resources.store.persistWithHistory.bind(resources.store);
    const firstBatchStarted = deferred();
    const continueFirstBatch = deferred();
    let pauseOnce = true;
    resources.store.persistWithHistory = async (record, history, options) => {
      if (pauseOnce) {
        pauseOnce = false;
        firstBatchStarted.resolve();
        await continueFirstBatch.promise;
      }
      return originalPersist(record, history, options);
    };

    state.doc.transact(() => {
      source.delete(0, source.length);
      source.insert(0, 'flowchart LR\n  First-->Checkpoint');
      state.doc.getArray<ActivityEvent>('activity').push([firstEvent]);
    });
    const firstPersist = manager.persistSession(state);

    state.doc.transact(() => {
      source.delete(0, source.length);
      source.insert(0, 'flowchart LR\n  Second-->Checkpoint');
      state.doc.getArray<ActivityEvent>('activity').push([secondEvent]);
    });
    const secondPersist = manager.persistSession(state);
    await firstBatchStarted.promise;
    continueFirstBatch.resolve();
    await Promise.all([firstPersist, secondPersist]);

    const history = await manager.listDiagramHistory('abc123de', 'main');
    expect(history.revisions.map((revision) => revision.sequence)).toEqual([2, 1, 0]);
    expect(new Set(history.revisions.map((revision) => revision.revision_id)).size).toBe(3);
    const firstCheckpoint = await manager.readDiagramRevision('abc123de', 'main', history.revisions.find((revision) => revision.activity_id === firstEvent.id)!.revision_id);
    const secondCheckpoint = await manager.readDiagramRevision('abc123de', 'main', history.revisions.find((revision) => revision.activity_id === secondEvent.id)!.revision_id);
    expect(firstCheckpoint.mermaid_text).toBe('flowchart LR\n  First-->Checkpoint');
    expect(secondCheckpoint.mermaid_text).toBe('flowchart LR\n  Second-->Checkpoint');
    await expect(manager.readDiagram('abc123de', 'main')).resolves.toMatchObject({
      diagram: { mermaid_text: 'flowchart LR\n  Second-->Checkpoint' },
    });
  });

  it('captures each rapid browser checkpoint before its queued persistence turn', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const diagram = state.doc.getMap<Y.Map<unknown>>('diagrams').get('main')!;
    const source = diagram.get('mermaid') as Y.Text;
    const positions = diagram.get('nodePositions') as Y.Map<unknown>;
    const firstEvent = { ...activity('edited'), diagram_id: 'main' };
    const secondEvent = { ...activity('edited'), diagram_id: 'main' };
    const thirdEvent = { ...activity('edited'), diagram_id: 'main' };
    const originalListMetadata = resources.store.listSessionHistoryMetadata.bind(resources.store);
    const firstMetadataReadStarted = deferred();
    const continueFirstMetadataRead = deferred();
    let pauseOnce = true;
    resources.store.listSessionHistoryMetadata = async (...args) => {
      if (pauseOnce) {
        pauseOnce = false;
        firstMetadataReadStarted.resolve();
        await continueFirstMetadataRead.promise;
      }
      return originalListMetadata(...args);
    };

    const applyBrowserCheckpoint = (sourceText: string, position: { x: number; y: number }, event: ActivityEvent) => {
      state.doc.transact(() => {
        source.delete(0, source.length);
        source.insert(0, sourceText);
        positions.set('Browser', position);
        state.doc.getArray<ActivityEvent>('activity').push([event]);
      });
    };

    applyBrowserCheckpoint('flowchart LR\n  First-->Checkpoint', { x: 10, y: 20 }, firstEvent);
    const firstPersist = manager.persistSession(state);
    await firstMetadataReadStarted.promise;

    applyBrowserCheckpoint('flowchart LR\n  Second-->Checkpoint', { x: 30, y: 40 }, secondEvent);
    const secondPersist = manager.persistSession(state);
    applyBrowserCheckpoint('flowchart LR\n  Third-->Checkpoint', { x: 50, y: 60 }, thirdEvent);
    const thirdPersist = manager.persistSession(state);
    continueFirstMetadataRead.resolve();
    await Promise.all([firstPersist, secondPersist, thirdPersist]);

    const history = await manager.listDiagramHistory('abc123de', 'main');
    expect(history.revisions.map((revision) => revision.sequence)).toEqual([3, 2, 1, 0]);
    await expect(manager.readDiagramRevision('abc123de', 'main', history.revisions.find((revision) => revision.activity_id === firstEvent.id)!.revision_id)).resolves.toMatchObject({
      mermaid_text: 'flowchart LR\n  First-->Checkpoint', node_positions: { Browser: { x: 10, y: 20 } },
    });
    await expect(manager.readDiagramRevision('abc123de', 'main', history.revisions.find((revision) => revision.activity_id === secondEvent.id)!.revision_id)).resolves.toMatchObject({
      mermaid_text: 'flowchart LR\n  Second-->Checkpoint', node_positions: { Browser: { x: 30, y: 40 } },
    });
    await expect(manager.readDiagramRevision('abc123de', 'main', history.revisions.find((revision) => revision.activity_id === thirdEvent.id)!.revision_id)).resolves.toMatchObject({
      mermaid_text: 'flowchart LR\n  Third-->Checkpoint', node_positions: { Browser: { x: 50, y: 60 } },
    });

    const persisted = await resources.store.get('abc123de');
    const persistedDoc = new Y.Doc();
    Y.applyUpdate(persistedDoc, Buffer.from(persisted!.encodedState, 'base64'));
    expect((persistedDoc.getMap<Y.Map<unknown>>('diagrams').get('main')!.get('mermaid') as Y.Text).toString()).toBe('flowchart LR\n  Third-->Checkpoint');
    expect((persistedDoc.getMap<Y.Map<unknown>>('diagrams').get('main')!.get('nodePositions') as Y.Map<unknown>).get('Browser')).toEqual({ x: 50, y: 60 });
    persistedDoc.destroy();
  });

  it('removes a deleted diagram history and metadata in the same persistence batch', async () => {
    await manager.getOrCreateSession('abc123de');
    const initial = await manager.getSession('abc123de');
    const api = await manager.createDiagram('abc123de', 'API flow', 'sequenceDiagram\n  Browser->>API: request', initial.revision, activity('created'));
    expect((await manager.listDiagramHistory('abc123de', api.id)).revisions).not.toHaveLength(0);
    const originalPersist = resources.store.persistWithHistory.bind(resources.store);
    let deletionBatch: Parameters<SessionStore['persistWithHistory']>[1] | undefined;
    resources.store.persistWithHistory = async (record, history, options) => {
      if (history.deleteDiagramHistory.some((target) => target.diagramId === api.id)) {
        deletionBatch = history;
      }
      return originalPersist(record, history, options);
    };

    await manager.deleteDiagram('abc123de', api.id, api.revision, activity('deleted'));

    expect(deletionBatch?.deleteDiagramHistory).toEqual([{ sessionId: 'abc123de', diagramId: api.id }]);
    await expect(resources.store.listDiagramHistory('abc123de', api.id)).resolves.toEqual([]);
    await expect(resources.store.getHistoryMetadata('abc123de', api.id)).resolves.toBeNull();
    await expect(manager.listDiagramHistory('abc123de', api.id)).rejects.toThrow(`Diagram not found: ${api.id}`);
  });

  it('retains one baseline and the latest ninety-nine checkpoints per diagram', async () => {
    const state = await manager.getOrCreateSession('abc123de');
    const diagram = state.doc.getMap<Y.Map<unknown>>('diagrams').get('main')!;
    const source = diagram.get('mermaid') as Y.Text;
    const activityArray = state.doc.getArray<ActivityEvent>('activity');
    const originalPersist = resources.store.persistWithHistory.bind(resources.store);
    const pruningBatches: number[][] = [];
    resources.store.persistWithHistory = async (record, history, options) => {
      if (history.deleteSequences.length > 0) {
        pruningBatches.push(history.deleteSequences.map((target) => target.sequence));
      }
      return originalPersist(record, history, options);
    };

    for (let index = 1; index <= 105; index += 1) {
      state.doc.transact(() => {
        source.delete(0, source.length);
        source.insert(0, `timeline\n  now : ${index}`);
        activityArray.push([{ ...activity('edited'), id: `checkpoint-${index}`, diagram_id: 'main' }]);
      });
      await manager.persistSession(state);
    }

    const history = await manager.listDiagramHistory('abc123de', 'main');
    expect(history.revisions).toHaveLength(100);
    expect(history.revisions.at(-1)).toMatchObject({ sequence: 0, action: 'baseline' });
    expect(history.revisions.at(-2)).toMatchObject({ sequence: 7 });
    expect(history.revisions[0]).toMatchObject({ sequence: 105 });
    expect(pruningBatches).toEqual([[1], [2], [3], [4], [5], [6]]);
    await expect(resources.store.getHistoryMetadata('abc123de', 'main')).resolves.toMatchObject({
      firstRetainedMutationSequence: 7,
      nextSequence: 106,
    });
  });
});
