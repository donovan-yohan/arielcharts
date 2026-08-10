export interface BlockNode { id: string; label: string; span: number; }
export interface BlockComposite { columns?: number; id: string; span: number; }
export interface BlockLink { from: string; to: string; }
export interface BlockLinkIdentity extends BlockLink { index: number; occurrenceCount: number; }
export interface BlockDiagramSnapshot { columns?: number; composites: BlockComposite[]; links: BlockLink[]; nodes: BlockNode[]; }

interface Line { end: number; raw: string; start: number; text: string; }
interface NodeRecord extends BlockNode { line: Line; }
interface CompositeRecord extends BlockComposite { close: Line; line: Line; }
interface LinkRecord extends BlockLink { line: Line; }
interface Parsed { columns?: number; composites: CompositeRecord[]; links: LinkRecord[]; nodes: NodeRecord[]; }

const HEADER = /^\s*block-beta\s*$/i;
const ID = '[A-Za-z_][A-Za-z0-9_-]*';
const idPattern = new RegExp(`^${ID}$`);
const NODE = new RegExp(`^\\s*(${ID})(?:\\["([^"\\r\\n]*)"\\])?(?::([1-9][0-9]*))?\\s*$`);
const BLOCK = new RegExp(`^\\s*block:(${ID})(?::([1-9][0-9]*))?\\s*$`, 'i');
const COLUMNS = /^\s*columns\s+([1-9][0-9]*)\s*$/i;
const LINK = new RegExp(`^\\s*(${ID})\\s*-->\\s*(${ID})\\s*$`);

export function isBlockDiagramSource(source: string): boolean { return parseBlock(source) !== null; }
export function isBlockSourceRepresentable(source: string): boolean { return parseBlock(source) !== null; }
export function getBlockDiagramSnapshot(source: string): BlockDiagramSnapshot { const parsed = requireBlock(source); return { ...(parsed.columns ? { columns: parsed.columns } : {}), nodes: parsed.nodes.map(({ id, label, span }) => ({ id, label, span })), composites: parsed.composites.map(({ id, span, columns }) => ({ id, span, ...(columns ? { columns } : {}) })), links: parsed.links.map(({ from, to }) => ({ from, to })) }; }

