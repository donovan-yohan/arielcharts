import type { ActivityEvent, Participant } from '@arielcharts/shared';
import { Activity, Code2, X } from 'lucide-react';
import type { RefObject } from 'react';

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
  openFlyout: 'source' | 'activity' | null;
  participants: Participant[];
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
  openFlyout,
  participants,
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
        <aside aria-label="Activity history" className="workspace-flyout workspace-activity-flyout" data-testid="activity-flyout" id="activity-flyout">
          <header className="workspace-flyout-header">
            <div><Activity aria-hidden="true" size={16} /><span>Activity history</span></div>
            <button aria-label="Close activity history" className="workspace-icon-button" onClick={closeFlyout} ref={activityCloseRef} type="button"><X aria-hidden="true" size={16} /></button>
          </header>
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
        </aside>
      ) : null}
    </>
  );
}
