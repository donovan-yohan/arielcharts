import { isSafeMermaidFrontmatter } from './mermaid-frontmatter';

export interface TreemapNode {
  ancestorLabels: string[];
  label: string;
  /** A source-derived, non-display identifier. It is intentionally opaque. */
  opaqueId?: string;
  value: number | null;
}

export interface TreemapNodeIdentity {
  node: TreemapNode;
  occurrenceCount: number;
}

export interface TreemapDiagramSnapshot {
  nodes: TreemapNode[];
}

interface Line {
  end: number;
  raw: string;
  start: number;
  text: string;
}

interface Range {
  end: number;
  start: number;
}

interface NodeRecord extends TreemapNode {
  colonClause?: Range;
  content: string;
  depth: number;
  labelToken: Range;
  line: Line;
  parent?: NodeRecord;
  quote: '"' | "'";
  valueToken?: Range;
}

interface ParsedTreemap {
  header: Line;
  lines: Line[];
  nodes: NodeRecord[];
  rootIndent: string;
  unit: string;
}

const NUMBER = '(?:0|[1-9][0-9]*)(?:\\.[0-9]+)?';
const NODE = new RegExp(
  `^([ \\t]*)("[^"]*"|'[^']*')([ \\t]*)(?::([ \\t]*)(${NUMBER}))?([ \\t]*)$`,
  'u',
);

export function isTreemapDiagramSource(source: string): boolean {
  return parseTreemap(source) !== null;
}

export function isTreemapSourceRepresentable(source: string): boolean {
  return parseTreemap(source) !== null;
}

export function getTreemapDiagramSnapshot(source: string): TreemapDiagramSnapshot {
  return { nodes: requireTreemap(source).nodes.map(publicNode) };
}

export function getTreemapNodeIdentity(
  node: TreemapNode,
  nodes: readonly TreemapNode[] = [],
): TreemapNodeIdentity {
  const fingerprint = publicNode(node);
  return {
    node: fingerprint,
    occurrenceCount: nodes.length
      ? nodes.filter((candidate) => sameNode(candidate, fingerprint)).length
      : 1,
  };
}

export function resolveTreemapNode(
  source: string,
  identity: TreemapNodeIdentity,
): TreemapNode {
  return publicNode(resolveNode(requireTreemap(source), identity));
}

export function addTreemapNode(
  source: string,
  node: Omit<TreemapNode, 'ancestorLabels'>,
  parent?: TreemapNodeIdentity,
): string {
  const value = normalizeNode(node);
  if (!source) {
    if (parent) throw new Error('A new Treemap root cannot have a parent.');
    return `treemap-beta\n  ${formatNode(value)}`;
  }

  const parsed = requireTreemap(source);
  if (!parsed.nodes.length) {
    if (parent) throw stale();
    return requireValidMutation(appendStatement(source, `  ${formatNode(value)}`));
  }
  if (!parent) throw new Error('Treemap diagrams require exactly one root node.');
  const target = resolveNode(parsed, parent);
  if (target.value !== null) throw new Error('Treemap leaf nodes cannot contain children.');

  const targetIndex = parsed.nodes.indexOf(target);
  const insertionNode = parsed.nodes[subtreeEnd(parsed.nodes, targetIndex)];
  const statement = `${indentFor(parsed, target.depth + 1)}${formatNode(value)}`;
  const next = insertStatement(source, insertionNode?.line.start ?? source.length, statement);
  return requireValidMutation(next);
}

