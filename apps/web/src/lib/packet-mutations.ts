import { isSafeMermaidFrontmatter } from './mermaid-frontmatter';

export interface PacketField {
  end: number;
  label: string;
  start: number;
}

/** A source-derived semantic fingerprint. Ambiguous duplicates deliberately fail stale. */
export interface PacketFieldIdentity {
  field: PacketField;
  occurrenceCount: number;
}

export interface PacketDiagramSnapshot {
  fields: PacketField[];
}

interface Line {
  end: number;
  raw: string;
  start: number;
  text: string;
}

interface PacketFieldRecord extends PacketField {
  line: Line;
}

interface ParsedPacket {
  fields: PacketFieldRecord[];
  header: Line;
}

const INTEGER = '(?:0|[1-9][0-9]*)';
const QUOTED = '(?:"(?:[^"\\\\\r\n]|\\\\.)*"|\'(?:[^\'\\\\\r\n]|\\\\.)*\')';
const FIELD = new RegExp(`^[\\t ]*(${INTEGER})(?:[\\t ]*-[\\t ]*(${INTEGER}))?[\\t ]*:[\\t ]*(${QUOTED})[\\t ]*$`);

export function isPacketDiagramSource(source: string): boolean {
  return parsePacket(source) !== null;
}

export function isPacketSourceRepresentable(source: string): boolean {
  return parsePacket(source) !== null;
}

export function getPacketDiagramSnapshot(source: string): PacketDiagramSnapshot {
  return { fields: requirePacket(source).fields.map(publicField) };
}

export function getPacketFieldIdentity(field: PacketField, fields: readonly PacketField[] = []): PacketFieldIdentity {
  const fingerprint = publicField(field);
  return {
    field: fingerprint,
    occurrenceCount: fields.length ? fields.filter((candidate) => sameFingerprint(candidate, fingerprint)).length : 1,
  };
}

export function resolvePacketField(source: string, identity: PacketFieldIdentity): PacketField {
  return publicField(resolveField(requirePacket(source), identity));
}

export function addPacketField(source: string, field: PacketField): string {
  const parsed = requirePacket(source);
  const value = normalizeField(field);
  const expectedStart = parsed.fields.at(-1)?.end === undefined ? 0 : parsed.fields.at(-1)!.end + 1;
  if (value.start !== expectedStart) {
    throw new Error(`Packet fields must remain contiguous; the next field must start at bit ${expectedStart}.`);
  }
  const fields = [...parsed.fields.map(publicField), value];
  validateFields(fields);
  const next = append(source, `  ${formatField(value)}`);
  return requirePacket(next), next;
}

export function editPacketField(source: string, identity: PacketFieldIdentity, patch: Partial<PacketField>): string {
  const parsed = requirePacket(source);
  const current = resolveField(parsed, identity);
  const value = normalizeField({
    end: patch.end ?? current.end,
    label: patch.label ?? current.label,
    start: patch.start ?? current.start,
  });
  if (sameField(current, value)) return source;
  const fields = parsed.fields.map((candidate) => candidate === current ? value : publicField(candidate));
  validateFields(fields);
  const next = replaceLine(source, current.line, `${indent(current.line)}${formatField(value)}`);
  return requirePacket(next), next;
}

export function deletePacketField(source: string, identity: PacketFieldIdentity): string {
  const parsed = requirePacket(source);
  const current = resolveField(parsed, identity);
  const index = parsed.fields.indexOf(current);
  const removedWidth = fieldWidth(current);
  const fields = parsed.fields.filter((candidate) => candidate !== current).map((candidate, candidateIndex) => (
    candidateIndex < index
      ? publicField(candidate)
      : { ...publicField(candidate), start: candidate.start - removedWidth, end: candidate.end - removedWidth }
  ));
  validateFields(fields);
  const edits: LineEdit[] = [{ line: current.line }];
  for (let fieldIndex = index; fieldIndex < parsed.fields.length - 1; fieldIndex += 1) {
    const record = parsed.fields[fieldIndex + 1]!;
    const value = fields[fieldIndex]!;
    edits.push({ line: record.line, value: `${indent(record.line)}${formatField(value)}` });
  }
  const next = applyLineEdits(source, edits);
  return requirePacket(next), next;
}

