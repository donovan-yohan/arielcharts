import diff from 'fast-diff';
import { Flowchart } from 'mermaid-ast';
import type {
  FlowchartDirection,
  FlowchartLink,
  FlowchartLinkType,
  FlowchartNode,
  FlowchartNodeShape,
  FlowchartSubgraph,
} from 'mermaid-ast';
import * as Y from 'yjs';
import { renameFlowchartSubgraphDeclaration } from './diagram-subgraphs';

export type DiagramNodeShape = FlowchartNodeShape;
export type DiagramLinkType = FlowchartLinkType;
export type DiagramNode = FlowchartNode;
export type DiagramLink = FlowchartLink;
export type DiagramSubgraph = FlowchartSubgraph;

export interface FlowchartSnapshot {
  direction: FlowchartDirection;
  links: FlowchartLink[];
  nodeIds: string[];
  nodes: FlowchartNode[];
  subgraphs: FlowchartSubgraph[];
}

export interface DiagramEdgeIdentity {
  id?: string;
  index: number;
  label?: string;
  length: number;
  source: string;
  stroke: FlowchartLink['stroke'];
  target: string;
  type: FlowchartLinkType;
}

export interface MutationResult {
  /** The node created by a node-creation mutation, when applicable. */
  nodeId?: string;
  nextText: string;
  previousText: string;
  snapshot: FlowchartSnapshot;
}

export interface DiagramClipboardPoint {
  x: number;
  y: number;
}

export interface DiagramClipboardPayload {
  nodes: Array<{
    classes: string[];
    id: string;
    label: string;
    position: DiagramClipboardPoint;
    shape: DiagramNodeShape;
  }>;
  origin: DiagramClipboardPoint;
  version: 1;
  links: Array<{
    label?: string;
    length: number;
    source: string;
    stroke: FlowchartLink['stroke'];
    target: string;
    type: DiagramLinkType;
  }>;
}

export interface PasteClipboardResult extends MutationResult {
  idMap: Record<string, string>;
  pastedNodeIds: string[];
}

export interface PasteClipboardOptions {
  onApplied?: (result: PasteClipboardResult) => void;
}

interface QueuedMutation {
  afterApply?: (result: MutationResult) => void;
  mutate: (currentText: string) => MutationResult;
  reject: (reason?: unknown) => void;
  resolve: (value: MutationResult) => void;
}

export interface MutationQueueOptions {
  onAfterApplyError?: (error: unknown) => void;
  transactionOrigin?: unknown;
}

export interface AddNodeOptions {
  direction?: FlowchartDirection;
  id?: string;
  shape?: FlowchartNodeShape;
}

export interface AddEdgeOptions {
  label?: string;
  type?: FlowchartLinkType;
}

export interface AddConnectedNodeOptions extends AddNodeOptions, AddEdgeOptions {}

export interface GroupNodesOptions {
  id?: string;
}

const DIFF_EQUAL = 0;
const DIFF_INSERT = 1;
const DIFF_DELETE = -1;

const DEFAULT_NODE_LABEL = 'New Node';
const DEFAULT_SUBGRAPH_LABEL = 'New Group';
const DEFAULT_DIRECTION: FlowchartDirection = 'TD';
const DEFAULT_NODE_SHAPE: FlowchartNodeShape = 'rect';
const DEFAULT_LINK_TYPE: FlowchartLinkType = 'arrow_point';

export function getFlowchartSnapshot(chart: Flowchart): FlowchartSnapshot {
  return {
    direction: chart.direction,
    links: chart.links,
    nodeIds: chart.nodeIds,
    nodes: chart.nodes.map((node) => ({ ...node, classes: chart.getClasses(node.id) })),
    subgraphs: chart.subgraphs,
  };
}

export function parseFlowchartSnapshot(text: string): FlowchartSnapshot {
  return getFlowchartSnapshot(Flowchart.parse(text));
}

export function getHeaderOnlyFlowchartSnapshot(text: string): FlowchartSnapshot | null {
  const match = text.match(/^\s*(?:flowchart|graph)[ \t]+(TB|TD|BT|RL|LR)[ \t]*(?:%%[^\r\n]*)?(?:(?:\r\n|\n|\r)[ \t]*(?:%%[^\r\n]*)?)*$/iu);
  if (!match?.[1]) return null;
  return {
    direction: match[1].toUpperCase() as FlowchartDirection,
    links: [],
    nodeIds: [],
    nodes: [],
    subgraphs: [],
  };
}

