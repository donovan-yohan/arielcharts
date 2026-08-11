// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { addRadarAxis, addRadarCurve, createRadarDiagram, deleteRadarAxis, deleteRadarCurve, editRadarAxis, editRadarCurve, editRadarOptions, editRadarTitle, getRadarAxisIdentity, getRadarCurveIdentity, getRadarDiagramSnapshot, isRadarSourceRepresentable, moveRadarAxis, moveRadarCurve } from './radar-mutations';

const SOURCE = `\uFEFF---
config:
  theme: neutral
---
%% authored note
%%{init: {}}%%
radar-beta:
  title Team skills
  axis speed ["Speed"]
  axis quality ["Quality"]
  axis safety ["Safety"]
  axis cost ["Cost"]
  curve current ["Current"] { 4, 5, 3, 2 }
  curve target ["Target"] { 5, 5, 4, 3 }
  ticks 5
  min 0
  max 5
  showLegend true
  graticule polygon`;

function axisIdentity(source: string, index: number) { const snapshot = getRadarDiagramSnapshot(source); return getRadarAxisIdentity(snapshot.axes[index]!, snapshot.axes); }
function curveIdentity(source: string, index: number) { const snapshot = getRadarDiagramSnapshot(source); return getRadarCurveIdentity(snapshot.curves[index]!, snapshot.curves); }

