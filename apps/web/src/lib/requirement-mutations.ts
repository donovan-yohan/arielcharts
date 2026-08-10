export type RequirementKind = 'designConstraint' | 'element' | 'functionalRequirement' | 'interfaceRequirement' | 'performanceRequirement' | 'physicalRequirement' | 'requirement';
export type RequirementRelation = 'contains' | 'copies' | 'derives' | 'refines' | 'satisfies' | 'traces' | 'verifies';
export interface RequirementEntity { fields: Record<string, string>; kind: RequirementKind; name: string; }
export interface RequirementRelationship { from: string; kind: RequirementRelation; to: string; }
/** A relationship remains addressable across an unrelated remote insertion. */
export interface RequirementRelationshipIdentity extends RequirementRelationship { index: number; occurrenceCount: number; }
export interface RequirementDiagramSnapshot { entities: RequirementEntity[]; relationships: RequirementRelationship[]; }

interface SourceLine { end: number; raw: string; start: number; text: string; }
interface EntityRecord extends RequirementEntity { block: { close: SourceLine; open: SourceLine }; fieldLines: SourceLine[]; }
interface RelationshipRecord extends RequirementRelationship { line: SourceLine; }
interface ParsedRequirement { entities: EntityRecord[]; lines: SourceLine[]; relationships: RelationshipRecord[]; }

const HEADER = /^\s*requirementDiagram\s*$/i;
const NAME = '[A-Za-z_][A-Za-z0-9_.-]*';
const namePattern = new RegExp(`^${NAME}$`);
const KINDS: readonly RequirementKind[] = ['requirement', 'functionalRequirement', 'interfaceRequirement', 'performanceRequirement', 'physicalRequirement', 'designConstraint', 'element'];
const RELATIONS: readonly RequirementRelation[] = ['contains', 'copies', 'derives', 'refines', 'satisfies', 'traces', 'verifies'];
const DECLARATION = new RegExp(`^(\\s*)(${KINDS.join('|')})\\s+(${NAME})\\s*\\{\\s*$`, 'i');
const FIELD = /^\s*([A-Za-z][A-Za-z0-9_-]*)\s*:\s*([^\r\n{}]+?)\s*$/;
const RELATION = new RegExp(`^\\s*(${NAME})\\s*-\\s*(${RELATIONS.join('|')})\\s*->\\s*(${NAME})\\s*$`, 'i');

export function isRequirementDiagramSource(source: string): boolean { return parseRequirement(source) !== null; }
export function isRequirementSourceRepresentable(source: string): boolean { return parseRequirement(source) !== null; }
export function getRequirementDiagramSnapshot(source: string): RequirementDiagramSnapshot { const parsed = requireDiagram(source); return { entities: parsed.entities.map(publicEntity), relationships: parsed.relationships.map(publicRelationship) }; }

export function addRequirement(source: string, entity: RequirementEntity): string {
  const normalized = normalizeEntity(entity); if (!source.trim()) return `requirementDiagram\n${formatEntity(normalized, '  ', '\n')}`;
  const parsed = requireDiagram(source); const name = uniqueName(normalized.name, parsed.entities.map((entry) => entry.name)); return append(source, formatEntity({ ...normalized, name }, '  ', lineEnding(source)));
}
export function editRequirement(source: string, name: string, patch: Partial<Pick<RequirementEntity, 'fields' | 'kind'>> & { name?: string }): string {
  const parsed = requireDiagram(source); const entity = findEntity(parsed, name); const nextName = patch.name ? normalizeName(patch.name) : name;
  if (nextName !== name && parsed.entities.some((candidate) => candidate.name === nextName)) throw new Error(`A requirement named ${nextName} already exists.`);
  const next = normalizeEntity({ name: nextName, kind: patch.kind ?? entity.kind, fields: patch.fields ?? entity.fields });
  return replaceValues(source, [
    { range: { start: entity.block.open.start, end: entity.block.close.start + entity.block.close.text.length }, value: formatEntity(next, indent(entity.block.open), lineEnding(source)) },
    ...parsed.relationships.filter((relation) => nextName !== name && (relation.from === name || relation.to === name)).map((relation) => ({ range: { start: relation.line.start, end: relation.line.start + relation.line.text.length }, value: `${indent(relation.line)}${relation.from === name ? nextName : relation.from} - ${relation.kind} -> ${relation.to === name ? nextName : relation.to}` })),
  ]);
}
export function deleteRequirement(source: string, name: string): string { const parsed = requireDiagram(source); const entity = findEntity(parsed, name); return deleteRanges(source, [{ start: entity.block.open.start, end: entity.block.close.end }, ...parsed.relationships.filter((relation) => relation.from === name || relation.to === name).map((relation) => relation.line)]); }