export function isHeaderOnlyFlowchartSource(text: string): boolean {
  return getHeaderOnlyFlowchartSnapshot(text) !== null;
}

export function getDiagramEdgeIdentity(link: FlowchartLink, index: number): DiagramEdgeIdentity {
  return {
    id: link.id,
    index,
    label: link.text?.text,
    length: link.length,
    source: link.source,
    stroke: link.stroke,
    target: link.target,
    type: link.type,
  };
}

export function isSameDiagramEdge(link: FlowchartLink, identity: DiagramEdgeIdentity, options: { includeLabel?: boolean } = {}): boolean {
  const includeLabel = options.includeLabel ?? true;
  return link.id === identity.id
    && link.source === identity.source
    && link.target === identity.target
    && (!includeLabel || link.text?.text === identity.label)
    && link.stroke === identity.stroke
    && link.type === identity.type
    && link.length === identity.length;
}

export function resolveDiagramEdgeIndex(
  links: readonly FlowchartLink[],
  identity: DiagramEdgeIdentity,
  options: { includeLabel?: boolean } = {},
): number | null {
  const indexedLink = links[identity.index];
  if (indexedLink && isSameDiagramEdge(indexedLink, identity, options)) {
    return identity.index;
  }

  const matches = links
    .map((link, index) => ({ index, link }))
    .filter(({ link }) => isSameDiagramEdge(link, identity, options));

  return matches.length === 1 ? matches[0]?.index ?? null : null;
}

export function applyDiff(yText: Y.Text, newText: string, oldText = yText.toString()): void {
  const changes = diff(oldText, newText) as Array<[number, string]>;
  let offset = 0;

  for (const [type, value] of changes) {
    if (!value) {
      continue;
    }

    if (type === DIFF_EQUAL) {
      offset += value.length;
      continue;
    }

    if (type === DIFF_DELETE) {
      yText.delete(offset, value.length);
      continue;
    }

    if (type === DIFF_INSERT) {
      yText.insert(offset, value);
      offset += value.length;
    }
  }
}

/**
 * Observe a mutation started from an event handler so a rejected asynchronous
 * mutation is reported instead of becoming an unhandled rejection.
 */
export function observeMutationFailure<T>(mutation: Promise<T>, onFailure: (error: unknown) => void): void {
  void mutation.catch(onFailure);
}

export class MutationQueue {
  private readonly queue: QueuedMutation[] = [];

  private flushing = false;

  constructor(
    private readonly yText: Y.Text,
    private readonly options: MutationQueueOptions = {},
  ) {}

  enqueue(mutate: (currentText: string) => string): Promise<MutationResult> {
    return this.enqueueResult((currentText) => {
      const nextText = mutate(currentText);
      const chart = nextText.trim() ? Flowchart.parse(nextText) : Flowchart.create(DEFAULT_DIRECTION);
      return {
        nextText,
        previousText: currentText,
        snapshot: getFlowchartSnapshot(chart),
      };
    });
  }

  enqueueResult<TResult extends MutationResult>(
    mutate: (currentText: string) => TResult,
    afterApply?: (result: TResult) => void,
  ): Promise<TResult> {
    return new Promise<TResult>((resolve, reject) => {
      this.queue.push({
        afterApply: afterApply ? (result) => { afterApply(result as TResult); } : undefined,
        mutate,
        reject,
        resolve: (result) => { resolve(result as TResult); },
      });
      void this.flush();
    });
  }

  async editNodeLabel(nodeId: string, newLabel: string): Promise<MutationResult> {
    return this.enqueueFlowchartMutation((chart) => {
      chart.setNodeText(nodeId, newLabel);
    });
  }

  async editSubgraphLabel(subgraphId: string, newLabel: string): Promise<MutationResult> {
    return this.enqueueResult((currentText) => {
      const nextText = renameFlowchartSubgraphDeclaration(currentText, subgraphId, newLabel);
      return {
        nextText,
        previousText: currentText,
        snapshot: parseFlowchartSnapshot(nextText),
      };
    });
  }

  async changeNodeShape(nodeId: string, shape: FlowchartNodeShape): Promise<MutationResult> {
    return this.enqueueFlowchartMutation((chart) => {
      chart.setNodeShape(nodeId, shape);
    });
  }

