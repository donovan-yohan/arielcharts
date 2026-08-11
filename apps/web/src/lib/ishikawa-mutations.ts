export interface IshikawaCause { ancestorLabels: string[]; depth: number; label: string; }
export interface IshikawaCauseIdentity { ancestorLabels: string[]; label: string; occurrenceCount: number; }
export interface IshikawaCauseInput { label: string; parent?: IshikawaCauseIdentity | null; }
export interface IshikawaDiagramSnapshot { causes: IshikawaCause[]; effect: string; }

interface Line { end: number; index: number; raw: string; start: number; text: string; }
interface CauseRecord extends IshikawaCause { line: Line; parent?: CauseRecord; }
interface Parsed { baseIndent: number; causes: CauseRecord[]; effect: Line; header: Line; lines: Line[]; }

const HEADER = /^\s*ishikawa(?:-beta)?\s*$/i;

export function isIshikawaDiagramSource(source: string): boolean { return parseIshikawa(source) !== null; }
export function isIshikawaSourceRepresentable(source: string): boolean { return parseIshikawa(source) !== null; }
export function getIshikawaDiagramSnapshot(source: string): IshikawaDiagramSnapshot { const parsed = requireIshikawa(source); return { effect: parsed.effect.text.trim(), causes: parsed.causes.map(publicCause) }; }

/** Creates Mermaid's indentation-based Ishikawa syntax with the maintained beta header. */
export function createIshikawaDiagram(effect: string): string { return `ishikawa-beta\n  ${normalizeLabel(effect)}`; }
export function editIshikawaEffect(source: string, effect: string): string { const parsed = requireIshikawa(source); return replaceLine(source, parsed.effect, `${indent(parsed.effect)}${normalizeLabel(effect)}`); }
export function setIshikawaEffect(source: string, effect: string): string { return source.trim() ? editIshikawaEffect(source, effect) : createIshikawaDiagram(effect); }

export function getIshikawaCauseIdentity(cause: IshikawaCause, causes: readonly IshikawaCause[] = []): IshikawaCauseIdentity {
  return { label: cause.label, ancestorLabels: [...cause.ancestorLabels], occurrenceCount: causes.length && !hasUniquePathPrefixes(cause, causes) ? 0 : (causes.length ? causes.filter((entry) => sameCause(entry, cause)).length : 1) };
}
export function resolveIshikawaCause(source: string, identity: IshikawaCauseIdentity): IshikawaCause {
  return publicCause(resolveCause(requireIshikawa(source), identity));
}
export function addIshikawaCause(source: string, value: IshikawaCauseInput): string {
  const parsed = requireIshikawa(source); const label = normalizeLabel(value.label); const parent = value.parent ? resolveCause(parsed, value.parent) : undefined;
  const indentation = parent ? `${indent(parent.line)}  ` : ' '.repeat(parsed.baseIndent);
  if (!parent) return append(source, `${indentation}${label}`);
  const afterParentSubtree = nextCauseAfter(parsed, subtree(parsed, parent).at(-1)!);
  if (!afterParentSubtree) return append(source, `${indentation}${label}`);
  const insertion = afterParentSubtree.line.start;
  const prefix = source.slice(0, insertion);
  const ending = lineEnding(source);
  const next = `${prefix}${prefix && !/(?:\r\n|\n|\r)$/.test(prefix) ? ending : ''}${indentation}${label}${ending}${source.slice(insertion)}`;
  return requireIshikawa(next), next;
}
export function editIshikawaCause(source: string, identity: IshikawaCauseIdentity, patch: Partial<Pick<IshikawaCause, 'label'>>): string {
  const parsed = requireIshikawa(source); const current = resolveCause(parsed, identity); const label = normalizeLabel(patch.label ?? current.label);
  return replaceLine(source, current.line, `${indent(current.line)}${label}`);
}
export function deleteIshikawaCause(source: string, identity: IshikawaCauseIdentity): string {
  const parsed = requireIshikawa(source); const current = resolveCause(parsed, identity); return deleteLines(source, subtree(parsed, current).map((entry) => entry.line));
}
/** Moves a cause together with its descendants, retaining line terminators at their physical offsets. */
export function moveIshikawaCause(source: string, identity: IshikawaCauseIdentity, direction: 'up' | 'down'): string {
  const parsed = requireIshikawa(source); const current = resolveCause(parsed, identity); const siblings = parsed.causes.filter((entry) => entry.parent === current.parent); const index = siblings.indexOf(current); const other = siblings[index + (direction === 'up' ? -1 : 1)]; if (!other) return source;
  const currentTree = subtree(parsed, current); const otherTree = subtree(parsed, other);
  const before = direction === 'up' ? other.line : nextCauseAfter(parsed, otherTree.at(-1)!)?.line;
  return moveRecords(source, parsed, currentTree, before);
}
/** Reparents a cause tree. Null makes it a root cause; descendants are never valid destinations. */
export function reparentIshikawaCause(source: string, identity: IshikawaCauseIdentity, parentIdentity: IshikawaCauseIdentity | null): string {
  const parsed = requireIshikawa(source); const current = resolveCause(parsed, identity); const parent = parentIdentity ? resolveCause(parsed, parentIdentity) : undefined;
  if (parent === current || (parent && subtree(parsed, current).includes(parent))) throw new Error('An Ishikawa cause cannot contain itself.');
  if (parent === current.parent) return source;
  const records = subtree(parsed, current); const targetDepth = parent ? parent.depth + 1 : 1;
  const rewritten = new Map(records.map((entry) => [entry.line.start, `${' '.repeat(parsed.baseIndent + (targetDepth + entry.depth - current.depth - 1) * 2)}${entry.label}`]));
  const before = parent ? nextCauseAfter(parsed, subtree(parsed, parent).at(-1)!)?.line : undefined;
  return moveRecords(source, parsed, records, before, rewritten);
}

