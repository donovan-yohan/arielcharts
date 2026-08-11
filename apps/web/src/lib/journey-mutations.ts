export interface JourneySection { label: string; }
export interface JourneyTask { actors: string[]; score: number; section: string; text: string; }
export interface JourneyTaskIdentity extends JourneyTask { index: number; occurrenceCount: number; }
export interface JourneyDiagramSnapshot { sections: JourneySection[]; tasks: JourneyTask[]; }

interface Line { end: number; raw: string; start: number; text: string; }
interface SectionRecord extends JourneySection { line: Line; }
interface TaskRecord extends JourneyTask { line: Line; }
interface Parsed { lines: Line[]; sections: SectionRecord[]; tasks: TaskRecord[]; }

const HEADER = /^\s*journey\s*$/i;
const SECTION = /^\s*section\s+([^:#;\r\n]+?)\s*$/i;
const TASK = /^\s*([^:#;\r\n]+?)\s*:\s*([1-5])\s*:\s*([^:#;\r\n]+?)\s*$/;
const TITLE = /^\s*title\s+[^\r\n]+$/i;

export function isJourneyDiagramSource(source: string): boolean { return parseJourney(source) !== null; }
export function isJourneySourceRepresentable(source: string): boolean { return parseJourney(source) !== null; }
export function getJourneyDiagramSnapshot(source: string): JourneyDiagramSnapshot {
  const parsed = requireJourney(source);
  return { sections: parsed.sections.map(({ label }) => ({ label })), tasks: parsed.tasks.map(publicTask) };
}

export function addJourneySection(source: string, section: JourneySection): string {
  const label = normalizeText(section.label, 'Journey section labels');
  if (!source.trim()) return `journey\n  section ${label}`;
  const parsed = requireJourney(source);
  if (parsed.sections.some((candidate) => candidate.label === label)) throw new Error(`A journey section named ${label} already exists.`);
  return append(source, `  section ${label}`);
}
export function editJourneySection(source: string, label: string, patch: Partial<JourneySection>): string {
  const parsed = requireJourney(source); const section = findSection(parsed, label);
  const next = normalizeText(patch.label ?? label, 'Journey section labels');
  if (next !== label && parsed.sections.some((candidate) => candidate.label === next)) throw new Error(`A journey section named ${next} already exists.`);
  return replaceLine(source, section.line, `${indent(section.line)}section ${next}`);
}
/** Reorders a complete authored section block without deriving durable order metadata. */
export function moveJourneySection(source: string, label: string, direction: 'up' | 'down'): string { const parsed = requireJourney(source); const index = parsed.sections.findIndex((section) => section.label === label); if (index < 0) throw new Error(`Journey section ${label} no longer exists.`); const other = parsed.sections[index + (direction === 'up' ? -1 : 1)]; if (!other) return source; return swapSectionBlocks(source, parsed.sections, direction === 'up' ? index - 1 : index); }
export function deleteJourneySection(source: string, label: string): string {
  const parsed = requireJourney(source); const section = findSection(parsed, label);
  return deleteLines(source, [section.line, ...parsed.tasks.filter((task) => task.section === label).map((task) => task.line)]);
}

export function addJourneyTask(source: string, task: JourneyTask): string {
  const next = normalizeTask(task);
  if (!source.trim()) return `journey\n  ${formatTask(next)}`;
  const parsed = requireJourney(source);
  if (next.section && !parsed.sections.some((section) => section.label === next.section)) throw new Error(`Journey section ${next.section} no longer exists.`);
  const section = next.section ? findSection(parsed, next.section) : null;
  const nextSection = section ? parsed.sections.find((candidate) => candidate.line.start > section.line.start) : parsed.sections[0];
  const offset = nextSection?.line.start ?? source.length;
  const ending = lineEnding(source);
  const prefix = source.slice(0, offset);
  const insertion = `${prefix && !/(?:\r\n|\n|\r)$/.test(prefix) ? ending : ''}${section ? indent(section.line) : '  '}${formatTask(next)}${ending}`;
  return `${source.slice(0, offset)}${insertion}${source.slice(offset)}`;
}
export function getJourneyTaskIdentity(task: JourneyTask, index: number, tasks: readonly JourneyTask[] = []): JourneyTaskIdentity {
  return { ...task, actors: [...task.actors], index, occurrenceCount: tasks.length ? tasks.filter((candidate) => sameTask(candidate, task)).length : 1 };
}
export function resolveJourneyTaskIndex(tasks: readonly JourneyTask[], identity: JourneyTaskIdentity): number {
  if (identity.occurrenceCount !== 1) throw stale();
  const matches = tasks.map((task, index) => ({ index, task })).filter(({ task }) => sameTask(task, identity));
  if (matches.length !== 1 || !matches[0]) throw stale();
  return matches[0].index;
}
export function editJourneyTask(source: string, identity: JourneyTaskIdentity, patch: Partial<JourneyTask>): string {
  const parsed = requireJourney(source); const current = parsed.tasks[resolveJourneyTaskIndex(parsed.tasks, identity)]; if (!current) throw stale();
  const next = normalizeTask({ ...current, ...patch, actors: patch.actors ?? current.actors });
  if (next.section && !parsed.sections.some((section) => section.label === next.section)) throw new Error(`Journey section ${next.section} no longer exists.`);
  if (next.section === current.section) return replaceLine(source, current.line, `${indent(current.line)}${formatTask(next)}`);
  const without = deleteLines(source, [current.line]);
  return addJourneyTask(without, next);
}
export function deleteJourneyTask(source: string, identity: JourneyTaskIdentity): string {
  const parsed = requireJourney(source); const task = parsed.tasks[resolveJourneyTaskIndex(parsed.tasks, identity)]; if (!task) throw stale();
  return deleteLines(source, [task.line]);
}
export function moveJourneyTask(source: string, identity: JourneyTaskIdentity, direction: 'up' | 'down'): string { const parsed = requireJourney(source); const index = resolveJourneyTaskIndex(parsed.tasks, identity); const task = parsed.tasks[index]; if (!task) throw stale(); const peers = parsed.tasks.filter((candidate) => candidate.section === task.section); const peerIndex = peers.findIndex((candidate) => candidate.line.start === task.line.start); const other = peers[peerIndex + (direction === 'up' ? -1 : 1)]; return !other ? source : swapLines(source, task.line, other.line); }

function parseJourney(source: string): Parsed | null {
  const lines = splitLines(source); const headerIndex = statementIndex(lines);
  if (!HEADER.test(lines[headerIndex]?.text.replace(/^\uFEFF/, '') ?? '')) return null;
  const sections: SectionRecord[] = []; const tasks: TaskRecord[] = []; let currentSection = '';
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!; const text = line.text;
    if (!text.trim() || ignorable(text) || TITLE.test(text)) continue;
    const section = text.match(SECTION);
    if (section) { const label = section[1]!.trim(); if (sections.some((entry) => entry.label === label)) return null; sections.push({ label, line }); currentSection = label; continue; }
    const task = text.match(TASK);
    if (task) { const actors = task[3]!.split(',').map((actor) => actor.trim()); if (!actors.length || actors.some((actor) => !actor)) return null; tasks.push({ text: task[1]!.trim(), score: Number(task[2]), actors, section: currentSection, line }); continue; }
    return null;
  }
  return { lines, sections, tasks };
}
function requireJourney(source: string): Parsed { const parsed = parseJourney(source); if (!parsed) throw new Error('This source is not a safely representable journey diagram.'); return parsed; }
function findSection(parsed: Parsed, label: string): SectionRecord { const section = parsed.sections.find((candidate) => candidate.label === label); if (!section) throw new Error(`Journey section ${label} no longer exists.`); return section; }
function publicTask(task: TaskRecord): JourneyTask { return { text: task.text, score: task.score, actors: [...task.actors], section: task.section }; }
function normalizeTask(task: JourneyTask): JourneyTask { const score = Number(task.score); if (!Number.isInteger(score) || score < 1 || score > 5) throw new Error('Journey scores must be whole numbers from 1 to 5.'); const actors = task.actors.map((actor) => normalizeText(actor, 'Journey actors')); if (!actors.length) throw new Error('Journey tasks require at least one actor.'); return { text: normalizeText(task.text, 'Journey task labels'), score, actors, section: task.section ? normalizeText(task.section, 'Journey section labels') : '' }; }
function sameTask(left: JourneyTask, right: JourneyTask): boolean { return left.text === right.text && left.score === right.score && left.section === right.section && left.actors.length === right.actors.length && left.actors.every((actor, index) => actor === right.actors[index]); }
function formatTask(task: JourneyTask): string { return `${task.text}: ${task.score}: ${task.actors.join(', ')}`; }
function stale(): Error { return new Error('Journey task changed remotely and can no longer be resolved safely.'); }
function normalizeText(value: string, noun: string): string { const text = value.trim(); if (!text || /[:#;\r\n]/.test(text)) throw new Error(`${noun} must be one-line Mermaid text.`); return text; }
function splitLines(source: string): Line[] { const lines: Line[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; lines.push({ start: match.index, end: match.index + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function statementIndex(lines: readonly Line[]): number { let start = 0; if (lines[0]?.text.replace(/^\uFEFF/, '').trim() === '---') { const close = lines.findIndex((line, index) => index > 0 && line.text.trim() === '---'); start = close < 0 ? lines.length : close + 1; } for (let index = start; index < lines.length; index += 1) if (lines[index]!.text.trim() && !ignorable(lines[index]!.text)) return index; return lines.length; }
function ignorable(value: string): boolean { return /^\s*%%/.test(value); }
function indent(line: Line): string { return line.text.match(/^\s*/)?.[0] ?? ''; }
function lineEnding(source: string): string { return source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'; }
function append(source: string, value: string): string { const ending = lineEnding(source); return `${source}${source && !/(?:\r\n|\n|\r)$/.test(source) ? ending : ''}${value}`; }
function replaceLine(source: string, line: Line, value: string): string { return `${source.slice(0, line.start)}${value}${line.raw.slice(line.text.length)}${source.slice(line.end)}`; }
function deleteLines(source: string, lines: readonly Line[]): string { return [...lines].sort((left, right) => right.start - left.start).reduce((next, line) => `${next.slice(0, line.start)}${next.slice(line.end)}`, source); }
function swapLines(source: string, left: Line, right: Line): string { const first = left.start < right.start ? left : right; const second = first === left ? right : left; return `${source.slice(0, first.start)}${second.text}${terminator(first)}${source.slice(first.end, second.start)}${first.text}${terminator(second)}${source.slice(second.end)}`; }
function terminator(line: Line): string { return line.raw.slice(line.text.length); }
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
