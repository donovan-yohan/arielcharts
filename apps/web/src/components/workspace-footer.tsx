import type { Participant } from '@arielcharts/shared';
import { Activity, ChevronDown } from 'lucide-react';

interface WorkspaceFooterProps {
  activityCount: number;
  activityOpen: boolean;
  activityStatusLabel: string;
  connectionState: 'connecting' | 'connected' | 'reconnecting' | 'disconnected';
  getAvatarText: (participant: Participant) => string;
  getParticipantName: (participant: Participant) => string;
  onActivityToggle: (origin: HTMLButtonElement) => void;
  participants: readonly Participant[];
  saveStatusLabel: string;
}

export function WorkspaceFooter({
  activityCount,
  activityOpen,
  activityStatusLabel,
  connectionState,
  getAvatarText,
  getParticipantName,
  onActivityToggle,
  participants,
  saveStatusLabel,
}: WorkspaceFooterProps) {
  return (
    <footer className="workspace-footer" data-testid="workspace-footer">
      <div className="workspace-footer-left">
        <button
          aria-controls="activity-flyout"
          aria-expanded={activityOpen}
          className={`workspace-footer-toggle${activityOpen ? ' is-active' : ''}`}
          data-testid="activity-flyout-toggle"
          onClick={(event) => { onActivityToggle(event.currentTarget); }}
          type="button"
        ><Activity aria-hidden="true" size={15} /><span>activity</span><b>{activityCount}</b><ChevronDown aria-hidden="true" size={14} /></button>
        <span className="workspace-collaborator-count">{activityStatusLabel}</span>
        <div aria-label="Active collaborators" className="workspace-footer-avatars">
          {participants.map((participant) => (
            <span
              aria-label={`${getParticipantName(participant)}, ${participant.type}`}
              className={`workspace-footer-avatar workspace-footer-avatar-${participant.type}`}
              key={`${participant.name}-${participant.type}-footer`}
              style={{ backgroundColor: participant.type === 'agent' ? 'var(--agent-badge)' : participant.color }}
              title={getParticipantName(participant)}
            >{getAvatarText(participant)}</span>
          ))}
        </div>
      </div>
      <div aria-live="polite" className="workspace-save-status" data-testid="live-save-status">
        <span aria-hidden="true" className={`workspace-save-dot workspace-save-dot-${connectionState}`} />
        <span>{saveStatusLabel}</span><span className="workspace-live-label">live</span>
      </div>
    </footer>
  );
}