function parseIshikawa(source: string): Parsed | null {
  const lines = splitLines(source); if (lines.some((line) => /^\s*%%\{/.test(line.text))) return null; const headerIndex = firstStatement(lines); const header = lines[headerIndex]; if (!header || !HEADER.test(header.text.replace(/^\uFEFF/, ''))) return null;
  const body = lines.slice(headerIndex + 1);
  const content = body.filter((line) => line.text.trim() && !ignorable(line.text)); const effect = content.shift(); if (!effect || /\t/.test(effect.text) || !effect.text.trim()) return null;
  const causes: CauseRecord[] = []; let baseIndent: number | undefined; const stack: CauseRecord[] = [];
  for (const line of content) {
    if (/\t/.test(line.text)) return null; const label = line.text.trim(); const indentation = indent(line).length;
    if (!label || label.startsWith('%%')) return null; baseIndent ??= indentation; if (indentation < baseIndent || (indentation - baseIndent) % 2) return null;
    const depth = 1 + (indentation - baseIndent) / 2; while (stack.length && stack.at(-1)!.depth >= depth) stack.pop(); const parent = stack.at(-1);
    if ((depth === 1 && parent) || (depth > 1 && (!parent || parent.depth !== depth - 1))) return null;
    const cause: CauseRecord = { label, depth, ancestorLabels: parent ? [...parent.ancestorLabels, parent.label] : [], ...(parent ? { parent } : {}), line };
    causes.push(cause); stack.push(cause);
  }
  return { baseIndent: baseIndent ?? indent(effect).length, causes, effect, header, lines };
}
function requireIshikawa(source: string): Parsed { const parsed = parseIshikawa(source); if (!parsed) throw new Error('This source is not a safely representable Ishikawa diagram.'); return parsed; }
function resolveCause(parsed: Parsed, identity: IshikawaCauseIdentity): CauseRecord { const matches = parsed.causes.filter((entry) => sameCause(entry, identity)); if (identity.occurrenceCount !== 1 || !hasUniquePathPrefixes(identity, parsed.causes) || matches.length !== 1 || !matches[0]) throw stale(); return matches[0]; }
function subtree(parsed: Parsed, root: CauseRecord): CauseRecord[] { const index = parsed.causes.indexOf(root); const result: CauseRecord[] = []; for (let candidate = index; candidate < parsed.causes.length; candidate += 1) { const item = parsed.causes[candidate]!; if (candidate !== index && item.depth <= root.depth) break; result.push(item); } return result; }
function nextCauseAfter(parsed: Parsed, last: CauseRecord): CauseRecord | undefined { return parsed.causes[parsed.causes.indexOf(last) + 1]; }
function publicCause(cause: CauseRecord): IshikawaCause { return { label: cause.label, depth: cause.depth, ancestorLabels: [...cause.ancestorLabels] }; }
function hasUniquePathPrefixes(cause: Pick<IshikawaCause, 'ancestorLabels' | 'label'>, causes: readonly IshikawaCause[]): boolean { const path = [...cause.ancestorLabels, cause.label]; return path.every((_part, length) => causes.filter((candidate) => { const candidatePath = [...candidate.ancestorLabels, candidate.label]; return candidatePath.length === length + 1 && candidatePath.every((part, index) => part === path[index]); }).length === 1); }
function sameCause(left: Pick<IshikawaCause, 'ancestorLabels' | 'label'>, right: Pick<IshikawaCause, 'ancestorLabels' | 'label'>): boolean { return left.label === right.label && left.ancestorLabels.length === right.ancestorLabels.length && left.ancestorLabels.every((value, index) => value === right.ancestorLabels[index]); }
function stale(): Error { return new Error('Ishikawa cause changed remotely and can no longer be resolved safely.'); }
function normalizeLabel(value: string): string { const label = value.trim(); if (!label || /[\r\n\t]/.test(label) || /^%%/.test(label)) throw new Error('Ishikawa labels must be non-empty one-line text.'); return label; }
function splitLines(source: string): Line[] { const lines: Line[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; lines.push({ index: lines.length, start: match.index, end: match.index + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function firstStatement(lines: readonly Line[]): number { let index = 0; if (lines[0]?.text.replace(/^\uFEFF/, '').trim() === '---') { const close = lines.findIndex((line, candidate) => candidate > 0 && line.text.trim() === '---'); index = close < 0 ? lines.length : close + 1; } while (index < lines.length && (!lines[index]!.text.trim() || ignorable(lines[index]!.text))) index += 1; return index; }
function ignorable(value: string): boolean { return /^\s*%%/.test(value); } function indent(line: Line): string { return line.text.match(/^\s*/)?.[0] ?? ''; } function lineEnding(source: string): string { return source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'; }
function append(source: string, statement: string): string { const ending = lineEnding(source); return `${source}${source && !/(?:\r\n|\n|\r)$/.test(source) ? ending : ''}${statement}`; }
function replaceLine(source: string, line: Line, value: string): string { return `${source.slice(0, line.start)}${value}${line.raw.slice(line.text.length)}${source.slice(line.end)}`; }
function deleteLines(source: string, lines: readonly Line[]): string { return [...lines].sort((left, right) => right.start - left.start).reduce((next, line) => `${next.slice(0, line.start)}${next.slice(line.end)}`, source); }
function moveRecords(source: string, parsed: Parsed, records: readonly CauseRecord[], before?: Line, rewritten = new Map<number, string>()): string {
  const endings = parsed.lines.map((line) => line.raw.slice(line.text.length)); const moved = new Set(records.map((entry) => entry.line.start)); const lines = parsed.lines.filter((line) => !moved.has(line.start)).map((line) => ({ ...line }));
  const insertion = before ? lines.findIndex((line) => line.start === before.start) : lines.length; const block = records.map((entry) => ({ ...entry.line, text: rewritten.get(entry.line.start) ?? entry.line.text }));
  lines.splice(insertion < 0 ? lines.length : insertion, 0, ...block); return lines.map((line, index) => `${line.text}${endings[index] ?? ''}`).join('');
}