export function addRequirementRelationship(source: string, relationship: RequirementRelationship): string { const parsed = requireDiagram(source); assertRelationship(parsed, relationship); return append(source, `  ${formatRelationship(relationship)}`); }
export function getRequirementRelationshipIdentity(relationship: RequirementRelationship, index: number, relationships: readonly RequirementRelationship[] = []): RequirementRelationshipIdentity {
  return { ...relationship, index, occurrenceCount: relationships.length ? relationships.filter((candidate) => isSameRelationship(candidate, relationship)).length : 1 };
}
export function resolveRequirementRelationshipIndex(relationships: readonly RequirementRelationship[], identity: RequirementRelationshipIdentity): number {
  if (identity.occurrenceCount !== 1) throw new Error('Requirement relationship changed remotely and can no longer be resolved safely.');
  const matches = relationships.map((relationship, index) => ({ index, relationship })).filter(({ relationship }) => isSameRelationship(relationship, identity));
  if (matches.length !== 1 || !matches[0]) throw new Error('Requirement relationship changed remotely and can no longer be resolved safely.');
  return matches[0].index;
}
export function editRequirementRelationship(source: string, identity: RequirementRelationshipIdentity, relationship: RequirementRelationship): string { const parsed = requireDiagram(source); const index = resolveRequirementRelationshipIndex(parsed.relationships, identity); const current = parsed.relationships[index]; if (!current) throw new Error('Requirement relationship no longer exists.'); assertRelationship(parsed, relationship); return replaceLine(source, current.line, `${indent(current.line)}${formatRelationship(relationship)}`); }
export function deleteRequirementRelationship(source: string, identity: RequirementRelationshipIdentity): string { const parsed = requireDiagram(source); const index = resolveRequirementRelationshipIndex(parsed.relationships, identity); const current = parsed.relationships[index]; if (!current) throw new Error('Requirement relationship no longer exists.'); return deleteRanges(source, [current.line]); }

function parseRequirement(source: string): ParsedRequirement | null {
  const lines = splitLines(source); const bodyStart = firstStatementIndex(lines); const headerIndex = lines.findIndex((line, index) => index >= bodyStart && line.text.trim() && !ignorable(line.text)); if (headerIndex < 0 || !HEADER.test(lines[headerIndex]?.text ?? '')) return null;
  const entities: EntityRecord[] = []; const relationships: RelationshipRecord[] = []; let open: { fields: Record<string, string>; lines: SourceLine[]; kind: RequirementKind; name: string; open: SourceLine } | null = null;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!; const text = line.text;
    if (!text.trim() || ignorable(text)) continue;
    if (open) {
      if (/^\s*}\s*$/.test(text)) { if (!isValidFields(open.kind, open.fields)) return null; entities.push({ name: open.name, kind: open.kind, fields: open.fields, fieldLines: open.lines, block: { open: open.open, close: line } }); open = null; continue; }
      const field = text.match(FIELD); if (!field || Object.hasOwn(open.fields, field[1]!)) return null; open.fields[field[1]!] = field[2]!.trim(); open.lines.push(line); continue;
    }
    const declaration = text.match(DECLARATION);
    if (declaration) {
      const name = declaration[3]!;
      const kind = KINDS.find((candidate) => candidate.toLowerCase() === declaration[2]!.toLowerCase());
      if (!kind || entities.some((entry) => entry.name === name)) return null;
      open = { kind, name, fields: {}, lines: [], open: line }; continue;
    }
    const relation = text.match(RELATION);
    if (relation) { relationships.push({ from: relation[1]!, kind: relation[2]!.toLowerCase() as RequirementRelation, to: relation[3]!, line }); continue; }
    return null;
  }
  if (open || relationships.some((relationship) => !entities.some((entity) => entity.name === relationship.from) || !entities.some((entity) => entity.name === relationship.to))) return null;
  return { entities, relationships, lines };
}

