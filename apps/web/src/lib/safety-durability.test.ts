// @vitest-environment happy-dom
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { observeLocalWorkspaceDurability } from './local-workspace-durability';

it.skipIf(!process.env.SAFETY_INDEXEDDB_MODULE)('does not acknowledge an aborted real y-indexeddb write and verifies recovery by reopening the same database', async () => {
  const require = createRequire(import.meta.url);
  const fake = require(process.env.SAFETY_INDEXEDDB_MODULE ?? 'fake-indexeddb') as { indexedDB: IDBFactory; IDBKeyRange: typeof IDBKeyRange };
  vi.stubGlobal('indexedDB', fake.indexedDB); vi.stubGlobal('IDBKeyRange', fake.IDBKeyRange);
  const name = `safety-abort-${crypto.randomUUID()}`; const doc = new Y.Doc(); const persistence = new IndexeddbPersistence(name, doc);
  let stop = () => {}; let reopened: IndexeddbPersistence | undefined; let reload: Y.Doc | undefined;
  try {
    await persistence.whenSynced; const states: string[] = [];
    stop = observeLocalWorkspaceDurability(doc, persistence, (state) => states.push(state));
    await vi.waitFor(() => expect(states.at(-1)).toBe('saved'));
    const db = persistence.db!; const original = db.transaction.bind(db); let aborted = false;
    let observedReadComplete = false;
    db.transaction = ((...args: Parameters<IDBDatabase['transaction']>) => {
      const tx = original(...args);
      if (args[1] === 'readwrite' && !aborted) {
        const store = tx.objectStore('updates'); const add = store.add.bind(store);
        store.add = ((...values: Parameters<IDBObjectStore['add']>) => {
          const request = add(...values);
          // The request succeeds, but the actual writer transaction never commits.
          request.addEventListener('success', () => { aborted = true; tx.abort(); }, { once: true });
          return request;
        }) as typeof store.add;
      } else if (args[1] === 'readonly') tx.addEventListener('complete', () => { observedReadComplete = true; });
      return tx;
    }) as typeof db.transaction;
    doc.getText('source').insert(0, 'MUST SURVIVE RELOAD');
    await vi.waitFor(() => { expect(aborted).toBe(true); expect(observedReadComplete).toBe(true); });
    const unload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(unload);
    stop(); await persistence.destroy();
    reload = new Y.Doc(); reopened = new IndexeddbPersistence(name, reload); await reopened.whenSynced;
    expect(reload.getText('source').toString()).toBe('');
    expect(states.at(-1)).toBe('error'); expect(unload.defaultPrevented).toBe(true);
    // A genuine complete checkpoint permits a later saved claim and survives reopen.
    const tx = reopened.db!.transaction('updates', 'readwrite'); tx.objectStore('updates').add(Y.encodeStateAsUpdate(doc));
    await new Promise<void>((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onabort = () => reject(tx.error); });
    stop = observeLocalWorkspaceDurability(doc, reopened, (state) => states.push(state));
    await vi.waitFor(() => expect(states.at(-1)).toBe('saved'));
    const savedUnload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(savedUnload); expect(savedUnload.defaultPrevented).toBe(false);
    await reopened.destroy(); reload.destroy(); reload = new Y.Doc(); reopened = new IndexeddbPersistence(name, reload); await reopened.whenSynced;
    expect(reload.getText('source').toString()).toBe('MUST SURVIVE RELOAD');
  } finally { stop(); await persistence.destroy(); await reopened?.destroy(); doc.destroy(); reload?.destroy(); fake.indexedDB.deleteDatabase(name); vi.unstubAllGlobals(); }
});
