export type RadarGraticule = 'circle' | 'polygon';
export interface RadarAxis { label?: string; name: string; }
export interface RadarCurve { label?: string; name: string; values: number[]; }
export interface RadarAxisIdentity extends RadarAxis { occurrenceCount: number; }
export interface RadarCurveIdentity extends RadarCurve { occurrenceCount: number; }
export interface RadarOptions { graticule?: RadarGraticule; max?: number; min?: number; showLegend?: boolean; ticks?: number; }
export interface RadarDiagramSnapshot { axes: RadarAxis[]; curves: RadarCurve[]; options: RadarOptions; title?: string; }

interface Line { end: number; raw: string; start: number; text: string; }
interface AxisRecord extends RadarAxis { line: Line; }
interface CurveRecord extends RadarCurve { line: Line; }
interface OptionRecord { line: Line; name: keyof RadarOptions; value: boolean | number | RadarGraticule; }
interface Parsed { axes: AxisRecord[]; curves: CurveRecord[]; header: Line; options: Map<keyof RadarOptions, OptionRecord>; title?: string; titleLine?: Line; }

const H = '[\\t ]*';
const NUMBER = '(?:0|[1-9]\\d*)(?:\\.\\d+)?';
const ID = '[A-Za-z0-9_](?:[-A-Za-z0-9_]*[A-Za-z0-9_])?';
const QUOTED = '\\"[^\\"\\r\\n]+\\"';
const HEADER = new RegExp(`^${H}radar-beta:?${H}$`);
const AXIS = new RegExp(`^${H}axis[\\t ]+(${ID})(?:${H}\\[(${QUOTED})\\])?${H}$`);
const CURVE = new RegExp(`^${H}curve[\\t ]+(${ID})(?:${H}\\[(${QUOTED})\\])?${H}\\{${H}(${NUMBER}(?:${H},${H}${NUMBER})*)${H}\\}${H}$`);
const TITLE = new RegExp(`^${H}title[\\t ]+([^\\r\\n]+?)${H}$`);
const OPTIONS: Record<keyof RadarOptions, RegExp> = {
  showLegend: new RegExp(`^${H}showLegend[\\t ]+(true|false)${H}$`),
  ticks: new RegExp(`^${H}ticks[\\t ]+(${NUMBER})${H}$`),
  min: new RegExp(`^${H}min[\\t ]+(${NUMBER})${H}$`),
  max: new RegExp(`^${H}max[\\t ]+(${NUMBER})${H}$`),
  graticule: new RegExp(`^${H}graticule[\\t ]+(circle|polygon)${H}$`),
};

/** True only for the single-line, numeric Radar grammar subset rendered by Mermaid 11.16.1. */
export function isRadarDiagramSource(source: string): boolean { return parseRadar(source) !== null; }
export function isRadarSourceRepresentable(source: string): boolean { return parseRadar(source) !== null; }
export function getRadarDiagramSnapshot(source: string): RadarDiagramSnapshot {
  const parsed = requireRadar(source); return { ...(parsed.title ? { title: parsed.title } : {}), axes: parsed.axes.map(publicAxis), curves: parsed.curves.map(publicCurve), options: publicOptions(parsed.options) };
}
export function createRadarDiagram(axes: readonly RadarAxis[]): string {
  const normalized = axes.map(normalizeAxis); validateAxes(normalized); return ['radar-beta', ...normalized.map((axis) => `  ${formatAxis(axis)}`)].join('\n');
}
export function getRadarAxisIdentity(axis: RadarAxis, all: readonly RadarAxis[] = []): RadarAxisIdentity { return { ...publicAxis(axis), occurrenceCount: all.length ? all.filter((item) => sameAxis(item, axis)).length : 1 }; }
export function getRadarCurveIdentity(curve: RadarCurve, all: readonly RadarCurve[] = []): RadarCurveIdentity { return { ...publicCurve(curve), occurrenceCount: all.length ? all.filter((item) => sameCurve(item, curve)).length : 1 }; }
export function resolveRadarAxis(source: string, identity: RadarAxisIdentity): RadarAxis { return publicAxis(resolveAxis(requireRadar(source), identity)); }
export function resolveRadarCurve(source: string, identity: RadarCurveIdentity): RadarCurve { return publicCurve(resolveCurve(requireRadar(source), identity)); }

