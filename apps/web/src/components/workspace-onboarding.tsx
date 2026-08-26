import { FileText, Highlighter, Layers3, PenLine, StickyNote, X } from 'lucide-react';
import React, { useEffect } from 'react';
import { isHeaderOnlyFlowchartSource } from '../lib/diagram-mutations';
import type { DiagramEmptyState } from './diagram-canvas';

const ONBOARDING_DISMISSAL_PREFIX = 'arielcharts:onboarding-dismissed:v1:';
// Storage can be unavailable in privacy-restricted browser contexts. Preserve
// a dismissal for this mounted browser runtime even when it cannot persist
// across a reload.
const inMemoryDismissals = new Set<string>();

export function getWorkspaceOnboardingDismissalKey(sessionId: string, diagramId: string): string {
  return `${ONBOARDING_DISMISSAL_PREFIX}${sessionId}:${diagramId}`;
}

export function isWorkspaceOnboardingEligible(source: string, overlayCount: number): boolean {
  return overlayCount === 0 && (!source.trim() || isHeaderOnlyFlowchartSource(source));
}

export function shouldDismissWorkspaceOnboardingForContent(source: string, overlayCount: number): boolean {
  return !isWorkspaceOnboardingEligible(source, overlayCount);
}

export function canShowWorkspaceOnboarding({
  activeDiagramId,
  hasCompetingModal,
  openFlyout,
  overlayCount,
  source,
}: {
  activeDiagramId: string | null;
  hasCompetingModal: boolean;
  openFlyout: boolean;
  overlayCount: number;
  source: string;
}): boolean {
  return Boolean(activeDiagramId) && !hasCompetingModal && !openFlyout && isWorkspaceOnboardingEligible(source, overlayCount);
}

export function getWorkspaceCanvasGuidance({
  emptyMessage,
  emptyState,
  onboardingVisible,
}: {
  emptyMessage: string;
  emptyState: DiagramEmptyState;
  onboardingVisible: boolean;
}): { emptyMessage: string | null; emptyState: DiagramEmptyState } {
  return onboardingVisible ? { emptyMessage: null, emptyState: null } : { emptyMessage, emptyState };
}

export function isWorkspaceOnboardingDismissed(sessionId: string, diagramId: string): boolean {
  if (typeof window === 'undefined') return false;
  const key = getWorkspaceOnboardingDismissalKey(sessionId, diagramId);
  if (inMemoryDismissals.has(key)) return true;
  try {
    return window.localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function dismissWorkspaceOnboarding(sessionId: string, diagramId: string): void {
  const key = getWorkspaceOnboardingDismissalKey(sessionId, diagramId);
  inMemoryDismissals.add(key);
  try {
    window.localStorage.setItem(key, 'true');
  } catch {
    // Browser storage is only a convenience; an unavailable store must not block editing.
  }
}

interface WorkspaceOnboardingProps {
  onAddStickyNote: () => void;
  onBrowseTemplates: () => void;
  onClose: () => void;
  onDraw: () => void;
  onStartTemplate: () => void;
}

export function WorkspaceOnboarding({ onAddStickyNote, onBrowseTemplates, onClose, onDraw, onStartTemplate }: WorkspaceOnboardingProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const canvas = document.querySelector<HTMLElement>('[data-testid="diagram-canvas"]');
      const canvasOwnsEscape = canvas !== null && (
        (event.target instanceof Node && canvas.contains(event.target))
        || (document.activeElement instanceof Node && canvas.contains(document.activeElement))
      );
      // Canvas tools own Escape while focus is in their interaction surface
      // (for example to leave laser or ink mode). Onboarding stays a passive,
      // nonmodal affordance in that case.
      if (canvasOwnsEscape) return;
      onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <aside aria-labelledby="workspace-onboarding-title" className="workspace-onboarding" data-testid="workspace-onboarding">
      <div className="workspace-onboarding-heading">
        <div>
          <p>New canvas</p>
          <h2 id="workspace-onboarding-title">Start with Mermaid, then add collaboration layers.</h2>
        </div>
        <button aria-label="Close getting started" className="workspace-onboarding-close" onClick={onClose} type="button"><X aria-hidden="true" size={16} /></button>
      </div>
      <div className="workspace-onboarding-actions">
        <button onClick={onStartTemplate} type="button"><FileText aria-hidden="true" size={17} /><span><strong>Use a service flow</strong><small>Start from real Mermaid source.</small></span></button>
        <button onClick={onAddStickyNote} type="button"><StickyNote aria-hidden="true" size={17} /><span><strong>Add a sticky note</strong><small>Type private canvas context.</small></span></button>
        <button onClick={onDraw} type="button"><PenLine aria-hidden="true" size={17} /><span><strong>Draw on the canvas</strong><small>Switch to the free-draw pen.</small></span></button>
        <button onClick={onBrowseTemplates} type="button"><Layers3 aria-hidden="true" size={17} /><span><strong>Browse Mermaid templates</strong><small>Explore every diagram family.</small></span></button>
      </div>
      <p className="workspace-onboarding-note"><Highlighter aria-hidden="true" size={14} /> Mermaid stays portable; notes and ink stay with this collaborative workspace.</p>
    </aside>
  );
}
