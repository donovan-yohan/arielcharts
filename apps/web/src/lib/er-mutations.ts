export type ErKeyMarker = 'PK' | 'FK' | 'UK';
/** Endpoint meaning is independent of Mermaid's direction-sensitive wire token. */
export type ErCardinality = 'exactly-one' | 'zero-or-one' | 'one-or-more' | 'zero-or-more';

export interface ErAttribute {
  comment?: string;
  keys: ErKeyMarker[];
  name: string;
  type: string;
}

export interface ErEntity {
  attributes: ErAttribute[];
  name: string;
}

export interface ErRelationship {
  identifying: boolean;
  label: string;
  left: string;
  leftCardinality: ErCardinality;
  right: string;
  rightCardinality: ErCardinality;
}

/** A relationship stays addressable if a collaborator inserts lines before it. */
export interface ErRelationshipIdentity extends ErRelationship {
  index: number;
  /** Duplicate signatures are never editable; this protects a stale legacy identity too. */
  occurrenceCount: number;
}

export interface ErDiagramSnapshot {
  entities: ErEntity[];
  relationships: ErRelationship[];
}

interface SourceRange { end: number; start: number; }
interface ErAttributeRecord extends ErAttribute { semantic: SourceRange; line: SourceRange; }
interface ErEntityRecord extends ErEntity { attributes: ErAttributeRecord[]; block: SourceRange; declaration: SourceRange; }
interface ErRelationshipRecord extends ErRelationship { leftRange: SourceRange; line: SourceRange; rightRange: SourceRange; semantic: SourceRange; }
interface ParsedErDiagram { entities: ErEntityRecord[]; relationships: ErRelationshipRecord[]; }

const FRONTMATTER_PATTERN = /^\uFEFF?---[ \t]*(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)---[ \t]*(?:(?:\r\n|\n|\r)|$)/;
const HEADER_PATTERN = /^\s*erDiagram\b[ \t]*(?:%%[^\r\n]*)?$/i;
const ENTITY_NAME_PATTERN = '[A-Za-z_][A-Za-z0-9_-]*';
const ENTITY_START_PATTERN = new RegExp(`^(\\s*)(${ENTITY_NAME_PATTERN})\\s*\\{\\s*(?:%%[^\\r\\n]*)?$`);
const ATTRIBUTE_TYPE_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RELATIONSHIP_LABEL_BODY = '[A-Za-z0-9][A-Za-z0-9 _-]*';
const RELATIONSHIP_LABEL_PATTERN = new RegExp(`^${RELATIONSHIP_LABEL_BODY}$`);
const ATTRIBUTE_PATTERN = new RegExp(`^\\s*(${ENTITY_NAME_PATTERN})\\s+(${ENTITY_NAME_PATTERN})(.*)$`);
const RELATIONSHIP_PATTERN = new RegExp(`^\\s*(${ENTITY_NAME_PATTERN})\\s+(\\|\\||\\|o|}\\||}o)\\s*(--|\\.\\.)\\s*(\\|\\||o\\||\\|\\{|o\\{)\\s+(${ENTITY_NAME_PATTERN})\\s*:\\s*(${RELATIONSHIP_LABEL_BODY})$`);
const COMMENT_OR_DIRECTIVE_PATTERN = /^\s*%%/;
const CLOSE_PATTERN = /^\s*}\s*(?:%%[^\r\n]*)?$/;
const LINE_ENDING_PATTERN = /\r\n|\n|\r/;
const VALID_KEYS = new Set<ErKeyMarker>(['PK', 'FK', 'UK']);
const LEFT_CARDINALITY_BY_TOKEN: Readonly<Record<string, ErCardinality>> = {
  '||': 'exactly-one', '|o': 'zero-or-one', '}|': 'one-or-more', '}o': 'zero-or-more',
};
const RIGHT_CARDINALITY_BY_TOKEN: Readonly<Record<string, ErCardinality>> = {
  '||': 'exactly-one', 'o|': 'zero-or-one', '|{': 'one-or-more', 'o{': 'zero-or-more',
};
const LEFT_TOKEN_BY_CARDINALITY: Readonly<Record<ErCardinality, string>> = {
  'exactly-one': '||', 'zero-or-one': '|o', 'one-or-more': '}|', 'zero-or-more': '}o',
};
const RIGHT_TOKEN_BY_CARDINALITY: Readonly<Record<ErCardinality, string>> = {
  'exactly-one': '||', 'zero-or-one': 'o|', 'one-or-more': '|{', 'zero-or-more': 'o{',
};

