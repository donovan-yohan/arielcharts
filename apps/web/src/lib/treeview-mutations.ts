export type TreeViewSourceStyle = 'box' | 'indent';

export interface TreeViewNode {
  ancestorLabels?: string[];
  classes: string[];
  description?: string;
  directory: boolean;
  icon?: string;
  label: string;
  parentLabel?: string;
  quoted: boolean;
  sourceStyle: TreeViewSourceStyle;
}

/** Source-backed identity; identical sibling fingerprints intentionally become stale. */
export interface TreeViewNodeIdentity { node: TreeViewNode; occurrenceCount: number; }
export interface TreeViewDiagramSnapshot { nodes: TreeViewNode[]; }

interface Line { end: number; index: number; raw: string; start: number; text: string; }
interface NodeRecord extends TreeViewNode { depth: number; line: Line; parentIndex?: number; prefix: string; }
interface Parsed { lines: Line[]; nodes: NodeRecord[]; style: TreeViewSourceStyle; }

const HEADER = /^\s*treeView-beta\s*$/i;
const BOX = /^((?:(?:│|┃) {3}| {4})*)(?:├──|└──|┣━━|┗━━)\s+(.+)$/u;
const CLASS = /^:::([A-Za-z_][A-Za-z0-9_-]*)/;
const ICON = /^icon\(([A-Za-z0-9:_-]+)\)/;

export function isTreeViewDiagramSource(source: string): boolean { return parseTreeView(source) !== null; }
export function isTreeViewSourceRepresentable(source: string): boolean { return parseTreeView(source) !== null; }
export function getTreeViewDiagramSnapshot(source: string): TreeViewDiagramSnapshot { return { nodes: requireTreeView(source).nodes.map(publicNode) }; }
export function getTreeViewNodeIdentity(node: TreeViewNode, nodes: readonly TreeViewNode[] = []): TreeViewNodeIdentity { const snapshot = publicNode(node); return { node: snapshot, occurrenceCount: nodes.length && !hasUniquePathPrefixes(snapshot, nodes) ? 0 : (nodes.length ? nodes.filter((candidate) => sameNode(candidate, node)).length : 1) }; }
export function resolveTreeViewNodeIndex(nodes: readonly TreeViewNode[], identity: TreeViewNodeIdentity): number {
  if (identity.occurrenceCount !== 1 || !hasUniquePathPrefixes(identity.node, nodes)) throw stale(); const matches = nodes.map((node, index) => ({ index, node })).filter(({ node }) => sameNode(node, identity.node));
  if (matches.length !== 1 || !matches[0]) throw stale(); return matches[0].index;
}

export function addTreeViewNode(source: string, node: Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'>, parent?: TreeViewNodeIdentity): string {
  const value = normalizeNode(node);
  if (!source.trim()) { if (parent) throw new Error('A new tree has no parent node.'); return `treeView-beta\n  ${formatEntry(value)}`; }
  const parsed = requireTreeView(source); if (!parent) throw new Error('TreeView requires exactly one root node.'); const target = resolveRecord(parsed, parent); const targetIndex = parsed.nodes.indexOf(target);
  const at = parsed.lines[blockEnd(parsed, targetIndex)]?.start ?? source.length; const prefix = source.slice(0, at); const ending = lineEnding(source); const entry = formatRecord(value, target.depth + 1, parsed.style);
  const suffix = source.slice(at);
  const next = `${prefix}${prefix && !endsWithTerminator(prefix) ? ending : ''}${entry}${suffix || endsWithTerminator(source) ? ending : ''}${suffix}`;
  return requireTreeView(next), next;
}

export function editTreeViewNode(source: string, identity: TreeViewNodeIdentity, patch: Partial<Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'>>): string {
  const parsed = requireTreeView(source); const current = resolveRecord(parsed, identity); const value = normalizeNode({ ...current, ...patch, classes: patch.classes ?? current.classes });
  const next = replaceLine(source, current.line, formatRecord(value, current.depth, parsed.style)); return requireTreeView(next), next;
}

export function deleteTreeViewNode(source: string, identity: TreeViewNodeIdentity): string {
  const parsed = requireTreeView(source); const current = resolveRecord(parsed, identity); const index = parsed.nodes.indexOf(current);
  if (current.parentIndex === undefined) throw new Error('The TreeView root cannot be deleted.');
  const next = deleteLineRange(source, parsed.lines, current.line.index, blockEnd(parsed, index)); return requireTreeView(next), next;
}

