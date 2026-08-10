// @vitest-environment happy-dom

import { describe, expect, it } from 'vitest';
import mermaid from 'mermaid';
import {
  EXTERNAL_MERMAID_PLUGIN_FAMILIES,
  MERMAID_CAPABILITY_CATALOG_VERSION,
  MERMAID_DIAGRAM_FAMILIES,
  classifyDiagramCapability,
  getDiagramCapabilityLabel,
  getDiagramSourceModelAdapter,
  isStructurallyEditableDiagram,
} from './diagram-capabilities';
import {
  HEADER_ONLY_DETECTION_ONLY_FAMILIES,
  MERMAID_CAPABILITY_FIXTURE_VERSION,
  MERMAID_CAPABILITY_FIXTURES,
} from './diagram-capabilities.fixtures';

const MERMAID_11_16_1_PARSER_TYPES = [
  'architecture', 'block', 'c4', 'class', 'classDiagram', 'cynefin', 'er', 'eventmodeling',
  'flowchart', 'flowchart-elk', 'flowchart-v2', 'gantt', 'gitGraph', 'ishikawa', 'journey',
  'kanban', 'mindmap', 'packet', 'pie', 'quadrantChart', 'radar', 'railroad', 'railroadAbnf',
  'railroadEbnf', 'railroadPeg', 'requirement', 'sankey', 'sequence', 'state', 'stateDiagram',
  'swimlane', 'timeline', 'treeView', 'treemap', 'venn', 'wardley', 'xychart',
].sort();

