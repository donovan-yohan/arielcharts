export type TimelineDirection = 'LR' | 'TD';
export interface TimelineSection { label: string; }
export interface TimelinePeriod { label: string; section: string; }
export interface TimelineEvent { period: string; section: string; text: string; }
export interface TimelineEventIdentity extends TimelineEvent { index: number; occurrenceCount: number; }
export interface TimelineDiagramSnapshot { direction: TimelineDirection; events: TimelineEvent[]; periods: TimelinePeriod[]; sections: TimelineSection[]; }

interface Line { end: number; raw: string; start: number; text: string; }
interface SectionRecord extends TimelineSection { line: Line; }
interface PeriodRecord extends TimelinePeriod { line: Line; }
interface EventRecord extends TimelineEvent { line: Line; }
interface Parsed { direction: TimelineDirection; events: EventRecord[]; header: Line; lines: Line[]; periods: PeriodRecord[]; sections: SectionRecord[]; }

const HEADER = /^\s*timeline(?:\s+(LR|TD))?\s*$/i;
const SECTION = /^\s*section\s+([^:#;\r\n]+?)\s*$/i;
const PERIOD_WITH_EVENT = /^\s*([^:#;\r\n]+?)\s*:\s+([^:#;\r\n]+?)\s*$/;
const PERIOD = /^\s*([^:#;\r\n]+?)\s*$/;
const EVENT = /^\s*:\s+([^:#;\r\n]+?)\s*$/;
const TITLE = /^\s*title\s+[^\r\n]+$/i;

export function isTimelineDiagramSource(source: string): boolean { return parseTimeline(source) !== null; }
export function isTimelineSourceRepresentable(source: string): boolean { return parseTimeline(source) !== null; }
export function getTimelineDiagramSnapshot(source: string): TimelineDiagramSnapshot { const parsed = requireTimeline(source); return { direction: parsed.direction, sections: parsed.sections.map(({ label }) => ({ label })), periods: parsed.periods.map(publicPeriod), events: parsed.events.map(publicEvent) }; }
export function setTimelineDirection(source: string, direction: TimelineDirection): string { const parsed = requireTimeline(source); const next = normalizeDirection(direction); const prefix = parsed.header.text.startsWith('\uFEFF') ? '\uFEFF' : ''; return replaceLine(source, parsed.header, `${prefix}${indent(parsed.header)}timeline ${next}`); }

export function addTimelineSection(source: string, section: TimelineSection): string { const label = normalizeText(section.label, 'Timeline section labels'); if (!source.trim()) return `timeline LR\n  section ${label}`; const parsed = requireTimeline(source); if (parsed.sections.some((candidate) => candidate.label === label)) throw new Error(`A timeline section named ${label} already exists.`); return append(source, `  section ${label}`); }
export function editTimelineSection(source: string, label: string, patch: Partial<TimelineSection>): string { const parsed = requireTimeline(source); const section = findSection(parsed, label); const next = normalizeText(patch.label ?? label, 'Timeline section labels'); if (next !== label && parsed.sections.some((candidate) => candidate.label === next)) throw new Error(`A timeline section named ${next} already exists.`); return replaceLine(source, section.line, `${indent(section.line)}section ${next}`); }
export function moveTimelineSection(source: string, label: string, direction: 'up' | 'down'): string { const parsed = requireTimeline(source); const index = parsed.sections.findIndex((section) => section.label === label); if (index < 0) throw new Error(`Timeline section ${label} no longer exists.`); const firstIndex = direction === 'up' ? index - 1 : index; if (firstIndex < 0 || !parsed.sections[firstIndex + 1]) return source; return swapSectionBlocks(source, parsed.sections, firstIndex); }
export function deleteTimelineSection(source: string, label: string): string { const parsed = requireTimeline(source); const section = findSection(parsed, label); return deleteLines(source, [section.line, ...parsed.periods.filter((period) => period.section === label).flatMap((period) => [period.line, ...parsed.events.filter((event) => event.period === period.label).map((event) => event.line)])]); }

export function addTimelinePeriod(source: string, period: TimelinePeriod): string { const next = normalizePeriod(period); if (!source.trim()) return `timeline LR\n  ${next.label}`; const parsed = requireTimeline(source); assertPeriod(parsed, next); if (!next.section) return append(source, `  ${next.label}`); const section = findSection(parsed, next.section); const following = parsed.sections.find((candidate) => candidate.line.start > section.line.start); const offset = following?.line.start ?? source.length; const prefix = source.slice(0, offset); const ending = lineEnding(source); return `${prefix}${prefix && !/(?:\r\n|\n|\r)$/.test(prefix) ? ending : ''}${indent(section.line)}${next.label}${ending}${source.slice(offset)}`; }
export function editTimelinePeriod(source: string, label: string, patch: Partial<TimelinePeriod>): string {
  const parsed = requireTimeline(source);
  const current = findPeriod(parsed, label);
  const next = normalizePeriod({ ...current, ...patch });
  if (next.label !== label && parsed.periods.some((period) => period.label === next.label)) {
    throw new Error(`A timeline period named ${next.label} already exists.`);
  }

  const renamed = next.label === label
    ? source
    : replaceLine(source, current.line, replacePeriodLabel(current.line, next.label));
  return next.section === current.section
    ? renamed
    : moveTimelinePeriod(renamed, next.label, next.section);
}
export function deleteTimelinePeriod(source: string, label: string): string { const parsed = requireTimeline(source); const period = findPeriod(parsed, label); return deleteLines(source, [period.line, ...parsed.events.filter((event) => event.period === label).map((event) => event.line)]); }
/** Moves the source block for a period and its events; no derived ordering metadata is persisted. */
export function moveTimelinePeriod(source: string, label: string, section: string): string {
  const parsed = requireTimeline(source);
  const period = findPeriod(parsed, label);
  const destination = section ? normalizeText(section, 'Timeline section labels') : '';
  const nextSection = destination ? findSection(parsed, destination) : null;
  if (period.section === destination) return source;

  const statements = [...parsed.sections.map((entry) => entry.line), ...parsed.periods.map((entry) => entry.line)]
    .sort((left, right) => left.start - right.start);
  const currentIndex = statements.findIndex((line) => line.start === period.line.start);
  const blockEnd = currentIndex >= 0 ? (statements[currentIndex + 1]?.start ?? source.length) : source.length;
  const block = source.slice(period.line.start, blockEnd);
  const without = `${source.slice(0, period.line.start)}${source.slice(blockEnd)}`;
  const refreshed = requireTimeline(without);
  const offset = nextSection
    ? (refreshed.sections.find((candidate) => candidate.line.start > findSection(refreshed, nextSection.label).line.start)?.line.start ?? without.length)
    : (refreshed.sections[0]?.line.start ?? without.length);
  const before = without.slice(0, offset);
  const ending = lineEnding(without);
  const normalizedBlock = /(?:\r\n|\n|\r)$/.test(block) ? block : `${block}${ending}`;
  return `${before}${before && !/(?:\r\n|\n|\r)$/.test(before) ? ending : ''}${normalizedBlock}${without.slice(offset)}`;
}

export function addTimelineEvent(source: string, event: TimelineEvent): string { const parsed = requireTimeline(source); const next = normalizeEvent(event); const period = findPeriod(parsed, next.period); if (period.section !== next.section) throw new Error('Timeline events must remain in their period section.'); const laterStatements = [...parsed.periods.map((entry) => entry.line), ...parsed.sections.map((entry) => entry.line)].filter((line) => line.start > period.line.start).sort((left, right) => left.start - right.start); const offset = laterStatements[0]?.start ?? source.length; const before = source.slice(0, offset); const ending = lineEnding(source); return `${before}${before && !/(?:\r\n|\n|\r)$/.test(before) ? ending : ''}${indent(period.line)}  : ${next.text}${ending}${source.slice(offset)}`; }
export function getTimelineEventIdentity(event: TimelineEvent, index: number, events: readonly TimelineEvent[] = []): TimelineEventIdentity { return { ...event, index, occurrenceCount: events.length ? events.filter((candidate) => sameEvent(candidate, event)).length : 1 }; }
export function resolveTimelineEventIndex(events: readonly TimelineEvent[], identity: TimelineEventIdentity): number { if (identity.occurrenceCount !== 1) throw stale(); const matches = events.map((event, index) => ({ index, event })).filter(({ event }) => sameEvent(event, identity)); if (matches.length !== 1 || !matches[0]) throw stale(); return matches[0].index; }
export function editTimelineEvent(source: string, identity: TimelineEventIdentity, patch: Partial<TimelineEvent>): string { const parsed = requireTimeline(source); const current = parsed.events[resolveTimelineEventIndex(parsed.events, identity)]; if (!current) throw stale(); const next = normalizeEvent({ ...current, ...patch }); if (next.period !== current.period) { const without = deleteLines(source, [current.line]); return addTimelineEvent(without, next); } if (next.section !== current.section) throw new Error('Timeline events must remain in their period section.'); const period = findPeriod(parsed, current.period); return current.line.start === period.line.start ? replaceLine(source, current.line, replaceEventText(current.line, next.text)) : replaceLine(source, current.line, `${indent(current.line)}: ${next.text}`); }
export function deleteTimelineEvent(source: string, identity: TimelineEventIdentity): string {
  const parsed = requireTimeline(source);
  const event = parsed.events[resolveTimelineEventIndex(parsed.events, identity)];
  if (!event) throw stale();
  const period = findPeriod(parsed, event.period);
  return event.line.start === period.line.start
    ? replaceLine(source, event.line, `${indent(period.line)}${period.label}`)
    : deleteLines(source, [event.line]);
}
export function moveTimelineEvent(source: string, identity: TimelineEventIdentity, direction: 'up' | 'down'): string { const parsed = requireTimeline(source); const index = resolveTimelineEventIndex(parsed.events, identity); const event = parsed.events[index]; if (!event) throw stale(); const peers = parsed.events.filter((candidate) => candidate.period === event.period); const peerIndex = peers.findIndex((candidate) => candidate.line.start === event.line.start); const other = peers[peerIndex + (direction === 'up' ? -1 : 1)]; if (!other) return source; const period = findPeriod(parsed, event.period); return event.line.start === period.line.start || other.line.start === period.line.start ? swapEventTexts(source, event.line, event.text, other.line, other.text) : swapLines(source, event.line, other.line); }

function parseTimeline(source: string): Parsed | null {
  const lines = splitLines(source); const headerIndex = statementIndex(lines); const match = lines[headerIndex]?.text.replace(/^\uFEFF/, '').match(HEADER); if (!match || !lines[headerIndex]) return null; const direction = (match[1]?.toUpperCase() as TimelineDirection | undefined) ?? 'LR'; const sections: SectionRecord[] = []; const periods: PeriodRecord[] = []; const events: EventRecord[] = []; let section = ''; let period: PeriodRecord | null = null;
  for (let index = headerIndex + 1; index < lines.length; index += 1) { const line = lines[index]!; const text = line.text; if (!text.trim() || ignorable(text) || TITLE.test(text)) continue; if (/^\s*acc(?:Title|Descr)\b/i.test(text)) return null; const declaredSection = text.match(SECTION); if (declaredSection) { const label = declaredSection[1]!.trim(); if (sections.some((entry) => entry.label === label)) return null; const value = { label, line }; sections.push(value); section = label; period = null; continue; } const continued = text.match(EVENT); if (continued) { if (!period) return null; events.push({ period: period.label, section, text: continued[1]!.trim(), line }); continue; } const inline = text.match(PERIOD_WITH_EVENT); if (inline) { const label = inline[1]!.trim(); if (!label || periods.some((entry) => entry.label === label)) return null; period = { label, section, line }; periods.push(period); events.push({ period: period.label, section, text: inline[2]!.trim(), line }); continue; } const periodOnly = text.match(PERIOD); if (!periodOnly) return null; const label = periodOnly[1]!.trim(); if (periods.some((entry) => entry.label === label)) return null; period = { label, section, line }; periods.push(period); }
  return { direction, header: lines[headerIndex], lines, sections, periods, events };
}
function requireTimeline(source: string): Parsed { const parsed = parseTimeline(source); if (!parsed) throw new Error('This source is not a safely representable timeline diagram.'); return parsed; }
function findSection(parsed: Parsed, label: string): SectionRecord { const section = parsed.sections.find((candidate) => candidate.label === label); if (!section) throw new Error(`Timeline section ${label} no longer exists.`); return section; }
function findPeriod(parsed: Parsed, label: string): PeriodRecord { const period = parsed.periods.find((candidate) => candidate.label === label); if (!period) throw new Error(`Timeline period ${label} no longer exists.`); return period; }
function publicPeriod(period: PeriodRecord): TimelinePeriod { return { label: period.label, section: period.section }; }
function publicEvent(event: EventRecord): TimelineEvent { return { period: event.period, section: event.section, text: event.text }; }
function normalizeDirection(value: TimelineDirection): TimelineDirection { if (value !== 'LR' && value !== 'TD') throw new Error('Timeline direction must be LR or TD.'); return value; }
function normalizePeriod(period: TimelinePeriod): TimelinePeriod { return { label: normalizeText(period.label, 'Timeline period labels'), section: period.section ? normalizeText(period.section, 'Timeline section labels') : '' }; }
function normalizeEvent(event: TimelineEvent): TimelineEvent { return { period: normalizeText(event.period, 'Timeline period labels'), section: event.section ? normalizeText(event.section, 'Timeline section labels') : '', text: normalizeText(event.text, 'Timeline event labels') }; }
function assertPeriod(parsed: Parsed, period: TimelinePeriod): void { if (parsed.periods.some((candidate) => candidate.label === period.label)) throw new Error(`A timeline period named ${period.label} already exists.`); if (period.section && !parsed.sections.some((candidate) => candidate.label === period.section)) throw new Error(`Timeline section ${period.section} no longer exists.`); }
function sameEvent(left: TimelineEvent, right: TimelineEvent): boolean { return left.period === right.period && left.section === right.section && left.text === right.text; }
function stale(): Error { return new Error('Timeline event changed remotely and can no longer be resolved safely.'); }
function normalizeText(value: string, noun: string): string { const text = value.trim(); if (!text || /[:#;\r\n]/.test(text)) throw new Error(`${noun} must be one-line Mermaid text.`); return text; }
function splitLines(source: string): Line[] { const lines: Line[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; lines.push({ start: match.index, end: match.index + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function statementIndex(lines: readonly Line[]): number { let start = 0; if (lines[0]?.text.replace(/^\uFEFF/, '').trim() === '---') { const close = lines.findIndex((line, index) => index > 0 && line.text.trim() === '---'); start = close < 0 ? lines.length : close + 1; } for (let index = start; index < lines.length; index += 1) if (lines[index]!.text.trim() && !ignorable(lines[index]!.text)) return index; return lines.length; }
function ignorable(value: string): boolean { return /^\s*%%/.test(value); }
function indent(line: Line): string { return line.text.replace(/^\uFEFF/, '').match(/^\s*/)?.[0] ?? ''; }
function lineEnding(source: string): string { return source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'; }
function append(source: string, value: string): string { const ending = lineEnding(source); return `${source}${source && !/(?:\r\n|\n|\r)$/.test(source) ? ending : ''}${value}`; }
function replaceLine(source: string, line: Line, value: string): string { return `${source.slice(0, line.start)}${value}${line.raw.slice(line.text.length)}${source.slice(line.end)}`; }
function deleteLines(source: string, lines: readonly Line[]): string { return [...lines].sort((left, right) => right.start - left.start).reduce((next, line) => `${next.slice(0, line.start)}${next.slice(line.end)}`, source); }
function swapLines(source: string, left: Line, right: Line): string { const first = left.start < right.start ? left : right; const second = first === left ? right : left; return `${source.slice(0, first.start)}${second.raw}${source.slice(first.end, second.start)}${first.raw}${source.slice(second.end)}`; }
function swapSectionBlocks(source: string, sections: readonly SectionRecord[], firstIndex: number): string {
  const first = sections[firstIndex]; const second = sections[firstIndex + 1];
  if (!first || !second) return source;
  const end = sections[firstIndex + 2]?.line.start ?? source.length;
  const firstBlock = source.slice(first.line.start, second.line.start);
  const secondBlock = source.slice(second.line.start, end);
  const separator = /(?:\r\n|\n|\r)$/.test(secondBlock) || /^(?:\r\n|\n|\r)/.test(firstBlock) ? '' : lineEnding(source);
  const swapped = `${source.slice(0, first.line.start)}${secondBlock}${separator}${firstBlock}${source.slice(end)}`;
  return /(?:\r\n|\n|\r)$/.test(source) ? swapped : swapped.replace(/(?:\r\n|\n|\r)$/, '');
}
function swapEventTexts(source: string, left: Line, leftText: string, right: Line, rightText: string): string { return replaceLines(source, [{ line: left, text: replaceEventText(left, rightText) }, { line: right, text: replaceEventText(right, leftText) }]); }
function replaceEventText(line: Line, text: string): string { const match = line.text.match(/^(\s*(?:[^:#;\r\n]+?\s*)?:\s+)[^\r\n]*$/); if (!match) throw stale(); return `${match[1]}${text}`; }
function replacePeriodLabel(line: Line, label: string): string { const match = line.text.match(/^(\s*)[^:#;\r\n]+?(\s*(?::\s+.*)?)$/); if (!match) throw stale(); return `${match[1]}${label}${match[2]}`; }
function replaceLines(source: string, values: readonly { line: Line; text: string }[]): string { return [...values].sort((left, right) => right.line.start - left.line.start).reduce((next, value) => replaceLine(next, value.line, value.text), source); }
