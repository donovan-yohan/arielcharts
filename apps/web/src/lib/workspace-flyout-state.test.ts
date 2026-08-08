import { describe, expect, it } from 'vitest';
import { getActivityFlyoutViewOnOpen, getNextWorkspaceFlyout } from './workspace-flyout-state';

describe('workspace flyout state', () => {
  it('keeps source and activity mutually exclusive while allowing each toggle to close itself', () => {
    expect(getNextWorkspaceFlyout(null, 'source')).toBe('source');
    expect(getNextWorkspaceFlyout('source', 'source')).toBeNull();
    expect(getNextWorkspaceFlyout('source', 'activity')).toBe('activity');
    expect(getNextWorkspaceFlyout('activity', 'activity')).toBeNull();
  });

  it('opens the combined flyout on active-diagram history while retaining activity as a compact view', () => {
    expect(getActivityFlyoutViewOnOpen(null, 'activity')).toBe('history');
    expect(getActivityFlyoutViewOnOpen('source', 'activity')).toBe('history');
    expect(getActivityFlyoutViewOnOpen('activity', 'activity')).toBe('activity');
  });
});
