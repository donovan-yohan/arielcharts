import { describe, expect, it } from 'vitest';
import { getPairedSemanticPanelPlacement } from './canvas-semantic-panels';

describe('paired semantic panel placement', () => {
  it('keeps C4 and Block panels side-by-side inside a wide unobscured viewport', () => {
    expect(getPairedSemanticPanelPlacement({ height: 700 }, { height: 600, width: 900, x: 0, y: 0 }, 64)).toEqual({
      stacked: false,
      containment: { bottom: 164, left: 12, width: 400 },
      editor: { bottom: 164, left: 488, width: 400 },
    });
  });

  it('stacks paired sections at full usable narrow width', () => {
    const placement = getPairedSemanticPanelPlacement({ height: 600 }, { height: 600, width: 360, x: 0, y: 0 }, 48);
    expect(placement).toEqual({
      stacked: true,
      containment: { bottom: 48, left: 12, width: 336 },
      editor: { bottom: 48, left: 12, width: 336 },
    });
  });

  it('uses the unobscured viewport origin and bottom rather than the full canvas', () => {
    expect(getPairedSemanticPanelPlacement({ height: 800 }, { height: 500, width: 520, x: 40, y: 100 }, 40)).toEqual({
      stacked: true,
      containment: { bottom: 240, left: 52, width: 496 },
      editor: { bottom: 240, left: 52, width: 496 },
    });
  });
});