export function isErDiagramSource(source: string): boolean {
  return parseErDiagram(source) !== null;
}

/**
 * The editor deliberately accepts a smaller grammar than Mermaid. A source
 * which it cannot round-trip exactly remains editable in the source flyout.
 */
export function isErSourceRepresentable(source: string): boolean {
  return parseErDiagram(source) !== null;
}

export function getErDiagramSnapshot(source: string): ErDiagramSnapshot {
  const parsed = requireErDiagram(source);
  return {
    entities: parsed.entities.map(({ attributes, name }) => ({
      attributes: attributes.map(({ comment, keys, name: attributeName, type }) => ({ comment, keys: [...keys], name: attributeName, type })),
      name,
    })),
    relationships: parsed.relationships.map(({ identifying, label, left, leftCardinality, right, rightCardinality }) => ({
      identifying, label, left, leftCardinality, right, rightCardinality,
    })),
  };
}

export function getErRelationshipIdentity(relationship: ErRelationship, index: number, occurrenceCount = 1): ErRelationshipIdentity {
  return { ...relationship, index, occurrenceCount };
}

export function resolveErRelationshipIndex(
  relationships: readonly ErRelationship[],
  identity: ErRelationshipIdentity,
): number {
  if (identity.occurrenceCount !== 1) {
    throw new Error('Relationship changed remotely and can no longer be resolved safely.');
  }
  const atIndex = relationships[identity.index];
  if (atIndex && isSameErRelationship(atIndex, identity)) return identity.index;
  const matches = relationships
    .map((relationship, index) => ({ index, relationship }))
    .filter(({ relationship }) => isSameErRelationship(relationship, identity));
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error('Relationship changed remotely and can no longer be resolved safely.');
  }
  return matches[0].index;
}

function isSameErRelationship(left: ErRelationship, right: ErRelationship): boolean {
  return left.left === right.left
    && left.leftCardinality === right.leftCardinality
    && left.identifying === right.identifying
    && left.rightCardinality === right.rightCardinality
    && left.right === right.right
    && left.label === right.label;
}

function getRelationshipSignature(relationship: ErRelationship): string {
  return [
    relationship.left,
    relationship.leftCardinality,
    relationship.identifying ? 'identifying' : 'non-identifying',
    relationship.rightCardinality,
    relationship.right,
    relationship.label,
  ].join('\u0000');
}

export function addErEntity(source: string, name = 'ENTITY'): string {
  if (!source.trim()) return `erDiagram\n  ${normalizeEntityName(name)} {\n  }`;
  const parsed = requireErDiagram(source);
  const entityName = uniqueEntityName(normalizeEntityName(name), parsed.entities.map((entity) => entity.name));
  return appendErStatement(source, `  ${entityName} {\n  }`);
}

export function renameErEntity(source: string, currentName: string, nextName: string): string {
  const parsed = requireErDiagram(source);
  const entity = findEntity(parsed, currentName);
  const normalized = normalizeEntityName(nextName);
  if (normalized !== currentName && parsed.entities.some((candidate) => candidate.name === normalized)) {
    throw new Error(`An entity named ${normalized} already exists.`);
  }
  return replaceRanges(source, [
    { range: entity.declaration, value: normalized },
    ...parsed.relationships.flatMap((relationship) => [
      ...(relationship.left === currentName ? [{ range: relationship.leftRange, value: normalized }] : []),
      ...(relationship.right === currentName ? [{ range: relationship.rightRange, value: normalized }] : []),
    ]),
  ]);
}

