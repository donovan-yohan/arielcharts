export type C4DiagramKind = 'C4Component' | 'C4Container' | 'C4Context';
export type C4ElementKind =
  | 'Component' | 'ComponentDb' | 'ComponentDb_Ext' | 'Component_Ext'
  | 'Container' | 'ContainerDb' | 'ContainerDb_Ext' | 'Container_Ext'
  | 'Person' | 'Person_Ext' | 'System' | 'SystemDb' | 'SystemDb_Ext' | 'System_Ext';
export type C4BoundaryKind = 'Boundary' | 'Container_Boundary' | 'Enterprise_Boundary' | 'System_Boundary';

export interface C4Element { id: string; kind: C4ElementKind; label: string; parentId?: string; description?: string; technology?: string; }
export interface C4Boundary { id: string; kind: C4BoundaryKind; label: string; parentId?: string; }
export interface C4Relationship { from: string; label: string; technology?: string; to: string; }
/** A relationship is safe to target only when its semantic fingerprint is unique. */
export interface C4RelationshipIdentity extends C4Relationship { index: number; occurrenceCount: number; }
export interface C4DiagramSnapshot { boundaries: C4Boundary[]; elements: C4Element[]; kind: C4DiagramKind; relationships: C4Relationship[]; }

interface SourceLine { end: number; raw: string; start: number; text: string; }
interface ElementRecord extends C4Element { line: SourceLine; }
interface BoundaryRecord extends C4Boundary { close: SourceLine; line: SourceLine; }
interface RelationshipRecord extends C4Relationship { line: SourceLine; }
interface ParsedC4 { boundaries: BoundaryRecord[]; elements: ElementRecord[]; kind: C4DiagramKind; relationships: RelationshipRecord[]; }

const HEADER = /^(C4Context|C4Container|C4Component)$/i;
const ID = '[A-Za-z_][A-Za-z0-9_-]*';
const idPattern = new RegExp(`^${ID}$`);
const ELEMENT_KINDS: readonly C4ElementKind[] = ['Person', 'Person_Ext', 'System', 'System_Ext', 'SystemDb', 'SystemDb_Ext', 'Container', 'Container_Ext', 'ContainerDb', 'ContainerDb_Ext', 'Component', 'Component_Ext', 'ComponentDb', 'ComponentDb_Ext'];
const BOUNDARY_KINDS: readonly C4BoundaryKind[] = ['Boundary', 'Enterprise_Boundary', 'System_Boundary', 'Container_Boundary'];
const ELEMENT = new RegExp(`^\\s*(${ELEMENT_KINDS.join('|')})\\(\\s*(${ID})\\s*,\\s*"([^"\\r\\n]*)"(?:\\s*,\\s*"([^"\\r\\n]*)")?(?:\\s*,\\s*"([^"\\r\\n]*)")?\\s*\\)\\s*$`, 'i');
const BOUNDARY = new RegExp(`^\\s*(${BOUNDARY_KINDS.join('|')})\\(\\s*(${ID})\\s*,\\s*"([^"\\r\\n]*)"\\s*\\)\\s*\\{\\s*$`, 'i');
const RELATIONSHIP = new RegExp(`^\\s*Rel\\(\\s*(${ID})\\s*,\\s*(${ID})\\s*,\\s*"([^"\\r\\n]*)"(?:\\s*,\\s*"([^"\\r\\n]*)")?\\s*\\)\\s*$`, 'i');

export function isC4DiagramSource(source: string): boolean { return parseC4(source) !== null; }
/** C4 deliberately exposes a stable source subset; all other valid Mermaid stays source-only. */
export function isC4SourceRepresentable(source: string): boolean { return parseC4(source) !== null; }
export function getC4DiagramSnapshot(source: string): C4DiagramSnapshot {
  const parsed = requireC4(source);
  return { kind: parsed.kind, elements: parsed.elements.map(publicElement), boundaries: parsed.boundaries.map(publicBoundary), relationships: parsed.relationships.map(publicRelationship) };
}

