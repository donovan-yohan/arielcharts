export type WorkspaceFlyout = 'source' | 'activity' | null;

export type ActivityFlyoutView = 'activity' | 'history';

export function getNextWorkspaceFlyout(current: WorkspaceFlyout, requested: Exclude<WorkspaceFlyout, null>): WorkspaceFlyout {
  return current === requested ? null : requested;
}

/** History is the useful default; activity remains one tap away in the same overlay. */
export function getActivityFlyoutViewOnOpen(current: WorkspaceFlyout, requested: Exclude<WorkspaceFlyout, null>): ActivityFlyoutView {
  return current === requested ? 'activity' : 'history';
}
