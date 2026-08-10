// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addRequirement,
  addRequirementRelationship,
  deleteRequirement,
  deleteRequirementRelationship,
  editRequirement,
  editRequirementRelationship,
  getRequirementDiagramSnapshot,
  getRequirementRelationshipIdentity,
  isRequirementSourceRepresentable,
} from './requirement-mutations';

const SOURCE = `%% preserve this comment
requirementDiagram
  requirement order {
    id: 1
    text: "order is accepted"
    risk: low
    verifyMethod: test
  }
  element checkout {
    type: service
  }
  order - satisfies -> checkout
`;

describe('requirement source mutations', () => {
  it('models strict requirement fields and typed relations', () => {
    expect(getRequirementDiagramSnapshot(SOURCE)).toEqual({
      entities: [
        { name: 'order', kind: 'requirement', fields: { id: '1', text: 'order is accepted', risk: 'low', verifyMethod: 'test' } },
        { name: 'checkout', kind: 'element', fields: { type: 'service' } },
      ],
      relationships: [{ from: 'order', kind: 'satisfies', to: 'checkout' }],
    });
  });

  it('creates, edits, deletes entities and relationships source-safely', async () => {
    mermaid.initialize({ startOnLoad: false });
    const added = addRequirement(SOURCE, { name: 'speed', kind: 'performanceRequirement', fields: { id: '2', text: 'fast', risk: 'medium', verifyMethod: 'test' } });
    await expect(mermaid.parse(added)).resolves.toMatchObject({ diagramType: 'requirement' });
    expect(added).toContain('text: "fast"');
    const relation = addRequirementRelationship(added, { from: 'speed', kind: 'traces', to: 'checkout' });
    await expect(mermaid.parse(relation)).resolves.toMatchObject({ diagramType: 'requirement' });
    const renamed = editRequirement(relation, 'speed', { name: 'latency', fields: { id: '2', text: 'low latency', risk: 'low', verifyMethod: 'analysis' } });
    await expect(mermaid.parse(renamed)).resolves.toMatchObject({ diagramType: 'requirement' });
    expect(renamed).toContain('latency - traces -> checkout');
    const relationships = getRequirementDiagramSnapshot(renamed).relationships;
    const changed = editRequirementRelationship(renamed, getRequirementRelationshipIdentity(relationships[1]!, 1, relationships), { from: 'latency', kind: 'verifies', to: 'checkout' });
    await expect(mermaid.parse(changed)).resolves.toMatchObject({ diagramType: 'requirement' });
    expect(changed).toContain('latency - verifies -> checkout');
    const changedRelationships = getRequirementDiagramSnapshot(changed).relationships;
    const withoutRelation = deleteRequirementRelationship(changed, getRequirementRelationshipIdentity(changedRelationships[1]!, 1, changedRelationships));
    await expect(mermaid.parse(withoutRelation)).resolves.toMatchObject({ diagramType: 'requirement' });
    const deleted = deleteRequirement(withoutRelation, 'latency');
    await expect(mermaid.parse(deleted)).resolves.toMatchObject({ diagramType: 'requirement' });
    expect(deleted).not.toContain('latency');
    expect(deleted).toContain('%% preserve this comment');
  });

  it('fails closed for incomplete fields and unmodeled syntax', () => {
    expect(isRequirementSourceRepresentable('requirementDiagram\n  requirement req {\n    id: 1\n  }')).toBe(false);
    expect(isRequirementSourceRepresentable('requirementDiagram\n  requirement req {\n    id: REQ-1\n    text: "one"\n    risk: low\n    verifyMethod: test\n  }')).toBe(false);
    expect(isRequirementSourceRepresentable('requirementDiagram\n  requirement req {\n    id: 1\n    text: "one"\n    risk: urgent\n    verifyMethod: test\n  }')).toBe(false);
    expect(isRequirementSourceRepresentable('requirementDiagram\n  requirement req {\n    id: 1\n    text: "one"\n    risk: low\n    verifyMethod: deploy\n  }')).toBe(false);
    expect(isRequirementSourceRepresentable('requirementDiagram\n  requirement req {\n    id: 1\n    text: one\n    risk: low\n    verifyMethod: test\n  }\n  req <- satisfies - other')).toBe(false);
  });

  it('canonicalizes Mermaid-accepted declaration kinds and resolves relationships safely', async () => {
    mermaid.initialize({ startOnLoad: false });
    const upper = SOURCE.replace('  requirement order {', '  REQUIREMENT order {').replace('  element checkout {', '  ELEMENT checkout {').replace('  order - satisfies -> checkout', '  order - SATISFIES -> checkout');
    await expect(mermaid.parse(upper)).resolves.toMatchObject({ diagramType: 'requirement' });
    expect(getRequirementDiagramSnapshot(upper).entities.map((entity) => entity.kind)).toEqual(['requirement', 'element']);
    const relationships = getRequirementDiagramSnapshot(SOURCE).relationships;
    const identity = getRequirementRelationshipIdentity(relationships[0]!, 0, relationships);
    const inserted = SOURCE.replace('  order - satisfies -> checkout', '  checkout - traces -> order\n  order - satisfies -> checkout');
    expect(editRequirementRelationship(inserted, identity, { from: 'order', kind: 'verifies', to: 'checkout' })).toContain('order - verifies -> checkout');
    const ambiguous = SOURCE.replace('  order - satisfies -> checkout', '  order - satisfies -> checkout\n  order - satisfies -> checkout');
    expect(() => deleteRequirementRelationship(ambiguous, identity)).toThrow('resolved safely');
  });
});