describe('Radar source mutations', () => {
  it('models Mermaid 11.16.1 axes, labels, numeric curves, ranges, ticks, and display options', async () => {
    mermaid.initialize({ startOnLoad: false }); await expect(mermaid.parse(SOURCE)).resolves.toMatchObject({ diagramType: 'radar' });
    expect(getRadarDiagramSnapshot(SOURCE)).toMatchObject({ title: 'Team skills', axes: [{ name: 'speed', label: 'Speed' }, { name: 'quality', label: 'Quality' }, { name: 'safety', label: 'Safety' }, { name: 'cost', label: 'Cost' }], curves: [{ name: 'current', label: 'Current', values: [4, 5, 3, 2] }, { name: 'target', label: 'Target', values: [5, 5, 4, 3] }], options: { ticks: 5, min: 0, max: 5, showLegend: true, graticule: 'polygon' } });
    const created = createRadarDiagram([{ name: 'a' }, { name: 'b' }, { name: 'c' }]); expect(created).toBe('radar-beta\n  axis a\n  axis b\n  axis c'); await expect(mermaid.parse(created)).resolves.toMatchObject({ diagramType: 'radar' });
  });

  it('adds, edits, deletes, and reorders curves and axes without losing their positional values', async () => {
    mermaid.initialize({ startOnLoad: false });
    const addedCurve = addRadarCurve(SOURCE, { name: 'forecast', values: [3, 4, 4, 4] });
    const editedCurve = editRadarCurve(addedCurve, curveIdentity(addedCurve, 2), { label: 'Forecast', values: [4, 4, 4, 4] });
    const movedCurve = moveRadarCurve(editedCurve, curveIdentity(editedCurve, 2), 'up');
    const withAxis = addRadarAxis(movedCurve, { name: 'scope', label: 'Scope' }, [4, 5, 3]);
    const movedAxis = moveRadarAxis(withAxis, axisIdentity(withAxis, 4), 'up');
    const renamedAxis = editRadarAxis(movedAxis, axisIdentity(movedAxis, 0), { label: 'Velocity' });
    const options = editRadarOptions(editRadarTitle(renamedAxis, 'Updated skills'), { ticks: 4, graticule: 'circle' });
    const deletedCurve = deleteRadarCurve(options, curveIdentity(options, 1));
    const deletedAxis = deleteRadarAxis(deletedCurve, axisIdentity(deletedCurve, 4));
    expect(getRadarDiagramSnapshot(deletedAxis).curves.every((curve) => curve.values.length === 4)).toBe(true);
    expect(deletedAxis).toContain('title Updated skills'); expect(deletedAxis).toContain('ticks 4'); expect(deletedAxis).toContain('graticule circle'); await expect(mermaid.parse(deletedAxis)).resolves.toMatchObject({ diagramType: 'radar' });
    expect(editRadarTitle(deletedAxis, undefined)).not.toContain('title Updated skills');
  });

  it('preserves BOM, frontmatter, comments, directives, and positional mixed terminators', () => {
    const source = SOURCE.replace(/\n/g, '\r\n').replace('  axis quality', '  axis quality').replace('\r\n  axis safety', '\n  axis safety').replace('\r\n  axis cost', '\r  axis cost');
    const moved = moveRadarCurve(source, curveIdentity(source, 1), 'up');
    expect(moved.startsWith('\uFEFF---\r\n')).toBe(true); expect(moved).toContain('%% authored note'); expect(moved).toContain('%%{init: {}}%%'); expect(moved.match(/\r\n|\n|\r/g)).toEqual(source.match(/\r\n|\n|\r/g));
    const appended = addRadarCurve(SOURCE, { name: 'forecast', values: [1, 2, 3, 4] }); const reordered = moveRadarCurve(appended, curveIdentity(appended, 2), 'up'); const deleted = deleteRadarCurve(reordered, curveIdentity(reordered, 2)); expect(/(?:\r\n|\n|\r)$/.test(deleted)).toBe(false);
  });

  it('deletes an axis and rewrites interleaved curves atomically from original line positions', () => {
    const source = 'radar-beta\r\n  curve early { 10, 20, 30, 40 }\n  %% keep between curve and axes\r  axis a\r\n  axis b\n  axis c\r  axis d\r\n  %% keep before later curve\n  curve later { 1, 2, 3, 4 }';
    const deleted = deleteRadarAxis(source, axisIdentity(source, 1));
    expect(deleted).toBe('radar-beta\r\n  curve early { 10, 30, 40 }\n  %% keep between curve and axes\r  axis a\r\n  axis c\r  axis d\r\n  %% keep before later curve\n  curve later { 1, 3, 4 }');
    expect(getRadarDiagramSnapshot(deleted).curves.map((curve) => curve.values)).toEqual([[10, 30, 40], [1, 3, 4]]);
  });

  it('keeps options presence-aware, preserves unchanged lines, and permits values above the absent default max', async () => {
    mermaid.initialize({ startOnLoad: false });
    const source = 'radar-beta\n  axis a\n  axis b\n  axis c\n  curve wide { 8, 9, 10 }\n  ticks    5\n  min 0\n  showLegend true\n  graticule circle';
    expect(editRadarOptions(source, {})).toBe(source);
    expect(editRadarOptions(source, { ticks: 5, min: 0, showLegend: true, graticule: 'circle' })).toBe(source);
    const withMaximum = editRadarOptions(source, { max: 12 });
    expect(withMaximum).toContain('\n  max 12');
    const removed = editRadarOptions(withMaximum, { max: undefined, ticks: undefined, showLegend: undefined });
    expect(removed).toBe('radar-beta\n  axis a\n  axis b\n  axis c\n  curve wide { 8, 9, 10 }\n  min 0\n  graticule circle');
    expect(getRadarDiagramSnapshot(removed).options).toEqual({ min: 0, graticule: 'circle' });
    await expect(mermaid.parse(removed)).resolves.toMatchObject({ diagramType: 'radar' });
  });

  it('round-trips every safe Mermaid title punctuation form and rejects inline-comment ambiguity', async () => {
    mermaid.initialize({ startOnLoad: false });
    const source = 'radar-beta\n  title [Team] "quality" isn\'t optional\n  axis a\n  axis b\n  axis c';
    expect(getRadarDiagramSnapshot(source).title).toBe('[Team] "quality" isn\'t optional');
    expect(editRadarTitle(source, '[Team] "quality" isn\'t optional')).toBe(source);
    const renamed = editRadarTitle(source, 'Leaders\' "radar" [2026]');
    expect(renamed).toContain('title Leaders\' "radar" [2026]');
    await expect(mermaid.parse(renamed)).resolves.toMatchObject({ diagramType: 'radar' });
    expect(editRadarTitle(renamed, undefined)).toBe('radar-beta\n  axis a\n  axis b\n  axis c');
    expect(isRadarSourceRepresentable('radar-beta\n  title Skills %% authored\n  axis a\n  axis b\n  axis c')).toBe(false);
  });

  it('resolves unique semantics after remote inserts and fails stale under duplicate identities', () => {
    const identity = curveIdentity(SOURCE, 1); const remote = SOURCE.replace('  curve current', '  curve remote { 1, 2, 3, 4 }\n  curve current');
    expect(editRadarCurve(remote, identity, { label: 'Edited' })).toContain('curve target ["Edited"]');
    const duplicate = `${SOURCE}\n  curve target ["Target"] { 5, 5, 4, 3 }`;
    expect(() => editRadarCurve(duplicate, identity, { label: 'Nope' })).toThrow('changed remotely');
  });

  it('fails closed for unfamiliar advanced entries and invalid lengths, names, ranges, and ticks', () => {
    expect(isRadarSourceRepresentable('radar-beta\naxis a\naxis b\naxis c\ncurve x { a: 1, b: 2, c: 3 }')).toBe(false);
    expect(isRadarSourceRepresentable('radar-beta\naxis a\naxis b\naxis c\ncurve x { 1, 2 }')).toBe(false);
    expect(isRadarSourceRepresentable('radar-beta\naxis a\naxis b\naxis c\ncurve x { 1, 2, 3 }\nticks 2.5')).toBe(false);
    expect(isRadarSourceRepresentable('radar-beta\naxis a\naxis b\naxis c\ncurve x { 1, 2, 3 }\nmin 4\nmax 3')).toBe(false);
    expect(isRadarSourceRepresentable('radar-beta\naxis a\naxis a\naxis c\ncurve x { 1, 2, 3 }')).toBe(false);
  });
});
