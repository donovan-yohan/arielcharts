'use client';

import type { OverlaySceneSnapshot, OverlayWorldPoint } from '@arielcharts/shared';
import React, { useMemo, useState } from 'react';
import { listOverlayHistory, readCurrentOverlayScene, restoreOverlayRevision } from '../lib/overlay-history-api';
import { adaptOverlaySceneToViewport, type OverlayViewportTransform } from '../lib/overlay-scene';

export interface OverlayCanvasLayerProps {
  diagramId: string;
  sessionId: string;
  scene: OverlaySceneSnapshot;
  transform: OverlayViewportTransform;
  semanticAnchors: ReadonlyMap<string, OverlayWorldPoint>;
  readOnly: boolean;
  onAdd: (point: OverlayWorldPoint) => void;
  onAnchor: (id: string, mermaidId: string) => void;
  onCopy: (ids: readonly string[]) => void;
  onDelete: (ids: readonly string[]) => void;
  onMove: (id: string, dx: number, dy: number) => void;
  onPaste: () => void;
  onReorder: (id: string, direction: 'front' | 'back') => void;
  onUndo: () => void;
}

export function OverlayCanvasLayer(props: OverlayCanvasLayerProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [historyStatus, setHistoryStatus] = useState('');
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

  return (<>
    <div data-testid="overlay-canvas-owner" style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 8 }}>
      {objects.map((object) => (
        <button
          aria-label={`${object.orphaned ? 'Orphaned ' : ''}overlay ${object.id}`}
          data-orphaned={object.orphaned || undefined}
          data-testid={`overlay-object-${object.id}`}
          data-world-x={object.geometry.x}
          data-world-y={object.geometry.y}
          key={object.id}
          onClick={(event) => { event.stopPropagation(); setSelectedId(object.id); }}
          style={{
            background: object.orphaned ? 'color-mix(in srgb, var(--warning) 18%, var(--surface-raised))' : 'var(--surface-raised)',
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
          type="button"
        >
          {typeof object.payload.label === 'string' ? object.payload.label : object.kind}
          {object.orphaned ? ' (orphaned)' : ''}
        </button>
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
        <button disabled={!writable} onClick={() => props.onAdd({ x: 80, y: 80 })} type="button">Add overlay</button>
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
        {props.scene.version !== 1 ? <span role="status">newer overlay scene is read-only</span> : null}
        {historyStatus ? <span role="status">{historyStatus}</span> : null}
      </div> : null}
    </div>
  </>);
}