function requireDiagram(source: string): ParsedRequirement { const parsed = parseRequirement(source); if (!parsed) throw new Error('This source is not a safely representable requirement diagram.'); return parsed; }
function findEntity(parsed: ParsedRequirement, name: string): EntityRecord { const entity = parsed.entities.find((candidate) => candidate.name === name); if (!entity) throw new Error(`Requirement ${name} no longer exists.`); return entity; }
function publicEntity(entity: EntityRecord): RequirementEntity { return { name: entity.name, kind: entity.kind, fields: { ...entity.fields } }; }
function publicRelationship(relationship: RelationshipRecord): RequirementRelationship { return { from: relationship.from, kind: relationship.kind, to: relationship.to }; }
function isSameRelationship(left: RequirementRelationship, right: RequirementRelationship): boolean { return left.from === right.from && left.kind === right.kind && left.to === right.to; }
function normalizeEntity(entity: RequirementEntity): RequirementEntity { const kind = entity.kind; if (!KINDS.includes(kind)) throw new Error('Unsupported requirement kind.'); const fields = Object.fromEntries(Object.entries(entity.fields).map(([key, value]) => [normalizeFieldKey(key), normalizeFieldValue(value)])); if (!isValidFields(kind, fields)) throw new Error(kind === 'element' ? 'Elements require a type field.' : 'Requirements need id, text, risk, and verifyMethod fields.'); return { name: normalizeName(entity.name), kind, fields }; }
function isValidFields(kind: RequirementKind, fields: Record<string, string>): boolean { if (kind === 'element') return typeof fields.type === 'string' && Boolean(fields.type); const required = ['id', 'text', 'risk', 'verifyMethod']; return required.every((key) => typeof fields[key] === 'string' && Boolean(fields[key])); }
function assertRelationship(parsed: ParsedRequirement, relationship: RequirementRelationship): void { if (!RELATIONS.includes(relationship.kind)) throw new Error('Unsupported requirement relationship.'); if (!parsed.entities.some((entry) => entry.name === relationship.from) || !parsed.entities.some((entry) => entry.name === relationship.to)) throw new Error('Requirement relationships require existing entities.'); }
function normalizeName(value: string): string { const name = value.trim().replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z_]+/, ''); if (!namePattern.test(name)) throw new Error('Requirement names must be Mermaid-safe identifiers.'); return name; }
function normalizeFieldKey(value: string): string { const key = value.trim(); if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(key)) throw new Error('Requirement field names must be identifiers.'); return key; }
function normalizeFieldValue(value: string): string { const normalized = value.trim().replace(/[\r\n{}]/g, ''); if (!normalized) throw new Error('Requirement field values are required.'); return normalized; }
function formatEntity(entity: RequirementEntity, indentation: string, ending: string): string { const body = Object.entries(entity.fields).map(([key, value]) => `${indentation}  ${key}: ${value}`).join(ending); return `${indentation}${entity.kind} ${entity.name} {${ending}${body}${ending}${indentation}}`; }
function formatRelationship(relationship: RequirementRelationship): string { return `${relationship.from} - ${relationship.kind} -> ${relationship.to}`; }
function uniqueName(base: string, existing: readonly string[]): string { const occupied = new Set(existing); let candidate = base; let suffix = 2; while (occupied.has(candidate)) { candidate = `${base}${suffix}`; suffix += 1; } return candidate; }
function splitLines(source: string): SourceLine[] { const lines: SourceLine[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; const start = match.index; lines.push({ start, end: start + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function firstStatementIndex(lines: readonly SourceLine[]): number { if (lines[0]?.text.replace(/^\uFEFF/, '').trim() !== '---') return 0; const close = lines.findIndex((line, index) => index > 0 && line.text.trim() === '---'); return close < 0 ? lines.length : close + 1; }
function ignorable(text: string): boolean { return /^\s*%%/.test(text); }
function indent(line: SourceLine): string { return line.text.match(/^\s*/)?.[0] ?? ''; }
function lineEnding(source: string): string { return source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'; }
function append(source: string, statement: string): string { const ending = lineEnding(source); return `${source}${source && !/(?:\r\n|\n|\r)$/.test(source) ? ending : ''}${statement}`; }
function replaceRange(source: string, range: { end: number; start: number }, value: string): string { return `${source.slice(0, range.start)}${value}${source.slice(range.end)}`; }
function replaceValues(source: string, values: readonly { range: { end: number; start: number }; value: string }[]): string { return [...values].sort((left, right) => right.range.start - left.range.start).reduce((next, item) => replaceRange(next, item.range, item.value), source); }
function replaceLine(source: string, line: SourceLine, value: string): string { return `${source.slice(0, line.start)}${value}${line.raw.slice(line.text.length)}${source.slice(line.end)}`; }
function deleteRanges(source: string, ranges: readonly { end: number; start: number }[]): string { return [...ranges].sort((left, right) => right.start - left.start).reduce((next, range) => `${next.slice(0, range.start)}${next.slice(range.end)}`, source); }