export function deleteErEntity(source: string, name: string): string {
  const parsed = requireErDiagram(source);
  const entity = findEntity(parsed, name);
  const lines = splitLines(source);
  const relationshipLines = new Set(parsed.relationships
    .filter((relationship) => relationship.left === name || relationship.right === name)
    .map((relationship) => lineIndexAt(lines, relationship.line.start)));
  const entityStart = lineIndexAt(lines, entity.block.start);
  const entityEnd = lineIndexAt(lines, entity.block.end - 1);
  return lines
    .filter((_, index) => (index < entityStart || index > entityEnd) && !relationshipLines.has(index))
    .map((line) => line.raw)
    .join('');
}

export function moveErEntity(source: string, name: string, direction: 'up' | 'down'): string {
  const parsed = requireErDiagram(source);
  const index = parsed.entities.findIndex((entity) => entity.name === name);
  if (index < 0) throw new Error(`Entity ${name} does not exist.`);
  const adjacent = parsed.entities[index + (direction === 'up' ? -1 : 1)];
  if (!adjacent) return source;
  const first = direction === 'up' ? adjacent : parsed.entities[index];
  const second = direction === 'up' ? parsed.entities[index] : adjacent;
  return `${source.slice(0, first.block.start)}${source.slice(second.block.start, second.block.end)}${source.slice(first.block.end, second.block.start)}${source.slice(first.block.start, first.block.end)}${source.slice(second.block.end)}`;
}

export function addErAttribute(source: string, entityName: string, attribute: Partial<ErAttribute> = {}): string {
  const parsed = requireErDiagram(source);
  const entity = findEntity(parsed, entityName);
  const normalized = normalizeAttribute(attribute);
  const next = { ...normalized, name: uniqueAttributeName(normalized.name, entity.attributes.map((candidate) => candidate.name)) };
  const lines = splitLines(source);
  const closingLine = lines[lineIndexAt(lines, entity.block.end - 1)];
  if (!closingLine) throw new Error(`Entity ${entityName} has no closing declaration.`);
  return `${source.slice(0, closingLine.start)}${getIndentForEntity(source, entity)}${formatAttribute(next)}${getLineEnding(source)}${source.slice(closingLine.start)}`;
}

export function editErAttribute(source: string, entityName: string, attributeName: string, nextAttribute: ErAttribute): string {
  const entity = findEntity(requireErDiagram(source), entityName);
  const attribute = findAttribute(entity, attributeName);
  const next = normalizeAttribute(nextAttribute);
  if (next.name !== attributeName && entity.attributes.some((candidate) => candidate.name === next.name)) {
    throw new Error(`Entity ${entityName} already has an attribute named ${next.name}.`);
  }
  return replaceRanges(source, [{ range: attribute.semantic, value: formatAttribute(next) }]);
}

export function deleteErAttribute(source: string, entityName: string, attributeName: string): string {
  const entity = findEntity(requireErDiagram(source), entityName);
  const attribute = findAttribute(entity, attributeName);
  const lines = splitLines(source);
  const index = lineIndexAt(lines, attribute.line.start);
  return lines.filter((_, lineIndex) => lineIndex !== index).map((line) => line.raw).join('');
}

export function moveErAttribute(source: string, entityName: string, attributeName: string, direction: 'up' | 'down'): string {
  const entity = findEntity(requireErDiagram(source), entityName);
  const index = entity.attributes.findIndex((attribute) => attribute.name === attributeName);
  if (index < 0) throw new Error(`Attribute ${attributeName} does not exist on ${entityName}.`);
  const adjacent = entity.attributes[index + (direction === 'up' ? -1 : 1)];
  if (!adjacent) return source;
  const current = entity.attributes[index];
  if (!current) return source;
  const first = direction === 'up' ? adjacent : current;
  const second = direction === 'up' ? current : adjacent;
  return `${source.slice(0, first.line.start)}${source.slice(second.line.start, second.line.end)}${source.slice(first.line.end, second.line.start)}${source.slice(first.line.start, first.line.end)}${source.slice(second.line.end)}`;
}

export function addErRelationship(source: string, relationship: ErRelationship): string {
  const parsed = requireErDiagram(source);
  assertRelationshipEndpoints(parsed, relationship);
  return appendErStatement(source, `  ${formatRelationship(normalizeRelationship(relationship))}`);
}

