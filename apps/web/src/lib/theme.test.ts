import { describe, expect, it, vi } from 'vitest';
import {
  applyTheme,
  getContrastRatio,
  getMermaidThemeVariables,
  getSystemTheme,
  parseThemePreference,
  readThemePreference,
  resolveTheme,
  storeThemePreference,
  THEME_STORAGE_KEY,
} from './theme';

describe('theme preferences', () => {
  it('accepts only the versioned preference vocabulary', () => {
    expect(parseThemePreference('system')).toBe('system');
    expect(parseThemePreference('light')).toBe('light');
    expect(parseThemePreference('dark')).toBe('dark');
    expect(parseThemePreference('night')).toBe('system');
    expect(parseThemePreference(null)).toBe('system');
  });

  it('resolves system preferences without changing explicit choices', () => {
    expect(resolveTheme('system', 'dark')).toBe('dark');
    expect(resolveTheme('system', 'light')).toBe('light');
    expect(resolveTheme('dark', 'light')).toBe('dark');
    expect(resolveTheme('light', 'dark')).toBe('light');
    expect(getSystemTheme(true)).toBe('dark');
    expect(getSystemTheme(false)).toBe('light');
  });

  it('uses a safe system fallback when storage is empty, invalid, or blocked', () => {
    expect(readThemePreference({ getItem: () => null })).toBe('system');
    expect(readThemePreference({ getItem: () => 'unknown' })).toBe('system');
    expect(readThemePreference({ getItem: vi.fn(() => { throw new Error('blocked'); }) })).toBe('system');
  });

  it('persists the preference using the versioned key', () => {
    const setItem = vi.fn();
    storeThemePreference({ setItem }, 'dark');
    expect(setItem).toHaveBeenCalledWith(THEME_STORAGE_KEY, 'dark');
    expect(() => storeThemePreference({ setItem: () => { throw new Error('blocked'); } }, 'light')).not.toThrow();
  });

  it('applies the resolved theme to the html root', () => {
    const root = { dataset: {} as DOMStringMap, style: { colorScheme: '' } };
    expect(applyTheme(root, 'system', 'dark')).toBe('dark');
    expect(root).toEqual({ dataset: { theme: 'dark' }, style: { colorScheme: 'dark' } });
  });

  it('supplies neutral Mermaid defaults for each resolved canvas theme', () => {
    const light = getMermaidThemeVariables('light');
    const dark = getMermaidThemeVariables('dark');

    expect(light).toMatchObject({
      background: '#f9f9f4',
      lineColor: '#5f5f5a',
      primaryColor: '#ffffff',
      primaryTextColor: '#252522',
    });
    expect(dark).toMatchObject({
      background: '#191919',
      lineColor: '#b3b3b3',
      primaryColor: '#252525',
      primaryTextColor: '#e7e7e7',
    });
    expect(light.fontFamily).toContain('ui-rounded');
    expect(light).not.toBe(dark);
    expect(getMermaidThemeVariables('light')).not.toBe(light);
  });

  it('keeps small neutral text above WCAG AA contrast on its activity surface', () => {
    expect(getContrastRatio('#5f5f5a', '#ecece6')).toBeGreaterThanOrEqual(4.5);
    expect(getContrastRatio('#929292', '#242424')).toBeGreaterThanOrEqual(4.5);
    expect(() => getContrastRatio('white', '#ffffff')).toThrow(/six-digit hex/u);
  });

  it('keeps the exact neutral graphical fallback stroke above 3:1 on both canvases', () => {
    expect(getContrastRatio('#5f5f5a', '#f9f9f4')).toBeGreaterThanOrEqual(3);
    expect(getContrastRatio('#929292', '#191919')).toBeGreaterThanOrEqual(3);
  });
});