export function editTreemapNode(
  source: string,
  identity: TreemapNodeIdentity,
  patch: Partial<Pick<TreemapNode, 'label' | 'value'>>,
): string {
  const parsed = requireTreemap(source);
  const current = resolveNode(parsed, identity);
  const value = normalizeNode({
    label: patch.label ?? current.label,
    value: patch.value === undefined ? current.value : patch.value,
  });
  const currentIndex = parsed.nodes.indexOf(current);
  if (value.value !== null && subtreeEnd(parsed.nodes, currentIndex) > currentIndex + 1) {
    throw new Error('Treemap parent nodes cannot have numeric values.');
  }
  if (current.label === value.label && current.value === value.value) return source;

  const replacements: Array<{ range: Range; value: string }> = [];
  if (current.label !== value.label) {
    replacements.push({
      range: current.labelToken,
      value: encodeLabel(value.label, current.quote),
    });
  }
  if (current.value !== value.value) {
    if (current.valueToken && value.value !== null) {
      replacements.push({ range: current.valueToken, value: formatNumber(value.value) });
    } else if (current.colonClause && value.value === null) {
      replacements.push({ range: current.colonClause, value: '' });
    } else if (value.value !== null) {
      replacements.push({
        range: { end: current.labelToken.end, start: current.labelToken.end },
        value: `: ${formatNumber(value.value)}`,
      });
    }
  }
  return requireValidMutation(replaceRanges(source, replacements));
}

export function deleteTreemapNode(source: string, identity: TreemapNodeIdentity): string {
  const parsed = requireTreemap(source);
  const current = resolveNode(parsed, identity);
  const index = parsed.nodes.indexOf(current);
  if (current.depth === 0) throw new Error('The Treemap root cannot be deleted.');
  const records = parsed.nodes.slice(index, subtreeEnd(parsed.nodes, index));
  return requireValidMutation(deleteLines(source, records.map((record) => record.line)));
}

export function moveTreemapNode(
  source: string,
  identity: TreemapNodeIdentity,
  direction: 'up' | 'down',
): string {
  const parsed = requireTreemap(source);
  const current = resolveNode(parsed, identity);
  const currentIndex = parsed.nodes.indexOf(current);
  const siblings = parsed.nodes
    .map((node, index) => ({ index, node }))
    .filter(({ node }) => sameParent(node, current));
  const siblingPosition = siblings.findIndex(({ node }) => node === current)
    + (direction === 'up' ? -1 : 1);
  const sibling = siblings[siblingPosition];
  if (!sibling) return source;

  const firstIndex = Math.min(currentIndex, sibling.index);
  const secondIndex = Math.max(currentIndex, sibling.index);
  const firstEnd = subtreeEnd(parsed.nodes, firstIndex);
  const secondEnd = subtreeEnd(parsed.nodes, secondIndex);
  const reordered = [
    ...parsed.nodes.slice(0, firstIndex),
    ...parsed.nodes.slice(secondIndex, secondEnd),
    ...parsed.nodes.slice(firstEnd, secondIndex),
    ...parsed.nodes.slice(firstIndex, firstEnd),
    ...parsed.nodes.slice(secondEnd),
  ];
  return requireValidMutation(rewriteNodeSlots(source, parsed, reordered));
}

export function reparentTreemapNode(
  source: string,
  identity: TreemapNodeIdentity,
  parent: TreemapNodeIdentity,
): string {
  const parsed = requireTreemap(source);
  const current = resolveNode(parsed, identity);
  const target = resolveNode(parsed, parent);
  const currentIndex = parsed.nodes.indexOf(current);
  const targetIndex = parsed.nodes.indexOf(target);
  const currentEnd = subtreeEnd(parsed.nodes, currentIndex);
  if (current.depth === 0) throw new Error('The Treemap root cannot be reparented.');
  if (target.value !== null) throw new Error('Treemap leaf nodes cannot contain children.');
  if (targetIndex >= currentIndex && targetIndex < currentEnd) {
    throw new Error('A Treemap node cannot become its own descendant.');
  }
  if (current.parent === target) return source;

  const subtree = parsed.nodes.slice(currentIndex, currentEnd);
  const remaining = parsed.nodes.filter((_record, index) => index < currentIndex || index >= currentEnd);
  const targetInRemaining = remaining.indexOf(target);
  if (targetInRemaining < 0) throw stale();
  const insertion = subtreeEnd(remaining, targetInRemaining);
  const depthDelta = target.depth + 1 - current.depth;
  const moved = subtree.map((record) => ({ ...record, depth: record.depth + depthDelta }));
  const reordered = [...remaining.slice(0, insertion), ...moved, ...remaining.slice(insertion)];
  return requireValidMutation(rewriteNodeSlots(source, parsed, reordered));
}

