// @vitest-environment happy-dom

import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { addOverlayObject, getOverlayScene, readOverlayScene } from './overlay-scene';
import { type OverlaySceneController, useOverlayScene } from './use-overlay-scene';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function object(id: string) {
  return {
    id,
    kind: 'foundation.card',
    version: 1,
    order_key: 'a',
    geometry: { x: 10, y: 20, width: 30, height: 40, rotation: 0 },
    style: {}, metadata: {}, payload: { text: id },
  };
}

function ControllerProbe({ doc, onController }: { doc: Y.Doc; onController: (controller: OverlaySceneController | null) => void }) {
  const controller = useOverlayScene(doc, 'main');
  useEffect(() => onController(controller), [controller, onController]);
  return null;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('useOverlayScene', () => {
  it('rebinds undo to an authoritative scene replacement and disposes the detached manager', async () => {
    const doc = new Y.Doc();
    addOverlayObject(doc, 'main', object('old'));
    const oldHandle = getOverlayScene(doc, 'main')!;
    const destroy = vi.spyOn(Y.UndoManager.prototype, 'destroy');
    const host = document.createElement('div');
    document.body.append(host);
    const root = createRoot(host);
    let controller: OverlaySceneController | null = null;
    const onController = (next: OverlaySceneController | null) => {
      controller = next;
    };
    await act(async () => root.render(<ControllerProbe doc={doc} onController={onController} />));
    expect(controller?.scene.objects.map(({ id }) => id)).toEqual(['old']);

    await act(async () => {
      doc.transact(() => doc.getMap('overlays').delete('main'), 'authoritative-import');
      getOverlayScene(doc, 'main', true);
      addOverlayObject(doc, 'main', object('imported'));
    });
    expect(controller?.scene.objects.map(({ id }) => id)).toEqual(['imported']);
    expect(destroy).toHaveBeenCalledTimes(1);

    await act(async () => controller?.update('imported', { geometry: { x: 88, y: 20, width: 30, height: 40, rotation: 0 } }));
    expect(readOverlayScene(doc, 'main').objects[0]?.geometry.x).toBe(88);
    await act(async () => controller?.undo());
    expect(readOverlayScene(doc, 'main').objects[0]?.geometry.x).toBe(10);

    doc.transact(() => oldHandle.objects.delete('old'), 'detached-old-scene');
    expect(readOverlayScene(doc, 'main').objects.map(({ id }) => id)).toEqual(['imported']);
    await act(async () => root.unmount());
    expect(destroy).toHaveBeenCalledTimes(2);
    doc.destroy();
  });
});
