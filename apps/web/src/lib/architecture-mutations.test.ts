// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addArchitectureAlignment,
  addArchitectureEdge,
  addArchitectureGroup,
  addArchitectureJunction,
  addArchitectureService,
  deleteArchitectureAlignment,
  deleteArchitectureEdge,
  deleteArchitectureGroup,
  deleteArchitectureJunction,
  deleteArchitectureService,
  editArchitectureAlignment,
  editArchitectureEdge,
  editArchitectureGroup,
  editArchitectureJunction,
  editArchitectureService,
  getArchitectureAlignmentIdentity,
  getArchitectureDiagramSnapshot,
  getArchitectureEdgeIdentity,
  isArchitectureSourceRepresentable,
} from './architecture-mutations';

const SOURCE = `---
config:
  theme: neutral
---
%% preserve this comment
architecture-beta
  group platform(cloud)[Platform]
  service api(server)[API] in platform
  service db(database)[Database] in platform
  junction gateway in platform
  api:R --> L:gateway
  gateway:R --> L:db
  align row api gateway db
`;

async function expectValid(source: string): Promise<void> {
  expect(isArchitectureSourceRepresentable(source)).toBe(true);
  await expect(mermaid.parse(source)).resolves.toMatchObject({ diagramType: 'architecture' });
}

