import type { DiagramSubgraph } from './diagram-mutations';
import { getBoundsUnion, type SvgBounds } from './svg-hit-map';

function encodeQuotedMermaidLabel(label: string): string {
  return label
    .trim()
    .replace(/\s*[\r\n]+\s*/g, ' ')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;');
}

function findClosingTitleBracket(value: string, start: number): number | null {
  let depth = 0;
  let quoted = false;
  for (let index = start; index < value.length; index += 1) {
    const character = value[index];
    if (character === '"') {
      quoted = !quoted;
      continue;
    }
    if (quoted) continue;
    if (character === '[') depth += 1;
    if (character === ']') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  return null;
}

function rewriteExplicitSubgraphLine(line: string, subgraphId: string, label: string): string | null {
  const prefix = /^[\t ]*subgraph[\t ]+/u.exec(line);
  if (!prefix) return null;

  const idStart = prefix[0].length;
  let idEnd = idStart;
  while (idEnd < line.length && !/[\t [\]]/u.test(line[idEnd] ?? '')) idEnd += 1;
  if (line.slice(idStart, idEnd) !== subgraphId) return null;

  let titleStart = idEnd;
  while (line[titleStart] === ' ' || line[titleStart] === '\t') titleStart += 1;
  const spacing = line.slice(idEnd, titleStart);
  let suffix = line.slice(titleStart);
  if (!suffix.startsWith('[')) return null;
  const titleEnd = findClosingTitleBracket(suffix, 0);
  if (titleEnd === null) return null;
  suffix = suffix.slice(titleEnd + 1);
  if (suffix.trim() && !suffix.trimStart().startsWith('%%')) return null;

  return `${line.slice(0, idEnd)}${spacing}["${encodeQuotedMermaidLabel(label)}"]${suffix}`;
}

function getRewrittenSubgraphChunks(source: string, subgraphId: string, label: string) {
  const chunks = source.match(/[^\r\n]*(?:\r\n|\n|\r|$)/gu) ?? [];
  let matches = 0;
  const rewritten = chunks.map((chunk) => {
    const ending = chunk.match(/(?:\r\n|\n|\r)$/u)?.[0] ?? '';
    const line = ending ? chunk.slice(0, -ending.length) : chunk;
    const nextLine = rewriteExplicitSubgraphLine(line, subgraphId, label);
    if (nextLine === null) return chunk;
    matches += 1;
    return `${nextLine}${ending}`;
  }).join('');
  return { matches, rewritten };
}

export function canRenameFlowchartSubgraphDeclaration(source: string, subgraphId: string): boolean {
  return getRewrittenSubgraphChunks(source, subgraphId, subgraphId).matches === 1;
}

export function renameFlowchartSubgraphDeclaration(source: string, subgraphId: string, label: string): string {
  const { matches, rewritten } = getRewrittenSubgraphChunks(source, subgraphId, label);

  if (matches !== 1) {
    throw new Error(matches === 0
      ? `Cannot rename section ${subgraphId} because it has no unique explicit Mermaid id.`
      : `Cannot rename section ${subgraphId} because its Mermaid id is duplicated.`);
  }
  return rewritten;
}

export function getFlowchartCanvasBounds(
  nodeBounds: ReadonlyMap<string, SvgBounds>,
  sourceSubgraphBounds: ReadonlyMap<string, SvgBounds>,
  interactiveSubgraphBounds: ReadonlyMap<string, SvgBounds>,
  edgeBounds: readonly SvgBounds[],
  useInteractiveSubgraphs: boolean,
): SvgBounds | null {
  const subgraphBounds = useInteractiveSubgraphs && interactiveSubgraphBounds.size > 0
    ? [...interactiveSubgraphBounds.values()]
    : [...sourceSubgraphBounds.values()];
  const nodes = [...nodeBounds.values()];
  return getBoundsUnion(nodes.length > 0 ? [...nodes, ...subgraphBounds] : [...subgraphBounds, ...edgeBounds]);
}

export function getSubgraphLabel(subgraph: DiagramSubgraph): string {
  return typeof subgraph.title === 'string'
    ? subgraph.title
    : subgraph.title?.text ?? subgraph.id;
}

export function getNestedSubgraphNodeIds(
  subgraphId: string,
  subgraphs: readonly Pick<DiagramSubgraph, 'id' | 'nodes'>[],
  nodeIds: readonly string[],
): string[] {
  const subgraphById = new Map(subgraphs.map((subgraph) => [subgraph.id, subgraph]));
  const knownNodeIds = new Set(nodeIds);
  const resolved = new Set<string>();
  const visiting = new Set<string>();

  const visit = (id: string) => {
    if (visiting.has(id)) return;
    const subgraph = subgraphById.get(id);
    if (!subgraph) return;
    visiting.add(id);
    for (const memberId of subgraph.nodes) {
      if (subgraphById.has(memberId)) visit(memberId);
      else if (knownNodeIds.has(memberId)) resolved.add(memberId);
    }
    visiting.delete(id);
  };

  visit(subgraphId);
  return [...resolved];
}

export function getInteractiveSubgraphBounds(
  subgraphBounds: SvgBounds,
  sourceNodeBounds: ReadonlyMap<string, SvgBounds>,
  interactiveNodeBounds: ReadonlyMap<string, SvgBounds>,
  memberNodeIds: readonly string[],
): SvgBounds {
  const sourceMembers = getBoundsUnion(memberNodeIds
    .map((nodeId) => sourceNodeBounds.get(nodeId))
    .filter((bounds): bounds is SvgBounds => bounds !== undefined));
  const interactiveMembers = getBoundsUnion(memberNodeIds
    .map((nodeId) => interactiveNodeBounds.get(nodeId))
    .filter((bounds): bounds is SvgBounds => bounds !== undefined));
  if (!sourceMembers || !interactiveMembers) return subgraphBounds;

  const left = sourceMembers.x - subgraphBounds.x;
  const top = sourceMembers.y - subgraphBounds.y;
  const right = (subgraphBounds.x + subgraphBounds.width) - (sourceMembers.x + sourceMembers.width);
  const bottom = (subgraphBounds.y + subgraphBounds.height) - (sourceMembers.y + sourceMembers.height);
  return {
    x: interactiveMembers.x - left,
    y: interactiveMembers.y - top,
    width: interactiveMembers.width + left + right,
    height: interactiveMembers.height + top + bottom,
  };
}
