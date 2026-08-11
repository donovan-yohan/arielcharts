// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { addKanbanCard, addKanbanColumn, editKanbanCard, getKanbanDiagramSnapshot, isKanbanSourceRepresentable, moveKanbanCard } from './kanban-mutations';

const SOURCE = `%% board comments persist\nkanban\n  todo[Todo]\n    design[Design]@{ assigned: "Ava", ticket: "ARC-1" }\n  done[Done]`;

describe('Kanban source mutations', () => {
  it('keeps the supported Kanban subset accepted by Mermaid 11.16.1', async () => {
    mermaid.initialize({ startOnLoad: false });
    await expect(mermaid.parse(SOURCE)).resolves.toMatchObject({ diagramType: 'kanban' });
  });
  it('models board columns, ordered cards, metadata, and assignment', () => {
    expect(getKanbanDiagramSnapshot(SOURCE)).toEqual({ columns: [{ id: 'todo', title: 'Todo' }, { id: 'done', title: 'Done' }], cards: [{ id: 'design', title: 'Design', columnId: 'todo', metadata: { assigned: 'Ava', ticket: 'ARC-1' } }] });
    expect(addKanbanColumn(SOURCE, { id: 'review', title: 'Review' })).toContain('%% board comments persist');
  });
  it('moves and edits cards via their declaration ranges', () => {
    const added = addKanbanCard(SOURCE, { id: 'ship', title: 'Ship it', columnId: 'todo', metadata: { priority: 'High' } });
    const moved = moveKanbanCard(added, 'ship', 'done', 0);
    expect(editKanbanCard(moved, 'ship', { metadata: { assigned: 'Bea' } })).toContain('ship[Ship it]@{ assigned: "Bea" }');
  });
  it('preserves metadata values containing commas and colons', () => {
    const source = 'kanban\n  todo[Todo]\n    task[Task]@{ assigned: "Ava, Bea: owner", ticket: "ARC: 1, 2" }';
    const edited = editKanbanCard(source, 'task', { metadata: { assigned: 'Ava, Bea: owner', ticket: 'ARC: 1, 2' } });
    expect(getKanbanDiagramSnapshot(edited).cards[0]?.metadata).toEqual({ assigned: 'Ava, Bea: owner', ticket: 'ARC: 1, 2' });
  });
  it('keeps terminators positional when cards move across columns', () => {
    for (const ending of ['\n', '\r\n', '\r']) {
      const source = ['kanban', '  todo[Todo]', '    task[Task]', '  done[Done]'].join(ending);
      const moved = moveKanbanCard(source, 'task', 'done', 0);
      expect(moved.match(/\r\n|\n|\r/g)).toEqual(source.match(/\r\n|\n|\r/g));
      expect(moved.endsWith(ending)).toBe(false);
    }
    const mixed = 'kanban\r\n  todo[Todo]\n    task[Task]\r  done[Done]';
    expect(moveKanbanCard(mixed, 'task', 'done', 0).match(/\r\n|\n|\r/g)).toEqual(mixed.match(/\r\n|\n|\r/g));
  });
  it('fails closed for duplicated ids, nested labels, and unsupported multiline metadata', () => {
    expect(isKanbanSourceRepresentable('kanban\n  todo[Todo]\n    todo[Duplicate]')).toBe(false);
    expect(isKanbanSourceRepresentable('kanban\n  todo[To[do]]')).toBe(false);
    expect(isKanbanSourceRepresentable('kanban\n  todo[Todo]\n    task[Task]@{ assigned: "A"\n    }')).toBe(false);
  });
});
