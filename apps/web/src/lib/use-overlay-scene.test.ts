import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { addOverlayObject, readOverlayScene } from './overlay-scene';
import { isPureFrameUnlock, updateOverlayControllerObject } from './use-overlay-scene';

const lockedFrame = {
  id: 'frame', kind: 'frame.section', version: 1, order_key: 'a', layer: 'default',
  geometry: { x: 10, y: 20, width: 200, height: 120, rotation: 0 }, style: {},
  metadata: { export: 'composite-export', locked: true }, payload: { members: ['member'] },
};

describe('locked frame controller updates', () => {
  it('permits only an exact self-unlock metadata transition', () => {
    const scene = { version: 1 as const, diagram_id: 'main', layers: [{ id: 'default', name: 'Default', order_key: 'a', visible: true, locked: false, export: true }], objects: [lockedFrame] };
    expect(isPureFrameUnlock(scene, lockedFrame, { metadata: { export: 'composite-export', locked: false } })).toBe(true);
    expect(isPureFrameUnlock(scene, lockedFrame, { metadata: { export: 'composite-export', locked: false }, geometry: { ...lockedFrame.geometry, x: 99 } })).toBe(false);
    expect(isPureFrameUnlock(scene, lockedFrame, { metadata: { locked: false } })).toBe(false);
  });

  it('rejects an unlock when a layer or containing frame still locks it', () => {
    const patch = { metadata: { export: 'composite-export', locked: false } };
    const lockedLayer = { version: 1 as const, diagram_id: 'main', layers: [{ id: 'default', name: 'Default', order_key: 'a', visible: true, locked: true, export: true }], objects: [lockedFrame] };
    expect(isPureFrameUnlock(lockedLayer, lockedFrame, patch)).toBe(false);
    const containingFrame = { ...lockedFrame, id: 'container', payload: { members: ['frame'] } };
    const contained = { version: 1 as const, diagram_id: 'main', layers: [{ id: 'default', name: 'Default', order_key: 'a', visible: true, locked: false, export: true }], objects: [lockedFrame, containingFrame] };
    expect(isPureFrameUnlock(contained, lockedFrame, patch)).toBe(false);
  });

  it('rejects an inner exact unlock through a cycle-safe locked outer-frame ancestor without a Yjs write', () => {
    const doc = new Y.Doc();
    const outer = { ...lockedFrame, id: 'outer', metadata: { export: 'composite-export', locked: true }, payload: { members: ['middle'] } };
    const middle = { ...lockedFrame, id: 'middle', metadata: { export: 'composite-export', locked: false }, payload: { members: ['inner'] } };
    const inner = { ...lockedFrame, id: 'inner', payload: { members: [] } };
    addOverlayObject(doc, 'main', outer); addOverlayObject(doc, 'main', middle); addOverlayObject(doc, 'main', inner);
    const before = Y.encodeStateAsUpdate(doc);
    expect(updateOverlayControllerObject(doc, 'main', 'inner', { metadata: { export: 'composite-export', locked: false } })).toBe(false);
    expect([...Y.encodeStateAsUpdate(doc)]).toEqual([...before]);
    expect(readOverlayScene(doc, 'main').objects.find(({ id }) => id === 'inner')?.metadata.locked).toBe(true);
  });
});
