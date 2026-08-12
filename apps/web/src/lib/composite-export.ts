import type { OverlayObjectRecord, OverlaySceneSnapshot } from '@arielcharts/shared';
import { getCompositeExportObjects } from './overlay-scene';

export type CompositeTheme = 'light' | 'dark';

export interface CompositeExportOptions {
  mermaidSvg: string;
  scene: OverlaySceneSnapshot;
  theme: CompositeTheme;
}

type Bounds = { x: number; y: number; width: number; height: number };

const MAX_EXPORT_WORLD_COORDINATE = 1_000_000;
const MAX_EXPORT_DIMENSION = 2_000_000;
const MAX_PNG_DIMENSION = 8_192;
const MAX_PNG_PIXELS = 16_000_000;
const SAFE_SVG_ID = /^[A-Za-z_][A-Za-z0-9_.:-]{0,127}$/u;
const URL_BEARING_ATTRIBUTES = new Set(['fill', 'filter', 'mask', 'clip-path', 'marker-start', 'marker-mid', 'marker-end', 'cursor', 'stroke', 'style']);

function escapeXml(value: string): string {
  return value.replace(/[&<>'"]/gu, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&apos;', '"': '&quot;' })[character]!);
}

function numeric(value: string | null, fallback: number): number {
  const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback;
}

function assertSafeBounds(bounds: Bounds): Bounds {
  if (![bounds.x, bounds.y, bounds.width, bounds.height].every(Number.isFinite)
    || Math.abs(bounds.x) > MAX_EXPORT_WORLD_COORDINATE || Math.abs(bounds.y) > MAX_EXPORT_WORLD_COORDINATE
    || bounds.width <= 0 || bounds.height <= 0 || bounds.width > MAX_EXPORT_DIMENSION || bounds.height > MAX_EXPORT_DIMENSION) {
    throw new Error('The canvas export exceeds safe geometry bounds.');
  }
  return bounds;
}

function readViewBox(svg: SVGSVGElement): Bounds {
  const pieces = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/u).map(Number) ?? [];
  if (pieces.length === 4 && pieces.every(Number.isFinite) && pieces[2]! > 0 && pieces[3]! > 0) return assertSafeBounds({ x: pieces[0]!, y: pieces[1]!, width: pieces[2]!, height: pieces[3]! });
  return assertSafeBounds({ x: 0, y: 0, width: numeric(svg.getAttribute('width'), 800), height: numeric(svg.getAttribute('height'), 600) });
}

