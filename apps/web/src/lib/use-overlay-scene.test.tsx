// @vitest-environment happy-dom

import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { CanvasHistoryCoordinator } from './canvas-history';
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

function ControllerProbe({ doc, history, onController, writable = true }: { doc: Y.Doc; history?: Parameters<typeof useOverlayScene>[2]; onController: (controller: OverlaySceneController | null) => void; writable?: boolean }) {
  const controller = (useOverlayScene as unknown as (document: Y.Doc, diagramId: string, canvasHistory: Parameters<typeof useOverlayScene>[2], canWrite: boolean) => OverlaySceneController | null)(doc, 'main', history ?? null, writable);
  useEffect(() => onController(controller), [controller, onController]);
  return null;
}

afterEach(() => {
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('useOverlayScene', () => {
  it('rebinds to an authoritative scene replacement without retaining detached objects', async () => {
    const doc = new Y.Doc();
    addOverlayObject(doc, 'main', object('old'));
    const oldHandle = getOverlayScene(doc, 'main')!;
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

    await act(async () => controller?.update('imported', { geometry: { x: 88, y: 20, width: 30, height: 40, rotation: 0 } }));
    expect(readOverlayScene(doc, 'main').objects[0]?.geometry.x).toBe(88);
    doc.transact(() => oldHandle.objects.delete('old'), 'detached-old-scene');
    expect(readOverlayScene(doc, 'main').objects.map(({ id }) => id)).toEqual(['imported']);
    await act(async () => root.unmount());
    doc.destroy();
  });

  it('rejects duplicate attempts when the controller is bound to a read-only preview', async () => {
    const doc = new Y.Doc();
    addOverlayObject(doc, 'main', object('original'));
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    let controller: OverlaySceneController | null = null;
    await act(async () => root.render(<ControllerProbe doc={doc} onController={(next) => { controller = next; }} writable={false} />));
    await act(async () => expect(controller?.duplicate('original')).toBeNull());
    expect(readOverlayScene(doc, 'main').objects.map(({ id }) => id)).toEqual(['original']);
    await act(async () => root.unmount());
    doc.destroy();
  });

  it('duplicates a multi-selection in one history action', async () => {
    const doc = new Y.Doc();
    addOverlayObject(doc, 'main', object('first'));
    addOverlayObject(doc, 'main', object('second'));
    const history = new CanvasHistoryCoordinator(doc, 'main', doc.getText('source'), doc.getMap('positions'));
    const withAction = vi.spyOn(history, 'withAction');
    const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
    let controller: OverlaySceneController | null = null;
    await act(async () => root.render(<ControllerProbe doc={doc} history={history} onController={(next) => { controller = next; }} />));
    let copied: string[] = [];
    await act(async () => {
      copied = (controller as unknown as { duplicateMany: (ids: readonly string[]) => string[] } | null)?.duplicateMany(['first', 'second']) ?? [];
    });
    expect(copied).toHaveLength(2);
    expect(withAction).toHaveBeenCalledTimes(1);
    expect(readOverlayScene(doc, 'main').objects).toHaveLength(4);
    let undoResult: ReturnType<CanvasHistoryCoordinator['undo']> = 'empty';
    await act(async () => { undoResult = history.undo(); });
    expect(undoResult).toBe('applied');
    expect(readOverlayScene(doc, 'main').objects).toHaveLength(2);
    await act(async () => root.unmount());
    history.destroy();
    doc.destroy();
  });
});
