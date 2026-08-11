export interface PieSlice { label: string; value: number; }
export interface PieSliceIdentity extends PieSlice { occurrenceCount: number; }
export interface PieDiagramSnapshot { showData: boolean; slices: PieSlice[]; title: string | null; }

interface Line { end: number; raw: string; start: number; text: string; }
interface SliceRecord extends PieSlice { line: Line; }
interface TitleRecord { line: Line; value: string; }
interface ParsedPie {
  header: Line;
  headerKeywordEnd: number;
  showData: boolean;
  showDataRange: { end: number; start: number } | null;
  slices: SliceRecord[];
  title: TitleRecord | null;
}

const PIE_NUMBER = /^(?:-?[0-9]+\.[0-9]+|-?(?:0|[1-9][0-9]*))$/;
const PIE_STRING = /^(?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/;

export function isPieDiagramSource(source: string): boolean { return parsePie(source) !== null; }
export function isPieSourceRepresentable(source: string): boolean { return parsePie(source) !== null; }
export function createPieDiagram(showData = false): string { return showData ? 'pie showData' : 'pie'; }
export function getPieDiagramSnapshot(source: string): PieDiagramSnapshot {
  const parsed = requirePie(source);
  return { showData: parsed.showData, slices: parsed.slices.map(publicSlice), title: parsed.title?.value ?? null };
}
export function getPieSliceIdentity(slice: PieSlice, slices: readonly PieSlice[] = []): PieSliceIdentity {
  return { ...slice, occurrenceCount: slices.length ? slices.filter((entry) => sameSlice(entry, slice)).length : 1 };
}
export function resolvePieSlice(source: string, identity: PieSliceIdentity): PieSlice {
  return publicSlice(resolveSlice(requirePie(source), identity));
}

export function setPieShowData(source: string, showData: boolean): string {
  const parsed = requirePie(source);
  if (parsed.showData === showData) return source;
  if (showData) return replaceRanges(source, [{ start: parsed.headerKeywordEnd, end: parsed.headerKeywordEnd, value: ' showData' }]);
  if (!parsed.showDataRange) throw stale();
  return replaceRanges(source, [{ ...parsed.showDataRange, value: '' }]);
}

export function editPieTitle(source: string, title: string | null): string {
  const parsed = requirePie(source);
  if (title === null) return parsed.title ? deleteLines(source, [parsed.title.line]) : source;
  const value = normalizeText(title, 'Pie titles');
  if (parsed.title) return parsed.title.value === value ? source : replaceLine(source, parsed.title.line, `${indent(parsed.title.line)}title ${value}`);
  return insertAfterLine(source, parsed.header, `  title ${value}`);
}

export function addPieSlice(source: string, slice: PieSlice): string {
  const parsed = requirePie(source); const value = normalizeSlice(slice);
  if (parsed.slices.some((entry) => entry.label === value.label)) throw new Error(`A Pie slice named ${value.label} already exists.`);
  return append(source, `  ${formatSlice(value)}`);
}

export function editPieSlice(source: string, identity: PieSliceIdentity, patch: Partial<PieSlice>): string {
  const parsed = requirePie(source); const current = resolveSlice(parsed, identity);
  const value = normalizeSlice({ label: patch.label ?? current.label, value: patch.value ?? current.value });
  if (value.label !== current.label && parsed.slices.some((entry) => entry !== current && entry.label === value.label)) throw new Error(`A Pie slice named ${value.label} already exists.`);
  if (sameSlice(value, current)) return source;
  return replaceLine(source, current.line, `${indent(current.line)}${formatSlice(value)}`);
}

export function deletePieSlice(source: string, identity: PieSliceIdentity): string {
  const parsed = requirePie(source); return deleteLines(source, [resolveSlice(parsed, identity).line]);
}

export function movePieSlice(source: string, identity: PieSliceIdentity, direction: 'up' | 'down'): string {
  const parsed = requirePie(source); const current = resolveSlice(parsed, identity); const index = parsed.slices.indexOf(current);
  const other = parsed.slices[index + (direction === 'up' ? -1 : 1)]; if (!other) return source;
  return swapLines(source, current.line, other.line);
}

function parsePie(source: string): ParsedPie | null {
  try {
    if (source.indexOf('\uFEFF') > 0) return null;
    const lines = splitLines(source); const headerIndex = firstStatement(lines); const header = lines[headerIndex]; if (!header) return null;
    const headerText = sourceLineText(header); const headerMatch = headerText.match(/^([\t ]*)pie(?:([\t ]+)(showData))?([\t ]*)$/); if (!headerMatch) return null;
    const bomOffset = header.start === 0 && header.text.startsWith('\uFEFF') ? 1 : 0;
    const keywordIndex = headerText.indexOf('pie'); const headerKeywordEnd = header.start + bomOffset + keywordIndex + 3;
    const flagIndex = headerMatch[3] ? headerText.indexOf(headerMatch[3], keywordIndex + 3) : -1;
    const showDataRange = flagIndex < 0 ? null : { start: header.start + bomOffset + flagIndex, end: header.start + bomOffset + flagIndex + headerMatch[3]!.length };
    const slices: SliceRecord[] = []; let title: TitleRecord | null = null;
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]!; const text = line.text;
      if (blank(text) || ignorable(text) || accessibility(text)) continue;
      const titleMatch = text.match(/^[\t ]*title[\t ]+(.+?)[\t ]*$/); if (titleMatch) {
        const value = safeParsedText(titleMatch[1]!); if (!value || title) return null; title = { line, value }; continue;
      }
      const slice = parseSlice(text, line); if (!slice || slices.some((entry) => entry.label === slice.label)) return null;
      slices.push(slice);
    }
    return { header, headerKeywordEnd, showData: Boolean(headerMatch[3]), showDataRange, slices, title };
  } catch { return null; }
}

