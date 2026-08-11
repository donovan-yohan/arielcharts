export type QuadrantAxisName = 'x' | 'y';
export type QuadrantNumber = 1 | 2 | 3 | 4;
export interface QuadrantAxis { end: string; start: string; }
export interface QuadrantPointStyle { color?: string; radius?: number; strokeColor?: string; strokeWidth?: string; }
export interface QuadrantPoint { label: string; styles: QuadrantPointStyle; x: number; y: number; }
export interface QuadrantPointIdentity extends QuadrantPoint { occurrenceCount: number; }
export interface QuadrantDiagramSnapshot {
  axes: Record<QuadrantAxisName, QuadrantAxis | null>;
  points: QuadrantPoint[];
  quadrants: Record<QuadrantNumber, string | null>;
  title: string | null;
}

interface Line { end: number; raw: string; start: number; text: string; }
interface AxisRecord extends QuadrantAxis { line: Line; }
interface LabelRecord { line: Line; value: string; }
interface PointRecord extends QuadrantPoint { line: Line; }
interface ParsedQuadrant {
  axes: Record<QuadrantAxisName, AxisRecord | null>;
  header: Line;
  points: PointRecord[];
  quadrants: Record<QuadrantNumber, LabelRecord | null>;
  title: LabelRecord | null;
}

