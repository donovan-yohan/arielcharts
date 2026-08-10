// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addClass,
  addClassAnnotation,
  addClassMember,
  addClassRelationship,
  CLASS_RELATION_OPTIONS,
  deleteClass,
  deleteClassAnnotation,
  deleteClassMember,
  deleteClassRelationship,
  editClass,
  editClassMember,
  editClassRelationship,
  getClassDiagramSnapshot,
  getClassMemberIdentity,
  getClassRelationshipIdentity,
  isClassSourceRepresentable,
} from './class-mutations';

const SOURCE = `---
config:
  theme: neutral
---
%% preserve this comment
classDiagram
  class Animal {
    +String name
    +makeSound() String
  }
  class Duck
  <<Interface>> Duck
  Animal <|-- Duck : inherits
`;

async function expectValid(source: string): Promise<void> {
  expect(isClassSourceRepresentable(source)).toBe(true);
  await expect(mermaid.parse(source)).resolves.toMatchObject({ diagramType: 'class' });
}

describe('class source mutations', () => {
  it('strictly snapshots classes, members, annotations, and relationships', () => {
    expect(getClassDiagramSnapshot(SOURCE)).toEqual({
      classes: [
        { name: 'Animal', annotations: [], members: [{ visibility: '+', type: 'String', name: 'name' }, { visibility: '+', name: 'makeSound', signature: '', returnType: 'String' }] },
        { name: 'Duck', annotations: ['Interface'], members: [] },
      ],
      relationships: [{ from: 'Animal', relation: '<|--', to: 'Duck', label: 'inherits' }],
    });
  });

  it('keeps comments and CRLF bytes outside semantic changes', () => {
    const source = SOURCE.replace(/\n/g, '\r\n').replace('  Animal <|-- Duck : inherits', '  %% keep me\r\n  Animal <|-- Duck : inherits');
    const relationships = getClassDiagramSnapshot(source).relationships;
    const next = editClassRelationship(source, getClassRelationshipIdentity(relationships[0]!, 0, relationships), { from: 'Animal', relation: '<|--', to: 'Duck', label: 'extends' });
    expect(next).toContain('Animal <|-- Duck : extends\r\n');
    expect(next).toContain('%% keep me');
    const members = getClassDiagramSnapshot(next).classes[0]!.members;
    expect(editClassMember(next, 'Animal', getClassMemberIdentity('Animal', members[1]!, 1, members), { visibility: '+', name: 'speak', signature: '', returnType: 'void' }))
      .toContain('+speak() void');
  });

  it('emits only valid, representable source for supported mutations', async () => {
    mermaid.initialize({ startOnLoad: false });
    const added = addClass(SOURCE, 'Mallard', 'A mallard');
    await expectValid(added);
    const member = addClassMember(added, 'Mallard', { visibility: '+', name: 'swim', signature: '', returnType: 'void' });
    await expectValid(member);
    const annotation = addClassAnnotation(member, 'Mallard', 'Service');
    await expectValid(annotation);
    const relationship = addClassRelationship(annotation, { from: 'Duck', relation: '-->', to: 'Mallard', label: 'uses' });
    await expectValid(relationship);
    const renamed = editClass(relationship, 'Mallard', { name: 'Bird', label: 'Bird type' });
    await expectValid(renamed);
    await expectValid(deleteClassAnnotation(renamed, 'Bird', 'Service'));
    const bird = getClassDiagramSnapshot(renamed).classes.find((entry) => entry.name === 'Bird')!;
    await expectValid(deleteClassMember(renamed, 'Bird', getClassMemberIdentity('Bird', bird.members[0]!, 0, bird.members)));
    const relationships = getClassDiagramSnapshot(renamed).relationships;
    await expectValid(deleteClassRelationship(renamed, getClassRelationshipIdentity(relationships[1]!, 1, relationships)));
    const deleted = deleteClass(renamed, 'Bird');
    await expectValid(deleted);
    expect(deleted).not.toContain('Bird');
  });

  it('fails closed for valid Mermaid syntax outside the safe model', () => {
    expect(isClassSourceRepresentable('classDiagram\n  Animal : +String name')).toBe(false);
    expect(isClassSourceRepresentable('classDiagram\n  namespace Animals {\n    class Duck\n  }')).toBe(false);
    expect(isClassSourceRepresentable('classDiagram\n  class Animal\n  click Animal href "https://example.test"')).toBe(false);
    expect(() => addClassRelationship(SOURCE, { from: 'Animal', relation: '-->' as const, to: 'Missing' })).toThrow('existing classes');
  });

  it('exposes every parsed relation and re-resolves semantic identities safely', () => {
    expect(CLASS_RELATION_OPTIONS).toEqual(['<|--', '<|..', '*--', 'o--', '-->', '--*', '--o', '--|>', '..>', '..|>', '--', '..']);
    const allRelations = `classDiagram\n  class Animal\n  class Duck\n${CLASS_RELATION_OPTIONS.map((relation, index) => `  Animal ${relation} Duck : r${index}`).join('\n')}`;
    expect(getClassDiagramSnapshot(allRelations).relationships.map((relationship) => relationship.relation)).toEqual(CLASS_RELATION_OPTIONS);
    const initial = getClassDiagramSnapshot(SOURCE);
    const relationship = getClassRelationshipIdentity(initial.relationships[0]!, 0, initial.relationships);
    const withRemoteInsertion = SOURCE.replace('  Animal <|-- Duck : inherits', '  Duck --> Animal : uses\n  Animal <|-- Duck : inherits');
    expect(editClassRelationship(withRemoteInsertion, relationship, { from: 'Animal', relation: '<|--', to: 'Duck', label: 'extends' })).toContain('Animal <|-- Duck : extends');
    const animal = initial.classes[0]!;
    const member = getClassMemberIdentity('Animal', animal.members[1]!, 1, animal.members);
    const memberInsertion = SOURCE.replace('    +makeSound() String', '    +int age\n    +makeSound() String');
    expect(editClassMember(memberInsertion, 'Animal', member, { visibility: '+', name: 'speak', signature: '', returnType: 'void' })).toContain('+speak() void');
    const ambiguous = SOURCE.replace('  Animal <|-- Duck : inherits', '  Animal <|-- Duck : inherits\n  Animal <|-- Duck : inherits');
    expect(() => deleteClassRelationship(ambiguous, relationship)).toThrow('resolved safely');
  });
});
