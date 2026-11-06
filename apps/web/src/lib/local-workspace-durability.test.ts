// @vitest-environment happy-dom
import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { observeLocalWorkspaceDurability } from './local-workspace-durability';
it('does not acknowledge local writes before the IndexedDB transaction commits, and retires old acknowledgements', async () => {
  const transactions: Array<{ oncomplete: null | (() => void); onerror: null | (() => void); onabort: null | (() => void) }> = [];
  const doc = new Y.Doc(); const state = vi.fn();
  const db = { transaction: vi.fn(() => { const bytes = Y.encodeStateAsUpdate(doc); const tx = { oncomplete: null, onerror: null, onabort: null, objectStore: () => ({ getAll: () => ({ result: [bytes] }) }) }; transactions.push(tx); return tx; }) } as unknown as IDBDatabase;
  const stop = observeLocalWorkspaceDurability(doc, { db, whenSynced: Promise.resolve() }, state);
  await Promise.resolve(); expect(state).toHaveBeenLastCalledWith('saving');
  const pendingUnload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(pendingUnload); expect(pendingUnload.defaultPrevented).toBe(true);
  transactions[0]!.oncomplete!(); expect(state).toHaveBeenLastCalledWith('saved');
  const savedUnload = new Event('beforeunload', { cancelable: true }); window.dispatchEvent(savedUnload); expect(savedUnload.defaultPrevented).toBe(false);
  doc.getText('source').insert(0, 'A'); await Promise.resolve();
  doc.getText('source').insert(1, 'B'); await Promise.resolve();
  transactions[1]!.oncomplete!(); expect(state).toHaveBeenLastCalledWith('saving');
  transactions[2]!.oncomplete!(); expect(state).toHaveBeenLastCalledWith('saved');
  doc.getText('source').insert(2, 'C'); await Promise.resolve(); transactions[3]!.onabort!(); expect(state).toHaveBeenLastCalledWith('error');
  stop(); doc.getText('source').insert(3, 'D'); await Promise.resolve(); expect(transactions).toHaveLength(4);
});
