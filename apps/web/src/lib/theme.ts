export const THEME_STORAGE_KEY = 'arielcharts.theme.v1';
export const THEME_MEDIA_QUERY = '(prefers-color-scheme: dark)';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = Exclude<ThemePreference, 'system'>;

export interface MermaidThemeVariables {
  actorBkg: string;
  actorBorder: string;
  actorTextColor: string;
  background: string;
  edgeLabelBackground: string;
  fontFamily: string;
  labelBoxBkgColor: string;
  labelBoxBorderColor: string;
  labelTextColor: string;
  lineColor: string;
  loopTextColor: string;
  noteBkgColor: string;
  noteBorderColor: string;
  noteTextColor: string;
  primaryBorderColor: string;
  primaryColor: string;
  primaryTextColor: string;
  secondaryColor: string;
  signalColor: string;
  signalTextColor: string;
  tertiaryColor: string;
  textColor: string;
}

const MERMAID_FONT_STACK = 'ui-rounded, "Avenir Next Rounded", "Nunito", "SF Pro Rounded", system-ui, sans-serif';

const MERMAID_THEME_VARIABLES: Record<ResolvedTheme, Readonly<MermaidThemeVariables>> = {
  light: {
    actorBkg: '#ffffff',
    actorBorder: '#5f5f5a',
    actorTextColor: '#252522',
    background: '#f9f9f4',
    edgeLabelBackground: '#f9f9f4',
    fontFamily: MERMAID_FONT_STACK,
    labelBoxBkgColor: '#f2f2ed',
    labelBoxBorderColor: '#a4a49b',
    labelTextColor: '#252522',
    lineColor: '#5f5f5a',
    loopTextColor: '#252522',
    noteBkgColor: '#f2f2ed',
    noteBorderColor: '#a4a49b',
    noteTextColor: '#252522',
    primaryBorderColor: '#5f5f5a',
    primaryColor: '#ffffff',
    primaryTextColor: '#252522',
    secondaryColor: '#f2f2ed',
    signalColor: '#5f5f5a',
    signalTextColor: '#252522',
    tertiaryColor: '#ecece6',
    textColor: '#252522',
  },
  dark: {
    actorBkg: '#252525',
    actorBorder: '#929292',
    actorTextColor: '#e7e7e7',
    background: '#191919',
    edgeLabelBackground: '#191919',
    fontFamily: MERMAID_FONT_STACK,
    labelBoxBkgColor: '#242424',
    labelBoxBorderColor: '#666666',
    labelTextColor: '#e7e7e7',
    lineColor: '#b3b3b3',
    loopTextColor: '#e7e7e7',
    noteBkgColor: '#242424',
    noteBorderColor: '#666666',
    noteTextColor: '#e7e7e7',
    primaryBorderColor: '#929292',
    primaryColor: '#252525',
    primaryTextColor: '#e7e7e7',
    secondaryColor: '#1b1b1b',
    signalColor: '#b3b3b3',
    signalTextColor: '#e7e7e7',
    tertiaryColor: '#303030',
    textColor: '#e7e7e7',
  },
};

export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface ThemeRoot {
  dataset: DOMStringMap;
  style: Pick<CSSStyleDeclaration, 'colorScheme'>;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'system' || value === 'light' || value === 'dark';
}

export function parseThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : 'system';
}

export function resolveTheme(preference: ThemePreference, systemTheme: ResolvedTheme): ResolvedTheme {
  return preference === 'system' ? systemTheme : preference;
}

export function readThemePreference(storage: Pick<ThemeStorage, 'getItem'> | null | undefined): ThemePreference {
  try {
    return parseThemePreference(storage?.getItem(THEME_STORAGE_KEY));
  } catch {
    return 'system';
  }
}

export function storeThemePreference(storage: Pick<ThemeStorage, 'setItem'> | null | undefined, preference: ThemePreference): void {
  try {
    storage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {}
}

export function applyTheme(root: ThemeRoot, preference: ThemePreference, systemTheme: ResolvedTheme): ResolvedTheme {
  const resolvedTheme = resolveTheme(preference, systemTheme);
  root.dataset.theme = resolvedTheme;
  root.style.colorScheme = resolvedTheme;
  return resolvedTheme;
}

export function getSystemTheme(matchesDark: boolean): ResolvedTheme {
  return matchesDark ? 'dark' : 'light';
}

export function getMermaidThemeVariables(theme: ResolvedTheme): Readonly<MermaidThemeVariables> {
  return { ...MERMAID_THEME_VARIABLES[theme] };
}

export function getContrastRatio(foreground: string, background: string): number {
  const lighter = Math.max(getRelativeLuminance(foreground), getRelativeLuminance(background));
  const darker = Math.min(getRelativeLuminance(foreground), getRelativeLuminance(background));
  return (lighter + 0.05) / (darker + 0.05);
}

function getRelativeLuminance(hex: string): number {
  const normalized = hex.replace(/^#/u, '');
  if (!/^[0-9a-f]{6}$/iu.test(normalized)) {
    throw new Error(`Expected a six-digit hex color, received "${hex}".`);
  }
  const channels = [0, 2, 4].map((index) => Number.parseInt(normalized.slice(index, index + 2), 16) / 255);
  const [red = 0, green = 0, blue = 0] = channels.map((channel) => (
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  ));
  return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
}