const SAFE_TEXT = /^[A-Za-z0-9][A-Za-z0-9 _.'/\-]*$/;
const SAFE_POINT_TEXT = /^[A-Za-z0-9][A-Za-z0-9 _.-]*$/;
const COORDINATE = /^(?:1|0(?:\.[0-9]+)?)$/;
const HEX_COLOR = /^#?(?:[0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const STYLE_ORDER: readonly (keyof QuadrantPointStyle)[] = ['radius', 'color', 'strokeColor', 'strokeWidth'];

export function isQuadrantDiagramSource(source: string): boolean { return parseQuadrant(source) !== null; }
export function isQuadrantSourceRepresentable(source: string): boolean { return parseQuadrant(source) !== null; }
export function createQuadrantDiagram(): string { return 'quadrantChart'; }
export function getQuadrantDiagramSnapshot(source: string): QuadrantDiagramSnapshot {
  const parsed = requireQuadrant(source);
  return {
    axes: { x: publicAxis(parsed.axes.x), y: publicAxis(parsed.axes.y) },
    points: parsed.points.map(publicPoint),
    quadrants: { 1: parsed.quadrants[1]?.value ?? null, 2: parsed.quadrants[2]?.value ?? null, 3: parsed.quadrants[3]?.value ?? null, 4: parsed.quadrants[4]?.value ?? null },
    title: parsed.title?.value ?? null,
  };
}
export function getQuadrantPointIdentity(point: QuadrantPoint, points: readonly QuadrantPoint[] = []): QuadrantPointIdentity {
  return { ...point, styles: { ...point.styles }, occurrenceCount: points.length ? points.filter((entry) => samePoint(entry, point)).length : 1 };
}
export function resolveQuadrantPoint(source: string, identity: QuadrantPointIdentity): QuadrantPoint { return publicPoint(resolvePoint(requireQuadrant(source), identity)); }

export function editQuadrantTitle(source: string, title: string | null): string {
  const parsed = requireQuadrant(source);
  if (title === null) return parsed.title ? deleteLines(source, [parsed.title.line]) : source;
  const value = normalizeText(title, 'Quadrant titles');
  if (parsed.title) return parsed.title.value === value ? source : replaceLine(source, parsed.title.line, `${indent(parsed.title.line)}title ${value}`);
  return insertAfterLine(source, parsed.header, `  title ${value}`);
}

export function setQuadrantAxis(source: string, axis: QuadrantAxisName, value: QuadrantAxis | null): string {
  const parsed = requireQuadrant(source); const current = parsed.axes[axis];
  if (value === null) return current ? deleteLines(source, [current.line]) : source;
  const normalized = normalizeAxis(value); if (current && sameAxis(current, normalized)) return source;
  const statement = `${axis}-axis ${normalized.start} --> ${normalized.end}`;
  return current ? replaceLine(source, current.line, `${indent(current.line)}${statement}`) : append(source, `  ${statement}`);
}

export function setQuadrantLabel(source: string, quadrant: QuadrantNumber, label: string | null): string {
  const parsed = requireQuadrant(source); const current = parsed.quadrants[quadrant];
  if (label === null) return current ? deleteLines(source, [current.line]) : source;
  const value = normalizeText(label, 'Quadrant labels'); if (current?.value === value) return source;
  const statement = `quadrant-${quadrant} ${value}`;
  return current ? replaceLine(source, current.line, `${indent(current.line)}${statement}`) : append(source, `  ${statement}`);
}

export function addQuadrantPoint(source: string, point: QuadrantPoint): string {
  const parsed = requireQuadrant(source); const value = normalizePoint(point);
  if (parsed.points.some((entry) => entry.label === value.label)) throw new Error(`A Quadrant point named ${value.label} already exists.`);
  return append(source, `  ${formatPoint(value)}`);
}

export function editQuadrantPoint(source: string, identity: QuadrantPointIdentity, patch: Partial<QuadrantPoint>): string {
  const parsed = requireQuadrant(source); const current = resolvePoint(parsed, identity);
  const value = normalizePoint({ label: patch.label ?? current.label, styles: patch.styles ?? current.styles, x: patch.x ?? current.x, y: patch.y ?? current.y });
  if (value.label !== current.label && parsed.points.some((entry) => entry !== current && entry.label === value.label)) throw new Error(`A Quadrant point named ${value.label} already exists.`);
  if (samePoint(value, current)) return source;
  return replaceLine(source, current.line, `${indent(current.line)}${formatPoint(value)}`);
}

export function deleteQuadrantPoint(source: string, identity: QuadrantPointIdentity): string {
  const parsed = requireQuadrant(source); return deleteLines(source, [resolvePoint(parsed, identity).line]);
}

export function moveQuadrantPoint(source: string, identity: QuadrantPointIdentity, direction: 'up' | 'down'): string {
  const parsed = requireQuadrant(source); const current = resolvePoint(parsed, identity); const index = parsed.points.indexOf(current);
  const other = parsed.points[index + (direction === 'up' ? -1 : 1)]; if (!other) return source;
  return swapLines(source, current.line, other.line);
}

function parseQuadrant(source: string): ParsedQuadrant | null {
  try {
    if (source.indexOf('\uFEFF') > 0) return null;
    const lines = splitLines(source); const headerIndex = firstStatement(lines); const header = lines[headerIndex]; if (!header || !/^[\t ]*quadrantChart[\t ]*$/.test(sourceLineText(header))) return null;
    const axes: Record<QuadrantAxisName, AxisRecord | null> = { x: null, y: null };
    const quadrants: Record<QuadrantNumber, LabelRecord | null> = { 1: null, 2: null, 3: null, 4: null };
    const points: PointRecord[] = []; let title: LabelRecord | null = null;
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]!; const text = line.text;
      if (blank(text) || ignorable(text) || accessibility(text)) continue;
      const titleMatch = text.match(/^[\t ]*title[\t ]+(.+?)[\t ]*$/i); if (titleMatch) { const value = safeParsedText(titleMatch[1]!); if (!value || title) return null; title = { line, value }; continue; }
      const axisMatch = text.match(/^[\t ]*([xy])-axis[\t ]+(.+?)[\t ]+--+>[\t ]+(.+?)[\t ]*$/i); if (axisMatch) {
        const name = axisMatch[1]!.toLowerCase() as QuadrantAxisName; const start = safeParsedText(axisMatch[2]!); const end = safeParsedText(axisMatch[3]!);
        if (!start || !end || axes[name]) return null; axes[name] = { start, end, line }; continue;
      }
      const quadrantMatch = text.match(/^[\t ]*quadrant-([1-4])[\t ]+(.+?)[\t ]*$/i); if (quadrantMatch) {
        const number = Number(quadrantMatch[1]) as QuadrantNumber; const value = safeParsedText(quadrantMatch[2]!);
        if (!value || quadrants[number]) return null; quadrants[number] = { line, value }; continue;
      }
      if (/^[\t ]*classDef\b/i.test(text) || text.includes(':::')) return null;
      const point = parsePoint(text, line); if (!point || points.some((entry) => entry.label === point.label)) return null; points.push(point);
    }
    return { axes, header, points, quadrants, title };
  } catch { return null; }
}

function parsePoint(text: string, line: Line): PointRecord | null {
  const match = text.match(/^[\t ]*([A-Za-z0-9][A-Za-z0-9 _.-]*?)[\t ]*:[\t ]*\[[\t ]*(1|0(?:\.[0-9]+)?)[\t ]*,[\t ]*(1|0(?:\.[0-9]+)?)[\t ]*\][\t ]*(.*)$/);
  if (!match) return null; const label = match[1]!.trim(); if (!SAFE_POINT_TEXT.test(label)) return null;
  const x = Number(match[2]); const y = Number(match[3]); const styles = parseStyles(match[4]!); if (!styles) return null;
  return { label, line, styles, x, y };
}