export function editErRelationship(source: string, identity: ErRelationshipIdentity, relationship: ErRelationship): string {
  const parsed = requireErDiagram(source);
  const index = resolveErRelationshipIndex(parsed.relationships, identity);
  const current = parsed.relationships[index];
  if (!current) throw new Error('Relationship no longer exists.');
  assertRelationshipEndpoints(parsed, relationship, current);
  return replaceRanges(source, [{ range: current.semantic, value: formatRelationship(normalizeRelationship(relationship)) }]);
}

export function deleteErRelationship(source: string, identity: ErRelationshipIdentity): string {
  const parsed = requireErDiagram(source);
  const index = resolveErRelationshipIndex(parsed.relationships, identity);
  const relationship = parsed.relationships[index];
  if (!relationship) throw new Error('Relationship no longer exists.');
  const lines = splitLines(source);
  return lines.filter((_, lineIndex) => lineIndex !== lineIndexAt(lines, relationship.line.start)).map((line) => line.raw).join('');
}

function parseErDiagram(source: string): ParsedErDiagram | null {
  const prefixLength = source.match(FRONTMATTER_PATTERN)?.[0].length ?? 0;
  const body = source.slice(prefixLength);
  const lines = splitLines(body, prefixLength);
  const headerIndex = lines.findIndex((line) => line.text.trim() !== '' && !COMMENT_OR_DIRECTIVE_PATTERN.test(line.text));
  const header = lines[headerIndex];
  if (!header || !HEADER_PATTERN.test(header.text)) return null;
  const entities: ErEntityRecord[] = [];
  const relationships: ErRelationshipRecord[] = [];
  let lineIndex = headerIndex + 1;
  while (lineIndex < lines.length) {
    const line = lines[lineIndex];
    if (!line || line.text.trim() === '' || COMMENT_OR_DIRECTIVE_PATTERN.test(line.text)) { lineIndex += 1; continue; }
    const entityStart = line.text.match(ENTITY_START_PATTERN);
    if (entityStart?.[2]) {
      const name = entityStart[2];
      if (entities.some((entity) => entity.name === name)) return null;
      const declarationStart = line.start + (entityStart.index ?? 0) + entityStart[1].length;
      const attributes: ErAttributeRecord[] = [];
      const blockStart = line.start;
      lineIndex += 1;
      let closed = false;
      while (lineIndex < lines.length) {
        const attributeLine = lines[lineIndex];
        if (!attributeLine) return null;
        if (CLOSE_PATTERN.test(attributeLine.text)) {
          entities.push({ attributes, block: { start: blockStart, end: attributeLine.end }, declaration: { start: declarationStart, end: declarationStart + name.length }, name });
          lineIndex += 1;
          closed = true;
          break;
        }
        if (attributeLine.text.trim() === '' || COMMENT_OR_DIRECTIVE_PATTERN.test(attributeLine.text)) { lineIndex += 1; continue; }
        const attribute = parseAttribute(attributeLine);
        if (!attribute || attributes.some((candidate) => candidate.name === attribute.name)) return null;
        attributes.push(attribute);
        lineIndex += 1;
      }
      if (!closed) return null;
      continue;
    }
    const relationship = parseRelationship(line);
    if (!relationship) return null;
    relationships.push(relationship);
    lineIndex += 1;
  }
  const entityNames = new Set(entities.map((entity) => entity.name));
  if (relationships.some((relationship) => !entityNames.has(relationship.left) || !entityNames.has(relationship.right))) {
    return null;
  }
  const signatures = new Set<string>();
  for (const relationship of relationships) {
    const signature = getRelationshipSignature(relationship);
    if (signatures.has(signature)) return null;
    signatures.add(signature);
  }
  return { entities, relationships };
}

function parseAttribute(line: SourceLine): ErAttributeRecord | null {
  const semantic = getLineSemanticRange(line);
  const match = semantic.text.match(ATTRIBUTE_PATTERN);
  if (!match?.[1] || !match[2]) return null;
  const type = match[1];
  const name = match[2];
  if (!ATTRIBUTE_TYPE_PATTERN.test(type)) return null;
  let rest = match[3].trim();
  let comment: string | undefined;
  const commentMatch = rest.match(/^(?:(.*?)\s+)?"((?:[^"\\]|\\.)*)"\s*$/);
  if (commentMatch) {
    comment = commentMatch[2]?.replace(/\\"/g, '"').replace(/\\\\/g, '\\');
    rest = commentMatch[1]?.trim() ?? '';
  }
  const keys = rest ? rest.split(/\s*,\s*|\s+/).filter(Boolean) : [];
  if (!keys.every((key): key is ErKeyMarker => VALID_KEYS.has(key as ErKeyMarker))) return null;
  return { ...(comment ? { comment } : {}), keys, line: { start: line.start, end: line.endWithoutEnding }, name, semantic: semantic.range, type };
}

