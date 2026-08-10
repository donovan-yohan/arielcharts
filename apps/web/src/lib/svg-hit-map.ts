export interface SvgBounds {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface SvgPoint {
  x: number;
  y: number;
}

export interface SvgViewBox {
  height: number;
  width: number;
  x: number;
  y: number;
}

export interface SvgEdgeHit {
  bounds: SvgBounds;
  path: SVGPathElement;
}

export interface SvgHitMap {
  edges: Map<string, SvgEdgeHit>;
  nodes: Map<string, SvgBounds>;
  subgraphs: Map<string, SvgBounds>;
  viewBox: SvgViewBox;
}

export type SequenceSvgTextKind = 'participant' | 'message' | 'note' | 'fragment';

export interface SequenceSvgTextItem {
  id: string;
  text: string;
  type: SequenceSvgTextKind;
}

export interface SequenceSvgTextTarget extends SequenceSvgTextItem {}

export interface MermaidHitMapOptions {
  nodeIds?: readonly string[];
  subgraphIds?: readonly string[];
}

const MERMAID_NODE_SELECTOR = 'g.node';
export const MERMAID_EDGE_SELECTOR = 'g.edgePath, path.flowchart-link[data-edge="true"]';
const MERMAID_SUBGRAPH_SELECTOR = 'g.cluster';

export function buildSvgHitMap(svg: SVGSVGElement, options: MermaidHitMapOptions = {}): SvgHitMap {
  const viewBox = getSvgViewBox(svg);

  const nodes = new Map<string, SvgBounds>();
  const edges = new Map<string, SvgEdgeHit>();
  const subgraphs = new Map<string, SvgBounds>();

  svg.querySelectorAll<SVGGElement>(MERMAID_NODE_SELECTOR).forEach((element) => {
    const nodeId = resolveMermaidNodeId(element.id, options.nodeIds);
    const bounds = getTransformedBounds(element);

    if (!nodeId || !bounds) {
      return;
    }

    nodes.set(nodeId, bounds);
  });

  const seenPaths = new Set<SVGPathElement>();
  svg.querySelectorAll<SVGGraphicsElement>(MERMAID_EDGE_SELECTOR).forEach((element, index) => {
    const path = element instanceof SVGPathElement ? element : element.querySelector<SVGPathElement>('path');
    const bounds = getTransformedBounds(path ?? element);
    if (!path || !bounds || seenPaths.has(path)) {
      return;
    }
    seenPaths.add(path);

    const edgeKey = getMermaidEdgeKey([
      path.getAttribute('data-id'),
      element.getAttribute('data-id'),
      path.id,
      element.id,
    ], index);

    edges.set(edgeKey, { bounds, path });
  });

  svg.querySelectorAll<SVGGElement>(MERMAID_SUBGRAPH_SELECTOR).forEach((element, index) => {
    const subgraphId = resolveMermaidSubgraphId(element.id, options.subgraphIds)
      ?? element.getAttribute('data-id')
      ?? `subgraph-${index}`;
    const bounds = getTransformedBounds(element);

    if (!bounds) {
      return;
    }

    subgraphs.set(subgraphId, bounds);
  });

  return {
    edges,
    nodes,
    subgraphs,
    viewBox,
  };
}

export function buildSequenceSvgTextHitMap(svg: SVGSVGElement, items: readonly SequenceSvgTextItem[]): Map<Element, SequenceSvgTextTarget> | null {
  const targets = new Map<Element, SequenceSvgTextTarget>();
  const seenIds = new Set<string>();
  for (const item of items) {
    if (!item.id || seenIds.has(item.id)) return null;
    seenIds.add(item.id);
  }
  const mappings: Array<[SequenceSvgTextKind, Element[]]> = [
    ['participant', [...svg.querySelectorAll('g[data-et="participant"]')]],
    ['message', [...svg.querySelectorAll('.messageText')]],
    ['note', [...svg.querySelectorAll('g[data-et="note"]')]],
    ['fragment', [...svg.querySelectorAll('g[data-et="control-structure"]')]],
  ];
  for (const [type, elements] of mappings) {
    const sourceItems = items.filter((item) => item.type === type);
    if (sourceItems.length !== elements.length) return null;
    for (const [index, element] of elements.entries()) {
      const target = sourceItems[index];
      if (!target) return null;
      targets.set(element, target);
      element.querySelectorAll('text, tspan, foreignObject').forEach((descendant) => { targets.set(descendant, target); });
    }
  }
  return targets;
}

export function getSequenceSvgTextTarget(hitMap: ReadonlyMap<Element, SequenceSvgTextTarget> | null, start: EventTarget | null): SequenceSvgTextTarget | null {
  if (!hitMap || !(start instanceof Element)) return null;
  let candidate: Element | null = start;
  while (candidate) {
    const target = hitMap.get(candidate);
    if (target) return target;
    candidate = candidate.parentElement;
  }
  return null;
}

export function extractMermaidEntityId(rawId: string | null | undefined): string | null {
  if (!rawId) {
    return null;
  }

  const entityId = rawId.startsWith('flowchart-')
    ? rawId
    : rawId.includes('-flowchart-')
      ? rawId.slice(rawId.lastIndexOf('-flowchart-') + 1)
      : rawId;
  const withKnownPrefix = entityId.match(/^flowchart-(.+)-\d+$/);
  if (withKnownPrefix?.[1]) {
    return withKnownPrefix[1];
  }

  const genericMatch = entityId.match(/^(.+)-\d+$/);
  if (genericMatch?.[1]) {
    return genericMatch[1];
  }

  return entityId;
}

export function resolveMermaidNodeId(rawId: string | null | undefined, expectedNodeIds: readonly string[] = []): string | null {
  const expectedId = resolveExpectedSuffix(rawId, expectedNodeIds, 'flowchart-');
  return expectedId ?? extractMermaidEntityId(rawId);
}

export function resolveMermaidSubgraphId(
  rawId: string | null | undefined,
  expectedSubgraphIds: readonly string[] = [],
): string | null {
  const expectedId = resolveExpectedSuffix(rawId, expectedSubgraphIds, '');
  return expectedId ?? extractMermaidEntityId(rawId);
}

export function getMermaidEdgeKey(candidates: Array<string | null | undefined>, index: number): string {
  return candidates.find((candidate) => typeof candidate === 'string' && candidate.length > 0) ?? `edge-${index}`;
}

export function isMermaidFlowchartEntityDomId(rawId: string): boolean {
  return rawId.startsWith('flowchart-') || rawId.includes('-flowchart-');
}

function resolveExpectedSuffix(
  rawId: string | null | undefined,
  expectedIds: readonly string[],
  marker: string,
): string | null {
  if (!rawId) {
    return null;
  }

  for (const expectedId of [...expectedIds].sort((left, right) => right.length - left.length)) {
    if (marker && matchesNumberedMermaidSuffix(rawId, `${marker}${expectedId}-`)) {
      return expectedId;
    }
    if (!marker && (rawId === expectedId || rawId.endsWith(`-${expectedId}`))) {
      return expectedId;
    }
  }

  return null;
}

function matchesNumberedMermaidSuffix(rawId: string, prefix: string): boolean {
  const directSuffix = rawId.startsWith(prefix) ? rawId.slice(prefix.length) : null;
  if (directSuffix && /^\d+$/.test(directSuffix)) {
    return true;
  }

  const prefixedMarker = `-${prefix}`;
  const markerIndex = rawId.lastIndexOf(prefixedMarker);
  const renderSuffix = markerIndex >= 0 ? rawId.slice(markerIndex + prefixedMarker.length) : null;
  return Boolean(renderSuffix && /^\d+$/.test(renderSuffix));
}

export function getSvgBounds(element: SVGGraphicsElement | null): SvgBounds | null {
  if (!element) {
    return null;
  }

  try {
    const box = element.getBBox();
    return {
      height: box.height,
      width: box.width,
      x: box.x,
      y: box.y,
    };
  } catch {
    return null;
  }
}

function getTransformedBounds(element: SVGGraphicsElement | null): SvgBounds | null {
  if (!element) {
    return null;
  }

  try {
    const box = element.getBBox();
    const ctm = element.getCTM();
    if (!ctm) {
      return null;
    }

    const corners = [
      { x: box.x, y: box.y },
      { x: box.x + box.width, y: box.y },
      { x: box.x, y: box.y + box.height },
      { x: box.x + box.width, y: box.y + box.height },
    ];

    const transformed = corners.map((c) => ({
      x: (ctm.a * c.x) + (ctm.c * c.y) + ctm.e,
      y: (ctm.b * c.x) + (ctm.d * c.y) + ctm.f,
    }));

    const xs = transformed.map((p) => p.x);
    const ys = transformed.map((p) => p.y);

    return {
      height: Math.max(...ys) - Math.min(...ys),
      width: Math.max(...xs) - Math.min(...xs),
      x: Math.min(...xs),
      y: Math.min(...ys),
    };
  } catch {
    return null;
  }
}

export function getSvgViewBox(svg: SVGSVGElement): SvgViewBox {
  const baseVal = svg.viewBox.baseVal;
  if (baseVal && (baseVal.width > 0 || baseVal.height > 0)) {
    return {
      height: baseVal.height,
      width: baseVal.width,
      x: baseVal.x,
      y: baseVal.y,
    };
  }

  const fallbackBounds = getSvgBounds(svg);
  if (fallbackBounds) {
    return fallbackBounds;
  }

  return {
    height: parseNumericAttribute(svg.getAttribute('height')),
    width: parseNumericAttribute(svg.getAttribute('width')),
    x: 0,
    y: 0,
  };
}

export function getBoundsCenter(bounds: SvgBounds): SvgPoint {
  return {
    x: bounds.x + (bounds.width / 2),
    y: bounds.y + (bounds.height / 2),
  };
}

export function getBoundsUnion(boundsList: SvgBounds[]): SvgBounds | null {
  if (boundsList.length === 0) {
    return null;
  }

  const minX = Math.min(...boundsList.map((bounds) => bounds.x));
  const minY = Math.min(...boundsList.map((bounds) => bounds.y));
  const maxX = Math.max(...boundsList.map((bounds) => bounds.x + bounds.width));
  const maxY = Math.max(...boundsList.map((bounds) => bounds.y + bounds.height));

  return {
    height: maxY - minY,
    width: maxX - minX,
    x: minX,
    y: minY,
  };
}

export function isPointInBounds(point: SvgPoint, bounds: SvgBounds): boolean {
  return point.x >= bounds.x
    && point.x <= bounds.x + bounds.width
    && point.y >= bounds.y
    && point.y <= bounds.y + bounds.height;
}

export function getNodePortPosition(
  bounds: SvgBounds,
  side: 'top' | 'right' | 'bottom' | 'left',
): SvgPoint {
  switch (side) {
    case 'top':
      return { x: bounds.x + (bounds.width / 2), y: bounds.y };
    case 'right':
      return { x: bounds.x + bounds.width, y: bounds.y + (bounds.height / 2) };
    case 'bottom':
      return { x: bounds.x + (bounds.width / 2), y: bounds.y + bounds.height };
    case 'left':
      return { x: bounds.x, y: bounds.y + (bounds.height / 2) };
  }
}

function parseNumericAttribute(value: string | null): number {
  if (!value) {
    return 0;
  }

  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
