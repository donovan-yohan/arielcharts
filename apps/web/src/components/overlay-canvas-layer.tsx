'use client';

import type { CanvasInkPreviewState, OverlayLayerRecord, OverlayObjectRecord, OverlaySceneSnapshot, OverlayWorldPoint } from '@arielcharts/shared';
import {
  ArrowRight,
  ArrowDownToLine,
  ArrowUpToLine,
  Anchor,
  AlignLeft,
  AlignStartVertical,
  BetweenHorizontalStart,
  ClipboardPaste,
  BringToFront,
  Circle,
  Copy,
  CopyPlus,
  Diamond,
  Eraser,
  Eye,
  EyeOff,
  Frame,
  Highlighter,
  Layers3,
  Lock,
  LineChart,
  MousePointer2,
  MoveRight,
  PenLine,
  Plus,
  RectangleHorizontal,
  Redo2,
  RotateCw,
  SquareDashedMousePointer,
  StickyNote,
  SendToBack,
  Trash2,
  Unlock,
  Undo2,
} from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { listOverlayHistory, readCurrentOverlayScene, restoreOverlayRevision } from '../lib/overlay-history-api';
import { adaptOverlaySceneToViewport, isOverlayObjectLocked, type OverlayTextComposition, type OverlayViewportTransform } from '../lib/overlay-scene';
import { INK_MAX_PREVIEW_POINTS, INK_PREVIEW_INTERVAL_MS, simplifyInkPoints, type InkMode, type InkPoint } from '../lib/freehand-ink';

export interface OverlayCanvasLayerProps {
  diagramId: string;
  sessionId: string;
  scene: OverlaySceneSnapshot;
  transform: OverlayViewportTransform;
  viewport?: { x: number; y: number; width: number; height: number };
  semanticAnchors: ReadonlyMap<string, OverlayWorldPoint>;
  readOnly: boolean;
  onAdd: (point: OverlayWorldPoint, kind?: 'annotation.text' | 'annotation.sticky') => unknown;
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
  onReorder: (id: string, direction: 'front' | 'back' | 'forward' | 'backward') => void;
  onUndo: () => void;
  onRedo?: () => void;
  onUpdate: (id: string, patch: Partial<Omit<OverlayObjectRecord, 'id'>>) => void;
  onEditText: (id: string, index: number, deleteCount: number, insert: string) => void;
  onDuplicate: (id: string) => void;
  onBeginComposition: (id: string) => OverlayTextComposition | null;
  onCommitComposition: (id: string, composition: OverlayTextComposition, draft: string) => void;
  onAddStroke?: (points: readonly InkPoint[], mode: InkMode, style: { color: string; width: number; opacity: number; compositeExport: boolean }) => void;
  onToolActivate?: () => void;
  onHistoryActionBegin?: () => void;
  onHistoryActionEnd?: () => void;
  onHistoryActionRun?: (run: () => void) => void;
  onInkPreview?: (preview: CanvasInkPreviewState | null) => void;
  nextInkPreviewSequence?: () => number;
  remoteInkPreviews?: readonly { id: string; color: string; preview: CanvasInkPreviewState }[];
  onboardingRequest?: { id: number; action: 'sticky' | 'pen' } | null;
  onOnboardingRequestComplete?: (requestId: number, createdTextId?: string) => void;
  requestedTextEditId?: string | null;
  onRequestedTextEditComplete?: (id: string) => void;
}

type InkDraft = { mode: InkMode; pointerId: number; points: InkPoint[] };
type ResizeDraft = { id: string; pointerId: number; origin: { x: number; y: number; width: number; height: number; rotation: number }; start: InkPoint };
type MoveDraft = { id: string; pointerId: number; origin: { x: number; y: number; width: number; height: number; rotation: number }; start: InkPoint };
type InkTool = 'select' | InkMode | 'eraser';

type ToolbarIconButtonProps = {
  children: React.ReactNode;
  className?: string;
  controls?: string;
  disabled?: boolean;
  expanded?: boolean;
  label: string;
  onClick: () => void;
  pressed?: boolean;
};

function ToolbarIconButton({ children, className, controls, disabled, expanded, label, onClick, pressed }: ToolbarIconButtonProps) {
  return <button aria-controls={controls} aria-expanded={expanded} aria-label={label} aria-pressed={pressed} className={`overlay-toolbar-button${className ? ` ${className}` : ''}`} disabled={disabled} onClick={onClick} title={label} type="button">
    {children}
  </button>;
}

function ToolbarDivider() {
  return <span aria-hidden="true" className="overlay-toolbar-divider" />;
}

