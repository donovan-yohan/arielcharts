export type MindmapNodeShape = 'bang' | 'circle' | 'cloud' | 'default' | 'hexagon' | 'rounded' | 'square';

export interface MindmapNode {
  ancestorLabels?: string[];
  classes: string[];
  id?: string;
  icon?: string;
  label: string;
  parentLabel?: string;
  shape: MindmapNodeShape;
}

/** A source-derived fingerprint. Ambiguous duplicate nodes deliberately fail closed. */
export interface MindmapNodeIdentity { node: MindmapNode; occurrenceCount: number; }
export interface MindmapDiagramSnapshot { nodes: MindmapNode[]; }

interface Line { end: number; index: number; raw: string; start: number; text: string; }
interface NodeRecord extends MindmapNode { indent: number; line: Line; parentIndex?: number; }
interface Parsed { lines: Line[]; nodes: NodeRecord[]; }

const HEADER = /^\s*mindmap\s*$/i;
const CLASS = /^\s*:::\s*([A-Za-z_][A-Za-z0-9_-]*(?:\s+[A-Za-z_][A-Za-z0-9_-]*)*)\s*$/;
const ICON = /^\s*::icon\(([A-Za-z0-9:_ -]+)\)\s*$/;
const SHAPES: readonly [MindmapNodeShape, RegExp][] = [
  ['circle', /^([A-Za-z_][A-Za-z0-9_-]*)?\(\(([^()\r\n]+)\)\)$/],
  ['bang', /^([A-Za-z_][A-Za-z0-9_-]*)?\)\)([^()\r\n]+)\(\($/],
  ['hexagon', /^([A-Za-z_][A-Za-z0-9_-]*)?\{\{([^{}\r\n]+)\}\}$/],
  ['rounded', /^([A-Za-z_][A-Za-z0-9_-]*)?\(([^()\r\n]+)\)$/],
  ['cloud', /^([A-Za-z_][A-Za-z0-9_-]*)?\)([^()\r\n]+)\($/],
  ['square', /^([A-Za-z_][A-Za-z0-9_-]*)?\[([^\[\]\r\n]+)\]$/],
];

export function isMindmapDiagramSource(source: string): boolean { return parseMindmap(source) !== null; }
export function isMindmapSourceRepresentable(source: string): boolean { return parseMindmap(source) !== null; }
export function getMindmapDiagramSnapshot(source: string): MindmapDiagramSnapshot {
  return { nodes: requireMindmap(source).nodes.map(publicNode) };
}
export function getMindmapNodeIdentity(node: MindmapNode, nodes: readonly MindmapNode[] = []): MindmapNodeIdentity {
  const snapshot = publicNode(node);
  return { node: snapshot, occurrenceCount: nodes.length && !hasUniquePathPrefixes(snapshot, nodes) ? 0 : (nodes.length ? nodes.filter((candidate) => sameNode(candidate, node)).length : 1) };
}
export function resolveMindmapNodeIndex(nodes: readonly MindmapNode[], identity: MindmapNodeIdentity): number {
  if (identity.occurrenceCount !== 1 || !hasUniquePathPrefixes(identity.node, nodes)) throw stale();
  const matches = nodes.map((node, index) => ({ index, node })).filter(({ node }) => sameNode(node, identity.node));
  if (matches.length !== 1 || !matches[0]) throw stale();
  return matches[0].index;
}

export function addMindmapNode(source: string, node: Omit<MindmapNode, 'parentLabel'>, parent?: MindmapNodeIdentity): string {
  const value = normalizeNode(node);
  if (!source.trim()) {
    if (parent) throw new Error('A new mindmap has no parent node.');
    return `mindmap\n  ${formatNode(value)}`;
  }
  const parsed = requireMindmap(source);
  if (!parent) throw new Error('Mindmaps require exactly one root node.');
  const parentRecord = resolveRecord(parsed, parent);
  const insertionIndex = blockEnd(parsed, parsed.nodes.indexOf(parentRecord));
  const lines = parsed.lines;
  const at = lines[insertionIndex]?.start ?? source.length;
  const ending = lineEnding(source);
  const prefix = source.slice(0, at);
  const text = `${' '.repeat(parentRecord.indent + 2)}${formatNode(value)}${metadataLines(value, parentRecord.indent + 2, ending)}`;
  return `${prefix}${prefix && !endsWithTerminator(prefix) ? ending : ''}${text}${source.slice(at)}`;
}

