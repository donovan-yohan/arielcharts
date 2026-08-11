import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { applyDiff } from './diagram-mutations';
import { addSequenceParticipant } from './sequence-mutations';
import { addErAttribute } from './er-mutations';
import { addClass } from './class-mutations';
import { addState } from './state-mutations';
import { addRequirement } from './requirement-mutations';
import { editArchitectureService } from './architecture-mutations';
import { addC4Element } from './c4-mutations';
import { addBlockNode } from './block-mutations';
import { addSwimlaneNode } from './swimlane-mutations';
import { addJourneyTask } from './journey-mutations';
import { addGanttTask } from './gantt-mutations';
import { addTimelineEvent } from './timeline-mutations';
import { addGitGraphCommit } from './gitgraph-mutations';
import { addEventModelingEntity } from './event-modeling-mutations';
import { addKanbanColumn } from './kanban-mutations';
import { addMindmapNode } from './mindmap-mutations';
import { addTreeViewNode } from './treeview-mutations';
import { addIshikawaCause } from './ishikawa-mutations';
import { addRailroadRule } from './railroad-mutations';
import { addPieSlice } from './pie-mutations';
import { addQuadrantPoint } from './quadrant-mutations';
import { addXySeries } from './xychart-mutations';
import { addRadarCurve } from './radar-mutations';
import { addSankeyLink } from './sankey-mutations';
import { addPacketField } from './packet-mutations';
import { addCynefinItem } from './cynefin-mutations';
import { addTreemapNode } from './treemap-mutations';
import { addVennSubset } from './venn-mutations';
import { collaborationOrigins, createDiagramUndoManager, destroyDiagramUndoManager } from './collaboration-origins';

