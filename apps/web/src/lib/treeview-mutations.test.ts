// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { addTreeViewNode, deleteTreeViewNode, editTreeViewNode, getTreeViewDiagramSnapshot, getTreeViewNodeIdentity, isTreeViewSourceRepresentable, moveTreeViewNode, reparentTreeViewNode } from './treeview-mutations';

const SOURCE = `\uFEFF---\r\ntitle: retained\r\n---\r\ntreeView-beta\r\n  "project root"/ :::highlight icon(folder) ## source\r\n    src/\r\n      index.ts icon(typescript)\r\n    README.md`;

describe('TreeView source mutations', () => {
  it('models quoted files/directories, descriptions, classes, icons, nesting, and frontmatter', async () => {
    mermaid.initialize({ startOnLoad: false });
    await expect(mermaid.parse(SOURCE)).resolves.toMatchObject({ diagramType: 'treeView' });
    expect(getTreeViewDiagramSnapshot(SOURCE).nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ label: 'project root', directory: true, quoted: true, description: 'source', classes: ['highlight'], icon: 'folder' }),
      expect.objectContaining({ label: 'index.ts', icon: 'typescript', parentLabel: 'src' }),
    ]));
  });

  it('adds, edits, reparents, reorders, and deletes nodes while retaining source framing', async () => {
    const start = getTreeViewDiagramSnapshot(SOURCE); const root = getTreeViewNodeIdentity(start.nodes[0]!, start.nodes);
    const added = addTreeViewNode(SOURCE, { classes: [], directory: false, label: 'package.json', quoted: false }, root);
    const addedSnapshot = getTreeViewDiagramSnapshot(added); const packageJson = getTreeViewNodeIdentity(addedSnapshot.nodes.find((node) => node.label === 'package.json')!, addedSnapshot.nodes);
    const edited = editTreeViewNode(added, packageJson, { description: 'manifest', icon: 'json' });
    const editedSnapshot = getTreeViewDiagramSnapshot(edited); const packageAfterEdit = getTreeViewNodeIdentity(editedSnapshot.nodes.find((node) => node.label === 'package.json')!, editedSnapshot.nodes); const src = getTreeViewNodeIdentity(editedSnapshot.nodes.find((node) => node.label === 'src')!, editedSnapshot.nodes);
    const reparented = reparentTreeViewNode(edited, packageAfterEdit, src);
    const snapshot = getTreeViewDiagramSnapshot(reparented); const readme = getTreeViewNodeIdentity(snapshot.nodes.find((node) => node.label === 'README.md')!, snapshot.nodes);
    const moved = moveTreeViewNode(reparented, readme, 'up'); const movedSnapshot = getTreeViewDiagramSnapshot(moved); const packageAfterMove = getTreeViewNodeIdentity(movedSnapshot.nodes.find((node) => node.label === 'package.json')!, movedSnapshot.nodes);
    const deleted = deleteTreeViewNode(moved, packageAfterMove);
    await expect(mermaid.parse(deleted)).resolves.toMatchObject({ diagramType: 'treeView' });
    expect(deleted).toContain('\uFEFF---\r\ntitle: retained'); expect(deleted).toContain('README.md'); expect(deleted).not.toContain('package.json');
  });

  it('represents box-drawing input and supports safe source updates', async () => {
    const box = 'treeView-beta\nroot/\n├── a.txt\n└── lib/\n    └── main.ts icon(typescript)';
    await expect(mermaid.parse(box)).resolves.toMatchObject({ diagramType: 'treeView' });
    const snapshot = getTreeViewDiagramSnapshot(box); expect(snapshot.nodes.map((node) => node.label)).toEqual(['root', 'a.txt', 'lib', 'main.ts']);
    const edited = editTreeViewNode(box, getTreeViewNodeIdentity(snapshot.nodes[3]!, snapshot.nodes), { label: 'entry.ts' });
    expect(edited).toContain('└── entry.ts icon(typescript)'); expect(isTreeViewSourceRepresentable(edited)).toBe(true);
  });

  it('resolves unique remote fingerprints, fails closed for duplicates/invalid indentation, and keeps line terminators in place', () => {
    const snapshot = getTreeViewDiagramSnapshot(SOURCE); const readme = getTreeViewNodeIdentity(snapshot.nodes.find((node) => node.label === 'README.md')!, snapshot.nodes);
    const remote = SOURCE.replace('    src/', '    docs/\r\n    src/'); expect(editTreeViewNode(remote, readme, { label: 'GUIDE.md' })).toContain('GUIDE.md');
    const duplicate = 'treeView-beta\nRoot\n  Child\n  Child'; const nodes = getTreeViewDiagramSnapshot(duplicate).nodes; expect(() => deleteTreeViewNode(duplicate, getTreeViewNodeIdentity(nodes[1]!, nodes))).toThrow('changed remotely');
    expect(isTreeViewSourceRepresentable('treeView-beta\nRoot\n  Child\n   Unclear')).toBe(false);
    for (const ending of ['\n', '\r\n', '\r']) { const source = ['treeView-beta', '  Root', '    One', '    Two'].join(ending); const current = getTreeViewDiagramSnapshot(source).nodes; expect(moveTreeViewNode(source, getTreeViewNodeIdentity(current[2]!, current), 'up').match(/\r\n|\n|\r/g)).toEqual(source.match(/\r\n|\n|\r/g)); }
  });

  it('fails closed after remote relocation, replacement, or duplicate complete ancestry paths', () => {
    const source = 'treeView-beta\n  root/\n    left/\n      target.txt\n    right/';
    const nodes = getTreeViewDiagramSnapshot(source).nodes;
    const target = getTreeViewNodeIdentity(nodes.find((node) => node.label === 'target.txt')!, nodes);
    const root = getTreeViewNodeIdentity(nodes[0]!, nodes);
    const relocated = 'treeView-beta\n  root/\n    left/\n    right/\n      target.txt';
    expect(() => editTreeViewNode(relocated, target, { label: 'edited.txt' })).toThrow('changed remotely');
    expect(() => deleteTreeViewNode(relocated, target)).toThrow('changed remotely');
    expect(() => moveTreeViewNode(relocated, target, 'up')).toThrow('changed remotely');
    expect(() => reparentTreeViewNode(relocated, target, root)).toThrow('changed remotely');
    const replaced = source.replace('      target.txt', '      target.txt :::replacement');
    expect(() => editTreeViewNode(replaced, target, { label: 'edited.txt' })).toThrow('changed remotely');
    const duplicatedPath = 'treeView-beta\n  root/\n    left/\n      target.txt\n    left/\n      target.txt\n    right/';
    expect(() => deleteTreeViewNode(duplicatedPath, target)).toThrow('changed remotely');
  });

  it('fails closed when a remote insertion duplicates an ancestor path prefix', () => {
    const source = 'treeView-beta\n  root/\n    left/\n      target.txt\n    right/';
    const nodes = getTreeViewDiagramSnapshot(source).nodes;
    const target = getTreeViewNodeIdentity(nodes.find((node) => node.label === 'target.txt')!, nodes);
    const root = getTreeViewNodeIdentity(nodes[0]!, nodes);
    const remote = 'treeView-beta\n  root/\n    left/\n      target.txt\n    left/\n      other.txt\n    right/';
    const remoteNodes = getTreeViewDiagramSnapshot(remote).nodes;
    expect(getTreeViewNodeIdentity(remoteNodes.find((node) => node.label === 'target.txt')!, remoteNodes).occurrenceCount).toBe(0);
    expect(() => editTreeViewNode(remote, target, { label: 'edited.txt' })).toThrow('changed remotely');
    expect(() => deleteTreeViewNode(remote, target)).toThrow('changed remotely');
    expect(() => moveTreeViewNode(remote, target, 'up')).toThrow('changed remotely');
    expect(() => reparentTreeViewNode(remote, target, root)).toThrow('changed remotely');
  });

  it('preserves the existing final-newline policy when adding with mixed terminators', () => {
    const source = 'treeView-beta\r\n  root/\n    src/\r      index.ts';
    const nodes = getTreeViewDiagramSnapshot(source).nodes;
    const src = getTreeViewNodeIdentity(nodes.find((node) => node.label === 'src')!, nodes);
    expect(addTreeViewNode(source, { classes: [], directory: false, label: 'main.ts', quoted: false }, src))
      .toBe('treeView-beta\r\n  root/\n    src/\r      index.ts\r      main.ts');
  });
});