describe('architecture source mutations', () => {
  it('uses the typed Architecture AST/CST source ranges to snapshot groups, services, junctions, edges, and alignment', () => {
    expect(getArchitectureDiagramSnapshot(SOURCE)).toEqual({
      groups: [{ id: 'platform', icon: 'cloud', title: 'Platform', parentId: undefined }],
      services: [
        { id: 'api', icon: 'server', iconText: undefined, title: 'API', parentId: 'platform' },
        { id: 'db', icon: 'database', iconText: undefined, title: 'Database', parentId: 'platform' },
      ],
      junctions: [{ id: 'gateway', parentId: 'platform' }],
      edges: [
        { from: 'api', fromGroup: false, fromInto: false, fromPort: 'R', to: 'gateway', toGroup: false, toInto: true, toPort: 'L' },
        { from: 'gateway', fromGroup: false, fromInto: false, fromPort: 'R', to: 'db', toGroup: false, toInto: true, toPort: 'L' },
      ],
      alignments: [{ direction: 'row', members: ['api', 'gateway', 'db'] }],
    });
  });

  it('adds, edits, and deletes the supported architecture statement families while retaining unrelated bytes', async () => {
    mermaid.initialize({ startOnLoad: false });
    const source = SOURCE.replace(/\n/g, '\r\n');
    const nested = addArchitectureGroup(source, { id: 'network', icon: 'cloud', title: 'Network', parentId: 'platform' });
    const service = addArchitectureService(nested, { id: 'worker', icon: 'server', title: 'Worker', parentId: 'network' });
    const junction = addArchitectureJunction(service, { id: 'queue', parentId: 'network' });
    const edge = addArchitectureEdge(junction, { from: 'worker', fromGroup: false, fromInto: false, fromPort: 'B', to: 'queue', toGroup: false, toInto: true, toPort: 'T' });
    const aligned = addArchitectureAlignment(edge, { direction: 'column', members: ['worker', 'queue'] });
    await expectValid(aligned);
    expect(aligned).toContain('%% preserve this comment');
    expect(aligned).toContain('\r\n  service worker(server)[Worker] in network');

    const renamed = editArchitectureGroup(aligned, 'network', { id: 'networking', title: 'Networking' });
    const serviceEdited = editArchitectureService(renamed, 'worker', { id: 'consumer', title: 'Consumer' });
    const junctionEdited = editArchitectureJunction(serviceEdited, 'queue', { id: 'inbox' });
    const snapshot = getArchitectureDiagramSnapshot(junctionEdited);
    const edgeEdited = editArchitectureEdge(junctionEdited, getArchitectureEdgeIdentity(snapshot.edges[2]!, snapshot.edges), { from: 'consumer', fromGroup: false, fromInto: true, fromPort: 'B', to: 'inbox', toGroup: false, toInto: false, toPort: 'T' });
    const alignmentEdited = editArchitectureAlignment(edgeEdited, getArchitectureAlignmentIdentity(getArchitectureDiagramSnapshot(edgeEdited).alignments[1]!, getArchitectureDiagramSnapshot(edgeEdited).alignments), { direction: 'row', members: ['consumer', 'inbox'] });
    await expectValid(alignmentEdited);
    expect(alignmentEdited).toContain('consumer:B< -- T:inbox');
    expect(alignmentEdited).toContain('align row consumer inbox');

    const withoutAlignment = deleteArchitectureAlignment(alignmentEdited, getArchitectureAlignmentIdentity(getArchitectureDiagramSnapshot(alignmentEdited).alignments[1]!, getArchitectureDiagramSnapshot(alignmentEdited).alignments));
    const withoutEdge = deleteArchitectureEdge(withoutAlignment, getArchitectureEdgeIdentity(getArchitectureDiagramSnapshot(withoutAlignment).edges[2]!, getArchitectureDiagramSnapshot(withoutAlignment).edges));
    const withoutJunction = deleteArchitectureJunction(withoutEdge, 'inbox');
    const withoutService = deleteArchitectureService(withoutJunction, 'consumer');
    const withoutGroup = deleteArchitectureGroup(withoutService, 'networking');
    await expectValid(withoutGroup);
    expect(withoutGroup).not.toContain('networking');
  });

  it('fails closed for Mermaid syntax or semantic references outside the safe form', () => {
    expect(isArchitectureSourceRepresentable('architecture-beta\n  title Fancy deployment\n  service api[API]')).toBe(false);
    expect(isArchitectureSourceRepresentable('architecture-beta\n  service api[API] in missing')).toBe(false);
    expect(isArchitectureSourceRepresentable('architecture-beta\n  group outer[Outer]\n  service api[API]\n  api:R --> L:outer')).toBe(false);
    expect(isArchitectureSourceRepresentable('architecture-beta\n  service api[API]\n  service db[DB]\n  align row api api')).toBe(false);
    expect(() => addArchitectureService(SOURCE, { id: 'api', title: 'Duplicate' })).toThrow('already exists');
    expect(() => deleteArchitectureGroup(SOURCE, 'platform')).toThrow('contents and references');
  });

  it('re-resolves edge and alignment identities after unrelated remote insertions and rejects ambiguity', () => {
    const initial = getArchitectureDiagramSnapshot(SOURCE);
    const edge = getArchitectureEdgeIdentity(initial.edges[1]!, initial.edges);
    const alignment = getArchitectureAlignmentIdentity(initial.alignments[0]!, initial.alignments);
    const inserted = SOURCE.replace('  gateway:R --> L:db', '  db:L <-- R:api\n  gateway:R --> L:db').replace('  align row api gateway db', '  align column api db\n  align row api gateway db');
    expect(editArchitectureEdge(inserted, edge, { ...edge, from: 'gateway', to: 'db', toInto: false })).toContain('gateway:R -- L:db');
    expect(editArchitectureAlignment(inserted, alignment, { direction: 'column', members: ['api', 'gateway', 'db'] })).toContain('align column api gateway db');
    const ambiguousEdge = SOURCE.replace('  gateway:R --> L:db', '  gateway:R --> L:db\n  gateway:R --> L:db');
    const ambiguousAlignment = SOURCE.replace('  align row api gateway db', '  align row api gateway db\n  align row api gateway db');
    expect(() => deleteArchitectureEdge(ambiguousEdge, edge)).toThrow('resolved safely');
    expect(() => deleteArchitectureAlignment(ambiguousAlignment, alignment)).toThrow('resolved safely');
  });
});
