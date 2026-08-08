import { describe, expect, it } from 'vitest';
import { STARTER_TEMPLATES } from '@arielcharts/shared';
import { getTemplateMenuFocusIndex, getTemplateMenuKeyboardAction, getTemplateMenuOrder } from './workspace-template-picker';

describe('WorkspaceTemplatePicker helpers', () => {
  it('uses the shared registry while keeping Blank first', () => {
    const reversed = [...STARTER_TEMPLATES].reverse();
    expect(getTemplateMenuOrder(reversed).map((template) => template.id)).toEqual([
      'blank',
      ...reversed.filter((template) => template.id !== 'blank').map((template) => template.id),
    ]);
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
    expect(getTemplateMenuKeyboardAction('Tab', 2, 7)).toEqual({ type: 'close', returnFocus: false });
  });
});
