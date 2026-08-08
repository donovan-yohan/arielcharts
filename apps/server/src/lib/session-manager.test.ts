import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createActivityEvent } from './activity.js';
import { SessionStore } from './persistence.js';
import { SessionManager } from './session-manager.js';

async function createResources() {
  const dataDir = await mkdtemp(join(tmpdir(), 'arielcharts-cleanup-'));
  return { dataDir, createManager: () => new SessionManager(new SessionStore(dataDir)), async cleanup() { await rm(dataDir, { recursive: true, force: true }); } };
}

function activity(action: 'created' | 'replaced' | 'renamed' | 'deleted') {
  return createActivityEvent({ action, actorName: 'agent', actorType: 'agent' });
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
});
