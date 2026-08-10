import { describe, expect, it } from 'vitest';
import { getConnectModeSourceId, getConnectNodeActivation } from './diagram-connect-state';

describe('getConnectModeSourceId', () => {
  it('uses exactly one selected node as the initial connect source', () => {
    expect(getConnectModeSourceId([])).toBeNull();
    expect(getConnectModeSourceId(['source'])).toBe('source');
    expect(getConnectModeSourceId(['source', 'target'])).toBeNull();
  });
});

describe('getConnectNodeActivation', () => {
  it('runs source and target selections through one activation flow', () => {
    const nodeBounds = new Map([
      ['source', { height: 20, width: 40, x: 10, y: 20 }],
      ['target', { height: 40, width: 20, x: 110, y: 100 }],
    ]);

    expect(getConnectNodeActivation('source', null, nodeBounds)).toEqual({
      kind: 'choose-source',
      nodeId: 'source',
    });
    expect(getConnectNodeActivation('target', 'source', nodeBounds)).toEqual({
      edge: {
        midpoint: { x: 75, y: 75 },
        source: 'source',
        target: 'target',
      },
      kind: 'choose-target',
    });
  });

  it('does not turn a repeated source activation into a self edge', () => {
    expect(getConnectNodeActivation('source', 'source', null)).toEqual({ kind: 'noop' });
  });
});