export function moveTreeViewNode(source: string, identity: TreeViewNodeIdentity, direction: 'up' | 'down'): string {
  const parsed = requireTreeView(source); const current = resolveRecord(parsed, identity); const index = parsed.nodes.indexOf(current); const siblings = parsed.nodes.filter((node) => node.parentIndex === current.parentIndex); const sibling = siblings[siblings.indexOf(current) + (direction === 'up' ? -1 : 1)];
  if (!sibling) return source; const siblingIndex = parsed.nodes.indexOf(sibling); const first = Math.min(index, siblingIndex); const second = Math.max(index, siblingIndex);
  const next = swapLineBlocks(parsed.lines, parsed.nodes[first]!.line.index, parsed.nodes[second]!.line.index, blockEnd(parsed, second)); return requireTreeView(withOriginalTerminators(next, parsed.lines)), withOriginalTerminators(next, parsed.lines);
}

export function reparentTreeViewNode(source: string, identity: TreeViewNodeIdentity, parent: TreeViewNodeIdentity): string {
  const parsed = requireTreeView(source); const current = resolveRecord(parsed, identity); const target = resolveRecord(parsed, parent); const index = parsed.nodes.indexOf(current); const targetIndex = parsed.nodes.indexOf(target);
  if (current.parentIndex === undefined) throw new Error('The TreeView root cannot be reparented.');
  if (index === targetIndex || (targetIndex >= index && targetIndex < blockEnd(parsed, index))) throw new Error('A TreeView node cannot become its own descendant.');
  const start = current.line.index; const end = blockEnd(parsed, index); const targetEnd = blockEnd(parsed, targetIndex); const moving = parsed.lines.slice(start, end).map((line) => {
    const record = parsed.nodes.find((node) => node.line.index === line.index); if (!record) return line;
    return { ...line, text: formatRecord(record, record.depth - current.depth + target.depth + 1, parsed.style) };
  });
  const remaining = [...parsed.lines.slice(0, start), ...parsed.lines.slice(end)]; const marker = parsed.lines[targetEnd]; const insertion = marker ? remaining.findIndex((line) => line.start === marker.start) : remaining.length;
  if (insertion < 0) throw stale(); const ordered = [...remaining.slice(0, insertion), ...moving, ...remaining.slice(insertion)]; const next = withOriginalTerminators(ordered, parsed.lines); return requireTreeView(next), next;
}

function parseTreeView(source: string): Parsed | null {
  try {
    const lines = splitLines(source); const headerIndex = statementIndex(lines); if (!HEADER.test(lines[headerIndex]?.text.replace(/^\uFEFF/, '') ?? '')) return null;
    const nodes: NodeRecord[] = []; let style: TreeViewSourceStyle | undefined;
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]!; if (!line.text.trim() || ignorable(line.text)) continue;
      const box = line.text.match(BOX); const nodeStyle: TreeViewSourceStyle = box ? 'box' : (!nodes.length && hasFollowingBox(lines, index + 1) ? 'box' : 'indent'); if (!style) style = nodeStyle; if (style !== nodeStyle) return null;
      const prefix = box?.[1] ?? line.text.match(/^\s*/)?.[0] ?? ''; const depth = box ? boxDepth(prefix) + 1 : indentDepth(prefix, nodes);
      const entry = parseEntry((box?.[2] ?? line.text.trim()).trim()); if (!entry || depth < 0) return null;
      if (!nodes.length) { if (depth !== 0) return null; nodes.push({ ...entry, depth, line, prefix, sourceStyle: nodeStyle }); continue; }
      const parentIndex = findParent(nodes, depth); if (parentIndex === undefined) return null; nodes.push({ ...entry, depth, line, parentIndex, prefix, sourceStyle: nodeStyle });
    }
    if (nodes.length !== 1 && nodes.filter((node) => node.parentIndex === undefined).length !== 1) return null;
    for (const node of nodes) { const parent = node.parentIndex === undefined ? undefined : nodes[node.parentIndex]; node.parentLabel = parent?.label; node.ancestorLabels = parent ? [...(parent.ancestorLabels ?? []), parent.label] : []; }
    return { lines, nodes, style: style ?? 'indent' };
  } catch { return null; }
}

