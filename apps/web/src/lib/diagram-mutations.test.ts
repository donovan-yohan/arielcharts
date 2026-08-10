import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  MutationQueue,
  createDiagramClipboardPayload,
  getPastedClipboardPositions,
  getDiagramEdgeIdentity,
  observeMutationFailure,
  parseFlowchartSnapshot,
} from './diagram-mutations';

function setText(yText: Y.Text, text: string) {
  yText.delete(0, yText.length);
  yText.insert(0, text);
}

describe('collaborative edge mutations', () => {
  it('resolves a selected edge after concurrent inserts before the original index', async () => {
    const doc = new Y.Doc();
    const yText = doc.getText('mermaid');
    setText(yText, 'flowchart LR\n  A --> B\n  B --> C\n');
    const selected = getDiagramEdgeIdentity(parseFlowchartSnapshot(yText.toString()).links[1]!, 1);
    setText(yText, 'flowchart LR\n  X --> Y\n  A --> B\n  B --> C\n');

    const queue = new MutationQueue(yText);
    const result = await queue.editEdgeLabelByIdentity(selected, 'safe');

    expect(result.snapshot.links[2]?.source).toBe('B');
    expect(result.snapshot.links[2]?.target).toBe('C');
    expect(result.snapshot.links[2]?.text?.text).toBe('safe');
    expect(result.snapshot.links[1]?.source).toBe('A');
    expect(result.snapshot.links[1]?.target).toBe('B');
  });

  it('rejects stale edge edits instead of mutating the edge currently at the stale index', async () => {
    const doc = new Y.Doc();
    const yText = doc.getText('mermaid');
    setText(yText, 'flowchart LR\n  A --> B\n  B --> C\n');
    const selected = getDiagramEdgeIdentity(parseFlowchartSnapshot(yText.toString()).links[1]!, 1);
    setText(yText, 'flowchart LR\n  A --> B\n  C --> D\n');

    const queue = new MutationQueue(yText);
    await expect(queue.removeEdgeByIdentity(selected)).rejects.toThrow('selected edge changed');

    const links = parseFlowchartSnapshot(yText.toString()).links;
    expect(links).toHaveLength(2);
    expect(links[1]?.source).toBe('C');
    expect(links[1]?.target).toBe('D');
  });

  it('reports a stale edge edit rejection to its event boundary', async () => {
    const doc = new Y.Doc();
    const yText = doc.getText('mermaid');
    setText(yText, 'flowchart LR\n  A --> B\n  B --> C\n');
    const selected = getDiagramEdgeIdentity(parseFlowchartSnapshot(yText.toString()).links[1]!, 1);
    setText(yText, 'flowchart LR\n  A --> B\n  C --> D\n');

    const queue = new MutationQueue(yText);
    const failures: unknown[] = [];
    observeMutationFailure(queue.editEdgeLabelByIdentity(selected, 'safe'), (error) => { failures.push(error); });
    await new Promise<void>((resolve) => { setTimeout(resolve, 0); });

    expect(failures).toHaveLength(1);
    expect(failures[0]).toBeInstanceOf(Error);
    expect((failures[0] as Error).message).toContain('selected edge changed');
  });

  it('uses the effective node id when a preferred id is claimed before a connected-node mutation runs', async () => {
    const doc = new Y.Doc();
    const yText = doc.getText('mermaid');
    setText(yText, 'flowchart LR\n  A[Source]\n');

    const queue = new MutationQueue(yText);
    await queue.addNode('Claimed', { id: 'new_node' });
    const result = await queue.addConnectedNode('A', 'New Node', { id: 'new_node' });

    expect(result.nodeId).toBe('new_node_2');
    expect(result.snapshot.nodeIds).toContain('new_node_2');
    expect(result.snapshot.links).toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'A', target: 'new_node_2' }),
    ]));
  });
});

describe('subgraph label mutations', () => {
  it('keeps nested section identity and contents without rendering the Mermaid AST', async () => {
    const doc = new Y.Doc();
    const yText = doc.getText('mermaid');
    const source = `flowchart TD\n  subgraph outer[Outer]\n    A[A]\n    subgraph inner[Inner]\n      B[B]\n    end\n    C[C]\n  end\n`;
    setText(yText, source);

    const result = await new MutationQueue(yText).editSubgraphLabel('inner', 'Renamed');

    expect(result.nextText).toBe(source.replace('subgraph inner[Inner]', 'subgraph inner["Renamed"]'));
    expect(result.snapshot.subgraphs.find((subgraph) => subgraph.id === 'outer')?.nodes).toEqual(['A', 'inner', 'C']);
    expect(result.snapshot.subgraphs.find((subgraph) => subgraph.id === 'inner')?.nodes).toEqual(['B']);
  });
});