/**
 * Moves a field while retaining its width. Absolute ranges are reflowed from bit zero,
 * and each physical line keeps the terminator authored at that position.
 */
export function movePacketField(source: string, identity: PacketFieldIdentity, direction: 'up' | 'down'): string {
  const parsed = requirePacket(source);
  const current = resolveField(parsed, identity);
  const index = parsed.fields.indexOf(current);
  const otherIndex = index + (direction === 'up' ? -1 : 1);
  if (otherIndex < 0 || otherIndex >= parsed.fields.length) return source;

  const reordered = parsed.fields.map(publicField);
  [reordered[index], reordered[otherIndex]] = [reordered[otherIndex]!, reordered[index]!];
  let cursor = 0;
  const reflowed = reordered.map((field) => {
    const width = fieldWidth(field);
    const value = { ...field, start: cursor, end: cursor + width - 1 };
    cursor += width;
    return value;
  });
  validateFields(reflowed);
  const edits = parsed.fields.flatMap((record, fieldIndex): LineEdit[] => {
    const value = reflowed[fieldIndex]!;
    return sameField(record, value) ? [] : [{ line: record.line, value: `${indent(record.line)}${formatField(value)}` }];
  });
  const next = applyLineEdits(source, edits);
  return requirePacket(next), next;
}

function parsePacket(source: string): ParsedPacket | null {
  try {
    if (source.indexOf('\uFEFF') > 0 || hasUnexpectedControls(source.startsWith('\uFEFF') ? source.slice(1) : source)) return null;
    const lines = splitLines(source);
    const headerIndex = firstStatement(lines);
    const header = lines[headerIndex];
    if (!header || sourceLineText(header) !== 'packet-beta') return null;
    const fields: PacketFieldRecord[] = [];
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]!;
      const text = sourceLineText(line);
      if (blank(text) || comment(text)) continue;
      if (directive(text)) return null;
      const field = parseField(text, line);
      if (!field) return null;
      fields.push(field);
    }
    validateFields(fields);
    return { fields, header };
  } catch {
    return null;
  }
}

function parseField(text: string, line: Line): PacketFieldRecord | null {
  const match = text.match(FIELD);
  if (!match) return null;
  const start = Number(match[1]);
  const end = match[2] === undefined ? start : Number(match[2]);
  const label = decodeQuoted(match[3]!);
  try {
    return { ...normalizeField({ start, end, label }), line };
  } catch {
    return null;
  }
}

function requirePacket(source: string): ParsedPacket {
  const parsed = parsePacket(source);
  if (!parsed) throw new Error('This source is not a safely representable Packet diagram.');
  return parsed;
}

function resolveField(parsed: ParsedPacket, identity: PacketFieldIdentity): PacketFieldRecord {
  const matches = parsed.fields.filter((candidate) => sameFingerprint(candidate, identity.field));
  if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw stale();
  return matches[0];
}

function normalizeField(field: PacketField): PacketField {
  if (!Number.isSafeInteger(field.start) || field.start < 0 || !Number.isSafeInteger(field.end) || field.end < 0) {
    throw new Error('Packet field ranges must use safe integers greater than or equal to zero.');
  }
  if (field.end < field.start) throw new Error('Packet field end bits must be greater than or equal to their start bits.');
  return { start: field.start, end: field.end, label: normalizeLabel(field.label) };
}

function validateFields(fields: readonly PacketField[]): void {
  let expectedStart = 0;
  for (const candidate of fields) {
    const field = normalizeField(candidate);
    if (field.start !== expectedStart) {
      throw new Error(`Packet fields must be strictly ordered, non-overlapping, and contiguous from bit zero; expected bit ${expectedStart}.`);
    }
    expectedStart = field.end + 1;
    if (!Number.isSafeInteger(expectedStart)) throw new Error('Packet field ranges exceed safe integer bounds.');
  }
}

function normalizeLabel(value: string): string {
  if (/[\u0000-\u0008\u000A-\u001F\u007F]/u.test(value)) {
    throw new Error('Packet field labels must be one-line text.');
  }
  return value;
}

function publicField(field: PacketField): PacketField {
  return { start: field.start, end: field.end, label: field.label };
}

