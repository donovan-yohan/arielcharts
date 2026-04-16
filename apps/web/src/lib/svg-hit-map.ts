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

const MERMAID_NODE_SELECTOR = 'g.node';
const MERMAID_EDGE_SELECTOR = 'g.edgePath';
const MERMAID_SUBGRAPH_SELECTOR = 'g.cluster';

export function buildSvgHitMap(svg: SVGSVGElement): SvgHitMap {
  const viewBox = getSvgViewBox(svg);

  const nodes = new Map<string, SvgBounds>();
  const edges = new Map<string, SvgEdgeHit>();
  const subgraphs = new Map<string, SvgBounds>();

  svg.querySelectorAll<SVGGElement>(MERMAID_NODE_SELECTOR).forEach((element) => {
    const nodeId = extractMermaidEntityId(element.id);
    const bounds = getTransformedBounds(element);

    if (!nodeId || !bounds) {
      return;
    }

    nodes.set(nodeId, bounds);
  });

  svg.querySelectorAll<SVGGElement>(MERMAID_EDGE_SELECTOR).forEach((element, index) => {
    const path = element.querySelector<SVGPathElement>('path');
    const bounds = getTransformedBounds(path ?? element);
    if (!path || !bounds) {
      return;
    }

    const edgeKey = [element.id, path.id, path.getAttribute('data-id'), `edge-${index}`]
      .find((candidate) => typeof candidate === 'string' && candidate.length > 0) ?? `edge-${index}`;

    edges.set(edgeKey, { bounds, path });
  });

  svg.querySelectorAll<SVGGElement>(MERMAID_SUBGRAPH_SELECTOR).forEach((element, index) => {
    const subgraphId = extractMermaidEntityId(element.id) ?? element.getAttribute('data-id') ?? `subgraph-${index}`;
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

export function extractMermaidEntityId(rawId: string | null | undefined): string | null {
  if (!rawId) {
    return null;
  }

  const withKnownPrefix = rawId.match(/^flowchart-(.+)-\d+$/);
  if (withKnownPrefix?.[1]) {
    return withKnownPrefix[1];
  }

  const genericMatch = rawId.match(/^(.+)-\d+$/);
  if (genericMatch?.[1]) {
    return genericMatch[1];
  }

  return rawId;
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
