import { expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { publishLocalWorkspace } from './local-workspace';
import { addOverlayObject, getOverlayScene } from './overlay-scene';

function fixture() {
  const doc = new Y.Doc();
  for (const id of ['main', 'extra']) {
    const diagram = new Y.Map<unknown>();
    diagram.set('name', id); diagram.set('mermaid', new Y.Text('flowchart LR\nA-->B\nB-->C')); diagram.set('nodePositions', new Y.Map());
    doc.getMap('diagrams').set(id, diagram); doc.getArray('diagramOrder').push([id]); getOverlayScene(doc, id, true);
  }
  addOverlayObject(doc, 'main', { id: 'note', kind: 'annotation.sticky', version: 1, order_key: 'a', layer: 'default', geometry: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, style: {}, metadata: {}, payload: {}, body: 'Keep' });
  return doc;
}
const mutations = {
  source: (doc: Y.Doc) => { const text = doc.getMap<Y.Map<unknown>>('diagrams').get('main')!.get('mermaid') as Y.Text; text.delete(text.length - 6, 6); },
  overlay: (doc: Y.Doc) => { const scene = doc.getMap<Y.Map<unknown>>('overlays').get('main')!; (scene.get('objects') as Y.Map<unknown>).delete('note'); },
  tab: (doc: Y.Doc) => { doc.getMap('diagrams').delete('extra'); doc.getArray('diagramOrder').delete(1, 1); doc.getMap('overlays').delete('extra'); },
};
for (const [name, mutate] of Object.entries(mutations)) {
  it(`refuses pure ${name} deletion during publishing without advancing insertion clocks`, async () => {
    const doc = fixture(); let release!: (value: string) => void;
    const createRoom = vi.fn(() => new Promise<string>((resolve) => { release = resolve; }));
    const result = publishLocalWorkspace(doc, createRoom); await vi.waitFor(() => expect(createRoom).toHaveBeenCalledOnce());
    const vector = Y.encodeStateVector(doc); mutate(doc); expect(Y.encodeStateVector(doc)).toEqual(vector); release('room');
    await expect(result).resolves.toEqual({ status: 'changed-during-request' }); doc.destroy();
  });
  it(`refuses pure ${name} deletion while preparing the request`, async () => {
    const doc = fixture(); const createRoom = vi.fn(async () => 'room'); const result = publishLocalWorkspace(doc, createRoom);
    mutate(doc); await expect(result).resolves.toEqual({ status: 'changed-before-request' }); expect(createRoom).not.toHaveBeenCalled(); doc.destroy();
  });
}
it('publishes an unchanged workspace', async () => { const doc = fixture(); await expect(publishLocalWorkspace(doc, async () => 'room')).resolves.toEqual({ status: 'published', room: 'room' }); doc.destroy(); });