export function editRadarTitle(source: string, title?: string): string {
  const parsed = requireRadar(source);
  if (title === undefined || title.trim() === '') return parsed.titleLine ? deleteLines(source, [parsed.titleLine]) : source;
  const value = radarTitle(title);
  if (parsed.title === value) return source;
  if (parsed.titleLine) return replaceAndValidate(source, parsed.titleLine, `${indent(parsed.titleLine)}title ${value}`);
  const next = insertAfter(source, parsed.header, `  title ${value}`); return requireRadar(next), next;
}

export function addRadarAxis(source: string, axis: RadarAxis, values?: readonly number[]): string {
  const parsed = requireRadar(source); const value = normalizeAxis(axis); if (parsed.axes.some((entry) => entry.name === value.name)) throw new Error(`A Radar axis named ${value.name} already exists.`);
  if (parsed.curves.length && (!values || values.length !== parsed.curves.length)) throw new Error('Adding an axis with curves needs one value for every curve.');
  const nextAxes = [...parsed.axes, value]; const nextCurves = parsed.curves.map((curve, index) => ({ ...curve, values: [...curve.values, Number(values?.[index])] })); validateRadar(nextAxes, nextCurves, publicOptions(parsed.options));
  const insertion = parsed.curves[0]?.line ?? firstOption(parsed)?.line; const axisLine = `${indentFor(parsed)}${formatAxis(value)}`;
  const changes = nextCurves.map((curve, index) => ({ line: parsed.curves[index]!.line, value: `${indent(parsed.curves[index]!.line)}${formatCurve(curve)}` }));
  const rewritten = replaceLines(source, changes); const next = insertion ? insertBefore(rewritten, findLineByStart(splitLines(rewritten), insertion.start)!, axisLine) : append(rewritten, axisLine); return requireRadar(next), next;
}
export function editRadarAxis(source: string, identity: RadarAxisIdentity, patch: Partial<RadarAxis>): string {
  const parsed = requireRadar(source); const current = resolveAxis(parsed, identity); const value = normalizeAxis({ ...current, ...patch }); if (value.name !== current.name && parsed.axes.some((item) => item !== current && item.name === value.name)) throw new Error(`A Radar axis named ${value.name} already exists.`);
  return replaceAndValidate(source, current.line, `${indent(current.line)}${formatAxis(value)}`);
}
export function deleteRadarAxis(source: string, identity: RadarAxisIdentity): string {
  const parsed = requireRadar(source); const current = resolveAxis(parsed, identity); const index = parsed.axes.indexOf(current); const axes = parsed.axes.filter((item) => item !== current); if (axes.length < 3) throw new Error('Radar charts need at least three axes.');
  const curves = parsed.curves.map((curve) => ({ ...curve, values: curve.values.filter((_value, valueIndex) => valueIndex !== index) })); validateRadar(axes, curves, publicOptions(parsed.options));
  const changes = curves.map((curve, curveIndex) => ({ line: parsed.curves[curveIndex]!.line, value: `${indent(parsed.curves[curveIndex]!.line)}${formatCurve(curve)}` }));
  const next = applyLineEdits(source, [...changes, { line: current.line }]); return requireRadar(next), next;
}
/** Reorders axes and their corresponding positional curve values atomically. */
export function moveRadarAxis(source: string, identity: RadarAxisIdentity, direction: 'up' | 'down'): string {
  const parsed = requireRadar(source); const current = resolveAxis(parsed, identity); const index = parsed.axes.indexOf(current); const otherIndex = index + (direction === 'up' ? -1 : 1); if (otherIndex < 0 || otherIndex >= parsed.axes.length) return source;
  const curves = parsed.curves.map((curve) => { const values = [...curve.values]; [values[index], values[otherIndex]] = [values[otherIndex]!, values[index]!]; return { ...curve, values }; });
  const changes = curves.map((curve, curveIndex) => ({ line: parsed.curves[curveIndex]!.line, value: `${indent(parsed.curves[curveIndex]!.line)}${formatCurve(curve)}` })); const rewritten = replaceLines(source, changes);
  const refreshed = requireRadar(rewritten); return swapLines(rewritten, refreshed.axes[Math.min(index, otherIndex)]!.line, refreshed.axes[Math.max(index, otherIndex)]!.line);
}
export function addRadarCurve(source: string, curve: RadarCurve): string { const parsed = requireRadar(source); const value = normalizeCurve(curve); if (parsed.curves.some((item) => item.name === value.name)) throw new Error(`A Radar curve named ${value.name} already exists.`); validateRadar(parsed.axes, [...parsed.curves, value], publicOptions(parsed.options)); return appendAndValidate(source, `${indentFor(parsed)}${formatCurve(value)}`); }
export function editRadarCurve(source: string, identity: RadarCurveIdentity, patch: Partial<RadarCurve>): string { const parsed = requireRadar(source); const current = resolveCurve(parsed, identity); const value = normalizeCurve({ ...current, ...patch, values: patch.values ?? current.values }); if (value.name !== current.name && parsed.curves.some((item) => item !== current && item.name === value.name)) throw new Error(`A Radar curve named ${value.name} already exists.`); validateRadar(parsed.axes, parsed.curves.map((item) => item === current ? value : item), publicOptions(parsed.options)); return replaceAndValidate(source, current.line, `${indent(current.line)}${formatCurve(value)}`); }
export function deleteRadarCurve(source: string, identity: RadarCurveIdentity): string { const parsed = requireRadar(source); return deleteLines(source, [resolveCurve(parsed, identity).line]); }
export function moveRadarCurve(source: string, identity: RadarCurveIdentity, direction: 'up' | 'down'): string { const parsed = requireRadar(source); const current = resolveCurve(parsed, identity); const index = parsed.curves.indexOf(current); const other = parsed.curves[index + (direction === 'up' ? -1 : 1)]; return other ? swapLines(source, direction === 'up' ? other.line : current.line, direction === 'up' ? current.line : other.line) : source; }
export function editRadarOptions(source: string, patch: Partial<RadarOptions>): string {
  const parsed = requireRadar(source); const names = Object.keys(patch) as (keyof RadarOptions)[]; const options = { ...publicOptions(parsed.options) };
  for (const name of names) { const value = patch[name]; if (value === undefined) delete options[name]; else Object.assign(options, { [name]: value }); }
  const normalized = normalizeOptions(options); validateRadar(parsed.axes, parsed.curves, normalized);
  const changes: { line: Line; value?: string }[] = [];
  for (const name of names) {
    const current = parsed.options.get(name); const value = normalized[name];
    if (value === undefined) { if (current) changes.push({ line: current.line }); continue; }
    if (current && current.value !== value) changes.push({ line: current.line, value: `${indent(current.line)}${formatOption(name, value)}` });
  }
  let next = applyLineEdits(source, changes);
  for (const name of names) { const value = normalized[name]; if (value !== undefined && !parsed.options.has(name)) next = append(next, `${indentFor(parsed)}${formatOption(name, value)}`); }
  return requireRadar(next), next;
}