function parseTreemap(source: string): ParsedTreemap | null {
  try {
    if (!source || source.indexOf('\uFEFF') > 0 || hasUnexpectedControls(source)) return null;
    const lines = splitLines(source);
    const headerIndex = firstStatement(lines);
    const header = lines[headerIndex];
    if (!header || sourceLineText(header) !== 'treemap-beta') return null;

    const nodes: NodeRecord[] = [];
    let rootIndent = '';
    let unit = '';
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]!;
      const text = sourceLineText(line);
      if (ignorable(text)) continue;
      const match = text.match(NODE);
      if (!match) return null;
      const prefix = match[1]!;
      if (!nodes.length) rootIndent = prefix;
      let depth = 0;
      if (nodes.length) {
        if (!prefix.startsWith(rootIndent)) return null;
        const suffix = prefix.slice(rootIndent.length);
        if (!unit && suffix) unit = suffix;
        if (!unit || suffix.length % unit.length !== 0) return null;
        depth = suffix.length / unit.length;
        if (unit.repeat(depth) !== suffix || depth > nodes.at(-1)!.depth + 1) return null;
        if (depth === 0) return null;
      }
      const parent = depth === 0
        ? undefined
        : [...nodes].reverse().find((candidate) => candidate.depth === depth - 1);
      if (depth > 0 && !parent) return null;

      const token = match[2]!;
      const quote = token[0] as '"' | "'";
      const label = token.slice(1, -1);
      const numeric = match[5];
      const value = numeric === undefined ? null : Number(numeric);
      const normalized = normalizeNode({ label, value });
      if (normalized.label !== label) return null;
      const tokenOffset = prefix.length;
      const valueOffset = numeric === undefined ? -1 : text.lastIndexOf(numeric);
      const colonOffset = numeric === undefined ? -1 : text.lastIndexOf(':', valueOffset);
      let clauseOffset = colonOffset;
      while (clauseOffset > tokenOffset + token.length && /[ \t]/u.test(text[clauseOffset - 1]!)) {
        clauseOffset -= 1;
      }
      const record: NodeRecord = {
        ancestorLabels: parent ? [...parent.ancestorLabels, parent.label] : [],
        ...(numeric === undefined ? {} : {
          colonClause: { end: line.start + valueOffset + numeric.length, start: line.start + clauseOffset },
          valueToken: { end: line.start + valueOffset + numeric.length, start: line.start + valueOffset },
        }),
        content: text.slice(prefix.length),
        depth,
        label,
        labelToken: { end: line.start + tokenOffset + token.length, start: line.start + tokenOffset },
        line,
        ...(parent ? { parent } : {}),
        quote,
        value,
      };
      record.opaqueId = opaqueNodeId(record, token, numeric ?? null);
      nodes.push(record);
    }
    if (nodes.length > 1 && !unit) return null;
    for (let index = 0; index < nodes.length; index += 1) {
      const node = nodes[index]!;
      if (node.value !== null && subtreeEnd(nodes, index) > index + 1) return null;
    }
    if (!hasFiniteAggregateTotals(nodes)) return null;
    return { header, lines, nodes, rootIndent, unit: unit || '  ' };
  } catch {
    return null;
  }
}

function requireTreemap(source: string): ParsedTreemap {
  const parsed = parseTreemap(source);
  if (!parsed) throw new Error('This source is not a safely representable Treemap diagram.');
  return parsed;
}

function requireValidMutation(source: string): string {
  requireTreemap(source);
  return source;
}

