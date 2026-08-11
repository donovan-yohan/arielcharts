import { isSafeMermaidFrontmatter } from './mermaid-frontmatter';

export const WARDLEY_STRATEGIES = ['build', 'buy', 'outsource', 'market'] as const;
export const WARDLEY_LINK_KINDS = ['->', '-->', '-.->', '+>', '+<', '+<>'] as const;
export type WardleyStrategy = typeof WARDLEY_STRATEGIES[number];
export type WardleyLinkKind = typeof WARDLEY_LINK_KINDS[number];
export type WardleyNodeKind = 'anchor' | 'component' | 'pipeline-component';

export interface WardleyNode {
  evolution: number;
  inertia: boolean;
  kind: WardleyNodeKind;
  name: string;
  pipelineParent: string | null;
  strategy: WardleyStrategy | null;
  visibility: number | null;
}
export interface WardleyNodeIdentity { node: WardleyNode; occurrenceCount: number; }
export interface WardleyLink { from: string; kind: WardleyLinkKind; to: string; }
export interface WardleyLinkIdentity { link: WardleyLink; occurrenceCount: number; }
export interface WardleyEvolution { component: string; target: number; }
export interface WardleyEvolutionIdentity { evolution: WardleyEvolution; occurrenceCount: number; }
export interface WardleyNote { evolution: number; text: string; visibility: number; }
export interface WardleyNoteIdentity { note: WardleyNote; occurrenceCount: number; }
export interface WardleyPipeline { componentEvolution?: number; componentName?: string; parent: string; }
export interface WardleyPipelineIdentity { occurrenceCount: number; pipeline: WardleyPipeline; }
export interface WardleyDiagramSnapshot {
  evolutions: WardleyEvolution[];
  links: WardleyLink[];
  nodes: WardleyNode[];
  notes: WardleyNote[];
  pipelines: WardleyPipeline[];
}

interface Line { end: number; raw: string; start: number; text: string; }
interface Range { end: number; start: number; }
interface NodeRecord extends WardleyNode { evolutionToken: Range; line: Line; nameToken: Range; quote: '"' | "'" | null; suffix: Range; visibilityToken?: Range; }
interface LinkRecord extends WardleyLink { fromToken: Range; kindToken: Range; line: Line; toToken: Range; }
interface EvolutionRecord extends WardleyEvolution { componentToken: Range; line: Line; targetToken: Range; }
interface NoteRecord extends WardleyNote { evolutionToken: Range; line: Line; textToken: Range; visibilityToken: Range; }
interface PipelineRecord extends WardleyPipeline { close: Line; line: Line; parentToken: Range; }
interface ParsedWardley {
  evolutions: EvolutionRecord[];
  header: Line;
  lines: Line[];
  links: LinkRecord[];
  nodes: NodeRecord[];
  notes: NoteRecord[];
  pipelines: PipelineRecord[];
}

const HEADER = 'wardley-beta';
const QUOTED = `(?:"(?:[^"\\\\\r\n]|\\\\["\\\\])*"|'(?:[^'\\\\\r\n]|\\\\['\\\\])*')`;
const NAME = `(?:[A-Za-z_][A-Za-z0-9_-]*|${QUOTED})`;
const DECIMAL = String.raw`(?:[0-9]+\.[0-9]+)`;
const NODE = new RegExp(`^([\\t ]*)(anchor|component)[\\t ]+(${NAME})[\\t ]*\\[[\\t ]*(${DECIMAL})[\\t ]*,[\\t ]*(${DECIMAL})[\\t ]*\\](?:[\\t ]+\\((build|buy|outsource|market)\\))?(?:[\\t ]+(?:\\(inertia\\)|inertia))?[\\t ]*$`, 'u');
const PIPELINE = new RegExp(`^([\\t ]*)pipeline[\\t ]+(${NAME})[\\t ]*\\{[\\t ]*$`, 'u');
const PIPELINE_NODE = new RegExp(`^([\\t ]*)component[\\t ]+(${NAME})[\\t ]*\\[[\\t ]*(${DECIMAL})[\\t ]*\\][\\t ]*$`, 'u');
const LINK = new RegExp(`^([\\t ]*)(${NAME})[\\t ]*(->|-->|-\\.->|\\+>|\\+<|\\+<>)[\\t ]*(${NAME})[\\t ]*$`, 'u');
const EVOLVE = new RegExp(`^([\\t ]*)evolve[\\t ]+(${NAME})[\\t ]+(${DECIMAL})[\\t ]*$`, 'u');
const NOTE = new RegExp(`^([\\t ]*)note[\\t ]+(${QUOTED})[\\t ]*\\[[\\t ]*(${DECIMAL})[\\t ]*,[\\t ]*(${DECIMAL})[\\t ]*\\][\\t ]*$`, 'u');