  async addNode(label = DEFAULT_NODE_LABEL, options: AddNodeOptions = {}): Promise<MutationResult> {
    return this.enqueueFlowchartMutation((chart) => {
      const nodeId = ensureUniqueId(chart.nodeIds, options.id ?? createNodeId(label));
      chart.addNode(nodeId, label, { shape: options.shape ?? DEFAULT_NODE_SHAPE });
    }, { createIfEmpty: true, direction: options.direction });
  }

  /**
   * Add a node and its incoming edge in one queued mutation. Computing the
   * effective node id from the same chart snapshot prevents a collaborator
   * claiming the preferred id between a UI gesture and mutation execution.
   */
  async addConnectedNode(source: string, label = DEFAULT_NODE_LABEL, options: AddConnectedNodeOptions = {}): Promise<MutationResult> {
    return this.enqueueResult((currentText) => {
      const chart = getMutableFlowchart(currentText, { createIfEmpty: true, direction: options.direction });
      const nodeId = ensureUniqueId(chart.nodeIds, options.id ?? createNodeId(label));
      chart.addNode(nodeId, label, { shape: options.shape ?? DEFAULT_NODE_SHAPE });
      chart.addLink(source, nodeId, {
        text: options.label,
        type: options.type ?? DEFAULT_LINK_TYPE,
      });

      return {
        nextText: chart.render(),
        nodeId,
        previousText: currentText,
        snapshot: getFlowchartSnapshot(chart),
      };
    });
  }

  async pasteClipboard(
    payload: DiagramClipboardPayload,
    options: PasteClipboardOptions = {},
  ): Promise<PasteClipboardResult> {
    assertValidClipboardPayload(payload);

    return this.enqueueResult((currentText) => {
      const chart = getMutableFlowchart(currentText, { createIfEmpty: true });
      const idMap: Record<string, string> = {};
      const reservedIds = [...chart.nodeIds];

      for (const node of payload.nodes) {
        const pastedId = ensureUniqueId(reservedIds, `${node.id}_copy`);
        reservedIds.push(pastedId);
        idMap[node.id] = pastedId;
        chart.addNode(pastedId, node.label, { classes: node.classes, shape: node.shape });
      }

      for (const link of payload.links) {
        const source = idMap[link.source];
        const target = idMap[link.target];
        if (!source || !target) {
          throw new Error('Cannot paste an invalid or stale canvas selection.');
        }
        chart.addLink(source, target, {
          length: link.length,
          stroke: link.stroke,
          text: link.label,
          type: link.type,
        });
      }

      const result: PasteClipboardResult = {
        idMap,
        nextText: chart.render(),
        pastedNodeIds: payload.nodes.map((node) => idMap[node.id]!).filter((nodeId): nodeId is string => Boolean(nodeId)),
        previousText: currentText,
        snapshot: getFlowchartSnapshot(chart),
      };

      return result;
    }, options.onApplied);
  }

  async removeNode(nodeId: string): Promise<MutationResult> {
    return this.enqueueFlowchartMutation((chart) => {
      chart.removeNode(nodeId, { reconnect: true });
    });
  }

  async addEdge(source: string, target: string, options: AddEdgeOptions = {}): Promise<MutationResult> {
    return this.enqueueResult((currentText) => {
      const snapshot = parseSourceSafeEdgeSnapshot(currentText);
      if (!snapshot.nodeIds.includes(source) || !snapshot.nodeIds.includes(target)) {
        throw new Error('Cannot connect nodes because the selected node changed.');
      }

      // Mermaid AST currently drops quotes required by existing labels when it
      // renders a whole chart. Render only the new edge, then append that
      // declaration so all existing source remains canonical and untouched.
      const nextText = appendFlowchartEdgeDeclaration(currentText, renderFlowchartEdgeDeclaration(source, target, options));
      return {
        nextText,
        previousText: currentText,
        snapshot: parseSourceSafeEdgeSnapshot(nextText),
      };
    });
  }

  async removeEdge(source: string, target: string): Promise<MutationResult> {
    return this.enqueueFlowchartMutation((chart) => {
      chart.removeLinksBetween(source, target);
    });
  }

  async removeEdgeByIdentity(edge: DiagramEdgeIdentity): Promise<MutationResult> {
    return this.enqueueFlowchartMutation((chart) => {
      const index = resolveDiagramEdgeIndex(chart.links, edge);
      if (index === null) {
        throw new Error('Cannot delete edge because the selected edge changed.');
      }

      chart.removeLink(index);
    });
  }

