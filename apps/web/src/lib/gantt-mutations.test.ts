// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addGanttSection,
  addGanttTask,
  deleteGanttSection,
  deleteGanttTask,
  editGanttTask,
  getGanttDiagramSnapshot,
  getGanttTaskIdentity,
  isGanttSourceRepresentable,
  moveGanttSection,
  moveGanttTask,
} from './gantt-mutations';

const SOURCE = `%% dates remain canonical source
gantt
  dateFormat YYYY-MM-DD
  section Build
  Design : done, design, 2026-01-01, 2d
  Ship : milestone, ship, after design, 0d
`;

describe('gantt source mutations', () => {
  it('models sections, task ids, statuses, dates, durations, milestones, and dependencies', async () => {
    mermaid.initialize({ startOnLoad: false });
    await expect(mermaid.parse(SOURCE)).resolves.toMatchObject({ diagramType: 'gantt' });
    expect(getGanttDiagramSnapshot(SOURCE)).toEqual({
      dateFormat: 'YYYY-MM-DD', sections: [{ label: 'Build' }], tasks: [
        { section: 'Build', text: 'Design', statuses: ['done'], id: 'design', start: '2026-01-01', end: '2d' },
        { section: 'Build', text: 'Ship', statuses: ['milestone'], id: 'ship', start: 'after design', end: '0d' },
      ],
    });
  });

  it('validates task references and edits source-backed tasks', async () => {
    const withRelease = addGanttSection(SOURCE, { label: 'Release' });
    const added = addGanttTask(withRelease, { section: 'Release', text: 'Verify', statuses: ['active', 'crit'], id: 'verify', start: 'after ship', end: '1d' });
    const tasks = getGanttDiagramSnapshot(added).tasks;
    const edited = editGanttTask(added, getGanttTaskIdentity(tasks[2]!, 2, tasks), { end: '2d', statuses: ['done'] });
    await expect(mermaid.parse(edited)).resolves.toMatchObject({ diagramType: 'gantt' });
    expect(edited).toContain('Verify : done, verify, after ship, 2d');
    expect(deleteGanttSection(edited, 'Release')).toContain('%% dates remain canonical source');
    expect(() => addGanttTask(SOURCE, { section: 'Build', text: 'Unknown', statuses: [], id: 'unknown', start: 'after missing', end: '1d' })).toThrow('dependencies');
    const original = getGanttDiagramSnapshot(SOURCE).tasks;
    expect(() => deleteGanttTask(SOURCE, getGanttTaskIdentity(original[0]!, 0, original))).toThrow('depend');
  });

  it('fails closed for unrepresentable Gantt controls and invalid scheduling data', () => {
    expect(isGanttSourceRepresentable('gantt\n  dateFormat DD-MM-YYYY\n  Task : task, 01-01-2026, 1d')).toBe(false);
    expect(isGanttSourceRepresentable('gantt\n  section Build\n  Task : task, 2026-01-01, 1d\n  click task callback')).toBe(false);
    expect(() => addGanttTask(SOURCE, { section: 'Build', text: 'Milestone', statuses: ['milestone'], id: 'm1', start: '2026-01-02', end: '2d' })).toThrow('milestones');
  });
  it('rejects cyclic dependencies and direct end dates earlier than the start without a source write', () => {
    const selfCycle = 'gantt\n  Task : task, after task, 1d';
    const twoNodeCycle = 'gantt\n  A : a, after b, 1d\n  B : b, after a, 1d';
    const indirectCycle = 'gantt\n  A : a, after b, 1d\n  B : b, after c, 1d\n  C : c, after a, 1d';
    const backwardsDate = 'gantt\n  Task : task, 2026-01-02, 2026-01-01';
    expect(isGanttSourceRepresentable(selfCycle)).toBe(false);
    expect(isGanttSourceRepresentable(twoNodeCycle)).toBe(false);
    expect(isGanttSourceRepresentable(indirectCycle)).toBe(false);
    expect(isGanttSourceRepresentable(backwardsDate)).toBe(false);

    const tasks = getGanttDiagramSnapshot(SOURCE).tasks;
    expect(() => editGanttTask(SOURCE, getGanttTaskIdentity(tasks[0]!, 0, tasks), { start: 'after ship' })).toThrow('safely representable');
    expect(SOURCE).toContain('Design : done, design, 2026-01-01, 2d');
    expect(() => addGanttTask('', { section: '', text: 'Self', statuses: [], id: 'self', start: 'after self', end: '1d' })).toThrow('safely representable');
    expect(() => addGanttTask(SOURCE, { section: 'Build', text: 'Backwards', statuses: [], id: 'backwards', start: '2026-01-02', end: '2026-01-01' })).toThrow('earlier');
  });
  it('reorders independent explicit-id tasks but keeps dependency ordering safe', () => {
    const source = `${SOURCE}  Test : test, 2026-01-03, 1d\n`;
    const tasks = getGanttDiagramSnapshot(source).tasks;
    expect(moveGanttTask(source, getGanttTaskIdentity(tasks[2]!, 2, tasks), 'up')).toContain('Test : test, 2026-01-03, 1d\n  Ship');
    expect(() => moveGanttTask(SOURCE, getGanttTaskIdentity(tasks[1]!, 1, getGanttDiagramSnapshot(SOURCE).tasks), 'up')).toThrow('dependent');
  });
  it('reorders Gantt section blocks without joining lines when the source has no final newline', () => {
    const source = 'gantt\r\n  dateFormat YYYY-MM-DD\r\n  section Build\r\n  Design : design, 2026-01-01, 1d\r\n  section Release';
    const moved = moveGanttSection(source, 'Release', 'up');
    expect(moved).toBe('gantt\r\n  dateFormat YYYY-MM-DD\r\n  section Release\r\n  section Build\r\n  Design : design, 2026-01-01, 1d');
    expect(getGanttDiagramSnapshot(moved).tasks[0]).toMatchObject({ section: 'Build', id: 'design' });
  });
});
