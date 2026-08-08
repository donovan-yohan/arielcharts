'use client';

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import {
  applyTheme,
  getSystemTheme,
  readThemePreference,
  storeThemePreference,
  THEME_MEDIA_QUERY,
  THEME_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from '../lib/theme';

interface ThemeContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getBrowserStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function ThemeProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [preference, setPreferenceState] = useState<ThemePreference>('system');
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>('light');

  useEffect(() => {
    const mediaQuery = window.matchMedia(THEME_MEDIA_QUERY);
    const syncTheme = () => {
      const nextPreference = readThemePreference(getBrowserStorage());
      const nextResolvedTheme = applyTheme(
        document.documentElement,
        nextPreference,
        getSystemTheme(mediaQuery.matches),
      );
      setPreferenceState(nextPreference);
      setResolvedTheme(nextResolvedTheme);
    };
    const handleSystemThemeChange = () => {
      if (readThemePreference(getBrowserStorage()) === 'system') {
        syncTheme();
      }
    };
    const handleStorageChange = (event: StorageEvent) => {
      const storage = getBrowserStorage();
      if (
        storage
        && event.storageArea === storage
        && (event.key === THEME_STORAGE_KEY || event.key === null)
      ) {
        syncTheme();
      }
    };

    syncTheme();
    mediaQuery.addEventListener('change', handleSystemThemeChange);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      mediaQuery.removeEventListener('change', handleSystemThemeChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const value = useMemo<ThemeContextValue>(() => ({
    preference,
    resolvedTheme,
    setPreference: (nextPreference) => {
      const nextResolvedTheme = applyTheme(
        document.documentElement,
        nextPreference,
        getSystemTheme(window.matchMedia(THEME_MEDIA_QUERY).matches),
      );
      storeThemePreference(getBrowserStorage(), nextPreference);
      setPreferenceState(nextPreference);
      setResolvedTheme(nextResolvedTheme);
    },
  }), [preference, resolvedTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const context = useContext(ThemeContext);
  if (!context) {
    throw new Error('useTheme must be used within ThemeProvider.');
  }
  return context;
}