export function isWardleyDiagramSource(source: string): boolean { return parseWardley(source) !== null; }
export function isWardleySourceRepresentable(source: string): boolean { return parseWardley(source) !== null; }
export function getWardleyDiagramSnapshot(source: string): WardleyDiagramSnapshot {
  const parsed = requireWardley(source);
  return {
    evolutions: parsed.evolutions.map(publicEvolution),
    links: parsed.links.map(publicLink),
    nodes: parsed.nodes.map(publicNode),
    notes: parsed.notes.map(publicNote),
    pipelines: parsed.pipelines.map((pipeline) => ({ parent: pipeline.parent })),
  };
}

export function getWardleyNodeIdentity(node: WardleyNode, nodes: readonly WardleyNode[] = []): WardleyNodeIdentity {
  const value = publicNode(node);
  return { node: value, occurrenceCount: nodes.length ? nodes.filter((candidate) => sameNode(candidate, value)).length : 1 };
}
export function getWardleyLinkIdentity(link: WardleyLink, links: readonly WardleyLink[] = []): WardleyLinkIdentity {
  const value = publicLink(link);
  return { link: value, occurrenceCount: links.length ? links.filter((candidate) => sameLink(candidate, value)).length : 1 };
}
export function getWardleyEvolutionIdentity(evolution: WardleyEvolution, values: readonly WardleyEvolution[] = []): WardleyEvolutionIdentity {
  const value = publicEvolution(evolution);
  return { evolution: value, occurrenceCount: values.length ? values.filter((candidate) => sameEvolution(candidate, value)).length : 1 };
}
export function getWardleyNoteIdentity(note: WardleyNote, notes: readonly WardleyNote[] = []): WardleyNoteIdentity {
  const value = publicNote(note);
  return { note: value, occurrenceCount: notes.length ? notes.filter((candidate) => sameNote(candidate, value)).length : 1 };
}
export function getWardleyPipelineIdentity(pipeline: WardleyPipeline, values: readonly WardleyPipeline[] = []): WardleyPipelineIdentity {
  const value = { parent: pipeline.parent };
  return { pipeline: value, occurrenceCount: values.length ? values.filter((candidate) => candidate.parent === value.parent).length : 1 };
}

export function addWardleyNode(source: string, node: WardleyNode): string {
  const base = source || HEADER;
  const parsed = requireWardley(base);
  const value = normalizeNode(node);
  ensureNameAvailable(parsed, value.name);
  if (value.kind === 'pipeline-component') {
    if (!value.pipelineParent) throw new Error('Wardley pipeline components require a pipeline parent.');
    const pipeline = parsed.pipelines.find((candidate) => candidate.parent === value.pipelineParent);
    if (!pipeline) throw new Error('The Wardley pipeline parent does not exist.');
    return requireValidMutation(insertBeforeLine(base, pipeline.close, `    component ${encodeName(value.name)} [${formatNumber(value.evolution)}]`));
  }
  return requireValidMutation(appendStatement(base, `  ${formatNode(value)}`));
}

export function editWardleyNode(source: string, identity: WardleyNodeIdentity, patch: Partial<WardleyNode>): string {
  const parsed = requireWardley(source);
  const current = resolveNode(parsed, identity);
  const value = normalizeNode({ ...publicNode(current), ...patch, kind: current.kind, pipelineParent: current.pipelineParent });
  if (sameNode(current, value)) return source;
  if (value.name !== current.name) ensureNameAvailable(parsed, value.name, current);
  let next = source;
  if (value.name !== current.name) next = renameWardleyNode(next, identity, value.name);
  const reparsed = requireWardley(next);
  const renamed = reparsed.nodes.find((candidate) => candidate.name === value.name && candidate.kind === current.kind)!;
  const replacements: Array<{ range: Range; value: string }> = [];
  if (renamed.evolution !== value.evolution) replacements.push({ range: renamed.evolutionToken, value: formatNumber(value.evolution) });
  if (renamed.visibility !== value.visibility && renamed.visibilityToken && value.visibility !== null) {
    replacements.push({ range: renamed.visibilityToken, value: formatNumber(value.visibility) });
  }
  if (renamed.strategy !== value.strategy || renamed.inertia !== value.inertia) {
    replacements.push({
      range: renamed.suffix,
      value: `${value.strategy ? ` (${value.strategy})` : ''}${value.inertia ? ' inertia' : ''}`,
    });
  }
  return requireValidMutation(replaceRanges(next, replacements));
}

