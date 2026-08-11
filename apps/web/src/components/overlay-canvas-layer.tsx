'use client';

import type { OverlayObjectRecord, OverlaySceneSnapshot, OverlayWorldPoint } from '@arielcharts/shared';
import React, { useMemo, useRef, useState } from 'react';
import { listOverlayHistory, readCurrentOverlayScene, restoreOverlayRevision } from '../lib/overlay-history-api';
import { adaptOverlaySceneToViewport, type OverlayTextComposition, type OverlayViewportTransform } from '../lib/overlay-scene';

export interface OverlayCanvasLayerProps {
  diagramId: string;
  sessionId: string;
  scene: OverlaySceneSnapshot;
  transform: OverlayViewportTransform;
  viewport?: { x: number; y: number; width: number; height: number };
  semanticAnchors: ReadonlyMap<string, OverlayWorldPoint>;
  readOnly: boolean;
  onAdd: (point: OverlayWorldPoint, kind?: 'annotation.text' | 'annotation.sticky') => void;
  onAnchor: (id: string, mermaidId: string) => void;
  onCopy: (ids: readonly string[]) => void;
  onDelete: (ids: readonly string[]) => void;
  onMove: (id: string, dx: number, dy: number) => void;
  onPaste: () => void;
  onReorder: (id: string, direction: 'front' | 'back') => void;
  onUndo: () => void;
  onUpdate: (id: string, patch: Partial<Omit<OverlayObjectRecord, 'id'>>) => void;
  onEditText: (id: string, index: number, deleteCount: number, insert: string) => void;
  onDuplicate: (id: string) => void;
  onBeginComposition: (id: string) => OverlayTextComposition | null;
  onCommitComposition: (id: string, composition: OverlayTextComposition, draft: string) => void;
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
  const [toolsOpen, setToolsOpen] = useState(false);
  const [historyStatus, setHistoryStatus] = useState('');
  const [compositionDrafts, setCompositionDrafts] = useState<Record<string, string>>({});
  const [compositions, setCompositions] = useState<Record<string, OverlayTextComposition>>({});
  const canvasOwnerRef = useRef<HTMLDivElement>(null);
  const objects = useMemo(
    () => adaptOverlaySceneToViewport(props.scene, props.transform, props.semanticAnchors),
    [props.scene, props.semanticAnchors, props.transform],
  );
  const selected = objects.find(({ id }) => id === selectedId) ?? null;
  const writable = !props.readOnly && props.scene.version === 1;

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