export function addBlockNode(source: string, node: Partial<BlockNode> = {}): string {
  const parsed = source.trim() ? requireBlock(source) : null; const normalized = normalizeNode({ id: node.id ?? 'Block', label: node.label ?? node.id ?? 'Block', span: node.span ?? 1 });
  const id = uniqueId(normalized.id, allIds(parsed)); const statement = formatNode({ ...normalized, id });
  return source.trim() ? append(source, `  ${statement}`) : `block-beta\n  ${statement}`;
}
export function editBlockNode(source: string, id: string, patch: Partial<BlockNode>): string {
  const parsed = requireBlock(source); const current = findNode(parsed, id); const next = normalizeNode({ ...current, ...patch });
  if (next.id !== id && allIds(parsed).includes(next.id)) throw new Error(`A block item named ${next.id} already exists.`);
  return replaceValues(source, [{ line: current.line, value: `${indent(current.line)}${formatNode(next)}` }, ...parsed.links.filter((link) => next.id !== id && (link.from === id || link.to === id)).map((link) => ({ line: link.line, value: `${indent(link.line)}${formatLink({ from: link.from === id ? next.id : link.from, to: link.to === id ? next.id : link.to })}` }))]);
}
export function deleteBlockNode(source: string, id: string): string { const parsed = requireBlock(source); const node = findNode(parsed, id); return deleteLines(source, [node.line, ...parsed.links.filter((link) => link.from === id || link.to === id).map((link) => link.line)]); }
export function addBlockComposite(source: string, composite: Partial<BlockComposite> = {}): string { const parsed = requireBlock(source); const id = uniqueId(normalizeId(composite.id ?? 'Group'), allIds(parsed)); const span = normalizeSpan(composite.span ?? 1); const columns = composite.columns === undefined ? undefined : normalizeColumns(composite.columns); return append(source, `  block:${id}${span === 1 ? '' : `:${span}`}\n${columns ? `    columns ${columns}\n` : ''}  end`); }
export function editBlockComposite(source: string, id: string, patch: Partial<BlockComposite>): string { const parsed = requireBlock(source); const current = findComposite(parsed, id); const nextId = patch.id === undefined ? id : normalizeId(patch.id); const span = patch.span === undefined ? current.span : normalizeSpan(patch.span); if (nextId !== id && allIds(parsed).includes(nextId)) throw new Error(`A block item named ${nextId} already exists.`); return replaceValues(source, [{ line: current.line, value: `${indent(current.line)}block:${nextId}${span === 1 ? '' : `:${span}`}` }, ...parsed.links.filter((link) => nextId !== id && (link.from === id || link.to === id)).map((link) => ({ line: link.line, value: `${indent(link.line)}${formatLink({ from: link.from === id ? nextId : link.from, to: link.to === id ? nextId : link.to })}` }))]); }
export function deleteBlockComposite(source: string, id: string): string { const parsed = requireBlock(source); const composite = findComposite(parsed, id); return deleteLines(source, [{ start: composite.line.start, end: composite.close.end, raw: '', text: '' }, ...parsed.links.filter((link) => link.from === id || link.to === id).map((link) => link.line)]); }
export function addBlockLink(source: string, link: BlockLink): string { const parsed = requireBlock(source); const next = normalizeLink(link); assertEndpoints(parsed, next); if (parsed.links.some((entry) => sameLink(entry, next))) throw new Error('An identical block link already exists.'); return append(source, `  ${formatLink(next)}`); }
export function getBlockLinkIdentity(link: BlockLink, index: number, links: readonly BlockLink[] = []): BlockLinkIdentity { return { ...link, index, occurrenceCount: links.length ? links.filter((entry) => sameLink(entry, link)).length : 1 }; }
export function resolveBlockLinkIndex(links: readonly BlockLink[], identity: BlockLinkIdentity): number { if (identity.occurrenceCount !== 1) throw stale(); const matches = links.map((link, index) => ({ index, link })).filter(({ link }) => sameLink(link, identity)); if (matches.length !== 1 || !matches[0]) throw stale(); return matches[0].index; }
export function editBlockLink(source: string, identity: BlockLinkIdentity, patch: Partial<BlockLink>): string { const parsed = requireBlock(source); const current = parsed.links[resolveBlockLinkIndex(parsed.links, identity)]; if (!current) throw stale(); const next = normalizeLink({ ...current, ...patch }); assertEndpoints(parsed, next); if (!sameLink(current, next) && parsed.links.some((entry) => sameLink(entry, next))) throw new Error('An identical block link already exists.'); return replace(source, current.line, `${indent(current.line)}${formatLink(next)}`); }
export function deleteBlockLink(source: string, identity: BlockLinkIdentity): string { const parsed = requireBlock(source); const current = parsed.links[resolveBlockLinkIndex(parsed.links, identity)]; if (!current) throw stale(); return deleteLines(source, [current.line]); }

