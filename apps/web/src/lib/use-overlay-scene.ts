'use client';

import type { OverlayObjectRecord, OverlaySceneSnapshot } from '@arielcharts/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import {
  addOverlayObject,
  beginOverlayTextComposition,
  commitOverlayTextComposition,
  copyOverlayObjects,
  createOverlayUndoManager,
  deleteOverlayObjects,
  editOverlayText,
  getOverlayScene,
  pasteOverlayObjects,
  readOverlayScene,
  setOverlayOrderKey,
  updateOverlayObject,
  type OverlayTextComposition,
} from './overlay-scene';

export interface OverlaySceneController {
  scene: OverlaySceneSnapshot;
  add: (point: { x: number; y: number }, kind?: 'annotation.text' | 'annotation.sticky') => void;
  move: (id: string, dx: number, dy: number) => void;
  anchor: (id: string, mermaidId: string) => void;
  remove: (ids: readonly string[]) => void;
  reorder: (id: string, direction: 'front' | 'back') => void;
  copy: (ids: readonly string[]) => void;
  paste: () => void;
  undo: () => void;
  update: (id: string, patch: Partial<Omit<OverlayObjectRecord, 'id'>>) => void;
  editText: (id: string, index: number, deleteCount: number, insert: string) => void;
  duplicate: (id: string) => void;
  beginComposition: (id: string) => OverlayTextComposition | null;
  commitComposition: (id: string, composition: OverlayTextComposition, draft: string) => void;
}

export function useOverlayScene(doc: Y.Doc | null, diagramId: string | null): OverlaySceneController | null {
  const [scene, setScene] = useState<OverlaySceneSnapshot | null>(null);
  const [clipboard, setClipboard] = useState<OverlayObjectRecord[]>([]);
  const undoManager = useMemo(() => {
    if (!doc || !diagramId) return null;
    const handle = getOverlayScene(doc, diagramId);
    return handle?.writable ? createOverlayUndoManager(doc, diagramId) : null;
  }, [diagramId, doc]);

  useEffect(() => () => undoManager?.destroy(), [undoManager]);

  useEffect(() => {
    if (!doc || !diagramId) { setScene(null); return; }
    const root = doc.getMap<Y.Map<unknown>>('overlays');
    const sync = () => setScene(readOverlayScene(doc, diagramId));
    sync();
    root.observeDeep(sync);
    return () => root.unobserveDeep(sync);
  }, [diagramId, doc]);

  const add = useCallback((point: { x: number; y: number }, kind: 'annotation.text' | 'annotation.sticky' = 'annotation.text') => {
    if (!doc || !diagramId) return;
    const id = `overlay_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    addOverlayObject(doc, diagramId, {
      id,
      kind,
      version: 1,
      order_key: `${Date.now().toString().padStart(16, '0')}:${doc.clientID}:${id}`,
      geometry: { x: point.x, y: point.y, width: kind === 'annotation.sticky' ? 220 : 200, height: kind === 'annotation.sticky' ? 160 : 72, rotation: 0 },
      style: { color: kind === 'annotation.sticky' ? 'yellow' : 'transparent' },
      metadata: { export: 'arielcharts-only' },
      payload: {}, body: '',
    });
  }, [diagramId, doc]);
  const move = useCallback((id: string, dx: number, dy: number) => {
    if (!doc || !diagramId) return;
    const object = readOverlayScene(doc, diagramId).objects.find((candidate) => candidate.id === id);
    if (object) updateOverlayObject(doc, diagramId, id, {
      geometry: { ...object.geometry, x: object.geometry.x + dx, y: object.geometry.y + dy },
      ...(object.anchor ? { anchor: {
        ...object.anchor,
        offset: { x: object.anchor.offset.x + dx, y: object.anchor.offset.y + dy },
        fallback: { x: object.anchor.fallback.x + dx, y: object.anchor.fallback.y + dy },
      } } : {}),
    });
  }, [diagramId, doc]);
  const anchor = useCallback((id: string, mermaidId: string) => {
    if (!doc || !diagramId) return;
    const object = readOverlayScene(doc, diagramId).objects.find((candidate) => candidate.id === id);
    if (object) updateOverlayObject(doc, diagramId, id, {
      anchor: { mermaid_id: mermaidId, offset: { x: 0, y: 0 }, fallback: { x: object.geometry.x, y: object.geometry.y } },
    });
  }, [diagramId, doc]);
  const remove = useCallback((ids: readonly string[]) => { if (doc && diagramId) deleteOverlayObjects(doc, diagramId, ids); }, [diagramId, doc]);
  const reorder = useCallback((id: string, direction: 'front' | 'back') => {
    if (!doc || !diagramId) return;
    const key = `${direction === 'back' ? '!' : '~'}${Date.now().toString().padStart(16, '0')}:${doc.clientID}:${id}`;
    setOverlayOrderKey(doc, diagramId, id, key);
  }, [diagramId, doc]);
  const copy = useCallback((ids: readonly string[]) => {
    if (scene) setClipboard(copyOverlayObjects(scene, ids));
  }, [scene]);
  const paste = useCallback(() => {
    if (!doc || !diagramId || clipboard.length === 0) return;
    pasteOverlayObjects(doc, diagramId, clipboard, () => `overlay_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`);
  }, [clipboard, diagramId, doc]);

  const update = useCallback((id: string, patch: Partial<Omit<OverlayObjectRecord, 'id'>>) => {
    if (doc && diagramId) updateOverlayObject(doc, diagramId, id, patch);
  }, [diagramId, doc]);
  const editText = useCallback((id: string, index: number, deleteCount: number, insert: string) => {
    if (doc && diagramId) editOverlayText(doc, diagramId, id, index, deleteCount, insert);
  }, [diagramId, doc]);
  const duplicate = useCallback((id: string) => {
    if (!doc || !diagramId) return;
    const item = readOverlayScene(doc, diagramId).objects.find((candidate) => candidate.id === id);
    if (item) pasteOverlayObjects(doc, diagramId, [item], () => `overlay_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`);
  }, [diagramId, doc]);
  const beginComposition = useCallback((id: string) => doc && diagramId ? beginOverlayTextComposition(doc, diagramId, id) : null, [diagramId, doc]);
  const commitComposition = useCallback((id: string, composition: OverlayTextComposition, draft: string) => {
    if (doc && diagramId) commitOverlayTextComposition(doc, diagramId, id, composition, draft);
  }, [diagramId, doc]);

  if (!scene) return null;
  return { scene, add, move, anchor, remove, reorder, copy, paste, undo: () => undoManager?.undo(), update, editText, duplicate, beginComposition, commitComposition };
}
