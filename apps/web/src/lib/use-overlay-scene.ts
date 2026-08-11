'use client';

import type { OverlayLayerRecord, OverlayObjectRecord, OverlaySceneSnapshot } from '@arielcharts/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import * as Y from 'yjs';
import { inkGeometry, simplifyInkPoints, type InkMode, type InkPoint } from './freehand-ink';
import {
  addOverlayObject,
  addOverlayLayer,
  beginOverlayTextComposition,
  commitOverlayTextComposition,
  copyOverlayObjects,
  createOverlayUndoManager,
  deleteOverlayObjects,
  editOverlayText,
  getOverlayScene,
  getOverlayTransformTargets,
  hasLockedFrameAncestor,
  isOverlayObjectLocked,
  moveOverlayObjects,
  pasteOverlayObjects,
  readOverlayScene,
  setOverlayOrderKey,
  updateOverlayObject,
  updateOverlayLayer,
  type OverlayTextComposition,
} from './overlay-scene';

export interface OverlaySceneController {
  scene: OverlaySceneSnapshot;
  add: (point: { x: number; y: number }, kind?: 'annotation.text' | 'annotation.sticky') => void;
  addShape: (point: { x: number; y: number }, kind: 'shape.rectangle' | 'shape.ellipse' | 'shape.diamond' | 'shape.line' | 'shape.arrow') => void;
  addConnector: (startId: string, endId: string) => void;
  addFrame: (point: { x: number; y: number }, members: readonly string[]) => void;
  addLayer: (name: string) => void;
  updateLayer: (id: string, patch: Partial<Omit<OverlayLayerRecord, 'id'>>) => void;
  assignLayer: (ids: readonly string[], layerId: string) => void;
  reorderLayer: (id: string, direction: 'front' | 'back') => void;
  move: (id: string, dx: number, dy: number) => void;
  moveMany: (ids: readonly string[], dx: number, dy: number) => void;
  align: (ids: readonly string[], axis: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  distribute: (ids: readonly string[], axis: 'horizontal' | 'vertical') => void;
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
  addStroke: (points: readonly InkPoint[], mode: InkMode, style: { color: string; width: number; opacity: number; compositeExport: boolean }) => void;
}

export function isPureFrameUnlock(
  scene: OverlaySceneSnapshot,
  object: OverlayObjectRecord,
  patch: Partial<Omit<OverlayObjectRecord, 'id'>>,
): boolean {
  if (object.kind !== 'frame.section' || object.metadata.locked !== true || patch.metadata?.locked !== false) return false;
  const { metadata, ...otherPatch } = patch;
  if (Object.keys(otherPatch).length > 0 || !metadata) return false;
  if (scene.layers?.find(({ id }) => id === (object.layer ?? 'default'))?.locked || hasLockedFrameAncestor(scene, object.id, object.id)) return false;
  const currentKeys = Object.keys(object.metadata);
  return Object.keys(metadata).length === currentKeys.length
    && currentKeys.every((key) => key === 'locked' ? metadata[key] === false : metadata[key] === object.metadata[key]);
}

export function updateOverlayControllerObject(
  doc: Y.Doc,
  diagramId: string,
  id: string,
  patch: Partial<Omit<OverlayObjectRecord, 'id'>>,
): boolean {
  const scene = readOverlayScene(doc, diagramId);
  const object = scene.objects.find((item) => item.id === id);
  if (!object || (isOverlayObjectLocked(scene, object) && !isPureFrameUnlock(scene, object, patch))) return false;
  updateOverlayObject(doc, diagramId, id, patch);
  return true;
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
  const nextId = useCallback(() => `overlay_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`, []);
  const nextOrder = useCallback((id: string) => `${Date.now().toString().padStart(16, '0')}:${doc?.clientID ?? 0}:${id}`, [doc]);
  const addShape = useCallback((point: { x: number; y: number }, kind: 'shape.rectangle' | 'shape.ellipse' | 'shape.diamond' | 'shape.line' | 'shape.arrow') => {
    if (!doc || !diagramId) return;
    const id = nextId(); const isLine = kind === 'shape.line' || kind === 'shape.arrow';
    addOverlayObject(doc, diagramId, {
      id, kind, version: 1, order_key: nextOrder(id), layer: 'default',
      geometry: { x: point.x, y: point.y, width: isLine ? 180 : 180, height: isLine ? 48 : 112, rotation: 0 },
      style: { color: '#2563eb', fill: 'transparent', width: 2 }, metadata: { export: 'composite-export' },
      payload: { shape: kind.slice('shape.'.length) }, body: isLine ? '' : 'Label',
    });
  }, [diagramId, doc, nextId, nextOrder]);
  const addConnector = useCallback((startId: string, endId: string) => {
    if (!doc || !diagramId || startId === endId) return;
    const sceneNow = readOverlayScene(doc, diagramId); const start = sceneNow.objects.find(({ id }) => id === startId); const end = sceneNow.objects.find(({ id }) => id === endId);
    if (!start || !end) return;
    const id = nextId(); const startFallback = { x: start.geometry.x + start.geometry.width / 2, y: start.geometry.y + start.geometry.height / 2 }; const endFallback = { x: end.geometry.x + end.geometry.width / 2, y: end.geometry.y + end.geometry.height / 2 };
    addOverlayObject(doc, diagramId, { id, kind: 'connector.overlay', version: 1, order_key: nextOrder(id), layer: start.layer ?? 'default', geometry: { x: startFallback.x, y: startFallback.y, width: endFallback.x - startFallback.x, height: endFallback.y - startFallback.y, rotation: 0 }, style: { color: '#334155', width: 2 }, metadata: { export: 'composite-export' }, payload: { start_id: startId, end_id: endId, start_fallback: startFallback, end_fallback: endFallback } });
  }, [diagramId, doc, nextId, nextOrder]);
  const addFrame = useCallback((point: { x: number; y: number }, members: readonly string[]) => {
    if (!doc || !diagramId) return;
    const id = nextId();
    addOverlayObject(doc, diagramId, { id, kind: 'frame.section', version: 1, order_key: nextOrder(id), layer: 'default', geometry: { x: point.x, y: point.y, width: 320, height: 220, rotation: 0 }, style: { color: '#64748b', width: 2 }, metadata: { export: 'composite-export' }, payload: { members: [...new Set(members)].slice(0, 200), label: 'Frame', composite_members: true } });
  }, [diagramId, doc, nextId, nextOrder]);
  const addLayer = useCallback((name: string) => {
    if (!doc || !diagramId) return;
    const id = `layer_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`;
    addOverlayLayer(doc, diagramId, { id, name: name.slice(0, 120) || 'Layer', order_key: nextOrder(id), visible: true, locked: false, export: true });
  }, [diagramId, doc, nextOrder]);
  const updateLayer = useCallback((id: string, patch: Partial<Omit<OverlayLayerRecord, 'id'>>) => { if (doc && diagramId) updateOverlayLayer(doc, diagramId, id, patch); }, [diagramId, doc]);
  const assignLayer = useCallback((ids: readonly string[], layerId: string) => {
    if (!doc || !diagramId) return;
    const sceneNow = readOverlayScene(doc, diagramId);
    if (!sceneNow.layers?.some(({ id }) => id === layerId)) return;
    for (const object of sceneNow.objects.filter((item) => ids.includes(item.id) && !isOverlayObjectLocked(sceneNow, item))) updateOverlayObject(doc, diagramId, object.id, { layer: layerId });
  }, [diagramId, doc]);
  const reorderLayer = useCallback((id: string, direction: 'front' | 'back') => {
    if (!doc || !diagramId) return;
    updateOverlayLayer(doc, diagramId, id, { order_key: `${direction === 'back' ? '!' : '~'}${Date.now().toString().padStart(16, '0')}:${doc.clientID}:${id}` });
  }, [diagramId, doc]);
  const move = useCallback((id: string, dx: number, dy: number) => {
    if (!doc || !diagramId) return;
    const sceneNow = readOverlayScene(doc, diagramId);
    if (getOverlayTransformTargets(sceneNow, [id])) moveOverlayObjects(doc, diagramId, [id], dx, dy);
    undoManager?.stopCapturing();
  }, [diagramId, doc, undoManager]);
  const moveMany = useCallback((ids: readonly string[], dx: number, dy: number) => {
    if (!doc || !diagramId) return;
    const sceneNow = readOverlayScene(doc, diagramId);
    if (getOverlayTransformTargets(sceneNow, ids)) moveOverlayObjects(doc, diagramId, ids, dx, dy); undoManager?.stopCapturing();
  }, [diagramId, doc, undoManager]);
  const anchor = useCallback((id: string, mermaidId: string) => {
    if (!doc || !diagramId) return;
    const sceneNow = readOverlayScene(doc, diagramId); const object = sceneNow.objects.find((candidate) => candidate.id === id);
    if (object && !isOverlayObjectLocked(sceneNow, object)) updateOverlayObject(doc, diagramId, id, {
      anchor: { mermaid_id: mermaidId, offset: { x: 0, y: 0 }, fallback: { x: object.geometry.x, y: object.geometry.y } },
    });
  }, [diagramId, doc]);
  const remove = useCallback((ids: readonly string[]) => {
    if (!doc || !diagramId) return;
    const sceneNow = readOverlayScene(doc, diagramId);
    deleteOverlayObjects(doc, diagramId, ids.filter((id) => { const object = sceneNow.objects.find((item) => item.id === id); return object && !isOverlayObjectLocked(sceneNow, object); }));
    undoManager?.stopCapturing();
  }, [diagramId, doc, undoManager]);
  const reorder = useCallback((id: string, direction: 'front' | 'back') => {
    if (!doc || !diagramId) return;
    const sceneNow = readOverlayScene(doc, diagramId); const object = sceneNow.objects.find((item) => item.id === id); if (!object || isOverlayObjectLocked(sceneNow, object)) return;
    const key = `${direction === 'back' ? '!' : '~'}${Date.now().toString().padStart(16, '0')}:${doc.clientID}:${id}`;
    setOverlayOrderKey(doc, diagramId, id, key);
  }, [diagramId, doc]);
  const copy = useCallback((ids: readonly string[]) => {
    if (scene) setClipboard(copyOverlayObjects(scene, ids.filter((id) => { const object = scene.objects.find((item) => item.id === id); return object && !isOverlayObjectLocked(scene, object); })));
  }, [scene]);
  const paste = useCallback(() => {
    if (!doc || !diagramId || clipboard.length === 0) return;
    pasteOverlayObjects(doc, diagramId, clipboard, () => `overlay_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`);
  }, [clipboard, diagramId, doc]);

  const update = useCallback((id: string, patch: Partial<Omit<OverlayObjectRecord, 'id'>>) => {
    if (!doc || !diagramId) return;
    updateOverlayControllerObject(doc, diagramId, id, patch);
  }, [diagramId, doc]);
  const editText = useCallback((id: string, index: number, deleteCount: number, insert: string) => {
    if (!doc || !diagramId) return;
    const sceneNow = readOverlayScene(doc, diagramId); const object = sceneNow.objects.find((item) => item.id === id); if (!object || isOverlayObjectLocked(sceneNow, object)) return;
    editOverlayText(doc, diagramId, id, index, deleteCount, insert);
  }, [diagramId, doc]);
  const duplicate = useCallback((id: string) => {
    if (!doc || !diagramId) return;
    const sceneNow = readOverlayScene(doc, diagramId); const item = sceneNow.objects.find((candidate) => candidate.id === id);
    if (item && !isOverlayObjectLocked(sceneNow, item)) pasteOverlayObjects(doc, diagramId, [item], () => `overlay_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`);
  }, [diagramId, doc]);
  const addStroke = useCallback((points: readonly InkPoint[], mode: InkMode, style: { color: string; width: number; opacity: number; compositeExport: boolean }) => {
    if (!doc || !diagramId) return;
    const simplified = simplifyInkPoints(points);
    if (simplified.length < 2) return;
    // A pointer-up is one user action even when another local overlay action
    // happened inside Yjs' capture window. Keep each immutable stroke as its
    // own undo unit.
    undoManager?.stopCapturing();
    const id = `overlay_${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
    addOverlayObject(doc, diagramId, {
      id,
      kind: 'ink.stroke',
      version: 1,
      order_key: `${Date.now().toString().padStart(16, '0')}:${doc.clientID}:${id}`,
      geometry: inkGeometry(simplified, style.width),
      style: { color: style.color, width: style.width, opacity: style.opacity },
      metadata: { export: style.compositeExport ? 'composite-export' : 'arielcharts-only' },
      payload: { points: simplified, mode, composite_export: style.compositeExport },
    });
    undoManager?.stopCapturing();
  }, [diagramId, doc, undoManager]);
  const beginComposition = useCallback((id: string) => {
    if (!doc || !diagramId) return null; const sceneNow = readOverlayScene(doc, diagramId); const object = sceneNow.objects.find((item) => item.id === id);
    return object && !isOverlayObjectLocked(sceneNow, object) ? beginOverlayTextComposition(doc, diagramId, id) : null;
  }, [diagramId, doc]);
  const commitComposition = useCallback((id: string, composition: OverlayTextComposition, draft: string) => {
    if (!doc || !diagramId) return; const sceneNow = readOverlayScene(doc, diagramId); const object = sceneNow.objects.find((item) => item.id === id);
    if (object && !isOverlayObjectLocked(sceneNow, object)) commitOverlayTextComposition(doc, diagramId, id, composition, draft);
  }, [diagramId, doc]);

  const align = useCallback((ids: readonly string[], axis: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => {
    if (!doc || !diagramId) return;
    const sceneNow = readOverlayScene(doc, diagramId); if (!getOverlayTransformTargets(sceneNow, ids)) return;
    const items = sceneNow.objects.filter((item) => ids.includes(item.id)); if (items.length < 2) return;
    const horizontal = ['left', 'center', 'right'].includes(axis);
    const values = items.map((item) => axis === 'left' ? item.geometry.x : axis === 'center' ? item.geometry.x + item.geometry.width / 2 : axis === 'right' ? item.geometry.x + item.geometry.width : axis === 'top' ? item.geometry.y : axis === 'middle' ? item.geometry.y + item.geometry.height / 2 : item.geometry.y + item.geometry.height);
    const target = Math.min(...values);
    for (const [index, item] of items.entries()) moveOverlayObjects(doc, diagramId, [item.id], horizontal ? target - values[index]! : 0, horizontal ? 0 : target - values[index]!);
  }, [diagramId, doc]);
  const distribute = useCallback((ids: readonly string[], axis: 'horizontal' | 'vertical') => {
    if (!doc || !diagramId) return;
    const sceneNow = readOverlayScene(doc, diagramId); if (!getOverlayTransformTargets(sceneNow, ids)) return;
    const items = sceneNow.objects.filter((item) => ids.includes(item.id)).sort((left, right) => (axis === 'horizontal' ? left.geometry.x : left.geometry.y) - (axis === 'horizontal' ? right.geometry.x : right.geometry.y)); if (items.length < 3) return;
    const start = axis === 'horizontal' ? items[0]!.geometry.x : items[0]!.geometry.y; const end = axis === 'horizontal' ? items.at(-1)!.geometry.x : items.at(-1)!.geometry.y; const gap = (end - start) / (items.length - 1);
    for (const [index, item] of items.entries()) { const target = start + gap * index; moveOverlayObjects(doc, diagramId, [item.id], axis === 'horizontal' ? target - item.geometry.x : 0, axis === 'vertical' ? target - item.geometry.y : 0); }
  }, [diagramId, doc]);

  if (!scene) return null;
  return { scene, add, addShape, addConnector, addFrame, addLayer, updateLayer, assignLayer, reorderLayer, move, moveMany, align, distribute, anchor, remove, reorder, copy, paste, undo: () => undoManager?.undo(), update, editText, duplicate, beginComposition, commitComposition, addStroke };
}