describe('canvas clipboard mutations', () => {
  function createClipboard() {
    return createDiagramClipboardPayload(
      parseFlowchartSnapshot('flowchart LR\n  classDef hot fill:#f00,stroke:#900;\n  A[Alpha]:::hot ==>|thick label| B{Beta}\n  B -.-> C[Outside]\n'),
      ['A', 'B'],
      { A: { x: 100, y: 40 }, B: { x: 260, y: 80 } },
    )!;
  }

  it('copies only internal edges and recreates their supported semantics', async () => {
    const clipboard = createClipboard();
    expect(clipboard.links).toHaveLength(1);
    expect(clipboard.links[0]).toMatchObject({ length: 1, source: 'A', stroke: 'thick', target: 'B' });

    const doc = new Y.Doc();
    const yText = doc.getText('mermaid');
    setText(yText, 'flowchart LR\n  classDef hot fill:#f00,stroke:#900;\n  A[Alpha]:::hot\n  B{Beta}\n  C[Outside]\n');
    const result = await new MutationQueue(yText).pasteClipboard(clipboard);

    expect(result.pastedNodeIds).toEqual(['A_copy', 'B_copy']);
    expect(result.snapshot.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ classes: ['hot'], id: 'A_copy', shape: 'square', text: expect.objectContaining({ text: 'Alpha' }) }),
      expect.objectContaining({ id: 'B_copy', shape: 'diamond', text: expect.objectContaining({ text: 'Beta' }) }),
    ]));
    expect(result.snapshot.links).toEqual(expect.arrayContaining([
      expect.objectContaining({
        length: 1,
        source: 'A_copy',
        stroke: 'thick',
        target: 'B_copy',
        text: expect.objectContaining({ text: 'thick label' }),
        type: 'arrow_point',
      }),
    ]));
    expect(result.snapshot.links).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ source: 'B_copy', target: 'C_copy' }),
    ]));
    expect(result.nextText).toMatch(/class\s+A(?:,A_copy)?\s+hot|class\s+A_copy(?:,A)?\s+hot/);
  });

  it('allocates collision-safe IDs for repeated pastes and preserves relative layout', async () => {
    const clipboard = createClipboard();
    const doc = new Y.Doc();
    const yText = doc.getText('mermaid');
    setText(yText, 'flowchart LR\n  A[Alpha]\n  B{Beta}\n  A_copy[Already here]\n');
    const queue = new MutationQueue(yText);

    const first = await queue.pasteClipboard(clipboard);
    const second = await queue.pasteClipboard(clipboard);

    expect(first.pastedNodeIds).toEqual(['A_copy_2', 'B_copy']);
    expect(second.pastedNodeIds).toEqual(['A_copy_3', 'B_copy_2']);
    expect(getPastedClipboardPositions(clipboard, second.idMap, { x: 64, y: 64 })).toEqual({
      A_copy_3: { x: 164, y: 104 },
      B_copy_2: { x: 324, y: 144 },
    });
  });

  it('creates a flowchart from an empty source and calls onApplied in its Yjs transaction', async () => {
    const clipboard = createClipboard();
    const doc = new Y.Doc();
    const yText = doc.getText('mermaid');
    let inTransaction = false;
    let callbackResult: { idMap: Record<string, string>; pastedNodeIds: string[]; source: string } | null = null;
    doc.on('beforeTransaction', () => { inTransaction = true; });
    doc.on('afterTransaction', () => { inTransaction = false; });

    const result = await new MutationQueue(yText).pasteClipboard(clipboard, {
      onApplied: (applied) => {
        callbackResult = {
          idMap: applied.idMap,
          pastedNodeIds: applied.pastedNodeIds,
          source: yText.toString(),
        };
        expect(inTransaction).toBe(true);
      },
    });

    expect(result.pastedNodeIds).toEqual(['A_copy', 'B_copy']);
    expect(callbackResult).toEqual({
      idMap: { A: 'A_copy', B: 'B_copy' },
      pastedNodeIds: ['A_copy', 'B_copy'],
      source: expect.stringContaining('A_copy[Alpha]'),
    });
  });

  it('reports an onApplied failure without rejecting an already-applied paste', async () => {
    const clipboard = createClipboard();
    const doc = new Y.Doc();
    const yText = doc.getText('mermaid');
    const errors: unknown[] = [];
    const queue = new MutationQueue(yText, { onAfterApplyError: (error) => { errors.push(error); } });

    await expect(queue.pasteClipboard(clipboard, {
      onApplied: () => { throw new Error('layout write failed'); },
    })).resolves.toMatchObject({ pastedNodeIds: ['A_copy', 'B_copy'] });

    expect(yText.toString()).toContain('A_copy[Alpha]');
    expect(errors).toEqual([expect.objectContaining({ message: 'layout write failed' })]);
  });

  it('rejects stale or malformed clipboard payloads before touching source', async () => {
    const doc = new Y.Doc();
    const yText = doc.getText('mermaid');
    setText(yText, 'flowchart LR\n  A[Alpha]\n');
    const queue = new MutationQueue(yText);
    const invalid = createClipboard();
    invalid.version = 2 as 1;

    await expect(queue.pasteClipboard(invalid)).rejects.toThrow('invalid or stale');
    expect(yText.toString()).toBe('flowchart LR\n  A[Alpha]\n');
  });
});
