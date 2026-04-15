import { describe, expect, it } from 'vitest';
import { healthResponse } from './health.js';

describe('healthResponse', () => {
  it('returns the scaffold status payload', () => {
    expect(healthResponse()).toEqual({
      name: 'MermaidFlow',
      status: 'ok',
      phase: 'scaffold',
    });
  });
});
