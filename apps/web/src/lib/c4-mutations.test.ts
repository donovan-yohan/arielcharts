// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addC4Element,
  addC4Boundary,
  deleteC4Boundary,
  addC4Relationship,
  deleteC4Element,
  deleteC4Relationship,
  editC4Element,
  editC4Boundary,
  editC4Relationship,
  getC4DiagramSnapshot,
  getC4RelationshipIdentity,
  isC4SourceRepresentable,
  moveC4Boundary,
  moveC4Element,
} from './c4-mutations';

const SOURCE = `---
config:
  theme: neutral
---
%% the source model leaves this comment alone
C4Container
  Person(customer, "Customer", "Places orders")
  System_Boundary(shop, "Shop") {
    Container(web, "Web app", "Next.js", "Receives orders")
    ContainerDb(db, "Database", "PostgreSQL")
  }
  Rel(customer, web, "Uses", "HTTPS")
  Rel(web, db, "Reads")
`;

describe('C4 source mutations', () => {
  it('keeps the supported subset accepted by Mermaid 11.16.1', async () => {
    mermaid.initialize({ startOnLoad: false });
    await expect(mermaid.parse(SOURCE)).resolves.toMatchObject({ diagramType: 'c4' });
  });

  it('models the strict C4 context/container/component subset without taking ownership of comments or frontmatter', () => {
    expect(getC4DiagramSnapshot(SOURCE)).toEqual({
      kind: 'C4Container',
      boundaries: [{ id: 'shop', kind: 'System_Boundary', label: 'Shop' }],
      elements: [
        { id: 'customer', kind: 'Person', label: 'Customer', description: 'Places orders' },
        { id: 'web', kind: 'Container', label: 'Web app', parentId: 'shop', technology: 'Next.js', description: 'Receives orders' },
        { id: 'db', kind: 'ContainerDb', label: 'Database', parentId: 'shop', technology: 'PostgreSQL' },
      ],
      relationships: [
        { from: 'customer', to: 'web', label: 'Uses', technology: 'HTTPS' },
        { from: 'web', to: 'db', label: 'Reads' },
      ],
    });
  });

  it('uses exact source records for element and relationship changes', () => {
    const withQueue = addC4Element(SOURCE, { id: 'web', kind: 'Container', label: 'Queue', technology: 'SQS' });
    expect(withQueue).toContain('Container(web2, "Queue", "SQS")');
    const rel = addC4Relationship(withQueue, { from: 'web2', to: 'db', label: 'Publishes' });
    const renamed = editC4Element(rel, 'web2', { id: 'queue', label: 'Events' });
    expect(renamed).toContain('Container(queue, "Events", "SQS")');
    expect(renamed).toContain('Rel(queue, db, "Publishes")');
    const relationships = getC4DiagramSnapshot(renamed).relationships;
    const changed = editC4Relationship(renamed, getC4RelationshipIdentity(relationships[2]!, 2, relationships), { label: 'Stores' });
    expect(changed).toContain('Rel(queue, db, "Stores")');
    const withoutRelationship = deleteC4Relationship(changed, getC4RelationshipIdentity(getC4DiagramSnapshot(changed).relationships[2]!, 2, getC4DiagramSnapshot(changed).relationships));
    expect(withoutRelationship).not.toContain('queue, db');
    expect(deleteC4Element(withoutRelationship, 'queue')).not.toContain('Container(queue');
    expect(withoutRelationship).toContain('%% the source model leaves this comment alone');
  });

  it('preserves C4 boundary ownership as an explicit bounded source record', () => {
    const added = addC4Boundary(SOURCE, { id: 'shop', kind: 'Container_Boundary', label: 'Checkout' });
    expect(added).toContain('Container_Boundary(shop2, "Checkout") {');
    const renamed = editC4Boundary(added, 'shop2', { id: 'checkout', label: 'Checkout area' });
    expect(renamed).toContain('Container_Boundary(checkout, "Checkout area") {');
    expect(deleteC4Boundary(renamed, 'checkout')).not.toContain('checkout');
  });

  it('models and writes explicit boundary containment without rewriting surrounding source', () => {
    const nested = `C4Context
  Boundary(zone, "Zone") {
    Person(user, "User")
  }`;
    expect(getC4DiagramSnapshot(nested).elements[0]).toMatchObject({ id: 'user', parentId: 'zone' });
    const added = addC4Element(nested, { id: 'app', kind: 'System', label: 'App', parentId: 'zone' });
    expect(added).toContain('  System(app, "App")\n  }');
  });

  it('moves C4 elements and bounded boundary ranges without allowing cyclic containment', () => {
    const source = `C4Context
  Boundary(zone, "Zone") {
    Boundary(team, "Team") {
      Person(user, "User")
    }
  }
  System(app, "App")`;
    const movedElement = moveC4Element(source, 'app', 'team');
    expect(movedElement).toContain('      System(app, "App")');
    const movedBoundary = moveC4Boundary(movedElement, 'team', null);
    expect(movedBoundary).toContain('  Boundary(team, "Team") {');
    expect(() => moveC4Boundary(source, 'zone', 'team')).toThrow('cannot contain itself');
  });

  it('moves CR-only boundary ranges without normalizing line endings or adding a blank line', () => {
    const source = 'C4Context\r  Boundary(zone, "Zone") {\r  }\r  Boundary(team, "Team") {\r    Person(user, "User")\r  }\r';
    expect(moveC4Boundary(source, 'team', 'zone')).toBe('C4Context\r  Boundary(zone, "Zone") {\r    Boundary(team, "Team") {\r      Person(user, "User")\r    }\r  }\r');
  });

  it('re-resolves a unique semantic fingerprint after a remote insertion and rejects stale ambiguity', () => {
    const identity = getC4RelationshipIdentity(getC4DiagramSnapshot(SOURCE).relationships[1]!, 1, getC4DiagramSnapshot(SOURCE).relationships);
    const inserted = SOURCE.replace('  Rel(web, db, "Reads")', '  Rel(db, web, "Returns")\n  Rel(web, db, "Reads")');
    expect(editC4Relationship(inserted, identity, { label: 'Writes' })).toContain('Rel(web, db, "Writes")');
    const duplicate = SOURCE.replace('  Rel(web, db, "Reads")', '  Rel(web, db, "Reads")\n  Rel(web, db, "Reads")');
    expect(isC4SourceRepresentable(duplicate)).toBe(true);
    expect(() => deleteC4Relationship(duplicate, identity)).toThrow('resolved safely');
  });

  it('fails closed for Mermaid features whose semantic ownership is not implemented', () => {
    expect(isC4SourceRepresentable('C4Dynamic\n  Person(a, "A")')).toBe(false);
    expect(isC4SourceRepresentable('C4Context\n  Person(a, "A")\n  System(b, "B")\n  RelIndex(1, a, b, "Calls")')).toBe(false);
    expect(isC4SourceRepresentable('C4Context\n  Person(a, "A")\n  System(b, "B")\n  BiRel(a, b, "Calls")')).toBe(false);
    expect(isC4SourceRepresentable('C4Context\n  Person(a, "A", $sprite="person")')).toBe(false);
    expect(isC4SourceRepresentable('C4Context\n  Person(a, "A")\n  UpdateElementStyle(a, $bgColor="red")')).toBe(false);
    expect(() => addC4Element(SOURCE, { id: 'bad id', kind: 'System', label: 'Bad' })).toThrow('identifiers');
  });
});