export function renameWardleyNode(source: string, identity: WardleyNodeIdentity, name: string): string {
  const parsed = requireWardley(source);
  const current = resolveNode(parsed, identity);
  const value = normalizeName(name);
  if (value === current.name) return source;
  ensureNameAvailable(parsed, value, current);
  const replacements: Array<{ range: Range; value: string }> = [{ range: current.nameToken, value: encodeName(value, current.quote) }];
  for (const link of parsed.links) {
    if (link.from === current.name) replacements.push({ range: link.fromToken, value: encodeName(value, quoteAt(source, link.fromToken)) });
    if (link.to === current.name) replacements.push({ range: link.toToken, value: encodeName(value, quoteAt(source, link.toToken)) });
  }
  for (const evolution of parsed.evolutions) if (evolution.component === current.name) {
    replacements.push({ range: evolution.componentToken, value: encodeName(value, quoteAt(source, evolution.componentToken)) });
  }
  for (const pipeline of parsed.pipelines) if (pipeline.parent === current.name) {
    replacements.push({ range: pipeline.parentToken, value: encodeName(value, quoteAt(source, pipeline.parentToken)) });
  }
  return requireValidMutation(replaceRanges(source, replacements));
}

export function deleteWardleyNode(source: string, identity: WardleyNodeIdentity): string {
  const parsed = requireWardley(source);
  const current = resolveNode(parsed, identity);
  if (
    current.kind === 'pipeline-component'
    && parsed.nodes.filter((node) => node.pipelineParent === current.pipelineParent).length === 1
  ) {
    throw new Error('A Wardley pipeline must retain at least one component; delete the pipeline instead.');
  }
  const lines = [current.line];
  lines.push(...parsed.links.filter((link) => link.from === current.name || link.to === current.name).map((link) => link.line));
  lines.push(...parsed.evolutions.filter((item) => item.component === current.name).map((item) => item.line));
  const pipeline = parsed.pipelines.find((item) => item.parent === current.name);
  if (pipeline) lines.push(...linesInRange(parsed.lines, pipeline.line.start, pipeline.close.end));
  return requireValidMutation(deleteLines(source, uniqueLines(lines)));
}

export function moveWardleyNode(source: string, identity: WardleyNodeIdentity, direction: 'up' | 'down'): string {
  const parsed = requireWardley(source);
  const current = resolveNode(parsed, identity);
  const peers = parsed.nodes.filter((node) => node.kind === current.kind && node.pipelineParent === current.pipelineParent);
  const index = peers.indexOf(current);
  const other = peers[index + (direction === 'up' ? -1 : 1)];
  return other ? requireValidMutation(swapLineText(source, current.line, other.line)) : source;
}

export function addWardleyPipeline(source: string, pipeline: WardleyPipeline): string {
  const parsed = requireWardley(source);
  const parent = normalizeName(pipeline.parent);
  const componentName = normalizeName(pipeline.componentName ?? '');
  const componentEvolution = coordinate(pipeline.componentEvolution ?? Number.NaN);
  const node = parsed.nodes.find((candidate) => candidate.name === parent && candidate.kind === 'component');
  if (!node) throw new Error('Wardley pipelines require a declared component parent.');
  if (parsed.pipelines.some((candidate) => candidate.parent === parent)) throw new Error('A Wardley component can have only one pipeline.');
  ensureNameAvailable(parsed, componentName);
  const ending = preferredEol(source);
  return requireValidMutation(appendStatement(source, `  pipeline ${encodeName(parent)} {${ending}    component ${encodeName(componentName)} [${formatNumber(componentEvolution)}]${ending}  }`));
}
export function deleteWardleyPipeline(source: string, identity: WardleyPipelineIdentity): string {
  const parsed = requireWardley(source);
  const pipeline = resolvePipeline(parsed, identity);
  return requireValidMutation(deleteLines(source, linesInRange(parsed.lines, pipeline.line.start, pipeline.close.end)));
}

