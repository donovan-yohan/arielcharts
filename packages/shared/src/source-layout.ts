import { Flowchart } from 'mermaid-ast';

export type SourceLayoutPolicy = {
  kind: 'blank' | 'flowchart' | 'generic' | 'indeterminate';
  nodeIds: Set<string>;
  pruneDurablePositions: boolean;
};

/**
 * Applies the safe synchronous policy used while Mermaid's generic parser is
 * still resolving: blank and flowchart source have canonical membership;
 * malformed-or-generic source cancels pending layout without deleting settled
 * positions yet.
 */
export function getSourceLayoutPolicy(source: string): SourceLayoutPolicy {
  if (!source.trim()) {
    return { kind: 'blank', nodeIds: new Set(), pruneDurablePositions: true };
  }

  try {
    return {
      kind: 'flowchart',
      nodeIds: new Set(Flowchart.parse(source).nodeIds),
      pruneDurablePositions: true,
    };
  } catch {
    return { kind: 'indeterminate', nodeIds: new Set(), pruneDurablePositions: false };
  }
}

export function getAcceptedGenericSourceLayoutPolicy(): SourceLayoutPolicy {
  return { kind: 'generic', nodeIds: new Set(), pruneDurablePositions: true };
}

/** Resolves generic Mermaid source before an authoritative server write. */
export async function resolveSourceLayoutPolicy(source: string): Promise<SourceLayoutPolicy> {
  const policy = getSourceLayoutPolicy(source);
  if (policy.kind !== 'indeterminate') {
    return policy;
  }

  try {
    const { default: mermaid } = await import('mermaid');
    await mermaid.parse(source);
    return getAcceptedGenericSourceLayoutPolicy();
  } catch {
    return policy;
  }
}