  async editEdgeLabelByIdentity(edge: DiagramEdgeIdentity, label?: string): Promise<MutationResult> {
    return this.enqueueFlowchartMutation((chart) => {
      const index = resolveDiagramEdgeIndex(chart.links, edge);
      if (index === null) {
        throw new Error('Cannot edit edge because the selected edge changed.');
      }

      chart.setLinkText(index, label);
    });
  }

  async groupNodes(nodeIds: string[], label = DEFAULT_SUBGRAPH_LABEL, options: GroupNodesOptions = {}): Promise<MutationResult> {
    return this.enqueueFlowchartMutation((chart) => {
      const subgraphId = ensureUniqueId(chart.subgraphs.map((subgraph) => subgraph.id), options.id ?? createSubgraphId(label));
      chart.createSubgraph(subgraphId, nodeIds, label);
    });
  }

  async ungroupSubgraph(subgraphId: string): Promise<MutationResult> {
    return this.enqueueFlowchartMutation((chart) => {
      chart.dissolveSubgraph(subgraphId);
    });
  }

  isIdle(): boolean {
    return !this.flushing && this.queue.length === 0;
  }

  private async flush(): Promise<void> {
    if (this.flushing) {
      return;
    }

    this.flushing = true;

    try {
      while (this.queue.length > 0) {
        const next = this.queue.shift();
        if (!next) {
          continue;
        }

        try {
          const previousText = this.yText.toString();
          const result = next.mutate(previousText);

          const applyResult = () => {
            if (result.nextText !== previousText) {
              applyDiff(this.yText, result.nextText, previousText);
            }
            try {
              next.afterApply?.({ ...result, previousText });
            } catch (error) {
              if (this.options.onAfterApplyError) {
                this.options.onAfterApplyError(error);
              } else {
                throw error;
              }
            }
          };

          if (result.nextText !== previousText || next.afterApply) {
            const doc = this.yText.doc;
            if (doc) {
              doc.transact(applyResult, this.options.transactionOrigin);
            } else {
              applyResult();
            }
          }

          next.resolve({
            ...result,
            previousText,
          });
        } catch (error) {
          next.reject(error);
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private enqueueFlowchartMutation(
    mutate: (chart: Flowchart) => void,
    options: { createIfEmpty?: boolean; direction?: FlowchartDirection } = {},
  ): Promise<MutationResult> {
    return this.enqueueResult((currentText) => {
      const chart = getMutableFlowchart(currentText, options);
      mutate(chart);
      const nextText = chart.render();

      return {
        nextText,
        previousText: currentText,
        snapshot: getFlowchartSnapshot(chart),
      };
    });
  }
}

export function createDiagramClipboardPayload(
  snapshot: FlowchartSnapshot,
  selectedNodeIds: readonly string[],
  positions: Readonly<Record<string, DiagramClipboardPoint | undefined>>,
): DiagramClipboardPayload | null {
  const selectedIds = new Set(selectedNodeIds);
  const nodes = snapshot.nodes
    .filter((node) => selectedIds.has(node.id))
    .map((node) => ({
      id: node.id,
      classes: [...(node.classes ?? [])],
      label: typeof node.text === 'string' ? node.text : node.text?.text ?? node.id,
      position: positions[node.id] ?? { x: 0, y: 0 },
      shape: node.shape,
    }));

  if (nodes.length === 0) {
    return null;
  }

  const origin = {
    x: Math.min(...nodes.map((node) => node.position.x)),
    y: Math.min(...nodes.map((node) => node.position.y)),
  };

  return {
    links: snapshot.links
      .filter((link) => selectedIds.has(link.source) && selectedIds.has(link.target))
      .map((link) => ({
        label: typeof link.text === 'string' ? link.text : link.text?.text,
        length: link.length,
        source: link.source,
        stroke: link.stroke,
        target: link.target,
        type: link.type,
      })),
    nodes: nodes.map((node) => ({
      ...node,
      position: { x: node.position.x - origin.x, y: node.position.y - origin.y },
    })),
    origin,
    version: 1,
  };
}

export function getPastedClipboardPositions(
  payload: DiagramClipboardPayload,
  idMap: Readonly<Record<string, string>>,
  offset: DiagramClipboardPoint,
): Record<string, DiagramClipboardPoint> {
  assertValidClipboardPayload(payload);

  return Object.fromEntries(payload.nodes.map((node) => {
    const pastedId = idMap[node.id];
    if (!pastedId) {
      throw new Error('Cannot paste an invalid or stale canvas selection.');
    }
    return [pastedId, {
      x: payload.origin.x + node.position.x + offset.x,
      y: payload.origin.y + node.position.y + offset.y,
    }];
  }));
}

export function assertValidClipboardPayload(payload: DiagramClipboardPayload): void {
  const nodeIds = new Set<string>();
  const isFinitePoint = (point: DiagramClipboardPoint | undefined) => Boolean(point && Number.isFinite(point.x) && Number.isFinite(point.y));
  if (payload.version !== 1 || !isFinitePoint(payload.origin) || payload.nodes.length === 0) {
    throw new Error('Cannot paste an invalid or stale canvas selection.');
  }

  for (const node of payload.nodes) {
    if (!node.id
      || !node.label
      || nodeIds.has(node.id)
      || !Array.isArray(node.classes)
      || node.classes.some((className) => typeof className !== 'string' || !className.trim())
      || new Set(node.classes).size !== node.classes.length
      || !isFinitePoint(node.position)) {
      throw new Error('Cannot paste an invalid or stale canvas selection.');
    }
    nodeIds.add(node.id);
  }

  for (const link of payload.links) {
    if (!nodeIds.has(link.source) || !nodeIds.has(link.target) || !Number.isInteger(link.length) || link.length < 1) {
      throw new Error('Cannot paste an invalid or stale canvas selection.');
    }
  }
}

function getMutableFlowchart(
  currentText: string,
  options: { createIfEmpty?: boolean; direction?: FlowchartDirection },
): Flowchart {
  if (!currentText.trim()) {
    if (!options.createIfEmpty) {
      throw new Error('Cannot mutate an empty diagram.');
    }

    return Flowchart.create(options.direction ?? DEFAULT_DIRECTION);
  }

  return Flowchart.parse(currentText);
}

function renderFlowchartEdgeDeclaration(source: string, target: string, options: AddEdgeOptions): string {
  const edgeChart = Flowchart.create(DEFAULT_DIRECTION);
  edgeChart.addLink(source, target, {
    type: options.type ?? DEFAULT_LINK_TYPE,
  });
  const declaration = edgeChart.render().split(/\r\n|\n|\r/u).slice(1).join('\n').trim();
  if (!declaration || declaration.includes('\n') || declaration.includes('\r')) {
    throw new Error('Cannot serialize a flowchart edge declaration.');
  }

  if (options.label === undefined) {
    return declaration;
  }

  const prefix = `${source} `;
  const suffix = ` ${target}`;
  if (!declaration.startsWith(prefix) || !declaration.endsWith(suffix)) {
    throw new Error('Cannot serialize a flowchart edge declaration.');
  }
  const connector = declaration.slice(prefix.length, -suffix.length);
  return `${prefix}${connector}|${serializeFlowchartEdgeLabel(options.label)}|${suffix}`;
}

function serializeFlowchartEdgeLabel(label: string): string {
  if (/\r|\n/u.test(label)) {
    throw new Error('Cannot serialize a multiline flowchart edge label.');
  }
  return `"${label.replace(/&/gu, '&amp;').replace(/"/gu, '&quot;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')}"`;
}

function appendFlowchartEdgeDeclaration(source: string, declaration: string): string {
  const lineEnding = source.match(/\r\n|\n|\r/u)?.[0] ?? '\n';
  const endsWithLineBreak = /(?:\r\n|\n|\r)$/u.test(source);
  return `${source}${endsWithLineBreak ? '' : lineEnding}  ${declaration}${lineEnding}`;
}

function parseSourceSafeEdgeSnapshot(source: string): FlowchartSnapshot {
  // AST parsing is only a read for node validation and the resulting canvas
  // snapshot. Keep all Mermaid comments/directives and original newlines in
  // Y.Text; they are not safe to round-trip through mermaid-ast.
  const astSource = source
    .replace(/^[ \t]*%%.*(?:\r\n|\n|\r|$)/gmu, '')
    .replace(/\r\n|\r/gu, '\n');
  return parseFlowchartSnapshot(astSource);
}

export function createNodeId(label: string): string {
  return createSlug(label, 'node');
}

export function createSubgraphId(label: string): string {
  return createSlug(label, 'group');
}

export function ensureUniqueId(existingIds: readonly string[], preferredId: string): string {
  const baseId = preferredId.trim() || 'item';
  if (!existingIds.includes(baseId)) {
    return baseId;
  }

  let suffix = 2;
  while (existingIds.includes(`${baseId}_${suffix}`)) {
    suffix += 1;
  }

  return `${baseId}_${suffix}`;
}

function createSlug(input: string, fallback: string): string {
  const normalized = input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
}