export function addC4Element(source: string, element: C4Element): string {
  const next = normalizeElement(element);
  if (!source.trim()) return `C4Context\n  ${formatElement(next)}`;
  const parsed = requireC4(source);
  const id = uniqueId(next.id, parsed.elements.map((entry) => entry.id).concat(parsed.boundaries.map((entry) => entry.id)));
  if (!element.parentId) return append(source, `  ${formatElement({ ...next, id })}`);
  const parent = findBoundary(parsed, element.parentId); return `${source.slice(0, parent.close.start)}${indent(parent.line)}  ${formatElement({ ...next, id })}${lineEnding(source)}${source.slice(parent.close.start)}`;
}
export function editC4Element(source: string, id: string, patch: Partial<C4Element>): string {
  const parsed = requireC4(source); const current = findElement(parsed, id); const next = normalizeElement({ ...current, ...patch });
  if (next.id !== id && hasId(parsed, next.id)) throw new Error(`A C4 item named ${next.id} already exists.`);
  return replaceValues(source, [
    { line: current.line, value: `${indent(current.line)}${formatElement(next)}` },
    ...parsed.relationships.filter((relationship) => next.id !== id && (relationship.from === id || relationship.to === id)).map((relationship) => ({ line: relationship.line, value: `${indent(relationship.line)}${formatRelationship({ ...relationship, from: relationship.from === id ? next.id : relationship.from, to: relationship.to === id ? next.id : relationship.to })}` })),
  ]);
}
export function deleteC4Element(source: string, id: string): string {
  const parsed = requireC4(source); const element = findElement(parsed, id);
  return deleteLines(source, [element.line, ...parsed.relationships.filter((relationship) => relationship.from === id || relationship.to === id).map((relationship) => relationship.line)]);
}
export function moveC4Element(source: string, id: string, parentId: string | null): string { const parsed = requireC4(source); const element = findElement(parsed, id); if ((element.parentId ?? null) === parentId) return source; const without = deleteLines(source, [element.line]); if (!parentId) return append(without, `  ${formatElement(element)}`); const parent = findBoundary(requireC4(without), parentId); return `${without.slice(0, parent.close.start)}${indent(parent.line)}  ${formatElement(element)}${lineEnding(without)}${without.slice(parent.close.start)}`; }
export function moveC4Boundary(source: string, id: string, parentId: string | null): string {
  const parsed = requireC4(source); const boundary = findBoundary(parsed, id);
  if ((boundary.parentId ?? null) === parentId) return source;
  if (parentId === id || (parentId && isBoundaryDescendant(parsed, parentId, id))) throw new Error('A C4 boundary cannot contain itself.');
  const fragment = source.slice(boundary.line.start, boundary.close.end);
  const without = deleteLines(source, [{ start: boundary.line.start, end: boundary.close.end, raw: '', text: '' }]);
  if (!parentId) return append(without, reindent(fragment, indent(boundary.line), '  '));
  const parent = findBoundary(requireC4(without), parentId);
  const targetIndent = `${indent(parent.line)}  `;
  return `${without.slice(0, parent.close.start)}${reindent(fragment, indent(boundary.line), targetIndent)}${lineEnding(without)}${without.slice(parent.close.start)}`;
}
export function addC4Boundary(source: string, boundary: C4Boundary): string { const parsed = requireC4(source); const next = normalizeBoundary(boundary); const id = uniqueId(next.id, parsed.elements.map((entry) => entry.id).concat(parsed.boundaries.map((entry) => entry.id))); const statement = `${next.kind}(${id}, ${quote(next.label)}) {\n  }`; if (!boundary.parentId) return append(source, `  ${statement}`); const parent = findBoundary(parsed, boundary.parentId); return `${source.slice(0, parent.close.start)}${indent(parent.line)}  ${statement.replace(/\n/g, `\n${indent(parent.line)}  `)}${lineEnding(source)}${source.slice(parent.close.start)}`; }
export function editC4Boundary(source: string, id: string, patch: Partial<C4Boundary>): string { const parsed = requireC4(source); const current = findBoundary(parsed, id); const next = normalizeBoundary({ ...current, ...patch }); if (next.id !== id && hasId(parsed, next.id)) throw new Error(`A C4 item named ${next.id} already exists.`); return replace(source, current.line, `${indent(current.line)}${next.kind}(${next.id}, ${quote(next.label)}) {`); }
export function deleteC4Boundary(source: string, id: string): string { const parsed = requireC4(source); const boundary = findBoundary(parsed, id); const containedIds = new Set(parsed.elements.filter((element) => element.line.start > boundary.line.start && element.line.end < boundary.close.end).map((element) => element.id)); return deleteLines(source, [{ start: boundary.line.start, end: boundary.close.end, raw: '', text: '' }, ...parsed.relationships.filter((relationship) => containedIds.has(relationship.from) || containedIds.has(relationship.to)).map((relationship) => relationship.line)]); }
export function addC4Relationship(source: string, relationship: C4Relationship): string {
  const parsed = requireC4(source); const next = normalizeRelationship(relationship); assertRelationship(parsed, next);
  if (parsed.relationships.some((candidate) => sameRelationship(candidate, next))) throw new Error('An identical C4 relationship already exists.');
  return append(source, `  ${formatRelationship(next)}`);
}
export function getC4RelationshipIdentity(relationship: C4Relationship, index: number, relationships: readonly C4Relationship[] = []): C4RelationshipIdentity {
  return { ...relationship, index, occurrenceCount: relationships.length ? relationships.filter((candidate) => sameRelationship(candidate, relationship)).length : 1 };
}
export function resolveC4RelationshipIndex(relationships: readonly C4Relationship[], identity: C4RelationshipIdentity): number {
  if (identity.occurrenceCount !== 1) throw stale();
  const matches = relationships.map((relationship, index) => ({ index, relationship })).filter(({ relationship }) => sameRelationship(relationship, identity));
  if (matches.length !== 1 || !matches[0]) throw stale();
  return matches[0].index;
}
export function editC4Relationship(source: string, identity: C4RelationshipIdentity, patch: Partial<C4Relationship>): string {
  const parsed = requireC4(source); const index = resolveC4RelationshipIndex(parsed.relationships, identity); const current = parsed.relationships[index];
  if (!current) throw stale(); const next = normalizeRelationship({ ...current, ...patch }); assertRelationship(parsed, next);
  if (!sameRelationship(current, next) && parsed.relationships.some((candidate) => sameRelationship(candidate, next))) throw new Error('An identical C4 relationship already exists.');
  return replace(source, current.line, `${indent(current.line)}${formatRelationship(next)}`);
}
export function deleteC4Relationship(source: string, identity: C4RelationshipIdentity): string {
  const parsed = requireC4(source); const current = parsed.relationships[resolveC4RelationshipIndex(parsed.relationships, identity)]; if (!current) throw stale(); return deleteLines(source, [current.line]);
}

