import { describe, expect, it } from 'vitest';
import { getDefaultMermaidText, isValidSessionId, randomSessionId } from './session';

describe('session helpers', () => {
  it('creates session ids in the expected shape', () => {
    expect(randomSessionId()).toMatch(/^[a-z0-9]{8}$/);
  });

  it('validates supported session ids', () => {
    expect(isValidSessionId('a7x9k2mn')).toBe(true);
    expect(isValidSessionId('bad id')).toBe(false);
  });

  it('returns starter mermaid text', () => {
    expect(getDefaultMermaidText()).toContain('graph TD');
  });
});
