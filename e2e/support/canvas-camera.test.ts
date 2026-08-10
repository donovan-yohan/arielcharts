import { describe, expect, it } from 'vitest';
import { getCameraPerturbationKey } from './canvas-camera';

describe('getCameraPerturbationKey', () => {
  it('moves away from either canvas zoom cap', () => {
    expect(getCameraPerturbationKey('transform: translate(0px, 0px) scale(0.2);')).toBe('=');
    expect(getCameraPerturbationKey('transform: translate(0px, 0px) scale(1);')).toBe('=');
    expect(getCameraPerturbationKey('transform: translate(0px, 0px) scale(3);')).toBe('-');
    expect(getCameraPerturbationKey('transform: translate(0px, 0px) scale(4);')).toBe('-');
  });

  it('rejects an unreadable viewport transform', () => {
    expect(() => getCameraPerturbationKey(null)).toThrow('Could not read React Flow zoom');
  });
});