function parseStyles(value: string): QuadrantPointStyle | null {
  if (!value.trim()) return {};
  const styles: QuadrantPointStyle = {};
  for (const item of value.split(',')) {
    const match = item.match(/^[\t ]*(radius|color|stroke-color|stroke-width)[\t ]*:[\t ]*([^\t ]+)[\t ]*$/); if (!match) return null;
    const key = match[1]!; const raw = match[2]!;
    if (key === 'radius') { const radius = Number(raw); if (!/^[0-9]+$/.test(raw) || !Number.isSafeInteger(radius) || styles.radius !== undefined) return null; styles.radius = radius; }
    else if (key === 'color') { if (!HEX_COLOR.test(raw) || styles.color !== undefined) return null; styles.color = raw; }
    else if (key === 'stroke-color') { if (!HEX_COLOR.test(raw) || styles.strokeColor !== undefined) return null; styles.strokeColor = raw; }
    else { if (!/^[0-9]+px$/.test(raw) || styles.strokeWidth !== undefined) return null; styles.strokeWidth = raw; }
  }
  return styles;
}

function requireQuadrant(source: string): ParsedQuadrant { const parsed = parseQuadrant(source); if (!parsed) throw new Error('This source is not a safely representable Quadrant diagram.'); return parsed; }
function resolvePoint(parsed: ParsedQuadrant, identity: QuadrantPointIdentity): PointRecord { const matches = parsed.points.filter((entry) => samePoint(entry, identity)); if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw stale(); return matches[0]; }
function publicPoint(point: PointRecord): QuadrantPoint { return { label: point.label, styles: { ...point.styles }, x: point.x, y: point.y }; }
function publicAxis(axis: AxisRecord | null): QuadrantAxis | null { return axis ? { end: axis.end, start: axis.start } : null; }
function sameAxis(left: QuadrantAxis, right: QuadrantAxis): boolean { return left.start === right.start && left.end === right.end; }
function samePoint(left: QuadrantPoint, right: QuadrantPoint): boolean { return left.label === right.label && Object.is(left.x, right.x) && Object.is(left.y, right.y) && STYLE_ORDER.every((key) => left.styles[key] === right.styles[key]); }
function stale(): Error { return new Error('Quadrant point changed remotely and can no longer be resolved safely.'); }
function normalizeAxis(axis: QuadrantAxis): QuadrantAxis { return { start: normalizeText(axis.start, 'Quadrant axis labels'), end: normalizeText(axis.end, 'Quadrant axis labels') }; }
function normalizePoint(point: QuadrantPoint): QuadrantPoint {
  const label = normalizePointLabel(point.label); const x = normalizeCoordinate(point.x); const y = normalizeCoordinate(point.y); const styles = normalizeStyles(point.styles);
  return { label, styles, x, y };
}
function normalizeCoordinate(value: number): number { const coordinate = Number(value); if (!Number.isFinite(coordinate) || coordinate < 0 || coordinate > 1 || !COORDINATE.test(formatCoordinate(coordinate))) throw new Error('Quadrant coordinates must be finite Mermaid decimals from 0 through 1.'); return coordinate; }
function normalizeStyles(value: QuadrantPointStyle): QuadrantPointStyle {
  const styles: QuadrantPointStyle = {};
  if (value.radius !== undefined) { if (!Number.isSafeInteger(value.radius) || value.radius < 0) throw new Error('Quadrant point radius must be a non-negative integer.'); styles.radius = value.radius; }
  if (value.color !== undefined) { if (!HEX_COLOR.test(value.color)) throw new Error('Quadrant point color must be a three- or six-digit hex color.'); styles.color = value.color; }
  if (value.strokeColor !== undefined) { if (!HEX_COLOR.test(value.strokeColor)) throw new Error('Quadrant point stroke color must be a three- or six-digit hex color.'); styles.strokeColor = value.strokeColor; }
  if (value.strokeWidth !== undefined) { if (!/^[0-9]+px$/.test(value.strokeWidth)) throw new Error('Quadrant point stroke width must use whole pixels.'); styles.strokeWidth = value.strokeWidth; }
  return styles;
}
function normalizeText(value: string, subject: string): string { const text = value.trim(); if (!SAFE_TEXT.test(text)) throw new Error(`${subject} must use safe single-line Mermaid text.`); return text; }
function normalizePointLabel(value: string): string { const text = value.trim(); if (!SAFE_POINT_TEXT.test(text)) throw new Error('Quadrant point labels must use safe single-line Mermaid text.'); return text; }
function safeParsedText(value: string): string | null { const text = value.trim(); return SAFE_TEXT.test(text) ? text : null; }
function formatPoint(point: QuadrantPoint): string { const styles = formatStyles(point.styles); return `${point.label}: [${formatCoordinate(point.x)}, ${formatCoordinate(point.y)}]${styles ? ` ${styles}` : ''}`; }
function formatCoordinate(value: number): string {
  const source = String(value); if (!/[eE]/.test(source)) return source;
  const [coefficient, exponentText] = source.toLowerCase().split('e'); const exponent = Number(exponentText); const dot = coefficient!.indexOf('.'); const digits = coefficient!.replace('.', ''); const decimal = (dot < 0 ? coefficient!.length : dot) + exponent;
  return decimal <= 0 ? `0.${'0'.repeat(-decimal)}${digits}` : decimal >= digits.length ? `${digits}${'0'.repeat(decimal - digits.length)}` : `${digits.slice(0, decimal)}.${digits.slice(decimal)}`;
}
function formatStyles(styles: QuadrantPointStyle): string { return STYLE_ORDER.flatMap((key) => styles[key] === undefined ? [] : [`${key === 'strokeColor' ? 'stroke-color' : key === 'strokeWidth' ? 'stroke-width' : key}: ${styles[key]}`]).join(', '); }
function blank(value: string): boolean { return /^[\t ]*$/.test(value); }
function ignorable(value: string): boolean { return /^[\t ]*%%[^\r\n]*$/.test(value); }
function accessibility(value: string): boolean { return /^[\t ]*(?:accTitle[\t ]*:[^\r\n]*|accDescr[\t ]*:[^{}\r\n]*)$/i.test(value); }

