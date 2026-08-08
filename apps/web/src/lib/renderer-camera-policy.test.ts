import { describe, expect, it } from 'vitest';
import { getRendererKind, shouldFitRendererKindTransition } from './renderer-camera-policy';

describe('renderer camera policy', () => {
  it('fits only when the renderer changes between editable and static', () => {
    expect(shouldFitRendererKindTransition(null, 'editable')).toBe(false);
    expect(shouldFitRendererKindTransition('editable', 'editable')).toBe(false);
    expect(shouldFitRendererKindTransition('editable', 'static')).toBe(true);
    expect(shouldFitRendererKindTransition('static', 'editable')).toBe(true);
  });

  it('derives renderer kind from the capability boundary', () => {
    expect(getRendererKind(true)).toBe('editable');
    expect(getRendererKind(false)).toBe('static');
  });
});
