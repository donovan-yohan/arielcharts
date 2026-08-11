import { isSafeMermaidFrontmatter } from './mermaid-frontmatter';

export interface SankeyLink {
  source: string;
  target: string;
  value: number;
}

export interface SankeyLinkIdentity extends SankeyLink {
  occurrenceCount: number;
}

export interface SankeyNode {
  label: string;
}

export interface SankeyNodeIdentity extends SankeyNode {
  incidentLinks: SankeyLink[];
  occurrenceCount: number;
}

export interface SankeyDiagramSnapshot {
  links: SankeyLink[];
  nodes: SankeyNode[];
}

interface Line {
  end: number;
  raw: string;
  start: number;
  text: string;
}

interface CsvField {
  end: number;
  outerEnd: number;
  outerStart: number;
  start: number;
  value: string;
}

interface LinkRecord extends SankeyLink {
  fields: readonly [CsvField, CsvField, CsvField];
  line: Line;
}

interface ParsedSankey {
  header: Line;
  links: LinkRecord[];
  nodes: SankeyNode[];
}

interface Replacement {
  end: number;
  start: number;
  value: string;
}

const HEADER = 'sankey-beta';
const NUMBER = /^[+]?(?:(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:[eE][+-]?[0-9]+)?)$/;

export function isSankeyDiagramSource(source: string): boolean {
  return parseSankey(source) !== null;
}

export function isSankeySourceRepresentable(source: string): boolean {
  return parseSankey(source) !== null;
}

export function getSankeyDiagramSnapshot(source: string): SankeyDiagramSnapshot {
  const parsed = requireSankey(source);
  return {
    links: parsed.links.map(publicLink),
    nodes: parsed.nodes.map(({ label }) => ({ label })),
  };
}

export function getSankeyLinkIdentity(
  link: SankeyLink,
  links: readonly SankeyLink[] = [],
): SankeyLinkIdentity {
  return {
    ...publicLink(link),
    occurrenceCount: links.length
      ? links.filter((candidate) => sameLink(candidate, link)).length
      : 1,
  };
}

export function getSankeyNodeIdentity(
  node: SankeyNode,
  links: readonly SankeyLink[],
): SankeyNodeIdentity {
  const incidentLinks = links.filter(
    (link) => link.source === node.label || link.target === node.label,
  );
  return {
    label: node.label,
    incidentLinks: incidentLinks.map(publicLink),
    occurrenceCount: incidentLinks.length ? 1 : 0,
  };
}

export function resolveSankeyLink(
  source: string,
  identity: SankeyLinkIdentity,
): SankeyLink {
  return publicLink(resolveLink(requireSankey(source), identity));
}

export function resolveSankeyNode(
  source: string,
  identity: SankeyNodeIdentity,
): SankeyNode {
  return { label: resolveNode(requireSankey(source), identity).label };
}

export function addSankeyLink(source: string, link: SankeyLink): string {
  const parsed = requireSankey(source);
  const value = normalizeLink(link);
  if (parsed.links.some((candidate) => sameLink(candidate, value))) {
    throw duplicateLink();
  }
  validateGraph([...parsed.links.map(publicLink), value]);
  return requireValidMutation(append(source, formatLink(value)));
}

export function editSankeyLink(
  source: string,
  identity: SankeyLinkIdentity,
  patch: Partial<SankeyLink>,
): string {
  const parsed = requireSankey(source);
  const current = resolveLink(parsed, identity);
  const value = normalizeLink({
    source: patch.source ?? current.source,
    target: patch.target ?? current.target,
    value: patch.value ?? current.value,
  });
  if (sameLink(current, value)) return source;
  if (parsed.links.some((candidate) => candidate !== current && sameLink(candidate, value))) {
    throw duplicateLink();
  }
  validateGraph(parsed.links.map((candidate) => candidate === current ? value : publicLink(candidate)));

  const replacements: Replacement[] = [];
  if (current.source !== value.source) {
    replacements.push(fieldReplacement(current.line, current.fields[0], encodeField(value.source)));
  }
  if (current.target !== value.target) {
    replacements.push(fieldReplacement(current.line, current.fields[1], encodeField(value.target)));
  }
  if (current.value !== value.value) {
    replacements.push(fieldReplacement(current.line, current.fields[2], formatNumber(value.value)));
  }
  return requireValidMutation(replaceRanges(source, replacements));
}

