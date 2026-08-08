import type { ActivityEvent, DiagramRevision, DiagramRevisionSummary, ListDiagramHistoryOutput, Participant } from '@arielcharts/shared';
import { Code2, Eye, History, RotateCcw, X } from 'lucide-react';
import type { RefObject } from 'react';
import type { ActivityFlyoutView, WorkspaceFlyout } from '../lib/workspace-flyout-state';

interface WorkspaceFlyoutsProps {
  activeDiagramName: string;
  activity: readonly ActivityEvent[];
  activityCloseRef: RefObject<HTMLButtonElement | null>;
  closeFlyout: () => void;
  editorHostRef: RefObject<HTMLDivElement | null>;
  editorStatusLabel: string;
  getActivityColor: (event: ActivityEvent, participants: Participant[]) => string;
  getActivityDescription: (event: ActivityEvent) => string;
  getTimestampLabel: (timestamp: number) => string;
  history: ListDiagramHistoryOutput | null;
  historyError: string | null;
  historyLoading: boolean;
  historyView: ActivityFlyoutView;
  onCancelPreview: () => void;
  onHistoryViewChange: (view: ActivityFlyoutView) => void;
  onPreviewRevision: (revision: DiagramRevisionSummary) => void;
  onRestoreCancel: () => void;
  onRestoreConfirm: () => void;
  onRestoreRequest: (revision: DiagramRevisionSummary) => void;
  openFlyout: WorkspaceFlyout;
  participants: Participant[];
  previewRevision: DiagramRevision | null;
  previewError: string | null;
  restoreCandidate: DiagramRevisionSummary | null;
  restoreError: string | null;
  restorePending: boolean;
}

function getRevisionLabel(revision: DiagramRevisionSummary): string {
  return `#${revision.sequence} · ${revision.revision_id.slice(0, 8)}`;
}

function getRevisionAction(revision: DiagramRevisionSummary): string {
  return revision.restored_from_revision_id
    ? `restored ${revision.restored_from_revision_id.slice(0, 8)}`
    : revision.action;
}

