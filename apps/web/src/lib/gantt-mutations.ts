export type GanttStatus = 'active' | 'crit' | 'done' | 'milestone';
export interface GanttSection { label: string; }
export interface GanttTask { end: string; id: string; section: string; start: string; statuses: GanttStatus[]; text: string; }
export interface GanttTaskIdentity extends GanttTask { index: number; occurrenceCount: number; }
export interface GanttDiagramSnapshot { dateFormat: string; sections: GanttSection[]; tasks: GanttTask[]; }

interface Line { end: number; raw: string; start: number; text: string; }
interface SectionRecord extends GanttSection { line: Line; }
interface TaskRecord extends GanttTask { line: Line; }
interface Parsed { dateFormat: string; lines: Line[]; sections: SectionRecord[]; tasks: TaskRecord[]; }

const HEADER = /^\s*gantt\s*$/i;
const SECTION = /^\s*section\s+([^:#;\r\n]+?)\s*$/i;
const DATE_FORMAT = /^\s*dateFormat\s+([^#;\r\n]+?)\s*$/i;
const TITLE = /^\s*title\s+[^\r\n]+$/i;
const STATUSES: readonly GanttStatus[] = ['active', 'done', 'crit', 'milestone'];
const ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const DURATION = /^\d+(?:\.\d+)?(?:ms|[Mdhmswy])$/;
const AFTER = /^after\s+([A-Za-z_][A-Za-z0-9_-]*(?:\s+[A-Za-z_][A-Za-z0-9_-]*)*)$/i;

export function isGanttDiagramSource(source: string): boolean { return parseGantt(source) !== null; }
export function isGanttSourceRepresentable(source: string): boolean { return parseGantt(source) !== null; }
export function getGanttDiagramSnapshot(source: string): GanttDiagramSnapshot { const parsed = requireGantt(source); return { dateFormat: parsed.dateFormat, sections: parsed.sections.map(({ label }) => ({ label })), tasks: parsed.tasks.map(publicTask) }; }

export function addGanttSection(source: string, section: GanttSection): string {
  const label = normalizeText(section.label, 'Gantt section labels');
  if (!source.trim()) return `gantt\n  dateFormat YYYY-MM-DD\n  section ${label}`;
  const parsed = requireGantt(source); if (parsed.sections.some((candidate) => candidate.label === label)) throw new Error(`A Gantt section named ${label} already exists.`);
  return append(source, `  section ${label}`);
}
export function editGanttSection(source: string, label: string, patch: Partial<GanttSection>): string { const parsed = requireGantt(source); const section = findSection(parsed, label); const next = normalizeText(patch.label ?? label, 'Gantt section labels'); if (next !== label && parsed.sections.some((candidate) => candidate.label === next)) throw new Error(`A Gantt section named ${next} already exists.`); return replaceLine(source, section.line, `${indent(section.line)}section ${next}`); }
export function moveGanttSection(source: string, label: string, direction: 'up' | 'down'): string { const parsed = requireGantt(source); const index = parsed.sections.findIndex((section) => section.label === label); if (index < 0) throw new Error(`Gantt section ${label} no longer exists.`); const firstIndex = direction === 'up' ? index - 1 : index; if (firstIndex < 0 || !parsed.sections[firstIndex + 1]) return source; return swapSectionBlocks(source, parsed.sections, firstIndex); }
export function deleteGanttSection(source: string, label: string): string { const parsed = requireGantt(source); const section = findSection(parsed, label); const removed = new Set(parsed.tasks.filter((task) => task.section === label).map((task) => task.id)); if (parsed.tasks.some((task) => task.section !== label && dependencyIds(task).some((id) => removed.has(id)))) throw new Error('Cannot delete a Gantt section while remaining tasks depend on it.'); return deleteLines(source, [section.line, ...parsed.tasks.filter((task) => task.section === label).map((task) => task.line)]); }

export function addGanttTask(source: string, task: GanttTask): string {
  const next = normalizeTask(task);
  if (!source.trim()) {
    const candidate = `gantt\n  dateFormat YYYY-MM-DD\n  ${formatTask(next)}`;
    requireGantt(candidate);
    return candidate;
  }
  const parsed = requireGantt(source); assertTask(parsed, next);
  const section = next.section ? findSection(parsed, next.section) : null; const following = section ? parsed.sections.find((candidate) => candidate.line.start > section.line.start) : parsed.sections[0]; const offset = following?.line.start ?? source.length; const prefix = source.slice(0, offset); const ending = lineEnding(source);
  return `${prefix}${prefix && !/(?:\r\n|\n|\r)$/.test(prefix) ? ending : ''}${section ? indent(section.line) : '  '}${formatTask(next)}${ending}${source.slice(offset)}`;
}
export function getGanttTaskIdentity(task: GanttTask, index: number, tasks: readonly GanttTask[] = []): GanttTaskIdentity { return { ...task, statuses: [...task.statuses], index, occurrenceCount: tasks.length ? tasks.filter((candidate) => sameTask(candidate, task)).length : 1 }; }
export function resolveGanttTaskIndex(tasks: readonly GanttTask[], identity: GanttTaskIdentity): number { if (identity.occurrenceCount !== 1) throw stale(); const matches = tasks.map((task, index) => ({ index, task })).filter(({ task }) => sameTask(task, identity)); if (matches.length !== 1 || !matches[0]) throw stale(); return matches[0].index; }
export function editGanttTask(source: string, identity: GanttTaskIdentity, patch: Partial<GanttTask>): string {
  const parsed = requireGantt(source); const current = parsed.tasks[resolveGanttTaskIndex(parsed.tasks, identity)]; if (!current) throw stale();
  const next = normalizeTask({ ...current, ...patch, statuses: patch.statuses ?? current.statuses });
  if (next.id !== current.id && parsed.tasks.some((task) => task.id === next.id)) throw new Error(`A Gantt task named ${next.id} already exists.`);
  if (next.id !== current.id && parsed.tasks.some((task) => task.id !== current.id && dependencyIds(task).includes(current.id))) throw new Error('Cannot rename a Gantt task while another task depends on it.');
  if (next.section && !parsed.sections.some((section) => section.label === next.section)) throw new Error(`Gantt section ${next.section} no longer exists.`);
  if (next.section === current.section) { const candidate = replaceLine(source, current.line, `${indent(current.line)}${formatTask(next)}`); requireGantt(candidate); return candidate; }
  if (parsed.tasks.some((task) => task.id !== current.id && dependencyIds(task).includes(current.id))) throw new Error('Cannot move a Gantt task while another task depends on it.');
  return addGanttTask(deleteLines(source, [current.line]), next);
}
export function deleteGanttTask(source: string, identity: GanttTaskIdentity): string { const parsed = requireGantt(source); const task = parsed.tasks[resolveGanttTaskIndex(parsed.tasks, identity)]; if (!task) throw stale(); if (parsed.tasks.some((candidate) => candidate.id !== task.id && dependencyIds(candidate).includes(task.id))) throw new Error('Cannot delete a Gantt task while another task depends on it.'); return deleteLines(source, [task.line]); }
export function moveGanttTask(source: string, identity: GanttTaskIdentity, direction: 'up' | 'down'): string { const parsed = requireGantt(source); const index = resolveGanttTaskIndex(parsed.tasks, identity); const task = parsed.tasks[index]; if (!task) throw stale(); const peers = parsed.tasks.filter((candidate) => candidate.section === task.section); const peerIndex = peers.findIndex((candidate) => candidate.id === task.id); const other = peers[peerIndex + (direction === 'up' ? -1 : 1)]; if (!other) return source; if (dependencyIds(task).includes(other.id) || dependencyIds(other).includes(task.id)) throw new Error('Cannot reorder directly dependent Gantt tasks.'); return swapLines(source, task.line, other.line); }

function parseGantt(source: string): Parsed | null {
  const lines = splitLines(source); const headerIndex = statementIndex(lines); if (!HEADER.test(lines[headerIndex]?.text.replace(/^\uFEFF/, '') ?? '')) return null;
  const sections: SectionRecord[] = []; const tasks: TaskRecord[] = []; let section = ''; let dateFormat = 'YYYY-MM-DD';
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!; const text = line.text; if (!text.trim() || ignorable(text) || TITLE.test(text)) continue;
    const format = text.match(DATE_FORMAT); if (format) { if (dateFormat !== 'YYYY-MM-DD') return null; dateFormat = format[1]!.trim(); if (dateFormat !== 'YYYY-MM-DD') return null; continue; }
    const declaration = text.match(SECTION); if (declaration) { const label = declaration[1]!.trim(); if (sections.some((entry) => entry.label === label)) return null; sections.push({ label, line }); section = label; continue; }
    const task = parseTask(text, section, line); if (!task || tasks.some((candidate) => candidate.id === task.id)) return null; tasks.push(task);
  }
  for (const task of tasks) {
    const after = task.start.match(AFTER);
    if (after && after[1]!.split(/\s+/).some((id) => !tasks.some((candidate) => candidate.id === id))) return null;
  }
  if (hasDependencyCycle(tasks)) return null;
  return { dateFormat, lines, sections, tasks };
}
function parseTask(text: string, section: string, line: Line): TaskRecord | null {
  const match = text.match(/^\s*([^:#;\r\n]+?)\s*:\s*(.+)$/); if (!match) return null; const values = match[2]!.split(',').map((value) => value.trim()); const statuses: GanttStatus[] = [];
  while (values[0] && STATUSES.includes(values[0].toLowerCase() as GanttStatus)) { const status = values.shift()!.toLowerCase() as GanttStatus; if (statuses.includes(status)) return null; statuses.push(status); }
  if (values.length !== 3 || !ID.test(values[0] ?? '')) return null;
  const task: GanttTask = { text: match[1]!.trim(), statuses, id: values[0]!, start: values[1]!, end: values[2]!, section };
  try { return { ...normalizeTask(task), line }; } catch { return null; }
}
function requireGantt(source: string): Parsed { const parsed = parseGantt(source); if (!parsed) throw new Error('This source is not a safely representable Gantt diagram.'); return parsed; }
function findSection(parsed: Parsed, label: string): SectionRecord { const section = parsed.sections.find((candidate) => candidate.label === label); if (!section) throw new Error(`Gantt section ${label} no longer exists.`); return section; }
function publicTask(task: TaskRecord): GanttTask { return { text: task.text, id: task.id, start: task.start, end: task.end, statuses: [...task.statuses], section: task.section }; }
function normalizeTask(task: GanttTask): GanttTask {
  const statuses = [...new Set(task.statuses.map((status) => status.toLowerCase() as GanttStatus))]; if (statuses.length !== task.statuses.length || statuses.some((status) => !STATUSES.includes(status))) throw new Error('Unsupported Gantt status.');
  const id = task.id.trim(); if (!ID.test(id)) throw new Error('Gantt task ids must be Mermaid-safe identifiers.'); const start = task.start.trim(); const end = task.end.trim();
  if (!(DATE.test(start) || AFTER.test(start))) throw new Error('Gantt task starts must be YYYY-MM-DD dates or after dependencies.');
  if (!(DATE.test(end) || DURATION.test(end))) throw new Error('Gantt task ends must be YYYY-MM-DD dates or Mermaid durations.');
  if (DATE.test(start) && DATE.test(end) && end < start) throw new Error('Gantt task end dates cannot be earlier than their start dates.');
  if (statuses.includes('milestone') && !(end === '0d' || DATE.test(end))) throw new Error('Gantt milestones require a date or 0d duration.');
  return { text: normalizeText(task.text, 'Gantt task labels'), id, start, end, statuses, section: task.section ? normalizeText(task.section, 'Gantt section labels') : '' };
}
function assertTask(parsed: Parsed, task: GanttTask): void {
  if (parsed.tasks.some((candidate) => candidate.id === task.id)) throw new Error(`A Gantt task named ${task.id} already exists.`);
  if (task.section && !parsed.sections.some((section) => section.label === task.section)) throw new Error(`Gantt section ${task.section} no longer exists.`);
  const candidateTasks = [...parsed.tasks, task];
  const dependencies = dependencyIds(task);
  if (dependencies.some((id) => !candidateTasks.some((candidate) => candidate.id === id))) {
    throw new Error('Gantt task dependencies must reference existing tasks.');
  }
  if (hasDependencyCycle(candidateTasks)) throw new Error('Gantt task dependencies cannot contain cycles.');
}
function dependencyIds(task: Pick<GanttTask, 'start'>): string[] { return task.start.match(AFTER)?.[1]?.split(/\s+/) ?? []; }
function hasDependencyCycle(tasks: readonly Pick<GanttTask, 'id' | 'start'>[]): boolean {
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const visit = (id: string): boolean => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cycle = dependencyIds(byId.get(id) ?? { start: '' }).some(visit);
    visiting.delete(id);
    visited.add(id);
    return cycle;
  };
  return tasks.some((task) => visit(task.id));
}
function sameTask(left: GanttTask, right: GanttTask): boolean { return left.id === right.id && left.text === right.text && left.start === right.start && left.end === right.end && left.section === right.section && left.statuses.length === right.statuses.length && left.statuses.every((status, index) => status === right.statuses[index]); }
function formatTask(task: GanttTask): string { return `${task.text} : ${[...task.statuses, task.id, task.start, task.end].join(', ')}`; }
function stale(): Error { return new Error('Gantt task changed remotely and can no longer be resolved safely.'); }
function normalizeText(value: string, noun: string): string { const text = value.trim(); if (!text || /[:#;\r\n,]/.test(text)) throw new Error(`${noun} must be one-line Mermaid text.`); return text; }
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
