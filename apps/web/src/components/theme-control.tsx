'use client';

import { type ThemePreference } from '../lib/theme';
import { useTheme } from './theme-provider';

const THEME_OPTIONS: ReadonlyArray<{ label: string; value: ThemePreference }> = [
  { label: 'System', value: 'system' },
  { label: 'Light', value: 'light' },
  { label: 'Dark', value: 'dark' },
];

export function ThemeControl() {
  const { preference, resolvedTheme, setPreference } = useTheme();

  return (
    <div aria-label="Color theme" className="theme-control" data-resolved-theme={resolvedTheme} data-testid="theme-control" role="group">
      {THEME_OPTIONS.map((option) => (
        <button
          aria-pressed={preference === option.value}
          className={`theme-control-button${preference === option.value ? ' is-active' : ''}`}
          key={option.value}
          onClick={() => setPreference(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
