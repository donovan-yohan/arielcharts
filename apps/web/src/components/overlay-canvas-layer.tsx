'use client';

import type { CanvasInkPreviewState, OverlayGeometry, OverlayLayerRecord, OverlayObjectRecord, OverlaySceneSnapshot, OverlayWorldPoint } from '@arielcharts/shared';
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
  Hand,
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
  SquarePlus,
  StickyNote,
  Type,
  Crosshair,
  ChevronDown,
  SendToBack,
  Trash2,
  Unlock,
  Undo2,
} from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { listOverlayHistory, readCurrentOverlayScene, restoreOverlayRevision } from '../lib/overlay-history-api';
import { adaptOverlaySceneToViewport, effectiveOverlayGeometry, isOverlayObjectLocked, type OverlayRenderObject, type OverlayTextComposition, type OverlayTransformCommitResult, type OverlayViewportTransform } from '../lib/overlay-scene';
import { INK_MAX_PREVIEW_POINTS, INK_PREVIEW_INTERVAL_MS, simplifyInkPoints, type InkMode, type InkPoint } from '../lib/freehand-ink';
import { getCanvasToolCursor, getCanvasToolShortcut, getCanvasToolShortcutLabel, isOverlayPointerTool, type CanvasTool } from '../lib/canvas-interaction-state';
import {
  beginOverlayTransformDraft,
  overlayGeometryEqual,
  resizeOverlayDraft,
  resizeOverlayLineDraft,
  rotateOverlayDraft,
  type OverlayLineEndpoint,
  type OverlayResizeHandle,
  type OverlayTransformDraft,
} from '../lib/overlay-transform';

export interface OverlayCanvasLayerProps {
  diagramId: string;
  sessionId: string;
  scene: OverlaySceneSnapshot;
  transform: OverlayViewportTransform;
  viewport?: { x: number; y: number; width: number; height: number };
  /** Synchronous DiagramCanvas reserve for its visible bottom controls rail. */
  controlsSafeBottom?: number;
  semanticAnchors: ReadonlyMap<string, OverlayWorldPoint>;
  readOnly: boolean;
  onAdd: (point: OverlayWorldPoint, kind?: 'annotation.text' | 'annotation.sticky') => unknown;
  onAddShape?: (point: OverlayWorldPoint, kind: 'shape.rectangle' | 'shape.ellipse' | 'shape.diamond' | 'shape.line' | 'shape.arrow') => void;
  onAddConnector?: (startId: string, endId: string) => void;
  onAddMermaidNode?: () => void;
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
  onTransform?: (id: string, expected: OverlayGeometry, geometry: OverlayGeometry) => OverlayTransformCommitResult;
  onEditText: (id: string, index: number, deleteCount: number, insert: string) => void;
  onDuplicate: (id: string) => string | null;
  onDuplicateMany?: (ids: readonly string[]) => string[];
  onFitSelection?: (bounds: OverlayGeometry | null) => void;
  onBeginComposition: (id: string) => OverlayTextComposition | null;
  onCommitComposition: (id: string, composition: OverlayTextComposition, draft: string) => void;
  onAddStroke?: (points: readonly InkPoint[], mode: InkMode, style: { color: string; width: number; opacity: number; compositeExport: boolean }) => void;
  /** Controlled by SessionWorkspace with Mermaid tools; never bridge modes through window events. */
  tool?: CanvasTool;
  /** Temporary Space-held camera ownership from DiagramCanvas. */
  spacePanning?: boolean;
  /** DiagramCanvas capability projection; Connect only exists for editable flowcharts. */
  canConnectMermaidNodes?: boolean;
  onToolChange?: (tool: CanvasTool) => void;
  onInkPreview?: (preview: CanvasInkPreviewState | null) => void;
  nextInkPreviewSequence?: () => number;
  remoteInkPreviews?: readonly { id: string; color: string; preview: CanvasInkPreviewState }[];
  onboardingRequest?: { id: number; action: 'sticky' | 'pen' } | null;
  onOnboardingRequestComplete?: (requestId: number, createdTextId?: string) => void;
  requestedTextEditId?: string | null;
  onRequestedTextEditComplete?: (id: string) => void;
}

type InkDraft = { mode: InkMode; pointerId: number; points: InkPoint[] };
type MoveDraft = { id: string; pointerId: number; origin: { x: number; y: number; width: number; height: number; rotation: number }; start: InkPoint };
type DirectToolbarDrag = { button: HTMLButtonElement; pointerId: number; startScrollLeft: number; startX: number; moved: boolean };
type DirectToolbarClickSuppression = { button: HTMLButtonElement; pointerId: number };
type TransformDraft = {
  draft: OverlayTransformDraft;
  expectedGeometry: OverlayGeometry;
  pointerId: number;
  target: OverlayResizeHandle | OverlayLineEndpoint | 'rotate';
  geometry: OverlayGeometry;
  centerScreen?: OverlayWorldPoint;
};
type InkTool = 'select' | InkMode | 'eraser';

const BOX_TRANSFORM_HANDLES: readonly OverlayResizeHandle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];
const BOX_TRANSFORM_KINDS = new Set<OverlayObjectRecord['kind']>(['annotation.text', 'annotation.sticky', 'shape.rectangle', 'shape.ellipse', 'shape.diamond', 'frame.section']);
const LINE_TRANSFORM_KINDS = new Set<OverlayObjectRecord['kind']>(['shape.line', 'shape.arrow']);
export const OVERLAY_TOOLBAR_PILL_BORDER = 1;
export const OVERLAY_TOOLBAR_AVAILABLE_HEIGHT_BOTTOM_INSET = 8;
export const OVERLAY_TOOLBAR_PRIMARY_ROW_HEIGHT = 52;
export const OVERLAY_TOOLBAR_ANNOTATE_ACTIONS_HEIGHT = 54;
export const OVERLAY_TOOLBAR_SECONDARY_ACTIONS_HEIGHT = 54;
export const OVERLAY_TOOLBAR_STACKED_INNER_GAP = 0;
export const OVERLAY_TOOLBAR_COLLAPSED_PILL_HEIGHT = OVERLAY_TOOLBAR_PRIMARY_ROW_HEIGHT + (OVERLAY_TOOLBAR_PILL_BORDER * 2);
export const OVERLAY_TOOLBAR_SHORT_LANDSCAPE_PRIMARY_ROW_HEIGHT = 54;
export const OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_CSS_TOP = 62;
export const OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_TOP_OFFSET = OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_CSS_TOP
  - OVERLAY_TOOLBAR_SHORT_LANDSCAPE_PRIMARY_ROW_HEIGHT;
const OVERLAY_TOOLBAR_STACKED_ROWS_BELOW_PRIMARY = OVERLAY_TOOLBAR_STACKED_INNER_GAP + OVERLAY_TOOLBAR_ANNOTATE_ACTIONS_HEIGHT
  + OVERLAY_TOOLBAR_STACKED_INNER_GAP + OVERLAY_TOOLBAR_SECONDARY_ACTIONS_HEIGHT;
export const OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_TOP_FROM_PILL = OVERLAY_TOOLBAR_PILL_BORDER
  + OVERLAY_TOOLBAR_SHORT_LANDSCAPE_PRIMARY_ROW_HEIGHT + OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_TOP_OFFSET;
