// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addPieSlice,
  deletePieSlice,
  editPieSlice,
  editPieTitle,
  getPieDiagramSnapshot,
  getPieSliceIdentity,
  isPieSourceRepresentable,
  movePieSlice,
  setPieShowData,
} from './pie-mutations';

const FIXTURE = `pie showData
  title Delivery mix
  "Build" : 4.5
  'Ship' : 2`;

function identity(source: string, index: number) {
  const snapshot = getPieDiagramSnapshot(source);
  return getPieSliceIdentity(snapshot.slices[index]!, snapshot.slices);
}

describe('Pie source mutations', () => {
  it('snapshots and emits Mermaid-compatible title, show-data, labels, and non-negative values', async () => {
    mermaid.initialize({ startOnLoad: false });
    expect(getPieDiagramSnapshot(FIXTURE)).toEqual({
      showData: true,
      slices: [{ label: 'Build', value: 4.5 }, { label: 'Ship', value: 2 }],
      title: 'Delivery mix',
    });
    await expect(mermaid.parse(FIXTURE)).resolves.toBeDefined();
    const added = addPieSlice(FIXTURE, { label: 'Learn "fast"', value: 1.25 });
    expect(added).toContain('"Learn \\"fast\\"" : 1.25');
    await expect(mermaid.parse(added)).resolves.toBeDefined();
    const tiny = addPieSlice('pie', { label: 'Trace', value: 1e-7 });
    expect(tiny).toContain('"Trace" : 0.0000001');
    await expect(mermaid.parse(tiny)).resolves.toBeDefined();
    await expect(mermaid.parse(editPieTitle('pie', 'New chart'))).resolves.toBeDefined();
  });

  it('edits configuration and slices, reorders, and deletes through source-canonical identities', async () => {
    mermaid.initialize({ startOnLoad: false });
    const hidden = setPieShowData(FIXTURE, false);
    expect(getPieDiagramSnapshot(hidden).showData).toBe(false);
    const titled = editPieTitle(hidden, 'Release mix');
    expect(titled).toContain('title Release mix');
    const edited = editPieSlice(titled, identity(titled, 0), { label: 'Compile', value: 6 });
    expect(edited).toContain('"Compile" : 6');
    const moved = movePieSlice(edited, identity(edited, 1), 'up');
    expect(getPieDiagramSnapshot(moved).slices.map((slice) => slice.label)).toEqual(['Ship', 'Compile']);
    const deleted = deletePieSlice(moved, identity(moved, 1));
    expect(getPieDiagramSnapshot(deleted).slices).toEqual([{ label: 'Ship', value: 2 }]);
    await expect(mermaid.parse(deleted)).resolves.toBeDefined();
    const untitled = editPieTitle(deleted, null);
    expect(getPieDiagramSnapshot(untitled).title).toBeNull();
    await expect(mermaid.parse(untitled)).resolves.toBeDefined();
  });

  it('preserves BOM, frontmatter, comments, directives, physical endings, and final-newline policy', async () => {
    mermaid.initialize({ startOnLoad: false });
    const authored = '\uFEFF---\nconfig:\n  theme: neutral\n---\n%%{init: {}}%%\n%% authored\npie\n  "A" : 1';
    const changed = setPieShowData(addPieSlice(authored, { label: 'B', value: 2 }), true);
    expect(changed.startsWith('\uFEFF---')).toBe(true);
    expect(changed).toContain('%%{init: {}}%%\n%% authored\npie showData');
    expect(changed.endsWith('"B" : 2')).toBe(true);
    await expect(mermaid.parse(changed)).resolves.toBeDefined();
    for (const ending of ['\n', '\r\n', '\r']) {
      const noFinal = `pie${ending}  "A" : 1`;
      const added = addPieSlice(noFinal, { label: 'B', value: 2 });
      expect(added).toBe(`pie${ending}  "A" : 1${ending}  "B" : 2`);
      expect(deletePieSlice(added, identity(added, 1))).toBe(noFinal);
      await expect(mermaid.parse(added)).resolves.toBeDefined();
      expect(movePieSlice(added, identity(added, 1), 'up')).toBe(`pie${ending}  "B" : 2${ending}  "A" : 1`);
      const withFinal = `${noFinal}${ending}`;
      expect(addPieSlice(withFinal, { label: 'B', value: 2 })).toBe(`${withFinal}  "B" : 2${ending}`);
    }
    const mixed = 'pie\r\n  "A" : 1\n';
    expect(addPieSlice(mixed, { label: 'B', value: 2 })).toBe('pie\r\n  "A" : 1\n  "B" : 2\n');
  });

  it('fails closed for duplicate, stale, negative, non-finite, malformed, and unsupported source', () => {
    expect(isPieSourceRepresentable('pie\n  "A" : 1\n  \'A\' : 2')).toBe(false);
    expect(isPieSourceRepresentable('pie\n  "A" : -1')).toBe(false);
    expect(isPieSourceRepresentable('pie\n  "A" : Infinity')).toBe(false);
    expect(isPieSourceRepresentable('pie\n  A : 1')).toBe(false);
    expect(isPieSourceRepresentable('pie\n  title')).toBe(false);
    expect(isPieSourceRepresentable('pie\n  title before %% hidden')).toBe(false);
    expect(isPieSourceRepresentable('pie\n  " A " : 1')).toBe(false);
    expect(isPieSourceRepresentable('  ---\nconfig: {}\n  ---\npie\n  "A" : 1')).toBe(false);
    expect(isPieSourceRepresentable('pie\n  style A fill:#fff')).toBe(false);
    expect(() => addPieSlice('pie', { label: 'Bad', value: Number.POSITIVE_INFINITY })).toThrow('finite Mermaid numbers');
    const original = identity(FIXTURE, 0);
    const prepended = FIXTURE.replace('"Build" : 4.5', '"Remote" : 1\n  "Build" : 4.5');
    expect(editPieSlice(prepended, original, { value: 5 })).toContain('"Build" : 5');
    const replaced = FIXTURE.replace('"Build" : 4.5', '"Build" : 9');
    expect(() => editPieSlice(replaced, original, { value: 5 })).toThrow('changed remotely');
  });
});
