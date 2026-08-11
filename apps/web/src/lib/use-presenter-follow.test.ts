import { describe, expect, it } from 'vitest';
import { readPresenterPeers, selectIncomingSpotlight } from './use-presenter-follow';

describe('presenter awareness', () => {
  const user = { name: 'Presenter', color: '#123456', type: 'human' as const };
  const presenter = { active: true, sequence: 2, diagram_id: 'main', viewport: { pan_x: 12, pan_y: 24, zoom: 1.25 } };

  it('returns only valid active remote presenters in stable client order', () => {
    expect(readPresenterPeers(new Map([
      [9, { user, presenter }],
      [1, { user, presenter }],
      [4, { user, presenter: { ...presenter, viewport: { ...presenter.viewport, zoom: 99 } } }],
    ]), 1).map((peer) => peer.clientId)).toEqual([9]);
  });

  it('rejects malformed and inactive presenter payloads atomically', () => {
    expect(readPresenterPeers(new Map([
      [2, { user, presenter: { ...presenter, active: false } }],
      [3, { user, presenter: { ...presenter, diagram_id: '' } }],
      [4, { user, presenter: { ...presenter, sequence: -1 } }],
      [5, { user, presenter: { ...presenter, spotlight_sequence: -1 } }],
    ]), 1)).toEqual([]);
  });

  it('settles concurrent spotlight requests by sequence then client id and honors ignore', () => {
    const peers = readPresenterPeers(new Map([
      [2, { user, presenter: { ...presenter, spotlight_sequence: 7 } }],
      [9, { user: { ...user, name: 'Tie winner' }, presenter: { ...presenter, spotlight_sequence: 7 } }],
      [4, { user, presenter: { ...presenter, spotlight_sequence: 6 } }],
    ]), 1);
    expect(selectIncomingSpotlight(peers, new Set())?.clientId).toBe(9);
    expect(selectIncomingSpotlight(peers, new Set(['9:7']))?.clientId).toBe(2);
  });
});
