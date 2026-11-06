'use client';

import { WorkspaceButton, WorkspaceConfirmation } from './workspace-controls';
import { captureWorkspaceConsentScope, isWorkspaceConsentScopeCurrent, type WorkspaceConsentScope } from '../lib/workspace-consent';

import type { OverlaySceneSnapshot } from '@arielcharts/shared';
import { Download, Upload } from 'lucide-react';
import React, { useEffect, useRef, useState } from 'react';
import * as Y from 'yjs';
import { compositeSvgToPng, createCompositeSvg, type CompositeTheme } from '../lib/composite-export';
import {
  WORKSPACE_BUNDLE_EXTENSION,
  WORKSPACE_BUNDLE_MIME,
  WorkspaceBundleError,
  applyWorkspaceBundleLocally,
  decodeWorkspaceBundleEnvelope,
  downloadBlob,
  downloadText,
  encodeWorkspaceBundle,
  safeDownloadStem,
  snapshotWorkspaceBundle,
  sourceDownload,
} from '../lib/workspace-bundle';
import { importWorkspaceBundle, readWorkspaceRevision } from '../lib/workspace-import-api';
import type { WorkspaceBundle } from '../lib/workspace-bundle';

interface WorkspaceExportMenuProps {
  activeDiagramName: string | null;
  mermaidSource: string;
  mermaidSvg: string;
  canvasExportReady?: boolean;
  canvasExportReason?: string;
  onImported: () => void;
  scene: OverlaySceneSnapshot | null;
  sessionId: string;
  theme: CompositeTheme;
  workspace: Y.Doc | null;
  workspaceMode?: 'local' | 'online';
}

