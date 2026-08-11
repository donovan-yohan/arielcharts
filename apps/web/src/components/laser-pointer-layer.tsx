'use client';

import type { CanvasLaserState, CanvasPresenceEntry, CanvasWorldPoint, Participant } from '@arielcharts/shared';
import { useEffect, useMemo, useRef, useState } from 'react';

export const LASER_TRAIL_TIMEOUT_MS = 900;
const MAX_TRAIL_POINTS = 12;

type LaserSource = { id: string; laser: CanvasLaserState; participant: Participant };
type TrailPoint = { point: CanvasWorldPoint; receivedAt: number; sequence: number };

export function LaserPointerLayer({
  local,
  localParticipant,
  remote,
  transform,
}: {
  local: CanvasLaserState | null;
  localParticipant: Participant;
  remote: readonly CanvasPresenceEntry[];
  transform: { x: number; y: number; zoom: number };
}) {
  const trailsRef = useRef(new Map<string, TrailPoint[]>());
  const lastSequenceRef = useRef(new Map<string, number>());
  const [now, setNow] = useState(() => Date.now());
  const sources = useMemo<LaserSource[]>(() => [
    ...(local ? [{ id: 'local', laser: local, participant: localParticipant }] : []),
    ...remote.flatMap((presence) => presence.canvas.laser
      ? [{ id: String(presence.client_id), laser: presence.canvas.laser, participant: presence.participant }]
      : []),
  ], [local, localParticipant, remote]);

  useEffect(() => {
    const receivedAt = Date.now();
    const activeIds = new Set(sources.map((source) => source.id));
    for (const id of trailsRef.current.keys()) {
      if (!activeIds.has(id)) {
        trailsRef.current.delete(id);
        lastSequenceRef.current.delete(id);
      }
    }
    for (const source of sources) {
      const previousSequence = lastSequenceRef.current.get(source.id) ?? -1;
      if (source.laser.sequence <= previousSequence) continue;
      lastSequenceRef.current.set(source.id, source.laser.sequence);
      if (!source.laser.active || !source.laser.point) {
        trailsRef.current.delete(source.id);
        continue;
      }
      const trail = trailsRef.current.get(source.id) ?? [];
      trailsRef.current.set(source.id, [...trail, {
        point: source.laser.point,
        receivedAt,
        sequence: source.laser.sequence,
      }].slice(-MAX_TRAIL_POINTS));
    }
    setNow(receivedAt);
  }, [sources]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, []);

  return <div aria-hidden="true" className="laser-pointer-layer" data-testid="laser-pointer-layer">
    {sources.flatMap((source) => (trailsRef.current.get(source.id) ?? [])
      .filter((sample) => now - sample.receivedAt < LASER_TRAIL_TIMEOUT_MS)
      .map((sample, index, trail) => {
        const ageOpacity = 1 - ((now - sample.receivedAt) / LASER_TRAIL_TIMEOUT_MS);
        const trailOpacity = (index + 1) / trail.length;
        return <span
          className="laser-pointer-sample"
          data-participant-name={source.participant.name}
          data-sequence={sample.sequence}
          data-testid={`laser-pointer-${source.id}`}
          key={`${source.id}-${sample.sequence}`}
          style={{
            background: source.participant.color,
            color: source.participant.color,
            left: (sample.point.x * transform.zoom) + transform.x,
            opacity: Math.max(0, ageOpacity * trailOpacity),
            top: (sample.point.y * transform.zoom) + transform.y,
          }}
          title={source.participant.name}
        >
          {index === trail.length - 1 ? <span className="laser-pointer-label">{source.participant.name}</span> : null}
        </span>;
      }))}
  </div>;
}