export function addWardleyLink(source: string, link: WardleyLink): string {
  const parsed = requireWardley(source);
  const value = normalizeLink(link);
  validateLink(parsed, value);
  if (parsed.links.some((candidate) => sameLink(candidate, value))) throw new Error('An identical Wardley link already exists.');
  return requireValidMutation(appendStatement(source, `  ${formatLink(value)}`));
}
export function editWardleyLink(source: string, identity: WardleyLinkIdentity, patch: Partial<WardleyLink>): string {
  const parsed = requireWardley(source);
  const current = resolveLink(parsed, identity);
  const value = normalizeLink({ ...publicLink(current), ...patch });
  validateLink(parsed, value);
  if (sameLink(current, value)) return source;
  if (parsed.links.some((candidate) => candidate !== current && sameLink(candidate, value))) throw new Error('An identical Wardley link already exists.');
  const replacements: Array<{ range: Range; value: string }> = [];
  if (current.from !== value.from) replacements.push({ range: current.fromToken, value: encodeName(value.from, quoteAt(source, current.fromToken)) });
  if (current.kind !== value.kind) replacements.push({ range: current.kindToken, value: value.kind });
  if (current.to !== value.to) replacements.push({ range: current.toToken, value: encodeName(value.to, quoteAt(source, current.toToken)) });
  return requireValidMutation(replaceRanges(source, replacements));
}
export function deleteWardleyLink(source: string, identity: WardleyLinkIdentity): string {
  const parsed = requireWardley(source); return requireValidMutation(deleteLines(source, [resolveLink(parsed, identity).line]));
}
export function moveWardleyLink(source: string, identity: WardleyLinkIdentity, direction: 'up' | 'down'): string {
  const parsed = requireWardley(source); const current = resolveLink(parsed, identity); const index = parsed.links.indexOf(current);
  const other = parsed.links[index + (direction === 'up' ? -1 : 1)]; return other ? requireValidMutation(swapLineText(source, current.line, other.line)) : source;
}

export function addWardleyEvolution(source: string, evolution: WardleyEvolution): string {
  const parsed = requireWardley(source); const value = normalizeEvolution(evolution); validateEvolution(parsed, value);
  if (parsed.evolutions.some((candidate) => candidate.component === value.component)) throw new Error('A Wardley component can evolve only once.');
  return requireValidMutation(appendStatement(source, `  evolve ${encodeName(value.component)} ${formatNumber(value.target)}`));
}
export function editWardleyEvolution(source: string, identity: WardleyEvolutionIdentity, patch: Partial<WardleyEvolution>): string {
  const parsed = requireWardley(source); const current = resolveEvolution(parsed, identity); const value = normalizeEvolution({ ...publicEvolution(current), ...patch }); validateEvolution(parsed, value);
  if (sameEvolution(current, value)) return source;
  if (parsed.evolutions.some((candidate) => candidate !== current && candidate.component === value.component)) throw new Error('A Wardley component can evolve only once.');
  return requireValidMutation(replaceRanges(source, [
    ...(current.component !== value.component ? [{ range: current.componentToken, value: encodeName(value.component, quoteAt(source, current.componentToken)) }] : []),
    ...(current.target !== value.target ? [{ range: current.targetToken, value: formatNumber(value.target) }] : []),
  ]));
}
export function deleteWardleyEvolution(source: string, identity: WardleyEvolutionIdentity): string { const parsed = requireWardley(source); return requireValidMutation(deleteLines(source, [resolveEvolution(parsed, identity).line])); }

export function addWardleyNote(source: string, note: WardleyNote): string { const value = normalizeNote(note); return requireValidMutation(appendStatement(source || HEADER, `  note ${encodeText(value.text)} [${formatNumber(value.visibility)}, ${formatNumber(value.evolution)}]`)); }
export function editWardleyNote(source: string, identity: WardleyNoteIdentity, patch: Partial<WardleyNote>): string {
  const parsed = requireWardley(source); const current = resolveNote(parsed, identity); const value = normalizeNote({ ...publicNote(current), ...patch });
  if (sameNote(current, value)) return source;
  return requireValidMutation(replaceRanges(source, [
    ...(current.text !== value.text ? [{ range: current.textToken, value: encodeText(value.text, quoteAt(source, current.textToken) ?? '"') }] : []),
    ...(current.visibility !== value.visibility ? [{ range: current.visibilityToken, value: formatNumber(value.visibility) }] : []),
    ...(current.evolution !== value.evolution ? [{ range: current.evolutionToken, value: formatNumber(value.evolution) }] : []),
  ]));
}
export function deleteWardleyNote(source: string, identity: WardleyNoteIdentity): string { const parsed = requireWardley(source); return requireValidMutation(deleteLines(source, [resolveNote(parsed, identity).line])); }
export function moveWardleyNote(source: string, identity: WardleyNoteIdentity, direction: 'up' | 'down'): string { const parsed = requireWardley(source); const current = resolveNote(parsed, identity); const index = parsed.notes.indexOf(current); const other = parsed.notes[index + (direction === 'up' ? -1 : 1)]; return other ? requireValidMutation(swapLineText(source, current.line, other.line)) : source; }