export function editMindmapNode(source: string, identity: MindmapNodeIdentity, patch: Partial<Omit<MindmapNode, 'parentLabel'>>): string {
  const parsed = requireMindmap(source); const current = resolveRecord(parsed, identity);
  const value = normalizeNode({ ...current, ...patch, classes: patch.classes ?? current.classes });
  const metadata = metadataRecords(parsed, current);
  const replacements = [{ line: current.line, value: `${' '.repeat(current.indent)}${formatNode(value)}` }, ...metadata.map((line) => ({ line, value: '' }))];
  return replaceLines(source, replacements, value, current.indent);
}

/** Deletes a non-root node with its complete source-backed subtree. */
export function deleteMindmapNode(source: string, identity: MindmapNodeIdentity): string {
  const parsed = requireMindmap(source); const record = resolveRecord(parsed, identity); const index = parsed.nodes.indexOf(record);
  if (record.parentIndex === undefined) throw new Error('The mindmap root cannot be deleted.');
  return deleteLineRange(source, parsed.lines, record.line.index, blockEnd(parsed, index));
}

export function moveMindmapNode(source: string, identity: MindmapNodeIdentity, direction: 'up' | 'down'): string {
  const parsed = requireMindmap(source); const record = resolveRecord(parsed, identity); const index = parsed.nodes.indexOf(record);
  const siblings = parsed.nodes.filter((item) => item.parentIndex === record.parentIndex);
  const siblingIndex = siblings.indexOf(record); const other = siblings[siblingIndex + (direction === 'up' ? -1 : 1)];
  if (!other) return source;
  const otherIndex = parsed.nodes.indexOf(other);
  const first = Math.min(index, otherIndex); const second = Math.max(index, otherIndex);
  return swapLineBlocks(source, parsed.lines, parsed.nodes[first]!.line.index, parsed.nodes[second]!.line.index, blockEnd(parsed, second));
}

/** Reparents a non-root subtree below another existing node, preserving line terminators at source positions. */
export function reparentMindmapNode(source: string, identity: MindmapNodeIdentity, parent: MindmapNodeIdentity): string {
  const parsed = requireMindmap(source); const record = resolveRecord(parsed, identity); const target = resolveRecord(parsed, parent);
  const index = parsed.nodes.indexOf(record); const targetIndex = parsed.nodes.indexOf(target);
  if (record.parentIndex === undefined || index === targetIndex) throw new Error('A mindmap root cannot be reparented.');
  if (targetIndex >= index && targetIndex < blockEnd(parsed, index)) throw new Error('A mindmap node cannot become its own descendant.');
  const start = record.line.index; const end = blockEnd(parsed, index); const targetEnd = blockEnd(parsed, targetIndex);
  const moving = parsed.lines.slice(start, end).map((line) => shiftIndent(line, record.indent, target.indent + 2));
  const remaining = [...parsed.lines.slice(0, start), ...parsed.lines.slice(end)];
  const marker = parsed.lines[targetEnd]; const insertion = marker ? remaining.findIndex((line) => line.start === marker.start) : remaining.length;
  if (insertion < 0) throw stale();
  const ordered = [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)];
  return withOriginalTerminators(ordered, parsed.lines);
}

function parseMindmap(source: string): Parsed | null {
  try {
    const lines = splitLines(source); const headerIndex = statementIndex(lines);
    if (!HEADER.test(lines[headerIndex]?.text.replace(/^\uFEFF/, '') ?? '')) return null;
    const nodes: NodeRecord[] = []; let previousNode: NodeRecord | undefined; let rootIndent: number | undefined; const indents: number[] = [];
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]!; if (!line.text.trim() || ignorable(line.text)) continue;
      const classes = line.text.match(CLASS); const icon = line.text.match(ICON);
      if (classes || icon) {
        if (!previousNode || indent(line) < previousNode.indent) return null;
        if (classes) previousNode.classes.push(...classes[1]!.trim().split(/\s+/)); else previousNode.icon = icon![1]!.trim();
        continue;
      }
      const parsedNode = parseNode(line.text.trim()); if (!parsedNode) return null;
      const nodeIndent = indent(line); if (rootIndent === undefined) { rootIndent = nodeIndent; indents.push(nodeIndent); }
      if (nodeIndent < rootIndent) return null;
      if (!previousNode) { if (nodeIndent !== rootIndent) return null; nodes.push({ ...parsedNode, classes: [], indent: nodeIndent, line }); previousNode = nodes[0]; continue; }
      if (nodeIndent > previousNode.indent) { indents.push(nodeIndent); }
      else if (!indents.includes(nodeIndent)) return null;
      const parentIndex = findParent(nodes, nodeIndent);
      if (parentIndex === undefined) return null;
      const node: NodeRecord = { ...parsedNode, classes: [], indent: nodeIndent, line, parentIndex };
      nodes.push(node); previousNode = node;
    }
    if (nodes.length !== 1 && nodes.filter((node) => node.parentIndex === undefined).length !== 1) return null;
    for (const node of nodes) {
      if (new Set(node.classes).size !== node.classes.length || (node.icon && !iconName(node.icon))) return null;
      const parent = node.parentIndex === undefined ? undefined : nodes[node.parentIndex];
      node.parentLabel = parent?.label;
      node.ancestorLabels = parent ? [...(parent.ancestorLabels ?? []), parent.label] : [];
    }
    return { lines, nodes };
  } catch { return null; }
}

