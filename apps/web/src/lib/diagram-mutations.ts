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

interface QueuedMutation {
  mutate: (currentText: string) => MutationResult;
  reject: (reason?: unknown) => void;
  resolve: (value: MutationResult) => void;
}

export interface MutationQueueOptions {
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
    nodes: chart.nodes,
    subgraphs: chart.subgraphs,
  };
}

export function parseFlowchartSnapshot(text: string): FlowchartSnapshot {
  return getFlowchartSnapshot(Flowchart.parse(text));
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

  enqueueResult(mutate: (currentText: string) => MutationResult): Promise<MutationResult> {
    return new Promise<MutationResult>((resolve, reject) => {
      this.queue.push({ mutate, reject, resolve });
      void this.flush();
    });
  }

  async editNodeLabel(nodeId: string, newLabel: string): Promise<MutationResult> {
    return this.enqueueFlowchartMutation((chart) => {
      chart.setNodeText(nodeId, newLabel);
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

  async removeNode(nodeId: string): Promise<MutationResult> {
    return this.enqueueFlowchartMutation((chart) => {
      chart.removeNode(nodeId, { reconnect: true });
    });
  }

  async addEdge(source: string, target: string, options: AddEdgeOptions = {}): Promise<MutationResult> {
    return this.enqueueFlowchartMutation((chart) => {
      chart.addLink(source, target, {
        text: options.label,
        type: options.type ?? DEFAULT_LINK_TYPE,
      });
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

          if (result.nextText !== previousText) {
            const doc = this.yText.doc;
            if (doc) {
              doc.transact(() => {
                applyDiff(this.yText, result.nextText, previousText);
              }, this.options.transactionOrigin);
            } else {
              applyDiff(this.yText, result.nextText, previousText);
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