function sameField(left: PacketField, right: PacketField): boolean {
  return left.start === right.start && left.end === right.end && left.label === right.label;
}

function sameFingerprint(left: PacketField, right: PacketField): boolean {
  return left.label === right.label && fieldWidth(left) === fieldWidth(right);
}

function fieldWidth(field: PacketField): number {
  return field.end - field.start + 1;
}

function formatField(field: PacketField): string {
  const range = field.start === field.end ? String(field.start) : `${field.start}-${field.end}`;
  return `${range}: ${encodeQuoted(field.label)}`;
}

function encodeQuoted(value: string): string {
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\t/g, '\\t')}"`;
}

function decodeQuoted(value: string): string {
  let result = '';
  for (let index = 1; index < value.length - 1; index += 1) {
    const character = value[index]!;
    if (character !== '\\') {
      result += character;
      continue;
    }
    const escaped = value[index += 1]!;
    if (escaped === 'b') result += '\b';
    else if (escaped === 'f') result += '\f';
    else if (escaped === 'n') result += '\n';
    else if (escaped === 'r') result += '\r';
    else if (escaped === 't') result += '\t';
    else if (escaped === 'v') result += '\v';
    else if (escaped === '0') result += '\0';
    else result += escaped;
  }
  return result;
}

function stale(): Error {
  return new Error('Packet field changed remotely and can no longer be resolved safely.');
}

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  const matcher = /.*?(?:\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source)) && match[0]) {
    const raw = match[0];
    lines.push({ start: match.index, end: match.index + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') });
  }
  return lines;
}

function sourceLineText(line: Line): string {
  return line.start === 0 ? line.text.replace(/^\uFEFF/, '') : line.text;
}

function firstStatement(lines: readonly Line[]): number {
  let index = 0;
  if (lines[0] && sourceLineText(lines[0]) === '---') {
    const close = lines.findIndex((line, candidate) => candidate > 0 && sourceLineText(line) === '---');
    const frontmatterLines = lines.slice(1, close).map(sourceLineText);
    if (close < 0
      || !isSafeMermaidFrontmatter(frontmatterLines)
      || frontmatterLines.some((line) => /^[\t ]*(?:config|bitsPerRow)[\t ]*:/u.test(line))) return lines.length;
    index = close + 1;
  }
  while (index < lines.length && (blank(sourceLineText(lines[index]!)) || comment(sourceLineText(lines[index]!)))) index += 1;
  return index;
}

function blank(value: string): boolean {
  return /^[\t ]*$/u.test(value);
}

function comment(value: string): boolean {
  return /^[\t ]*%%(?!\{)[^\r\n]*$/u.test(value);
}

function directive(value: string): boolean {
  return /^[\t ]*%%\{/u.test(value);
}

function hasUnexpectedControls(value: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value);
}

function indent(line: Line): string {
  return line.text.match(/^[\t ]*/u)?.[0] ?? '';
}

function terminator(line: Line): string {
  return line.raw.slice(line.text.length);
}

function hasFinalLineEnding(source: string): boolean {
  return /(?:\r\n|\n|\r)$/u.test(source);
}

function localLineEnding(source: string): string {
  return source.match(/\r\n|\n|\r/gu)?.at(-1) ?? '\n';
}

function append(source: string, statement: string): string {
  const ending = localLineEnding(source);
  return hasFinalLineEnding(source) ? `${source}${statement}${ending}` : `${source}${ending}${statement}`;
}

function replaceLine(source: string, line: Line, value: string): string {
  return `${source.slice(0, line.start)}${value}${terminator(line)}${source.slice(line.end)}`;
}

interface LineEdit {
  line: Line;
  value?: string;
}

function applyLineEdits(source: string, edits: readonly LineEdit[]): string {
  const hadFinalLineEnding = hasFinalLineEnding(source);
  const next = [...edits].sort((left, right) => right.line.start - left.line.start).reduce((value, edit) => {
    const replacement = edit.value === undefined ? '' : `${edit.value}${terminator(edit.line)}`;
    return `${value.slice(0, edit.line.start)}${replacement}${value.slice(edit.line.end)}`;
  }, source);
  return !hadFinalLineEnding && hasFinalLineEnding(next) ? next.replace(/(?:\r\n|\n|\r)$/u, '') : next;
}
