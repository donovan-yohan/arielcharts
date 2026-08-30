// @vitest-environment happy-dom

import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasContextMenu, isCanvasContextMenuItem, nextEnabledMenuIndex, type CanvasContextMenuEntry } from './canvas-context-menu';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.replaceChildren(); vi.unstubAllGlobals(); });

const ANCHOR = { x: 120, y: 90 };

function menuEntries(overrides: Partial<Record<'first' | 'middle' | 'last', boolean>> = {}): {
  entries: CanvasContextMenuEntry[];
  selects: Record<'first' | 'last' | 'middle', ReturnType<typeof vi.fn>>;
} {
  const selects = { first: vi.fn(), last: vi.fn(), middle: vi.fn() };
  return {
    entries: [
      { id: 'first', label: 'Add text here', onSelect: selects.first, disabled: overrides.first },
      { id: 'gap', type: 'separator' },
      { id: 'middle', label: 'Paste', onSelect: selects.middle, disabled: overrides.middle ?? true },
      { id: 'last', danger: true, label: 'Delete', onSelect: selects.last, disabled: overrides.last },
    ],
    selects,
  };
}

async function mount(props: Partial<React.ComponentProps<typeof CanvasContextMenu>> & { entries: CanvasContextMenuEntry[] }): Promise<{
  render: (next: Partial<React.ComponentProps<typeof CanvasContextMenu>>) => Promise<void>;
  root: Root;
}> {
  const host = document.createElement('div');
  document.body.append(host);
  const root = createRoot(host);
  let current: React.ComponentProps<typeof CanvasContextMenu> = {
    anchor: ANCHOR,
    label: 'Canvas actions',
    onClose: vi.fn(),
    ...props,
  };
  const render = async (next: Partial<React.ComponentProps<typeof CanvasContextMenu>>) => {
    current = { ...current, ...next };
    await act(async () => root.render(<CanvasContextMenu {...current} />));
  };
  await render({});
  return { render, root };
}

const menu = () => document.body.querySelector<HTMLElement>('[data-testid="canvas-context-menu"]');
const items = () => [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
const press = (key: string) => menu()!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, key }));

describe('nextEnabledMenuIndex', () => {
  const { entries } = menuEntries();

  it('skips separators and disabled entries in both directions', () => {
    expect(nextEnabledMenuIndex(entries, -1, 'home')).toBe(0);
    expect(nextEnabledMenuIndex(entries, 0, 'down')).toBe(3);
    expect(nextEnabledMenuIndex(entries, 3, 'down')).toBe(0);
    expect(nextEnabledMenuIndex(entries, 0, 'up')).toBe(3);
    expect(nextEnabledMenuIndex(entries, -1, 'end')).toBe(3);
  });

  it('reports no target when every entry is unavailable', () => {
    expect(nextEnabledMenuIndex([{ id: 'gap', type: 'separator' }], -1, 'home')).toBe(-1);
    expect(nextEnabledMenuIndex(menuEntries({ first: true, last: true }).entries, -1, 'down')).toBe(-1);
  });

  it('classifies separators apart from actionable items', () => {
    expect(isCanvasContextMenuItem(entries[0]!)).toBe(true);
    expect(isCanvasContextMenuItem(entries[1]!)).toBe(false);
  });
});

