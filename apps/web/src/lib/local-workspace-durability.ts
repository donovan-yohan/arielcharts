import * as Y from 'yjs';

export type LocalWorkspaceSaveState = 'saving' | 'saved' | 'error';
type LocalPersistenceBarrier = { db: IDBDatabase | null; whenSynced: Promise<unknown> };

/** Verify stored insertion and deletion coverage; transaction ordering alone is not a save acknowledgement. */
export function observeLocalWorkspaceDurability(doc: Y.Doc, persistence: LocalPersistenceBarrier, publish: (state: LocalWorkspaceSaveState) => void): () => void {
  let generation = 0;
  let disposed = false;
  let pending = true;
  const beforeUnload = (event: BeforeUnloadEvent) => { if (pending) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  const update = () => {
    const acceptedGeneration = ++generation;
    pending = true; publish('saving');
    void persistence.whenSynced.then(() => {
      if (disposed) return;
      const db = persistence.db;
      if (!db) throw new Error('Local storage is unavailable.');
      const checkpoint = Y.snapshot(doc);
      const transaction = db.transaction('updates', 'readonly');
      const updates = transaction.objectStore('updates').getAll();
      const failed = () => { if (!disposed && generation === acceptedGeneration) publish('error'); };
      transaction.oncomplete = () => {
        if (disposed || generation !== acceptedGeneration) return;
        const stored = new Y.Doc();
        try {
          for (const update of updates.result as Uint8Array[]) Y.applyUpdate(stored, update);
          if (!Y.equalSnapshots(checkpoint, Y.snapshot(stored))) { failed(); return; }
          pending = false; publish('saved');
        } catch { failed(); } finally { stored.destroy(); }
      };
      transaction.onerror = failed; transaction.onabort = failed;
    }).catch(() => { if (!disposed && generation === acceptedGeneration) publish('error'); });
  };
  doc.on('update', update); update();
  return () => { disposed = true; generation += 1; doc.off('update', update); window.removeEventListener('beforeunload', beforeUnload); };
}
