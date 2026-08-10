import { describe, expect, it } from 'vitest';
import { formatMermaidForGitHub } from './github-mermaid';

describe('formatMermaidForGitHub', () => {
  it("wraps Mermaid source in GitHub's mermaid fence", () => {
    expect(formatMermaidForGitHub('flowchart LR\n  A --> B')).toBe('```mermaid\nflowchart LR\n  A --> B\n```');
  });

  it('normalizes source line endings without changing the diagram text', () => {
    expect(formatMermaidForGitHub('flowchart LR\r\n  A --> B\r')).toBe('```mermaid\nflowchart LR\n  A --> B\n```');
  });

  it('keeps an existing final newline as the fence separator', () => {
    expect(formatMermaidForGitHub('flowchart LR\n  A --> B\n')).toBe('```mermaid\nflowchart LR\n  A --> B\n```');
  });

  it.each([
    ['three embedded backticks', 'flowchart LR\n  A[```]', '````mermaid\nflowchart LR\n  A[```]\n````'],
    ['a longer embedded run', 'flowchart LR\n  A[`````]', '``````mermaid\nflowchart LR\n  A[`````]\n``````'],
  ])('uses a longer fence for %s', (_label, source, expected) => {
    expect(formatMermaidForGitHub(source)).toBe(expected);
  });
});
