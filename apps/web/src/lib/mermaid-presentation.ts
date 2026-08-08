export interface MermaidItemPresentation {
  fill?: string;
  stroke?: string;
  strokeDasharray?: string;
  strokeWidth?: string;
  text?: string;
}

export interface MermaidPresentation {
  edges: MermaidItemPresentation[];
  nodes: Map<string, MermaidItemPresentation>;
}

export interface CanvasNodePaint {
  background: string;
  borderColor: string;
  color: string;
}

interface PresentationElement {
  attributes?: Record<string, string | null | undefined>;
  classNames?: string[];
  css?: string[];
  rootId?: string | null;
  style?: string | null;
  tagName?: string;
}

const PRESENTATION_PROPERTIES = new Set(['fill', 'stroke', 'stroke-dasharray', 'stroke-width', 'color']);

/** Projects Mermaid's rendered classDef/style output without making it shared app state. */
export function extractMermaidPresentation(svg: SVGSVGElement): MermaidPresentation {
  const styles = [...svg.querySelectorAll('style')].map((style) => style.textContent ?? '');
  const nodes = new Map<string, MermaidItemPresentation>();

  svg.querySelectorAll<SVGGElement>('g.node').forEach((group) => {
    const id = extractNodeId(group.id);
    if (!id) {
      return;
    }

    const geometry = group.querySelector<SVGElement>('rect, polygon, path, ellipse, circle') ?? group;
    const shapePresentation = getElementPresentation(geometry, group, styles);
    const labelPresentations = [...group.querySelectorAll('text, foreignObject, span, tspan, div')]
      .map((element) => getElementPresentation(element, group, styles))
    nodes.set(id, getMermaidNodePresentation(shapePresentation, labelPresentations));
  });

  const edges = [...svg.querySelectorAll<SVGGElement>('g.edgePath')].map((group) => {
    const path = group.querySelector<SVGElement>('path') ?? group;
    return getElementPresentation(path, group, styles);
  });

  return { edges, nodes };
}

export function getMermaidPresentationFromElement({
  attributes = {},
  classNames = [],
  css = [],
  rootId,
  style,
  tagName,
}: PresentationElement): MermaidItemPresentation {
  const declarations: Record<string, string> = {};
  for (const property of PRESENTATION_PROPERTIES) {
    const attribute = attributes[property];
    if (attribute) {
      declarations[property] = attribute;
    }
  }
  for (const stylesheet of css) {
    for (const rule of getMatchingRules(stylesheet, classNames, rootId, tagName)) {
      Object.assign(declarations, parseDeclarations(rule));
    }
  }
  Object.assign(declarations, parseDeclarations(style));

  return {
    fill: normalizePaint(declarations.fill),
    stroke: normalizePaint(declarations.stroke),
    strokeDasharray: normalizeValue(declarations['stroke-dasharray']),
    strokeWidth: normalizeValue(declarations['stroke-width']),
    text: normalizePaint(declarations.color),
  };
}

export function getMermaidNodePresentation(
  shape: MermaidItemPresentation,
  labels: MermaidItemPresentation[],
): MermaidItemPresentation {
  const text = shape.text ?? labels
    .map((presentation) => presentation.text ?? presentation.fill)
    .find((color): color is string => Boolean(color));

  return { ...shape, text: text ?? shape.text };
}

export function getCanvasNodePaint(presentation: MermaidItemPresentation): CanvasNodePaint {
  return {
    background: presentation.fill ?? 'var(--diagram-item-fill-fallback)',
    borderColor: presentation.stroke ?? 'var(--diagram-item-stroke-fallback)',
    color: presentation.text ?? 'var(--diagram-item-text-fallback)',
  };
}

export function getCanvasHandlePaint(active: boolean): string {
  return active ? 'var(--selection)' : 'var(--diagram-item-stroke-fallback)';
}

function getElementPresentation(element: Element, root: SVGGElement, css: string[]): MermaidItemPresentation {
  const attributes = Object.fromEntries([...PRESENTATION_PROPERTIES].map((property) => [
    property,
    element.getAttribute(property) ?? root.getAttribute(property),
  ]));
  return getMermaidPresentationFromElement({
    attributes,
    classNames: [...new Set([...root.classList, ...element.classList])],
    css,
    rootId: root.id,
    style: [root.getAttribute('style'), element.getAttribute('style')].filter(Boolean).join(';'),
    tagName: element.tagName,
  });
}

function getMatchingRules(stylesheet: string, classNames: string[], rootId: string | null | undefined, tagName?: string): string[] {
  const declarations: string[] = [];
  const rulePattern = /([^{}]+)\{([^{}]*)\}/g;
  let match: RegExpExecArray | null;
  while ((match = rulePattern.exec(stylesheet)) !== null) {
    const selectorList = match[1]?.split(',') ?? [];
    if (selectorList.some((selector) => selectorMatches(selector, classNames, rootId, tagName))) {
      declarations.push(match[2] ?? '');
    }
  }
  return declarations;
}

function selectorMatches(selector: string, classNames: string[], rootId: string | null | undefined, tagName?: string): boolean {
  const selectorIds = [...selector.matchAll(/#([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
  const entityIds = selectorIds.filter((id) => id.startsWith('flowchart-'));
  if (entityIds.length > 0 && !entityIds.some((id) => id === rootId)) {
    return false;
  }

  const finalSelectorPart = selector.trim().split(/[\s>+~]+/).at(-1) ?? '';
  const selectorTag = finalSelectorPart.match(/^([A-Za-z][A-Za-z0-9-]*)/)?.[1]?.toLowerCase();
  if (selectorTag && selectorTag !== tagName?.toLowerCase()) {
    return false;
  }

  const selectorClasses = [...selector.matchAll(/\.([A-Za-z0-9_-]+)/g)].map((match) => match[1]);
  return selectorClasses.every((className) => classNames.includes(className));
}

function parseDeclarations(source: string | null | undefined): Record<string, string> {
  if (!source) {
    return {};
  }

  return Object.fromEntries(source.split(';').flatMap((entry) => {
    const separator = entry.indexOf(':');
    if (separator < 1) {
      return [];
    }
    const property = entry.slice(0, separator).trim().toLowerCase();
    if (!PRESENTATION_PROPERTIES.has(property)) {
      return [];
    }
    return [[property, entry.slice(separator + 1).trim().replace(/\s*!important\s*$/i, '')]];
  }));
}

function normalizePaint(value: string | undefined): string | undefined {
  return normalizeValue(value);
}

function normalizeValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function extractNodeId(rawId: string): string | null {
  const match = rawId.match(/^flowchart-(.+)-\d+$/);
  return match?.[1] ?? null;
}