function parseRelationship(line: SourceLine): ErRelationshipRecord | null {
  const semantic = getLineSemanticRange(line);
  const match = semantic.text.match(RELATIONSHIP_PATTERN);
  if (!match?.[1] || !match[2] || !match[3] || !match[4] || !match[5] || !match[6]) return null;
  const leftCardinality = LEFT_CARDINALITY_BY_TOKEN[match[2]];
  const rightCardinality = RIGHT_CARDINALITY_BY_TOKEN[match[4]];
  if (!leftCardinality || !rightCardinality) return null;
  const leftStart = semantic.range.start + semantic.text.indexOf(match[1]);
  const rightStart = semantic.range.start + semantic.text.indexOf(match[5], leftStart - semantic.range.start + match[1].length);
  return {
    identifying: match[3] === '--', label: match[6], left: match[1], leftCardinality,
    leftRange: { start: leftStart, end: leftStart + match[1].length }, line: { start: line.start, end: line.endWithoutEnding }, semantic: semantic.range,
    right: match[5], rightCardinality, rightRange: { start: rightStart, end: rightStart + match[5].length },
  };
}

function getLineSemanticRange(line: SourceLine): { range: SourceRange; text: string } {
  const commentIndex = line.text.indexOf('%%');
  const withoutInlineComment = commentIndex < 0 ? line.text : line.text.slice(0, commentIndex);
  const end = line.start + withoutInlineComment.trimEnd().length;
  const start = line.start + (withoutInlineComment.match(/^\s*/)?.[0].length ?? 0);
  return { range: { start, end }, text: line.text.slice(start - line.start, end - line.start) };
}

interface SourceLine { end: number; endWithoutEnding: number; raw: string; start: number; text: string; }
function splitLines(source: string, offset = 0): SourceLine[] {
  const lines: SourceLine[] = [];
  const matcher = /.*?(?:\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source)) !== null && match[0] !== '') {
    const raw = match[0];
    const ending = raw.match(/\r\n|\n|\r$/)?.[0] ?? '';
    const start = offset + match.index;
    lines.push({ end: start + raw.length, endWithoutEnding: start + raw.length - ending.length, raw, start, text: raw.slice(0, raw.length - ending.length) });
  }
  return lines;
}

function lineIndexAt(lines: SourceLine[], position: number): number {
  const index = lines.findIndex((line) => position >= line.start && position < line.end);
  if (index < 0) throw new Error('Source changed while resolving a Mermaid declaration.');
  return index;
}

function requireErDiagram(source: string): ParsedErDiagram {
  const parsed = parseErDiagram(source);
  if (!parsed) throw new Error('ER form editing requires representable erDiagram source.');
  return parsed;
}

function findEntity(parsed: ParsedErDiagram, name: string): ErEntityRecord {
  const entity = parsed.entities.find((candidate) => candidate.name === name);
  if (!entity) throw new Error(`Entity ${name} no longer exists.`);
  return entity;
}

function findAttribute(entity: ErEntityRecord, name: string): ErAttributeRecord {
  const attribute = entity.attributes.find((candidate) => candidate.name === name);
  if (!attribute) throw new Error(`Attribute ${name} no longer exists on ${entity.name}.`);
  return attribute;
}

function normalizeEntityName(value: string): string {
  const normalized = value.trim().replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^([^A-Za-z_])/, '_$1');
  if (!normalized || !new RegExp(`^${ENTITY_NAME_PATTERN}$`).test(normalized)) throw new Error('Entity names must start with a letter or underscore.');
  return normalized;
}