function parseWardley(source: string): ParsedWardley | null {
  try {
    if (!source || source.indexOf('\uFEFF') > 0 || /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(source)) return null;
    const lines = splitLines(source); const headerIndex = firstStatement(lines); const header = lines[headerIndex];
    if (!header || sourceLineText(header) !== HEADER) return null;
    const nodes: NodeRecord[] = []; const links: LinkRecord[] = []; const evolutions: EvolutionRecord[] = []; const notes: NoteRecord[] = []; const pipelines: PipelineRecord[] = [];
    let openPipeline: { line: Line; parent: string; parentToken: Range } | null = null;
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]!; const text = sourceLineText(line);
      if (blank(text) || comment(text)) continue;
      if (directive(text)) return null;
      if (openPipeline) {
        if (/^[\t ]*\}[\t ]*$/u.test(text)) { pipelines.push({ ...openPipeline, close: line }); openPipeline = null; continue; }
        const match = text.match(PIPELINE_NODE); if (!match) return null;
        const name = decodeName(match[2]!); const evolution = coordinate(match[3]!);
        const offset = text.indexOf(match[2]!); const evolutionOffset = text.lastIndexOf(match[3]!);
        const suffixOffset = text.lastIndexOf(']') + 1; const trailing = text.match(/[\t ]*$/u)?.[0].length ?? 0;
        nodes.push({ evolution, evolutionToken: tokenRange(line, evolutionOffset, match[3]!), inertia: false, kind: 'pipeline-component', line, name, nameToken: tokenRange(line, offset, match[2]!), pipelineParent: openPipeline.parent, quote: tokenQuote(match[2]!), strategy: null, suffix: { end: line.start + text.length - trailing, start: line.start + suffixOffset }, visibility: null });
        continue;
      }
      const pipelineMatch = text.match(PIPELINE);
      if (pipelineMatch) { const parent = decodeName(pipelineMatch[2]!); const offset = text.indexOf(pipelineMatch[2]!); openPipeline = { line, parent, parentToken: tokenRange(line, offset, pipelineMatch[2]!) }; continue; }
      const nodeMatch = text.match(NODE);
      if (nodeMatch) {
        const token = nodeMatch[3]!; const offset = text.indexOf(token); const inertia = /(?:^|[\t ])(?:\(inertia\)|inertia)[\t ]*$/u.test(text);
        if (nodeMatch[2] === 'anchor' && (nodeMatch[6] || inertia)) return null;
        const visibilityOffset = text.indexOf(nodeMatch[4]!, offset + token.length); const evolutionOffset = text.indexOf(nodeMatch[5]!, visibilityOffset + nodeMatch[4]!.length); const suffixOffset = text.indexOf(']', evolutionOffset + nodeMatch[5]!.length) + 1; const trailing = text.match(/[\t ]*$/u)?.[0].length ?? 0;
        nodes.push({ evolution: coordinate(nodeMatch[5]!), evolutionToken: tokenRange(line, evolutionOffset, nodeMatch[5]!), inertia, kind: nodeMatch[2] as 'anchor' | 'component', line, name: decodeName(token), nameToken: tokenRange(line, offset, token), pipelineParent: null, quote: tokenQuote(token), strategy: (nodeMatch[6] as WardleyStrategy | undefined) ?? null, suffix: { end: line.start + text.length - trailing, start: line.start + suffixOffset }, visibility: coordinate(nodeMatch[4]!), visibilityToken: tokenRange(line, visibilityOffset, nodeMatch[4]!) }); continue;
      }
      const linkMatch = text.match(LINK);
      if (linkMatch) { const fromToken = linkMatch[2]!; const kindToken = linkMatch[3]!; const toToken = linkMatch[4]!; const fromOffset = text.indexOf(fromToken); const kindOffset = text.indexOf(kindToken, fromOffset + fromToken.length); const toOffset = text.lastIndexOf(toToken); links.push({ from: decodeName(fromToken), fromToken: tokenRange(line, fromOffset, fromToken), kind: kindToken as WardleyLinkKind, kindToken: tokenRange(line, kindOffset, kindToken), line, to: decodeName(toToken), toToken: tokenRange(line, toOffset, toToken) }); continue; }
      const evolveMatch = text.match(EVOLVE);
      if (evolveMatch) { const token = evolveMatch[2]!; const targetToken = evolveMatch[3]!; const offset = text.indexOf(token); const targetOffset = text.lastIndexOf(targetToken); evolutions.push({ component: decodeName(token), componentToken: tokenRange(line, offset, token), line, target: coordinate(targetToken), targetToken: tokenRange(line, targetOffset, targetToken) }); continue; }
      const noteMatch = text.match(NOTE);
      if (noteMatch) { const token = noteMatch[2]!; const offset = text.indexOf(token); const visibilityOffset = text.indexOf(noteMatch[3]!, offset + token.length); const evolutionOffset = text.lastIndexOf(noteMatch[4]!); notes.push({ evolution: coordinate(noteMatch[4]!), evolutionToken: tokenRange(line, evolutionOffset, noteMatch[4]!), line, text: decodeText(token), textToken: tokenRange(line, offset, token), visibility: coordinate(noteMatch[3]!), visibilityToken: tokenRange(line, visibilityOffset, noteMatch[3]!) }); continue; }
      return null;
    }
    if (openPipeline) return null;
    const names = new Set<string>(); for (const node of nodes) { if (names.has(node.name)) return null; names.add(node.name); }
    const topNames = new Set(nodes.filter((node) => node.kind !== 'pipeline-component').map((node) => node.name));
    for (const pipeline of pipelines) {
      if (
        !nodes.some((node) => node.kind === 'component' && node.name === pipeline.parent)
        || !nodes.some((node) => node.kind === 'pipeline-component' && node.pipelineParent === pipeline.parent)
        || pipelines.filter((candidate) => candidate.parent === pipeline.parent).length > 1
      ) return null;
    }
    for (const link of links) if (!topNames.has(link.from) || !topNames.has(link.to) || link.from === link.to || links.filter((candidate) => sameLink(candidate, link)).length > 1) return null;
    for (const evolution of evolutions) if (!nodes.some((node) => node.kind === 'component' && node.pipelineParent === null && node.name === evolution.component) || evolutions.filter((candidate) => candidate.component === evolution.component).length > 1) return null;
    return { evolutions, header, lines, links, nodes, notes, pipelines };
  } catch { return null; }
}

