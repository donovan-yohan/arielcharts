import { describe, expect, it } from 'vitest';
import { classifyDiagramCapability, isStructurallyEditableDiagram } from './diagram-capabilities';

describe('diagram capabilities', () => {
  it('grants structural editing to parser-reported flowchart and sequence types', () => {
    expect(classifyDiagramCapability('flowchart-v2')).toMatchObject({ kind: 'flowchart' });
    expect(classifyDiagramCapability('Flowchart')).toMatchObject({ kind: 'flowchart' });
    expect(classifyDiagramCapability('sequence')).toMatchObject({ kind: 'sequence' });
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('sequence'))).toBe(true);
  });

  it('keeps unknown and future parser types generic and source-editable', () => {
    expect(classifyDiagramCapability('timeline')).toMatchObject({ kind: 'generic' });
    expect(classifyDiagramCapability('future-diagram-v9')).toMatchObject({ kind: 'generic' });
    expect(classifyDiagramCapability('sequence-v2')).toMatchObject({ kind: 'generic' });
  });
});
