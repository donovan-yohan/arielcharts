import { describe, expect, it } from 'vitest';
import { getCompactCollaboratorOverflowCount } from './workspace-footer';

describe('compact collaborator overflow', () => {
  it('keeps the first three collaborators visible and reports the rest', () => {
    expect(getCompactCollaboratorOverflowCount(0)).toBe(0);
    expect(getCompactCollaboratorOverflowCount(3)).toBe(0);
    expect(getCompactCollaboratorOverflowCount(4)).toBe(1);
    expect(getCompactCollaboratorOverflowCount(7)).toBe(4);
  });
});
