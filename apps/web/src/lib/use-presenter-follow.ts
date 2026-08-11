import type { AwarenessState, Participant, PresenterAwarenessState } from '@arielcharts/shared';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasCameraState } from '../components/diagram-canvas';
import { PresenterAwarenessPublisher } from './presenter-awareness-publisher';

const CAMERA_GRID = 0.5;

type AwarenessLike = {
  clientID: number;
  getStates: () => Map<number, unknown>;
  on: (eventName: string, handler: (...args: unknown[]) => void) => void;
  off: (eventName: string, handler: (...args: unknown[]) => void) => void;
  setLocalStateField: (field: string, value: unknown) => void;
};

export interface PresenterPeer {
  clientId: number;
  participant: Participant;
  presenter: PresenterAwarenessState;
}

export function selectIncomingSpotlight(peers: readonly PresenterPeer[], ignored: ReadonlySet<string>): PresenterPeer | null {
  return peers.filter((peer) => peer.presenter.spotlight_sequence !== undefined
    && !ignored.has(`${peer.clientId}:${peer.presenter.spotlight_sequence}`))
    .sort((a, b) => (b.presenter.spotlight_sequence ?? 0) - (a.presenter.spotlight_sequence ?? 0)
      || b.clientId - a.clientId)[0] ?? null;
}

function isPresenter(value: unknown): value is PresenterAwarenessState {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<PresenterAwarenessState>;
  const viewport = candidate.viewport;
  return candidate.active === true && Number.isSafeInteger(candidate.sequence) && (candidate.sequence ?? -1) >= 0
    && typeof candidate.diagram_id === 'string' && candidate.diagram_id.length > 0
    && Boolean(viewport) && Number.isFinite(viewport?.pan_x) && Number.isFinite(viewport?.pan_y)
    && Number.isFinite(viewport?.zoom) && (viewport?.zoom ?? 0) >= 0.1 && (viewport?.zoom ?? 5) <= 4
    && (candidate.spotlight_sequence === undefined
      || (Number.isSafeInteger(candidate.spotlight_sequence) && candidate.spotlight_sequence >= 0));
}

export function readPresenterPeers(states: ReadonlyMap<number, unknown>, localClientId: number): PresenterPeer[] {
  const peers: PresenterPeer[] = [];
  for (const [clientId, value] of states) {
    if (clientId === localClientId || !value || typeof value !== 'object') continue;
    const state = value as Partial<AwarenessState>;
    if (!state.user || !isPresenter(state.presenter)) continue;
    peers.push({ clientId, participant: state.user, presenter: state.presenter });
  }
  return peers.sort((a, b) => a.clientId - b.clientId);
}

function quantizeCamera(camera: CanvasCameraState): CanvasCameraState {
  return {
    panX: Math.round(camera.panX / CAMERA_GRID) * CAMERA_GRID,
    panY: Math.round(camera.panY / CAMERA_GRID) * CAMERA_GRID,
    zoom: Math.round(camera.zoom * 1_000) / 1_000,
  };
}

export function usePresenterFollow(
  awareness: AwarenessLike | null,
  activeDiagramId: string | null,
  selectDiagram: (diagramId: string) => void,
) {
  const [peers, setPeers] = useState<PresenterPeer[]>([]);
  const [presenting, setPresenting] = useState(false);
  const [followingClientId, setFollowingClientId] = useState<number | null>(null);
  const cameraRef = useRef<CanvasCameraState>({ panX: 24, panY: 24, zoom: 1 });
  const publisherRef = useRef<PresenterAwarenessPublisher | null>(null);
  const ignoredSpotlightsRef = useRef(new Set<string>());

  useEffect(() => {
    if (!awareness) {
      setPeers([]);
      setFollowingClientId(null);
      setPresenting(false);
      return;
    }
    const publisher = new PresenterAwarenessPublisher((state) => awareness.setLocalStateField('presenter', state));
    publisherRef.current = publisher;
    const sync = () => setPeers(readPresenterPeers(awareness.getStates(), awareness.clientID));
    sync();
    awareness.on('change', sync);
    return () => {
      awareness.off('change', sync);
      publisher.destroy();
      if (publisherRef.current === publisher) publisherRef.current = null;
    };
  }, [awareness]);

  useEffect(() => {
    if (!followingClientId) return;
    const peer = peers.find((candidate) => candidate.clientId === followingClientId);
    if (!peer) {
      setFollowingClientId(null);
      return;
    }
    if (peer.presenter.diagram_id !== activeDiagramId) selectDiagram(peer.presenter.diagram_id);
  }, [activeDiagramId, followingClientId, peers, selectDiagram]);

  useEffect(() => {
    if (presenting && activeDiagramId) publisherRef.current?.update(activeDiagramId, cameraRef.current);
  }, [activeDiagramId, presenting]);

  const followedPeer = peers.find((peer) => peer.clientId === followingClientId) ?? null;
  const followedCamera = followedPeer ? {
    panX: followedPeer.presenter.viewport.pan_x,
    panY: followedPeer.presenter.viewport.pan_y,
    zoom: followedPeer.presenter.viewport.zoom,
  } : null;

  const incomingSpotlight = useMemo(
    () => selectIncomingSpotlight(peers, ignoredSpotlightsRef.current),
    [peers],
  );

  const stopFollowing = useCallback(() => setFollowingClientId(null), []);
  const startFollowing = useCallback((clientId: number) => {
    setPresenting(false);
    publisherRef.current?.stop();
    setFollowingClientId(clientId);
  }, []);
  const startPresenting = useCallback(() => {
    if (!activeDiagramId) return;
    setFollowingClientId(null);
    setPresenting(true);
    publisherRef.current?.start(activeDiagramId, cameraRef.current);
  }, [activeDiagramId]);
  const stopPresenting = useCallback(() => {
    setPresenting(false);
    publisherRef.current?.stop();
  }, []);
  const requestSpotlight = useCallback(() => publisherRef.current?.spotlight(), []);
  const ignoreSpotlight = useCallback((peer: PresenterPeer) => {
    ignoredSpotlightsRef.current.add(`${peer.clientId}:${peer.presenter.spotlight_sequence}`);
    setPeers((current) => [...current]);
  }, []);
  const acceptSpotlight = useCallback((peer: PresenterPeer) => {
    ignoredSpotlightsRef.current.add(`${peer.clientId}:${peer.presenter.spotlight_sequence}`);
    startFollowing(peer.clientId);
  }, [startFollowing]);
  const onCameraChange = useCallback((next: CanvasCameraState) => {
    const quantized = quantizeCamera(next);
    cameraRef.current = quantized;
    if (activeDiagramId) publisherRef.current?.update(activeDiagramId, quantized);
  }, [activeDiagramId]);

  return { acceptSpotlight, followedCamera, followedPeer, followingClientId, ignoreSpotlight, incomingSpotlight, onCameraChange,
    peers, presenting, requestSpotlight, startFollowing, startPresenting, stopFollowing, stopPresenting };
}
