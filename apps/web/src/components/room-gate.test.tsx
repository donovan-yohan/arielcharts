import { renderToStaticMarkup } from 'react-dom/server';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { canMountProtectedWorkspace, RoomGateView, shouldClearRoomKeyFragmentAfterExchangeError, type RoomGateState } from './room-gate';
import { RoomAccessApiError } from '../lib/room-access-api';
import { SessionWorkspace } from './session-workspace';

vi.mock('./session-workspace', () => ({
  SessionWorkspace: vi.fn(() => <div data-testid="protected-workspace">workspace</div>),
}));

const noop = () => undefined;

beforeEach(() => {
  vi.mocked(SessionWorkspace).mockClear();
});

describe('RoomGate', () => {
  it('clears a fragment only after a genuine room-key rejection', () => {
    expect(shouldClearRoomKeyFragmentAfterExchangeError(new RoomAccessApiError(401))).toBe(true);
    expect(shouldClearRoomKeyFragmentAfterExchangeError(new RoomAccessApiError(500))).toBe(false);
    expect(shouldClearRoomKeyFragmentAfterExchangeError(new TypeError('network unavailable'))).toBe(false);
  });

  it.each<RoomGateState>([
    { status: 'checking' },
    { status: 'locked', failed: false },
    { status: 'locked', failed: true },
  ])('does not mount the WebSocket/history-owning workspace before authorization: $status', (gateState) => {
    const markup = renderToStaticMarkup(
      <RoomGateView gateState={gateState} isSubmitting={false} onRoomKeyChange={noop} onSubmit={noop} roomKeyDraft="" sessionId="abc123de" />,
    );

    expect(canMountProtectedWorkspace(gateState)).toBe(false);
    expect(vi.mocked(SessionWorkspace)).not.toHaveBeenCalled();
    expect(markup).not.toContain('protected-workspace');
  });

  it('mounts the protected workspace only after authorization and passes the in-memory key', () => {
    const gateState: RoomGateState = { status: 'authorized', roomKey: 'raw-key' };
    renderToStaticMarkup(
      <RoomGateView gateState={gateState} isSubmitting={false} onRoomKeyChange={noop} onSubmit={noop} roomKeyDraft="" sessionId="abc123de" />,
    );

    expect(canMountProtectedWorkspace(gateState)).toBe(true);
    expect(vi.mocked(SessionWorkspace)).toHaveBeenCalledWith(
      expect.objectContaining({ initialRoomKey: 'raw-key', sessionId: 'abc123de' }),
      undefined,
    );
  });
});
