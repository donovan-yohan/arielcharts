import { describe, expect, it } from 'vitest';
import { getNextWorkspaceFlyout } from './workspace-flyout-state';

describe('workspace flyout state', () => {
  it('keeps source and activity mutually exclusive while allowing each toggle to close itself', () => {
    expect(getNextWorkspaceFlyout(null, 'source')).toBe('source');
    expect(getNextWorkspaceFlyout('source', 'source')).toBeNull();
    expect(getNextWorkspaceFlyout('source', 'activity')).toBe('activity');
    expect(getNextWorkspaceFlyout('activity', 'activity')).toBeNull();
  });
});
