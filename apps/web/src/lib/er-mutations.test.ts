// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addErAttribute,
  addErEntity,
  addErRelationship,
  deleteErAttribute,
  deleteErEntity,
  deleteErRelationship,
  editErAttribute,
  editErRelationship,
  getErDiagramSnapshot,
  getErRelationshipIdentity,
  isErSourceRepresentable,
  moveErAttribute,
  moveErEntity,
  renameErEntity,
} from './er-mutations';

const SOURCE = `---
config:
  theme: neutral
---
%% keep this directive-shaped comment
erDiagram
  CUSTOMER {
    int id PK "stable key"
    string email UK
  }
  ORDER {
    int id PK
    int customer_id FK
  }
  CUSTOMER ||--o{ ORDER : places
%% preserve this unrelated comment
`;

async function expectValidMutation(source: string): Promise<void> {
  expect(isErSourceRepresentable(source)).toBe(true);
  await expect(mermaid.parse(source)).resolves.toMatchObject({ diagramType: 'er' });
}

describe('ER source mutations', () => {
  it('parses a strict editable ER subset with semantic endpoint cardinalities', () => {
    expect(getErDiagramSnapshot(SOURCE)).toEqual({
      entities: [
        { name: 'CUSTOMER', attributes: [{ type: 'int', name: 'id', keys: ['PK'], comment: 'stable key' }, { type: 'string', name: 'email', keys: ['UK'] }] },
        { name: 'ORDER', attributes: [{ type: 'int', name: 'id', keys: ['PK'] }, { type: 'int', name: 'customer_id', keys: ['FK'] }] },
      ],
      relationships: [{ left: 'CUSTOMER', leftCardinality: 'exactly-one', identifying: true, rightCardinality: 'zero-or-more', right: 'ORDER', label: 'places' }],
    });
  });

  it('keeps inline comments, backslashes, directives, CRLF, and trailing whitespace outside semantic replacements', () => {
    const source = [
      "%%{init: {'theme':'neutral'}}%%",
      'erDiagram',
      '  CUSTOMER {',
      '    string path UK "C:\\\\temp"   %% attribute note  ',
      '  }',
      '  ORDER {',
      '    int id PK',
      '  }',
      '  CUSTOMER ||--o{ ORDER : places   %% relationship note  ',
      '',
    ].join('\r\n');
    const attributeEdited = editErAttribute(source, 'CUSTOMER', 'path', { type: 'string', name: 'location', keys: ['UK'], comment: 'D:\\archive' });
    expect(attributeEdited).toBe([
      "%%{init: {'theme':'neutral'}}%%",
      'erDiagram',
      '  CUSTOMER {',
      '    string location UK "D:\\\\archive"   %% attribute note  ',
      '  }',
      '  ORDER {',
      '    int id PK',
      '  }',
      '  CUSTOMER ||--o{ ORDER : places   %% relationship note  ',
      '',
    ].join('\r\n'));
    const identity = getErRelationshipIdentity(getErDiagramSnapshot(attributeEdited).relationships[0]!, 0);
    const relationshipEdited = editErRelationship(attributeEdited, identity, {
      left: 'CUSTOMER', leftCardinality: 'zero-or-one', identifying: false, rightCardinality: 'one-or-more', right: 'ORDER', label: 'may place',
    });
    expect(relationshipEdited).toBe([
      "%%{init: {'theme':'neutral'}}%%",
      'erDiagram',
      '  CUSTOMER {',
      '    string location UK "D:\\\\archive"   %% attribute note  ',
      '  }',
      '  ORDER {',
      '    int id PK',
      '  }',
      '  CUSTOMER |o..|{ ORDER : may place   %% relationship note  ',
      '',
    ].join('\r\n'));
  });

  it('generates only Mermaid-valid and representable source for every mutation', async () => {
    mermaid.initialize({ startOnLoad: false });
    const withEntity = addErEntity(SOURCE, 'INVOICE');
    await expectValidMutation(withEntity);
    const withAttribute = addErAttribute(withEntity, 'INVOICE', { type: 'uuid', name: 'id', keys: ['PK'] });
    await expectValidMutation(withAttribute);
    const withUniqueAttribute = addErAttribute(withAttribute, 'INVOICE', { type: 'uuid', name: 'id', keys: ['PK'] });
    expect(withUniqueAttribute).toContain('uuid id_2 PK');
    await expectValidMutation(withUniqueAttribute);
    const withRelationship = addErRelationship(withUniqueAttribute, {
      left: 'ORDER', leftCardinality: 'exactly-one', identifying: false, rightCardinality: 'zero-or-more', right: 'INVOICE', label: 'creates',
    });
    await expectValidMutation(withRelationship);
    const editedAttribute = editErAttribute(withRelationship, 'INVOICE', 'id', { type: 'uuid', name: 'invoice_id', keys: ['PK'], comment: 'stable' });
    await expectValidMutation(editedAttribute);
    const identity = getErRelationshipIdentity(getErDiagramSnapshot(editedAttribute).relationships[1]!, 1);
    const editedRelationship = editErRelationship(editedAttribute, identity, {
      left: 'ORDER', leftCardinality: 'zero-or-one', identifying: false, rightCardinality: 'one-or-more', right: 'INVOICE', label: 'may create',
    });
    await expectValidMutation(editedRelationship);
    await expectValidMutation(moveErEntity(editedRelationship, 'INVOICE', 'up'));
    await expectValidMutation(moveErAttribute(editedRelationship, 'ORDER', 'customer_id', 'up'));
    await expectValidMutation(renameErEntity(editedRelationship, 'INVOICE', 'BILL'));
    await expectValidMutation(deleteErAttribute(editedRelationship, 'INVOICE', 'id_2'));
    await expectValidMutation(deleteErRelationship(editedRelationship, getErRelationshipIdentity(getErDiagramSnapshot(editedRelationship).relationships[1]!, 1)));
    await expectValidMutation(deleteErEntity(editedRelationship, 'ORDER'));
  });

  it('re-resolves a relationship after remote insertion or deletion and rejects ambiguous identity', () => {
    const inserted = SOURCE.replace('  CUSTOMER ||--o{ ORDER : places', '  ORDER ||--o{ CUSTOMER : returns\n  CUSTOMER ||--o{ ORDER : places');
    const target = getErRelationshipIdentity(getErDiagramSnapshot(inserted).relationships[1]!, 1);
    const edited = editErRelationship(inserted, target, {
      left: 'CUSTOMER', leftCardinality: 'exactly-one', identifying: false, rightCardinality: 'zero-or-more', right: 'ORDER', label: 'may place',
    });
    expect(edited).toContain('CUSTOMER ||..o{ ORDER : may place');
    const afterRemoteDeletion = edited.replace('  ORDER ||--o{ CUSTOMER : returns\n', '');
    const movedIdentity = getErRelationshipIdentity(getErDiagramSnapshot(edited).relationships[1]!, 1);
    expect(deleteErRelationship(afterRemoteDeletion, movedIdentity)).not.toContain('may place');

    const duplicate = `${SOURCE}  CUSTOMER ||--o{ ORDER : places\n`;
    expect(isErSourceRepresentable(duplicate)).toBe(false);
    expect(() => addErRelationship(SOURCE, target)).toThrow('identical relationship');

    const changedDuplicate = duplicate.replace(/CUSTOMER \|\|--o\{ ORDER : places\n$/u, 'CUSTOMER ||--o{ ORDER : changed\n');
    const staleDuplicateIdentity = getErRelationshipIdentity(target, 1, 2);
    expect(isErSourceRepresentable(changedDuplicate)).toBe(true);
    expect(() => editErRelationship(changedDuplicate, staleDuplicateIdentity, { ...target, label: 'wrong target' }))
      .toThrow('can no longer be resolved safely');
    expect(changedDuplicate).toContain('CUSTOMER ||--o{ ORDER : places');
  });

  it('fails closed for unmodeled endpoint declarations and unsupported valid syntax', () => {
    expect(isErSourceRepresentable('erDiagram\n  CUSTOMER ||--o{ ORDER : places')).toBe(false);
    expect(isErSourceRepresentable('erDiagram\n  CUSTOMER {\n    string[] tags\n  }')).toBe(false);
    expect(isErSourceRepresentable('erDiagram\n  CUSTOMER {\n    string name\n  }\n  direction LR')).toBe(false);
    expect(() => addErRelationship(SOURCE, { left: 'CUSTOMER', leftCardinality: 'exactly-one', identifying: true, rightCardinality: 'zero-or-more', right: 'ORDER', label: 'bad: label' })).toThrow('Mermaid-safe');
  });
});
