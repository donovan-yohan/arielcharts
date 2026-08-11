// @vitest-environment happy-dom

import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CHOOSER_STARTER_TEMPLATES } from '@arielcharts/shared';
import { WorkspaceTemplatePicker, getTemplateMenuFocusIndex, getTemplateMenuGroups, getTemplateMenuKeyboardAction, getTemplateMenuOrder } from './workspace-template-picker';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.replaceChildren(); });

describe('WorkspaceTemplatePicker helpers', () => {
  it('uses the shared registry while keeping Blank first', () => {
    const reversed = [...CHOOSER_STARTER_TEMPLATES].reverse();
    expect(getTemplateMenuOrder(reversed).map((template) => template.id)).toEqual([
      'blank',
      ...reversed.filter((template) => template.id !== 'blank').map((template) => template.id),
    ]);
  });

  it('groups the shared catalog by editing model and stability without dropping a starter', () => {
    const groups = getTemplateMenuGroups(CHOOSER_STARTER_TEMPLATES);
    expect(groups.map((group) => group.label)).toEqual([
      'Start',
      'Form editing · preview',
      'Form editing · stable',
      'Canvas editing · stable',
    ]);
    expect(groups.flatMap((group) => group.templates).map((template) => template.id).sort())
      .toEqual(getTemplateMenuOrder(CHOOSER_STARTER_TEMPLATES).map((template) => template.id).sort());
  });

  it('wraps Arrow navigation and supports Home and End', () => {
    expect(getTemplateMenuFocusIndex('ArrowDown', 2, 3)).toBe(0);
    expect(getTemplateMenuFocusIndex('ArrowUp', 0, 3)).toBe(2);
    expect(getTemplateMenuFocusIndex('Home', 2, 3)).toBe(0);
    expect(getTemplateMenuFocusIndex('End', 0, 3)).toBe(2);
    expect(getTemplateMenuFocusIndex('Enter', 0, 3)).toBeNull();
  });

  it('maps composite-menu keys to one roving item, selection, and non-trapping closure', () => {
    expect(getTemplateMenuKeyboardAction('ArrowDown', 0, 7)).toEqual({ type: 'move', index: 1 });
    expect(getTemplateMenuKeyboardAction('Home', 4, 7)).toEqual({ type: 'move', index: 0 });
    expect(getTemplateMenuKeyboardAction('Enter', 2, 7)).toEqual({ type: 'select' });
    expect(getTemplateMenuKeyboardAction(' ', 2, 7)).toEqual({ type: 'select' });
    expect(getTemplateMenuKeyboardAction('Escape', 2, 7)).toEqual({ type: 'close', returnFocus: true });
    expect(getTemplateMenuKeyboardAction('Tab', 2, 7)).toBeNull();
  });

  it('uses a dialog with separate normal buttons and documentation links, not invalid nested menu controls', async () => {
    const host = document.createElement('div'); document.body.append(host);
    const root = createRoot(host);
    await act(async () => root.render(React.createElement(WorkspaceTemplatePicker, { onCreateDiagram: vi.fn(), templates: CHOOSER_STARTER_TEMPLATES })));
    const trigger = host.querySelector<HTMLButtonElement>('[data-testid="create-diagram-tab"]')!;
    await act(async () => trigger.click());
    const dialog = host.querySelector<HTMLElement>('[role="dialog"][aria-label="Starter templates"]')!;
    expect(dialog).toBeTruthy();
    expect(dialog.querySelectorAll('[role="menu"], [role="menuitem"]')).toHaveLength(0);
    const creates = dialog.querySelectorAll<HTMLButtonElement>('[data-testid="starter-template-create"]');
    expect(creates).toHaveLength(CHOOSER_STARTER_TEMPLATES.length);
    expect([...creates].filter((item) => item.tabIndex === 0)).toHaveLength(1);
    const links = dialog.querySelectorAll<HTMLAnchorElement>('a[aria-label^="Learn about"]');
    expect(links).toHaveLength(CHOOSER_STARTER_TEMPLATES.length + 1);
    for (const link of links) {
      expect(link.target).toBe('_blank');
      expect(link.rel).toBe('noreferrer');
      expect(link.closest('[aria-disabled="true"]')).toBeNull();
    }
    expect(dialog.querySelector('[aria-disabled="true"] a')).toBeNull();
    await act(async () => root.unmount());
  });
});