export function deleteSankeyLink(source: string, identity: SankeyLinkIdentity): string {
  const parsed = requireSankey(source);
  const current = resolveLink(parsed, identity);
  if (parsed.links.length === 1) {
    throw new Error('Sankey diagrams need at least one link.');
  }
  return requireValidMutation(deleteLines(source, [current.line]));
}

export function moveSankeyLink(
  source: string,
  identity: SankeyLinkIdentity,
  direction: 'up' | 'down',
): string {
  const parsed = requireSankey(source);
  const current = resolveLink(parsed, identity);
  const index = parsed.links.indexOf(current);
  const other = parsed.links[index + (direction === 'up' ? -1 : 1)];
  if (!other) return source;
  return requireValidMutation(swapLineText(source, current.line, other.line));
}

export function renameSankeyNode(
  source: string,
  identity: SankeyNodeIdentity,
  nextLabel: string,
): string {
  const parsed = requireSankey(source);
  const current = resolveNode(parsed, identity);
  const label = normalizeLabel(nextLabel);
  if (label === current.label) return source;
  if (parsed.nodes.some((node) => node.label === label)) {
    throw new Error(`A Sankey node named ${label} already exists.`);
  }

  const replacements: Replacement[] = [];
  for (const link of parsed.links) {
    if (link.source === current.label) {
      replacements.push(fieldReplacement(link.line, link.fields[0], encodeField(label)));
    }
    if (link.target === current.label) {
      replacements.push(fieldReplacement(link.line, link.fields[1], encodeField(label)));
    }
  }
  return requireValidMutation(replaceRanges(source, replacements));
}

function parseSankey(source: string): ParsedSankey | null {
  try {
    if (!source || source.indexOf('\uFEFF') > 0 || hasUnexpectedWhitespace(source)) return null;
    const lines = splitLines(source);
    const headerIndex = firstStatement(lines);
    const header = lines[headerIndex];
    if (!header || sourceLineText(header) !== HEADER) return null;

    const links: LinkRecord[] = [];
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]!;
      const text = sourceLineText(line);
      if (isBlank(text) || isComment(text)) continue;
      const record = parseRecord(text, line);
      if (!record || links.some((candidate) => sameLink(candidate, record))) return null;
      links.push(record);
    }
    if (!links.length) return null;
    validateGraph(links.map(publicLink));
    return { header, links, nodes: collectNodes(links) };
  } catch {
    return null;
  }
}

function parseRecord(text: string, line: Line): LinkRecord | null {
  const fields = parseCsvFields(text);
  if (!fields || fields.length !== 3) return null;
  const [sourceField, targetField, valueField] = fields;
  const source = parsedLabel(sourceField!.value);
  const target = parsedLabel(targetField!.value);
  const value = parseWeight(valueField!.value);
  if (!source || !target || value === null) return null;
  return {
    fields: [sourceField!, targetField!, valueField!],
    line,
    source,
    target,
    value,
  };
}

function parseCsvFields(text: string): CsvField[] | null {
  const fields: CsvField[] = [];
  let index = 0;
  while (index <= text.length) {
    const start = index;
    let value = '';
    if (text[index] === '"') {
      index += 1;
      let closed = false;
      while (index < text.length) {
        const character = text[index]!;
        if (character !== '"') {
          if (!isCsvAscii(character)) return null;
          value += character;
          index += 1;
          continue;
        }
        if (text[index + 1] === '"') {
          value += '"';
          index += 2;
          continue;
        }
        index += 1;
        closed = true;
        break;
      }
      if (!closed || (index < text.length && text[index] !== ',')) return null;
    } else {
      while (index < text.length && text[index] !== ',') {
        const character = text[index]!;
        if (character === '"' || !isCsvAscii(character)) return null;
        value += character;
        index += 1;
      }
    }
    const raw = text.slice(start, index);
    const leading = text[start] === '"' ? 0 : raw.length - raw.trimStart().length;
    const trailing = text[start] === '"' ? 0 : raw.length - raw.trimEnd().length;
    fields.push({
      end: index - trailing,
      outerEnd: index,
      outerStart: start,
      start: start + leading,
      value: value.trim(),
    });
    if (index === text.length) break;
    index += 1;
    if (fields.length >= 3 && index <= text.length) return null;
  }
  return fields;
}

