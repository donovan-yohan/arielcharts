// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addJourneySection,
  addJourneyTask,
  deleteJourneySection,
  editJourneyTask,
  getJourneyDiagramSnapshot,
  getJourneyTaskIdentity,
  isJourneySourceRepresentable,
  moveJourneySection,
  moveJourneyTask,
} from './journey-mutations';

const SOURCE = `%% retained authored note
journey
  title Checkout
  section Discover
  Browse products: 5: Customer
  section Buy
  Pay: 2: Customer, Payments
`;

describe('journey source mutations', () => {
  it('models sections, task scores, and actor lists', async () => {
    mermaid.initialize({ startOnLoad: false });
    await expect(mermaid.parse(SOURCE)).resolves.toMatchObject({ diagramType: 'journey' });
    expect(getJourneyDiagramSnapshot(SOURCE)).toEqual({
      sections: [{ label: 'Discover' }, { label: 'Buy' }],
      tasks: [
        { section: 'Discover', text: 'Browse products', score: 5, actors: ['Customer'] },
        { section: 'Buy', text: 'Pay', score: 2, actors: ['Customer', 'Payments'] },
      ],
    });
  });

  it('appends, edits, and deletes source ranges while preserving comments', async () => {
    const withSupport = addJourneySection(SOURCE, { label: 'Support' });
    const added = addJourneyTask(withSupport, { section: 'Support', text: 'Ask a question', score: 3, actors: ['Customer', 'Support'] });
    const snapshot = getJourneyDiagramSnapshot(added);
    const edited = editJourneyTask(added, getJourneyTaskIdentity(snapshot.tasks[2]!, 2, snapshot.tasks), { text: 'Receive an answer', score: 4 });
    await expect(mermaid.parse(edited)).resolves.toMatchObject({ diagramType: 'journey' });
    expect(edited).toContain('Receive an answer: 4: Customer, Support');
    expect(deleteJourneySection(edited, 'Support')).toContain('%% retained authored note');
  });

  it('re-resolves a unique task after a remote insertion and fails closed for unsupported forms', () => {
    const tasks = getJourneyDiagramSnapshot(SOURCE).tasks;
    const identity = getJourneyTaskIdentity(tasks[1]!, 1, tasks);
    const inserted = SOURCE.replace('  Pay: 2: Customer, Payments', '  Ask: 3: Customer\n  Pay: 2: Customer, Payments');
    expect(editJourneyTask(inserted, identity, { score: 4 })).toContain('Pay: 4: Customer, Payments');
    expect(isJourneySourceRepresentable('journey\n  Task: 0: Alice')).toBe(false);
    expect(isJourneySourceRepresentable('journey\n  Task: 7: Alice')).toBe(false);
    expect(isJourneySourceRepresentable('journey\n  Task: 3: Alice\n  accTitle: source-only')).toBe(false);
    expect(() => addJourneyTask(SOURCE, { section: 'Discover', text: 'Bad: task', score: 3, actors: ['Customer'] })).toThrow('one-line Mermaid text');
    expect(() => addJourneyTask(SOURCE, { section: 'Discover', text: 'No score', score: 0, actors: ['Customer'] })).toThrow('1 to 5');
  });
  it('reorders source-backed tasks without weakening their remote identity', () => {
    const source = `${SOURCE}  Return: 4: Customer\n`;
    const tasks = getJourneyDiagramSnapshot(source).tasks;
    const moved = moveJourneyTask(source, getJourneyTaskIdentity(tasks[2]!, 2, tasks), 'up');
    expect(moved.indexOf('Return: 4')).toBeLessThan(moved.indexOf('Pay: 2'));
  });
  it('reorders section blocks with no final newline while retaining task boundaries', () => {
    const source = 'journey\r\n  section Product\r\n  Browse: 5: Customer\r\n  section Help';
    const moved = moveJourneySection(source, 'Help', 'up');
    expect(moved).toBe('journey\r\n  section Help\r\n  section Product\r\n  Browse: 5: Customer');
    expect(getJourneyDiagramSnapshot(moved).tasks).toEqual([{ section: 'Product', text: 'Browse', score: 5, actors: ['Customer'] }]);
  });
});
