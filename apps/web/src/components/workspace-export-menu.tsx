'use client';

import type { OverlaySceneSnapshot } from '@arielcharts/shared';
import { Download, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import * as Y from 'yjs';
import { compositeSvgToPng, createCompositeSvg, type CompositeTheme } from '../lib/composite-export';
import {
  WORKSPACE_BUNDLE_EXTENSION,
  WORKSPACE_BUNDLE_MIME,
  WorkspaceBundleError,
  decodeWorkspaceBundleEnvelope,
  downloadBlob,
  downloadText,
  encodeWorkspaceBundle,
  safeDownloadStem,
  snapshotWorkspaceBundle,
  sourceDownload,
} from '../lib/workspace-bundle';
import { importWorkspaceBundle } from '../lib/workspace-import-api';

interface WorkspaceExportMenuProps {
  activeDiagramName: string | null;
  mermaidSource: string;
  mermaidSvg: string;
  onImported: () => void;
  scene: OverlaySceneSnapshot | null;
  sessionId: string;
  theme: CompositeTheme;
  workspace: Y.Doc | null;
}

export function WorkspaceExportMenu({ activeDiagramName, mermaidSource, mermaidSvg, onImported, scene, sessionId, theme, workspace }: WorkspaceExportMenuProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [expanded, setExpanded] = useState(false); const [status, setStatus] = useState(''); const [busy, setBusy] = useState(false);
  const name = activeDiagramName ?? 'diagram'; const stem = safeDownloadStem(name);
  const report = (error: unknown, fallback: string) => setStatus(error instanceof Error ? error.message : fallback);
  const withBusy = async (action: () => Promise<void>) => {
    setBusy(true); setStatus(''); try { await action(); } catch (error) { report(error, 'The requested export could not be completed.'); } finally { setBusy(false); }
  };
  const createCanvas = () => {
    if (!scene || !mermaidSvg) throw new Error('Wait for a valid Mermaid preview before exporting the canvas.');
    return createCompositeSvg({ mermaidSvg, scene, theme });
  };
  const importFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''; if (!file || !workspace) return;
    await withBusy(async () => {
      if (file.size > 192 * 1024) throw new WorkspaceBundleError('The selected workspace bundle is too large.');
      const bundle = await decodeWorkspaceBundleEnvelope(await file.text());
      await importWorkspaceBundle(sessionId, bundle); onImported(); setStatus('Editable workspace imported.');
    });
  };
  return <div className="workspace-export-menu">
    <button aria-expanded={expanded} aria-haspopup="menu" className="workspace-icon-button workspace-touch-label" data-touch-label="Export" onClick={() => setExpanded((value) => !value)} title="Export or import workspace" type="button">
      <Download aria-hidden="true" size={16} /><span>Export</span>
    </button>
    {expanded ? <div aria-label="Export and import workspace" className="workspace-export-popover" role="menu">
      <strong>Portable workspace</strong>
      <span className="workspace-export-copy">Mermaid source never includes overlays. Canvas follows visible, export-enabled layers.</span>
      <button disabled={!mermaidSource || busy} onClick={() => { sourceDownload(name, mermaidSource); setStatus('Mermaid source downloaded.'); }} role="menuitem" type="button">Export Mermaid (.mmd)</button>
      <button disabled={!mermaidSvg || !scene || busy} onClick={() => { try { downloadText(`${stem}.svg`, 'image/svg+xml', createCanvas()); setStatus('Composite SVG downloaded.'); } catch (error) { report(error, 'Canvas export failed.'); } }} role="menuitem" type="button">Export canvas SVG</button>
      <button disabled={!mermaidSvg || !scene || busy} onClick={() => { void withBusy(async () => { const blob = await compositeSvgToPng(createCanvas()); downloadBlob(`${stem}.png`, blob); setStatus('Composite PNG downloaded.'); }); }} role="menuitem" type="button">Export canvas PNG</button>
      <button disabled={!workspace || busy} onClick={() => { void withBusy(async () => { const encoded = await encodeWorkspaceBundle(snapshotWorkspaceBundle(workspace!)); downloadText(`${stem}${WORKSPACE_BUNDLE_EXTENSION}`, `${WORKSPACE_BUNDLE_MIME}; charset=utf-8`, encoded); setStatus('Editable workspace downloaded.'); }); }} role="menuitem" type="button">Export editable workspace</button>
      <button disabled={!workspace || busy} onClick={() => fileInputRef.current?.click()} role="menuitem" type="button"><Upload aria-hidden="true" size={14} /> Import editable workspace</button>
      <input accept={`${WORKSPACE_BUNDLE_EXTENSION},${WORKSPACE_BUNDLE_MIME},application/json`} aria-label="Choose editable ArielCharts workspace" className="visually-hidden" onChange={(event) => { void importFile(event); }} ref={fileInputRef} type="file" />
      <span aria-live="polite" className="workspace-export-status" role="status">{status}</span>
    </div> : null}
  </div>;
}
