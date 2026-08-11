'use client';

import type { CanvasInkPreviewState, OverlayLayerRecord, OverlayObjectRecord, OverlaySceneSnapshot, OverlayWorldPoint } from '@arielcharts/shared';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { listOverlayHistory, readCurrentOverlayScene, restoreOverlayRevision } from '../lib/overlay-history-api';
import { adaptOverlaySceneToViewport, type OverlayTextComposition, type OverlayViewportTransform } from '../lib/overlay-scene';
import { INK_MAX_PREVIEW_POINTS, INK_PREVIEW_INTERVAL_MS, simplifyInkPoints, type InkMode, type InkPoint } from '../lib/freehand-ink';

export interface OverlayCanvasLayerProps {
  diagramId: string;
  sessionId: string;
  scene: OverlaySceneSnapshot;
  transform: OverlayViewportTransform;
  viewport?: { x: number; y: number; width: number; height: number };
  semanticAnchors: ReadonlyMap<string, OverlayWorldPoint>;
  readOnly: boolean;
  onAdd: (point: OverlayWorldPoint, kind?: 'annotation.text' | 'annotation.sticky') => void;
  onAddShape?: (point: OverlayWorldPoint, kind: 'shape.rectangle' | 'shape.ellipse' | 'shape.diamond' | 'shape.line' | 'shape.arrow') => void;
  onAddConnector?: (startId: string, endId: string) => void;
  onAddFrame?: (point: OverlayWorldPoint, members: readonly string[]) => void;
  onAddLayer?: (name: string) => void;
  onUpdateLayer?: (id: string, patch: Partial<Omit<OverlayLayerRecord, 'id'>>) => void;
  onAssignLayer?: (ids: readonly string[], layerId: string) => void;
  onReorderLayer?: (id: string, direction: 'front' | 'back') => void;
  onAnchor: (id: string, mermaidId: string) => void;
  onCopy: (ids: readonly string[]) => void;
  onDelete: (ids: readonly string[]) => void;
  onMove: (id: string, dx: number, dy: number) => void;
  onMoveMany?: (ids: readonly string[], dx: number, dy: number) => void;
  onAlign?: (ids: readonly string[], axis: 'left' | 'center' | 'right' | 'top' | 'middle' | 'bottom') => void;
  onDistribute?: (ids: readonly string[], axis: 'horizontal' | 'vertical') => void;
  onPaste: () => void;
  onReorder: (id: string, direction: 'front' | 'back') => void;
  onUndo: () => void;
  onUpdate: (id: string, patch: Partial<Omit<OverlayObjectRecord, 'id'>>) => void;
  onEditText: (id: string, index: number, deleteCount: number, insert: string) => void;
  onDuplicate: (id: string) => void;
  onBeginComposition: (id: string) => OverlayTextComposition | null;
  onCommitComposition: (id: string, composition: OverlayTextComposition, draft: string) => void;
  onAddStroke?: (points: readonly InkPoint[], mode: InkMode, style: { color: string; width: number; opacity: number; compositeExport: boolean }) => void;
  onInkPreview?: (preview: CanvasInkPreviewState | null) => void;
  remoteInkPreviews?: readonly { id: string; color: string; preview: CanvasInkPreviewState }[];
}

type InkDraft = { mode: InkMode; pointerId: number; points: InkPoint[] };
type InkTool = 'select' | InkMode | 'eraser';

function pointsFromPayload(value: unknown): InkPoint[] {
  if (!value || typeof value !== 'object' || !Array.isArray((value as { points?: unknown }).points)) return [];
  return (value as { points: unknown[] }).points.flatMap((point) => point && typeof point === 'object'
    && typeof (point as InkPoint).x === 'number' && Number.isFinite((point as InkPoint).x)
    && typeof (point as InkPoint).y === 'number' && Number.isFinite((point as InkPoint).y)
    ? [{ x: (point as InkPoint).x, y: (point as InkPoint).y, ...((typeof (point as InkPoint).pressure === 'number') ? { pressure: (point as InkPoint).pressure } : {}) }] : []);
}