function safeLocalUrl(value: string): boolean {
  const match = value.trim().match(/^url\(\s*#([A-Za-z_][A-Za-z0-9_.:-]{0,127})\s*\)$/u);
  return Boolean(match && SAFE_SVG_ID.test(match[1]!));
}

function safeCss(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || /(?:@import|@font-face|expression\s*\(|behavior\s*:|-moz-binding|javascript:|data:)/iu.test(trimmed)) return false;
  for (const match of trimmed.matchAll(/url\(\s*([^)]*?)\s*\)/giu)) if (!safeLocalUrl(`url(${match[1]})`)) return false;
  return true;
}

function safePaint(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const candidate = value.trim();
  return candidate.length <= 64 && /^(?:#[0-9a-fA-F]{3,8}|[a-zA-Z]+|(?:rgb|hsl)a?\([0-9.,%\s+-]{1,48}\)|transparent|none)$/u.test(candidate) ? candidate : fallback;
}

function fallbackAttribute(attribute: string, quote: string, rawValue: string): string {
  const name = attribute.toLowerCase(); const value = rawValue.trim(); const mentionsUrl = /url\s*\(/iu.test(value);
  if (name.startsWith('on') || name === 'href' || name === 'xlink:href' || name === 'src' || /^(?:javascript|data):/iu.test(value)) return '';
  if ((URL_BEARING_ATTRIBUTES.has(name) || mentionsUrl) && mentionsUrl && !safeLocalUrl(value) && name !== 'style') return '';
  if (name === 'style' && !safeCss(value)) return '';
  return ` ${attribute}=${quote}${rawValue}${quote}`;
}

function stripUnsafeSvg(root: Element): void {
  for (const element of [...root.querySelectorAll('script,foreignObject,iframe,object,embed,a,animate,animateMotion,animateTransform,set,discard,image,link')]) element.remove();
  for (const element of [...root.querySelectorAll('*')]) {
    const id = element.getAttribute('id'); if (id && !SAFE_SVG_ID.test(id)) element.removeAttribute('id');
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase(); const value = attribute.value.trim();
      const mentionsUrl = /url\s*\(/iu.test(value);
      if (name.startsWith('on') || name === 'href' || name === 'xlink:href' || /^(?:javascript|data):/iu.test(value)
        || ((URL_BEARING_ATTRIBUTES.has(name) || mentionsUrl) && mentionsUrl && !safeLocalUrl(value) && name !== 'style')
        || (name === 'style' && !safeCss(value))) element.removeAttribute(attribute.name);
    }
    if (element.nodeName.toLowerCase() === 'style' && !safeCss(element.textContent ?? '')) element.remove();
  }
}

/** Removes active/external SVG surfaces before a composite leaves the app. */
export function sanitizeMermaidSvg(svgMarkup: string): { inner: string; bounds: Bounds } {
  if (typeof DOMParser === 'undefined') {
    const opening = svgMarkup.match(/<svg\b([^>]*)>/iu);
    if (!opening) throw new Error('The Mermaid preview cannot be exported as SVG.');
    const viewBox = opening[1]?.match(/\bviewBox\s*=\s*["']([^"']+)["']/iu)?.[1]?.trim().split(/[\s,]+/u).map(Number) ?? [];
    const bounds = viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2]! > 0 && viewBox[3]! > 0
      ? { x: viewBox[0]!, y: viewBox[1]!, width: viewBox[2]!, height: viewBox[3]! }
      : { x: 0, y: 0, width: 800, height: 600 };
    const inner = svgMarkup.replace(/^.*?<svg\b[^>]*>/isu, '').replace(/<\/svg>\s*$/isu, '')
      .replace(/<!--[\s\S]*?-->/gu, '')
      .replace(/<(?:script|foreignObject|iframe|object|embed|a|animate(?:Motion|Transform)?|set|discard|image|link)\b[^>]*>[\s\S]*?<\/(?:script|foreignObject|iframe|object|embed|a|animate(?:Motion|Transform)?|set|discard|image|link)>/giu, '')
      .replace(/<(?:script|foreignObject|iframe|object|embed|a|animate(?:Motion|Transform)?|set|discard|image|link)\b[^>]*\/?\s*>/giu, '')
      .replace(/\s([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(["'])([\s\S]*?)\2/gu, (_match, attribute: string, quote: string, value: string) => fallbackAttribute(attribute, quote, value))
      .replace(/<style\b[^>]*>[\s\S]*?(?:@import|@font-face|javascript:|data:|url\(\s*(?!#[A-Za-z_][A-Za-z0-9_.:-]{0,127}\s*\)))[\s\S]*?<\/style>/giu, '');
    return { bounds: assertSafeBounds(bounds), inner };
  }
  const parsed = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
  const root = parsed.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg' || parsed.querySelector('parsererror')) throw new Error('The Mermaid preview cannot be exported as SVG.');
  stripUnsafeSvg(root);
  return { bounds: readViewBox(root as unknown as SVGSVGElement), inner: root.innerHTML };
}

function objectBounds(object: OverlayObjectRecord): Bounds {
  const { x, y, width, height, rotation } = object.geometry;
  if (![x, y, width, height, rotation].every(Number.isFinite) || Math.abs(x) > MAX_EXPORT_WORLD_COORDINATE || Math.abs(y) > MAX_EXPORT_WORLD_COORDINATE || width > MAX_EXPORT_DIMENSION || height > MAX_EXPORT_DIMENSION) throw new Error('An overlay exceeds safe export geometry.');
  const radians = rotation * Math.PI / 180; const centerX = x + width / 2; const centerY = y + height / 2;
  const corners = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]].map(([pointX, pointY]) => ({ x: centerX + (pointX - centerX) * Math.cos(radians) - (pointY - centerY) * Math.sin(radians), y: centerY + (pointX - centerX) * Math.sin(radians) + (pointY - centerY) * Math.cos(radians) }));
  const stroke = typeof object.style.width === 'number' && Number.isFinite(object.style.width) ? Math.min(64, Math.max(0, object.style.width)) : 2;
  const arrowPadding = object.kind === 'shape.arrow' ? 10 : 0;
  const minX = Math.min(...corners.map((point) => point.x)) - stroke / 2 - arrowPadding; const maxX = Math.max(...corners.map((point) => point.x)) + stroke / 2 + arrowPadding;
  const minY = Math.min(...corners.map((point) => point.y)) - stroke / 2 - arrowPadding; const maxY = Math.max(...corners.map((point) => point.y)) + stroke / 2 + arrowPadding;
  return assertSafeBounds({ x: minX, y: minY, width: maxX - minX, height: maxY - minY });
}

function union(bounds: readonly Bounds[]): Bounds {
  const minX = Math.min(...bounds.map(({ x }) => x)); const minY = Math.min(...bounds.map(({ y }) => y));
  const maxX = Math.max(...bounds.map(({ x, width }) => x + width)); const maxY = Math.max(...bounds.map(({ y, height }) => y + height));
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

function overlaySvg(object: OverlayObjectRecord): string {
  const { x, y, width, height, rotation } = object.geometry; const stroke = safePaint(object.style.color, '#334155');
  const fill = safePaint(object.style.fill, 'transparent'); const strokeWidth = typeof object.style.width === 'number' && Number.isFinite(object.style.width) ? Math.min(64, Math.max(0.5, object.style.width)) : 2;
  const transform = rotation === 0 ? '' : ` transform="rotate(${rotation} ${x + width / 2} ${y + height / 2})"`;
  if (object.kind === 'ink.stroke' && Array.isArray(object.payload.points)) {
    const points = object.payload.points.filter((point): point is { x: number; y: number } => Boolean(point) && typeof point === 'object' && Number.isFinite((point as { x?: number }).x) && Number.isFinite((point as { y?: number }).y)).map((point) => `${point.x},${point.y}`).join(' ');
    return `<polyline fill="none" points="${points}" stroke="${escapeXml(stroke)}" stroke-linecap="round" stroke-linejoin="round" stroke-opacity="${typeof object.style.opacity === 'number' && object.style.opacity >= 0 && object.style.opacity <= 1 ? object.style.opacity : 1}" stroke-width="${strokeWidth}"${transform}/>`;
  }
  if (object.kind === 'shape.ellipse') return `<ellipse cx="${x + width / 2}" cy="${y + height / 2}" fill="${escapeXml(fill)}" rx="${width / 2}" ry="${height / 2}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}"${transform}/>`;
  if (object.kind === 'shape.diamond') return `<polygon fill="${escapeXml(fill)}" points="${x + width / 2},${y} ${x + width},${y + height / 2} ${x + width / 2},${y + height} ${x},${y + height / 2}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}"${transform}/>`;
  if (object.kind === 'shape.line' || object.kind === 'shape.arrow' || object.kind === 'connector.overlay') return `<line${object.kind === 'shape.arrow' ? ' marker-end="url(#arielcharts-arrowhead)"' : ''} stroke="${escapeXml(stroke)}" stroke-linecap="round" stroke-width="${strokeWidth}" x1="${x}" x2="${x + width}" y1="${y}" y2="${y + height}"${transform}/>`;
  const body = object.body ?? (typeof object.payload.label === 'string' ? object.payload.label : '');
  const label = body ? `<text fill="${escapeXml(stroke)}" font-family="system-ui,sans-serif" font-size="14" x="${x + 10}" y="${y + 24}">${escapeXml(body)}</text>` : '';
  return `<g${transform}><rect fill="${escapeXml(object.kind === 'annotation.sticky' ? '#fef08a' : fill)}" height="${height}" rx="${object.kind === 'annotation.sticky' ? 6 : 0}" stroke="${escapeXml(stroke)}" stroke-width="${strokeWidth}" width="${width}" x="${x}" y="${y}"/>${label}</g>`;
}

/** Builds a standalone SVG with no workspace metadata, live state, or executable authored content. */
export function createCompositeSvg({ mermaidSvg, scene, theme }: CompositeExportOptions): string {
  const mermaid = sanitizeMermaidSvg(mermaidSvg);
  const exported = getCompositeExportObjects(scene);
  const bounds = assertSafeBounds(union([mermaid.bounds, ...exported.map(objectBounds)])); const padding = 24;
  const viewBox = `${bounds.x - padding} ${bounds.y - padding} ${bounds.width + padding * 2} ${bounds.height + padding * 2}`;
  const background = theme === 'dark' ? '#0f172a' : '#ffffff';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" role="img"><defs><marker id="arielcharts-arrowhead" markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5"><path d="M0,0 L7,3.5 L0,7 z" fill="#334155"/></marker></defs><rect fill="${background}" height="100%" width="100%" x="${bounds.x - padding}" y="${bounds.y - padding}"/><g data-arielcharts-render="mermaid">${mermaid.inner}</g><g data-arielcharts-render="overlay">${exported.map(overlaySvg).join('')}</g></svg>`;
}

export async function compositeSvgToPng(svg: string): Promise<Blob> {
  const image = new Image(); const source = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((resolve, reject) => { image.onload = () => resolve(); image.onerror = () => reject(new Error('The canvas image could not be rendered.')); image.src = source; });
    const viewBox = sanitizeMermaidSvg(svg).bounds; const width = Math.max(1, Math.ceil(viewBox.width)); const height = Math.max(1, Math.ceil(viewBox.height));
    if (width > MAX_PNG_DIMENSION || height > MAX_PNG_DIMENSION || width * height > MAX_PNG_PIXELS) throw new Error('The canvas is too large to export as PNG. Export SVG or reduce the canvas bounds.');
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d'); if (!context) throw new Error('Canvas export is unavailable in this browser.'); context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('PNG encoding failed.')), 'image/png'));
  } finally { URL.revokeObjectURL(source); }
}
