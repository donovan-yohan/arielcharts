export type XyChartOrientation = 'horizontal' | 'vertical';
export type XySeriesKind = 'bar' | 'line';

export interface XyAxis {
  label?: string;
  labels?: string[];
  range?: [number, number];
}
export interface XySeries { kind: XySeriesKind; label?: string; values: number[]; }
export interface XySeriesIdentity extends XySeries { occurrenceCount: number; }
export interface XyChartDiagramSnapshot { orientation?: XyChartOrientation; series: XySeries[]; title?: string; xAxis: XyAxis; yAxis: XyAxis; }

interface Line { end: number; raw: string; start: number; text: string; }
interface AxisRecord extends XyAxis { line: Line; }
interface SeriesRecord extends XySeries { line: Line; }
interface Parsed { header: Line; orientation?: XyChartOrientation; series: SeriesRecord[]; title?: string; titleLine?: Line; xAxis: AxisRecord; yAxis: AxisRecord; }

const H = '[\\t ]*';
const NUMBER = '[+-]?(?:\\d+(?:\\.\\d+)?|\\.\\d+)';
const HEADER = new RegExp(`^${H}(xychart(?:-beta)?)(?:[\\t ]+(horizontal|vertical))?${H}$`);
const TITLE = new RegExp(`^${H}title[\\t ]+([^\\r\\n]+?)${H}$`);
const X_AXIS = new RegExp(`^${H}x-axis(?:[\\t ]+(\\"[^\\"\\r\\n]+\\"))?[\\t ]+(\\[[^\\r\\n]*\\]|${NUMBER}${H}-->${H}${NUMBER})${H}$`);
const Y_AXIS = new RegExp(`^${H}y-axis(?:[\\t ]+(\\"[^\\"\\r\\n]+\\"))?[\\t ]+(${NUMBER})${H}-->${H}(${NUMBER})${H}$`);
const SERIES = new RegExp(`^${H}(line|bar)(?:[\\t ]+(\\"[^\\"\\r\\n]+\\"))?[\\t ]+\\[([^\\]\\r\\n]+)\\]${H}$`);

/** True only for the deliberately editable Mermaid 11.16.1 XY subset. */
export function isXyChartDiagramSource(source: string): boolean { return parseXyChart(source) !== null; }
export function isXyChartSourceRepresentable(source: string): boolean { return parseXyChart(source) !== null; }
export function getXyChartDiagramSnapshot(source: string): XyChartDiagramSnapshot {
  const parsed = requireXyChart(source);
  return { ...(parsed.orientation ? { orientation: parsed.orientation } : {}), ...(parsed.title ? { title: parsed.title } : {}), xAxis: publicAxis(parsed.xAxis), yAxis: publicAxis(parsed.yAxis), series: parsed.series.map(publicSeries) };
}
export function createXyChartDiagram(xAxis: XyAxis, yAxis: XyAxis, orientation?: XyChartOrientation): string {
  const x = normalizeXAxis(xAxis); const y = normalizeYAxis(yAxis);
  return `xychart-beta${orientation ? ` ${orientation}` : ''}\n  ${formatXAxis(x)}\n  ${formatYAxis(y)}`;
}
export function getXySeriesIdentity(series: XySeries, all: readonly XySeries[] = []): XySeriesIdentity {
  return { ...publicSeries(series), occurrenceCount: all.length ? all.filter((entry) => sameSeries(entry, series)).length : 1 };
}
export function resolveXySeries(source: string, identity: XySeriesIdentity): XySeries { return publicSeries(resolveSeries(requireXyChart(source), identity)); }

export function editXyTitle(source: string, title?: string): string {
  const parsed = requireXyChart(source);
  if (title === undefined || title.trim() === '') return parsed.titleLine ? deleteLines(source, [parsed.titleLine]) : source;
  const value = text(title, 'XY titles');
  if (parsed.titleLine) return replaceAndValidate(source, parsed.titleLine, `${indent(parsed.titleLine)}title ${value}`);
  const next = insertAfter(source, parsed.header, `  title ${value}`); return requireXyChart(next), next;
}
export function setXyOrientation(source: string, orientation?: XyChartOrientation): string {
  const parsed = requireXyChart(source); if (orientation !== undefined && orientation !== 'horizontal' && orientation !== 'vertical') throw new Error('XY orientation must be horizontal or vertical.');
  if (parsed.orientation === orientation) return source;
  const match = sourceLineText(parsed.header).match(HEADER); if (!match) throw new Error('This source is not a safely representable XY chart.');
  const bom = parsed.header.start === 0 && parsed.header.text.startsWith('\uFEFF') ? '\uFEFF' : '';
  return replaceAndValidate(source, parsed.header, `${bom}${indent({ ...parsed.header, text: sourceLineText(parsed.header) })}${match[1]}${orientation ? ` ${orientation}` : ''}`);
}