function resolveNode(parsed: ParsedTreemap, identity: TreemapNodeIdentity): NodeRecord {
  if (identity.occurrenceCount !== 1) throw stale();
  const matches = parsed.nodes.filter((candidate) => sameNode(candidate, identity.node));
  if (matches.length !== 1 || !matches[0]) throw stale();
  return matches[0];
}

function normalizeNode(node: Pick<TreemapNode, 'label' | 'value'>): Pick<TreemapNode, 'label' | 'value'> {
  const label = node.label.trim();
  if (!label || /[\r\n]/u.test(label) || (label.includes('"') && label.includes("'"))) {
    throw new Error('Treemap labels must be non-empty one-line text using at most one quote style.');
  }
  if (node.value !== null && (!Number.isFinite(node.value) || node.value <= 0)) {
    throw new Error('Treemap values must be finite numbers greater than zero.');
  }
  return { label, value: node.value };
}

function publicNode(node: TreemapNode): TreemapNode {
  const value = { ancestorLabels: [...node.ancestorLabels], label: node.label, value: node.value };
  if (node.opaqueId) {
    Object.defineProperty(value, 'opaqueId', {
      configurable: false,
      enumerable: false,
      value: node.opaqueId,
      writable: false,
    });
  }
  return value;
}

function sameNode(left: TreemapNode, right: TreemapNode): boolean {
  return left.label === right.label
    && left.value === right.value
    && left.ancestorLabels.length === right.ancestorLabels.length
    && left.ancestorLabels.every((label, index) => label === right.ancestorLabels[index])
    && (!left.opaqueId || !right.opaqueId || left.opaqueId === right.opaqueId);
}

function sameParent(left: NodeRecord, right: NodeRecord): boolean {
  return left.parent === right.parent;
}

function opaqueNodeId(
  node: Pick<TreemapNode, 'ancestorLabels' | 'label' | 'value'>,
  labelToken: string,
  valueToken: string | null,
): string {
  // JSON's length-aware string encoding gives us a lossless source identity without
  // ever depending on a human-facing path delimiter.
  return JSON.stringify([node.ancestorLabels, labelToken, valueToken]);
}

function hasFiniteAggregateTotals(nodes: readonly NodeRecord[]): boolean {
  const totals = new Map<NodeRecord, number>();
  for (const node of [...nodes].reverse()) {
    const own = node.value ?? totals.get(node) ?? 0;
    if (!Number.isFinite(own)) return false;
    if (node.parent) {
      const next = (totals.get(node.parent) ?? 0) + own;
      if (!Number.isFinite(next)) return false;
      totals.set(node.parent, next);
    }
  }
  return true;
}

function subtreeEnd(nodes: readonly { depth: number }[], index: number): number {
  const node = nodes[index];
  if (!node) throw stale();
  const offset = nodes.slice(index + 1).findIndex((candidate) => candidate.depth <= node.depth);
  return offset < 0 ? nodes.length : index + 1 + offset;
}

function indentFor(parsed: ParsedTreemap, depth: number): string {
  return `${parsed.rootIndent}${parsed.unit.repeat(depth)}`;
}

function encodeLabel(label: string, preferred: '"' | "'" = '"'): string {
  const quote = label.includes(preferred) ? (preferred === '"' ? "'" : '"') : preferred;
  if (label.includes(quote)) throw new Error('Treemap labels cannot contain both quote styles.');
  return `${quote}${label}${quote}`;
}

function formatNode(node: Pick<TreemapNode, 'label' | 'value'>): string {
  return `${encodeLabel(node.label)}${node.value === null ? '' : `: ${formatNumber(node.value)}`}`;
}

function formatNumber(value: number): string {
  return plainNumber(value);
}

function plainNumber(value: number): string {
  const source = String(value);
  if (!/[eE]/u.test(source)) return source;
  const [coefficient, exponentText] = source.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const dot = coefficient!.indexOf('.');
  const digits = coefficient!.replace('.', '');
  const decimal = (dot < 0 ? coefficient!.length : dot) + exponent;
  return decimal <= 0
    ? `0.${'0'.repeat(-decimal)}${digits}`
    : decimal >= digits.length
      ? `${digits}${'0'.repeat(decimal - digits.length)}`
      : `${digits.slice(0, decimal)}.${digits.slice(decimal)}`;
}