function requireSankey(source: string): ParsedSankey {
  const parsed = parseSankey(source);
  if (!parsed) {
    throw new Error('This source is not a safely representable Sankey diagram.');
  }
  return parsed;
}

function requireValidMutation(source: string): string {
  requireSankey(source);
  return source;
}

function resolveLink(parsed: ParsedSankey, identity: SankeyLinkIdentity): LinkRecord {
  const matches = parsed.links.filter((link) => sameLink(link, identity));
  if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) {
    throw stale('link');
  }
  return matches[0];
}

function resolveNode(parsed: ParsedSankey, identity: SankeyNodeIdentity): SankeyNode {
  const node = parsed.nodes.find((candidate) => candidate.label === identity.label);
  if (
    identity.occurrenceCount !== 1
    || !identity.incidentLinks.length
    || !node
    || identity.incidentLinks.some(
      (expected) => parsed.links.filter((link) => sameLink(link, expected)).length !== 1,
    )
  ) {
    throw stale('node');
  }
  return node;
}

function validateGraph(links: readonly SankeyLink[]): void {
  if (!links.length) throw new Error('Sankey diagrams need at least one link.');
  const adjacency = new Map<string, string[]>();
  for (const link of links) {
    const value = normalizeLink(link);
    const targets = adjacency.get(value.source) ?? [];
    targets.push(value.target);
    adjacency.set(value.source, targets);
  }
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const visit = (node: string): void => {
    if (visiting.has(node)) throw new Error('Sankey links cannot form cycles.');
    if (visited.has(node)) return;
    visiting.add(node);
    for (const target of adjacency.get(node) ?? []) visit(target);
    visiting.delete(node);
    visited.add(node);
  };
  for (const node of adjacency.keys()) visit(node);
}

function normalizeLink(link: SankeyLink): SankeyLink {
  return {
    source: normalizeLabel(link.source),
    target: normalizeLabel(link.target),
    value: normalizeWeight(link.value),
  };
}

function normalizeLabel(value: string): string {
  const label = value.trim();
  if (!parsedLabel(label)) {
    throw new Error('Sankey node labels must be non-empty single-line printable ASCII text.');
  }
  return label;
}

function parsedLabel(value: string): string | null {
  if (!value || value !== value.trim() || value.includes('%%')) return null;
  for (const character of value) {
    if (!isCsvAscii(character)) return null;
  }
  return value;
}

function normalizeWeight(value: number): number {
  const weight = Number(value);
  if (!Number.isFinite(weight) || weight <= 0) {
    throw new Error('Sankey weights must be finite numbers greater than zero.');
  }
  return weight;
}

function parseWeight(value: string): number | null {
  if (!NUMBER.test(value)) return null;
  const weight = Number(value);
  return Number.isFinite(weight) && weight > 0 ? weight : null;
}

function publicLink(link: SankeyLink): SankeyLink {
  return { source: link.source, target: link.target, value: link.value };
}

function sameLink(left: SankeyLink, right: SankeyLink): boolean {
  return left.source === right.source
    && left.target === right.target
    && left.value === right.value;
}

function collectNodes(links: readonly SankeyLink[]): SankeyNode[] {
  const labels = new Set<string>();
  for (const link of links) {
    labels.add(link.source);
    labels.add(link.target);
  }
  return [...labels].map((label) => ({ label }));
}