describe('diagram capability catalog', () => {
  it('pins the complete Mermaid 11.16.1 visual detector matrix to 30 canonical families', async () => {
    mermaid.initialize({ startOnLoad: false });
    expect(MERMAID_CAPABILITY_CATALOG_VERSION).toBe('11.16.1');
    expect(MERMAID_CAPABILITY_FIXTURE_VERSION).toBe(MERMAID_CAPABILITY_CATALOG_VERSION);
    expect(MERMAID_DIAGRAM_FAMILIES).toHaveLength(30);
    expect(MERMAID_CAPABILITY_FIXTURES).toHaveLength(30);
    expect([...new Set(MERMAID_CAPABILITY_FIXTURES.map((fixture) => fixture.family))]).toHaveLength(30);
    expect(MERMAID_DIAGRAM_FAMILIES.flatMap((family) => family.parserTypes).sort()).toEqual(MERMAID_11_16_1_PARSER_TYPES);
    expect(MERMAID_CAPABILITY_FIXTURES.flatMap((fixture) => fixture.parserTypes).sort()).toEqual(MERMAID_11_16_1_PARSER_TYPES);
    const headerOnlyDetectionOnlyFamilies = new Set(HEADER_ONLY_DETECTION_ONLY_FAMILIES);
    for (const fixture of MERMAID_CAPABILITY_FIXTURES) {
      expect(fixture.validSource.trim()).not.toBe('');
      expect(fixture.advancedSource).not.toBe(fixture.validSource);
      expect(fixture.invalidSource).not.toBe(fixture.validSource);
      expect(classifyDiagramCapability(mermaid.detectType(fixture.validSource)).family).toBe(fixture.family);
      for (const [fixtureClass, source] of [['valid', fixture.validSource], ['advanced', fixture.advancedSource]] as const) {
        const result = await mermaid.parse(source);
        expect(classifyDiagramCapability(result.diagramType).family, `${fixture.family} ${fixtureClass}`).toBe(fixture.family);
      }
      for (const parserType of fixture.parserTypes) {
        expect(classifyDiagramCapability(parserType).family).toBe(fixture.family);
      }
      expect(classifyDiagramCapability(mermaid.detectType(fixture.headerOnlySource)).family).toBe(fixture.family);
      if (headerOnlyDetectionOnlyFamilies.has(fixture.family)) {
        await expect(mermaid.parse(fixture.headerOnlySource), `${fixture.family} header-only`).rejects.toThrow();
      } else {
        const result = await mermaid.parse(fixture.headerOnlySource);
        expect(classifyDiagramCapability(result.diagramType).family).toBe(fixture.family);
      }
      await expect(mermaid.parse(fixture.invalidSource), `${fixture.family} invalid`).rejects.toThrow();
    }
    const registeredDiagramIds = mermaid.getRegisteredDiagramsMetadata().map(({ id }) => id).sort();
    const nonVisualRegisteredIds = ['---', 'error', 'info'];
    expect(registeredDiagramIds.filter((id) => !nonVisualRegisteredIds.includes(id))).toEqual(MERMAID_11_16_1_PARSER_TYPES);
    expect(registeredDiagramIds).toHaveLength(MERMAID_11_16_1_PARSER_TYPES.length + nonVisualRegisteredIds.length);
  }, 15_000);

  it('collapses renderer variants and Railroad grammars without losing parser aliases', () => {
    expect(classifyDiagramCapability('flowchart-v2')).toMatchObject({ family: 'flowchart', kind: 'flowchart', editingMode: 'canvas' });
    expect(classifyDiagramCapability('flowchart-elk')).toMatchObject({ family: 'flowchart', kind: 'flowchart', editingMode: 'canvas' });
    expect(classifyDiagramCapability('classDiagram')).toMatchObject({ family: 'class', editingMode: 'semantic-form', adapter: 'class' });
    expect(classifyDiagramCapability('stateDiagram')).toMatchObject({ family: 'state', editingMode: 'semantic-form', adapter: 'state' });
    for (const parserType of ['railroad', 'railroadEbnf', 'railroadAbnf', 'railroadPeg']) {
      expect(classifyDiagramCapability(parserType)).toMatchObject({ family: 'railroad', editingMode: 'source-only' });
    }
  });

  it('keeps unknown and future parser types source-only while reserving ZenUML for plugin registration', () => {
    expect(classifyDiagramCapability('future-diagram-v9')).toMatchObject({ family: 'unknown', kind: 'generic', editingMode: 'source-only' });
    expect(classifyDiagramCapability('zenuml')).toMatchObject({ family: 'zenuml', kind: 'generic', editingMode: 'unavailable-plugin' });
    expect(EXTERNAL_MERMAID_PLUGIN_FAMILIES).toHaveLength(1);
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('zenuml'))).toBe('ZenUML · plugin unavailable');
  });

  it('fails closed when a family source cannot safely represent a semantic operation', async () => {
    mermaid.initialize({ startOnLoad: false });
    const flowchart = classifyDiagramCapability('flowchart-v2');
    const sequence = classifyDiagramCapability('sequence');
    const er = classifyDiagramCapability('er');
    const classDiagram = classifyDiagramCapability('classDiagram');
    const state = classifyDiagramCapability('state');
    const requirement = classifyDiagramCapability('requirement');
    const sourceOnly = classifyDiagramCapability('timeline');

    expect(getDiagramSourceModelAdapter(flowchart).getOperationResult('flowchart TD\n  A --> B', 'add-node')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(flowchart).getOperationResult('flowchart TD\n  A -->', 'add-node')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(sequence).getOperationResult('sequenceDiagram\n  A->>B: request', 'add-message')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(er).getOperationResult('erDiagram\n  A {\n    int id PK\n  }', 'add-attribute')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(er).getOperationResult('erDiagram\n  A ||--o{ B', 'add-relationship')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(classDiagram).getOperationResult('classDiagram\n  class A', 'add-class')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(state).getOperationResult('stateDiagram-v2\n  [*] --> Ready', 'add-transition')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(state).getOperationResult('stateDiagram-v2\n  state Parent {\n    [*] --> Child\n  }', 'add-state')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(requirement).getOperationResult('requirementDiagram\n  requirement req {\n    id: 1\n    text: Example\n    risk: low\n    verifyMethod: test\n  }', 'add-requirement')).toEqual({ supported: true });
    const noteOnlySequence = 'sequenceDiagram\n  Note over A: details';
    await expect(mermaid.parse(noteOnlySequence)).resolves.toMatchObject({ diagramType: 'sequence' });
    expect(getDiagramSourceModelAdapter(sequence).getOperationResult(noteOnlySequence, 'add-message')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(sourceOnly).getOperationResult('timeline\n  2026 : Started', 'add-event')).toEqual({ supported: false, reason: 'source-only' });
  });

  it('exposes the existing canvas and semantic-form controls through the adapter contract', () => {
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('flowchart-v2'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('sequence'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('er'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('classDiagram'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('state'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('requirement'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('timeline'))).toBe(false);
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('flowchart-v2'))).toBe('Flowchart · editable · canvas');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('sequence'))).toBe('Sequence · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('er'))).toBe('Entity relationship · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('classDiagram'))).toBe('Class · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('state'))).toBe('State · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('requirement'))).toBe('Requirement · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('timeline'))).toBe('Timeline · source only');
  });

  it('labels a current unrepresentable structural source as source-only', () => {
    const sequence = classifyDiagramCapability('sequence');
    const flowchart = classifyDiagramCapability('flowchart-v2');
    const er = classifyDiagramCapability('er');
    const state = classifyDiagramCapability('state');

    expect(getDiagramCapabilityLabel(sequence, 'sequenceDiagram\nparticipant "Web browser" as Browser')).toBe('Sequence · source only');
    expect(getDiagramCapabilityLabel(sequence, 'sequenceDiagram\nA->>B: request')).toBe('Sequence · editable · form');
    expect(getDiagramCapabilityLabel(flowchart, 'flowchart TD\nA-->')).toBe('Flowchart · source only');
    expect(getDiagramCapabilityLabel(er, 'erDiagram\nA ||--o{ B')).toBe('Entity relationship · source only');
    expect(getDiagramCapabilityLabel(state, 'stateDiagram-v2\n  state Parent {\n    [*] --> Child\n  }')).toBe('State · source only');
    expect(getDiagramCapabilityLabel(null, 'sequenceDiagram\nA->>B: request')).toBe('Mermaid · source only');
  });
});
