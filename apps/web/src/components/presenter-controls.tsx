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
        <button disabled={disabled} type="button" onClick={onSpotlight}>Spotlight</button>
        <button type="button" onClick={onStop}>Stop presenting</button>
      </> : <button disabled={disabled} type="button" onClick={onStart}>Present</button>}
      {followedPeer ? <span className="presenter-following" role="status">
        Following {followedPeer.participant.name}
        <button type="button" onClick={onStopFollowing}>Leave</button>
      </span> : null}
      {!followedPeer && peers.map((peer) => <button data-testid={`follow-presenter-${peer.clientId}`} key={peer.clientId}
        disabled={disabled} type="button" onClick={() => onFollow(peer.clientId)}>Follow {peer.participant.name}</button>)}
    </div>
    <details className="presenter-mobile-menu">
      <summary>Collaborate</summary>
      <div className="presenter-mobile-menu-items">
        {presenting ? <>
          <button disabled={disabled} type="button" onClick={onSpotlight}>Spotlight collaborators</button>
          <button type="button" onClick={onStop}>Stop presenting</button>
        </> : <button disabled={disabled} type="button" onClick={onStart}>Start presenting</button>}
        {followedPeer ? <><span role="status">Following {followedPeer.participant.name}</span>
          <button type="button" onClick={onStopFollowing}>Stop following</button></> : peers.map((peer) =>
          <button data-testid={`mobile-follow-presenter-${peer.clientId}`} disabled={disabled} key={peer.clientId}
            type="button" onClick={() => onFollow(peer.clientId)}>Follow {peer.participant.name}</button>)}
      </div>
    </details>
    {incomingSpotlight && incomingSpotlight.clientId !== followedPeer?.clientId ? <div className="spotlight-request" role="dialog" aria-label="Spotlight request">
      <span>{incomingSpotlight.participant.name} invited you to follow.</span>
      <button type="button" onClick={() => onAcceptSpotlight(incomingSpotlight)}>Accept</button>
      <button type="button" onClick={() => onIgnoreSpotlight(incomingSpotlight)}>Ignore</button>
    </div> : null}
  </div>;
}
