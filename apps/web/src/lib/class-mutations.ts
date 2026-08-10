export interface ClassMember {
  classifier?: '*' | '$';
  name: string;
  returnType?: string;
  signature?: string;
  type?: string;
  visibility?: '+' | '-' | '#' | '~';
}

export interface ClassEntity {
  annotations: string[];
  label?: string;
  members: ClassMember[];
  name: string;
}

export interface ClassRelationship {
  from: string;
  label?: string;
  relation: ClassRelation;
  to: string;
}

export type ClassRelation = '<|--' | '<|..' | '*--' | 'o--' | '-->' | '--' | '..>' | '..' | '--*' | '--o' | '--|>' | '..|>';
export interface ClassDiagramSnapshot { classes: ClassEntity[]; relationships: ClassRelationship[]; }

interface SourceLine { end: number; raw: string; start: number; text: string; }
interface ClassRecord extends ClassEntity { annotationLines: SourceLine[]; block?: { close: SourceLine; open: SourceLine }; memberLines: SourceLine[]; nameLine: SourceLine; }
interface RelationshipRecord extends ClassRelationship { line: SourceLine; }
interface ParsedClass { classes: ClassRecord[]; lines: SourceLine[]; relationships: RelationshipRecord[]; }

const HEADER = /^\s*classDiagram(?:-v2)?\s*$/i;
const NAME = '[A-Za-z_][A-Za-z0-9_.-]*';
const namePattern = new RegExp(`^${NAME}$`);
const CLASS = new RegExp(`^(\\s*)class\\s+(${NAME})(?:\\s*\\[\"([^\"\\r\\n]*)\"\\])?\\s*(\\{)?\\s*$`, 'i');
const ANNOTATION = new RegExp(`^\\s*<<([^<>\\r\\n]+)>>\\s+(${NAME})\\s*$`);
const RELATIONS: readonly ClassRelation[] = ['<|--', '<|..', '*--', 'o--', '-->', '--*', '--o', '--|>', '..>', '..|>', '--', '..'];
const relationshipPattern = new RegExp(`^\\s*(${NAME})\\s*(${RELATIONS.map(escape).join('|')})\\s*(${NAME})(?:\\s*:\\s*([^\\r\\n]*?))?\\s*$`);
const MEMBER = /^(\s*)([+\-#~])?(?:(?<fieldType>[A-Za-z_][A-Za-z0-9_.<>,\[\]-]*)\s+)?(?<name>[A-Za-z_][A-Za-z0-9_.-]*)(?:\((?<signature>[^()\r\n]*)\))?(?:\s*(?::\s*|\s+)(?<returnType>[A-Za-z_][A-Za-z0-9_.<>,\[\]-]*))?(?<classifier>[*$])?\s*$/;

export function isClassDiagramSource(source: string): boolean { return parseClass(source) !== null; }
export function isClassSourceRepresentable(source: string): boolean { return parseClass(source) !== null; }
export function getClassDiagramSnapshot(source: string): ClassDiagramSnapshot {
  const parsed = requireClass(source);
  return { classes: parsed.classes.map(publicClass), relationships: parsed.relationships.map(publicRelationship) };
}

export function addClass(source: string, name = 'Class', label?: string): string {
  if (!source.trim()) return `classDiagram\n  class ${normalizeName(name)}`;
  const parsed = requireClass(source); const next = uniqueName(normalizeName(name), parsed.classes.map((entry) => entry.name));
  return append(source, `  class ${next}${label ? ` [\"${normalizeLabel(label)}\"]` : ''}`);
}

export function editClass(source: string, currentName: string, patch: Pick<ClassEntity, 'label'> & { name?: string }): string {
  const parsed = requireClass(source); const entry = findClass(parsed, currentName); const name = patch.name ? normalizeName(patch.name) : currentName;
  if (name !== currentName && parsed.classes.some((candidate) => candidate.name === name)) throw new Error(`A class named ${name} already exists.`);
  const label = patch.label === undefined ? entry.label : normalizeLabel(patch.label);
  return replaceValues(source, [
    { range: entry.nameLine, value: `${indent(entry.nameLine)}class ${name}${label ? ` [\"${label}\"]` : ''}${entry.block ? ' {' : ''}` },
    ...entry.annotationLines.map((line, index) => name !== currentName ? ({ range: line, value: `${indent(line)}<<${entry.annotations[index]!}>> ${name}` }) : ({ range: line, value: line.text })),
    ...parsed.relationships.filter((relationship) => name !== currentName && (relationship.from === currentName || relationship.to === currentName)).map((relationship) => ({ range: relationship.line, value: `${indent(relationship.line)}${relationship.from === currentName ? name : relationship.from} ${relationship.relation} ${relationship.to === currentName ? name : relationship.to}${relationship.label ? ` : ${relationship.label}` : ''}` })),
  ]);
}

export function deleteClass(source: string, name: string): string {
  const parsed = requireClass(source); const entry = findClass(parsed, name);
  const doomed = [entry.nameLine, ...entry.annotationLines, ...(entry.block ? [entry.block.open, ...entry.memberLines, entry.block.close] : []), ...parsed.relationships.filter((relationship) => relationship.from === name || relationship.to === name).map((relationship) => relationship.line)];
  return deleteLines(source, doomed);
}

export function addClassMember(source: string, className: string, member: ClassMember): string {
  const parsed = requireClass(source); const entry = findClass(parsed, className); const normalized = normalizeMember(member);
  if (entry.members.some((candidate) => memberKey(candidate) === memberKey(normalized))) throw new Error(`Class ${className} already has that member.`);
  if (!entry.block) {
    return replace(source, entry.nameLine, `${indent(entry.nameLine)}class ${entry.name}${entry.label ? ` [\"${entry.label}\"]` : ''} {${lineEnding(source)}${indent(entry.nameLine)}  ${formatMember(normalized)}${lineEnding(source)}${indent(entry.nameLine)}}`);
  }
  return `${source.slice(0, entry.block.close.start)}${indent(entry.block.close)}  ${formatMember(normalized)}${lineEnding(source)}${source.slice(entry.block.close.start)}`;
}

export function editClassMember(source: string, className: string, index: number, member: ClassMember): string {
  const parsed = requireClass(source); const entry = findClass(parsed, className); const line = entry.memberLines[index]; if (!line) throw new Error('Class member no longer exists.');
  return replace(source, line, `${indent(line)}${formatMember(normalizeMember(member))}`);
}
export function deleteClassMember(source: string, className: string, index: number): string {
  const entry = findClass(requireClass(source), className); const line = entry.memberLines[index]; if (!line) throw new Error('Class member no longer exists.'); return deleteLines(source, [line]);
}

export function addClassAnnotation(source: string, className: string, annotation: string): string {
  const parsed = requireClass(source); const entry = findClass(parsed, className); const normalized = normalizeAnnotation(annotation);
  if (entry.annotations.includes(normalized)) throw new Error(`Class ${className} already has annotation ${normalized}.`);
  const terminalLine = entry.block?.close ?? entry.nameLine; const insertAt = terminalLine.end;
  return `${source.slice(0, insertAt)}${/(?:\r\n|\n|\r)$/.test(terminalLine.raw) ? '' : lineEnding(source)}${indent(entry.nameLine)}<<${normalized}>> ${className}${lineEnding(source)}${source.slice(insertAt)}`;
}
export function deleteClassAnnotation(source: string, className: string, annotation: string): string {
  const entry = findClass(requireClass(source), className); const index = entry.annotations.indexOf(annotation); const line = entry.annotationLines[index]; if (!line) throw new Error(`Class ${className} does not have annotation ${annotation}.`); return deleteLines(source, [line]);
}

export function addClassRelationship(source: string, relationship: ClassRelationship): string {
  const parsed = requireClass(source); assertRelationship(parsed, relationship); return append(source, `  ${formatRelationship(relationship)}`);
}
export function editClassRelationship(source: string, index: number, relationship: ClassRelationship): string {
  const parsed = requireClass(source); const current = parsed.relationships[index]; if (!current) throw new Error('Class relationship no longer exists.'); assertRelationship(parsed, relationship); return replace(source, current.line, `${indent(current.line)}${formatRelationship(relationship)}`);
}
export function deleteClassRelationship(source: string, index: number): string { const parsed = requireClass(source); const relationship = parsed.relationships[index]; if (!relationship) throw new Error('Class relationship no longer exists.'); return deleteLines(source, [relationship.line]); }

function parseClass(source: string): ParsedClass | null {
  const lines = splitLines(source); const bodyStart = firstStatementIndex(lines); const headerIndex = lines.findIndex((line, index) => index >= bodyStart && line.text.trim() && !ignorable(line.text));
  if (headerIndex < 0 || !HEADER.test(lines[headerIndex]?.text ?? '')) return null;
  const classes: ClassRecord[] = []; const relationships: RelationshipRecord[] = []; let open: { entry: ClassRecord; line: SourceLine } | null = null;
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!; const text = line.text;
    if (ignorable(text) || !text.trim()) continue;
    if (open) {
      if (/^\s*}\s*$/.test(text)) { open.entry.block = { open: open.line, close: line }; open = null; continue; }
      const member = text.match(MEMBER); if (!member) return null;
      open.entry.memberLines.push(line); const groups = member.groups ?? {}; open.entry.members.push(compactMember({ visibility: member[2] as ClassMember['visibility'], type: groups.fieldType, name: groups.name ?? '', signature: groups.signature, returnType: groups.returnType, classifier: groups.classifier as ClassMember['classifier'] })); continue;
    }
    const annotation = text.match(ANNOTATION);
    if (annotation) { const entry = classes.find((candidate) => candidate.name === annotation[2]); if (!entry) return null; entry.annotations.push(annotation[1]!.trim()); entry.annotationLines.push(line); continue; }
    const declaration = text.match(CLASS);
    if (declaration) {
      const name = declaration[2]!; if (classes.some((entry) => entry.name === name)) return null;
      const entry: ClassRecord = { name, label: declaration[3]?.trim() || undefined, annotations: [], annotationLines: [], members: [], memberLines: [], nameLine: line };
      classes.push(entry); if (declaration[4]) open = { entry, line }; continue;
    }
    const relation = text.match(relationshipPattern);
    if (relation) { relationships.push({ from: relation[1]!, relation: relation[2] as ClassRelation, to: relation[3]!, label: relation[4]?.trim() || undefined, line }); continue; }
    return null;
  }
  if (open || relationships.some((relationship) => !classes.some((entry) => entry.name === relationship.from) || !classes.some((entry) => entry.name === relationship.to))) return null;
  return { classes, relationships, lines };
}

function requireClass(source: string): ParsedClass { const parsed = parseClass(source); if (!parsed) throw new Error('This source is not a safely representable class diagram.'); return parsed; }
function findClass(parsed: ParsedClass, name: string): ClassRecord { const entry = parsed.classes.find((candidate) => candidate.name === name); if (!entry) throw new Error(`Class ${name} no longer exists.`); return entry; }
function publicClass(entry: ClassRecord): ClassEntity { return { name: entry.name, ...(entry.label ? { label: entry.label } : {}), annotations: [...entry.annotations], members: entry.members.map(compactMember) }; }
function publicRelationship(entry: RelationshipRecord): ClassRelationship { return { from: entry.from, relation: entry.relation, to: entry.to, ...(entry.label ? { label: entry.label } : {}) }; }
function assertRelationship(parsed: ParsedClass, relationship: ClassRelationship): void { if (!parsed.classes.some((entry) => entry.name === relationship.from) || !parsed.classes.some((entry) => entry.name === relationship.to)) throw new Error('Class relationships require existing classes.'); if (!RELATIONS.includes(relationship.relation)) throw new Error('Unsupported class relationship.'); if (relationship.label?.includes('\n')) throw new Error('Relationship labels must be one line.'); }
function normalizeName(value: string): string { const name = value.trim().replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z_]+/, ''); if (!namePattern.test(name)) throw new Error('Class names must be Mermaid-safe identifiers.'); return name; }
function normalizeLabel(value: string): string { const label = value.trim().replace(/[\[\]\"\r\n]/g, ''); if (!label) return ''; return label; }
function normalizeAnnotation(value: string): string { const annotation = value.trim().replace(/[<>\r\n]/g, ''); if (!annotation) throw new Error('Class annotation is required.'); return annotation; }
function normalizeMember(member: ClassMember): ClassMember { const name = normalizeName(member.name); const signature = member.signature?.trim().replace(/[()\r\n]/g, ''); const type = member.type?.trim().replace(/[^A-Za-z0-9_.<>,\[\]-]/g, ''); const returnType = member.returnType?.trim().replace(/[^A-Za-z0-9_.<>,\[\]-]/g, ''); if (type && signature !== undefined) throw new Error('Methods cannot have a field type.'); return compactMember({ name, ...(member.visibility ? { visibility: member.visibility } : {}), ...(type ? { type } : {}), ...(signature !== undefined ? { signature } : {}), ...(returnType ? { returnType } : {}), ...(member.classifier ? { classifier: member.classifier } : {}) }); }
function formatMember(member: ClassMember): string { return `${member.visibility ?? ''}${member.type ? `${member.type} ` : ''}${member.name}${member.signature === undefined ? '' : `(${member.signature})`}${member.returnType ? ` ${member.returnType}` : ''}${member.classifier ?? ''}`; }
function memberKey(member: ClassMember): string { return `${member.name}\u0000${member.signature ?? ''}`; }
function compactMember(member: ClassMember): ClassMember { return { name: member.name, ...(member.visibility ? { visibility: member.visibility } : {}), ...(member.type ? { type: member.type } : {}), ...(member.signature !== undefined ? { signature: member.signature } : {}), ...(member.returnType ? { returnType: member.returnType } : {}), ...(member.classifier ? { classifier: member.classifier } : {}) }; }
function formatRelationship(relationship: ClassRelationship): string { return `${relationship.from} ${relationship.relation} ${relationship.to}${relationship.label ? ` : ${relationship.label.trim()}` : ''}`; }
function uniqueName(base: string, existing: readonly string[]): string { const occupied = new Set(existing); let candidate = base; let suffix = 2; while (occupied.has(candidate)) { candidate = `${base}${suffix}`; suffix += 1; } return candidate; }
function splitLines(source: string): SourceLine[] { const lines: SourceLine[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; const start = match.index; lines.push({ start, end: start + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function firstStatementIndex(lines: readonly SourceLine[]): number { if (lines[0]?.text.replace(/^\uFEFF/, '').trim() !== '---') return 0; const close = lines.findIndex((line, index) => index > 0 && line.text.trim() === '---'); return close < 0 ? lines.length : close + 1; }
function ignorable(text: string): boolean { return /^\s*(?:%%|%%\{|%%\{init:|%%\{config:)/.test(text); }
function indent(line: SourceLine): string { return line.text.match(/^\s*/)?.[0] ?? ''; }
function lineEnding(source: string): string { return source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'; }
function append(source: string, statement: string): string { const ending = lineEnding(source); return source ? `${source}${/(?:\r\n|\n|\r)$/.test(source) ? '' : ending}${statement}` : statement; }
function replace(source: string, line: SourceLine, value: string): string { return `${source.slice(0, line.start)}${value}${line.raw.slice(line.text.length)}${source.slice(line.end)}`; }
function replaceValues(source: string, values: readonly { range: SourceLine; value: string }[]): string { return [...values].sort((left, right) => right.range.start - left.range.start).reduce((next, item) => replace(next, item.range, item.value), source); }
function deleteLines(source: string, lines: readonly SourceLine[]): string { return [...lines].sort((left, right) => right.start - left.start).reduce((next, line) => `${next.slice(0, line.start)}${next.slice(line.end)}`, source); }
function escape(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
