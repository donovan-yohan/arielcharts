// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addClass,
  addClassAnnotation,
  addClassMember,
  addClassRelationship,
  deleteClass,
  deleteClassAnnotation,
  deleteClassMember,
  deleteClassRelationship,
  editClass,
  editClassMember,
  editClassRelationship,
  getClassDiagramSnapshot,
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
    const next = editClassRelationship(source, 0, { from: 'Animal', relation: '<|--', to: 'Duck', label: 'extends' });
    expect(next).toContain('Animal <|-- Duck : extends\r\n');
    expect(next).toContain('%% keep me');
    expect(editClassMember(next, 'Animal', 1, { visibility: '+', name: 'speak', signature: '', returnType: 'void' }))
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
    await expectValid(deleteClassMember(renamed, 'Bird', 0));
    await expectValid(deleteClassRelationship(renamed, 1));
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
});