function parseNode(value: string): Omit<MindmapNode, 'classes' | 'parentLabel'> | null {
  for (const [shape, pattern] of SHAPES) { const match = value.match(pattern); if (match) return { ...(match[1] ? { id: identifier(match[1]!) } : {}), label: normalText(match[2]!), shape }; }
  if (/[:\[\]{}()\r\n]/.test(value)) return null;
  return { label: normalText(value), shape: 'default' };
}

function requireMindmap(source: string): Parsed { const parsed = parseMindmap(source); if (!parsed) throw new Error('This source is not a safely representable mindmap.'); return parsed; }
function resolveRecord(parsed: Parsed, identity: MindmapNodeIdentity): NodeRecord { const index = resolveMindmapNodeIndex(parsed.nodes.map(publicNode), identity); const record = parsed.nodes[index]; if (!record) throw stale(); return record; }
function publicNode(node: MindmapNode): MindmapNode { return { ancestorLabels: [...(node.ancestorLabels ?? [])], classes: [...node.classes], ...(node.id ? { id: node.id } : {}), ...(node.icon ? { icon: node.icon } : {}), label: node.label, ...(node.parentLabel ? { parentLabel: node.parentLabel } : {}), shape: node.shape }; }
function hasUniquePathPrefixes(node: MindmapNode, nodes: readonly MindmapNode[]): boolean {
  const path = [...(node.ancestorLabels ?? []), node.label];
  return path.every((_part, length) => nodes.filter((candidate) => {
    const candidatePath = [...(candidate.ancestorLabels ?? []), candidate.label];
    return candidatePath.length === length + 1 && candidatePath.every((part, index) => part === path[index]);
  }).length === 1);
}
function sameNode(left: MindmapNode, right: MindmapNode): boolean { const leftAncestors = left.ancestorLabels ?? []; const rightAncestors = right.ancestorLabels ?? []; return left.id === right.id && left.label === right.label && left.parentLabel === right.parentLabel && left.shape === right.shape && left.icon === right.icon && leftAncestors.length === rightAncestors.length && leftAncestors.every((item, index) => item === rightAncestors[index]) && left.classes.length === right.classes.length && left.classes.every((item, index) => item === right.classes[index]); }
function normalizeNode(node: Omit<MindmapNode, 'parentLabel'>): Omit<MindmapNode, 'parentLabel'> { const shape = SHAPES.some(([candidate]) => candidate === node.shape) || node.shape === 'default' ? node.shape : (() => { throw new Error('Unsupported mindmap node shape.'); })(); if (node.id && shape === 'default') throw new Error('Default mindmap nodes do not have a separate Mermaid id.'); const classes = node.classes.map((item) => className(item)); if (new Set(classes).size !== classes.length) throw new Error('Mindmap node classes must be unique.'); return { classes, ...(node.id ? { id: identifier(node.id) } : {}), ...(node.icon ? { icon: iconName(node.icon) } : {}), label: normalText(node.label), shape }; }
function normalText(value: string): string { const text = value.trim(); if (!text || /[\r\n]/.test(text)) throw new Error('Mindmap node labels must be non-empty one-line text.'); return text; }
function className(value: string): string { const text = value.trim(); if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(text)) throw new Error('Mindmap class names must be identifiers.'); return text; }
function identifier(value: string): string { const text = value.trim(); if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(text)) throw new Error('Mindmap node ids must be identifiers.'); return text; }
function iconName(value: string): string { const text = value.trim(); if (!/^[A-Za-z0-9:_ -]+$/.test(text)) throw new Error('Mindmap icon names must be Mermaid-safe.'); return text; }
function formatNode(node: Omit<MindmapNode, 'parentLabel'>): string { const label = node.label; const id = node.id ?? ''; if (node.shape === 'default') return label; if (node.shape === 'square') return `${id}[${label}]`; if (node.shape === 'rounded') return `${id}(${label})`; if (node.shape === 'circle') return `${id}((${label}))`; if (node.shape === 'bang') return `${id}))${label}((`; if (node.shape === 'cloud') return `${id})${label}(`; return `${id}{{${label}}}`; }
function metadataLines(node: Omit<MindmapNode, 'parentLabel'>, indentValue: number, ending: string): string { const prefix = `\n${' '.repeat(indentValue)}`; return `${node.icon ? `${prefix}::icon(${node.icon})` : ''}${node.classes.length ? `${prefix}:::${node.classes.join(' ')}` : ''}`.replace(/\n/g, ending); }
function metadataRecords(parsed: Parsed, node: NodeRecord): Line[] { const start = node.line.index + 1; const next = parsed.nodes.find((item) => item.line.index > node.line.index)?.line.index ?? parsed.lines.length; return parsed.lines.slice(start, next).filter((line) => CLASS.test(line.text) || ICON.test(line.text)); }
function findParent(nodes: readonly NodeRecord[], nodeIndent: number): number | undefined { for (let index = nodes.length - 1; index >= 0; index -= 1) if (nodes[index]!.indent < nodeIndent) return index; return undefined; }
function blockEnd(parsed: Parsed, nodeIndex: number): number { const node = parsed.nodes[nodeIndex]; if (!node) throw stale(); const next = parsed.nodes.slice(nodeIndex + 1).find((item) => item.indent <= node.indent); return next?.line.index ?? parsed.lines.length; }
function splitLines(source: string): Line[] { const lines: Line[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; lines.push({ end: match.index + raw.length, index: lines.length, raw, start: match.index, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function statementIndex(lines: readonly Line[]): number { let index = 0; if (lines[0]?.text.replace(/^\uFEFF/, '').trim() === '---') { const close = lines.findIndex((line, candidate) => candidate > 0 && line.text.trim() === '---'); index = close < 0 ? lines.length : close + 1; } while (index < lines.length && (!lines[index]!.text.trim() || ignorable(lines[index]!.text))) index += 1; return index; }
function ignorable(value: string): boolean { return /^\s*%%/.test(value); }
function indent(line: Line): number { return line.text.match(/^\s*/)?.[0].length ?? 0; }
function lineEnding(source: string): string { return source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'; }
function endsWithTerminator(source: string): boolean { return /(?:\r\n|\n|\r)$/.test(source); }
function replaceLines(source: string, replacements: readonly { line: Line; value: string }[], value: Omit<MindmapNode, 'parentLabel'>, nodeIndent: number): string { const nodeLine = replacements[0]; if (!nodeLine) throw stale(); const metadata = metadataLines(value, nodeIndent, lineEnding(source)); const next = [...replacements].sort((left, right) => right.line.start - left.line.start).reduce((current, replacement) => `${current.slice(0, replacement.line.start)}${replacement.value}${replacement === nodeLine ? metadata : ''}${replacement.line.raw.slice(replacement.line.text.length)}${current.slice(replacement.line.end)}`, source); return requireMindmap(next), next; }
function deleteLineRange(source: string, lines: readonly Line[], start: number, end: number): string { const first = lines[start]; const last = lines[end - 1]; if (!first || !last) throw stale(); const next = `${source.slice(0, first.start)}${source.slice(last.end)}`; return requireMindmap(next), next; }
function swapLineBlocks(source: string, lines: readonly Line[], start: number, middle: number, end: number): string { const ordered = [...lines.slice(0, start), ...lines.slice(middle, end), ...lines.slice(start, middle), ...lines.slice(end)]; return withOriginalTerminators(ordered, lines); }
function withOriginalTerminators(lines: readonly Line[], original: readonly Line[]): string { return lines.map((line, index) => `${line.text}${original[index]?.raw.slice(original[index]!.text.length) ?? ''}`).join(''); }
function shiftIndent(line: Line, from: number, to: number): Line { if (!line.text.trim()) return line; const current = indent(line); return current < from ? line : { ...line, text: `${' '.repeat(Math.max(0, current + to - from))}${line.text.slice(current)}` }; }
function stale(): Error { return new Error('Mindmap node changed remotely and can no longer be resolved safely.'); }