function rewriteNodeSlots(
  source: string,
  parsed: ParsedTreemap,
  reordered: readonly NodeRecord[],
): string {
  if (reordered.length !== parsed.nodes.length) throw stale();
  return replaceRanges(source, parsed.nodes.map((slot, index) => {
    const record = reordered[index]!;
    return {
      range: { end: slot.line.start + slot.line.text.length, start: slot.line.start },
      value: `${indentFor(parsed, record.depth)}${record.content}`,
    };
  }));
}

function replaceRanges(
  source: string,
  replacements: readonly { range: Range; value: string }[],
): string {
  let next = source;
  for (const replacement of [...replacements].sort((left, right) => right.range.start - left.range.start)) {
    next = `${next.slice(0, replacement.range.start)}${replacement.value}${next.slice(replacement.range.end)}`;
  }
  return next;
}

function deleteLines(source: string, lines: readonly Line[]): string {
  const sorted = [...lines].sort((left, right) => left.start - right.start);
  const first = sorted[0];
  const last = sorted.at(-1);
  if (!first || !last) return source;
  let start = first.start;
  if (!terminator(last) && last.end === source.length) {
    const preceding = source.slice(0, start).match(/(?:\r\n|\n|\r)$/u)?.[0];
    start -= preceding?.length ?? 0;
  }
  return `${source.slice(0, start)}${source.slice(last.end)}`;
}

function insertStatement(source: string, at: number, statement: string): string {
  const ending = localLineEnding(source, at);
  if (at < source.length) return `${source.slice(0, at)}${statement}${ending}${source.slice(at)}`;
  return appendStatement(source, statement);
}

function appendStatement(source: string, statement: string): string {
  const ending = localLineEnding(source, source.length);
  return hasFinalLineEnding(source)
    ? `${source}${statement}${ending}`
    : `${source}${ending}${statement}`;
}

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  const matcher = /.*?(?:\r\n|\n|\r|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source)) && match[0]) {
    lines.push({
      end: match.index + match[0].length,
      raw: match[0],
      start: match.index,
      text: match[0].replace(/\r\n|\n|\r$/u, ''),
    });
  }
  return lines;
}

function sourceLineText(line: Line): string {
  return line.start === 0 ? line.text.replace(/^\uFEFF/u, '') : line.text;
}

function terminator(line: Line): string {
  return line.raw.slice(line.text.length);
}

function firstStatement(lines: readonly Line[]): number {
  let index = 0;
  if (lines[0] && sourceLineText(lines[0]) === '---') {
    const close = lines.findIndex((line, candidate) => candidate > 0 && sourceLineText(line) === '---');
    const frontmatter = lines.slice(1, close).map(sourceLineText);
    if (close < 0
      || !isSafeMermaidFrontmatter(frontmatter)
      || frontmatter.some((line) => /^[ \t]*config[ \t]*:/u.test(line))) return lines.length;
    index = close + 1;
  }
  while (index < lines.length && ignorable(sourceLineText(lines[index]!))) index += 1;
  return index;
}

function ignorable(value: string): boolean {
  return /^[ \t]*$/u.test(value)
    || /^[ \t]*%%(?!\{)[^\r\n]*$/u.test(value);
}

function hasUnexpectedControls(source: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(source);
}

function hasFinalLineEnding(source: string): boolean {
  return /(?:\r\n|\n|\r)$/u.test(source);
}

function localLineEnding(source: string, at: number): string {
  const before = source.slice(0, at).match(/\r\n|\n|\r/gu)?.at(-1);
  const after = source.slice(at).match(/\r\n|\n|\r/u)?.[0];
  return before ?? after ?? '\n';
}

function stale(): Error {
  return new Error('Treemap node changed remotely and can no longer be resolved safely.');
}