export function WorkspaceFlyouts({
  activeDiagramName,
  activity,
  activityCloseRef,
  closeFlyout,
  editorHostRef,
  editorStatusLabel,
  getActivityColor,
  getActivityDescription,
  getTimestampLabel,
  history,
  historyError,
  historyLoading,
  historyView,
  onCancelPreview,
  onHistoryViewChange,
  onPreviewRevision,
  onRestoreCancel,
  onRestoreConfirm,
  onRestoreRequest,
  openFlyout,
  participants,
  previewRevision,
  previewError,
  restoreCandidate,
  restoreError,
  restorePending,
}: WorkspaceFlyoutsProps) {
  return (
    <>
      {openFlyout === 'source' ? (
        <aside aria-label="Mermaid source" className="workspace-flyout" data-testid="source-flyout" id="source-flyout">
          <header className="workspace-flyout-header">
            <div><Code2 aria-hidden="true" size={16} /><span>Mermaid source</span></div>
            <button aria-label="Close source panel" className="workspace-icon-button" onClick={closeFlyout} type="button"><X aria-hidden="true" size={16} /></button>
          </header>
          <div className="workspace-flyout-meta">
            <span>{activeDiagramName}</span>
            <span data-testid="connection-status-badge">{editorStatusLabel}</span>
          </div>
          <div className="editor-host workspace-flyout-editor" data-testid="editor-root" ref={editorHostRef} />
        </aside>
      ) : null}

      {openFlyout === 'activity' ? (
        <aside aria-label="Activity and history" className="workspace-flyout workspace-activity-flyout" data-testid="activity-flyout" id="activity-flyout">
          <header className="workspace-flyout-header">
            <div><History aria-hidden="true" size={16} /><span>Activity &amp; history</span></div>
            <button aria-label="Close activity and history" className="workspace-icon-button" onClick={closeFlyout} ref={activityCloseRef} type="button"><X aria-hidden="true" size={16} /></button>
          </header>
          <div aria-label="Activity and history view" className="workspace-flyout-switch" role="group">
            <button aria-pressed={historyView === 'history'} className={historyView === 'history' ? 'is-active' : ''} onClick={() => { onHistoryViewChange('history'); }} type="button">History</button>
            <button aria-pressed={historyView === 'activity'} className={historyView === 'activity' ? 'is-active' : ''} onClick={() => { onHistoryViewChange('activity'); }} type="button">Activity <span>{activity.length}</span></button>
          </div>

          {historyView === 'activity' ? (
            <>
              <div className="workspace-flyout-meta"><span>Latest activity</span><span>{activity.length}</span></div>
              {activity.length > 0 ? (
                <ol className="activity-list" data-testid="activity-feed">
                  {activity.map((event, index) => (
                    <li className={`activity-item${index === 0 ? ' is-current' : ''}`} key={event.id}>
                      <span aria-hidden="true" className="activity-timeline-marker" style={{ borderColor: getActivityColor(event, participants) }} />
                      <div className="activity-item-content">
                        <div className="activity-item-heading">
                          <span className={event.actor.type === 'agent' ? 'activity-agent-badge' : ''}>{event.actor.name}</span>
                          <time className="activity-time" dateTime={new Date(event.timestamp).toISOString()}>{getTimestampLabel(event.timestamp)}</time>
                        </div>
                        <strong>{getActivityDescription(event)}</strong>
                        {event.detail ? <span className="activity-detail">{event.detail}</span> : null}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : <div className="empty-inline">no activity yet</div>}
            </>
          ) : (
            <>
              <div className="workspace-flyout-meta"><span>{activeDiagramName}</span><span>{history ? `head ${history.current_revision.slice(0, 8)}` : '0 revisions'}</span></div>
              {previewRevision ? (
                <div className="history-preview-notice" data-testid="history-preview-notice">
                  <span>Previewing {getRevisionLabel(previewRevision)} locally</span>
                  <button onClick={onCancelPreview} type="button">Cancel preview</button>
                </div>
              ) : null}
              {previewError ? <div className="history-error" role="status">{previewError}</div> : null}
              {historyLoading ? <div className="empty-inline">loading history…</div> : null}
              {historyError ? <div className="history-error" role="status">{historyError}</div> : null}
              {restoreError && !restoreCandidate ? <div className="history-error" role="status">{restoreError}</div> : null}
              {!historyLoading && !historyError && history?.revisions.length === 0 ? <div className="empty-inline">no revisions yet</div> : null}
              {!historyLoading && history?.revisions.length ? (
                <ol className="history-list" data-testid="diagram-history-list">
                  {history.revisions.map((revision) => {
                    const isCurrentHead = revision.result_revision === history.current_revision;
                    const isPreviewing = previewRevision?.revision_id === revision.revision_id;
                    return (
                      <li
                        aria-current={isCurrentHead ? 'true' : undefined}
                        className={`history-item${isCurrentHead ? ' is-current' : ''}`}
                        data-revision-id={revision.revision_id}
                        data-testid={`history-revision-${revision.revision_id}`}
                        key={revision.revision_id}
                      >
                        <div className="history-item-heading">
                          <strong>{getRevisionLabel(revision)}</strong>
                          <time className="activity-time" dateTime={new Date(revision.timestamp).toISOString()}>{getTimestampLabel(revision.timestamp)}</time>
                        </div>
                        <span>{revision.actor.name} · {getRevisionAction(revision)}</span>
                        <span className="history-item-name">{revision.name}</span>
                        {isCurrentHead ? <span aria-label="Current head" className="history-current-head" data-testid="history-current-head-marker">Current</span> : null}
                        <div className="history-item-actions">
                          <button aria-pressed={isPreviewing} onClick={() => { onPreviewRevision(revision); }} type="button"><Eye aria-hidden="true" size={14} />{isPreviewing ? 'Previewing' : 'Preview'}</button>
                          <button disabled={restorePending} onClick={() => { onRestoreRequest(revision); }} type="button"><RotateCcw aria-hidden="true" size={14} />Restore</button>
                        </div>
                      </li>
                    );
                  })}
                </ol>
              ) : null}
              {restoreCandidate ? (
                <div className="history-restore-confirmation" data-testid="history-restore-confirmation" role="alert">
                  <strong>Restore {getRevisionLabel(restoreCandidate)} as a new revision?</strong>
                  <span>This keeps the current diagram name and all later history.</span>
                  {restoreError ? <span className="history-error">{restoreError}</span> : null}
                  <div className="history-item-actions">
                    <button disabled={restorePending} onClick={onRestoreConfirm} type="button">{restorePending ? 'Checking current head…' : 'Confirm restore'}</button>
                    <button disabled={restorePending} onClick={onRestoreCancel} type="button">Cancel</button>
                  </div>
                </div>
              ) : null}
            </>
          )}
        </aside>
      ) : null}
    </>
  );
}
