// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addTimelineEvent,
  addTimelinePeriod,
  addTimelineSection,
  deleteTimelineEvent,
  editTimelineEvent,
  editTimelinePeriod,
  getTimelineDiagramSnapshot,
  getTimelineEventIdentity,
  isTimelineSourceRepresentable,
  moveTimelinePeriod,
  moveTimelineSection,
  moveTimelineEvent,
  setTimelineDirection,
} from './timeline-mutations';

const SOURCE = `timeline LR
  title Delivery
  section Foundations
  2024 : Started
       : First release
  section Delivery
  2025 : Shipped
`;

describe('timeline source mutations', () => {
  it('models direction, sections, ordered periods, and events', async () => {
    mermaid.initialize({ startOnLoad: false });
    await expect(mermaid.parse(SOURCE)).resolves.toMatchObject({ diagramType: 'timeline' });
    expect(getTimelineDiagramSnapshot(SOURCE)).toEqual({
      direction: 'LR', sections: [{ label: 'Foundations' }, { label: 'Delivery' }],
      periods: [{ section: 'Foundations', label: '2024' }, { section: 'Delivery', label: '2025' }],
      events: [{ section: 'Foundations', period: '2024', text: 'Started' }, { section: 'Foundations', period: '2024', text: 'First release' }, { section: 'Delivery', period: '2025', text: 'Shipped' }],
    });
  });

  it('writes events and moves source-backed periods without durable ordering metadata', async () => {
    const withHistory = addTimelineSection(SOURCE, { label: 'History' });
    const withPeriod = addTimelinePeriod(withHistory, { section: 'History', label: '2023' });
    const withEvent = addTimelineEvent(withPeriod, { section: 'History', period: '2023', text: 'Prototype' });
    const snapshot = getTimelineDiagramSnapshot(withEvent);
    const edited = editTimelineEvent(withEvent, getTimelineEventIdentity(snapshot.events[3]!, 3, snapshot.events), { text: 'Private prototype' });
    const moved = moveTimelinePeriod(edited, '2023', 'Foundations');
    await expect(mermaid.parse(setTimelineDirection(moved, 'TD'))).resolves.toMatchObject({ diagramType: 'timeline' });
    expect(getTimelineDiagramSnapshot(moved).periods.find((period) => period.label === '2023')).toEqual({ section: 'Foundations', label: '2023' });
  });

  it('fails closed for unsupported accessibility and malformed event source', () => {
    expect(isTimelineSourceRepresentable('timeline\n  2024 : Event\n  accTitle: source-only')).toBe(false);
    expect(isTimelineSourceRepresentable('timeline\n  : orphan event')).toBe(false);
    expect(() => addTimelineEvent(SOURCE, { section: 'Foundations', period: '2024', text: 'Bad: event' })).toThrow('one-line Mermaid text');
  });
  it('reorders event source lines within their canonical period', () => {
    const snapshot = getTimelineDiagramSnapshot(SOURCE);
    expect(moveTimelineEvent(SOURCE, getTimelineEventIdentity(snapshot.events[1]!, 1, snapshot.events), 'up')).toContain('2024 : First release\n       : Started');
  });
  it('keeps the period and remaining continuation event when deleting a swapped inline event', () => {
    const snapshot = getTimelineDiagramSnapshot(SOURCE);
    const swapped = moveTimelineEvent(SOURCE, getTimelineEventIdentity(snapshot.events[1]!, 1, snapshot.events), 'up');
    const swappedSnapshot = getTimelineDiagramSnapshot(swapped);
    const deleted = deleteTimelineEvent(swapped, getTimelineEventIdentity(swappedSnapshot.events[0]!, 0, swappedSnapshot.events));
    expect(deleted).toContain('  2024\n       : Started');
    expect(getTimelineDiagramSnapshot(deleted)).toMatchObject({
      periods: expect.arrayContaining([{ section: 'Foundations', label: '2024' }]),
      events: expect.arrayContaining([{ section: 'Foundations', period: '2024', text: 'Started' }]),
    });
  });
  it('edits an inline first event without erasing its source period', () => {
    const snapshot = getTimelineDiagramSnapshot(SOURCE);
    const edited = editTimelineEvent(SOURCE, getTimelineEventIdentity(snapshot.events[0]!, 0, snapshot.events), { text: 'Launched' });
    expect(edited).toContain('2024 : Launched');
    expect(isTimelineSourceRepresentable(edited)).toBe(true);
  });
  it('renames inline periods without losing events, comments, or CRLF source formatting', () => {
    const source = 'timeline LR\r\n  %% retained before period\r\n  section Delivery\r\n  2024 : Started\r\n       : Continued\r\n  %% retained after period\r\n  2025 : Shipped\r\n';
    const edited = editTimelinePeriod(source, '2024', { label: 'FY24' });
    expect(edited).toContain('  FY24 : Started\r\n       : Continued\r\n  %% retained after period\r\n');
    expect(edited).toContain('%% retained before period');
    expect(edited.replace(/\r\n/g, '')).not.toContain('\n');
    expect(getTimelineDiagramSnapshot(edited).events.filter((event) => event.period === 'FY24')).toHaveLength(2);
  });
  it('moves complete periods to an explicit section or top level before the first section', () => {
    const moved = moveTimelinePeriod(SOURCE, '2024', 'Delivery');
    expect(getTimelineDiagramSnapshot(moved).periods.find((period) => period.label === '2024')).toEqual({ label: '2024', section: 'Delivery' });

    const topLevel = moveTimelinePeriod(moved, '2024', '');
    expect(topLevel.indexOf('  2024 : Started')).toBeLessThan(topLevel.indexOf('  section Foundations'));
    expect(getTimelineDiagramSnapshot(topLevel).periods.find((period) => period.label === '2024')).toEqual({ label: '2024', section: '' });
  });
  it('reorders Timeline section blocks without joining lines when the source has no final newline', () => {
    const source = 'timeline LR\r\n  section Foundations\r\n  2024 : Started\r\n  section Delivery';
    const moved = moveTimelineSection(source, 'Delivery', 'up');
    expect(moved).toBe('timeline LR\r\n  section Delivery\r\n  section Foundations\r\n  2024 : Started');
    expect(getTimelineDiagramSnapshot(moved).periods).toEqual([{ section: 'Foundations', label: '2024' }]);
  });
});
