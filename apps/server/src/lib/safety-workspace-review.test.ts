import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { SessionManager } from './session-manager.js';
import { SessionStore } from './persistence.js';
import { createActivityEvent } from './activity.js';
import { canonicalWorkspaceJson } from './workspace-import.js';

it('returns full reviewed content and its replacement revision from the same synchronous server head', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'safety-review-')); const manager = new SessionManager(new SessionStore(dir));
  try {
    const session = await manager.getOrCreateSession('abc123de'); const doc = session.doc;
    const expected = () => canonicalWorkspaceJson({ diagrams: doc.getMap('diagrams').toJSON(), order: doc.getArray('diagramOrder').toArray(), overlays: doc.getMap('overlays').toJSON() });
    const before = await manager.readWorkspaceRevision('abc123de');
    expect(before).toMatchObject({ content: expected() });
    const target = await manager.readDiagram('abc123de', 'main');
    await manager.writeDiagram('abc123de', 'main', 'flowchart LR\nCollaborator-->Unseen', target.diagram.revision, createActivityEvent({ action: 'replaced', actorName: 'Peer', actorType: 'agent' }));
    const after = await manager.readWorkspaceRevision('abc123de');
    expect(after).toMatchObject({ content: expected() }); expect(after.revision).not.toBe(before.revision);
    expect((after as typeof after & { content: string }).content).not.toBe((before as typeof before & { content: string }).content);
  } finally { await manager.close(); await rm(dir, { recursive: true, force: true }); }
});