function requireWardley(source: string): ParsedWardley { const parsed = parseWardley(source); if (!parsed) throw new Error('This source is not a safely representable Wardley diagram.'); return parsed; }
function requireValidMutation(source: string): string { requireWardley(source); return source; }
function resolveNode(parsed: ParsedWardley, identity: WardleyNodeIdentity): NodeRecord { const matches = parsed.nodes.filter((item) => sameNode(item, identity.node)); if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw new Error('Wardley node changed remotely and can no longer be resolved safely.'); return matches[0]; }
function resolveLink(parsed: ParsedWardley, identity: WardleyLinkIdentity): LinkRecord { const matches = parsed.links.filter((item) => sameLink(item, identity.link)); if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw new Error('Wardley link changed remotely and can no longer be resolved safely.'); return matches[0]; }
function resolveEvolution(parsed: ParsedWardley, identity: WardleyEvolutionIdentity): EvolutionRecord { const matches = parsed.evolutions.filter((item) => sameEvolution(item, identity.evolution)); if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw new Error('Wardley evolution changed remotely and can no longer be resolved safely.'); return matches[0]; }
function resolveNote(parsed: ParsedWardley, identity: WardleyNoteIdentity): NoteRecord { const matches = parsed.notes.filter((item) => sameNote(item, identity.note)); if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw new Error('Wardley note changed remotely and can no longer be resolved safely.'); return matches[0]; }
function resolvePipeline(parsed: ParsedWardley, identity: WardleyPipelineIdentity): PipelineRecord { const matches = parsed.pipelines.filter((item) => item.parent === identity.pipeline.parent); if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw new Error('Wardley pipeline changed remotely and can no longer be resolved safely.'); return matches[0]; }

function normalizeNode(node: WardleyNode): WardleyNode { const kind = node.kind; if (!['anchor', 'component', 'pipeline-component'].includes(kind)) throw new Error('Unknown Wardley node kind.'); const evolution = coordinate(node.evolution); const visibility = kind === 'pipeline-component' ? null : coordinate(node.visibility); const strategy = kind === 'component' ? normalizeStrategy(node.strategy) : null; return { evolution, inertia: kind === 'component' && Boolean(node.inertia), kind, name: normalizeName(node.name), pipelineParent: kind === 'pipeline-component' ? normalizeName(node.pipelineParent ?? '') : null, strategy, visibility }; }
function normalizeLink(link: WardleyLink): WardleyLink { const from = normalizeName(link.from); const to = normalizeName(link.to); if (from === to) throw new Error('Wardley links must connect different nodes.'); if (!WARDLEY_LINK_KINDS.includes(link.kind)) throw new Error('Unknown Wardley link kind.'); return { from, kind: link.kind, to }; }
function normalizeEvolution(value: WardleyEvolution): WardleyEvolution { return { component: normalizeName(value.component), target: coordinate(value.target) }; }
function normalizeNote(note: WardleyNote): WardleyNote { return { evolution: coordinate(note.evolution), text: normalizeText(note.text), visibility: coordinate(note.visibility) }; }
function normalizeStrategy(value: WardleyStrategy | null): WardleyStrategy | null { if (value === null) return null; if (!WARDLEY_STRATEGIES.includes(value)) throw new Error('Unknown Wardley sourcing strategy.'); return value; }
function normalizeName(value: string): string { if (!value.trim() || /[\u0000-\u001F\u007F]/u.test(value)) throw new Error('Wardley names must be non-empty one-line text.'); return value; }
function normalizeText(value: string): string { if (!value.trim() || /[\u0000-\u001F\u007F]/u.test(value)) throw new Error('Wardley notes must be non-empty one-line text.'); return value; }
function coordinate(value: number | string | null): number { const numeric = typeof value === 'number' ? value : value === null ? Number.NaN : Number(value); if (!Number.isFinite(numeric) || numeric < 0 || numeric > 1) throw new Error('Wardley coordinates must be finite numbers from 0 to 1.'); return numeric; }
function validateLink(parsed: ParsedWardley, link: WardleyLink): void { const declared = new Set(parsed.nodes.filter((node) => node.kind !== 'pipeline-component').map((node) => node.name)); if (!declared.has(link.from) || !declared.has(link.to)) throw new Error('Wardley links must reference declared top-level nodes.'); }
function validateEvolution(parsed: ParsedWardley, evolution: WardleyEvolution): void { if (!parsed.nodes.some((node) => node.kind === 'component' && node.pipelineParent === null && node.name === evolution.component)) throw new Error('Wardley evolves must reference a declared top-level component.'); }
function ensureNameAvailable(parsed: ParsedWardley, name: string, current?: NodeRecord): void { if (parsed.nodes.some((node) => node !== current && node.name === name)) throw new Error(`Wardley node ${name} already exists.`); }