export const OVERLAY_TOOLBAR_STACKED_INSPECTOR_TOP_FROM_PILL = OVERLAY_TOOLBAR_PILL_BORDER
  + OVERLAY_TOOLBAR_PRIMARY_ROW_HEIGHT + OVERLAY_TOOLBAR_STACKED_ROWS_BELOW_PRIMARY;

/**
 * Caps a stale measured inspector immediately when DiagramCanvas has already
 * rendered a new bottom-controls reserve. `availableHeight` is published from
 * the pill top and already drops the bottom inset, so the reserve above the
 * inspector is its offset inside the pill minus that inset.
 */
export function getImmediateOverlayInspectorCap(
  availableHeight: number,
  controlsSafeBottom: number,
  shortLandscape: boolean,
): number | null {
  if (!Number.isFinite(controlsSafeBottom) || controlsSafeBottom <= 0) return null;
  const inspectorTopFromPill = shortLandscape
    ? OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_TOP_FROM_PILL
    : OVERLAY_TOOLBAR_STACKED_INSPECTOR_TOP_FROM_PILL;
  const fixedHeight = inspectorTopFromPill - OVERLAY_TOOLBAR_AVAILABLE_HEIGHT_BOTTOM_INSET;
  return Math.max(0, Math.floor(Math.max(0, availableHeight) - controlsSafeBottom - fixedHeight) - 1);
}

type ToolbarIconButtonProps = {
  children: React.ReactNode;
  className?: string;
  controls?: string;
  disabled?: boolean;
  expanded?: boolean;
  label: string;
  shortcut?: string;
  onClick: () => void;
  pressed?: boolean;
  testId?: string;
};

export function getPlatformShortcutTitle(label: string, shortcut?: string): string {
  if (!shortcut) return label;
  const mod = getPlatformModifierLabel();
  return `${label} — ${shortcut.replace('Mod', mod)}`;
}

export function getPlatformModifierLabel(): '⌘' | 'Ctrl' {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/u.test(navigator.platform) ? '⌘' : 'Ctrl';
}

