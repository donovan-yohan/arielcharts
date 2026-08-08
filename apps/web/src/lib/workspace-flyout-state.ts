export type WorkspaceFlyout = 'source' | 'activity' | null;

export function getNextWorkspaceFlyout(current: WorkspaceFlyout, requested: Exclude<WorkspaceFlyout, null>): WorkspaceFlyout {
  return current === requested ? null : requested;
}
