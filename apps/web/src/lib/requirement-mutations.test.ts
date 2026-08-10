import { describe, expect, it } from 'vitest';
import {
  addRequirement,
  addRequirementRelationship,
  deleteRequirement,
  deleteRequirementRelationship,
  editRequirement,
  editRequirementRelationship,
  getRequirementDiagramSnapshot,
  isRequirementSourceRepresentable,
} from './requirement-mutations';

const SOURCE = `%% preserve this comment
requirementDiagram
  requirement order {
    id: ORD-1
    text: order is accepted
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
        { name: 'order', kind: 'requirement', fields: { id: 'ORD-1', text: 'order is accepted', risk: 'low', verifyMethod: 'test' } },
        { name: 'checkout', kind: 'element', fields: { type: 'service' } },
      ],
      relationships: [{ from: 'order', kind: 'satisfies', to: 'checkout' }],
    });
  });

  it('creates, edits, deletes entities and relationships source-safely', () => {
    const added = addRequirement(SOURCE, { name: 'speed', kind: 'performanceRequirement', fields: { id: 'PERF-1', text: 'fast', risk: 'medium', verifyMethod: 'test' } });
    const relation = addRequirementRelationship(added, { from: 'speed', kind: 'traces', to: 'checkout' });
    const renamed = editRequirement(relation, 'speed', { name: 'latency', fields: { id: 'PERF-1', text: 'low latency', risk: 'low', verifyMethod: 'analysis' } });
    expect(renamed).toContain('latency - traces -> checkout');
    const changed = editRequirementRelationship(renamed, 1, { from: 'latency', kind: 'verifies', to: 'checkout' });
    expect(changed).toContain('latency - verifies -> checkout');
    const withoutRelation = deleteRequirementRelationship(changed, 1);
    const deleted = deleteRequirement(withoutRelation, 'latency');
    expect(deleted).not.toContain('latency');
    expect(deleted).toContain('%% preserve this comment');
  });

  it('fails closed for incomplete fields and unmodeled syntax', () => {
    expect(isRequirementSourceRepresentable('requirementDiagram\n  requirement req {\n    id: 1\n  }')).toBe(false);
    expect(isRequirementSourceRepresentable('requirementDiagram\n  requirement req {\n    id: 1\n    text: one\n    risk: low\n    verifyMethod: test\n  }\n  req <- satisfies - other')).toBe(false);
  });
});