describe('CanvasContextMenu', () => {
  it('renders a labelled menu with separators and focuses the first enabled item', async () => {
    const { entries } = menuEntries();
    await mount({ entries });
    expect(menu()?.getAttribute('role')).toBe('menu');
    expect(menu()?.getAttribute('aria-label')).toBe('Canvas actions');
    expect(document.body.querySelectorAll('[role="separator"]')).toHaveLength(1);
    expect(items().map((item) => item.textContent)).toEqual(['Add text here', 'Paste', 'Delete']);
    expect(items()[1]?.getAttribute('aria-disabled')).toBe('true');
    expect(items()[1]?.disabled).toBe(true);
    expect(document.activeElement).toBe(items()[0]);
    expect(items()[0]?.tabIndex).toBe(0);
    expect(items()[2]?.tabIndex).toBe(-1);
  });

  it('measures itself, then flips and clamps inside a small viewport', async () => {
    vi.stubGlobal('innerHeight', 200);
    vi.stubGlobal('innerWidth', 300);
    const measure = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
      .mockReturnValue({ bottom: 240, height: 240, left: 0, right: 220, top: 0, width: 220, x: 0, y: 0, toJSON: () => ({}) } as DOMRect);
    try {
      const { entries } = menuEntries();
      await mount({ anchor: { x: 290, y: 190 }, entries });
      expect(menu()?.style.position).toBe('fixed');
      expect(menu()?.style.left).toBe('70px');
      expect(menu()?.style.top).toBe('8px');
    } finally {
      measure.mockRestore();
    }
  });

  it('moves focus with arrows, Home, and End while skipping the disabled entry', async () => {
    const { entries } = menuEntries();
    await mount({ entries });
    await act(async () => { press('ArrowDown'); });
    expect(document.activeElement).toBe(items()[2]);
    await act(async () => { press('ArrowDown'); });
    expect(document.activeElement).toBe(items()[0]);
    await act(async () => { press('ArrowUp'); });
    expect(document.activeElement).toBe(items()[2]);
    await act(async () => { press('Home'); });
    expect(document.activeElement).toBe(items()[0]);
    await act(async () => { press('End'); });
    expect(document.activeElement).toBe(items()[2]);
  });

  it('keeps the reader on their chosen item when the parent rebuilds an identical entry list', async () => {
    const { entries } = menuEntries();
    const { render } = await mount({ entries });
    await act(async () => { press('ArrowDown'); });
    expect(document.activeElement).toBe(items()[2]);
    await render({ entries: menuEntries().entries });
    expect(document.activeElement).toBe(items()[2]);
    expect(items()[2]?.tabIndex).toBe(0);
  });

  it('activates with Enter, Space, and click, then closes and hands focus back to its owner', async () => {
    const onReturnFocus = vi.fn();
    const onClose = vi.fn();
    const { entries, selects } = menuEntries();
    const { render } = await mount({ entries, onClose, onReturnFocus });

    await act(async () => { press('Enter'); });
    expect(selects.first).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReturnFocus).toHaveBeenCalledTimes(1);

    await render({});
    await act(async () => { press(' '); });
    expect(selects.first).toHaveBeenCalledTimes(2);

    await render({});
    await act(async () => { items()[2]!.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
    expect(selects.last).toHaveBeenCalledTimes(1);
    expect(onClose).toHaveBeenCalledTimes(3);
    expect(onReturnFocus).toHaveBeenCalledTimes(3);
    expect(selects.middle).not.toHaveBeenCalled();
  });

  it('closes on Escape and on an outside pointerdown without activating anything', async () => {
    const onReturnFocus = vi.fn();
    const onClose = vi.fn();
    const { entries, selects } = menuEntries();
    await mount({ entries, onClose, onReturnFocus });

    await act(async () => { menu()!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => { press('Escape'); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReturnFocus).toHaveBeenCalledTimes(1);
    expect(selects.first).not.toHaveBeenCalled();

    await act(async () => { document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(onClose).toHaveBeenCalledTimes(2);
    expect(onReturnFocus).toHaveBeenCalledTimes(1);
  });

  it('closes on Tab so focus never leaves a menu that stays painted', async () => {
    const onReturnFocus = vi.fn();
    const onClose = vi.fn();
    const { entries, selects } = menuEntries();
    await mount({ entries, onClose, onReturnFocus });

    let defaultPrevented = true;
    await act(async () => { defaultPrevented = !press('Tab'); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReturnFocus).toHaveBeenCalledTimes(1);
    expect(defaultPrevented, 'Tab must keep its native focus move').toBe(false);
    expect(selects.first).not.toHaveBeenCalled();
  });

  it('keeps an entirely disabled menu focusable so Escape still dismisses it', async () => {
    const onReturnFocus = vi.fn();
    const onClose = vi.fn();
    const { entries } = menuEntries({ first: true, last: true });
    await mount({ entries, onClose, onReturnFocus });

    expect(menu()).not.toBeNull();
    expect(items().every((item) => item.disabled)).toBe(true);
    expect(document.activeElement).toBe(menu());
    await act(async () => { press('Escape'); });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onReturnFocus).toHaveBeenCalledTimes(1);
  });

  it('hides the shortcut hint from the accessible name of its item', async () => {
    const onSelect = vi.fn();
    await mount({ entries: [{ id: 'first', label: 'Add flowchart node', onSelect, shortcut: 'N' }] });
    const item = items()[0]!;
    expect(item.querySelector('kbd')?.getAttribute('aria-hidden')).toBe('true');
    expect(item.querySelector('kbd')?.textContent).toBe('N');
    expect([...item.children].find((child) => child.getAttribute('aria-hidden') !== 'true')?.textContent)
      .toBe('Add flowchart node');
  });

  it('renders nothing without an anchor or without an actionable entry', async () => {
    const { entries } = menuEntries();
    const { render } = await mount({ entries });
    expect(menu()).not.toBeNull();
    await render({ anchor: null });
    expect(menu()).toBeNull();
    await render({ anchor: ANCHOR, entries: [{ id: 'gap', type: 'separator' }] });
    expect(menu()).toBeNull();
  });
});
