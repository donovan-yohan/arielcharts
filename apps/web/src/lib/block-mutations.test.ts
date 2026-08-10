// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addBlockLink,
  addBlockNode,
  addBlockComposite,
  deleteBlockComposite,
  deleteBlockLink,
  deleteBlockNode,
  editBlockLink,
  editBlockNode,
  setBlockColumns,
  editBlockComposite,
  getBlockDiagramSnapshot,
  getBlockLinkIdentity,
  isBlockSourceRepresentable,
  moveBlockComposite,
  moveBlockNode,
} from './block-mutations';

const SOURCE = `---
config:
  theme: neutral
---
%% layout intent remains authored source
block-beta
  columns 3
  api["Public API"]:2
  worker
  block:storage:2
    columns 2
    db["Database"]
  end
  api --> worker
  worker --> db
`;

describe('block source mutations', () => {
  it('keeps the supported subset accepted by Mermaid 11.16.1', async () => {
    mermaid.initialize({ startOnLoad: false });
    await expect(mermaid.parse(SOURCE)).resolves.toMatchObject({ diagramType: 'block' });
  });

  it('models single-line named blocks, bounded spans, columns, composites, and simple links', () => {
    expect(getBlockDiagramSnapshot(SOURCE)).toEqual({
      columns: 3,
      nodes: [
        { id: 'api', label: 'Public API', span: 2 },
        { id: 'worker', label: 'worker', span: 1 },
        { id: 'db', label: 'Database', parentId: 'storage', span: 1 },
      ],
      composites: [{ id: 'storage', span: 2, columns: 2 }],
      links: [{ from: 'api', to: 'worker' }, { from: 'worker', to: 'db' }],
    });
  });

  it('keeps structural source edits small and follows semantic link identity after a remote insertion', () => {
    const added = addBlockNode(SOURCE, { id: 'api', label: 'Gateway', span: 2 });
    expect(added).toContain('api2["Gateway"]:2');
    const linked = addBlockLink(added, { from: 'api2', to: 'worker' });
    const renamed = editBlockNode(linked, 'api2', { id: 'gateway', label: 'Gateway API' });
    expect(renamed).toContain('gateway["Gateway API"]:2');
    expect(renamed).toContain('gateway --> worker');
    const links = getBlockDiagramSnapshot(renamed).links;
    const edited = editBlockLink(renamed, getBlockLinkIdentity(links[2]!, 2, links), { to: 'db' });
    expect(edited).toContain('gateway --> db');
    const currentLinks = getBlockDiagramSnapshot(edited).links;
    const without = deleteBlockLink(edited, getBlockLinkIdentity(currentLinks[2]!, 2, currentLinks));
    expect(deleteBlockNode(without, 'gateway')).not.toContain('gateway');
    expect(without).toContain('%% layout intent remains authored source');
  });

  it('allows a named composite to participate in a simple link and removes its bounded source range atomically', () => {
    const added = addBlockComposite(SOURCE, { id: 'storage', span: 2, columns: 2 });
    expect(added).toContain('block:storage2:2');
    const linked = addBlockLink(added, { from: 'api', to: 'storage2' });
    const renamed = editBlockComposite(linked, 'storage2', { id: 'archive', columns: 3 });
    expect(renamed).toContain('api --> archive');
    expect(renamed).toContain('block:archive:2\n    columns 3');
    expect(deleteBlockComposite(renamed, 'archive')).not.toContain('archive');
  });

  it('inserts root columns after the header without separating it from the first authored statement', () => {
    expect(setBlockColumns('block-beta\n  api["API"]', 2)).toBe('block-beta\n  columns 2\n  api["API"]');
  });

  it('keeps parent membership and removes every descendant incident link with a composite', () => {
    const source = `block-beta
  block:outer
    block:inner
      child["Child"]
    end
  end
  outside["Outside"]
  child --> outside`;
    expect(getBlockDiagramSnapshot(source).nodes[0]).toMatchObject({ id: 'child', parentId: 'inner' });
    expect(getBlockDiagramSnapshot(source).composites.find((item) => item.id === 'inner')).toMatchObject({ parentId: 'outer' });
    expect(deleteBlockComposite(source, 'outer')).not.toContain('child --> outside');
  });

  it('moves nodes and composite ranges while rejecting cyclic composite containment', () => {
    const source = `block-beta
  block:outer
    block:inner
      child["Child"]
    end
  end
  item["Item"]`;
    const movedNode = moveBlockNode(source, 'item', 'inner');
    expect(movedNode).toContain('      item["Item"]');
    const movedComposite = moveBlockComposite(movedNode, 'inner', null);
    expect(movedComposite).toContain('  block:inner');
    expect(() => moveBlockComposite(source, 'outer', 'inner')).toThrow('cannot contain itself');
  });

  it('moves CR-only composite ranges without normalizing line endings or adding a blank line', () => {
    const source = 'block-beta\r  block:outer\r  end\r  block:inner\r    item["Item"]\r  end\r';
    expect(moveBlockComposite(source, 'inner', 'outer')).toBe('block-beta\r  block:outer\r    block:inner\r      item["Item"]\r    end\r  end\r');
  });

  it('re-resolves a unique link after remote movement and rejects duplicate fingerprints', () => {
    const links = getBlockDiagramSnapshot(SOURCE).links;
    const identity = getBlockLinkIdentity(links[1]!, 1, links);
    const inserted = SOURCE.replace('  worker --> db', '  db --> worker\n  worker --> db');
    expect(editBlockLink(inserted, identity, { from: 'api' })).toContain('api --> db');
    const duplicate = SOURCE.replace('  worker --> db', '  worker --> db\n  worker --> db');
    expect(isBlockSourceRepresentable(duplicate)).toBe(true);
    expect(() => deleteBlockLink(duplicate, identity)).toThrow('resolved safely');
  });

  it('fails closed for implicit packed items, anonymous or space blocks, styles, and advanced links', () => {
    expect(isBlockSourceRepresentable('block-beta\n  a b')).toBe(false);
    expect(isBlockSourceRepresentable('block-beta\n  block\n    a\n  end')).toBe(false);
    expect(isBlockSourceRepresentable('block-beta\n  space:2')).toBe(false);
    expect(isBlockSourceRepresentable('block-beta\n  a:::red')).toBe(false);
    expect(isBlockSourceRepresentable('block-beta\n  a\n  b\n  a --- b')).toBe(false);
    expect(() => addBlockNode(SOURCE, { id: 'bad id', label: 'Bad', span: 1 })).toThrow('identifiers');
  });
});
