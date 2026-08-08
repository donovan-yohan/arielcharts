import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  MutationQueue,
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