function publicNode(node: WardleyNode): WardleyNode { return { evolution: node.evolution, inertia: node.inertia, kind: node.kind, name: node.name, pipelineParent: node.pipelineParent, strategy: node.strategy, visibility: node.visibility }; }
function publicLink(link: WardleyLink): WardleyLink { return { from: link.from, kind: link.kind, to: link.to }; }
function publicEvolution(value: WardleyEvolution): WardleyEvolution { return { component: value.component, target: value.target }; }
function publicNote(note: WardleyNote): WardleyNote { return { evolution: note.evolution, text: note.text, visibility: note.visibility }; }
function sameNode(left: WardleyNode, right: WardleyNode): boolean { return left.kind === right.kind && left.name === right.name && left.visibility === right.visibility && left.evolution === right.evolution && left.strategy === right.strategy && left.inertia === right.inertia && left.pipelineParent === right.pipelineParent; }
function sameLink(left: WardleyLink, right: WardleyLink): boolean { return left.from === right.from && left.to === right.to && left.kind === right.kind; }
function sameEvolution(left: WardleyEvolution, right: WardleyEvolution): boolean { return left.component === right.component && left.target === right.target; }
function sameNote(left: WardleyNote, right: WardleyNote): boolean { return left.text === right.text && left.visibility === right.visibility && left.evolution === right.evolution; }
function formatNode(node: WardleyNode, quote: '"' | "'" | null = null): string { return `${node.kind} ${encodeName(node.name, quote)} [${formatNumber(node.visibility!)}, ${formatNumber(node.evolution)}]${node.strategy ? ` (${node.strategy})` : ''}${node.inertia ? ' inertia' : ''}`; }
function formatLink(link: WardleyLink): string { return `${encodeName(link.from)} ${link.kind} ${encodeName(link.to)}`; }
function formatNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error('Wardley values must be finite.');
  const text = String(value);
  if (!/[eE]/u.test(text)) return text.includes('.') ? text : `${text}.0`;
  const [coefficient, exponentText] = text.toLowerCase().split('e');
  const exponent = Number(exponentText);
  if (!coefficient || !Number.isInteger(exponent)) throw new Error('Wardley values must be decimal numbers.');
  const negative = coefficient.startsWith('-');
  const unsigned = negative ? coefficient.slice(1) : coefficient;
  const [integerPart, fractionalPart = ''] = unsigned.split('.');
  const digits = `${integerPart}${fractionalPart}`;
  const decimalIndex = integerPart!.length + exponent;
  const expanded = decimalIndex <= 0
    ? `0.${'0'.repeat(-decimalIndex)}${digits}`
    : decimalIndex >= digits.length
      ? `${digits}${'0'.repeat(decimalIndex - digits.length)}.0`
      : `${digits.slice(0, decimalIndex)}.${digits.slice(decimalIndex)}`;
  return negative ? `-${expanded}` : expanded;
}
function encodeName(value: string, quote: '"' | "'" | null = null): string { const name = normalizeName(value); if (!quote && /^[A-Za-z_][A-Za-z0-9_-]*$/u.test(name)) return name; return encodeText(name, quote ?? '"'); }
function encodeText(value: string, quote: '"' | "'" = '"'): string { const text = normalizeText(value); return `${quote}${text.replace(/\\/gu, '\\\\').replace(new RegExp(quote, 'gu'), `\\${quote}`)}${quote}`; }
function decodeName(token: string): string { return tokenQuote(token) ? decodeText(token) : normalizeName(token); }
function decodeText(token: string): string { const quote = token[0]!; let value = ''; for (let index = 1; index < token.length - 1; index += 1) { const character = token[index]!; if (character !== '\\') { value += character; continue; } const escaped = token[index += 1]; if (escaped !== quote && escaped !== '\\') throw new Error('Unsupported Wardley escape sequence.'); value += escaped; } return normalizeText(value); }
function tokenQuote(token: string): '"' | "'" | null { return token[0] === '"' || token[0] === "'" ? token[0] : null; }
function quoteAt(source: string, range: Range): '"' | "'" | null { return tokenQuote(source.slice(range.start, range.end)); }