describe('collaboration transaction origins', () => {
  it('tracks only explicit local visual origins', () => {
    const doc = new Y.Doc();
    const source = doc.getText('source');
    const positions = doc.getMap<{ x: number; y: number }>('positions');
    const undoManager = createDiagramUndoManager(source, positions);

    doc.transact(() => { source.insert(0, 'flowchart TD'); }, collaborationOrigins.visual);
    doc.transact(() => { positions.set('A', { x: 12, y: 24 }); }, collaborationOrigins.visualLayout);
    doc.transact(() => { source.insert(source.length, '\nA'); }, 'mcp');
    doc.transact(() => { positions.set('B', { x: 36, y: 48 }); }, null);
    doc.transact(() => { positions.delete('A'); }, collaborationOrigins.reconciliation);

    expect(undoManager.undoStack).toHaveLength(1);
    undoManager.undo();
    expect(source.toString()).toBe('\nA');
    expect([...positions.entries()]).toEqual([['B', { x: 36, y: 48 }]]);

    undoManager.redo();
    expect(source.toString()).toBe('flowchart TD\nA');
    // A later reconciliation deletion remains authoritative rather than being
    // revived by the redo of a prior local layout transaction.
    expect([...positions.entries()]).toEqual([['B', { x: 36, y: 48 }]]);

    destroyDiagramUndoManager(undoManager);
  });

  it('restores a local visual source and layout checkpoint together', () => {
    const doc = new Y.Doc();
    const source = doc.getText('source');
    const positions = doc.getMap<{ x: number; y: number }>('positions');
    const undoManager = createDiagramUndoManager(source, positions);

    doc.transact(() => { source.insert(0, 'flowchart TD\nA'); }, collaborationOrigins.visual);
    doc.transact(() => { positions.set('A', { x: 12, y: 24 }); }, collaborationOrigins.visualLayout);

    undoManager.undo();
    expect(source.toString()).toBe('');
    expect([...positions.entries()]).toEqual([]);

    undoManager.redo();
    expect(source.toString()).toBe('flowchart TD\nA');
    expect([...positions.entries()]).toEqual([['A', { x: 12, y: 24 }]]);

    destroyDiagramUndoManager(undoManager);
  });

  it('keeps a manager scoped to one diagram lifecycle', () => {
    const doc = new Y.Doc();
    const first = createDiagramUndoManager(doc.getText('first'), doc.getMap('first-layout'));
    const second = createDiagramUndoManager(doc.getText('second'), doc.getMap('second-layout'));

    doc.transact(() => { doc.getText('first').insert(0, 'first'); }, collaborationOrigins.visual);
    doc.transact(() => { doc.getText('second').insert(0, 'second'); }, collaborationOrigins.visual);

    expect(first.undoStack).toHaveLength(1);
    expect(second.undoStack).toHaveLength(1);
    first.undo();
    expect(doc.getText('first').toString()).toBe('');
    expect(doc.getText('second').toString()).toBe('second');
    first.redo();
    expect(doc.getText('first').toString()).toBe('first');
    destroyDiagramUndoManager(first);
    destroyDiagramUndoManager(second);
  });

  it('keeps sequence form mutations in the local visual undo stack', () => {
    const doc = new Y.Doc();
    const source = doc.getText('sequence-source');
    const undoManager = createDiagramUndoManager(source, doc.getMap('sequence-layout'));
    source.insert(0, 'sequenceDiagram');
    undoManager.stopCapturing();

    const previous = source.toString();
    const next = addSequenceParticipant(previous, 'Browser');
    doc.transact(() => { applyDiff(source, next, previous); }, collaborationOrigins.visual);

    expect(undoManager.undoStack).toHaveLength(1);
    undoManager.undo();
    expect(source.toString()).toBe('sequenceDiagram');
    destroyDiagramUndoManager(undoManager);
  });

  it('keeps ER form mutations in the local visual undo stack', () => {
    const doc = new Y.Doc();
    const source = doc.getText('er-source');
    const undoManager = createDiagramUndoManager(source, doc.getMap('er-layout'));
    source.insert(0, 'erDiagram\n  CUSTOMER {\n  }');
    undoManager.stopCapturing();

    const previous = source.toString();
    const next = addErAttribute(previous, 'CUSTOMER', { type: 'int', name: 'id', keys: ['PK'] });
    doc.transact(() => { applyDiff(source, next, previous); }, collaborationOrigins.visual);

    expect(undoManager.undoStack).toHaveLength(1);
    undoManager.undo();
    expect(source.toString()).toBe('erDiagram\n  CUSTOMER {\n  }');
    destroyDiagramUndoManager(undoManager);
  });

  it.each([
    ['class', 'classDiagram', (source: string) => addClass(source, 'Account')],
    ['state', 'stateDiagram-v2\n  [*] --> Ready', (source: string) => addState(source, 'Done')],
    ['requirement', 'requirementDiagram\n  requirement req {\n    id: 1\n    text: Existing\n    risk: low\n    verifyMethod: test\n  }', (source: string) => addRequirement(source, { kind: 'requirement', name: 'next', fields: { id: '2', text: 'Next', risk: 'low', verifyMethod: 'test' } })],
    ['architecture', 'architecture-beta\n  service api(server)[API]', (source: string) => editArchitectureService(source, 'api', { title: 'Public API' })],
    ['c4', 'C4Context\n  Person(user, "User")', (source: string) => addC4Element(source, { id: 'system', kind: 'System', label: 'System' })],
    ['block', 'block-beta\n  api["API"]', (source: string) => addBlockNode(source, { id: 'worker', label: 'Worker', span: 1 })],
    ['swimlane', 'swimlane-beta\n  subgraph team [Team]\n  end', (source: string) => addSwimlaneNode(source, { id: 'work', label: 'Work', laneId: 'team' })],
    ['journey', 'journey\n  section Product', (source: string) => addJourneyTask(source, { actors: ['Customer'], score: 5, section: 'Product', text: 'Browse' })],
    ['gantt', 'gantt\n  dateFormat YYYY-MM-DD', (source: string) => addGanttTask(source, { end: '1d', id: 'build', section: '', start: '2026-01-01', statuses: [], text: 'Build' })],
    ['timeline', 'timeline\n  2026', (source: string) => addTimelineEvent(source, { period: '2026', section: '', text: 'Started' })],
    ['gitgraph', 'gitGraph', (source: string) => addGitGraphCommit(source, { id: 'base', tags: [] })],
    ['event modeling', 'eventmodeling', (source: string) => addEventModelingEntity(source, 'Order')],
    ['kanban', 'kanban', (source: string) => addKanbanColumn(source, { id: 'todo', title: 'Todo' })],
    ['mindmap', 'mindmap\n  Root', (source: string) => addMindmapNode(source, { classes: [], label: 'Child', shape: 'default' }, { node: { classes: [], label: 'Root', shape: 'default' }, occurrenceCount: 1 })],
    ['tree view', 'treeView-beta\n  Root', (source: string) => addTreeViewNode(source, { classes: [], directory: false, label: 'child.txt', quoted: false }, { node: { classes: [], directory: false, label: 'Root', quoted: false, sourceStyle: 'indent' }, occurrenceCount: 1 })],
    ['ishikawa', 'ishikawa-beta\n  Effect', (source: string) => addIshikawaCause(source, { label: 'Cause', parent: null })],
    ['railroad', 'railroad-ebnf-beta', (source: string) => addRailroadRule(source, { definition: '"x"', name: 'start' })],
    ['pie', 'pie', (source: string) => addPieSlice(source, { label: 'A', value: 1 })],
    ['quadrant', 'quadrantChart', (source: string) => addQuadrantPoint(source, { label: 'A', styles: {}, x: 0.5, y: 0.5 })],
    ['XY chart', 'xychart-beta\n  x-axis ["A", "B"]\n  y-axis 0 --> 3', (source: string) => addXySeries(source, { kind: 'line', values: [1, 2] })],
    ['radar', 'radar-beta\n  axis a\n  axis b\n  axis c', (source: string) => addRadarCurve(source, { name: 'one', values: [1, 2, 3] })],
    ['Sankey', 'sankey-beta\nSource,Target,1', (source: string) => addSankeyLink(source, { source: 'Target', target: 'Done', value: 2 })],
    ['Packet', 'packet-beta\n  0-7: "Header"', (source: string) => addPacketField(source, { end: 15, label: 'Body', start: 8 })],
    ['Cynefin', 'cynefin-beta\n  complex\n    "Emergent"', (source: string) => addCynefinItem(source, { domain: 'complex', label: 'Probe' })],
    ['Treemap', 'treemap-beta\n  "Root"', (source: string) => addTreemapNode(source, { label: 'Leaf', value: 1 }, { node: { ancestorLabels: [], label: 'Root', value: null }, occurrenceCount: 1 })],
    ['Venn', 'venn-beta\n  set A: 1', (source: string) => addVennSubset(source, { label: null, sets: ['B'], value: 1 })],
  ])('keeps %s semantic form mutations in the local visual undo stack', (_family, initial, mutate) => {
    const doc = new Y.Doc();
    const source = doc.getText('semantic-source');
    const undoManager = createDiagramUndoManager(source, doc.getMap('semantic-layout'));
    source.insert(0, initial);
    undoManager.stopCapturing();
    const next = mutate(source.toString());
    doc.transact(() => { applyDiff(source, next, source.toString()); }, collaborationOrigins.visual);
    expect(undoManager.undoStack).toHaveLength(1);
    undoManager.undo();
    expect(source.toString()).toBe(initial);
    destroyDiagramUndoManager(undoManager);
  });
});
