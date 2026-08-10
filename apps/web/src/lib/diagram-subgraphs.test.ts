import { describe, expect, it } from 'vitest';
import {
  canRenameFlowchartSubgraphDeclaration,
  getFlowchartCanvasBounds,
  getInteractiveSubgraphBounds,
  getNestedSubgraphNodeIds,
  renameFlowchartSubgraphDeclaration,
} from './diagram-subgraphs';

describe('flowchart subgraph source edits', () => {
  it('rewrites only the named declaration while preserving nested source byte-for-byte', () => {
    const source = `flowchart TD\n  subgraph outer[Outer]\n    A[A]\n    subgraph inner [Inner] %% keep\n      B[B]\n    end\n    C[C]\n  end\n`;
    expect(renameFlowchartSubgraphDeclaration(source, 'inner', 'Renamed section')).toBe(
      `flowchart TD\n  subgraph outer[Outer]\n    A[A]\n    subgraph inner ["Renamed section"] %% keep\n      B[B]\n    end\n    C[C]\n  end\n`,
    );
  });

  it('rejects implicit-title sections rather than changing their identity', () => {
    expect(() => renameFlowchartSubgraphDeclaration(
      'flowchart TD\n  subgraph My Section\n    A\n  end\n',
      'My Section',
      'Renamed',
    )).toThrow('no unique explicit Mermaid id');
  });

  it('exposes rename only for one explicit declaration', () => {
    expect(canRenameFlowchartSubgraphDeclaration('flowchart TD\n  subgraph stable[Title]\n  end\n', 'stable')).toBe(true);
    expect(canRenameFlowchartSubgraphDeclaration('flowchart TD\n  subgraph Implicit Section\n  end\n', 'Implicit Section')).toBe(false);
    expect(canRenameFlowchartSubgraphDeclaration('flowchart TD\n  subgraph ImplicitSection\n  end\n', 'ImplicitSection')).toBe(false);
    expect(canRenameFlowchartSubgraphDeclaration('flowchart TD\n  subgraph dup[One]\n  end\n  subgraph dup[Two]\n  end\n', 'dup')).toBe(false);
  });
});

describe('nested subgraph canvas geometry', () => {
  it('resolves nested members and carries source padding around their interactive bounds', () => {
    const subgraphs = [
      { id: 'inner', nodes: ['B'] },
      { id: 'outer', nodes: ['A', 'inner', 'C'] },
    ];
    expect(getNestedSubgraphNodeIds('outer', subgraphs, ['A', 'B', 'C'])).toEqual(['A', 'B', 'C']);

    const source = new Map([
      ['A', { x: 20, y: 40, width: 40, height: 20 }],
      ['B', { x: 80, y: 80, width: 40, height: 20 }],
      ['C', { x: 140, y: 40, width: 40, height: 20 }],
    ]);
    const interactive = new Map([...source].map(([id, bounds]) => [id, { ...bounds, x: bounds.x + 30, y: bounds.y + 15 }]));
    expect(getInteractiveSubgraphBounds(
      { x: 10, y: 10, width: 180, height: 110 },
      source,
      interactive,
      ['A', 'B', 'C'],
    )).toEqual({ x: 40, y: 25, width: 180, height: 110 });
  });

  it('fits live and read-only React Flow sections to derived bounds instead of hidden source clusters', () => {
    const nodes = new Map([['A', { x: 420, y: 220, width: 80, height: 40 }]]);
    const sourceSections = new Map([['group', { x: 0, y: 0, width: 120, height: 100 }]]);
    const interactiveSections = new Map([['group', { x: 400, y: 180, width: 140, height: 120 }]]);

    const reactFlowSectionOverlayRendered = true;
    expect(getFlowchartCanvasBounds(nodes, sourceSections, interactiveSections, [], reactFlowSectionOverlayRendered))
      .toEqual({ x: 400, y: 180, width: 140, height: 120 });
    expect(getFlowchartCanvasBounds(nodes, sourceSections, interactiveSections, [], false))
      .toEqual({ x: 0, y: 0, width: 500, height: 260 });
  });
});
