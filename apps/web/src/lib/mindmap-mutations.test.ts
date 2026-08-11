// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { addMindmapNode, deleteMindmapNode, editMindmapNode, getMindmapDiagramSnapshot, getMindmapNodeIdentity, isMindmapSourceRepresentable, moveMindmapNode, reparentMindmapNode } from './mindmap-mutations';

const SOURCE = `---\ntitle: retained\n---\n%% retained\nmindmap\n  root((Product))\n    API[API]\n      ::icon(fa fa-server)\n      :::service important\n    Web\n      Browser`;

describe('Mindmap source mutations', () => {
  it('models root, nested nodes, supported shapes, icons, classes, and frontmatter without rewriting it', async () => {
    mermaid.initialize({ startOnLoad: false });
    await expect(mermaid.parse(SOURCE)).resolves.toMatchObject({ diagramType: 'mindmap' });
    expect(getMindmapDiagramSnapshot(SOURCE).nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'root', label: 'Product', shape: 'circle' }),
      expect.objectContaining({ id: 'API', label: 'API', icon: 'fa fa-server', classes: ['service', 'important'], parentLabel: 'Product' }),
    ]));
  });

  it('adds, edits, reparents, reorders, and deletes source-backed subtrees', async () => {
    const snapshot = getMindmapDiagramSnapshot(SOURCE); const root = getMindmapNodeIdentity(snapshot.nodes[0]!, snapshot.nodes);
    const added = addMindmapNode(SOURCE, { classes: ['new'], label: 'Mobile', shape: 'rounded' }, root);
    const addedSnapshot = getMindmapDiagramSnapshot(added); const mobile = getMindmapNodeIdentity(addedSnapshot.nodes.find((node) => node.label === 'Mobile')!, addedSnapshot.nodes);
    const edited = editMindmapNode(added, mobile, { icon: 'fa fa-phone', label: 'Apps', shape: 'square' });
    const editedSnapshot = getMindmapDiagramSnapshot(edited); const apps = getMindmapNodeIdentity(editedSnapshot.nodes.find((node) => node.label === 'Apps')!, editedSnapshot.nodes); const api = getMindmapNodeIdentity(editedSnapshot.nodes.find((node) => node.label === 'API')!, editedSnapshot.nodes);
    const reparented = reparentMindmapNode(edited, apps, api);
    const reparentedSnapshot = getMindmapDiagramSnapshot(reparented); const browser = getMindmapNodeIdentity(reparentedSnapshot.nodes.find((node) => node.label === 'Browser')!, reparentedSnapshot.nodes);
    const moved = moveMindmapNode(reparented, browser, 'up');
    const finalSnapshot = getMindmapDiagramSnapshot(moved); const appsAfterMove = getMindmapNodeIdentity(finalSnapshot.nodes.find((node) => node.label === 'Apps')!, finalSnapshot.nodes);
    const deleted = deleteMindmapNode(moved, appsAfterMove);
    await expect(mermaid.parse(deleted)).resolves.toMatchObject({ diagramType: 'mindmap' });
    expect(deleted).toContain('title: retained'); expect(deleted).toContain('%% retained'); expect(deleted).not.toContain('Apps');
  });

  it('uses semantic fingerprints after remote insertion, rejects duplicates, and preserves physical line endings', () => {
    const snapshot = getMindmapDiagramSnapshot(SOURCE); const web = getMindmapNodeIdentity(snapshot.nodes.find((node) => node.label === 'Web')!, snapshot.nodes);
    const remote = SOURCE.replace('    API[API]', '    Docs\n    API[API]');
    expect(editMindmapNode(remote, web, { label: 'Website' })).toContain('Website');
    const duplicate = 'mindmap\n  Root\n    Child\n    Child'; const nodes = getMindmapDiagramSnapshot(duplicate).nodes;
    expect(() => deleteMindmapNode(duplicate, getMindmapNodeIdentity(nodes[1]!, nodes))).toThrow('changed remotely');
    for (const ending of ['\n', '\r\n', '\r']) {
      const source = ['mindmap', '  Root', '    First', '    Second'].join(ending); const current = getMindmapDiagramSnapshot(source).nodes;
      expect(moveMindmapNode(source, getMindmapNodeIdentity(current[2]!, current), 'up').match(/\r\n|\n|\r/g)).toEqual(source.match(/\r\n|\n|\r/g));
    }
  });

  it('fails closed after remote relocation, replacement, or duplicate complete ancestry paths', () => {
    const source = 'mindmap\n  Root\n    Left\n      Target\n    Right';
    const nodes = getMindmapDiagramSnapshot(source).nodes;
    const target = getMindmapNodeIdentity(nodes.find((node) => node.label === 'Target')!, nodes);
    const root = getMindmapNodeIdentity(nodes[0]!, nodes);
    const relocated = 'mindmap\n  Root\n    Left\n    Right\n      Target';
    expect(() => editMindmapNode(relocated, target, { label: 'Edited' })).toThrow('changed remotely');
    expect(() => deleteMindmapNode(relocated, target)).toThrow('changed remotely');
    expect(() => moveMindmapNode(relocated, target, 'up')).toThrow('changed remotely');
    expect(() => reparentMindmapNode(relocated, target, root)).toThrow('changed remotely');
    const replaced = source.replace('      Target', '      Target((replacement))');
    expect(() => editMindmapNode(replaced, target, { label: 'Edited' })).toThrow('changed remotely');
    const duplicatedPath = 'mindmap\n  Root\n    Left\n      Target\n    Left\n      Target\n    Right';
    expect(() => deleteMindmapNode(duplicatedPath, target)).toThrow('changed remotely');
  });

  it('fails closed when a remote insertion duplicates an ancestor path prefix', () => {
    const source = 'mindmap\n  Root\n    Left\n      Target\n    Right';
    const nodes = getMindmapDiagramSnapshot(source).nodes;
    const target = getMindmapNodeIdentity(nodes.find((node) => node.label === 'Target')!, nodes);
    const root = getMindmapNodeIdentity(nodes[0]!, nodes);
    const remote = 'mindmap\n  Root\n    Left\n      Target\n    Left\n      Other\n    Right';
    expect(getMindmapNodeIdentity(getMindmapDiagramSnapshot(remote).nodes.find((node) => node.label === 'Target')!, getMindmapDiagramSnapshot(remote).nodes).occurrenceCount).toBe(0);
    expect(() => editMindmapNode(remote, target, { label: 'Edited' })).toThrow('changed remotely');
    expect(() => deleteMindmapNode(remote, target)).toThrow('changed remotely');
    expect(() => moveMindmapNode(remote, target, 'up')).toThrow('changed remotely');
    expect(() => reparentMindmapNode(remote, target, root)).toThrow('changed remotely');
  });

  it('emits Mermaid-parseable declarations for every supported node shape and retains BOM framing', async () => {
    let source = '\uFEFF---\r\ntitle: retained\r\n---\r\n%% kept\r\nmindmap\r\n  Root';
    let snapshot = getMindmapDiagramSnapshot(source); const root = () => getMindmapNodeIdentity(snapshot.nodes[0]!, snapshot.nodes);
    for (const shape of ['square', 'rounded', 'circle', 'bang', 'cloud', 'hexagon'] as const) { source = addMindmapNode(source, { classes: [], label: shape, shape }, root()); snapshot = getMindmapDiagramSnapshot(source); }
    await expect(mermaid.parse(source)).resolves.toMatchObject({ diagramType: 'mindmap' });
    expect(source.startsWith('\uFEFF---\r\ntitle: retained')).toBe(true); expect(source).toContain('%% kept');
  });

  it('fails closed for unclear indentation, unsupported source syntax, and cycles', () => {
    expect(isMindmapSourceRepresentable('mindmap\n  Root\n    Child\n   Unclear')).toBe(false);
    expect(isMindmapSourceRepresentable('mindmap\n  Root\n    Child:::inline')).toBe(false);
    const nodes = getMindmapDiagramSnapshot(SOURCE).nodes;
    expect(() => reparentMindmapNode(SOURCE, getMindmapNodeIdentity(nodes[1]!, nodes), getMindmapNodeIdentity(nodes[3]!, nodes))).toThrow('descendant');
  });
});
