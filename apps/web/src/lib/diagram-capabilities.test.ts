import { describe, expect, it } from 'vitest';
import { classifyDiagramCapability, isStructurallyEditableDiagram } from './diagram-capabilities';

describe('diagram capabilities', () => {
  it('grants structural editing only to parser-reported flowchart types', () => {
    expect(classifyDiagramCapability('flowchart-v2')).toMatchObject({ kind: 'flowchart' });
    expect(classifyDiagramCapability('Flowchart')).toMatchObject({ kind: 'flowchart' });
    expect(isStructurallyEditableDiagram(classifyDiagramCapability('sequence'))).toBe(false);
  });

  it('keeps unknown and future parser types generic and source-editable', () => {
    expect(classifyDiagramCapability('timeline')).toMatchObject({ kind: 'generic' });
    expect(classifyDiagramCapability('future-diagram-v9')).toMatchObject({ kind: 'generic' });
  });
});
