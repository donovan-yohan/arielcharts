import { WorkspaceButton } from './workspace-controls';
import type { PresenterPeer } from '../lib/use-presenter-follow';

export function PresenterControls({ peers, presenting, followedPeer, incomingSpotlight, onAcceptSpotlight,
  onFollow, onIgnoreSpotlight, onSpotlight, onStart, onStop, onStopFollowing, disabled = false }: {
  peers: PresenterPeer[];
  presenting: boolean;
  followedPeer: PresenterPeer | null;
  incomingSpotlight: PresenterPeer | null;
  onAcceptSpotlight: (peer: PresenterPeer) => void;
  onFollow: (clientId: number) => void;
  onIgnoreSpotlight: (peer: PresenterPeer) => void;
  onSpotlight: () => void;
  onStart: () => void;
  onStop: () => void;
  onStopFollowing: () => void;
  disabled?: boolean;
}) {
  return <div className="presenter-controls" data-testid="presenter-controls">
    <div className="presenter-desktop-controls">
      {presenting ? <>
        <WorkspaceButton disabled={disabled} type="button" onClick={onSpotlight}>Spotlight</WorkspaceButton>
        <WorkspaceButton type="button" onClick={onStop}>Stop presenting</WorkspaceButton>
      </> : <WorkspaceButton disabled={disabled} type="button" onClick={onStart}>Present</WorkspaceButton>}
      {followedPeer ? <span className="presenter-following" role="status">
        Following {followedPeer.participant.name}
        <WorkspaceButton type="button" onClick={onStopFollowing}>Leave</WorkspaceButton>
      </span> : null}
      {!followedPeer && peers.map((peer) => <WorkspaceButton data-testid={`follow-presenter-${peer.clientId}`} key={peer.clientId}
        disabled={disabled} type="button" onClick={() => onFollow(peer.clientId)}>Follow {peer.participant.name}</WorkspaceButton>)}
    </div>
    <details className="presenter-mobile-menu">
      <summary>Collaborate</summary>
      <div className="presenter-mobile-menu-items">
        {presenting ? <>
          <WorkspaceButton disabled={disabled} type="button" onClick={onSpotlight}>Spotlight collaborators</WorkspaceButton>
          <WorkspaceButton type="button" onClick={onStop}>Stop presenting</WorkspaceButton>
        </> : <WorkspaceButton disabled={disabled} type="button" onClick={onStart}>Start presenting</WorkspaceButton>}
        {followedPeer ? <><span role="status">Following {followedPeer.participant.name}</span>
          <WorkspaceButton type="button" onClick={onStopFollowing}>Stop following</WorkspaceButton></> : peers.map((peer) =>
          <WorkspaceButton data-testid={`mobile-follow-presenter-${peer.clientId}`} disabled={disabled} key={peer.clientId}
            type="button" onClick={() => onFollow(peer.clientId)}>Follow {peer.participant.name}</WorkspaceButton>)}
      </div>
    </details>
    {incomingSpotlight && incomingSpotlight.clientId !== followedPeer?.clientId ? <div className="spotlight-request" role="dialog" aria-label="Spotlight request">
      <span>{incomingSpotlight.participant.name} invited you to follow.</span>
      <WorkspaceButton type="button" onClick={() => onAcceptSpotlight(incomingSpotlight)}>Accept</WorkspaceButton>
      <WorkspaceButton type="button" onClick={() => onIgnoreSpotlight(incomingSpotlight)}>Ignore</WorkspaceButton>
    </div> : null}
  </div>;
}
