import { describe, expect, it } from 'vitest';
import { getMermaidRenderId } from './mermaid-render-id';

describe('getMermaidRenderId', () => {
  it('keeps opaque history scopes safe for Mermaid DOM selectors', () => {
    const id = getMermaidRenderId('abc123de', 'main:revision:rev/1?latest=true', 7);

    expect(id).toBe('arielcharts-abc123de-main-revision-rev-1-latest-true-7');
    expect(id).toMatch(/^[a-zA-Z][a-zA-Z0-9_-]*$/u);
  });
});