export function editXyAxis(source: string, axis: 'x' | 'y', value: XyAxis): string {
  const parsed = requireXyChart(source); const next = axis === 'x' ? normalizeXAxis(value) : normalizeYAxis(value);
  validateSeries(parsed.series, axis === 'x' ? next : parsed.xAxis, axis === 'y' ? next : parsed.yAxis);
  const current = axis === 'x' ? parsed.xAxis : parsed.yAxis;
  return replaceAndValidate(source, current.line, `${indent(current.line)}${axis === 'x' ? formatXAxis(next) : formatYAxis(next)}`);
}
export function addXySeries(source: string, series: XySeries): string {
  const parsed = requireXyChart(source); const value = normalizeSeries(series); validateSeries([...parsed.series, value], parsed.xAxis, parsed.yAxis);
  return appendAndValidate(source, `${indentFor(parsed)}${formatSeries(value)}`);
}
export function editXySeries(source: string, identity: XySeriesIdentity, patch: Partial<XySeries>): string {
  const parsed = requireXyChart(source); const current = resolveSeries(parsed, identity); const value = normalizeSeries({ ...current, ...patch, values: patch.values ?? current.values });
  validateSeries(parsed.series.map((entry) => entry === current ? value : entry), parsed.xAxis, parsed.yAxis);
  return replaceAndValidate(source, current.line, `${indent(current.line)}${formatSeries(value)}`);
}
export function deleteXySeries(source: string, identity: XySeriesIdentity): string {
  const parsed = requireXyChart(source); return deleteLines(source, [resolveSeries(parsed, identity).line]);
}
/** Reorders one series while retaining line terminators at their physical offsets. */
export function moveXySeries(source: string, identity: XySeriesIdentity, direction: 'up' | 'down'): string {
  const parsed = requireXyChart(source); const current = resolveSeries(parsed, identity); const index = parsed.series.indexOf(current); const other = parsed.series[index + (direction === 'up' ? -1 : 1)];
  if (!other) return source;
  return swapLines(source, direction === 'up' ? other.line : current.line, direction === 'up' ? current.line : other.line);
}