function uniqueEntityName(base: string, existing: Iterable<string>): string {
  const occupied = new Set(existing);
  let candidate = base;
  let suffix = 2;
  while (occupied.has(candidate)) { candidate = `${base}_${suffix}`; suffix += 1; }
  return candidate;
}

function uniqueAttributeName(base: string, existing: Iterable<string>): string {
  const occupied = new Set(existing);
  let candidate = base;
  let suffix = 2;
  while (occupied.has(candidate)) { candidate = `${base}_${suffix}`; suffix += 1; }
  return candidate;
}

function normalizeAttribute(attribute: Partial<ErAttribute>): ErAttribute {
  const type = (attribute.type ?? 'string').trim();
  const name = normalizeEntityName(attribute.name ?? 'attribute');
  if (!ATTRIBUTE_TYPE_PATTERN.test(type)) throw new Error('Attribute types must be a Mermaid ER identifier.');
  const keys = [...new Set(attribute.keys ?? [])];
  if (!keys.every((key): key is ErKeyMarker => VALID_KEYS.has(key))) throw new Error('Attribute keys must be PK, FK, or UK.');
  const comment = attribute.comment?.replace(/[\r\n]/g, ' ').trim();
  if (comment?.includes('"') || comment?.includes('%%')) throw new Error('Attribute comments cannot contain quotes or Mermaid comments.');
  return { ...(comment ? { comment } : {}), keys, name, type };
}

function normalizeRelationship(relationship: ErRelationship): ErRelationship {
  const normalized = {
    ...relationship,
    label: relationship.label.replace(/[\r\n]/g, ' ').trim(),
    left: normalizeEntityName(relationship.left), right: normalizeEntityName(relationship.right),
  };
  if (!RELATIONSHIP_LABEL_PATTERN.test(normalized.label)) throw new Error('Relationship labels must use Mermaid-safe letters, numbers, spaces, underscores, or hyphens.');
  if (!(normalized.leftCardinality in LEFT_TOKEN_BY_CARDINALITY) || !(normalized.rightCardinality in RIGHT_TOKEN_BY_CARDINALITY)) throw new Error('Choose a supported relationship cardinality.');
  return normalized;
}

function assertRelationshipEndpoints(parsed: ParsedErDiagram, relationship: ErRelationship, excluded?: ErRelationship): void {
  const normalized = normalizeRelationship(relationship);
  const entities = new Set(parsed.entities.map((entity) => entity.name));
  if (!entities.has(normalized.left) || !entities.has(normalized.right)) throw new Error('Relationships require two existing entities.');
  if (parsed.relationships.some((current) => current !== excluded && isSameErRelationship(current, normalized))) {
    throw new Error('An identical relationship already exists.');
  }
}

function formatAttribute(attribute: ErAttribute): string {
  const keys = attribute.keys.length > 0 ? ` ${attribute.keys.join(', ')}` : '';
  const comment = attribute.comment ? ` "${attribute.comment.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"` : '';
  return `${attribute.type} ${attribute.name}${keys}${comment}`;
}

function formatRelationship(relationship: ErRelationship): string {
  return `${relationship.left} ${LEFT_TOKEN_BY_CARDINALITY[relationship.leftCardinality]}${relationship.identifying ? '--' : '..'}${RIGHT_TOKEN_BY_CARDINALITY[relationship.rightCardinality]} ${relationship.right} : ${relationship.label}`;
}

function appendErStatement(source: string, statement: string): string {
  const separator = /(?:\r\n|\n|\r)$/.test(source) ? '' : getLineEnding(source);
  return `${source}${separator}${statement}`;
}

function getLineEnding(source: string): string { return source.match(LINE_ENDING_PATTERN)?.[0] ?? '\n'; }
function getIndentForEntity(source: string, entity: ErEntityRecord): string {
  const declaration = source.slice(entity.block.start, entity.declaration.start);
  return `${declaration}${declaration ? '  ' : '  '}`;
}
function replaceRanges(source: string, changes: Array<{ range: SourceRange; value: string }>): string {
  return [...changes].sort((left, right) => right.range.start - left.range.start).reduce((next, { range, value }) => (
    `${next.slice(0, range.start)}${value}${next.slice(range.end)}`
  ), source);
}