function ToolbarIconButton({ children, className, controls, disabled, expanded, label, onClick, pressed, shortcut, testId }: ToolbarIconButtonProps) {
  return <button aria-controls={controls} aria-expanded={expanded} aria-label={label} aria-pressed={pressed} className={`overlay-toolbar-button${className ? ` ${className}` : ''}`} data-testid={testId} disabled={disabled} onClick={onClick} title={getPlatformShortcutTitle(label, shortcut)} type="button">
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

export function resolveOverlayInspectorSafeBottomTop(
  canvas: Pick<DOMRect, 'bottom' | 'top'>,
  publishedControlsSafeBottom: string,
  controls: { bottom: number; display: string; top: number; visibility: string } | null,
  gap = 8,
): number {
  const published = Number.parseFloat(publishedControlsSafeBottom);
  if (Number.isFinite(published) && published > 0) return canvas.bottom - published;
  if (controls && controls.display !== 'none' && controls.visibility !== 'hidden'
    && controls.bottom > canvas.top && controls.top < canvas.bottom) return controls.top - gap;
  return canvas.bottom - gap;
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
  // The workspace always controls this value. The default keeps isolated
  // renderer tests and historical embeds safely in selection mode.
  const tool = props.tool ?? 'select';
  const spacePanning = props.spacePanning === true;
  const canConnectMermaidNodes = props.canConnectMermaidNodes ?? true;
  const onToolChange = props.onToolChange ?? (() => undefined);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectedIdsRef = useRef<Set<string>>(new Set());
  const pointerSelectedObjectRef = useRef<string | null>(null);
  const replaceSelection = useCallback((ids: Iterable<string>, preferredId?: string | null) => {
    const next = new Set(ids);
    selectedIdsRef.current = next;
    setSelectedIds(next);
    setSelectedId(preferredId && next.has(preferredId) ? preferredId : [...next].at(-1) ?? null);
  }, []);
  const choose = useCallback((id: string, extend: boolean) => {
    const next = new Set(selectedIdsRef.current);
    if (!extend) next.clear();
    if (extend && next.has(id)) next.delete(id); else next.add(id);
    replaceSelection(next, next.has(id) ? id : null);
  }, [replaceSelection]);
  const [newLayerName, setNewLayerName] = useState('Layer');
  const [toolsExpanded, setToolsExpanded] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [historyStatus, setHistoryStatus] = useState('');
  const [compositionDrafts, setCompositionDrafts] = useState<Record<string, string>>({});
  const [compositions, setCompositions] = useState<Record<string, OverlayTextComposition>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const inkTool: InkTool = tool === 'pen' || tool === 'highlighter' || tool === 'eraser' ? tool : 'select';
  const [inkCompositeExport, setInkCompositeExport] = useState(true);
  const [inkDraft, setInkDraft] = useState<InkDraft | null>(null);
  const [dragOffset, setDragOffset] = useState<{ id: string; x: number; y: number } | null>(null);
  const [transformPreview, setTransformPreview] = useState<{ id: string; geometry: OverlayGeometry } | null>(null);
  const [transformStatus, setTransformStatus] = useState('');
  const [toolbarPosition, setToolbarPosition] = useState({ availableHeight: 0, availableWidth: 0, inspectorMaxHeight: 0, left: 0, top: 12 });
  const shortLandscape = typeof window !== 'undefined'
    && window.matchMedia('(min-width: 421px) and (max-height: 500px)').matches;
  const immediateInspectorCap = getImmediateOverlayInspectorCap(
    toolbarPosition.availableHeight,
    props.controlsSafeBottom ?? 0,
    shortLandscape,
  );
  const inspectorMaxHeight = immediateInspectorCap !== null
    ? Math.min(toolbarPosition.inspectorMaxHeight, immediateInspectorCap)
    : toolbarPosition.inspectorMaxHeight;
  const transformDraftRef = useRef<TransformDraft | null>(null);
  const moveDraftRef = useRef<MoveDraft | null>(null);
  const canvasOwnerRef = useRef<HTMLDivElement>(null);
  const controlsOwnerRef = useRef<HTMLDivElement>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const primaryToolbarRef = useRef<HTMLDivElement>(null);
  const annotateToolbarRef = useRef<HTMLDivElement>(null);
  const secondaryToolbarRef = useRef<HTMLDivElement>(null);
  const contextToolbarRef = useRef<HTMLDivElement>(null);
  const inkDraftRef = useRef<InkDraft | null>(null);
  const drawingSurfaceRef = useRef<HTMLDivElement | null>(null);
  const onboardingRequestCompleteRef = useRef(props.onOnboardingRequestComplete);
  const pendingOnboardingPenRequestRef = useRef<number | null>(null);
  const completedOnboardingPenRequestIdsRef = useRef(new Set<number>());
  const inkSequenceRef = useRef(0);
  const lastInkPreviewAtRef = useRef(0);
  const directToolbarDragRef = useRef<DirectToolbarDrag | null>(null);
  const suppressDirectToolbarClickRef = useRef<DirectToolbarClickSuppression | null>(null);
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
  const selectableObjectIds = useMemo(() => {
    const hiddenMembers = new Set(props.scene.objects.filter((item) => item.kind === 'frame.section' && item.metadata.hidden === true)
      .flatMap((frame) => Array.isArray(frame.payload.members) ? frame.payload.members.filter((member): member is string => typeof member === 'string') : []));
    return props.scene.objects
      .filter((object) => !hiddenMembers.has(object.id) || object.kind === 'frame.section')
      .filter((object) => (props.scene.layers ?? []).find((layer) => layer.id === (object.layer ?? 'default'))?.visible ?? true)
      .filter((object) => !isOverlayObjectLocked(props.scene, object))
      .map(({ id }) => id);
  }, [props.scene]);
  const selectedLocked = selected ? selected.metadata.locked === true || (props.scene.layers ?? []).find(({ id }) => id === (selected.layer ?? 'default'))?.locked === true
    || props.scene.objects.some((frame) => frame.kind === 'frame.section' && frame.metadata.locked === true && Array.isArray(frame.payload.members) && frame.payload.members.includes(selected.id)) : false;
  const writable = !props.readOnly && props.scene.version === 1;
  const geometryForRender = useCallback((object: OverlayRenderObject) => transformPreview?.id === object.id ? transformPreview.geometry : effectiveOverlayGeometry(object), [transformPreview]);
  const screenGeometryForRender = useCallback((object: OverlayRenderObject) => {
    const geometry = geometryForRender(object);
    // Anchored objects have a rendered origin distinct from geometry.x/y. A
    // local draft therefore starts at the adapted origin and applies only its
    // world-space delta, retaining that anchor until one committed transform.
    const isPreview = transformPreview?.id === object.id;
    return {
      x: isPreview ? object.screen_geometry.x + ((geometry.x - object.geometry.x) * props.transform.zoom) : object.screen_geometry.x,
      y: isPreview ? object.screen_geometry.y + ((geometry.y - object.geometry.y) * props.transform.zoom) : object.screen_geometry.y,
      width: geometry.width * props.transform.zoom,
      height: geometry.height * props.transform.zoom,
      rotation: geometry.rotation,
    };
  }, [geometryForRender, props.transform.zoom, transformPreview]);
  const inspectorId = `overlay-inspector-${props.diagramId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
  const secondaryToolsId = `overlay-toolbar-secondary-${props.diagramId.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
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
      const errorOverlapsTop = errorBounds && defaultTop < errorBounds.bottom
        && defaultTop + OVERLAY_TOOLBAR_COLLAPSED_PILL_HEIGHT > errorBounds.top;
      const top = errorOverlapsTop ? errorBounds.bottom + 8 : defaultTop;
      const left = canvasBounds.left + viewportX + (viewportWidth / 2);
      const primaryHeight = primaryToolbarRef.current?.getBoundingClientRect().height || OVERLAY_TOOLBAR_PRIMARY_ROW_HEIGHT;
      const contextHeight = contextToolbarRef.current?.getBoundingClientRect().height ?? 0;
      const hostControlsSafeBottom = canvasStyleHost
        ? getComputedStyle(canvasStyleHost).getPropertyValue('--canvas-controls-toolbar-safe-bottom').trim()
        : '';
      const canvasControlsSafeBottom = getComputedStyle(canvas).getPropertyValue('--canvas-controls-toolbar-safe-bottom').trim();
      const publishedControlsSafeBottom = hostControlsSafeBottom || canvasControlsSafeBottom;
      const fallbackControls = canvas.querySelector<HTMLElement>('[data-testid="canvas-controls-toolbar"]');
      const fallbackControlsBounds = fallbackControls?.getBoundingClientRect();
      const fallbackControlsStyle = fallbackControls ? getComputedStyle(fallbackControls) : null;
      const bottomSafeTop = resolveOverlayInspectorSafeBottomTop(
        canvasBounds,
        publishedControlsSafeBottom,
        fallbackControlsBounds && fallbackControlsStyle ? {
          bottom: fallbackControlsBounds.bottom,
          display: fallbackControlsStyle.display,
          top: fallbackControlsBounds.top,
          visibility: fallbackControlsStyle.visibility,
        } : null,
      );
      const shortLandscape = window.matchMedia('(min-width: 421px) and (max-height: 500px)').matches;
      const stackedRowsAboveInspector = OVERLAY_TOOLBAR_STACKED_ROWS_BELOW_PRIMARY
        + (contextHeight ? OVERLAY_TOOLBAR_STACKED_INNER_GAP + contextHeight : 0);
      const inspectorTop = top + OVERLAY_TOOLBAR_PILL_BORDER + primaryHeight
        + (shortLandscape ? OVERLAY_TOOLBAR_SHORT_LANDSCAPE_INSPECTOR_TOP_OFFSET : stackedRowsAboveInspector);
      const inspectorMaxHeight = inspectorCapacityPx(inspectorTop, bottomSafeTop);
      const availableHeight = Math.max(0, canvasBounds.bottom - top - OVERLAY_TOOLBAR_AVAILABLE_HEIGHT_BOTTOM_INSET);
      setToolbarPosition((current) => current.availableHeight === availableHeight
        && current.availableWidth === viewportWidth && current.inspectorMaxHeight === inspectorMaxHeight
        && current.left === left && current.top === top
        ? current
        : {
          availableHeight,
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
    const canvasMutationObserver = new MutationObserver((records) => {
      if (records.some((record) => record.type === 'childList' || record.target === canvas
        || record.target instanceof HTMLElement && record.target.matches('[data-testid="canvas-controls-toolbar"]'))) update();
    });
    canvasMutationObserver.observe(canvas, { attributes: true, attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'], childList: true, subtree: true });
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
      for (const rovingToolbar of [primary, annotateToolbarRef.current, secondaryToolbarRef.current, contextToolbarRef.current, toolbar.querySelector<HTMLElement>('.overlay-toolbar-inspector-actions')]) {
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

  const handleDirectToolbarPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.overlay-toolbar-button') : null;
    if (event.pointerType !== 'touch' || event.button !== 0 || !button) return;
    suppressDirectToolbarClickRef.current = null;
    directToolbarDragRef.current = {
      button,
      moved: false,
      pointerId: event.pointerId,
      startScrollLeft: event.currentTarget.scrollLeft,
      startX: event.clientX,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }, []);

  const handleDirectToolbarPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = directToolbarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const distance = drag.startX - event.clientX;
    if (!drag.moved && Math.abs(distance) < 6) return;
    drag.moved = true;
    event.currentTarget.scrollLeft = Math.max(0, drag.startScrollLeft + distance);
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const finishDirectToolbarPointer = useCallback((event: React.PointerEvent<HTMLDivElement>, canceled: boolean) => {
    const drag = directToolbarDragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    directToolbarDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (!canceled && drag.moved) {
      suppressDirectToolbarClickRef.current = { button: drag.button, pointerId: drag.pointerId };
      event.preventDefault();
      event.stopPropagation();
    }
  }, []);

  const handleDirectToolbarClickCapture = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    const suppression = suppressDirectToolbarClickRef.current;
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('.overlay-toolbar-button') : null;
    const pointerId = (event.nativeEvent as MouseEvent & { pointerId?: number }).pointerId;
    if (!suppression || button !== suppression.button || pointerId !== suppression.pointerId) return;
    suppressDirectToolbarClickRef.current = null;
    event.preventDefault();
    event.stopPropagation();
  }, []);

  const directToolbarRailHandlers = useMemo(() => ({
    onClickCapture: handleDirectToolbarClickCapture,
    onLostPointerCapture: (event: React.PointerEvent<HTMLDivElement>) => finishDirectToolbarPointer(event, true),
    onPointerCancel: (event: React.PointerEvent<HTMLDivElement>) => finishDirectToolbarPointer(event, true),
    onPointerDown: handleDirectToolbarPointerDown,
    onPointerMove: handleDirectToolbarPointerMove,
    onPointerUp: (event: React.PointerEvent<HTMLDivElement>) => finishDirectToolbarPointer(event, false),
  }), [finishDirectToolbarPointer, handleDirectToolbarClickCapture, handleDirectToolbarPointerDown, handleDirectToolbarPointerMove]);

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
    drawingSurfaceRef.current?.focus({ preventScroll: true });
  }, [inkCompositeExport, props.onAddStroke, publishInkPreview]);
  const activateInkTool = useCallback((tool: InkTool) => {
    onToolChange(tool);
  }, [onToolChange]);
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
    replaceSelection([id], id);
    setEditingId(id);
    window.requestAnimationFrame(() => {
      const editor = canvasOwnerRef.current?.querySelector<HTMLTextAreaElement>(`[data-testid="overlay-object-${id}"] textarea`);
      editor?.focus();
    });
    props.onRequestedTextEditComplete?.(id);
  }, [objects, props.onRequestedTextEditComplete, props.requestedTextEditId, replaceSelection, writable]);
  useEffect(() => () => { props.onInkPreview?.(null); }, [props.onInkPreview]);
  useEffect(() => { if (inkTool === 'select') stopInk(false); }, [inkTool, stopInk]);
  useEffect(() => { stopInk(false); }, [props.diagramId, stopInk]);

  const eraseAt = useCallback((point: InkPoint) => {
    const hit = objects.find((object) => object.kind === 'ink.stroke'
      && point.x >= object.geometry.x && point.x <= object.geometry.x + object.geometry.width
      && point.y >= object.geometry.y && point.y <= object.geometry.y + object.geometry.height);
    if (hit) { props.onDelete([hit.id]); replaceSelection([]); }
  }, [objects, props, replaceSelection]);
  const handleInkDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const stylusEraser = event.pointerType === 'pen' && event.nativeEvent.button === 5;
    if (spacePanning || !writable || inkTool === 'select' || (!stylusEraser && event.button !== 0)) return;
    const point = pointForEvent(event); if (!point) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    if (inkTool === 'eraser' || stylusEraser) { eraseAt(point); return; }
    const draft: InkDraft = { mode: inkTool, pointerId: event.pointerId, points: [point] };
    inkDraftRef.current = draft; setInkDraft(draft); publishInkPreview(draft, true);
  }, [eraseAt, inkTool, pointForEvent, publishInkPreview, spacePanning, writable]);
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
  const beginTransform = useCallback((event: React.PointerEvent<HTMLButtonElement>, object: OverlayRenderObject, target: TransformDraft['target']) => {
    if (spacePanning || !writable || tool !== 'select' || selectedLocked || !props.onTransform) return;
    const startScreen = { x: event.clientX, y: event.clientY };
    if (!Number.isFinite(startScreen.x) || !Number.isFinite(startScreen.y)) return;
    const bounds = canvasOwnerRef.current?.getBoundingClientRect();
    const centerScreen = target === 'rotate' && bounds
      ? { x: bounds.left + object.screen_geometry.x + (object.screen_geometry.width / 2), y: bounds.top + object.screen_geometry.y + (object.screen_geometry.height / 2) }
      : undefined;
    if (target === 'rotate' && !centerScreen) return;
    event.preventDefault(); event.stopPropagation(); event.currentTarget.setPointerCapture(event.pointerId);
    const geometry = effectiveOverlayGeometry(object);
    const draft = beginOverlayTransformDraft(object.id, geometry, startScreen);
    transformDraftRef.current = { draft, expectedGeometry: object.geometry, pointerId: event.pointerId, target, geometry, centerScreen };
    setTransformPreview({ id: object.id, geometry });
    setTransformStatus('');
  }, [props.onTransform, selectedLocked, spacePanning, tool, writable]);
  const moveTransform = useCallback((event: React.PointerEvent<HTMLButtonElement>) => {
    const active = transformDraftRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    const currentScreen = { x: event.clientX, y: event.clientY };
    if (!Number.isFinite(currentScreen.x) || !Number.isFinite(currentScreen.y)) return;
    event.preventDefault(); event.stopPropagation();
    const geometry = active.target === 'rotate'
      ? rotateOverlayDraft(active.draft, active.centerScreen!, currentScreen, { shiftKey: event.shiftKey })
      : active.target === 'start' || active.target === 'end'
        ? resizeOverlayLineDraft(active.draft, active.target, currentScreen, props.transform.zoom)
        : resizeOverlayDraft(active.draft, active.target, currentScreen, { zoom: props.transform.zoom, shiftKey: event.shiftKey });
    active.geometry = geometry;
    setTransformPreview({ id: active.draft.id, geometry });
  }, [props.transform.zoom]);
  const endTransform = useCallback((event: React.PointerEvent<HTMLButtonElement>, commit: boolean) => {
    const active = transformDraftRef.current;
    if (!active || active.pointerId !== event.pointerId) return;
    transformDraftRef.current = null;
    setTransformPreview(null);
    if (!commit || overlayGeometryEqual(active.draft.expectedGeometry, active.geometry)) return;
    const result = props.onTransform?.(active.draft.id, active.expectedGeometry, active.geometry) ?? 'missing';
    if (result !== 'applied') setTransformStatus('Could not transform');
  }, [props.onTransform]);
  const keyboardTransform = useCallback((event: React.KeyboardEvent<HTMLButtonElement>, object: OverlayRenderObject, target: TransformDraft['target']) => {
    if (!writable || tool !== 'select' || selectedLocked || !props.onTransform) return;
    const direction = event.key === 'ArrowLeft' ? { x: -1, y: 0 } : event.key === 'ArrowRight' ? { x: 1, y: 0 } : event.key === 'ArrowUp' ? { x: 0, y: -1 } : event.key === 'ArrowDown' ? { x: 0, y: 1 } : null;
    if (!direction) return;
    event.preventDefault();
    const effectiveGeometry = effectiveOverlayGeometry(object);
    const draft = beginOverlayTransformDraft(object.id, effectiveGeometry, { x: 0, y: 0 });
    const step = event.shiftKey ? 10 : 1;
    const current = { x: direction.x * step * props.transform.zoom, y: direction.y * step * props.transform.zoom };
    const geometry = target === 'rotate'
      ? { ...effectiveGeometry, rotation: (effectiveGeometry.rotation + (direction.x || -direction.y) * (event.shiftKey ? 15 : 1) + 360) % 360 }
      : target === 'start' || target === 'end'
        ? resizeOverlayLineDraft(draft, target, current, props.transform.zoom)
        : resizeOverlayDraft(draft, target, current, { zoom: props.transform.zoom, shiftKey: event.shiftKey });
    const result = props.onTransform(object.id, object.geometry, geometry);
    if (result !== 'applied') setTransformStatus('Could not transform');
  }, [props.onTransform, props.transform.zoom, selectedLocked, tool, writable]);
  const beginMove = useCallback((event: React.PointerEvent<HTMLDivElement>, object: OverlayObjectRecord) => {
    if (spacePanning || !writable || tool !== 'select' || event.button !== 0 || event.target instanceof Element && event.target.closest('button, textarea, input, select, [contenteditable="true"]')) return;
    choose(object.id, event.shiftKey || event.metaKey || event.ctrlKey);
    pointerSelectedObjectRef.current = object.id;
    event.currentTarget.focus({ preventScroll: true });
    if (isOverlayObjectLocked(props.scene, object)) return;
    const point = pointForEvent(event); if (!point) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveDraftRef.current = { id: object.id, pointerId: event.pointerId, origin: object.geometry, start: point };
  }, [choose, pointForEvent, props.scene, spacePanning, tool, writable]);
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
  const addAtPoint = useCallback((point: InkPoint) => {
    if (!isOverlayPointerTool(tool)) return;
    if (tool === 'text' || tool === 'sticky') {
      const created = props.onAdd(point, tool === 'text' ? 'annotation.text' : 'annotation.sticky');
      if (typeof created === 'string') {
        replaceSelection([created], created);
        if (tool === 'text') setEditingId(created);
      }
      return;
    }
    const shapes: Partial<Record<CanvasTool, 'shape.rectangle' | 'shape.ellipse' | 'shape.diamond' | 'shape.line' | 'shape.arrow'>> = {
      rectangle: 'shape.rectangle', ellipse: 'shape.ellipse', diamond: 'shape.diamond', line: 'shape.line', arrow: 'shape.arrow',
    };
    const shape = shapes[tool];
    if (shape) props.onAddShape?.(point, shape);
  }, [props, replaceSelection, tool]);
  const handleOverlayPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (spacePanning || !writable || !isOverlayPointerTool(tool) || ['pen', 'highlighter', 'eraser'].includes(tool) || event.button !== 0) return;
    const point = pointForEvent(event);
    if (!point) return;
    event.preventDefault();
    event.stopPropagation();
    addAtPoint(point);
    event.currentTarget.focus({ preventScroll: true });
  }, [addAtPoint, pointForEvent, spacePanning, tool, writable]);
  const handleOverlayShortcut = useCallback((event: React.KeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || event.key === 'Process') return;
    const target = event.target as HTMLElement;
    if (target.closest('textarea, input, select, [contenteditable="true"]')) return;
    const hasModifier = event.metaKey || event.ctrlKey || event.altKey;
    if (event.shiftKey && !hasModifier && (event.code === 'Digit1' || event.code === 'Digit2')) {
      if (!props.onFitSelection) return;
      event.preventDefault(); event.stopPropagation();
      const selectedObjects = objects.filter(({ id }) => selectedObjectIds.includes(id));
      const renderedWorldGeometry = (object: OverlayRenderObject): OverlayGeometry => ({
        ...object.screen_geometry,
        x: (object.screen_geometry.x - props.transform.x) / props.transform.zoom,
        y: (object.screen_geometry.y - props.transform.y) / props.transform.zoom,
        width: object.screen_geometry.width / props.transform.zoom,
        height: object.screen_geometry.height / props.transform.zoom,
      });
      const bounds = selectedObjects.length > 0 ? selectedObjects.reduce<OverlayGeometry>((result, object) => {
        const geometry = renderedWorldGeometry(object);
        const left = Math.min(geometry.x, geometry.x + geometry.width); const top = Math.min(geometry.y, geometry.y + geometry.height);
        const right = Math.max(geometry.x, geometry.x + geometry.width); const bottom = Math.max(geometry.y, geometry.y + geometry.height);
        return { x: Math.min(result.x, left), y: Math.min(result.y, top), width: Math.max(result.x + result.width, right) - Math.min(result.x, left), height: Math.max(result.y + result.height, bottom) - Math.min(result.y, top), rotation: 0 };
      }, (() => { const first = renderedWorldGeometry(selectedObjects[0]!); return { x: Math.min(first.x, first.x + first.width), y: Math.min(first.y, first.y + first.height), width: Math.abs(first.width), height: Math.abs(first.height), rotation: 0 }; })()) : null;
      props.onFitSelection(event.code === 'Digit2' ? bounds : null);
      return;
    }
    const shortcutTool = getCanvasToolShortcut(event.key, false, hasModifier);
    if (shortcutTool) {
      if (!writable || (shortcutTool === 'connect' && !canConnectMermaidNodes)) return;
      const clearsSelection = shortcutTool === 'select' && (event.key === 'Escape' || event.key.toLowerCase() === 'v');
      if (clearsSelection) replaceSelection([]);
      // Escape must continue to DiagramCanvas and SessionWorkspace, which own
      // the broader reset and presenter-follow exit paths.
      if (event.key !== 'Escape') { event.preventDefault(); event.stopPropagation(); }
      stopInk(false);
      onToolChange(shortcutTool);
      return;
    }
    if ((!event.metaKey && !event.ctrlKey) || event.altKey) return;
    const key = event.key.toLowerCase();
    if (key === 'a' && writable) {
      event.preventDefault(); event.stopPropagation();
      replaceSelection(selectableObjectIds);
      return;
    }
    if (key === 'd' && writable && selectedObjectIds.length > 0) {
      event.preventDefault(); event.stopPropagation();
      const copies = props.onDuplicateMany?.(selectedObjectIds) ?? selectedObjectIds.map(props.onDuplicate).filter((id): id is string => id !== null);
      replaceSelection(copies);
      const copyId = copies.at(-1);
      if (copyId) window.requestAnimationFrame(() => {
        canvasOwnerRef.current?.querySelector<HTMLElement>(`[data-testid="overlay-object-${copyId}"]`)?.focus({ preventScroll: true });
      });
      return;
    }
    if (key !== 'z' && key !== 'y') return;
    event.preventDefault(); event.stopPropagation();
    if (key === 'y' || event.shiftKey) props.onRedo?.(); else props.onUndo();
  }, [activateInkTool, objects, onToolChange, props, replaceSelection, selectableObjectIds, selectedObjectIds, stopInk, tool]);
  useEffect(() => {
    if (!writable || tool !== 'select' || selectedObjectIds.length === 0) return;
    const handleCanvasOwnedShortcut = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key === 'Process') return;
      const canvas = canvasOwnerRef.current?.closest<HTMLElement>('[data-testid="diagram-canvas"]');
      if (!canvas || document.activeElement !== canvas) return;
      if (event.key === 'Escape') {
        replaceSelection([]);
        return;
      }
      if ((!event.metaKey && !event.ctrlKey) || event.altKey || event.key.toLowerCase() !== 'a') return;
      event.preventDefault();
      event.stopImmediatePropagation();
      replaceSelection(selectableObjectIds);
    };
    window.addEventListener('keydown', handleCanvasOwnedShortcut, true);
    return () => window.removeEventListener('keydown', handleCanvasOwnedShortcut, true);
  }, [replaceSelection, selectableObjectIds, selectedObjectIds.length, tool, writable]);

  return (<>
    <div data-testid="overlay-canvas-owner" onKeyDownCapture={handleOverlayShortcut} ref={canvasOwnerRef} style={{ inset: 0, pointerEvents: 'none', position: 'absolute', zIndex: 8 }}>
      {isOverlayPointerTool(tool) ? <div
        aria-label={`${tool} drawing surface`}
        data-testid="ink-drawing-surface"
        onLostPointerCapture={handleInkEnd}
        onPointerCancel={handleInkEnd}
        onPointerDown={handleInkDown}
        onPointerDownCapture={handleOverlayPointerDown}
        onPointerMove={handleInkMove}
        onPointerUp={handleInkEnd}
        ref={drawingSurfaceRef}
        style={{ cursor: getCanvasToolCursor(tool), inset: 0, pointerEvents: writable ? 'auto' : 'none', position: 'absolute', touchAction: 'none', zIndex: 2 }}
        tabIndex={-1}
      /> : null}
      <svg aria-hidden="true" data-testid="ink-overlay-renderer" style={{ height: '100%', inset: 0, overflow: 'visible', pointerEvents: 'none', position: 'absolute', width: '100%' }}>
        {objects.filter((object) => object.kind === 'ink.stroke').map((object) => {
          const points = pointsFromPayload(object.payload); const mode = object.payload.mode === 'highlighter' ? 'highlighter' : 'pen';
          return points.length > 1 ? <path data-testid={`ink-stroke-${object.id}`} d={screenInkPath(points, props.transform)} fill="none" key={object.id} opacity={Number(object.style.opacity ?? 1)} stroke={String(object.style.color ?? '#2563eb')} strokeLinecap="round" strokeLinejoin="round" strokeWidth={Number(object.style.width ?? (mode === 'pen' ? 3 : 16)) * props.transform.zoom} /> : null;
        })}
        {inkDraft && inkDraft.points.length > 1 ? <path data-testid="ink-local-draft" d={screenInkPath(inkDraft.points, props.transform)} fill="none" opacity={inkDraft.mode === 'pen' ? 1 : 0.32} stroke={inkDraft.mode === 'pen' ? '#2563eb' : '#f59e0b'} strokeLinecap="round" strokeLinejoin="round" strokeWidth={(inkDraft.mode === 'pen' ? 3 : 16) * props.transform.zoom} /> : null}
        {(props.remoteInkPreviews ?? []).flatMap(({ id, color, preview }) => preview.active && preview.points && preview.points.length > 1 ? [<path data-testid={`ink-preview-${id}`} d={screenInkPath(preview.points, props.transform)} fill="none" key={id} opacity={preview.opacity ?? 0.5} stroke={preview.color ?? color} strokeDasharray="3 3" strokeLinecap="round" strokeLinejoin="round" strokeWidth={(preview.width ?? 3) * props.transform.zoom} />] : [])}
        {objects.filter((object) => object.kind === 'connector.overlay' || object.kind === 'shape.line' || object.kind === 'shape.arrow').map((object) => {
          const geometry = screenGeometryForRender(object);
          return <line data-testid={`overlay-line-${object.id}`} key={object.id} markerEnd={object.kind === 'shape.arrow' ? 'url(#overlay-arrow)' : undefined} stroke={String(object.style.color ?? '#334155')} strokeDasharray={object.orphaned ? '6 4' : undefined} strokeWidth={Number(object.style.width ?? 2)} x1={geometry.x} x2={geometry.x + geometry.width} y1={geometry.y} y2={geometry.y + geometry.height} />;
        })}
        <defs><marker id="overlay-arrow" markerHeight="8" markerWidth="8" orient="auto" refX="7" refY="3"><path d="M0,0 L0,6 L7,3 z" fill="#334155" /></marker></defs>
      </svg>
      {objects.map((object) => {
        const dragging = dragOffset?.id === object.id ? dragOffset : null;
        const screenGeometry = screenGeometryForRender(object);
        const geometry = geometryForRender(object);
        const screenX = screenGeometry.x + (dragging?.x ?? 0) * props.transform.zoom;
        const screenY = screenGeometry.y + (dragging?.y ?? 0) * props.transform.zoom;
        return <div
          aria-label={`${object.orphaned ? 'Orphaned ' : ''}overlay ${object.id}`}
          data-orphaned={object.orphaned || undefined}
          data-selected={selectedIds.has(object.id) || undefined}
          data-dragging={dragging ? true : undefined}
          data-testid={`overlay-object-${object.id}`}
          data-world-x={object.geometry.x}
          data-world-y={object.geometry.y}
          key={object.id}
          onClick={(event) => {
            if (spacePanning || tool !== 'select') return;
            event.stopPropagation();
            const target = event.target instanceof Element ? event.target : null;
            const active = document.activeElement instanceof Element ? document.activeElement : null;
            if (target?.closest('button, textarea, input, select, [contenteditable="true"]')
              || active?.closest('button, textarea, input, select, [contenteditable="true"]')) return;
            if (pointerSelectedObjectRef.current === object.id) {
              pointerSelectedObjectRef.current = null;
              return;
            }
            choose(object.id, event.shiftKey || event.metaKey || event.ctrlKey);
            event.currentTarget.focus({ preventScroll: true });
          }}
          onPointerCancel={endMove}
          onPointerDown={(event) => beginMove(event, object)}
          onPointerMove={moveObject}
          onPointerUp={endMove}
          onKeyDown={(event) => {
            if (!writable || tool !== 'select' || event.target instanceof HTMLTextAreaElement) return;
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
          tabIndex={writable && tool === 'select' ? 0 : -1}
          style={{
            background: object.kind === 'annotation.sticky' ? String(object.style.color ?? '#fef3a6') : object.kind === 'shape.ellipse' ? 'color-mix(in srgb, #dbeafe 45%, transparent)' : object.kind === 'shape.diamond' ? 'color-mix(in srgb, #ede9fe 45%, transparent)' : object.kind === 'shape.rectangle' ? 'color-mix(in srgb, #dcfce7 45%, transparent)' : object.kind === 'frame.section' ? 'color-mix(in srgb, #e2e8f0 25%, transparent)' : object.orphaned ? 'color-mix(in srgb, var(--warning) 18%, var(--surface-raised))' : 'transparent',
            border: selectedIds.has(object.id) ? '2px solid var(--selection)' : '0',
            borderRadius: object.kind === 'shape.ellipse' ? '50%' : 8,
            cursor: writable && !isOverlayObjectLocked(props.scene, object) ? dragging ? 'grabbing' : 'grab' : 'default',
            height: Math.abs(screenGeometry.height),
            left: Math.min(screenX, screenX + screenGeometry.width),
            overflow: 'hidden',
            pointerEvents: writable && (tool === 'select' || editingId === object.id) ? 'auto' : 'none',
            position: 'absolute',
            top: Math.min(screenY, screenY + screenGeometry.height),
            transform: `rotate(${geometry.rotation}deg)`,
            width: Math.abs(screenGeometry.width),
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
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.key === 'Process') return;
              if (event.key === 'Escape') {
                event.preventDefault(); event.stopPropagation();
                setEditingId(null);
                event.currentTarget.parentElement?.focus();
              }
            }}
            placeholder={object.kind === 'annotation.sticky' ? 'Write a sticky note' : object.kind.startsWith('shape.') ? 'Shape label' : 'Add text'}
            readOnly={!writable || object.metadata.locked === true || (props.scene.layers ?? []).find(({ id }) => id === (object.layer ?? 'default'))?.locked === true || props.scene.objects.some((frame) => frame.kind === 'frame.section' && frame.metadata.locked === true && Array.isArray(frame.payload.members) && frame.payload.members.includes(object.id))}
            style={{ background: 'transparent', border: 0, color: 'inherit', font: 'inherit', height: '100%', padding: 8, resize: 'none', width: '100%' }}
            value={compositionDrafts[object.id] ?? object.body ?? ''}
          /> : <span onDoubleClick={() => { if (writable) setEditingId(object.id); }} style={{ display: 'block', minHeight: '100%', padding: 8, whiteSpace: 'pre-wrap' }}>{object.body ?? (typeof object.payload.label === 'string' ? object.payload.label : '')}</span> : (typeof object.payload.label === 'string' ? object.payload.label : null)}
          {object.orphaned ? <span> (orphaned)<span className="sr-only"> from Mermaid target</span></span> : null}
        </div>;
      })}
      {props.onTransform && tool === 'select' && selected && selectedObjectIds.length === 1 && writable && !selectedLocked && BOX_TRANSFORM_KINDS.has(selected.kind) ? (() => {
        const geometry = screenGeometryForRender(selected);
        return <div
          aria-label="Selected overlay transform controls"
          className="overlay-selection-overlay"
          data-testid="overlay-box-transform-controls"
          style={{ height: Math.abs(geometry.height), left: Math.min(geometry.x, geometry.x + geometry.width), pointerEvents: editingId === selected.id ? 'none' : undefined, top: Math.min(geometry.y, geometry.y + geometry.height), transform: `rotate(${geometry.rotation}deg)`, width: Math.abs(geometry.width) }}
        >
          {BOX_TRANSFORM_HANDLES.map((handle) => <button
            aria-label={`Resize overlay ${handle}`}
            className={`overlay-transform-handle is-${handle}`}
            data-canvas-pan-exclusion="true"
            data-testid={`overlay-resize-${handle}`}
            key={handle}
            onLostPointerCapture={(event) => endTransform(event, false)}
            onPointerCancel={(event) => endTransform(event, false)}
            onPointerDown={(event) => beginTransform(event, selected, handle)}
            onPointerMove={moveTransform}
            onPointerUp={(event) => endTransform(event, true)}
            onKeyDown={(event) => keyboardTransform(event, selected, handle)}
            title={`Resize ${handle}`}
            type="button"
          />)}
          <button
            aria-label="Rotate overlay"
            className="overlay-transform-handle overlay-rotation-handle"
            data-canvas-pan-exclusion="true"
            data-testid="overlay-rotate"
            onLostPointerCapture={(event) => endTransform(event, false)}
            onPointerCancel={(event) => endTransform(event, false)}
            onPointerDown={(event) => beginTransform(event, selected, 'rotate')}
            onPointerMove={moveTransform}
            onPointerUp={(event) => endTransform(event, true)}
            onKeyDown={(event) => keyboardTransform(event, selected, 'rotate')}
            title="Rotate overlay"
            type="button"
          />
        </div>;
      })() : null}
      {props.onTransform && tool === 'select' && selected && selectedObjectIds.length === 1 && writable && !selectedLocked && LINE_TRANSFORM_KINDS.has(selected.kind) ? (() => {
        const geometry = screenGeometryForRender(selected);
        return <div aria-label="Selected line transform controls" className="overlay-line-selection-overlay" data-testid="overlay-line-transform-controls">
          {(['start', 'end'] as const).map((endpoint) => <button
            aria-label={`Resize line ${endpoint}`}
            className={`overlay-transform-handle overlay-line-endpoint is-${endpoint}`}
            data-canvas-pan-exclusion="true"
            data-testid={`overlay-line-${endpoint}`}
            key={endpoint}
            onLostPointerCapture={(event) => endTransform(event, false)}
            onPointerCancel={(event) => endTransform(event, false)}
            onPointerDown={(event) => beginTransform(event, selected, endpoint)}
            onPointerMove={moveTransform}
            onPointerUp={(event) => endTransform(event, true)}
            onKeyDown={(event) => keyboardTransform(event, selected, endpoint)}
            style={{ left: endpoint === 'start' ? geometry.x : geometry.x + geometry.width, top: endpoint === 'start' ? geometry.y : geometry.y + geometry.height }}
            title={`Resize line ${endpoint}`}
            type="button"
          />)}
        </div>;
      })() : null}
      {transformStatus ? <span className="overlay-transform-status" data-testid="overlay-transform-status" role="status">{transformStatus}</span> : null}
    </div>
    {typeof document !== 'undefined' ? createPortal(<div data-testid="overlay-controls-owner" onKeyDownCapture={handleOverlayShortcut} ref={controlsOwnerRef} style={{ inset: 0, pointerEvents: 'none', position: 'fixed', zIndex: 31 }}>
      <div
        aria-label="Overlay scene controls"
        className="overlay-icon-toolbar"
        data-canvas-selection-preserving="true"
        data-overlay-diagram-id={props.diagramId}
        data-tools-expanded={toolsExpanded ? 'true' : 'false'}
        onClick={(event) => { event.stopPropagation(); }}
        onPointerDown={(event) => { event.stopPropagation(); }}
        ref={toolbarRef}
        style={{ '--overlay-toolbar-available-height': `${toolbarPosition.availableHeight}px`, '--overlay-toolbar-available-width': `${toolbarPosition.availableWidth}px`, '--overlay-toolbar-inspector-max-height': `${inspectorMaxHeight}px`, left: toolbarPosition.left, position: 'fixed', top: toolbarPosition.top } as React.CSSProperties}
      >
        <div aria-label="Overlay canvas toolbar" className="overlay-toolbar-primary" data-testid="overlay-toolbar-primary" onFocusCapture={handleToolbarFocus} onKeyDown={handleToolbarKeyDown} ref={primaryToolbarRef} role="toolbar">
          <div className="overlay-toolbar-primary-tools" data-testid="overlay-toolbar-primary-tools" {...directToolbarRailHandlers}>
            <ToolbarIconButton disabled={!writable} label="Select tool" onClick={() => onToolChange('select')} pressed={tool === 'select'} shortcut={getCanvasToolShortcutLabel('select')}><MousePointer2 size={18} /></ToolbarIconButton>
            <ToolbarIconButton disabled={!writable} label="Hand tool" onClick={() => onToolChange('hand')} pressed={tool === 'hand'} shortcut={getCanvasToolShortcutLabel('hand')}><Hand size={18} /></ToolbarIconButton>
            <ToolbarDivider />
            <ToolbarIconButton disabled={!writable || !canConnectMermaidNodes} label="Connect Mermaid nodes" onClick={() => onToolChange('connect')} pressed={canConnectMermaidNodes && tool === 'connect'} shortcut={getCanvasToolShortcutLabel('connect')}><SquareDashedMousePointer size={18} /></ToolbarIconButton>
            <ToolbarIconButton disabled={!writable || !canConnectMermaidNodes || !props.onAddMermaidNode} label="Add flowchart node" onClick={() => props.onAddMermaidNode?.()} shortcut="N"><SquarePlus size={18} /></ToolbarIconButton>
          </div>
          <ToolbarDivider />
          <ToolbarIconButton controls={secondaryToolsId} expanded={toolsExpanded} label={toolsExpanded ? 'Collapse more canvas tools' : 'More canvas tools'} onClick={() => setToolsExpanded((open) => !open)} pressed={toolsExpanded} testId="overlay-toolbar-more-toggle"><ChevronDown size={18} /></ToolbarIconButton>
        </div>
        <div aria-hidden={!toolsExpanded} className={`overlay-toolbar-secondary${toolsExpanded ? ' is-expanded' : ''}`} data-testid="overlay-toolbar-secondary" id={secondaryToolsId}>
          <div aria-label="Annotation and shape tools" className="overlay-toolbar-annotate-actions" data-testid="overlay-toolbar-annotate-actions" onFocusCapture={handleToolbarFocus} onKeyDown={handleToolbarKeyDown} ref={annotateToolbarRef} role="toolbar" {...directToolbarRailHandlers}>
            <ToolbarIconButton disabled={!writable} label="Text" onClick={() => onToolChange('text')} pressed={tool === 'text'} shortcut={getCanvasToolShortcutLabel('text')}><Type size={18} /></ToolbarIconButton>
            <ToolbarIconButton disabled={!writable} label="Sticky note" onClick={() => onToolChange('sticky')} pressed={tool === 'sticky'}><StickyNote size={18} /></ToolbarIconButton>
            <ToolbarIconButton disabled={!writable} label="Rectangle" onClick={() => onToolChange('rectangle')} pressed={tool === 'rectangle'} shortcut={getCanvasToolShortcutLabel('rectangle')}><RectangleHorizontal size={18} /></ToolbarIconButton>
            <ToolbarIconButton disabled={!writable} label="Ellipse" onClick={() => onToolChange('ellipse')} pressed={tool === 'ellipse'} shortcut={getCanvasToolShortcutLabel('ellipse')}><Circle size={18} /></ToolbarIconButton>
            <ToolbarIconButton disabled={!writable} label="Diamond" onClick={() => onToolChange('diamond')} pressed={tool === 'diamond'} shortcut={getCanvasToolShortcutLabel('diamond')}><Diamond size={18} /></ToolbarIconButton>
            <ToolbarIconButton disabled={!writable} label="Line" onClick={() => onToolChange('line')} pressed={tool === 'line'} shortcut={getCanvasToolShortcutLabel('line')}><LineChart size={18} /></ToolbarIconButton>
            <ToolbarIconButton disabled={!writable} label="Arrow" onClick={() => onToolChange('arrow')} pressed={tool === 'arrow'} shortcut={getCanvasToolShortcutLabel('arrow')}><ArrowRight size={18} /></ToolbarIconButton>
          </div>
          <div aria-label="Ink and history tools" className="overlay-toolbar-secondary-actions" onFocusCapture={handleToolbarFocus} onKeyDown={handleToolbarKeyDown} ref={secondaryToolbarRef} role="toolbar" {...directToolbarRailHandlers}>
            <ToolbarIconButton disabled={!writable} label="Laser pointer" onClick={() => onToolChange(tool === 'laser' ? 'select' : 'laser')} pressed={tool === 'laser'} shortcut={getCanvasToolShortcutLabel('laser')}><Crosshair size={18} /></ToolbarIconButton>
            <ToolbarIconButton disabled={!writable} label="Pen" onClick={() => onToolChange(tool === 'pen' ? 'select' : 'pen')} pressed={tool === 'pen'} shortcut={getCanvasToolShortcutLabel('pen')}><PenLine size={18} /></ToolbarIconButton>
            <ToolbarIconButton disabled={!writable} label="Highlighter" onClick={() => onToolChange(tool === 'highlighter' ? 'select' : 'highlighter')} pressed={tool === 'highlighter'}><Highlighter size={18} /></ToolbarIconButton>
            <ToolbarIconButton disabled={!writable} label="Erase stroke" onClick={() => onToolChange(tool === 'eraser' ? 'select' : 'eraser')} pressed={tool === 'eraser'} shortcut={getCanvasToolShortcutLabel('eraser')}><Eraser size={18} /></ToolbarIconButton>
            <ToolbarDivider />
            <ToolbarIconButton disabled={!writable} label="Undo canvas change" onClick={props.onUndo} shortcut="Mod+Z"><Undo2 size={18} /></ToolbarIconButton>
            <ToolbarIconButton disabled={!writable} label="Redo canvas change" onClick={() => props.onRedo?.()} shortcut="Mod+Shift+Z"><Redo2 size={18} /></ToolbarIconButton>
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
                <ToolbarIconButton disabled={!writable} label="Duplicate" onClick={() => { const copy = props.onDuplicate(selected.id); if (copy) replaceSelection([copy], copy); }}><CopyPlus size={18} /></ToolbarIconButton>
                <ToolbarIconButton disabled={!writable} label="Delete overlay" onClick={() => { props.onDelete([selected.id]); replaceSelection([]); }}><Trash2 size={18} /></ToolbarIconButton>
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
            {objects.length === 0 ? <p>No overlays</p> : <ul>{objects.map((object) => <li key={object.id}><button aria-current={selectedId === object.id || undefined} onClick={(event) => choose(object.id, event.shiftKey || event.metaKey || event.ctrlKey)} type="button">{object.kind === 'annotation.sticky' ? 'Sticky note' : object.kind === 'annotation.text' ? 'Text' : object.kind}: {(object.body ?? String(object.payload.label ?? '')).slice(0, 40) || 'Empty'}{object.orphaned ? ' (orphaned)' : ''}</button></li>)}</ul>}
            <label className="overlay-layer-add">New layer <input aria-label="New overlay layer name" disabled={!writable} onChange={(event) => setNewLayerName(event.target.value)} value={newLayerName} /><ToolbarIconButton disabled={!writable || !newLayerName.trim()} label="Add layer" onClick={() => props.onAddLayer?.(newLayerName)}><Plus size={18} /></ToolbarIconButton></label>
            {selectedObjectIds.length > 0 ? <label>Assign selection to <select aria-label="Assign selected overlays to layer" disabled={!writable || selectedLocked} onChange={(event) => { if (event.target.value) props.onAssignLayer?.(selectedObjectIds, event.target.value); }} value=""><option value="">Choose layer</option>{(props.scene.layers ?? []).map((layer) => <option key={layer.id} value={layer.id}>{layer.name}</option>)}</select></label> : null}
            <ul>{(props.scene.layers ?? []).map((layer) => <li key={layer.id}><span>{layer.name}</span><ToolbarIconButton disabled={!writable} label={`${layer.visible ? 'Hide' : 'Show'} ${layer.name} layer`} onClick={() => props.onUpdateLayer?.(layer.id, { visible: !layer.visible })} pressed={layer.visible}>{layer.visible ? <Eye size={18} /> : <EyeOff size={18} />}</ToolbarIconButton><ToolbarIconButton disabled={!writable} label={`${layer.locked ? 'Unlock' : 'Lock'} ${layer.name} layer`} onClick={() => props.onUpdateLayer?.(layer.id, { locked: !layer.locked })} pressed={layer.locked}>{layer.locked ? <Lock size={18} /> : <Unlock size={18} />}</ToolbarIconButton><ToolbarIconButton disabled={!writable} label={`${layer.export ? 'Exclude' : 'Include'} ${layer.name} layer from composite export`} onClick={() => props.onUpdateLayer?.(layer.id, { export: !layer.export })} pressed={layer.export}><Layers3 size={18} /></ToolbarIconButton><ToolbarIconButton disabled={!writable} label={`Bring ${layer.name} layer front`} onClick={() => props.onReorderLayer?.(layer.id, 'front')}><ArrowUpToLine size={18} /></ToolbarIconButton><ToolbarIconButton disabled={!writable} label={`Send ${layer.name} layer back`} onClick={() => props.onReorderLayer?.(layer.id, 'back')}><ArrowDownToLine size={18} /></ToolbarIconButton></li>)}</ul>
          </aside>
          <label className="overlay-toolbar-checkbox"><input checked={inkCompositeExport} disabled={!writable} onChange={(event) => setInkCompositeExport(event.target.checked)} type="checkbox" /> Include ink in composite export</label>
          {props.scene.version !== 1 ? <span role="status">newer overlay scene is read-only</span> : null}
          {historyStatus ? <span role="status">{historyStatus}</span> : null}
        </aside> : null}
        </div>
      </div>
    </div>, document.body) : null}
  </>);
}