function parseXyChart(source: string): Parsed | null {
  try {
    if (source.indexOf('\uFEFF') > 0 || hasUnexpectedWhitespace(source.startsWith('\uFEFF') ? source.slice(1) : source)) return null;
    const lines = splitLines(source); const headerIndex = firstStatement(lines); const header = lines[headerIndex]; const headerMatch = header && sourceLineText(header).match(HEADER);
    if (!headerMatch) return null;
    let title: string | undefined; let titleLine: Line | undefined; let xAxis: AxisRecord | undefined; let yAxis: AxisRecord | undefined; const series: SeriesRecord[] = [];
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]!; const text = sourceLineText(line); if (isBlank(text) || ignorable(text)) continue;
      const titleMatch = text.match(TITLE); if (titleMatch && title === undefined) { const value = titleMatch[1]!.trim(); if (value.includes('"')) return null; title = value; titleLine = line; continue; }
      const x = parseXAxis(text, line); if (x && !xAxis) { xAxis = x; continue; }
      const y = parseYAxis(text, line); if (y && !yAxis) { yAxis = y; continue; }
      const item = parseSeries(text, line); if (item) { series.push(item); continue; }
      return null;
    }
    if (!xAxis || !yAxis) return null;
    validateSeries(series, xAxis, yAxis);
    return { header, ...(headerMatch[2] ? { orientation: headerMatch[2] as XyChartOrientation } : {}), ...(title && titleLine ? { title, titleLine } : {}), xAxis, yAxis, series };
  } catch { return null; }
}
function parseXAxis(text: string, line: Line): AxisRecord | null {
  const match = text.match(X_AXIS); if (!match) return null; const label = unquote(match[1]); const data = match[2]!;
  if (data.startsWith('[')) {
    const labels = parseLabels(data); if (!labels) return null; return { line, ...(label ? { label } : {}), labels };
  }
  const range = parseRange(data); return range ? { line, ...(label ? { label } : {}), range } : null;
}
function parseYAxis(text: string, line: Line): AxisRecord | null {
  const match = text.match(Y_AXIS); if (!match) return null; const range = numericRange(Number(match[2]), Number(match[3]));
  return range ? { line, ...(unquote(match[1]) ? { label: unquote(match[1]) } : {}), range } : null;
}
function parseSeries(text: string, line: Line): SeriesRecord | null {
  const match = text.match(SERIES); if (!match) return null; const values = parseNumbers(match[3]!); if (!values) return null;
  return { line, kind: match[1] as XySeriesKind, ...(unquote(match[2]) ? { label: unquote(match[2]) } : {}), values };
}
function requireXyChart(source: string): Parsed { const parsed = parseXyChart(source); if (!parsed) throw new Error('This source is not a safely representable XY chart.'); return parsed; }
function resolveSeries(parsed: Parsed, identity: XySeriesIdentity): SeriesRecord {
  const matches = parsed.series.filter((entry) => sameSeries(entry, identity)); if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw stale(); return matches[0];
}
function validateSeries(series: readonly XySeries[], xAxis: XyAxis, yAxis: XyAxis): void {
  const range = yAxis.range; if (!range) throw new Error('The XY y-axis must have a numeric range.');
  for (const item of series) { const normalized = normalizeSeries(item); if (xAxis.labels && normalized.values.length !== xAxis.labels.length) throw new Error('XY series values must match the x-axis label count.'); if (normalized.values.some((value) => value < range[0] || value > range[1])) throw new Error('XY series values must remain within the y-axis range.'); }
}
function normalizeXAxis(value: XyAxis): XyAxis { const label = value.label === undefined ? undefined : text(value.label, 'XY x-axis labels'); if (value.labels && value.range) throw new Error('An XY x-axis cannot have both labels and a numeric range.'); if (value.labels) return { ...(label ? { label } : {}), labels: value.labels.map((item) => text(item, 'XY x-axis values')) };
  const range = value.range ? numericRange(value.range[0], value.range[1]) : null; if (!range) throw new Error('The XY x-axis needs labels or a numeric range.'); return { ...(label ? { label } : {}), range };
}
function normalizeYAxis(value: XyAxis): XyAxis { if (value.labels || !value.range) throw new Error('The XY y-axis needs a numeric range.'); const label = value.label === undefined ? undefined : text(value.label, 'XY y-axis labels'); return { ...(label ? { label } : {}), range: numericRange(value.range[0], value.range[1])! }; }
function normalizeSeries(value: XySeries): XySeries { if (value.kind !== 'line' && value.kind !== 'bar') throw new Error('XY series must be lines or bars.'); const values = parseNumbers(value.values.join(',')); if (!values?.length) throw new Error('XY series need finite numeric values.'); return { kind: value.kind, ...(value.label === undefined ? {} : { label: text(value.label, 'XY series labels') }), values }; }
function parseRange(value: string): [number, number] | null { const match = value.match(new RegExp(`^(${NUMBER})${H}-->${H}(${NUMBER})$`)); return match ? numericRange(Number(match[1]), Number(match[2])) : null; }
function numericRange(first: number, last: number): [number, number] | null { return Number.isFinite(first) && Number.isFinite(last) && first < last ? [first, last] : null; }
function parseNumbers(value: string): number[] | null { const parts = value.split(',').map((item) => item.trim()); if (!parts.length || parts.some((item) => !new RegExp(`^${NUMBER}$`).test(item))) return null; const numbers = parts.map(Number); return numbers.every(Number.isFinite) ? numbers : null; }
function parseLabels(value: string): string[] | null { const body = value.slice(1, -1); if (!body.trim()) return null; const parts = body.split(',').map((item) => item.trim()); if (parts.some((item) => !/^"[^"\r\n]+"$/.test(item))) return null; return parts.map((item) => item.slice(1, -1)); }
function publicAxis(axis: XyAxis): XyAxis { return { ...(axis.label ? { label: axis.label } : {}), ...(axis.labels ? { labels: [...axis.labels] } : {}), ...(axis.range ? { range: [...axis.range] as [number, number] } : {}) }; }
function publicSeries(series: XySeries): XySeries { return { kind: series.kind, ...(series.label ? { label: series.label } : {}), values: [...series.values] }; }
function formatXAxis(axis: XyAxis): string { return `x-axis${axis.label ? ` ${quote(axis.label)}` : ''} ${axis.labels ? `[${axis.labels.map(quote).join(', ')}]` : formatRange(axis.range!)}`; }
function formatYAxis(axis: XyAxis): string { return `y-axis${axis.label ? ` ${quote(axis.label)}` : ''} ${formatRange(axis.range!)}`; }
function formatSeries(series: XySeries): string { return `${series.kind}${series.label ? ` ${quote(series.label)}` : ''} [${series.values.map(formatNumber).join(', ')}]`; }
function formatRange(range: [number, number]): string { return `${formatNumber(range[0])} --> ${formatNumber(range[1])}`; }
function formatNumber(value: number): string { return Object.is(value, -0) ? '0' : String(value); }
function sameSeries(left: XySeries, right: XySeries): boolean { return left.kind === right.kind && left.label === right.label && left.values.length === right.values.length && left.values.every((value, index) => value === right.values[index]); }
function text(value: string, noun: string): string { const result = value.trim(); if (!result || /["\r\n]/.test(result)) throw new Error(`${noun} must be non-empty one-line Mermaid text.`); return result; }
function unquote(value: string | undefined): string | undefined { return value ? value.slice(1, -1) : undefined; }
function quote(value: string): string { return `\"${value}\"`; }
function stale(): Error { return new Error('XY series changed remotely and can no longer be resolved safely.'); }

function splitLines(source: string): Line[] { const lines: Line[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; lines.push({ start: match.index, end: match.index + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function sourceLineText(line: Line): string { return line.start === 0 ? line.text.replace(/^\uFEFF/, '') : line.text; }
function firstStatement(lines: readonly Line[]): number { let index = 0; if (lines[0] && sourceLineText(lines[0]) === '---') { const close = lines.findIndex((line, candidate) => candidate > 0 && sourceLineText(line) === '---'); index = close < 0 ? lines.length : close + 1; } while (index < lines.length && (isBlank(sourceLineText(lines[index]!)) || ignorable(sourceLineText(lines[index]!)))) index += 1; return index; }
function isBlank(value: string): boolean { return /^[\t ]*$/.test(value); }
function ignorable(value: string): boolean { return /^[\t ]*%%(?:\{.*\}%%)?[^\r\n]*$/.test(value); }
function hasUnexpectedWhitespace(value: string): boolean { return /[^\S\r\n\t ]/u.test(value); }
function indent(line: Line): string { return line.text.match(/^[\t ]*/)?.[0] ?? ''; }
function indentFor(parsed: Parsed): string { return indent(parsed.series[0]?.line ?? parsed.yAxis.line) || '  '; }
function terminator(line: Line): string { return line.raw.slice(line.text.length); }
function localEnding(source: string): string { return source.match(/\r\n|\n|\r/g)?.at(-1) ?? '\n'; }
function hasFinalEnding(source: string): boolean { return /(?:\r\n|\n|\r)$/.test(source); }
function append(source: string, statement: string): string { const ending = localEnding(source); return hasFinalEnding(source) ? `${source}${statement}${ending}` : `${source}${ending}${statement}`; }
function appendAndValidate(source: string, statement: string): string { const next = append(source, statement); return requireXyChart(next), next; }
function insertAfter(source: string, line: Line, statement: string): string { const ending = terminator(line) || localEnding(source); return terminator(line) ? `${source.slice(0, line.end)}${statement}${ending}${source.slice(line.end)}` : `${source.slice(0, line.end)}${ending}${statement}${source.slice(line.end)}`; }
function replaceLine(source: string, line: Line, value: string): string { return `${source.slice(0, line.start)}${value}${terminator(line)}${source.slice(line.end)}`; }
function replaceAndValidate(source: string, line: Line, value: string): string { const next = replaceLine(source, line, value); return requireXyChart(next), next; }
function deleteLines(source: string, lines: readonly Line[]): string { const hadFinal = hasFinalEnding(source); const next = [...lines].sort((left, right) => right.start - left.start).reduce((value, line) => `${value.slice(0, line.start)}${value.slice(line.end)}`, source); return !hadFinal && hasFinalEnding(next) ? next.replace(/(?:\r\n|\n|\r)$/, '') : next; }
function swapLines(source: string, left: Line, right: Line): string { const first = left.start < right.start ? left : right; const second = first === left ? right : left; return `${source.slice(0, first.start)}${second.text}${terminator(first)}${source.slice(first.end, second.start)}${first.text}${terminator(second)}${source.slice(second.end)}`; }