  return (<>
    <div data-testid="overlay-canvas-owner" ref={canvasOwnerRef} style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 8 }}>
      {objects.map((object) => (
        <div
          aria-label={`${object.orphaned ? 'Orphaned ' : ''}overlay ${object.id}`}
          data-orphaned={object.orphaned || undefined}
          data-testid={`overlay-object-${object.id}`}
          data-world-x={object.geometry.x}
          data-world-y={object.geometry.y}
          key={object.id}
          onClick={(event) => { event.stopPropagation(); setSelectedId(object.id); }}
          onKeyDown={(event) => {
            if (!writable || event.target instanceof HTMLTextAreaElement) return;
            const step = event.shiftKey ? 10 : 1;
            if (event.key === 'Delete' || event.key === 'Backspace') { props.onDelete([object.id]); setSelectedId(null); event.preventDefault(); }
            else if (event.key.startsWith('Arrow')) {
              props.onMove(object.id, event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0, event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0);
              event.preventDefault();
            }
          }}
          role="group"
          tabIndex={writable ? 0 : -1}
          style={{
            background: object.kind === 'annotation.sticky' ? String(object.style.color ?? '#fef3a6') : object.orphaned ? 'color-mix(in srgb, var(--warning) 18%, var(--surface-raised))' : 'transparent',
            border: selectedId === object.id ? '2px solid var(--selection)' : '1px solid var(--control-border)',
            borderRadius: 8,
            height: object.screen_geometry.height,
            left: object.screen_geometry.x,
            overflow: 'hidden',
            pointerEvents: writable ? 'auto' : 'none',
            position: 'absolute',
            top: object.screen_geometry.y,
            transform: `rotate(${object.geometry.rotation}deg)`,
            width: object.screen_geometry.width,
          }}
        >
          {object.kind.startsWith('annotation.') ? <textarea
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
            placeholder={object.kind === 'annotation.sticky' ? 'Write a sticky note' : 'Add text'}
            readOnly={!writable}
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
      {toolsOpen ? <div aria-label="Overlay scene controls" className="overlay-scene-controls" style={{ display: 'flex', gap: 4, left: 12, pointerEvents: 'auto', position: 'absolute', top: 56 }}>
        <button aria-description="Creates free-position text at the visible viewport center" disabled={!writable} onClick={() => addAtViewportCenter('annotation.text')} type="button">Add overlay</button>
        <button disabled={!writable || !selected} onClick={() => selected && props.onMove(selected.id, 16, 0)} type="button">Move right</button>
        <button disabled={!writable || !selected || props.semanticAnchors.size === 0} onClick={() => {
          const mermaidId = props.semanticAnchors.keys().next().value as string | undefined;
          if (selected && mermaidId) props.onAnchor(selected.id, mermaidId);
        }} type="button">Anchor first node</button>
        <button disabled={!writable || !selected} onClick={() => selected && props.onReorder(selected.id, 'front')} type="button">Bring front</button>
        <button disabled={!writable || !selected} onClick={() => selected && props.onCopy([selected.id])} type="button">Copy overlay</button>
        <button disabled={!writable} onClick={props.onPaste} type="button">Paste overlay</button>
        <button disabled={!writable || !selected} onClick={() => { if (selected) props.onDelete([selected.id]); setSelectedId(null); }} type="button">Delete overlay</button>
        <button disabled={!writable} onClick={props.onUndo} type="button">Undo overlay</button>
        <button disabled={!writable} onClick={() => { void restorePrevious(); }} type="button">Restore overlay</button>
        <button disabled={!writable} onClick={() => addAtViewportCenter('annotation.sticky')} type="button">Add sticky note</button>
        <button disabled={!writable || !selected} onClick={() => selected && props.onReorder(selected.id, 'back')} type="button">Send back</button>
        <button disabled={!writable || !selected} onClick={() => selected && props.onDuplicate(selected.id)} type="button">Duplicate</button>
        <button disabled={!writable || !selected} onClick={() => selected && props.onUpdate(selected.id, { geometry: { ...selected.geometry, width: selected.geometry.width + 24, height: selected.geometry.height + 16 } })} type="button">Resize larger</button>
        <button disabled={!writable || !selected || selected.kind !== 'annotation.sticky'} onClick={() => selected && props.onUpdate(selected.id, { style: { ...selected.style, color: selected.style.color === '#bfdbfe' ? '#fef3a6' : '#bfdbfe' } })} type="button">Change note color</button>
        <span>ArielCharts overlays · not in Mermaid export</span>
        {props.scene.version !== 1 ? <span role="status">newer overlay scene is read-only</span> : null}
        {historyStatus ? <span role="status">{historyStatus}</span> : null}
      </div> : null}
      {toolsOpen ? <aside aria-label="ArielCharts overlay list" style={{ background: 'var(--surface-raised)', bottom: 12, maxHeight: 180, overflow: 'auto', pointerEvents: 'auto', position: 'absolute', right: 12 }}>
        <strong>Overlays (not in Mermaid export)</strong>
        {objects.length === 0 ? <p>No overlays</p> : <ul>{objects.map((object) => <li key={object.id}><button aria-current={selectedId === object.id || undefined} onClick={() => setSelectedId(object.id)} type="button">{object.kind === 'annotation.sticky' ? 'Sticky note' : object.kind === 'annotation.text' ? 'Text' : object.kind}: {(object.body ?? '').slice(0, 40) || 'Empty'}{object.orphaned ? ' (orphaned)' : ''}</button></li>)}</ul>}
      </aside> : null}
    </div>
  </>);
}
