'use client';

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clampContextMenuPosition, type ContextMenuPoint, type ContextMenuPosition } from '../lib/context-menu-position';

export interface CanvasContextMenuItem {
  danger?: boolean;
  disabled?: boolean;
  id: string;
  label: string;
  onSelect: () => void;
  shortcut?: string;
}

export type CanvasContextMenuEntry = CanvasContextMenuItem | { id: string; type: 'separator' };

export interface CanvasContextMenuProps {
  /** Viewport client coordinates; null closes and unmounts the portal. */
  anchor: ContextMenuPoint | null;
  entries: readonly CanvasContextMenuEntry[];
  label: string;
  onClose: () => void;
  /** The owner decides where focus lands; the right-clicked element may be gone. */
  onReturnFocus?: () => void;
}

type MenuFocusStep = 'down' | 'end' | 'home' | 'up';

export function isCanvasContextMenuItem(entry: CanvasContextMenuEntry): entry is CanvasContextMenuItem {
  return !('type' in entry);
}

/**
 * Vertical sibling of the toolbar's roving focus. Disabled entries and
 * separators are skipped rather than merely dimmed.
 */
export function nextEnabledMenuIndex(entries: readonly CanvasContextMenuEntry[], from: number, step: MenuFocusStep): number {
  const enabled = entries.reduce<number[]>((indexes, entry, index) => {
    if (isCanvasContextMenuItem(entry) && !entry.disabled) indexes.push(index);
    return indexes;
  }, []);
  if (enabled.length === 0) return -1;
  if (step === 'home') return enabled[0]!;
  if (step === 'end') return enabled.at(-1)!;
  const current = enabled.indexOf(from);
  if (current === -1) return step === 'down' ? enabled[0]! : enabled.at(-1)!;
  return enabled[(current + (step === 'down' ? 1 : enabled.length - 1)) % enabled.length]!;
}

export function CanvasContextMenu({ anchor, entries, label, onClose, onReturnFocus }: CanvasContextMenuProps) {
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef(new Map<number, HTMLButtonElement>());
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const [position, setPosition] = useState<ContextMenuPosition | null>(null);
  const [focusedIndex, setFocusedIndex] = useState(-1);
  const open = anchor !== null && entries.some(isCanvasContextMenuItem);

  const close = useCallback(() => {
    onClose();
    onReturnFocus?.();
  }, [onClose, onReturnFocus]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const rect = menu.getBoundingClientRect();
    const next = clampContextMenuPosition({
      anchor,
      menu: { height: rect.height, width: rect.width },
      viewport: { height: window.innerHeight, width: window.innerWidth, x: 0, y: 0 },
    });
    setPosition((current) => current && current.left === next.left && current.top === next.top ? current : next);
  }, [anchor, entries]);

  // Keyed on the anchor alone: a parent re-render rebuilds `entries` with the
  // same content, and resetting focus there would undo the reader's arrow keys.
  useEffect(() => {
    setFocusedIndex(anchor ? nextEnabledMenuIndex(entriesRef.current, -1, 'home') : -1);
  }, [anchor]);

  // An entirely disabled menu still has to own focus, or Escape never reaches it.
  useEffect(() => {
    if (!open) return;
    const item = focusedIndex >= 0 ? itemRefs.current.get(focusedIndex) : null;
    (item ?? menuRef.current)?.focus({ preventScroll: true });
  }, [focusedIndex, open, position]);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      onClose();
    };
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => { document.removeEventListener('pointerdown', handlePointerDown, true); };
  }, [onClose, open]);

  if (!open) return null;

  const activate = (item: CanvasContextMenuItem) => {
    item.onSelect();
    close();
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    // Tab leaves the menu; the portal would otherwise stay painted and deaf.
    if (event.key === 'Tab') {
      close();
      return;
    }
    const step: MenuFocusStep | null = event.key === 'ArrowDown' ? 'down'
      : event.key === 'ArrowUp' ? 'up'
        : event.key === 'Home' ? 'home'
          : event.key === 'End' ? 'end' : null;
    if (step) {
      event.preventDefault();
      const next = nextEnabledMenuIndex(entries, focusedIndex, step);
      if (next >= 0) setFocusedIndex(next);
      return;
    }
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const entry = entries[focusedIndex];
    if (!entry || !isCanvasContextMenuItem(entry) || entry.disabled) return;
    event.preventDefault();
    activate(entry);
  };

  return createPortal(
    <div
      aria-label={label}
      className="canvas-context-menu"
      data-testid="canvas-context-menu"
      onContextMenu={(event) => { event.preventDefault(); }}
      onKeyDown={handleKeyDown}
      ref={menuRef}
      role="menu"
      style={{ left: position?.left ?? anchor.x, position: 'fixed', top: position?.top ?? anchor.y }}
      tabIndex={-1}
    >
      {entries.map((entry, index) => isCanvasContextMenuItem(entry) ? (
        <button
          aria-disabled={entry.disabled || undefined}
          className="canvas-context-menu-item"
          data-danger={entry.danger || undefined}
          disabled={entry.disabled}
          key={entry.id}
          onClick={() => { activate(entry); }}
          ref={(element) => {
            if (element) itemRefs.current.set(index, element);
            else itemRefs.current.delete(index);
          }}
          role="menuitem"
          tabIndex={index === focusedIndex ? 0 : -1}
          type="button"
        >
          <span>{entry.label}</span>
          {entry.shortcut ? <kbd aria-hidden="true">{entry.shortcut}</kbd> : null}
        </button>
      ) : (
        <div aria-orientation="horizontal" className="canvas-context-menu-separator" key={entry.id} role="separator" />
      ))}
    </div>,
    document.body,
  );
}
