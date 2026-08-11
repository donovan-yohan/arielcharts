// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { addIshikawaCause, createIshikawaDiagram, deleteIshikawaCause, editIshikawaCause, editIshikawaEffect, getIshikawaCauseIdentity, getIshikawaDiagramSnapshot, isIshikawaSourceRepresentable, moveIshikawaCause, reparentIshikawaCause } from './ishikawa-mutations';

const SOURCE = `---
config:
  theme: neutral
---
%% authored note remains source-owned
ishikawa-beta
  Blurry photo
  Process
    Out of focus
    Shutter speed
  Equipment
    Lens
      Dirty lens`;

describe('Ishikawa source mutations', () => {
  it('uses Mermaid 11.16.1 native effect-and-indented-label syntax', async () => {
    const source = `ishikawa-beta
  Blurry photo
  Process
    Out of focus
  Equipment
    Lens
      Dirty lens`;
    mermaid.initialize({ startOnLoad: false });
    await expect(mermaid.parse(source)).resolves.toMatchObject({ diagramType: 'ishikawa' });
    expect(createIshikawaDiagram('Delivery delay')).toBe('ishikawa-beta\n  Delivery delay');
  });
  it('snapshots the native effect and labels as an indentation hierarchy', () => {
    expect(getIshikawaDiagramSnapshot(SOURCE)).toEqual({ effect: 'Blurry photo', causes: [
      { label: 'Process', depth: 1, ancestorLabels: [] },
      { label: 'Out of focus', depth: 2, ancestorLabels: ['Process'] },
      { label: 'Shutter speed', depth: 2, ancestorLabels: ['Process'] },
      { label: 'Equipment', depth: 1, ancestorLabels: [] },
      { label: 'Lens', depth: 2, ancestorLabels: ['Equipment'] },
      { label: 'Dirty lens', depth: 3, ancestorLabels: ['Equipment', 'Lens'] },
    ] });
  });
  it('adds, edits, deletes, reorders, and reparents complete cause trees', () => {
    const snapshot = getIshikawaDiagramSnapshot(SOURCE); const process = getIshikawaCauseIdentity(snapshot.causes[0]!, snapshot.causes); const equipment = getIshikawaCauseIdentity(snapshot.causes[3]!, snapshot.causes);
    const added = addIshikawaCause(SOURCE, { label: 'Training', parent: process });
    expect(added).toContain('    Training');
    const editedSnapshot = getIshikawaDiagramSnapshot(added); const training = getIshikawaCauseIdentity(editedSnapshot.causes.find((entry) => entry.label === 'Training')!, editedSnapshot.causes);
    const edited = editIshikawaCause(added, training, { label: 'Operator training' });
    expect(edited).toContain('    Operator training');
    const moved = moveIshikawaCause(edited, equipment, 'up');
    expect(moved.indexOf('Equipment')).toBeLessThan(moved.indexOf('Process'));
    const movedSnapshot = getIshikawaDiagramSnapshot(moved); const lens = getIshikawaCauseIdentity(movedSnapshot.causes.find((entry) => entry.label === 'Lens')!, movedSnapshot.causes); const processAfterMove = getIshikawaCauseIdentity(movedSnapshot.causes.find((entry) => entry.label === 'Process')!, movedSnapshot.causes);
    const reparented = reparentIshikawaCause(moved, lens, processAfterMove);
    expect(getIshikawaDiagramSnapshot(reparented).causes.find((entry) => entry.label === 'Lens')).toMatchObject({ ancestorLabels: ['Process'], depth: 2 });
    const afterReparent = getIshikawaDiagramSnapshot(reparented); const processForDelete = getIshikawaCauseIdentity(afterReparent.causes.find((entry) => entry.label === 'Process')!, afterReparent.causes);
    expect(deleteIshikawaCause(reparented, processForDelete)).not.toContain('Dirty lens');
    expect(editIshikawaEffect(SOURCE, 'Soft photo')).toContain('  Soft photo');
  });
  it('inserts a child directly after its selected parent subtree without changing final-newline policy', () => {
    for (const ending of ['\n', '\r\n', '\r']) {
      const source = ['ishikawa-beta', '  Delivery delay', '  Process', '    Existing', '  Equipment'].join(ending);
      const causes = getIshikawaDiagramSnapshot(source).causes;
      const process = getIshikawaCauseIdentity(causes[0]!, causes);
      expect(addIshikawaCause(source, { label: 'Training', parent: process })).toBe([
        'ishikawa-beta', '  Delivery delay', '  Process', '    Existing', '    Training', '  Equipment',
      ].join(ending));
    }
  });
  it('resolves semantic paths after remote prepends and fails closed for duplicates or cycles', () => {
    const snapshot = getIshikawaDiagramSnapshot(SOURCE); const equipment = getIshikawaCauseIdentity(snapshot.causes[3]!, snapshot.causes);
    const remote = SOURCE.replace('  Process', '  People\n  Process');
    expect(editIshikawaCause(remote, equipment, { label: 'Hardware' })).toContain('  Hardware');
    const duplicate = `${SOURCE}\n  Equipment`; const duplicates = getIshikawaDiagramSnapshot(duplicate).causes; const ambiguous = getIshikawaCauseIdentity(duplicates.filter((entry) => entry.label === 'Equipment')[0]!, duplicates);
    expect(() => editIshikawaCause(duplicate, ambiguous, { label: 'Nope' })).toThrow('changed remotely');
    const current = getIshikawaDiagramSnapshot(SOURCE); const process = getIshikawaCauseIdentity(current.causes[0]!, current.causes); const focus = getIshikawaCauseIdentity(current.causes[1]!, current.causes);
    expect(() => reparentIshikawaCause(SOURCE, process, focus)).toThrow('cannot contain itself');
  });
  it('fails closed when remote causes duplicate an ancestor path prefix', () => {
    const source = 'ishikawa-beta\n  Effect\n  Process\n    Target\n  Equipment';
    const causes = getIshikawaDiagramSnapshot(source).causes;
    const target = getIshikawaCauseIdentity(causes.find((cause) => cause.label === 'Target')!, causes);
    const equipment = getIshikawaCauseIdentity(causes.find((cause) => cause.label === 'Equipment')!, causes);
    const remote = 'ishikawa-beta\n  Effect\n  Process\n    Target\n  Process\n    Other\n  Equipment';
    const remoteCauses = getIshikawaDiagramSnapshot(remote).causes;
    expect(getIshikawaCauseIdentity(remoteCauses.find((cause) => cause.label === 'Target')!, remoteCauses).occurrenceCount).toBe(0);
    expect(() => editIshikawaCause(remote, target, { label: 'Edited' })).toThrow('changed remotely');
    expect(() => deleteIshikawaCause(remote, target)).toThrow('changed remotely');
    expect(() => moveIshikawaCause(remote, target, 'up')).toThrow('changed remotely');
    expect(() => reparentIshikawaCause(remote, target, equipment)).toThrow('changed remotely');
  });
  it('preserves BOM, frontmatter, comments, and positional terminators for reorders', () => {
    for (const ending of ['\n', '\r\n', '\r']) {
      const source = `\uFEFF---${ending}title: owned${ending}---${ending}%% note${ending}ishikawa-beta${ending}  Effect${ending}  First${ending}    Child${ending}  Second`;
      const snapshot = getIshikawaDiagramSnapshot(source); const second = getIshikawaCauseIdentity(snapshot.causes[2]!, snapshot.causes); const moved = moveIshikawaCause(source, second, 'up');
      expect(moved.match(/\r\n|\n|\r/g)).toEqual(source.match(/\r\n|\n|\r/g)); expect(moved.startsWith('\uFEFF---')).toBe(true); expect(moved).toContain('%% note');
    }
  });
  it('fails closed for unsupported directives, malformed indentation, and non-Ishikawa source', () => {
    expect(isIshikawaSourceRepresentable('ishikawa-beta')).toBe(false);
    expect(isIshikawaSourceRepresentable('ishikawa-beta\n  Effect\n  Parent\n      Skipped level')).toBe(false);
    expect(isIshikawaSourceRepresentable('ishikawa-beta\n  Effect\n\tParent')).toBe(false);
    expect(isIshikawaSourceRepresentable('%%{init: {}}%%\nishikawa-beta\n  Effect')).toBe(false);
    expect(isIshikawaSourceRepresentable('mindmap\n  Root')).toBe(false);
  });
});
