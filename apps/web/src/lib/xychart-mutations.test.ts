// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { addXySeries, createXyChartDiagram, deleteXySeries, editXyAxis, editXySeries, editXyTitle, getXyChartDiagramSnapshot, getXySeriesIdentity, isXyChartSourceRepresentable, moveXySeries, setXyOrientation } from './xychart-mutations';

const SOURCE = `\uFEFF---
config:
  theme: neutral
---
%% authored note
%%{init: {}}%%
xychart-beta horizontal
  title Revenue
  x-axis "Month" ["Jan", "Feb", "Mar"]
  y-axis "Sales" 0 --> 10
  line "Recurring" [2, 4, 6]
  bar "One time" [1, 3, 5]`;

function seriesIdentity(source: string, index: number) { const snapshot = getXyChartDiagramSnapshot(source); return getXySeriesIdentity(snapshot.series[index]!, snapshot.series); }

describe('XY chart source mutations', () => {
  it('models Mermaid 11.16.1 axes, ranges, labels, orientations, and line/bar series', async () => {
    mermaid.initialize({ startOnLoad: false });
    await expect(mermaid.parse(SOURCE)).resolves.toMatchObject({ diagramType: 'xychart' });
    expect(getXyChartDiagramSnapshot(SOURCE)).toMatchObject({ orientation: 'horizontal', xAxis: { label: 'Month', labels: ['Jan', 'Feb', 'Mar'] }, yAxis: { label: 'Sales', range: [0, 10] }, series: [{ kind: 'line', label: 'Recurring', values: [2, 4, 6] }, { kind: 'bar', values: [1, 3, 5] }] });
    const created = createXyChartDiagram({ labels: ['Jan', 'Feb'] }, { range: [0, 5] }); expect(created).toBe('xychart-beta\n  x-axis ["Jan", "Feb"]\n  y-axis 0 --> 5'); await expect(mermaid.parse(created)).resolves.toMatchObject({ diagramType: 'xychart' });
  });

  it('adds, edits, deletes, and reorders source-backed series', async () => {
    mermaid.initialize({ startOnLoad: false });
    const added = addXySeries(SOURCE, { kind: 'line', label: 'Forecast', values: [4, 5, 7] });
    const edited = editXySeries(added, seriesIdentity(added, 2), { kind: 'bar', values: [5, 6, 8] });
    const moved = moveXySeries(edited, seriesIdentity(edited, 2), 'up');
    const deleted = deleteXySeries(moved, seriesIdentity(moved, 0));
    const axisChanged = editXyAxis(deleted, 'y', { label: 'Units', range: [0, 12] });
    const titled = editXyTitle(axisChanged, 'Updated revenue'); const oriented = setXyOrientation(titled, 'vertical');
    expect(oriented).toContain('xychart-beta vertical'); expect(oriented).toContain('title Updated revenue');
    expect(oriented).toContain('y-axis "Units" 0 --> 12');
    expect(oriented).toContain('bar "Forecast" [5, 6, 8]');
    await expect(mermaid.parse(oriented)).resolves.toMatchObject({ diagramType: 'xychart' });
    expect(editXyTitle(oriented, undefined)).not.toContain('title Updated revenue');
  });

  it('preserves BOM, frontmatter, comments, directives, terminators, and no-final-newline policy', () => {
    for (const ending of ['\n', '\r\n', '\r']) {
      const source = SOURCE.replace(/\n/g, ending); const moved = moveXySeries(source, seriesIdentity(source, 1), 'up');
      expect(moved.startsWith(`\uFEFF---${ending}`)).toBe(true); expect(moved).toContain('%% authored note'); expect(moved).toContain('%%{init: {}}%%'); expect(moved.match(/\r\n|\n|\r/g)).toEqual(source.match(/\r\n|\n|\r/g));
      const appended = addXySeries(source, { kind: 'line', values: [3, 4, 5] }); expect(/(?:\r\n|\n|\r)$/.test(appended)).toBe(false);
      const reordered = moveXySeries(appended, seriesIdentity(appended, 2), 'up'); const deleted = deleteXySeries(reordered, seriesIdentity(reordered, 2)); expect(/(?:\r\n|\n|\r)$/.test(deleted)).toBe(false);
    }
  });

  it('uses semantic fingerprints after remote prepends and fails stale on duplicates', () => {
    const identity = seriesIdentity(SOURCE, 1); const remote = SOURCE.replace('  line "Recurring"', '  line "Remote" [1, 2, 3]\n  line "Recurring"');
    expect(editXySeries(remote, identity, { label: 'Edited' })).toContain('bar "Edited" [1, 3, 5]');
    const duplicate = `${SOURCE}\n  bar "One time" [1, 3, 5]`;
    expect(() => editXySeries(duplicate, identity, { label: 'Nope' })).toThrow('changed remotely');
  });

  it('fails closed for unsupported source and invalid numeric lengths/domains', () => {
    expect(isXyChartSourceRepresentable('xychart-beta\nx-axis [Jan, Feb]\ny-axis 0 --> 10\nline [1, 2]')).toBe(false);
    expect(isXyChartSourceRepresentable('xychart-beta\nx-axis ["Jan", "Feb"]\ny-axis 0 --> 10\nline [1]')).toBe(false);
    expect(isXyChartSourceRepresentable('xychart-beta\nx-axis ["Jan", "Feb"]\ny-axis 0 --> 10\nline [1, 12]')).toBe(false);
    expect(isXyChartSourceRepresentable('xychart-beta\nx-axis ["Jan", "Feb"]\ny-axis 0 --> 10\nline [1, 2]\naccTitle: supported by Mermaid but source-only')).toBe(false);
    expect(isXyChartSourceRepresentable('xychart-beta\n  title "Quoted title"\n  x-axis ["Jan", "Feb"]\n  y-axis 0 --> 10\n  line [1, 2]')).toBe(false);
    expect(() => addXySeries(SOURCE, { kind: 'line', values: [1, 2] })).toThrow('match the x-axis');
  });
});
