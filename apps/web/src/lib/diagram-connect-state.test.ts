import { describe, expect, it } from 'vitest';
import { getConnectNodeActivation } from './diagram-connect-state';

describe('getConnectNodeActivation', () => {
  it('uses one source/target flow for keyboard and pointer activation', () => {
    const bounds = new Map([
      ['source', { height: 20, width: 40, x: 10, y: 20 }],
      ['target', { height: 40, width: 20, x: 110, y: 100 }],
    ]);
    expect(getConnectNodeActivation('source', null, bounds)).toEqual({ kind: 'choose-source', nodeId: 'source' });
    expect(getConnectNodeActivation('target', 'source', bounds)).toEqual({
      kind: 'choose-target', edge: { midpoint: { x: 75, y: 75 }, source: 'source', target: 'target' },
    });
  });

  it('does not create a self-edge for a repeated activation', () => {
    expect(getConnectNodeActivation('source', 'source', null)).toEqual({ kind: 'noop' });
  });
});