function toolbarButtons(toolbar: HTMLElement): HTMLButtonElement[] {
  return [...toolbar.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
}

export function maintainRovingToolbarFocus(toolbar: HTMLElement, focused: HTMLButtonElement): void {
  for (const button of toolbarButtons(toolbar)) button.tabIndex = button === focused ? 0 : -1;
}

export function moveRovingToolbarFocus(toolbar: HTMLElement, key: string): boolean {
  const buttons = toolbarButtons(toolbar);
  const current = document.activeElement instanceof HTMLButtonElement ? document.activeElement : null;
  const index = current ? buttons.indexOf(current) : -1;
  if (!buttons.length || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(key)) return false;
  const nextIndex = key === 'Home' ? 0 : key === 'End' ? buttons.length - 1
    : (index + (key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
  const next = buttons[nextIndex]!;
  maintainRovingToolbarFocus(toolbar, next);
  next.focus({ preventScroll: true });
  next.scrollIntoView({ behavior: 'auto', block: 'nearest', inline: 'nearest' });
  return true;
}

/**
 * CSS may round a fractional max-height up to the next device pixel. Reserve
 * one whole pixel after flooring so the inspector's border box never reaches
 * the camera control lane.
 */
export function inspectorCapacityPx(inspectorTop: number, safeBottom: number): number {
  return Math.max(0, Math.floor(safeBottom - inspectorTop) - 1);
}

export function resolveOverlayToolbarViewport(
  viewport: OverlayCanvasLayerProps['viewport'],
  canvasWidth: number,
  canvasHeight: number,
): NonNullable<OverlayCanvasLayerProps['viewport']> {
  if (viewport
    && Number.isFinite(viewport.x)
    && Number.isFinite(viewport.y)
    && Number.isFinite(viewport.width)
    && Number.isFinite(viewport.height)
    && viewport.width >= 44
    && viewport.height >= 44) return viewport;
  return { height: canvasHeight, width: canvasWidth, x: 0, y: 0 };
}

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
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [historyStatus, setHistoryStatus] = useState('');
  const [compositionDrafts, setCompositionDrafts] = useState<Record<string, string>>({});
  const [compositions, setCompositions] = useState<Record<string, OverlayTextComposition>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inkTool, setInkTool] = useState<InkTool>('select');
  const [inkCompositeExport, setInkCompositeExport] = useState(true);
  const [inkDraft, setInkDraft] = useState<InkDraft | null>(null);
  const [dragOffset, setDragOffset] = useState<{ id: string; x: number; y: number } | null>(null);
  const [toolbarPosition, setToolbarPosition] = useState({ availableHeight: 0, availableWidth: 0, inspectorMaxHeight: 0, left: 0, top: 12 });
  const resizeDraftRef = useRef<ResizeDraft | null>(null);
  const moveDraftRef = useRef<MoveDraft | null>(null);
  const canvasOwnerRef = useRef<HTMLDivElement>(null);
  const controlsOwnerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const primaryToolbarRef = useRef<HTMLDivElement>(null);
  const contextToolbarRef = useRef<HTMLDivElement>(null);
  const inkDraftRef = useRef<InkDraft | null>(null);
  const drawingSurfaceRef = useRef<HTMLDivElement | null>(null);
  const onboardingRequestCompleteRef = useRef(props.onOnboardingRequestComplete);
  const pendingOnboardingPenRequestRef = useRef<number | null>(null);
  const completedOnboardingPenRequestIdsRef = useRef(new Set<number>());
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
  const inspectorId = `overlay-inspector-${props.diagramId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const unobscuredViewport = props.viewport;
  useLayoutEffect(() => {
    const owner = canvasOwnerRef.current;
    if (!owner) return;
    const canvas = owner.closest<HTMLElement>('[data-testid="diagram-canvas"]') ?? owner;
    const topbar = document.querySelector<HTMLElement>('.workspace-topbar');
    const pane = canvas.closest<HTMLElement>('.workspace-diagram-pane');
    const canvasStyleHost = canvas.closest<HTMLElement>('.diagram-canvas-shell');
    let frameId: number | null = null;
    let observedErrorBanner: HTMLElement | null = null;
    let geometryObserver: ResizeObserver;
    const refreshErrorBanner = () => {
      const nextErrorBanner = pane?.querySelector<HTMLElement>('.error-banner') ?? null;
      if (observedErrorBanner && observedErrorBanner !== nextErrorBanner) geometryObserver.unobserve(observedErrorBanner);
      if (nextErrorBanner && nextErrorBanner !== observedErrorBanner) geometryObserver.observe(nextErrorBanner);
      observedErrorBanner = nextErrorBanner;
    };
    const measure = () => {
      frameId = null;
      const canvasBounds = canvas.getBoundingClientRect();
      const header = topbar?.getBoundingClientRect();
      const headerInset = header && header.bottom > canvasBounds.top && header.top < canvasBounds.bottom ? Math.max(0, header.bottom - canvasBounds.top) : 0;
      const errorBanner = pane?.querySelector<HTMLElement>('.error-banner');
      const errorBounds = errorBanner?.getBoundingClientRect();
      const viewport = resolveOverlayToolbarViewport(props.viewport, canvasBounds.width, canvasBounds.height);
      const viewportX = viewport.x;
      const viewportY = viewport.y;
      const viewportWidth = viewport.width;
      const minimumTop = canvasBounds.top + Math.max(headerInset, viewportY, 0) + 12;
      const defaultTop = Math.max(minimumTop, Math.min(canvasBounds.top + headerInset, header?.bottom ?? canvasBounds.top) + 12);
      const toolbarHeight = 54;
      const errorOverlapsTop = errorBounds && defaultTop < errorBounds.bottom && defaultTop + toolbarHeight > errorBounds.top;
      const top = errorOverlapsTop ? errorBounds.bottom + 8 : defaultTop;
      const left = canvasBounds.left + viewportX + (viewportWidth / 2);
      const primaryHeight = primaryToolbarRef.current?.getBoundingClientRect().height || toolbarHeight;
      const contextHeight = contextToolbarRef.current?.getBoundingClientRect().height ?? 0;
      const hostControlsSafeBottom = canvasStyleHost
        ? getComputedStyle(canvasStyleHost).getPropertyValue('--canvas-controls-toolbar-safe-bottom').trim()
        : '';
      const canvasControlsSafeBottom = getComputedStyle(canvas).getPropertyValue('--canvas-controls-toolbar-safe-bottom').trim();
      const publishedControlsSafeBottom = hostControlsSafeBottom || canvasControlsSafeBottom;
      const controlsSafeBottom = Number.parseFloat(publishedControlsSafeBottom);
      const hasPublishedControlsSafeBottom = publishedControlsSafeBottom !== ''
        && Number.isFinite(controlsSafeBottom) && controlsSafeBottom >= 0;
      const fallbackControlsBounds = canvas.querySelector<HTMLElement>('[data-testid="canvas-controls-toolbar"]')?.getBoundingClientRect();
      // DiagramCanvas publishes both its present rail and an authoritative
      // zero when it owns none. Only legacy or invalid publishers consult a
      // live controls rect, which can otherwise be a stale renderer remnant.
      const bottomSafeTop = hasPublishedControlsSafeBottom
        ? controlsSafeBottom > 0 ? canvasBounds.bottom - controlsSafeBottom : canvasBounds.bottom - 8
        : fallbackControlsBounds && fallbackControlsBounds.top > canvasBounds.top && fallbackControlsBounds.top < canvasBounds.bottom
          ? fallbackControlsBounds.top - 8 : canvasBounds.bottom - 8;
      const inspectorTop = top + primaryHeight + (contextHeight ? contextHeight + 8 : 0) + 8;
      const inspectorMaxHeight = inspectorCapacityPx(inspectorTop, bottomSafeTop);
      setToolbarPosition((current) => current.availableHeight === Math.max(0, canvasBounds.bottom - top - 8)
        && current.availableWidth === viewportWidth && current.inspectorMaxHeight === inspectorMaxHeight
        && current.left === left && current.top === top
        ? current
        : {
          availableHeight: Math.max(0, canvasBounds.bottom - top - 8),
          availableWidth: viewportWidth,
          inspectorMaxHeight,
          left,
          top,
        });
    };
    // Banner mutations and portal geometry can land in the same React commit.
    // Measure on the following animation frame so toolbar placement and the
    // inspector's camera-safe capacity are published together from that DOM.
    const update = () => {
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      frameId = window.requestAnimationFrame(measure);
    };
    geometryObserver = new ResizeObserver(update);
    geometryObserver.observe(canvas);
    if (topbar) geometryObserver.observe(topbar);
    if (primaryToolbarRef.current) geometryObserver.observe(primaryToolbarRef.current);
    if (contextToolbarRef.current) geometryObserver.observe(contextToolbarRef.current);
    refreshErrorBanner();
    update();
    // Error banners are inserted/removed below the pane. Attribute records are
    // intentionally excluded because this layout observer only responds to
    // structural placement changes.
    const mutationObserver = pane ? new MutationObserver(() => {
      refreshErrorBanner();
      update();
    }) : null;
    if (pane && mutationObserver) mutationObserver.observe(pane, { childList: true, subtree: true });
    // DiagramCanvas publishes the camera reserve as a custom property. Watch
    // its style host for reserve changes; child mutations remain only as a
    // legacy fallback when an older canvas does not publish that contract.
    const canvasMutationObserver = new MutationObserver(update);
    canvasMutationObserver.observe(canvas, { attributes: true, attributeFilter: ['style'], childList: true, subtree: true });
    if (canvasStyleHost && canvasStyleHost !== canvas) canvasMutationObserver.observe(canvasStyleHost, { attributes: true, attributeFilter: ['style'] });
    window.addEventListener('resize', update);
    return () => {
      geometryObserver.disconnect();
      mutationObserver?.disconnect();
      canvasMutationObserver.disconnect();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      window.removeEventListener('resize', update);
    };
  }, [props.viewport?.height, props.viewport?.width, props.viewport?.x, props.viewport?.y, inspectorOpen, selectedObjectIds.length]);

  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    const primary = primaryToolbarRef.current;
    if (!toolbar || !primary) return;
    const initializeRoving = () => {
      for (const rovingToolbar of [primary, contextToolbarRef.current, toolbar.querySelector<HTMLElement>('.overlay-toolbar-inspector-actions')]) {
        if (!rovingToolbar) continue;
        const buttons = toolbarButtons(rovingToolbar);
        if (buttons.length && buttons.filter((button) => button.tabIndex === 0).length !== 1) maintainRovingToolbarFocus(rovingToolbar, buttons[0]!);
      }
    };
    initializeRoving();
    const rovingObserver = new MutationObserver(initializeRoving);
    rovingObserver.observe(toolbar, { attributeFilter: ['aria-disabled', 'disabled'], attributes: true, childList: true, subtree: true });
    return () => rovingObserver.disconnect();
  }, [inspectorOpen, selectedObjectIds.length]);

  const handleToolbarKeyDown = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (moveRovingToolbarFocus(event.currentTarget, event.key)) event.preventDefault();
  }, []);

  const handleToolbarFocus = useCallback((event: React.FocusEvent<HTMLElement>) => {
    if (event.target instanceof HTMLButtonElement) maintainRovingToolbarFocus(event.currentTarget, event.target);
  }, []);

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
    const sequence = props.nextInkPreviewSequence?.() ?? (inkSequenceRef.current += 1);
    props.onInkPreview?.({ active: true, sequence, mode: draft.mode, color: draft.mode === 'pen' ? '#2563eb' : '#f59e0b', width: draft.mode === 'pen' ? 3 : 16, opacity: draft.mode === 'pen' ? 1 : 0.32, points: simplifyInkPoints(draft.points, INK_MAX_PREVIEW_POINTS, 1) });
  }, [props.nextInkPreviewSequence, props.onInkPreview]);
  const stopInk = useCallback((commit: boolean) => {
    const draft = inkDraftRef.current;
    inkDraftRef.current = null;
    setInkDraft(null);
    publishInkPreview(null, true);
    if (!draft || !commit || draft.points.length < 2) return;
    props.onAddStroke?.(draft.points, draft.mode, { color: draft.mode === 'pen' ? '#2563eb' : '#f59e0b', width: draft.mode === 'pen' ? 3 : 16, opacity: draft.mode === 'pen' ? 1 : 0.32, compositeExport: inkCompositeExport });
  }, [inkCompositeExport, props.onAddStroke, publishInkPreview]);
  const activateInkTool = useCallback((tool: InkTool) => {
    props.onToolActivate?.();
    setInkTool(tool);
  }, [props.onToolActivate]);
  useEffect(() => { onboardingRequestCompleteRef.current = props.onOnboardingRequestComplete; }, [props.onOnboardingRequestComplete]);
  useLayoutEffect(() => {
    const requestId = pendingOnboardingPenRequestRef.current;
    if (requestId === null || inkTool !== 'pen' || completedOnboardingPenRequestIdsRef.current.has(requestId)) return;
    pendingOnboardingPenRequestRef.current = null;
    completedOnboardingPenRequestIdsRef.current.add(requestId);
    drawingSurfaceRef.current?.focus({ preventScroll: true });
    onboardingRequestCompleteRef.current?.(requestId);
  }, [inkTool]);
  useLayoutEffect(() => {
    const request = props.onboardingRequest;
    if (!request || request.action !== 'pen' || completedOnboardingPenRequestIdsRef.current.has(request.id)) return;
    pendingOnboardingPenRequestRef.current = request.id;
    if (inkTool === 'pen') {
      pendingOnboardingPenRequestRef.current = null;
      completedOnboardingPenRequestIdsRef.current.add(request.id);
      drawingSurfaceRef.current?.focus({ preventScroll: true });
      onboardingRequestCompleteRef.current?.(request.id);
      return;
    }
    activateInkTool('pen');
  }, [activateInkTool, inkTool, props.onboardingRequest]);
  useEffect(() => {
    const request = props.onboardingRequest;
    if (!request || request.action !== 'sticky') return;
    const id = addAtViewportCenter('annotation.sticky');
    onboardingRequestCompleteRef.current?.(request.id, id);
  }, [props.onboardingRequest]);
  useEffect(() => {
    const id = props.requestedTextEditId;
    if (!id || !writable || !objects.some((object) => object.id === id && object.kind.startsWith('annotation.'))) return;
    setSelectedId(id);
    setSelectedIds(new Set([id]));
    setEditingId(id);
    window.requestAnimationFrame(() => {
      const editor = canvasOwnerRef.current?.querySelector<HTMLTextAreaElement>(`[data-testid="overlay-object-${id}"] textarea`);
      editor?.focus();
    });
    props.onRequestedTextEditComplete?.(id);
  }, [objects, props.onRequestedTextEditComplete, props.requestedTextEditId, writable]);
  useEffect(() => () => { props.onInkPreview?.(null); }, [props.onInkPreview]);
  useEffect(() => { if (inkTool === 'select') stopInk(false); }, [inkTool, stopInk]);
  useEffect(() => { stopInk(false); }, [props.diagramId, stopInk]);
  useEffect(() => {
    const select = () => { stopInk(false); activateInkTool('select'); setSelectedId(null); setSelectedIds(new Set()); setEditingId(null); };
    window.addEventListener('arielcharts-overlay-select', select);
    return () => window.removeEventListener('arielcharts-overlay-select', select);
  }, [activateInkTool, stopInk]);
  useEffect(() => {
    const handleHistory = (event: Event) => {
      if (selectedIds.size === 0 && !selectedId) return;
      const action = (event as CustomEvent<'undo' | 'redo'>).detail;
      if (action !== 'undo' && action !== 'redo') return;
      event.preventDefault();
      if (action === 'undo') props.onUndo(); else props.onRedo?.();
    };
    window.addEventListener('arielcharts-overlay-history', handleHistory);
    return () => window.removeEventListener('arielcharts-overlay-history', handleHistory);
  }, [props.onRedo, props.onUndo, selectedId, selectedIds]);
  useEffect(() => {
    const clear = () => { setSelectedId(null); setSelectedIds(new Set()); setEditingId(null); };
    window.addEventListener('arielcharts-overlay-clear-selection', clear);
    return () => window.removeEventListener('arielcharts-overlay-clear-selection', clear);
  }, []);

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
  const beginResize = useCallback((event: React.PointerEvent<HTMLButtonElement>, object: OverlayObjectRecord) => {
    if (!writable || selectedLocked || object.kind === 'ink.stroke' || object.kind === 'connector.overlay' || object.kind === 'shape.line' || object.kind === 'shape.arrow') return;
    const point = pointForEvent(event as unknown as React.PointerEvent<HTMLDivElement>); if (!point) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    props.onHistoryActionBegin?.();
    resizeDraftRef.current = { id: object.id, pointerId: event.pointerId, origin: object.geometry, start: point };
  }, [pointForEvent, props.onHistoryActionBegin, selectedLocked, writable]);
  const resize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const draft = resizeDraftRef.current; if (!draft || draft.pointerId !== event.pointerId) return;
    const point = pointForEvent(event as unknown as React.PointerEvent<HTMLDivElement>); if (!point) return;
    const update = () => props.onUpdate(draft.id, { geometry: { ...draft.origin, width: Math.max(24, Math.min(4096, draft.origin.width + point.x - draft.start.x)), height: Math.max(24, Math.min(4096, draft.origin.height + point.y - draft.start.y)) } });
    if (props.onHistoryActionRun) props.onHistoryActionRun(update); else update();
  }, [pointForEvent, props]);
  const endResize = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    if (resizeDraftRef.current?.pointerId === event.pointerId) {
      resizeDraftRef.current = null;
      props.onHistoryActionEnd?.();
    }
  }, [props.onHistoryActionEnd]);
  const beginMove = useCallback((event: React.PointerEvent<HTMLDivElement>, object: OverlayObjectRecord) => {
    if (!writable || isOverlayObjectLocked(props.scene, object) || event.button !== 0 || event.target instanceof Element && event.target.closest('button, textarea, input, select, [contenteditable="true"]')) return;
    const point = pointForEvent(event); if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveDraftRef.current = { id: object.id, pointerId: event.pointerId, origin: object.geometry, start: point };
    setSelectedId(object.id); setSelectedIds(new Set([object.id]));
  }, [pointForEvent, props.scene, writable]);
  const moveObject = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const draft = moveDraftRef.current; if (!draft || draft.pointerId !== event.pointerId) return;
    const point = pointForEvent(event); if (!point) return;
    event.preventDefault();
    setDragOffset({ id: draft.id, x: point.x - draft.start.x, y: point.y - draft.start.y });
  }, [pointForEvent]);
  const endMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const draft = moveDraftRef.current; if (!draft || draft.pointerId !== event.pointerId) return;
    moveDraftRef.current = null;
    const point = pointForEvent(event);
    const offset = point ? { x: point.x - draft.start.x, y: point.y - draft.start.y } : dragOffset?.id === draft.id ? dragOffset : { x: 0, y: 0 };
    setDragOffset(null);
    if (offset.x || offset.y) props.onMove(draft.id, offset.x, offset.y);
  }, [dragOffset, pointForEvent, props]);

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
  const addAtViewportCenter = (kind: 'annotation.text' | 'annotation.sticky'): string | undefined => {
    const bounds = canvasOwnerRef.current?.getBoundingClientRect();
    const point = bounds && bounds.width > 0 && bounds.height > 0
      ? viewportCenterToWorld(bounds.width, bounds.height, props.transform, props.viewport)
      : viewportCenterToWorld(320, 240, props.transform);
    const created = props.onAdd(point, kind);
    return typeof created === 'string' ? created : undefined;
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
  const handleOverlayShortcut = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    if (target.closest('textarea, input, select, [contenteditable="true"]')) return;
    if (!event.metaKey && !event.ctrlKey && event.key.toLowerCase() === 'v') {
      event.preventDefault(); activateInkTool('select'); return;
    }
    if (!event.metaKey && !event.ctrlKey && event.key === 'Escape') {
      stopInk(false); activateInkTool('select'); setSelectedId(null); setSelectedIds(new Set()); return;
    }
    if ((!event.metaKey && !event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key !== 'z' && key !== 'y') return;
    event.preventDefault();
    if (key === 'y' || event.shiftKey) props.onRedo?.(); else props.onUndo();
  }, [activateInkTool, props, stopInk]);

  return (<>
    <div data-testid="overlay-canvas-owner" onKeyDownCapture={handleOverlayShortcut} ref={canvasOwnerRef} style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 8 }}>
      {inkTool !== 'select' ? <div
        aria-label={`${inkTool} drawing surface`}
        data-testid="ink-drawing-surface"
        onLostPointerCapture={handleInkEnd}
        onPointerCancel={handleInkEnd}
        onPointerDown={handleInkDown}
        onPointerMove={handleInkMove}
        onPointerUp={handleInkEnd}
        ref={drawingSurfaceRef}
        style={{ cursor: inkTool === 'eraser' ? 'cell' : 'crosshair', inset: 0, pointerEvents: writable ? 'auto' : 'none', position: 'absolute', touchAction: 'none', zIndex: 2 }}
        tabIndex={-1}
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
      {objects.map((object) => {
        const dragging = dragOffset?.id === object.id ? dragOffset : null;
        const screenX = object.screen_geometry.x + (dragging?.x ?? 0) * props.transform.zoom;
        const screenY = object.screen_geometry.y + (dragging?.y ?? 0) * props.transform.zoom;
        return <div
          aria-label={`${object.orphaned ? 'Orphaned ' : ''}overlay ${object.id}`}
          data-orphaned={object.orphaned || undefined}
          data-selected={selectedId === object.id || undefined}
          data-dragging={dragging ? true : undefined}
          data-testid={`overlay-object-${object.id}`}
          data-world-x={object.geometry.x}
          data-world-y={object.geometry.y}
          key={object.id}
          onClick={(event) => { event.stopPropagation(); choose(object.id, event.metaKey || event.ctrlKey); }}
          onPointerCancel={endMove}
          onPointerDown={(event) => beginMove(event, object)}
          onPointerMove={moveObject}
          onPointerUp={endMove}
          onKeyDown={(event) => {
            if (!writable || event.target instanceof HTMLTextAreaElement) return;
            const step = event.shiftKey ? 10 : 1;
            if (event.key === 'Delete' || event.key === 'Backspace') { props.onDelete(selectedObjectIds.length ? selectedObjectIds : [object.id]); event.preventDefault(); }
            else if (event.key === 'Enter' && (object.kind.startsWith('annotation.') || object.kind.startsWith('shape.'))) { setEditingId(object.id); event.preventDefault(); }
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
            border: selectedId === object.id ? '2px solid var(--selection)' : '0',
            borderRadius: object.kind === 'shape.ellipse' ? '50%' : 8,
            cursor: writable && !isOverlayObjectLocked(props.scene, object) ? dragging ? 'grabbing' : 'grab' : 'default',
            height: Math.abs(object.screen_geometry.height),
            left: Math.min(screenX, screenX + object.screen_geometry.width),
            overflow: 'hidden',
            pointerEvents: writable ? 'auto' : 'none',
            position: 'absolute',
            top: Math.min(screenY, screenY + object.screen_geometry.height),
            transform: `${object.kind === 'shape.diamond' ? 'rotate(45deg) ' : ''}rotate(${object.geometry.rotation}deg)`,
            width: Math.abs(object.screen_geometry.width),
          }}
        >
          {object.kind === 'frame.section' ? <span style={{ padding: 8 }}>{typeof object.payload.label === 'string' ? object.payload.label : 'Frame'}</span> : object.kind === 'ink.stroke' ? <span className="sr-only">{object.payload.mode === 'highlighter' ? 'Highlighter' : 'Pen'} stroke</span> : object.kind.startsWith('annotation.') || object.kind === 'shape.rectangle' || object.kind === 'shape.ellipse' || object.kind === 'shape.diamond' ? editingId === object.id ? <textarea
            aria-label={`${object.kind === 'annotation.sticky' ? 'Sticky note' : 'Free text'} contents`}
            autoFocus
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
            onBlur={() => setEditingId(null)}
            placeholder={object.kind === 'annotation.sticky' ? 'Write a sticky note' : object.kind.startsWith('shape.') ? 'Shape label' : 'Add text'}
            readOnly={!writable || object.metadata.locked === true || (props.scene.layers ?? []).find(({ id }) => id === (object.layer ?? 'default'))?.locked === true || props.scene.objects.some((frame) => frame.kind === 'frame.section' && frame.metadata.locked === true && Array.isArray(frame.payload.members) && frame.payload.members.includes(object.id))}
            style={{ background: 'transparent', border: 0, color: 'inherit', font: 'inherit', height: '100%', padding: 8, resize: 'none', width: '100%' }}
            value={compositionDrafts[object.id] ?? object.body ?? ''}
          /> : <span onDoubleClick={() => { if (writable) setEditingId(object.id); }} style={{ display: 'block', minHeight: '100%', padding: 8, whiteSpace: 'pre-wrap' }}>{object.body ?? (typeof object.payload.label === 'string' ? object.payload.label : '')}</span> : (typeof object.payload.label === 'string' ? object.payload.label : null)}
          {object.orphaned ? <span> (orphaned)<span className="sr-only"> from Mermaid target</span></span> : null}
          {selectedId === object.id && !selectedLocked && object.kind !== 'ink.stroke' && object.kind !== 'connector.overlay' && object.kind !== 'shape.line' && object.kind !== 'shape.arrow' ? <button
            aria-label="Resize overlay"
            className="overlay-resize-handle"
            onPointerCancel={endResize}
            onLostPointerCapture={endResize}
            onPointerDown={(event) => beginResize(event, object)}
            onPointerMove={resize}
            onPointerUp={endResize}
            title="Resize overlay"
            type="button"
          /> : null}
        </div>;
      })}
    </div>
    {typeof document !== 'undefined' ? createPortal(<div data-testid="overlay-controls-owner" onKeyDownCapture={handleOverlayShortcut} ref={controlsOwnerRef} style={{ inset: 0, pointerEvents: 'none', position: 'fixed', zIndex: 31 }}>
      <div aria-label="Overlay scene controls" className="overlay-icon-toolbar" data-overlay-diagram-id={props.diagramId} ref={toolbarRef} style={{ '--overlay-toolbar-available-height': `${toolbarPosition.availableHeight}px`, '--overlay-toolbar-available-width': `${toolbarPosition.availableWidth}px`, '--overlay-toolbar-inspector-max-height': `${toolbarPosition.inspectorMaxHeight}px`, left: toolbarPosition.left, position: 'fixed', top: toolbarPosition.top } as React.CSSProperties}>
        <div aria-label="Overlay canvas toolbar" className="overlay-toolbar-primary" data-testid="overlay-toolbar-primary" onFocusCapture={handleToolbarFocus} onKeyDown={handleToolbarKeyDown} ref={primaryToolbarRef} role="toolbar">
          <ToolbarIconButton disabled={!writable} label="Select overlay tool" onClick={() => activateInkTool('select')} pressed={inkTool === 'select'}><MousePointer2 size={18} /></ToolbarIconButton>
          <ToolbarDivider />
          <ToolbarIconButton disabled={!writable} label="Text" onClick={() => addAtViewportCenter('annotation.text')}><Plus size={18} /></ToolbarIconButton>
          <ToolbarIconButton disabled={!writable} label="Sticky note" onClick={() => addAtViewportCenter('annotation.sticky')}><StickyNote size={18} /></ToolbarIconButton>
          <ToolbarIconButton disabled={!writable} label="Rectangle" onClick={() => addShapeAtViewportCenter('shape.rectangle')}><RectangleHorizontal size={18} /></ToolbarIconButton>
          <ToolbarIconButton disabled={!writable} label="Ellipse" onClick={() => addShapeAtViewportCenter('shape.ellipse')}><Circle size={18} /></ToolbarIconButton>
          <ToolbarIconButton disabled={!writable} label="Diamond" onClick={() => addShapeAtViewportCenter('shape.diamond')}><Diamond size={18} /></ToolbarIconButton>
          <ToolbarIconButton disabled={!writable} label="Line" onClick={() => addShapeAtViewportCenter('shape.line')}><LineChart size={18} /></ToolbarIconButton>
          <ToolbarIconButton disabled={!writable} label="Arrow" onClick={() => addShapeAtViewportCenter('shape.arrow')}><ArrowRight size={18} /></ToolbarIconButton>
          <ToolbarDivider />
          <ToolbarIconButton disabled={!writable} label="Pen" onClick={() => activateInkTool(inkTool === 'pen' ? 'select' : 'pen')} pressed={inkTool === 'pen'}><PenLine size={18} /></ToolbarIconButton>
          <ToolbarIconButton disabled={!writable} label="Highlighter" onClick={() => activateInkTool(inkTool === 'highlighter' ? 'select' : 'highlighter')} pressed={inkTool === 'highlighter'}><Highlighter size={18} /></ToolbarIconButton>
          <ToolbarIconButton disabled={!writable} label="Erase stroke" onClick={() => activateInkTool(inkTool === 'eraser' ? 'select' : 'eraser')} pressed={inkTool === 'eraser'}><Eraser size={18} /></ToolbarIconButton>
          <ToolbarDivider />
          <ToolbarIconButton disabled={!writable} label="Undo overlay" onClick={props.onUndo}><Undo2 size={18} /></ToolbarIconButton>
          <ToolbarIconButton disabled={!writable} label="Redo overlay" onClick={() => props.onRedo?.()}><Redo2 size={18} /></ToolbarIconButton>
          <ToolbarDivider />
          <ToolbarIconButton controls={inspectorId} expanded={inspectorOpen} label="Objects and layers" onClick={() => setInspectorOpen((open) => !open)} pressed={inspectorOpen}><Layers3 size={18} /></ToolbarIconButton>
        </div>
        {selectedObjectIds.length > 0 && !inspectorOpen ? <div aria-label="Selected overlay actions" className="overlay-toolbar-context" data-testid="overlay-toolbar-context" onFocusCapture={handleToolbarFocus} onKeyDown={handleToolbarKeyDown} ref={contextToolbarRef} role="toolbar">
              {selectedObjectIds.length === 2 ? <ToolbarIconButton disabled={!writable} label="Connect selection" onClick={() => props.onAddConnector?.(selectedObjectIds[0]!, selectedObjectIds[1]!)}><SquareDashedMousePointer size={18} /></ToolbarIconButton> : null}
              <ToolbarIconButton disabled={!writable} label="Frame selection" onClick={() => { const bounds = canvasOwnerRef.current?.getBoundingClientRect(); const point = bounds ? viewportCenterToWorld(bounds.width, bounds.height, props.transform, props.viewport) : { x: 0, y: 0 }; props.onAddFrame?.(point, selectedObjectIds); }}><Frame size={18} /></ToolbarIconButton>
              {selected ? <>
                {!selectedLocked ? <>
                <ToolbarIconButton disabled={!writable} label="Move right" onClick={() => selectedObjectIds.length > 1 ? props.onMoveMany?.(selectedObjectIds, 16, 0) : props.onMove(selected.id, 16, 0)}><MoveRight size={18} /></ToolbarIconButton>
                <ToolbarIconButton disabled={!writable} label="Bring front" onClick={() => props.onReorder(selected.id, 'front')}><BringToFront size={18} /></ToolbarIconButton>
                <ToolbarIconButton disabled={!writable} label="Bring forward" onClick={() => props.onReorder(selected.id, 'forward')}><ArrowUpToLine size={18} /></ToolbarIconButton>
                <ToolbarIconButton disabled={!writable} label="Send back" onClick={() => props.onReorder(selected.id, 'back')}><SendToBack size={18} /></ToolbarIconButton>
                <ToolbarIconButton disabled={!writable} label="Send backward" onClick={() => props.onReorder(selected.id, 'backward')}><ArrowDownToLine size={18} /></ToolbarIconButton>
                <ToolbarIconButton disabled={!writable} label="Copy overlay" onClick={() => props.onCopy([selected.id])}><Copy size={18} /></ToolbarIconButton>
                <ToolbarIconButton disabled={!writable} label="Duplicate" onClick={() => props.onDuplicate(selected.id)}><CopyPlus size={18} /></ToolbarIconButton>
                <ToolbarIconButton disabled={!writable} label="Delete overlay" onClick={() => { props.onDelete([selected.id]); setSelectedId(null); }}><Trash2 size={18} /></ToolbarIconButton>
                {selected.kind !== 'ink.stroke' && selected.kind !== 'connector.overlay' ? <ToolbarIconButton disabled={!writable} label="Rotate 15°" onClick={() => props.onUpdate(selected.id, { geometry: { ...selected.geometry, rotation: (selected.geometry.rotation + 15) % 360 } })}><RotateCw size={18} /></ToolbarIconButton> : null}
                {selected.kind !== 'ink.stroke' && selected.kind !== 'connector.overlay' ? <ToolbarIconButton disabled={!writable} label="Resize larger" onClick={() => props.onUpdate(selected.id, { geometry: { ...selected.geometry, width: selected.geometry.width + 24, height: selected.geometry.height + 16 } })}><RectangleHorizontal size={18} /></ToolbarIconButton> : null}
                {props.semanticAnchors.size > 0 ? <ToolbarIconButton disabled={!writable} label="Anchor first node" onClick={() => { const mermaidId = props.semanticAnchors.keys().next().value as string | undefined; if (mermaidId) props.onAnchor(selected.id, mermaidId); }}><Anchor size={18} /></ToolbarIconButton> : null}
                {selectedObjectIds.length >= 2 ? <><ToolbarIconButton disabled={!writable} label="Align left" onClick={() => props.onAlign?.(selectedObjectIds, 'left')}><AlignLeft size={18} /></ToolbarIconButton><ToolbarIconButton disabled={!writable} label="Align top" onClick={() => props.onAlign?.(selectedObjectIds, 'top')}><AlignStartVertical size={18} /></ToolbarIconButton></> : null}
                {selectedObjectIds.length >= 3 ? <ToolbarIconButton disabled={!writable} label="Distribute horizontal" onClick={() => props.onDistribute?.(selectedObjectIds, 'horizontal')}><BetweenHorizontalStart size={18} /></ToolbarIconButton> : null}
                {selected.kind === 'annotation.sticky' ? <ToolbarIconButton disabled={!writable} label="Change note color" onClick={() => props.onUpdate(selected.id, { style: { ...selected.style, color: selected.style.color === '#bfdbfe' ? '#fef3a6' : '#bfdbfe' } })}><StickyNote size={18} /></ToolbarIconButton> : null}
                </> : null}
                {selected.kind === 'frame.section' ? <><ToolbarIconButton disabled={!writable} label={selected.metadata.hidden === true ? 'Show frame members' : 'Hide frame members'} onClick={() => props.onUpdate(selected.id, { metadata: { ...selected.metadata, hidden: selected.metadata.hidden !== true } })}>{selected.metadata.hidden === true ? <Eye size={18} /> : <EyeOff size={18} />}</ToolbarIconButton><ToolbarIconButton disabled={!writable} label={selected.metadata.locked === true ? 'Unlock frame' : 'Lock frame'} onClick={() => props.onUpdate(selected.id, { metadata: { ...selected.metadata, locked: selected.metadata.locked !== true } })}>{selected.metadata.locked === true ? <Unlock size={18} /> : <Lock size={18} />}</ToolbarIconButton>{!selectedLocked ? <ToolbarIconButton disabled={!writable} label={selected.payload.composite_members === false ? 'Include frame members in composite export' : 'Exclude frame members from composite export'} onClick={() => props.onUpdate(selected.id, { payload: { ...selected.payload, composite_members: selected.payload.composite_members !== true } })}><Layers3 size={18} /></ToolbarIconButton> : null}</> : null}
              </> : null}
        </div> : null}
        {inspectorOpen ? <aside aria-label="Overlay objects and layers" className="overlay-toolbar-inspector" id={inspectorId}>
          <p className="overlay-toolbar-description">Canvas-only overlays · not included in Mermaid source</p>
          <div aria-label="Overlay inspector actions" className="overlay-toolbar-inspector-actions" onFocusCapture={handleToolbarFocus} onKeyDown={handleToolbarKeyDown} role="toolbar">
            <ToolbarIconButton disabled={!writable} label="Restore overlay" onClick={() => { void restorePrevious(); }}><RotateCw size={18} /></ToolbarIconButton>
            <ToolbarIconButton disabled={!writable} label="Paste overlay" onClick={props.onPaste}><ClipboardPaste size={18} /></ToolbarIconButton>
          </div>
          <aside aria-label="ArielCharts overlay list" className="overlay-scene-list">
            <span className="overlay-toolbar-section-label">Layers</span>
            {objects.length === 0 ? <p>No overlays</p> : <ul>{objects.map((object) => <li key={object.id}><button aria-current={selectedId === object.id || undefined} onClick={(event) => choose(object.id, event.metaKey || event.ctrlKey)} type="button">{object.kind === 'annotation.sticky' ? 'Sticky note' : object.kind === 'annotation.text' ? 'Text' : object.kind}: {(object.body ?? String(object.payload.label ?? '')).slice(0, 40) || 'Empty'}{object.orphaned ? ' (orphaned)' : ''}</button></li>)}</ul>}
            <label className="overlay-layer-add">New layer <input aria-label="New overlay layer name" disabled={!writable} onChange={(event) => setNewLayerName(event.target.value)} value={newLayerName} /><ToolbarIconButton disabled={!writable || !newLayerName.trim()} label="Add layer" onClick={() => props.onAddLayer?.(newLayerName)}><Plus size={18} /></ToolbarIconButton></label>
            {selectedObjectIds.length > 0 ? <label>Assign selection to <select aria-label="Assign selected overlays to layer" disabled={!writable || selectedLocked} onChange={(event) => { if (event.target.value) props.onAssignLayer?.(selectedObjectIds, event.target.value); }} value=""><option value="">Choose layer</option>{(props.scene.layers ?? []).map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label> : null}
            <ul>{(props.scene.layers ?? []).map((layer) => <li key={layer.id}><span>{layer.name}</span><ToolbarIconButton disabled={!writable} label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name} layer`} onClick={() => props.onUpdateLayer?.(layer.id, { visible: !layer.visible })} pressed={layer.visible}>{layer.visible ? <Eye size={18} /> : <EyeOff size={18} />}</ToolbarIconButton><ToolbarIconButton disabled={!writable} label={`${layer.locked ? 'Unlock' : 'Lock'} ${layer.name} layer`} onClick={() => props.onUpdateLayer?.(layer.id, { locked: !layer.locked })} pressed={layer.locked}>{layer.locked ? <Lock size={18} /> : <Unlock size={18} />}</ToolbarIconButton><ToolbarIconButton disabled={!writable} label={`${layer.export ? 'Exclude' : 'Include'} ${layer.name} layer from composite export`} onClick={() => props.onUpdateLayer?.(layer.id, { export: !layer.export })} pressed={layer.export}><Layers3 size={18} /></ToolbarIconButton><ToolbarIconButton disabled={!writable} label={`Bring ${layer.name} layer front`} onClick={() => props.onReorderLayer?.(layer.id, 'front')}><ArrowUpToLine size={18} /></ToolbarIconButton><ToolbarIconButton disabled={!writable} label={`Send ${layer.name} layer back`} onClick={() => props.onReorderLayer?.(layer.id, 'back')}><ArrowDownToLine size={18} /></ToolbarIconButton></li>)}</ul>
          </aside>
          <label className="overlay-toolbar-checkbox"><input checked={inkCompositeExport} disabled={!writable} onChange={(event) => setInkCompositeExport(event.target.checked)} type="checkbox" /> Include ink in composite export</label>
          {props.scene.version !== 1 ? <span role="status">newer overlay scene is read-only</span> : null}
          {historyStatus ? <span role="status">{historyStatus}</span> : null}
        </aside> : null}
      </div>
    </div>, document.body) : null}
  </>);
}