function splitLines(source: string): Line[] { const lines: Line[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; lines.push({ start: match.index, end: match.index + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function sourceLineText(line: Line): string { return line.start === 0 ? line.text.replace(/^\uFEFF/, '') : line.text; }
function firstStatement(lines: readonly Line[]): number { let index = 0; if (lines[0] && /^---[\t ]*$/.test(sourceLineText(lines[0]))) { const close = lines.findIndex((line, candidate) => candidate > 0 && sourceLineText(line) === '---'); if (close < 0 || lines.slice(0, close + 1).some((line) => terminator(line) === '\r')) return lines.length; index = close + 1; } while (index < lines.length && (blank(sourceLineText(lines[index]!)) || ignorable(sourceLineText(lines[index]!)))) index += 1; return index; }
function indent(line: Line): string { return line.text.match(/^[\t ]*/)?.[0] ?? ''; }
function terminator(line: Line): string { return line.raw.slice(line.text.length); }
function localLineEnding(source: string): string { return source.match(/\r\n|\n|\r/g)?.at(-1) ?? '\n'; }
function hasFinalLineEnding(source: string): boolean { return /(?:\r\n|\n|\r)$/.test(source); }
function append(source: string, statement: string): string { const ending = localLineEnding(source); return hasFinalLineEnding(source) ? `${source}${statement}${ending}` : `${source}${ending}${statement}`; }
function insertAfterLine(source: string, line: Line, statement: string): string { const ending = terminator(line) || localLineEnding(source); return terminator(line) ? `${source.slice(0, line.end)}${statement}${ending}${source.slice(line.end)}` : `${source.slice(0, line.end)}${ending}${statement}${source.slice(line.end)}`; }
function replaceLine(source: string, line: Line, value: string): string { return `${source.slice(0, line.start)}${value}${terminator(line)}${source.slice(line.end)}`; }
function deleteLines(source: string, lines: readonly Line[]): string { const hadFinal = hasFinalLineEnding(source); const next = [...lines].sort((left, right) => right.start - left.start).reduce((value, line) => `${value.slice(0, line.start)}${value.slice(line.end)}`, source); return !hadFinal && hasFinalLineEnding(next) ? next.replace(/(?:\r\n|\n|\r)$/, '') : next; }
function swapLines(source: string, left: Line, right: Line): string { const first = left.start < right.start ? left : right; const second = first === left ? right : left; return `${source.slice(0, first.start)}${second.text}${terminator(first)}${source.slice(first.end, second.start)}${first.text}${terminator(second)}${source.slice(second.end)}`; }