function parseSlice(text: string, line: Line): SliceRecord | null {
  const match = text.match(/^[\t ]*((?:"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'))[\t ]*:[\t ]*((?:-?[0-9]+\.[0-9]+|-?(?:0|[1-9][0-9]*)))[\t ]*$/);
  if (!match || !PIE_STRING.test(match[1]!)) return null;
  const label = decodeString(match[1]!); const rawValue = match[2]!; const parsedValue = Number(rawValue); const value = Object.is(parsedValue, -0) ? 0 : parsedValue;
  if (!safeParsedLabel(label) || !Number.isFinite(value) || value < 0 || !formatNumber(value)) return null;
  return { label, value, line };
}

function requirePie(source: string): ParsedPie { const parsed = parsePie(source); if (!parsed) throw new Error('This source is not a safely representable Pie diagram.'); return parsed; }
function resolveSlice(parsed: ParsedPie, identity: PieSliceIdentity): SliceRecord { const matches = parsed.slices.filter((entry) => sameSlice(entry, identity)); if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw stale(); return matches[0]; }
function publicSlice(slice: SliceRecord): PieSlice { return { label: slice.label, value: slice.value }; }
function sameSlice(left: PieSlice, right: PieSlice): boolean { return left.label === right.label && Object.is(left.value, right.value); }
function stale(): Error { return new Error('Pie slice changed remotely and can no longer be resolved safely.'); }
function normalizeSlice(slice: PieSlice): PieSlice { const label = normalizeLabel(slice.label); const parsedValue = Number(slice.value); const value = Object.is(parsedValue, -0) ? 0 : parsedValue; if (!Number.isFinite(value) || value < 0) throw new Error('Pie slice values must be finite Mermaid numbers greater than or equal to zero.'); return { label, value }; }
function normalizeText(value: string, subject: string): string { const text = value.trim(); if (!text || /[\r\n]|%%/.test(text)) throw new Error(`${subject} must be non-empty single-line text.`); return text; }
function normalizeLabel(value: string): string { if (!safeParsedLabel(value)) throw new Error('Pie slice labels must be non-empty trimmed single-line text.'); return value; }
function safeParsedLabel(value: string): boolean { return Boolean(value) && value === value.trim() && !/[\u0000-\u0008\u000A-\u001F\u007F]/.test(value); }
function safeParsedText(value: string): string | null { const text = value.trim(); return text && !/[\r\n]|%%/.test(text) ? text : null; }
function formatSlice(slice: PieSlice): string { return `${encodeString(slice.label)} : ${formatNumber(slice.value)}`; }
function formatNumber(value: number): string { const result = plainNumber(value); return PIE_NUMBER.test(result) ? result : ''; }
function plainNumber(value: number): string {
  const source = String(value); if (!/[eE]/.test(source)) return source;
  const [coefficient, exponentText] = source.toLowerCase().split('e'); const exponent = Number(exponentText); const negative = coefficient!.startsWith('-');
  const unsigned = negative ? coefficient!.slice(1) : coefficient!; const dot = unsigned.indexOf('.'); const digits = unsigned.replace('.', ''); const decimal = (dot < 0 ? unsigned.length : dot) + exponent;
  const expanded = decimal <= 0 ? `0.${'0'.repeat(-decimal)}${digits}` : decimal >= digits.length ? `${digits}${'0'.repeat(decimal - digits.length)}` : `${digits.slice(0, decimal)}.${digits.slice(decimal)}`;
  return negative ? `-${expanded}` : expanded;
}
function encodeString(value: string): string { return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\t/g, '\\t')}"`; }
function decodeString(value: string): string {
  const content = value.slice(1, -1); let result = '';
  for (let index = 0; index < content.length; index += 1) {
    if (content[index] !== '\\' || index + 1 >= content.length) { result += content[index]; continue; }
    const escaped = content[index += 1]; result += escaped === 'n' ? '\n' : escaped === 'r' ? '\r' : escaped === 't' ? '\t' : escaped;
  }
  return result;
}
function blank(value: string): boolean { return /^[\t ]*$/.test(value); }
function ignorable(value: string): boolean { return /^[\t ]*%%[^\r\n]*$/.test(value); }
function accessibility(value: string): boolean { return /^[\t ]*(?:accTitle[\t ]*:[^\r\n]*|accDescr[\t ]*:[^{}\r\n]*)$/.test(value); }

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
function replaceRanges(source: string, ranges: readonly { end: number; start: number; value: string }[]): string { return [...ranges].sort((left, right) => right.start - left.start).reduce((value, range) => `${value.slice(0, range.start)}${range.value}${value.slice(range.end)}`, source); }