function parseRadar(source: string): Parsed | null {
  try {
    if (source.indexOf('\uFEFF') > 0 || hasUnexpectedWhitespace(source.startsWith('\uFEFF') ? source.slice(1) : source)) return null;
    const lines = splitLines(source); const headerIndex = firstStatement(lines); const header = lines[headerIndex]; if (!header || !HEADER.test(sourceLineText(header))) return null;
    const axes: AxisRecord[] = []; const curves: CurveRecord[] = []; const options = new Map<keyof RadarOptions, OptionRecord>(); let title: string | undefined; let titleLine: Line | undefined;
    for (let index = headerIndex + 1; index < lines.length; index += 1) { const line = lines[index]!; const text = sourceLineText(line); if (isBlank(text) || ignorable(text)) continue; const titleMatch = text.match(TITLE); if (titleMatch && title === undefined) { title = radarTitle(titleMatch[1]!); titleLine = line; continue; }
      const axis = parseAxis(text, line); if (axis) { axes.push(axis); continue; } const curve = parseCurve(text, line); if (curve) { curves.push(curve); continue; } const option = parseOption(text, line); if (option && !options.has(option.name)) { options.set(option.name, option); continue; } return null;
    }
    validateRadar(axes, curves, publicOptions(options)); return { header, axes, curves, options, ...(title && titleLine ? { title, titleLine } : {}) };
  } catch { return null; }
}
function parseAxis(text: string, line: Line): AxisRecord | null { const match = text.match(AXIS); return match ? { line, name: match[1]!, ...(match[2] ? { label: unquote(match[2]!) } : {}) } : null; }
function parseCurve(text: string, line: Line): CurveRecord | null { const match = text.match(CURVE); const values = match && parseNumbers(match[3]!); return match && values ? { line, name: match[1]!, ...(match[2] ? { label: unquote(match[2]!) } : {}), values } : null; }
function parseOption(text: string, line: Line): OptionRecord | null { for (const name of Object.keys(OPTIONS) as (keyof RadarOptions)[]) { const match = text.match(OPTIONS[name]); if (!match) continue; const value = name === 'showLegend' ? match[1] === 'true' : name === 'graticule' ? match[1] as RadarGraticule : Number(match[1]); return { line, name, value }; } return null; }
function requireRadar(source: string): Parsed { const parsed = parseRadar(source); if (!parsed) throw new Error('This source is not a safely representable Radar diagram.'); return parsed; }
function resolveAxis(parsed: Parsed, identity: RadarAxisIdentity): AxisRecord { const matches = parsed.axes.filter((item) => sameAxis(item, identity)); if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw stale('axis'); return matches[0]; }
function resolveCurve(parsed: Parsed, identity: RadarCurveIdentity): CurveRecord { const matches = parsed.curves.filter((item) => sameCurve(item, identity)); if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw stale('curve'); return matches[0]; }
function validateRadar(axes: readonly RadarAxis[], curves: readonly RadarCurve[], options: RadarOptions): void { validateAxes(axes); const normalized = normalizeOptions(options); if (normalized.min !== undefined && normalized.max !== undefined && normalized.min >= normalized.max) throw new Error('Radar min must be below max.'); for (const curve of curves) { const value = normalizeCurve(curve); if (value.values.length !== axes.length) throw new Error('Radar curve values must match the axis count.'); const min = normalized.min ?? 0; if (value.values.some((entry) => entry < min || (normalized.max !== undefined && entry > normalized.max))) throw new Error('Radar values must remain within the configured range.'); } }
function validateAxes(axes: readonly RadarAxis[]): void { if (axes.length < 3) throw new Error('Radar charts need at least three axes.'); const names = new Set<string>(); for (const axis of axes) { const value = normalizeAxis(axis); if (names.has(value.name)) throw new Error('Radar axis names must be unique.'); names.add(value.name); } }
function normalizeAxis(axis: RadarAxis): RadarAxis { const name = axis.name.trim(); if (!new RegExp(`^${ID}$`).test(name)) throw new Error('Radar axis names must be Mermaid identifiers.'); return { name, ...(axis.label === undefined ? {} : { label: label(axis.label, 'Radar axis labels') }) }; }
function normalizeCurve(curve: RadarCurve): RadarCurve { const name = curve.name.trim(); if (!new RegExp(`^${ID}$`).test(name)) throw new Error('Radar curve names must be Mermaid identifiers.'); if (!curve.values.length || curve.values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('Radar values must be finite non-negative numbers.'); return { name, ...(curve.label === undefined ? {} : { label: label(curve.label, 'Radar curve labels') }), values: [...curve.values] }; }
function normalizeOptions(options: RadarOptions): RadarOptions { const result: RadarOptions = { ...options }; if (result.min !== undefined && (!Number.isFinite(result.min) || result.min < 0)) throw new Error('Radar min must be a non-negative number.'); if (result.max !== undefined && (!Number.isFinite(result.max) || result.max < 0)) throw new Error('Radar max must be a non-negative number.'); if (result.ticks !== undefined && (!Number.isInteger(result.ticks) || result.ticks < 1 || result.ticks > 32)) throw new Error('Radar ticks must be an integer from 1 through 32.'); if (result.graticule !== undefined && result.graticule !== 'circle' && result.graticule !== 'polygon') throw new Error('Radar graticules are circles or polygons.'); return result; }
function parseNumbers(value: string): number[] | null { const values = value.split(',').map((item) => item.trim()); if (!values.length || values.some((item) => !new RegExp(`^${NUMBER}$`).test(item))) return null; const result = values.map(Number); return result.every((item) => Number.isFinite(item) && item >= 0) ? result : null; }
function publicAxis(axis: RadarAxis): RadarAxis { return { name: axis.name, ...(axis.label ? { label: axis.label } : {}) }; }
function publicCurve(curve: RadarCurve): RadarCurve { return { name: curve.name, ...(curve.label ? { label: curve.label } : {}), values: [...curve.values] }; }
function publicOptions(options: ReadonlyMap<keyof RadarOptions, OptionRecord>): RadarOptions { return Object.fromEntries([...options.entries()].map(([name, item]) => [name, item.value])) as RadarOptions; }
function formatAxis(axis: RadarAxis): string { return `axis ${axis.name}${axis.label ? ` [${quote(axis.label)}]` : ''}`; }
function formatCurve(curve: RadarCurve): string { return `curve ${curve.name}${curve.label ? ` [${quote(curve.label)}]` : ''} { ${curve.values.map(formatNumber).join(', ')} }`; }
function formatOption(name: keyof RadarOptions, value: NonNullable<RadarOptions[keyof RadarOptions]>): string { return `${name} ${value}`; }
function sameAxis(left: RadarAxis, right: RadarAxis): boolean { return left.name === right.name && left.label === right.label; }
function sameCurve(left: RadarCurve, right: RadarCurve): boolean { return left.name === right.name && left.label === right.label && left.values.length === right.values.length && left.values.every((item, index) => item === right.values[index]); }
function radarTitle(value: string): string { const result = value.trim(); if (!result || /[\r\n]/u.test(result) || result.includes('%%')) throw new Error('Radar titles must be non-empty one-line Mermaid text without inline comments.'); return result; }
function label(value: string, noun: string): string { const result = value.trim(); if (!result || /[\r\n]/u.test(result) || result.includes('[') || result.includes(']') || result.includes('"') || result.includes("'")) throw new Error(`${noun} must be non-empty quoted-safe text.`); return result; }
function unquote(value: string): string { return value.slice(1, -1); }
function quote(value: string): string { return `\"${value}\"`; }
function formatNumber(value: number): string { return Object.is(value, -0) ? '0' : String(value); }
function stale(kind: string): Error { return new Error(`Radar ${kind} changed remotely and can no longer be resolved safely.`); }

function splitLines(source: string): Line[] { const lines: Line[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; lines.push({ start: match.index, end: match.index + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function sourceLineText(line: Line): string { return line.start === 0 ? line.text.replace(/^\uFEFF/, '') : line.text; }
function firstStatement(lines: readonly Line[]): number { let index = 0; if (lines[0] && sourceLineText(lines[0]) === '---') { const close = lines.findIndex((line, candidate) => candidate > 0 && sourceLineText(line) === '---'); index = close < 0 ? lines.length : close + 1; } while (index < lines.length && (isBlank(sourceLineText(lines[index]!)) || ignorable(sourceLineText(lines[index]!)))) index += 1; return index; }
function isBlank(value: string): boolean { return /^[\t ]*$/.test(value); }
function ignorable(value: string): boolean { return /^[\t ]*%%(?:\{.*\}%%)?[^\r\n]*$/.test(value); }
function hasUnexpectedWhitespace(value: string): boolean { return /[^\S\r\n\t ]/u.test(value); }
function indent(line: Line): string { return line.text.match(/^[\t ]*/)?.[0] ?? ''; }
function indentFor(parsed: Parsed): string { return indent(parsed.axes[0]?.line ?? parsed.header) || '  '; }
function firstOption(parsed: Parsed): OptionRecord | undefined { return [...parsed.options.values()].sort((left, right) => left.line.start - right.line.start)[0]; }
function terminator(line: Line): string { return line.raw.slice(line.text.length); }
function localEnding(source: string): string { return source.match(/\r\n|\n|\r/g)?.at(-1) ?? '\n'; }
function hasFinalEnding(source: string): boolean { return /(?:\r\n|\n|\r)$/.test(source); }
function append(source: string, statement: string): string { const ending = localEnding(source); return hasFinalEnding(source) ? `${source}${statement}${ending}` : `${source}${ending}${statement}`; }
function appendAndValidate(source: string, statement: string): string { const next = append(source, statement); return requireRadar(next), next; }
function insertAfter(source: string, line: Line, statement: string): string { const ending = terminator(line) || localEnding(source); return terminator(line) ? `${source.slice(0, line.end)}${statement}${ending}${source.slice(line.end)}` : `${source.slice(0, line.end)}${ending}${statement}${source.slice(line.end)}`; }
function insertBefore(source: string, before: Line, statement: string): string { const prefix = source.slice(0, before.start); const ending = localEnding(prefix || source); return `${prefix}${prefix && !hasFinalEnding(prefix) ? ending : ''}${statement}${ending}${source.slice(before.start)}`; }
function replaceLine(source: string, line: Line, value: string): string { return `${source.slice(0, line.start)}${value}${terminator(line)}${source.slice(line.end)}`; }
function replaceAndValidate(source: string, line: Line, value: string): string { const next = replaceLine(source, line, value); return requireRadar(next), next; }
function replaceLines(source: string, values: readonly { line: Line; value: string }[]): string { return [...values].sort((left, right) => right.line.start - left.line.start).reduce((next, item) => replaceLine(next, item.line, item.value), source); }
function applyLineEdits(source: string, edits: readonly { line: Line; value?: string }[]): string { const hadFinal = hasFinalEnding(source); const next = [...edits].sort((left, right) => right.line.start - left.line.start).reduce((value, edit) => `${value.slice(0, edit.line.start)}${edit.value === undefined ? '' : `${edit.value}${terminator(edit.line)}`}${value.slice(edit.line.end)}`, source); return !hadFinal && hasFinalEnding(next) ? next.replace(/(?:\r\n|\n|\r)$/, '') : next; }
function deleteLines(source: string, lines: readonly Line[]): string { const hadFinal = hasFinalEnding(source); const next = [...lines].sort((left, right) => right.start - left.start).reduce((value, line) => `${value.slice(0, line.start)}${value.slice(line.end)}`, source); return !hadFinal && hasFinalEnding(next) ? next.replace(/(?:\r\n|\n|\r)$/, '') : next; }
function swapLines(source: string, left: Line, right: Line): string { const first = left.start < right.start ? left : right; const second = first === left ? right : left; return `${source.slice(0, first.start)}${second.text}${terminator(first)}${source.slice(first.end, second.start)}${first.text}${terminator(second)}${source.slice(second.end)}`; }
function findLineByStart(lines: readonly Line[], start: number): Line | undefined { return lines.find((line) => line.start === start); }
