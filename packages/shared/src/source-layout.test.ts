import { describe, expect, it } from 'vitest';
import { getSourceLayoutPolicy, resolveSourceLayoutPolicy } from './source-layout.js';

describe('source layout policy', () => {
  it('uses flowchart parser membership synchronously', () => {
    const policy = getSourceLayoutPolicy('flowchart LR\n  A --> B\n  B --> C');

    expect(policy).toMatchObject({ kind: 'flowchart', pruneDurablePositions: true });
    expect([...policy.nodeIds].sort()).toEqual(['A', 'B', 'C']);
  });

  it('distinguishes accepted generic source from invalid source without clearing early', async () => {
    await expect(resolveSourceLayoutPolicy('sequenceDiagram\n  Browser->>API: request')).resolves.toMatchObject({
      kind: 'generic',
      pruneDurablePositions: true,
    });
    await expect(resolveSourceLayoutPolicy('not valid Mermaid')).resolves.toMatchObject({
      kind: 'indeterminate',
      pruneDurablePositions: false,
    });
  });
});