function parseEntry(value: string): Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'> | null {
  let text = value; let quoted = false; let label: string; let directory = false;
  if (text.startsWith('"')) { const close = text.indexOf('"', 1); if (close < 1) return null; label = text.slice(1, close); text = text.slice(close + 1).trimStart(); if (text.startsWith('/')) { directory = true; text = text.slice(1).trimStart(); } quoted = true; }
  else { const marker = text.search(/\s+(?=(?:::|icon\(|##))/); const raw = marker < 0 ? text : text.slice(0, marker); label = raw; text = marker < 0 ? '' : text.slice(marker).trimStart(); if (/\s/.test(label)) return null; }
  if (label.endsWith('/')) { directory = true; label = label.slice(0, -1); } if (!label || /[\r\n"#]/.test(label)) return null;
  const classes: string[] = []; let icon: string | undefined; let description: string | undefined;
  while (text) { const classMatch = text.match(CLASS); const iconMatch = text.match(ICON); if (classMatch) { classes.push(classMatch[1]!); text = text.slice(classMatch[0].length).trimStart(); continue; } if (iconMatch) { if (icon) return null; icon = iconMatch[1]!; text = text.slice(iconMatch[0].length).trimStart(); continue; } if (text.startsWith('##')) { description = text.slice(2).trim(); if (!description || /[\r\n]/.test(description)) return null; text = ''; continue; } return null; }
  if (new Set(classes).size !== classes.length || (icon && !iconName(icon))) return null;
  return { classes, ...(description ? { description } : {}), directory, ...(icon ? { icon } : {}), label, quoted };
}

function requireTreeView(source: string): Parsed { const parsed = parseTreeView(source); if (!parsed) throw new Error('This source is not a safely representable TreeView diagram.'); return parsed; }
function resolveRecord(parsed: Parsed, identity: TreeViewNodeIdentity): NodeRecord { const index = resolveTreeViewNodeIndex(parsed.nodes.map(publicNode), identity); const node = parsed.nodes[index]; if (!node) throw stale(); return node; }
function publicNode(node: TreeViewNode): TreeViewNode { return { ancestorLabels: [...(node.ancestorLabels ?? [])], classes: [...node.classes], ...(node.description ? { description: node.description } : {}), directory: node.directory, ...(node.icon ? { icon: node.icon } : {}), label: node.label, ...(node.parentLabel ? { parentLabel: node.parentLabel } : {}), quoted: node.quoted, sourceStyle: node.sourceStyle }; }
function hasUniquePathPrefixes(node: TreeViewNode, nodes: readonly TreeViewNode[]): boolean { const path = [...(node.ancestorLabels ?? []), node.label]; return path.every((_part, length) => nodes.filter((candidate) => { const candidatePath = [...(candidate.ancestorLabels ?? []), candidate.label]; return candidatePath.length === length + 1 && candidatePath.every((part, index) => part === path[index]); }).length === 1); }
function sameNode(left: TreeViewNode, right: TreeViewNode): boolean { const leftAncestors = left.ancestorLabels ?? []; const rightAncestors = right.ancestorLabels ?? []; return left.label === right.label && left.parentLabel === right.parentLabel && left.directory === right.directory && left.description === right.description && left.icon === right.icon && left.quoted === right.quoted && left.sourceStyle === right.sourceStyle && leftAncestors.length === rightAncestors.length && leftAncestors.every((item, index) => item === rightAncestors[index]) && left.classes.length === right.classes.length && left.classes.every((item, index) => item === right.classes[index]); }
function normalizeNode(node: Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'>): Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'> { const label = node.label.trim(); if (!label || /[\r\n"#]/.test(label)) throw new Error('TreeView labels must be non-empty one-line text.'); if (!node.quoted && /\s/.test(label)) throw new Error('TreeView labels with spaces must be quoted.'); const classes = node.classes.map(className); if (new Set(classes).size !== classes.length) throw new Error('TreeView node classes must be unique.'); return { classes, ...(node.description ? { description: descriptionText(node.description) } : {}), directory: Boolean(node.directory), ...(node.icon ? { icon: iconName(node.icon) } : {}), label, quoted: Boolean(node.quoted) }; }
function className(value: string): string { const text = value.trim(); if (!/^[A-Za-z_][A-Za-z0-9_-]*$/.test(text)) throw new Error('TreeView class names must be identifiers.'); return text; }
function iconName(value: string): string { const text = value.trim(); if (!/^[A-Za-z0-9:_-]+$/.test(text)) throw new Error('TreeView icon names must be Mermaid-safe.'); return text; }
function descriptionText(value: string): string { const text = value.trim(); if (!text || /[\r\n]/.test(text)) throw new Error('TreeView descriptions must be one-line text.'); return text; }
function formatEntry(node: Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'>): string { const label = `${node.quoted ? `"${node.label}"` : node.label}${node.directory ? '/' : ''}`; return `${label}${node.classes.map((item) => ` :::${item}`).join('')}${node.icon ? ` icon(${node.icon})` : ''}${node.description ? ` ## ${node.description}` : ''}`; }
function formatRecord(node: Omit<TreeViewNode, 'parentLabel' | 'sourceStyle'>, depth: number, style: TreeViewSourceStyle): string { return `${style === 'box' ? boxPrefix(depth) : '  '.repeat(depth + 1)}${formatEntry(node)}`; }
function findParent(nodes: readonly NodeRecord[], depth: number): number | undefined { for (let index = nodes.length - 1; index >= 0; index -= 1) if (nodes[index]!.depth < depth) return index; return undefined; }
function indentDepth(prefix: string, nodes: readonly NodeRecord[]): number { const width = prefix.length; if (!nodes.length) return 0; const levels = [...new Set(nodes.map((node) => node.prefix.length))].sort((left, right) => left - right); if (levels.includes(width)) return levels.indexOf(width); if (width < levels[levels.length - 1]!) return -1; const previous = nodes[nodes.length - 1]!; const inferredUnit = levels.length > 1 ? levels[1]! - levels[0]! : width - levels[0]!; if (inferredUnit < 2 || width !== previous.prefix.length + inferredUnit) return -1; return levels.length; }
function boxDepth(prefix: string): number { return prefix.length / 4; }
function boxPrefix(depth: number): string { return depth === 0 ? '' : `${'    '.repeat(depth - 1)}└── `; }
function hasFollowingBox(lines: readonly Line[], start: number): boolean { for (let index = start; index < lines.length; index += 1) { const line = lines[index]!; if (!line.text.trim() || ignorable(line.text)) continue; return BOX.test(line.text); } return false; }
function blockEnd(parsed: Parsed, nodeIndex: number): number { const node = parsed.nodes[nodeIndex]; if (!node) throw stale(); return parsed.nodes.slice(nodeIndex + 1).find((item) => item.depth <= node.depth)?.line.index ?? parsed.lines.length; }
function splitLines(source: string): Line[] { const lines: Line[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; lines.push({ end: match.index + raw.length, index: lines.length, raw, start: match.index, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function statementIndex(lines: readonly Line[]): number { let index = 0; if (lines[0]?.text.replace(/^\uFEFF/, '').trim() === '---') { const close = lines.findIndex((line, candidate) => candidate > 0 && line.text.trim() === '---'); index = close < 0 ? lines.length : close + 1; } while (index < lines.length && (!lines[index]!.text.trim() || ignorable(lines[index]!.text))) index += 1; return index; }
function ignorable(value: string): boolean { return /^\s*%%/.test(value); }
function lineEnding(source: string): string { return [...source.matchAll(/\r\n|\n|\r/g)].at(-1)?.[0] ?? '\n'; }
function endsWithTerminator(source: string): boolean { return /(?:\r\n|\n|\r)$/.test(source); }
function replaceLine(source: string, line: Line, value: string): string { return `${source.slice(0, line.start)}${value}${line.raw.slice(line.text.length)}${source.slice(line.end)}`; }
function deleteLineRange(source: string, lines: readonly Line[], start: number, end: number): string { const first = lines[start]; const last = lines[end - 1]; if (!first || !last) throw stale(); return `${source.slice(0, first.start)}${source.slice(last.end)}`; }
function swapLineBlocks(lines: readonly Line[], start: number, middle: number, end: number): Line[] { return [...lines.slice(0, start), ...lines.slice(middle, end), ...lines.slice(start, middle), ...lines.slice(end)]; }
function withOriginalTerminators(lines: readonly Line[], original: readonly Line[]): string { return lines.map((line, index) => `${line.text}${original[index]?.raw.slice(original[index]!.text.length) ?? ''}`).join(''); }
function stale(): Error { return new Error('TreeView node changed remotely and can no longer be resolved safely.'); }
