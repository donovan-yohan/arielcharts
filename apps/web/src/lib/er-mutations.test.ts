import { describe, expect, it } from 'vitest';
import {
  addErAttribute,
  addErEntity,
  addErRelationship,
  deleteErEntity,
  editErAttribute,
  editErRelationship,
  getErDiagramSnapshot,
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

describe('ER source mutations', () => {
  it('parses a strict editable ER subset with attributes, markers, comments, and both relationship endpoints', () => {
    expect(getErDiagramSnapshot(SOURCE)).toEqual({
      entities: [
        { name: 'CUSTOMER', attributes: [{ type: 'int', name: 'id', keys: ['PK'], comment: 'stable key' }, { type: 'string', name: 'email', keys: ['UK'] }] },
        { name: 'ORDER', attributes: [{ type: 'int', name: 'id', keys: ['PK'] }, { type: 'int', name: 'customer_id', keys: ['FK'] }] },
      ],
      relationships: [{ left: 'CUSTOMER', leftCardinality: '||', identifying: true, rightCardinality: 'o{', right: 'ORDER', label: 'places' }],
    });
  });

  it('uses minimal source-local transforms while preserving frontmatter, directives, comments, and endings', () => {
    const renamed = renameErEntity(SOURCE, 'CUSTOMER', 'ACCOUNT');
    expect(renamed).toContain('  ACCOUNT {');
    expect(renamed).toContain('  ACCOUNT ||--o{ ORDER : places');
    expect(renamed).toContain('%% preserve this unrelated comment');

    const attributeEdited = editErAttribute(renamed, 'ACCOUNT', 'email', { type: 'varchar', name: 'primary_email', keys: ['PK', 'UK'], comment: 'canonical' });
    expect(attributeEdited).toContain('    varchar primary_email PK, UK "canonical"');
    expect(attributeEdited).toContain('    int id PK "stable key"');

    const relationshipEdited = editErRelationship(attributeEdited, 0, {
      left: 'ACCOUNT', leftCardinality: '|o', identifying: false, rightCardinality: '|{', right: 'ORDER', label: 'may place',
    });
    expect(relationshipEdited).toContain('  ACCOUNT |o..|{ ORDER : may place');
  });

  it('creates, reorders, and removes declarations while updating dependent relationships', () => {
    const withEntity = addErEntity(SOURCE, 'INVOICE');
    const withAttribute = addErAttribute(withEntity, 'INVOICE', { type: 'uuid', name: 'id', keys: ['PK'] });
    const withRelationship = addErRelationship(withAttribute, {
      left: 'ORDER', leftCardinality: '||', identifying: false, rightCardinality: 'o{', right: 'INVOICE', label: 'creates',
    });
    expect(moveErEntity(withRelationship, 'INVOICE', 'up')).toContain('  INVOICE {');
    expect(moveErAttribute(withRelationship, 'ORDER', 'customer_id', 'up')).toContain('    int customer_id FK\n    int id PK');
    const deleted = deleteErEntity(withRelationship, 'ORDER');
    expect(deleted).not.toContain('ORDER {');
    expect(deleted).not.toContain(': places');
    expect(deleted).not.toContain(': creates');
  });

  it('fails closed for valid Mermaid ER syntax the source model cannot faithfully mutate', () => {
    expect(isErSourceRepresentable('erDiagram\n  CUSTOMER ||--o{ ORDER : places')).toBe(true);
    expect(isErSourceRepresentable('erDiagram\n  CUSTOMER ||--o{ ORDER')).toBe(false);
    expect(isErSourceRepresentable('erDiagram\n  CUSTOMER {\n    string name "comment with unsupported \\" quote"\n  }')).toBe(false);
    expect(isErSourceRepresentable('erDiagram\n  CUSTOMER {\n    string name\n  }\n  direction LR')).toBe(false);
  });
});