function screenInkPath(points: readonly InkPoint[], transform: OverlayViewportTransform): string {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'}${(point.x * transform.zoom) + transform.x} ${(point.y * transform.zoom) + transform.y}`).join(' ');
}

export function incrementalTextChange(previous: string, next: string): { index: number; deleteCount: number; insert: string } {
  let prefix = 0;
  while (prefix < previous.length && prefix < next.length && previous[prefix] === next[prefix]) prefix += 1;
  let suffix = 0;
  while (suffix < previous.length - prefix && suffix < next.length - prefix
    && previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]) suffix += 1;
  return { index: prefix, deleteCount: previous.length - prefix - suffix, insert: next.slice(prefix, next.length - suffix) };
}

export function viewportCenterToWorld(width: number, height: number, transform: OverlayViewportTransform, viewport?: { x: number; y: number; width: number; height: number }): OverlayWorldPoint {
  const center = viewport && viewport.width > 0 && viewport.height > 0
    ? { x: viewport.x + viewport.width / 2, y: viewport.y + viewport.height / 2 }
    : { x: width / 2, y: height / 2 };
  return { x: (center.x - transform.x) / transform.zoom, y: (center.y - transform.y) / transform.zoom };
}

export function OverlayCanvasLayer(props: OverlayCanvasLayerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [newLayerName, setNewLayerName] = useState('Layer');
  const [toolsOpen, setToolsOpen] = useState(false);
  const [historyStatus, setHistoryStatus] = useState('');
  const [compositionDrafts, setCompositionDrafts] = useState<Record<string, string>>({});
  const [compositions, setCompositions] = useState<Record<string, OverlayTextComposition>>({});
  const [inkTool, setInkTool] = useState<InkTool>('select');
  const [inkCompositeExport, setInkCompositeExport] = useState(true);
  const [inkDraft, setInkDraft] = useState<InkDraft | null>(null);
  const canvasOwnerRef = useRef<HTMLDivElement>(null);
  const inkDraftRef = useRef<InkDraft | null>(null);
  const inkSequenceRef = useRef(0);
  const lastInkPreviewAtRef = useRef(0);
  const objects = useMemo(() => {
    const hiddenMembers = new Set(props.scene.objects.filter((item) => item.kind === 'frame.section' && item.metadata.hidden === true)
      .flatMap((frame) => Array.isArray(frame.payload.members) ? frame.payload.members.filter((member): member is string => typeof member === 'string') : []));
    return adaptOverlaySceneToViewport(props.scene, props.transform, props.semanticAnchors)
      .filter((object) => !hiddenMembers.has(object.id) || object.kind === 'frame.section')
      .filter((object) => (props.scene.layers ?? []).find((layer) => layer.id === (object.layer ?? 'default'))?.visible ?? true);
  },
    [props.scene, props.semanticAnchors, props.transform],
  );
  const selected = objects.find(({ id }) => id === selectedId) ?? null;
  const selectedObjectIds = selectedIds.size ? [...selectedIds] : selectedId ? [selectedId] : [];
  const selectedLocked = selected ? selected.metadata.locked === true || (props.scene.layers ?? []).find(({ id }) => id === (selected.layer ?? 'default'))?.locked === true
    || props.scene.objects.some((frame) => frame.kind === 'frame.section' && frame.metadata.locked === true && Array.isArray(frame.payload.members) && frame.payload.members.includes(selected.id)) : false;
  const writable = !props.readOnly && props.scene.version === 1;
  const unobscuredViewport = props.viewport;
  const overlayListWidth = unobscuredViewport && unobscuredViewport.width > 0
    ? Math.min(252, Math.max(1, unobscuredViewport.width - 24))
    : null;
  const overlayControlsWidth = unobscuredViewport && overlayListWidth !== null
    ? Math.max(1, unobscuredViewport.width - overlayListWidth - 36)
    : 'calc(100% - 24px)';

  const pointForEvent = useCallback((event: React.PointerEvent<HTMLDivElement>): InkPoint | null => {
    const bounds = canvasOwnerRef.current?.getBoundingClientRect();
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) return null;
    const point = { x: (event.clientX - bounds.left - props.transform.x) / props.transform.zoom, y: (event.clientY - bounds.top - props.transform.y) / props.transform.zoom, pressure: event.pressure };
    return Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
  }, [props.transform]);
  const publishInkPreview = useCallback((draft: InkDraft | null, force = false) => {
    const now = Date.now();
    if (!draft) { props.onInkPreview?.(null); return; }
    if (!force && now - lastInkPreviewAtRef.current < INK_PREVIEW_INTERVAL_MS) return;
    lastInkPreviewAtRef.current = now;
    inkSequenceRef.current += 1;
    props.onInkPreview?.({ active: true, sequence: inkSequenceRef.current, mode: draft.mode, color: draft.mode === 'pen' ? '#2563eb' : '#f59e0b', width: draft.mode === 'pen' ? 3 : 16, opacity: draft.mode === 'pen' ? 1 : 0.32, points: simplifyInkPoints(draft.points, INK_MAX_PREVIEW_POINTS, 1) });
  }, [props.onInkPreview]);
  const stopInk = useCallback((commit: boolean) => {
    const draft = inkDraftRef.current;
    inkDraftRef.current = null;
    setInkDraft(null);
    publishInkPreview(null, true);
    if (!draft || !commit || draft.points.length < 2) return;
    props.onAddStroke?.(draft.points, draft.mode, { color: draft.mode === 'pen' ? '#2563eb' : '#f59e0b', width: draft.mode === 'pen' ? 3 : 16, opacity: draft.mode === 'pen' ? 1 : 0.32, compositeExport: inkCompositeExport });
  }, [inkCompositeExport, props.onAddStroke, publishInkPreview]);
  useEffect(() => () => { props.onInkPreview?.(null); }, [props.onInkPreview]);
  useEffect(() => { if (inkTool === 'select') stopInk(false); }, [inkTool, stopInk]);
  useEffect(() => { stopInk(false); }, [props.diagramId, stopInk]);

  const eraseAt = useCallback((point: InkPoint) => {
    const hit = objects.find((object) => object.kind === 'ink.stroke'
      && point.x >= object.geometry.x && point.x <= object.geometry.x + object.geometry.width
      && point.y >= object.geometry.y && point.y <= object.geometry.y + object.geometry.height);
    if (hit) { props.onDelete([hit.id]); setSelectedId(null); }
  }, [objects, props]);
  const handleInkDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const stylusEraser = event.pointerType === 'pen' && event.nativeEvent.button === 5;
    if (!writable || inkTool === 'select' || (!stylusEraser && event.button !== 0)) return;
    const point = pointForEvent(event); if (!point) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    if (inkTool === 'eraser' || stylusEraser) { eraseAt(point); return; }
    const draft: InkDraft = { mode: inkTool, pointerId: event.pointerId, points: [point] };
    inkDraftRef.current = draft; setInkDraft(draft); publishInkPreview(draft, true);
  }, [eraseAt, inkTool, pointForEvent, publishInkPreview, writable]);
  const handleInkMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const draft = inkDraftRef.current; if (!draft || draft.pointerId !== event.pointerId) return;
    const point = pointForEvent(event); if (!point) return;
    event.preventDefault();
    const next = { ...draft, points: [...draft.points.slice(-2_047), point] };
    inkDraftRef.current = next; setInkDraft(next); publishInkPreview(next);
  }, [pointForEvent, publishInkPreview]);
  const handleInkEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (inkDraftRef.current?.pointerId !== event.pointerId) return;
    event.preventDefault(); stopInk(event.type === 'pointerup');
  }, [stopInk]);

  const restorePrevious = async () => {
    setHistoryStatus('loading overlay history…');
    try {
      const [current, history] = await Promise.all([
        readCurrentOverlayScene(props.sessionId, props.diagramId),
        listOverlayHistory(props.sessionId, props.diagramId),
      ]);
      const target = history.revisions.find(({ result_revision }) => result_revision !== current.revision);
      if (!target) { setHistoryStatus('no earlier overlay revision'); return; }
      const result = await restoreOverlayRevision(props.sessionId, props.diagramId, target.revision_id, current.revision, { name: 'Browser', type: 'human' });
      setHistoryStatus(result.status === 'restored' ? 'overlay restored' : 'overlay changed; retry restore');
    } catch (error) {
      setHistoryStatus(error instanceof Error ? error.message : 'overlay restore failed');
    }
  };

  const commitText = (id: string, previous: string, next: string) => {
    const change = incrementalTextChange(previous, next);
    if (change.deleteCount || change.insert) props.onEditText(id, change.index, change.deleteCount, change.insert);
  };
  const addAtViewportCenter = (kind: 'annotation.text' | 'annotation.sticky') => {
    const bounds = canvasOwnerRef.current?.getBoundingClientRect();
    const point = bounds && bounds.width > 0 && bounds.height > 0
      ? viewportCenterToWorld(bounds.width, bounds.height, props.transform, props.viewport)
      : viewportCenterToWorld(320, 240, props.transform);
    props.onAdd(point, kind);
  };
  const addShapeAtViewportCenter = (kind: 'shape.rectangle' | 'shape.ellipse' | 'shape.diamond' | 'shape.line' | 'shape.arrow') => {
    const bounds = canvasOwnerRef.current?.getBoundingClientRect();
    const point = bounds && bounds.width > 0 && bounds.height > 0 ? viewportCenterToWorld(bounds.width, bounds.height, props.transform, props.viewport) : viewportCenterToWorld(320, 240, props.transform);
    props.onAddShape?.(point, kind);
  };
  const choose = (id: string, extend: boolean) => {
    setSelectedId(id);
    setSelectedIds((current) => {
      if (!extend) return new Set([id]);
      const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next;
    });
  };

  return (<>
    <div data-testid="overlay-canvas-owner" ref={canvasOwnerRef} style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 8 }}>
      {inkTool !== 'select' ? <div
        aria-label={`${inkTool} drawing surface`}
        data-testid="ink-drawing-surface"
        onLostPointerCapture={handleInkEnd}
        onPointerCancel={handleInkEnd}
        onPointerDown={handleInkDown}
        onPointerMove={handleInkMove}
        onPointerUp={handleInkEnd}
        style={{ cursor: inkTool === 'eraser' ? 'cell' : 'crosshair', inset: 0, pointerEvents: writable ? 'auto' : 'none', position: 'absolute', touchAction: 'none', zIndex: 2 }}
      /> : null}
      <svg aria-hidden="true" data-testid="ink-overlay-renderer" style={{ height: '100%', inset: 0, overflow: 'visible', pointerEvents: 'none', position: 'absolute', width: '100%' }}>
        {objects.filter((object) => object.kind === 'ink.stroke').map((object) => {
          const points = pointsFromPayload(object.payload); const mode = object.payload.mode === 'highlighter' ? 'highlighter' : 'pen';
          return points.length > 1 ? <path data-testid={`ink-stroke-${object.id}`} d={screenInkPath(points, props.transform)} fill="none" key={object.id} opacity={Number(object.style.opacity ?? 1)} stroke={String(object.style.color ?? '#2563eb')} strokeLinecap="round" strokeLinejoin="round" strokeWidth={Number(object.style.width ?? (mode === 'pen' ? 3 : 16)) * props.transform.zoom} /> : null;
        })}
        {inkDraft && inkDraft.points.length > 1 ? <path data-testid="ink-local-draft" d={screenInkPath(inkDraft.points, props.transform)} fill="none" opacity={inkDraft.mode === 'pen' ? 1 : 0.32} stroke={inkDraft.mode === 'pen' ? '#2563eb' : '#f59e0b'} strokeLinecap="round" strokeLinejoin="round" strokeWidth={(inkDraft.mode === 'pen' ? 3 : 16) * props.transform.zoom} /> : null}
        {(props.remoteInkPreviews ?? []).flatMap(({ id, color, preview }) => preview.active && preview.points && preview.points.length > 1 ? [<path data-testid={`ink-preview-${id}`} d={screenInkPath(preview.points, props.transform)} fill="none" key={id} opacity={preview.opacity ?? 0.5} stroke={preview.color ?? color} strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round" strokeWidth={(preview.width ?? 3) * props.transform.zoom} />] : [])}
        {objects.filter((object) => object.kind === 'connector.overlay' || object.kind === 'shape.line' || object.kind === 'shape.arrow').map((object) => <line data-testid={`overlay-line-${object.id}`} key={object.id} markerEnd={object.kind === 'shape.arrow' ? 'url(#overlay-arrow)' : undefined} stroke={String(object.style.color ?? '#334155')} strokeDasharray={object.orphaned ? '6 4' : undefined} strokeWidth={Number(object.style.width ?? 2)} x1={object.screen_geometry.x} x2={object.screen_geometry.x + object.screen_geometry.width} y1={object.screen_geometry.y} y2={object.screen_geometry.y + object.screen_geometry.height} />)}
        <defs><marker id="overlay-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="3"><path d="M0,0 L0,6 L7,3 z" fill="#334155" /></marker></defs>
      </svg>
      {objects.filter((object) => object.kind !== 'connector.overlay' && object.kind !== 'shape.line' && object.kind !== 'shape.arrow').map((object) => (
        <div
          aria-label={`${object.orphaned ? 'Orphaned ' : ''}overlay ${object.id}`}
          data-orphaned={object.orphaned || undefined}
          data-testid={`overlay-object-${object.id}`}
          data-world-x={object.geometry.x}
          data-world-y={object.geometry.y}
          key={object.id}
          onClick={(event) => { event.stopPropagation(); choose(object.id, event.metaKey || event.ctrlKey); }}
          onKeyDown={(event) => {
            if (!writable || event.target instanceof HTMLTextAreaElement) return;
            const step = event.shiftKey ? 10 : 1;
            if (event.key === 'Delete' || event.key === 'Backspace') { props.onDelete(selectedObjectIds.length ? selectedObjectIds : [object.id]); setSelectedId(null); setSelectedIds(new Set()); event.preventDefault(); }
            else if (event.key.startsWith('Arrow')) {
              const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
              const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
              if (selectedObjectIds.length > 1) props.onMoveMany?.(selectedObjectIds, dx, dy); else props.onMove(object.id, dx, dy);
              event.preventDefault();
            }
          }}
          role="group"
          tabIndex={writable ? 0 : -1}
          style={{
            background: object.kind === 'annotation.sticky' ? String(object.style.color ?? '#fef3a6') : object.kind === 'shape.ellipse' ? 'color-mix(in srgb, #dbeafe 45%, transparent)' : object.kind === 'shape.diamond' ? 'color-mix(in srgb, #ede9fe 45%, transparent)' : object.kind === 'shape.rectangle' ? 'color-mix(in srgb, #dcfce7 45%, transparent)' : object.kind === 'frame.section' ? 'color-mix(in srgb, #e2e8f0 25%, transparent)' : object.orphaned ? 'color-mix(in srgb, var(--warning) 18%, var(--surface-raised))' : 'transparent',
            border: selectedId === object.id ? '2px solid var(--selection)' : '1px solid var(--control-border)',
            borderRadius: object.kind === 'shape.ellipse' ? '50%' : 8,
            height: object.screen_geometry.height,
            left: object.screen_geometry.x,
            overflow: 'hidden',
            pointerEvents: writable ? 'auto' : 'none',
            position: 'absolute',
            top: object.screen_geometry.y,
            transform: `${object.kind === 'shape.diamond' ? 'rotate(45deg) ' : ''}rotate(${object.geometry.rotation}deg)`,
            width: object.screen_geometry.width,
          }}
        >
          {object.kind === 'frame.section' ? <span style={{ padding: 8 }}>{typeof object.payload.label === 'string' ? object.payload.label : 'Frame'}</span> : object.kind === 'ink.stroke' ? <span className="sr-only">{object.payload.mode === 'highlighter' ? 'Highlighter' : 'Pen'} stroke</span> : object.kind.startsWith('annotation.') || object.kind.startsWith('shape.') ? <textarea
            aria-label={`${object.kind === 'annotation.sticky' ? 'Sticky note' : 'Free text'} contents`}
            onChange={(event) => {
              if (compositionDrafts[object.id] !== undefined) setCompositionDrafts((drafts) => ({ ...drafts, [object.id]: event.target.value }));
              else commitText(object.id, object.body ?? '', event.target.value);
            }}
            onCompositionEnd={(event) => {
              const next = event.currentTarget.value;
              const composition = compositions[object.id];
              setCompositionDrafts((drafts) => { const copy = { ...drafts }; delete copy[object.id]; return copy; });
              setCompositions((items) => { const copy = { ...items }; delete copy[object.id]; return copy; });
              if (composition) props.onCommitComposition(object.id, composition, next);
            }}
            onCompositionStart={(event) => {
              const composition = props.onBeginComposition(object.id);
              const draft = event.currentTarget.value;
              if (composition) setCompositions((items) => ({ ...items, [object.id]: composition }));
              setCompositionDrafts((drafts) => ({ ...drafts, [object.id]: draft }));
            }}
            placeholder={object.kind === 'annotation.sticky' ? 'Write a sticky note' : object.kind.startsWith('shape.') ? 'Shape label' : 'Add text'}
            readOnly={!writable || object.metadata.locked === true || (props.scene.layers ?? []).find(({ id }) => id === (object.layer ?? 'default'))?.locked === true || props.scene.objects.some((frame) => frame.kind === 'frame.section' && frame.metadata.locked === true && Array.isArray(frame.payload.members) && frame.payload.members.includes(object.id))}
            style={{ background: 'transparent', border: 0, color: 'inherit', font: 'inherit', height: '100%', padding: 8, resize: 'none', width: '100%' }}
            value={compositionDrafts[object.id] ?? object.body ?? ''}
          /> : (typeof object.payload.label === 'string' ? object.payload.label : object.kind)}
          {object.orphaned ? <span> (orphaned)<span className="sr-only"> from Mermaid target</span></span> : null}
        </div>
      ))}
    </div>
    <div data-testid="overlay-controls-owner" style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 31 }}>
      <button
        aria-expanded={toolsOpen}
        className="overlay-tools-toggle"
        onClick={() => setToolsOpen((open) => !open)}
        style={{ bottom: 12, left: 12, minHeight: 44, minWidth: 44, pointerEvents: 'auto', position: 'absolute' }}
        type="button"
      >{toolsOpen ? 'Close overlay tools' : 'Overlay tools'}</button>
      {toolsOpen ? <div aria-label="Overlay scene controls" className="overlay-scene-controls" style={{ display: 'flex', flexWrap: 'wrap', gap: 4, left: unobscuredViewport && unobscuredViewport.width > 0 ? unobscuredViewport.x + 12 : 12, maxWidth: overlayControlsWidth, pointerEvents: 'auto', position: 'absolute', top: 56, zIndex: 2 }}>
        <button aria-description="Creates free-position text at the visible viewport center" disabled={!writable} onClick={() => addAtViewportCenter('annotation.text')} type="button">Add overlay</button>
        <button disabled={!writable} onClick={() => addShapeAtViewportCenter('shape.rectangle')} type="button">Rectangle</button>
        <button disabled={!writable} onClick={() => addShapeAtViewportCenter('shape.ellipse')} type="button">Ellipse</button>
        <button disabled={!writable} onClick={() => addShapeAtViewportCenter('shape.diamond')} type="button">Diamond</button>
        <button disabled={!writable} onClick={() => addShapeAtViewportCenter('shape.line')} type="button">Line</button>
        <button disabled={!writable} onClick={() => addShapeAtViewportCenter('shape.arrow')} type="button">Arrow</button>
        <button disabled={!writable || selectedObjectIds.length !== 2} onClick={() => { if (selectedObjectIds.length === 2) props.onAddConnector?.(selectedObjectIds[0]!, selectedObjectIds[1]!); }} type="button">Connect selection</button>
        <button disabled={!writable} onClick={() => { const bounds = canvasOwnerRef.current?.getBoundingClientRect(); const point = bounds ? viewportCenterToWorld(bounds.width, bounds.height, props.transform, props.viewport) : { x: 0, y: 0 }; props.onAddFrame?.(point, selectedObjectIds); }} type="button">Frame selection</button>
        <button disabled={!writable || !selected || selectedLocked} onClick={() => selected && (selectedObjectIds.length > 1 ? props.onMoveMany?.(selectedObjectIds, 16, 0) : props.onMove(selected.id, 16, 0))} type="button">Move right</button>
        <button disabled={!writable || !selected || selectedLocked || props.semanticAnchors.size === 0} onClick={() => {
          const mermaidId = props.semanticAnchors.keys().next().value as string | undefined;
          if (selected && mermaidId) props.onAnchor(selected.id, mermaidId);
        }} type="button">Anchor first node</button>
        <button disabled={!writable || !selected || selectedLocked} onClick={() => selected && props.onReorder(selected.id, 'front')} type="button">Bring front</button>
        <button disabled={!writable || !selected || selectedLocked} onClick={() => selected && props.onCopy([selected.id])} type="button">Copy overlay</button>
        <button disabled={!writable} onClick={props.onPaste} type="button">Paste overlay</button>
        <button disabled={!writable || !selected || selectedLocked} onClick={() => { if (selected) props.onDelete([selected.id]); setSelectedId(null); }} type="button">Delete overlay</button>
        <button disabled={!writable} onClick={props.onUndo} type="button">Undo overlay</button>
        <button disabled={!writable} onClick={() => { void restorePrevious(); }} type="button">Restore overlay</button>
        <button disabled={!writable} onClick={() => addAtViewportCenter('annotation.sticky')} type="button">Add sticky note</button>
        <button aria-pressed={inkTool === 'pen'} disabled={!writable} onClick={() => setInkTool((tool) => tool === 'pen' ? 'select' : 'pen')} type="button">Pen</button>
        <button aria-pressed={inkTool === 'highlighter'} disabled={!writable} onClick={() => setInkTool((tool) => tool === 'highlighter' ? 'select' : 'highlighter')} type="button">Highlighter</button>
        <button aria-pressed={inkTool === 'eraser'} disabled={!writable} onClick={() => setInkTool((tool) => tool === 'eraser' ? 'select' : 'eraser')} type="button">Erase stroke</button>
        <label><input checked={inkCompositeExport} disabled={!writable} onChange={(event) => setInkCompositeExport(event.target.checked)} type="checkbox" /> Include ink in composite export</label>
        <button disabled={!writable || !selected || selectedLocked} onClick={() => selected && props.onReorder(selected.id, 'back')} type="button">Send back</button>
        <button disabled={!writable || !selected || selectedLocked} onClick={() => selected && props.onDuplicate(selected.id)} type="button">Duplicate</button>
        <button disabled={!writable || !selected || selectedLocked} onClick={() => selected && props.onUpdate(selected.id, { geometry: { ...selected.geometry, width: selected.geometry.width + 24, height: selected.geometry.height + 16 } })} type="button">Resize larger</button>
        <button disabled={!writable || !selected || selectedLocked || selected.kind === 'ink.stroke' || selected.kind === 'connector.overlay'} onClick={() => selected && props.onUpdate(selected.id, { geometry: { ...selected.geometry, rotation: (selected.geometry.rotation + 15) % 360 } })} type="button">Rotate 15°</button>
        <button disabled={!writable || selectedObjectIds.length < 2} onClick={() => props.onAlign?.(selectedObjectIds, 'left')} type="button">Align left</button>
        <button disabled={!writable || selectedObjectIds.length < 2} onClick={() => props.onAlign?.(selectedObjectIds, 'top')} type="button">Align top</button>
        <button disabled={!writable || selectedObjectIds.length < 3} onClick={() => props.onDistribute?.(selectedObjectIds, 'horizontal')} type="button">Distribute horizontal</button>
        <button disabled={!writable || !selected || selected.kind !== 'annotation.sticky'} onClick={() => selected && props.onUpdate(selected.id, { style: { ...selected.style, color: selected.style.color === '#bfdbfe' ? '#fef3a6' : '#bfdbfe' } })} type="button">Change note color</button>
        <button disabled={!writable || selected?.kind !== 'frame.section'} onClick={() => selected && props.onUpdate(selected.id, { metadata: { ...selected.metadata, hidden: selected.metadata.hidden !== true } })} type="button">{selected?.kind === 'frame.section' && selected.metadata.hidden === true ? 'Show frame members' : 'Hide frame members'}</button>
        <button disabled={!writable || selected?.kind !== 'frame.section'} onClick={() => selected && props.onUpdate(selected.id, { metadata: { ...selected.metadata, locked: selected.metadata.locked !== true } })} type="button">{selected?.kind === 'frame.section' && selected.metadata.locked === true ? 'Unlock frame' : 'Lock frame'}</button>
        <button disabled={!writable || selected?.kind !== 'frame.section' || selectedLocked} onClick={() => selected && props.onUpdate(selected.id, { payload: { ...selected.payload, composite_members: selected.payload.composite_members !== true } })} type="button">{selected?.kind === 'frame.section' && selected.payload.composite_members === false ? 'Include frame members in composite export' : 'Exclude frame members from composite export'}</button>
        <span>ArielCharts overlays · not in Mermaid export</span>
        {props.scene.version !== 1 ? <span role="status">newer overlay scene is read-only</span> : null}
        {historyStatus ? <span role="status">{historyStatus}</span> : null}
      </div> : null}
      {toolsOpen ? <aside aria-label="ArielCharts overlay list" className="overlay-scene-list" style={{ background: 'var(--surface-raised)', bottom: overlayListWidth !== null ? 'auto' : 12, left: unobscuredViewport && overlayListWidth !== null ? unobscuredViewport.x + Math.max(12, unobscuredViewport.width - overlayListWidth - 12) : undefined, maxHeight: 180, maxWidth: overlayListWidth !== null ? Math.max(1, unobscuredViewport!.width - 24) : undefined, overflow: 'auto', pointerEvents: 'auto', position: 'absolute', right: overlayListWidth !== null ? 'auto' : 12, top: overlayListWidth !== null ? 12 : undefined, width: overlayListWidth ?? undefined, zIndex: 1 }}>
        <strong>Overlays (not in Mermaid export)</strong>
        {objects.length === 0 ? <p>No overlays</p> : <ul>{objects.map((object) => <li key={object.id}><button aria-current={selectedId === object.id || undefined} onClick={(event) => choose(object.id, event.metaKey || event.ctrlKey)} type="button">{object.kind === 'annotation.sticky' ? 'Sticky note' : object.kind === 'annotation.text' ? 'Text' : object.kind}: {(object.body ?? String(object.payload.label ?? '')).slice(0, 40) || 'Empty'}{object.orphaned ? ' (orphaned)' : ''}</button></li>)}</ul>}
        <strong>Layers</strong>
        <label>New layer <input aria-label="New overlay layer name" disabled={!writable} onChange={(event) => setNewLayerName(event.target.value)} value={newLayerName} /></label>
        <button disabled={!writable || !newLayerName.trim()} onClick={() => props.onAddLayer?.(newLayerName)} type="button">Add layer</button>
        {selectedObjectIds.length > 0 ? <label>Assign selection to <select aria-label="Assign selected overlays to layer" disabled={!writable || selectedLocked} onChange={(event) => { if (event.target.value) props.onAssignLayer?.(selectedObjectIds, event.target.value); }} value=""><option value="">Choose layer</option>{(props.scene.layers ?? []).map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label> : null}
        <ul>{(props.scene.layers ?? []).map((layer) => <li key={layer.id}>{layer.name} <button aria-pressed={layer.visible} disabled={!writable} onClick={() => props.onUpdateLayer?.(layer.id, { visible: !layer.visible })} type="button">{layer.visible ? 'Hide' : 'Show'}</button><button aria-pressed={layer.locked} disabled={!writable} onClick={() => props.onUpdateLayer?.(layer.id, { locked: !layer.locked })} type="button">{layer.locked ? 'Unlock' : 'Lock'}</button><button aria-pressed={layer.export} disabled={!writable} onClick={() => props.onUpdateLayer?.(layer.id, { export: !layer.export })} type="button">{layer.export ? 'Composite export' : 'No composite export'}</button><button disabled={!writable} onClick={() => props.onReorderLayer?.(layer.id, 'front')} type="button">Layer front</button><button disabled={!writable} onClick={() => props.onReorderLayer?.(layer.id, 'back')} type="button">Layer back</button></li>)}</ul>
      </aside> : null}
    </div>
  </>);
}