function duplicateLink(): Error {
  return new Error('An identical Sankey link already exists.');
}

function stale(kind: 'link' | 'node'): Error {
  return new Error(`Sankey ${kind} changed remotely and can no longer be resolved safely.`);
}

function formatLink(link: SankeyLink): string {
  return `${encodeField(link.source)},${encodeField(link.target)},${formatNumber(link.value)}`;
}

function encodeField(value: string): string {
  return /[,"]/u.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function formatNumber(value: number): string {
  const result = String(normalizeWeight(value));
  if (!NUMBER.test(result)) throw new Error('Sankey weights must be Mermaid-compatible numbers.');
  return result;
}

function fieldReplacement(line: Line, field: CsvField, value: string): Replacement {
  const replaceOuterField = value.startsWith('"');
  return {
    end: line.start + (replaceOuterField ? field.outerEnd : field.end),
    start: line.start + (replaceOuterField ? field.outerStart : field.start),
    value,
  };
}

function isCsvAscii(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code >= 0x20 && code <= 0x7e;
}

function hasUnexpectedWhitespace(source: string): boolean {
  return /[^\S\r\n\t ]/u.test(source.startsWith('\uFEFF') ? source.slice(1) : source);
}

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  const matcher = /.*?(?:\r\n|\n|\r|$)/g;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source)) && match[0]) {
    const raw = match[0];
    lines.push({
      end: match.index + raw.length,
      raw,
      start: match.index,
      text: raw.replace(/\r\n|\n|\r$/, ''),
    });
  }
  return lines;
}

function sourceLineText(line: Line): string {
  return line.start === 0 ? line.text.replace(/^\uFEFF/, '') : line.text;
}

function firstStatement(lines: readonly Line[]): number {
  let index = 0;
  if (lines[0] && sourceLineText(lines[0]) === '---') {
    const close = lines.findIndex(
      (line, candidate) => candidate > 0 && sourceLineText(line) === '---',
    );
    if (close < 0 || !isSafeMermaidFrontmatter(lines.slice(1, close).map(sourceLineText))) {
      return lines.length;
    }
    index = close + 1;
  }
  while (
    index < lines.length
    && (isBlank(sourceLineText(lines[index]!)) || isComment(sourceLineText(lines[index]!)))
  ) {
    index += 1;
  }
  return index;
}

function isBlank(value: string): boolean {
  return /^[\t ]*$/.test(value);
}

function isComment(value: string): boolean {
  return /^[\t ]*%%[^\r\n]*$/.test(value);
}

function terminator(line: Line): string {
  return line.raw.slice(line.text.length);
}

function localLineEnding(source: string): string {
  return source.match(/\r\n|\n|\r/g)?.at(-1) ?? '\n';
}

function hasFinalLineEnding(source: string): boolean {
  return /(?:\r\n|\n|\r)$/.test(source);
}

function append(source: string, statement: string): string {
  const ending = localLineEnding(source);
  return hasFinalLineEnding(source)
    ? `${source}${statement}${ending}`
    : `${source}${ending}${statement}`;
}

function deleteLines(source: string, lines: readonly Line[]): string {
  const hadFinalEnding = hasFinalLineEnding(source);
  const next = [...lines]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (value, line) => `${value.slice(0, line.start)}${value.slice(line.end)}`,
      source,
    );
  return !hadFinalEnding && hasFinalLineEnding(next)
    ? next.replace(/(?:\r\n|\n|\r)$/, '')
    : next;
}

function swapLineText(source: string, left: Line, right: Line): string {
  const first = left.start < right.start ? left : right;
  const second = first === left ? right : left;
  return `${source.slice(0, first.start)}${second.text}${terminator(first)}`
    + `${source.slice(first.end, second.start)}${first.text}${terminator(second)}`
    + source.slice(second.end);
}

function replaceRanges(source: string, replacements: readonly Replacement[]): string {
  return [...replacements]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (value, replacement) => `${value.slice(0, replacement.start)}${replacement.value}${value.slice(replacement.end)}`,
      source,
    );
}