export function WorkspaceExportMenu({ activeDiagramName, mermaidSource, mermaidSvg, onImported, scene, sessionId, theme, workspace, workspaceMode = 'online', canvasExportReady = false, canvasExportReason = 'Wait for a valid current preview to export the canvas.' }: WorkspaceExportMenuProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const ownerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [candidate, setCandidate] = useState<{ bundle: WorkspaceBundle; fileName: string; scope: WorkspaceConsentScope; revision?: string; count: number } | null>(null);
  useEffect(() => {
    if (!expanded) return;
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); setExpanded(false); triggerRef.current?.focus(); } };
    const outside = (event: PointerEvent) => { if (candidate) return; if (event.target instanceof Node && !ownerRef.current?.contains(event.target)) setExpanded(false); };
    document.addEventListener('keydown', key); document.addEventListener('pointerdown', outside);
    return () => { document.removeEventListener('keydown', key); document.removeEventListener('pointerdown', outside); };
  }, [expanded, candidate]);
  const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false);
  const name = activeDiagramName ?? 'diagram'; const stem = safeDownloadStem(name);
  const report = (error: unknown, fallback: string) => setStatus(error instanceof Error ? error.message : fallback);
  const actionBusyRef = useRef(false);
  const withBusy = async (action: () => Promise<void>) => {
    if (actionBusyRef.current) return;
    actionBusyRef.current = true; setBusy(true); setStatus('');
    try { await action(); } catch (error) { setCandidate(null); report(error, 'The requested export could not be completed.'); } finally { actionBusyRef.current = false; setBusy(false); }
  };
  const createCanvas = () => {
    if (!canvasExportReady || !scene || !mermaidSvg) throw new Error('Wait for a valid Mermaid preview before exporting the canvas.');
    return createCompositeSvg({ mermaidSvg, scene, theme });
  };
  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || !workspace) return;
    await withBusy(async () => {
      if (file.size > 192 * 1024) throw new WorkspaceBundleError('The selected workspace bundle is too large.');
      const bundle = await decodeWorkspaceBundleEnvelope(await file.text());
      const scope = captureWorkspaceConsentScope(workspace, sessionId);
      const revision = workspaceMode === 'online' ? await readWorkspaceRevision(sessionId, scope.content) : undefined;
      if (!isWorkspaceConsentScopeCurrent(scope, workspace, sessionId)) throw new Error('Workspace changed. Choose the file again to review replacement.');
      setCandidate({ bundle, fileName: file.name, scope, revision, count: workspace.getMap('diagrams').size });
    });
  };
  const confirmImport = async () => {
    if (!candidate || !workspace || busy) return;
    await withBusy(async () => {
      if (!isWorkspaceConsentScopeCurrent(candidate.scope, workspace, sessionId)) {
        setCandidate(null); throw new Error('Workspace changed. Choose the file again to review replacement.');
      }
      if (workspaceMode === 'local') applyWorkspaceBundleLocally(workspace, candidate.bundle);
      else await importWorkspaceBundle(sessionId, candidate.bundle, candidate.revision);
      setCandidate(null); onImported(); setStatus('Editable workspace imported.');
    });
  };
  return <div className="workspace-export-menu" ref={ownerRef}>
    {candidate ? <WorkspaceConfirmation title="Replace this workspace?" confirmLabel="Replace workspace" pending={busy} onCancel={() => setCandidate(null)} onConfirm={() => { void confirmImport(); }}>
      <p>{candidate.fileName} will replace {candidate.count} current diagram{candidate.count === 1 ? '' : 's'}.</p>
      <p>This replaces all diagrams, their order, and canvas notes, drawings, and layers in this workspace. Room access and revision history are not imported.</p>
    </WorkspaceConfirmation> : null}
    <WorkspaceButton ref={triggerRef} aria-expanded={expanded} aria-haspopup="menu" className="workspace-icon-button workspace-touch-label" data-touch-label="Export" onClick={() => setExpanded((value) => !value)} title="Export or import workspace" type="button">
      <Download aria-hidden="true" size={16} /><span>Export</span>
    </WorkspaceButton>
    {expanded ? <div aria-label="Export and import workspace" className="workspace-export-popover" role="menu">
      <strong>Portable workspace</strong>
      {!canvasExportReady ? <span className="workspace-export-copy" role="status">{canvasExportReason}</span> : null}
      <span className="workspace-export-copy">Mermaid source never includes overlays. Canvas follows visible, export-enabled layers.</span>
      <WorkspaceButton disabled={!mermaidSource || busy} onClick={() => { sourceDownload(name, mermaidSource); setStatus('Mermaid source downloaded.'); }} role="menuitem" type="button">Export Mermaid (.mmd)</WorkspaceButton>
      <WorkspaceButton disabled={!canvasExportReady || !mermaidSvg || !scene || busy} onClick={() => { try { downloadText(`${stem}.svg`, 'image/svg+xml', createCanvas()); setStatus('Composite SVG downloaded.'); } catch (error) { report(error, 'Canvas export failed.'); } }} role="menuitem" type="button">Export canvas SVG</WorkspaceButton>
      <WorkspaceButton disabled={!canvasExportReady || !mermaidSvg || !scene || busy} onClick={() => { void withBusy(async () => { const blob = await compositeSvgToPng(createCanvas()); downloadBlob(`${stem}.png`, blob); setStatus('Composite PNG downloaded.'); }); }} role="menuitem" type="button">Export canvas PNG</WorkspaceButton>
      <WorkspaceButton disabled={!workspace || busy} onClick={() => { void withBusy(async () => { const encoded = await encodeWorkspaceBundle(snapshotWorkspaceBundle(workspace!)); downloadText(`${stem}${WORKSPACE_BUNDLE_EXTENSION}`, `${WORKSPACE_BUNDLE_MIME}; charset=utf-8`, encoded); setStatus('Editable workspace downloaded.'); }); }} role="menuitem" type="button">Export editable workspace</WorkspaceButton>
      <WorkspaceButton disabled={!workspace || busy} onClick={() => fileInputRef.current?.click()} role="menuitem" type="button"><Upload aria-hidden="true" size={14} /> Import editable workspace</WorkspaceButton>
      <input accept={`${WORKSPACE_BUNDLE_EXTENSION},${WORKSPACE_BUNDLE_MIME},application/json`} aria-label="Choose editable ArielCharts workspace" className="visually-hidden" onChange={(event) => { void importFile(event); }} ref={fileInputRef} type="file" />
      <span aria-live="polite" className="workspace-export-status" role="status">{status}</span>
    </div> : null}
  </div>;
}