function parseBlock(source: string): Parsed | null {
  const lines = splitLines(source); const headerIndex = statementIndex(lines); const header = lines[headerIndex]; if (!header || !HEADER.test(header.text)) return null;
  const nodes: NodeRecord[] = []; const composites: CompositeRecord[] = []; const links: LinkRecord[] = []; const stack: { columns?: number; id: string; line: Line; span: number }[] = []; let rootColumns: number | undefined;
  for (let index = headerIndex + 1; index < lines.length; index += 1) { const line = lines[index]!; if (!line.text.trim() || ignorable(line.text)) continue;
    if (/^\s*end\s*$/i.test(line.text)) { const open = stack.pop(); if (!open) return null; composites.push({ id: open.id, span: open.span, ...(open.columns ? { columns: open.columns } : {}), line: open.line, close: line }); continue; }
    const columns = line.text.match(COLUMNS); if (columns) { if (stack.length) { const active = stack.at(-1)!; if (active.columns) return null; active.columns = Number(columns[1]); } else { if (rootColumns) return null; rootColumns = Number(columns[1]); } continue; }
    const block = line.text.match(BLOCK); if (block) { const id = block[1]!; if (!isSafeId(id) || allIds({ nodes, composites: composites.concat(stack.map((entry) => ({ ...entry, close: entry.line } as CompositeRecord))) }).includes(id)) return null; stack.push({ id, span: Number(block[2] ?? '1'), line }); continue; }
    const link = line.text.match(LINK); if (link) { if (stack.length) return null; links.push({ from: link[1]!, to: link[2]!, line }); continue; }
    const node = line.text.match(NODE); if (node) { const id = node[1]!; if (!isSafeId(id) || allIds({ nodes, composites: composites.concat(stack.map((entry) => ({ ...entry, close: entry.line } as CompositeRecord))) }).includes(id)) return null; nodes.push({ id, label: node[2] ?? id, span: Number(node[3] ?? '1'), line }); continue; }
    return null;
  }
  if (stack.length || links.some((link) => !allIds({ nodes, composites }).includes(link.from) || !allIds({ nodes, composites }).includes(link.to))) return null;
  return { ...(rootColumns ? { columns: rootColumns } : {}), nodes, composites, links };
}
function requireBlock(source: string): Parsed { const parsed = parseBlock(source); if (!parsed) throw new Error('This source is not a safely representable block diagram.'); return parsed; }
function findNode(parsed: Parsed, id: string): NodeRecord { const node = parsed.nodes.find((entry) => entry.id === id); if (!node) throw new Error(`Block ${id} no longer exists.`); return node; }
function findComposite(parsed: Parsed, id: string): CompositeRecord { const composite = parsed.composites.find((entry) => entry.id === id); if (!composite) throw new Error(`Block composite ${id} no longer exists.`); return composite; }
function allIds(parsed: Pick<Parsed, 'nodes' | 'composites'> | null): string[] { return parsed ? [...parsed.nodes.map((entry) => entry.id), ...parsed.composites.map((entry) => entry.id)] : []; }
function normalizeNode(value: BlockNode): BlockNode { const id = normalizeId(value.id); const label = normalizeLabel(value.label); const span = normalizeSpan(value.span); return { id, label, span }; }
function normalizeLink(value: BlockLink): BlockLink { return { from: normalizeId(value.from), to: normalizeId(value.to) }; }
function assertEndpoints(parsed: Parsed, link: BlockLink): void { const ids = allIds(parsed); if (!ids.includes(link.from) || !ids.includes(link.to)) throw new Error('Block links require existing named blocks.'); }
function formatNode(value: BlockNode): string { return `${value.id}${value.label === value.id ? '' : `["${value.label}"]`}${value.span === 1 ? '' : `:${value.span}`}`; }
function formatLink(value: BlockLink): string { return `${value.from} --> ${value.to}`; }
function sameLink(left: BlockLink, right: BlockLink): boolean { return left.from === right.from && left.to === right.to; }
function stale(): Error { return new Error('Block link changed remotely and can no longer be resolved safely.'); }
function normalizeId(value: string): string { const id = value.trim(); if (!isSafeId(id)) throw new Error('Block identifiers must be Mermaid-safe identifiers.'); return id; }
function isSafeId(id: string): boolean { return idPattern.test(id) && !['block', 'columns', 'end', 'space'].includes(id.toLowerCase()); }
function normalizeLabel(value: string): string { const label = value.trim(); if (!label || /["\r\n]/.test(label)) throw new Error('Block labels must be one-line Mermaid strings.'); return label; }
function normalizeSpan(value: number): number { if (!Number.isInteger(value) || value < 1) throw new Error('Block spans must be positive integers.'); return value; }
function normalizeColumns(value: number): number { if (!Number.isInteger(value) || value < 1) throw new Error('Block columns must be positive integers.'); return value; }
function uniqueId(base: string, current: readonly string[]): string { const occupied = new Set(current); let id = base; let suffix = 2; while (occupied.has(id)) { id = `${base}${suffix}`; suffix += 1; } return id; }
function splitLines(source: string): Line[] { const lines: Line[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; lines.push({ start: match.index, end: match.index + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function statementIndex(lines: readonly Line[]): number { let start = 0; if (lines[0]?.text.replace(/^\uFEFF/, '').trim() === '---') { const close = lines.findIndex((line, index) => index > 0 && line.text.trim() === '---'); start = close < 0 ? lines.length : close + 1; } for (let index = start; index < lines.length; index += 1) if (lines[index]!.text.trim() && !ignorable(lines[index]!.text)) return index; return lines.length; }
function ignorable(value: string): boolean { return /^\s*%%/.test(value); }
function indent(line: Line): string { return line.text.match(/^\s*/)?.[0] ?? ''; }
function append(source: string, value: string): string { const ending = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'; return `${source}${source && !/(?:\r\n|\n|\r)$/.test(source) ? ending : ''}${value}`; }
function replace(source: string, line: Line, value: string): string { return `${source.slice(0, line.start)}${value}${line.raw.slice(line.text.length)}${source.slice(line.end)}`; }
function replaceValues(source: string, values: readonly { line: Line; value: string }[]): string { return [...values].sort((left, right) => right.line.start - left.line.start).reduce((next, value) => replace(next, value.line, value.value), source); }
function deleteLines(source: string, lines: readonly Line[]): string { return [...lines].sort((left, right) => right.start - left.start).reduce((next, line) => `${next.slice(0, line.start)}${next.slice(line.end)}`, source); }