function parseC4(source: string): ParsedC4 | null {
  const lines = splitLines(source); const first = firstStatementIndex(lines); const headerLine = lines.find((line, index) => index >= first && line.text.trim() && !ignorable(line.text));
  const match = headerLine?.text.trim().match(HEADER); if (!match) return null;
  const kind = (['C4Context', 'C4Container', 'C4Component'] as const).find((candidate) => candidate.toLowerCase() === match[1]!.toLowerCase()); if (!kind) return null;
  const elements: ElementRecord[] = []; const boundaries: BoundaryRecord[] = []; const relationships: RelationshipRecord[] = []; const stack: { close?: SourceLine; id: string; kind: C4BoundaryKind; label: string; line: SourceLine; parentId?: string }[] = [];
  let afterHeader = false;
  for (const line of lines) {
    if (line === headerLine) { afterHeader = true; continue; } if (!afterHeader || !line.text.trim() || ignorable(line.text)) continue;
    if (/^\s*}\s*$/.test(line.text)) { const open = stack.pop(); if (!open) return null; open.close = line; boundaries.push({ id: open.id, kind: open.kind, label: open.label, ...(open.parentId ? { parentId: open.parentId } : {}), line: open.line, close: line }); continue; }
    const boundary = line.text.match(BOUNDARY); if (boundary) { const boundaryKind = canonical(BOUNDARY_KINDS, boundary[1]!); if (!boundaryKind || hasId({ elements, boundaries: [...boundaries, ...(stack as BoundaryRecord[])] }, boundary[2]!)) return null; stack.push({ kind: boundaryKind, id: boundary[2]!, label: boundary[3]!, parentId: stack.at(-1)?.id, line }); continue; }
    const element = line.text.match(ELEMENT); if (element) { const elementKind = canonical(ELEMENT_KINDS, element[1]!); const id = element[2]!; if (!elementKind || hasId({ elements, boundaries: [...boundaries, ...(stack as BoundaryRecord[])] }, id)) return null; const extras = [element[4], element[5]].filter((value): value is string => value !== undefined); const [technology, description] = elementHasTechnology(elementKind) ? [extras[0], extras[1]] : [undefined, extras[0]]; elements.push({ id, kind: elementKind, label: element[3]!, ...(stack.at(-1)?.id ? { parentId: stack.at(-1)!.id } : {}), ...(technology ? { technology } : {}), ...(description ? { description } : {}), line }); continue; }
    const relationship = line.text.match(RELATIONSHIP); if (relationship) { relationships.push({ from: relationship[1]!, to: relationship[2]!, label: relationship[3]!, ...(relationship[4] ? { technology: relationship[4] } : {}), line }); continue; }
    return null;
  }
  if (stack.length || relationships.some((relationship) => !elements.some((element) => element.id === relationship.from) || !elements.some((element) => element.id === relationship.to))) return null;
  return { kind, elements, boundaries, relationships };
}
function requireC4(source: string): ParsedC4 { const parsed = parseC4(source); if (!parsed) throw new Error('This source is not a safely representable C4 diagram.'); return parsed; }
function findElement(parsed: ParsedC4, id: string): ElementRecord { const element = parsed.elements.find((candidate) => candidate.id === id); if (!element) throw new Error(`C4 item ${id} no longer exists.`); return element; }
function findBoundary(parsed: ParsedC4, id: string): BoundaryRecord { const boundary = parsed.boundaries.find((candidate) => candidate.id === id); if (!boundary) throw new Error(`C4 boundary ${id} no longer exists.`); return boundary; }
function isBoundaryDescendant(parsed: ParsedC4, candidateId: string, ancestorId: string): boolean { let current = parsed.boundaries.find((boundary) => boundary.id === candidateId); while (current?.parentId) { if (current.parentId === ancestorId) return true; current = parsed.boundaries.find((boundary) => boundary.id === current!.parentId); } return false; }
function hasId(parsed: Pick<ParsedC4, 'elements' | 'boundaries'>, id: string): boolean { return parsed.elements.some((entry) => entry.id === id) || parsed.boundaries.some((entry) => entry.id === id); }
function publicElement(element: ElementRecord): C4Element { return { id: element.id, kind: element.kind, label: element.label, ...(element.parentId ? { parentId: element.parentId } : {}), ...(element.technology ? { technology: element.technology } : {}), ...(element.description ? { description: element.description } : {}) }; }
function publicBoundary(boundary: BoundaryRecord): C4Boundary { return { id: boundary.id, kind: boundary.kind, label: boundary.label, ...(boundary.parentId ? { parentId: boundary.parentId } : {}) }; }
function publicRelationship(relationship: RelationshipRecord): C4Relationship { return { from: relationship.from, to: relationship.to, label: relationship.label, ...(relationship.technology ? { technology: relationship.technology } : {}) }; }
function normalizeElement(value: C4Element): C4Element { const kind = canonical(ELEMENT_KINDS, value.kind); if (!kind) throw new Error('Unsupported C4 element kind.'); const id = normalizeId(value.id); const label = normalizeText(value.label, 'C4 labels'); const technology = value.technology ? normalizeText(value.technology, 'C4 technology') : undefined; const description = value.description ? normalizeText(value.description, 'C4 description') : undefined; if (!elementHasTechnology(kind) && technology) throw new Error('Only C4 containers and components accept a technology value.'); return { id, kind, label, ...(technology ? { technology } : {}), ...(description ? { description } : {}) }; }
function normalizeBoundary(value: C4Boundary): C4Boundary { const kind = canonical(BOUNDARY_KINDS, value.kind); if (!kind) throw new Error('Unsupported C4 boundary kind.'); return { id: normalizeId(value.id), kind, label: normalizeText(value.label, 'C4 boundary labels') }; }
function normalizeRelationship(value: C4Relationship): C4Relationship { return { from: normalizeId(value.from), to: normalizeId(value.to), label: normalizeText(value.label, 'C4 relationship labels'), ...(value.technology ? { technology: normalizeText(value.technology, 'C4 relationship technology') } : {}) }; }
function assertRelationship(parsed: ParsedC4, relationship: C4Relationship): void { if (!parsed.elements.some((entry) => entry.id === relationship.from) || !parsed.elements.some((entry) => entry.id === relationship.to)) throw new Error('C4 relationships require existing elements.'); }
function formatElement(value: C4Element): string { const args = elementHasTechnology(value.kind) ? [value.id, quote(value.label), ...(value.technology ? [quote(value.technology)] : []), ...(value.description ? [quote(value.description)] : [])] : [value.id, quote(value.label), ...(value.description ? [quote(value.description)] : [])]; return `${value.kind}(${args.join(', ')})`; }
function elementHasTechnology(kind: C4ElementKind): boolean { return kind.startsWith('Container') || kind.startsWith('Component'); }
function formatRelationship(value: C4Relationship): string { return `Rel(${value.from}, ${value.to}, ${quote(value.label)}${value.technology ? `, ${quote(value.technology)}` : ''})`; }
function quote(value: string): string { return `"${value}"`; }
function sameRelationship(left: C4Relationship, right: C4Relationship): boolean { return left.from === right.from && left.to === right.to && left.label === right.label && left.technology === right.technology; }
function stale(): Error { return new Error('C4 relationship changed remotely and can no longer be resolved safely.'); }
function canonical<T extends string>(values: readonly T[], value: string): T | undefined { return values.find((candidate) => candidate.toLowerCase() === value.toLowerCase()); }
function normalizeId(value: string): string { const id = value.trim(); if (!idPattern.test(id)) throw new Error('C4 identifiers must be Mermaid-safe identifiers.'); return id; }
function normalizeText(value: string, description: string): string { const text = value.trim(); if (!text || /["\r\n]/.test(text)) throw new Error(`${description} must be one-line Mermaid strings.`); return text; }
function uniqueId(base: string, occupied: readonly string[]): string { const ids = new Set(occupied); let value = base; let index = 2; while (ids.has(value)) { value = `${base}${index}`; index += 1; } return value; }
function splitLines(source: string): SourceLine[] { const lines: SourceLine[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; lines.push({ start: match.index, end: match.index + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function firstStatementIndex(lines: readonly SourceLine[]): number { if (lines[0]?.text.replace(/^\uFEFF/, '').trim() !== '---') return 0; const close = lines.findIndex((line, index) => index > 0 && line.text.trim() === '---'); return close < 0 ? lines.length : close + 1; }
function ignorable(value: string): boolean { return /^\s*%%/.test(value); }
function indent(line: SourceLine): string { return line.text.match(/^\s*/)?.[0] ?? ''; }
function append(source: string, statement: string): string { const ending = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'; return `${source}${source && !/(?:\r\n|\n|\r)$/.test(source) ? ending : ''}${statement}`; }
function lineEnding(source: string): string { return source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'; }
function reindent(source: string, from: string, to: string): string { return source.split(/(?<=\n)/u).map((line) => line.startsWith(from) ? `${to}${line.slice(from.length)}` : line).join(''); }
function replace(source: string, line: SourceLine, value: string): string { return `${source.slice(0, line.start)}${value}${line.raw.slice(line.text.length)}${source.slice(line.end)}`; }
function replaceValues(source: string, values: readonly { line: SourceLine; value: string }[]): string { return [...values].sort((left, right) => right.line.start - left.line.start).reduce((next, value) => replace(next, value.line, value.value), source); }
function deleteLines(source: string, lines: readonly SourceLine[]): string { return [...lines].sort((left, right) => right.start - left.start).reduce((next, line) => `${next.slice(0, line.start)}${next.slice(line.end)}`, source); }
