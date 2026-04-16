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

export interface MutationResult {
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
