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
      expect(classifyDiagramCapability(parserType)).toMatchObject({ family: 'railroad', editingMode: 'semantic-form', adapter: 'railroad' });
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
    const architecture = classifyDiagramCapability('architecture');
    const c4 = classifyDiagramCapability('c4');
    const block = classifyDiagramCapability('block');
    const swimlane = classifyDiagramCapability('swimlane');
    const journey = classifyDiagramCapability('journey');
    const gantt = classifyDiagramCapability('gantt');
    const timeline = classifyDiagramCapability('timeline');
    const gitgraph = classifyDiagramCapability('gitGraph');
    const eventModeling = classifyDiagramCapability('eventmodeling');
    const kanban = classifyDiagramCapability('kanban');
    const mindmap = classifyDiagramCapability('mindmap');
    const treeView = classifyDiagramCapability('treeView');
    const ishikawa = classifyDiagramCapability('ishikawa');
    const railroad = classifyDiagramCapability('railroad');
    const pie = classifyDiagramCapability('pie');
    const quadrant = classifyDiagramCapability('quadrantChart');
    const xyChart = classifyDiagramCapability('xychart');
    const radar = classifyDiagramCapability('radar');
    const sankey = classifyDiagramCapability('sankey');
    const packet = classifyDiagramCapability('packet');
    const cynefin = classifyDiagramCapability('cynefin');
    const treemap = classifyDiagramCapability('treemap');
    const venn = classifyDiagramCapability('venn');
    const wardley = classifyDiagramCapability('wardley');

    expect(treemap).toMatchObject({ adapter: 'treemap', diagramType: 'treemap', editingMode: 'semantic-form', kind: 'generic' });
    expect(venn).toMatchObject({ adapter: 'venn', diagramType: 'venn', editingMode: 'semantic-form', kind: 'generic' });
    expect(wardley).toMatchObject({ adapter: 'wardley', diagramType: 'wardley', editingMode: 'semantic-form', kind: 'generic' });

    expect(getDiagramSourceModelAdapter(flowchart).getOperationResult('flowchart TD\n  A --> B', 'add-node')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(flowchart).getOperationResult('flowchart TD\n  A -->', 'add-node')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(sequence).getOperationResult('sequenceDiagram\n  A->>B: request', 'add-message')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(er).getOperationResult('erDiagram\n  A {\n    int id PK\n  }', 'add-attribute')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(er).getOperationResult('erDiagram\n  A ||--o{ B', 'add-relationship')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(classDiagram).getOperationResult('classDiagram\n  class A', 'add-class')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(state).getOperationResult('stateDiagram-v2\n  [*] --> Ready', 'add-transition')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(state).getOperationResult('stateDiagram-v2\n  state Parent {\n    [*] --> Child\n  }', 'add-state')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(requirement).getOperationResult('requirementDiagram\n  requirement req {\n    id: 1\n    text: Example\n    risk: low\n    verifyMethod: test\n  }', 'add-requirement')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(architecture).getOperationResult('architecture-beta\n  service api(server)[API]', 'add-service')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(c4).getOperationResult('C4Context\n  Person(user, "User")', 'add-element')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(block).getOperationResult('block-beta\n  api', 'add-node')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(block).getOperationResult('block-beta\n  api', 'set-columns')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(swimlane).getOperationResult('swimlane-beta\n  subgraph api [API]\n  end', 'add-lane')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(journey).getOperationResult('journey\n  Task: 5: Alice', 'add-task')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(gantt).getOperationResult('gantt\n  dateFormat YYYY-MM-DD\n  Task : task, 2026-01-01, 1d', 'add-task')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(timeline).getOperationResult('timeline\n  2026 : Started', 'add-event')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(gitgraph).getOperationResult('gitGraph\n  commit id: "base"', 'add-branch')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(eventModeling).getOperationResult('eventmodeling\n  entity Order', 'add-timeframe')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(kanban).getOperationResult('kanban\n  todo[Todo]', 'add-card')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(mindmap).getOperationResult('mindmap\n  Root\n    Child', 'reparent-node')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(treeView).getOperationResult('treeView-beta\n  Root\n    child.txt', 'move-node')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(ishikawa).getOperationResult('ishikawa-beta\n  Effect\n  Cause', 'set-effect')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(railroad).getOperationResult('railroad-ebnf-beta\n  start = "x" ;', 'add-rule')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(pie).getOperationResult('pie showData\n  "A" : 1', 'add-slice')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(quadrant).getOperationResult('quadrantChart\n  A: [0.5, 0.5]', 'edit-point')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(xyChart).getOperationResult('xychart-beta\n  x-axis ["A", "B"]\n  y-axis 0 --> 3\n  line [1, 2]', 'edit-axis')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(radar).getOperationResult('radar-beta\n  axis a\n  axis b\n  axis c\n  curve one { 1, 2, 3 }', 'edit-options')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(sankey).getOperationResult('sankey-beta\nSource,Target,2.5', 'rename-node')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(packet).getOperationResult('packet-beta\n  0-7: "Header"\n  8-15: "Body"', 'move-field')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(cynefin).getOperationResult('cynefin-beta\n  complex\n    "Emergent"', 'move-item')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(cynefin).getOperationResult('cynefin-beta\n  complex --> complex', 'add-transition')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(cynefin).getOperationResult('cynefin-beta\n  complex\n    "Emergent"', 'add-domain')).toEqual({ supported: false, reason: 'unsupported-operation' });
    expect(getDiagramSourceModelAdapter(treemap).getOperationResult('treemap-beta\n  "Root"\n    "Leaf": 1', 'reparent-node')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(venn).getOperationResult('venn-beta\n  set A: 1\n  set B: 1\n  union A, B: 0.5', 'add-style')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(wardley).getOperationResult('wardley-beta\n  component A [0.5, 0.5]', 'add-node')).toEqual({ supported: true });
    for (const operation of ['add-node', 'edit-node', 'delete-node', 'move-node', 'rename-node', 'add-link', 'edit-link', 'delete-link', 'move-link', 'add-evolution', 'edit-evolution', 'delete-evolution', 'add-note', 'edit-note', 'delete-note', 'move-note', 'add-pipeline', 'delete-pipeline']) {
      expect(getDiagramSourceModelAdapter(wardley).getOperationResult('wardley-beta\n  component A [0.5, 0.5]', operation)).toEqual({ supported: true });
    }
    expect(getDiagramSourceModelAdapter(wardley).getOperationResult('wardley-beta\n  title Advanced\n  component A [0.5, 0.5]', 'add-node')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(wardley).getOperationResult('wardley-beta\n  component A [0.5, 0.5]\n  pipeline A {\n  }', 'add-node')).toEqual({ supported: false, reason: 'unrepresentable' });
    for (const operation of ['add-node', 'edit-node', 'delete-node', 'move-node', 'reparent-node']) {
      expect(getDiagramSourceModelAdapter(treemap).getOperationResult('treemap-beta\n  "Root"\n    "Leaf": 1', operation)).toEqual({ supported: true });
    }
    for (const operation of ['add-subset', 'edit-subset', 'delete-subset', 'move-subset', 'rename-set', 'add-style', 'edit-style', 'delete-style', 'move-style']) {
      expect(getDiagramSourceModelAdapter(venn).getOperationResult('venn-beta\n  set A\n  set B\n  union A, B', operation)).toEqual({ supported: true });
    }
    expect(getDiagramSourceModelAdapter(treemap).getOperationResult('treemap-beta\n  "Root"', 'rename-set')).toEqual({ supported: false, reason: 'unsupported-operation' });
    expect(getDiagramSourceModelAdapter(venn).getOperationResult('venn-beta\n  set A', 'reparent-node')).toEqual({ supported: false, reason: 'unsupported-operation' });
    expect(getDiagramSourceModelAdapter(treemap).getOperationResult('treemap-beta\n  "Root":::important\n    "Leaf": 1', 'add-node')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(venn).getOperationResult('venn-beta\n  set A: 1\n  %%{init: {}}%%', 'add-subset')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(venn).getOperationResult('venn-beta\n  set A: 1\n  style A fill:#22c55e,stroke:#166534', 'edit-style')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(quadrant).getOperationResult('quadrantChart\n  A: [1.2, 0.5]', 'edit-point')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(radar).getOperationResult('radar-beta\n  axis a\n  axis b', 'add-axis')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(sankey).getOperationResult('sankey-beta\nSource,Target,0', 'add-link')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(packet).getOperationResult('packet-beta\n  0-7: "Header"\n  9-15: "Gap"', 'add-field')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(sankey).getOperationResult('sankey-beta\nSource,Target,2.5', 'unsupported')).toEqual({ supported: false, reason: 'unsupported-operation' });
    const noteOnlySequence = 'sequenceDiagram\n  Note over A: details';
    await expect(mermaid.parse(noteOnlySequence)).resolves.toMatchObject({ diagramType: 'sequence' });
    expect(getDiagramSourceModelAdapter(sequence).getOperationResult(noteOnlySequence, 'add-message')).toEqual({ supported: true });
    expect(getDiagramSourceModelAdapter(timeline).getOperationResult('timeline\n  accTitle: advanced', 'add-event')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(gitgraph).getOperationResult('gitGraph\n  checkout missing', 'add-branch')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(eventModeling).getOperationResult('eventmodeling\n  tf nope evt Order', 'add-timeframe')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(eventModeling).getOperationResult('eventmodeling\n  entity Order', 'unsupported')).toEqual({ supported: false, reason: 'unsupported-operation' });
    expect(getDiagramSourceModelAdapter(kanban).getOperationResult('kanban\n  todo[', 'add-card')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(kanban).getOperationResult('kanban\n  todo[Todo]', 'unsupported')).toEqual({ supported: false, reason: 'unsupported-operation' });
    expect(getDiagramSourceModelAdapter(railroad).getOperationResult('railroad-beta\n  start = optional(terminal("x"));', 'add-rule')).toEqual({ supported: false, reason: 'unrepresentable' });
    expect(getDiagramSourceModelAdapter(railroad).getOperationResult('railroad-ebnf-beta\n  start = "x" ;', 'unsupported')).toEqual({ supported: false, reason: 'unsupported-operation' });
  });

  it('exposes the existing canvas and semantic-form controls through the adapter contract', () => {
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('flowchart-v2'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('sequence'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('er'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('classDiagram'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('state'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('requirement'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('architecture'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('c4'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('block'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('swimlane'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('journey'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('gantt'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('timeline'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('gitGraph'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('eventmodeling'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('kanban'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('mindmap'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('treeView'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('ishikawa'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('railroad'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('pie'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('quadrantChart'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('xychart'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('radar'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('sankey'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('packet'))).toBe(true);
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('cynefin'))).toBe(true);
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('flowchart-v2'))).toBe('Flowchart · editable · canvas');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('sequence'))).toBe('Sequence · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('er'))).toBe('Entity relationship · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('classDiagram'))).toBe('Class · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('state'))).toBe('State · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('requirement'))).toBe('Requirement · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('c4'))).toBe('C4 · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('block'))).toBe('Block · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('swimlane'))).toBe('Swimlane · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('journey'))).toBe('User journey · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('gantt'))).toBe('Gantt · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('timeline'))).toBe('Timeline · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('gitGraph'))).toBe('Gitgraph · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('eventmodeling'))).toBe('Event modeling · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('kanban'))).toBe('Kanban · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('mindmap'))).toBe('Mindmap · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('treeView'))).toBe('Tree view · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('ishikawa'))).toBe('Ishikawa · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('railroad'))).toBe('Railroad · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('pie'))).toBe('Pie · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('quadrantChart'))).toBe('Quadrant chart · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('xychart'))).toBe('XY chart · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('radar'))).toBe('Radar · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('sankey'))).toBe('Sankey · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('packet'))).toBe('Packet · editable · form');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('cynefin'))).toBe('Cynefin · editable · form');
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
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('c4'), 'C4Dynamic\n  Person(user, "User")')).toBe('C4 · source only');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('block'), 'block-beta\n  space:2')).toBe('Block · source only');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('swimlane'), 'swimlane-beta\n  subgraph Sales\n    a(A)\n  end')).toBe('Swimlane · source only');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('journey'), 'journey\n  Task: 6: Alice')).toBe('User journey · source only');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('gitGraph'), 'gitGraph\n  checkout missing')).toBe('Gitgraph · source only');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('railroad'), 'railroad-beta\n  start = optional(terminal("x"));')).toBe('Railroad · source only');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('pie'), 'pie\n  "A" : -1')).toBe('Pie · source only');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('quadrantChart'), 'quadrantChart\n  A: [2, 0.5]')).toBe('Quadrant chart · source only');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('xychart'), 'xychart-beta\n  x-axis [A, B]\n  bar [1, 2]')).toBe('XY chart · source only');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('radar'), 'radar-beta\n  axis A, B\n  curve one{1, 2}')).toBe('Radar · source only');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('sankey'), 'sankey-beta\nSource,Target,0')).toBe('Sankey · source only');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('packet'), 'packet-beta\n  0-7: "Header"\n  9-15: "Gap"')).toBe('Packet · source only');
    expect(getDiagramCapabilityLabel(classifyDiagramCapability('cynefin'), 'cynefin-beta:\n  complex\n    "Emergent"')).toBe('Cynefin · source only');
    expect(getDiagramCapabilityLabel(null, 'sequenceDiagram\nA->>B: request')).toBe('Mermaid · source only');
  });
});