function splitLines(source: string): Line[] { const result: Line[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/gu; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; result.push({ end: match.index + raw.length, raw, start: match.index, text: raw.replace(/\r\n|\n|\r$/u, '') }); } return result; }
function sourceLineText(line: Line): string { return line.start === 0 ? line.text.replace(/^\uFEFF/u, '') : line.text; }
function firstStatement(lines: readonly Line[]): number { let index = 0; if (lines[0] && sourceLineText(lines[0]) === '---') { const close = lines.findIndex((line, candidate) => candidate > 0 && sourceLineText(line) === '---'); if (close < 0 || !isSafeMermaidFrontmatter(lines.slice(1, close).map(sourceLineText)) || lines.slice(1, close).some((line) => /^[ ]*config[ ]*:/u.test(sourceLineText(line)))) return lines.length; index = close + 1; } while (index < lines.length && (blank(sourceLineText(lines[index]!)) || comment(sourceLineText(lines[index]!)))) index += 1; return index; }
function blank(value: string): boolean { return /^[\t ]*$/u.test(value); }
function comment(value: string): boolean { return /^[\t ]*%%(?!\{)[^\r\n]*$/u.test(value); }
function directive(value: string): boolean { return /^[\t ]*%%\{/u.test(value); }
function tokenRange(line: Line, offset: number, value: string): Range { return { end: line.start + offset + value.length, start: line.start + offset }; }
function replaceRanges(source: string, replacements: readonly { range: Range; value: string }[]): string { return [...replacements].sort((a, b) => b.range.start - a.range.start).reduce((result, item) => `${result.slice(0, item.range.start)}${item.value}${result.slice(item.range.end)}`, source); }
function preferredEol(source: string): string { return source.match(/\r\n|\n|\r/u)?.[0] ?? '\n'; }
function appendStatement(source: string, statement: string): string { const eol = preferredEol(source); if (!source) return statement; const hasEol = /(?:\r\n|\n|\r)$/u.test(source); return hasEol ? `${source}${statement}${eol}` : `${source}${eol}${statement}`; }
function insertBeforeLine(source: string, line: Line, statement: string): string { return `${source.slice(0, line.start)}${statement}${preferredEol(source)}${source.slice(line.start)}`; }
function deleteLines(source: string, lines: readonly Line[]): string {
  const selected = uniqueLines(lines).sort((left, right) => left.start - right.start);
  if (!selected.length) return source;
  const ranges: Range[] = [];
  let start = selected[0]!.start;
  let end = selected[0]!.end;
  for (const line of selected.slice(1)) {
    if (line.start === end) end = line.end;
    else { ranges.push({ start, end }); start = line.start; end = line.end; }
  }
  ranges.push({ start, end });
  const last = ranges.at(-1)!;
  if (last.end === source.length && !/(?:\r\n|\n|\r)$/u.test(source.slice(last.start, last.end))) {
    const preceding = source.slice(0, last.start).match(/(?:\r\n|\n|\r)$/u)?.[0];
    last.start -= preceding?.length ?? 0;
  }
  return [...ranges].sort((left, right) => right.start - left.start).reduce(
    (result, range) => `${result.slice(0, range.start)}${result.slice(range.end)}`,
    source,
  );
}
function uniqueLines(lines: readonly Line[]): Line[] { return [...new Map(lines.map((line) => [line.start, line])).values()]; }
function linesInRange(lines: readonly Line[], start: number, end: number): Line[] { return lines.filter((line) => line.start >= start && line.end <= end); }
function swapLineText(source: string, left: Line, right: Line): string { const first = left.start < right.start ? left : right; const second = left.start < right.start ? right : left; const firstTerminator = first.raw.slice(first.text.length); const secondTerminator = second.raw.slice(second.text.length); return `${source.slice(0, first.start)}${second.text}${firstTerminator}${source.slice(first.end, second.start)}${first.text}${secondTerminator}${source.slice(second.end)}`; }
