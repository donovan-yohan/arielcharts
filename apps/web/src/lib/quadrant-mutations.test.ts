// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addQuadrantPoint,
  deleteQuadrantPoint,
  editQuadrantPoint,
  editQuadrantTitle,
  getQuadrantDiagramSnapshot,
  getQuadrantPointIdentity,
  isQuadrantSourceRepresentable,
  moveQuadrantPoint,
  setQuadrantAxis,
  setQuadrantLabel,
} from './quadrant-mutations';

const FIXTURE = `quadrantChart
  title Portfolio
  x-axis Low --> High
  y-axis Cost --> Value
  quadrant-1 Invest
  quadrant-2 Explore
  Alpha: [0.2, 0.8] radius: 8, color: #abc
  Beta: [1, 0] stroke-color: ff0000, stroke-width: 2px`;

function identity(source: string, index: number) {
  const snapshot = getQuadrantDiagramSnapshot(source);
  return getQuadrantPointIdentity(snapshot.points[index]!, snapshot.points);
}

describe('Quadrant source mutations', () => {
  it('snapshots safe axes, quadrant labels, normalized points, and inline styles', async () => {
    mermaid.initialize({ startOnLoad: false });
    expect(getQuadrantDiagramSnapshot(FIXTURE)).toEqual({
      axes: { x: { start: 'Low', end: 'High' }, y: { start: 'Cost', end: 'Value' } },
      points: [
        { label: 'Alpha', x: 0.2, y: 0.8, styles: { radius: 8, color: '#abc' } },
        { label: 'Beta', x: 1, y: 0, styles: { strokeColor: 'ff0000', strokeWidth: '2px' } },
      ],
      quadrants: { 1: 'Invest', 2: 'Explore', 3: null, 4: null },
      title: 'Portfolio',
    });
    await expect(mermaid.parse(FIXTURE)).resolves.toBeDefined();
    const punctuated = addQuadrantPoint('quadrantChart', { label: 'Plan A-1', x: 1e-7, y: 0.5, styles: {} });
    expect(punctuated).toContain('Plan A-1: [0.0000001, 0.5]');
    await expect(mermaid.parse(punctuated)).resolves.toBeDefined();
  });

  it('adds and edits every safe field, then reorders and deletes points', async () => {
    mermaid.initialize({ startOnLoad: false });
    let source = editQuadrantTitle(FIXTURE, 'Roadmap');
    source = setQuadrantAxis(source, 'x', { start: 'Cost/Benefit', end: 'Later' });
    source = setQuadrantLabel(source, 3, 'Maintain');
    source = setQuadrantLabel(source, 4, "Don't stop");
    source = addQuadrantPoint(source, { label: 'Gamma', x: 0.5, y: 0.4, styles: { color: '#123456', radius: 5 } });
    source = editQuadrantPoint(source, identity(source, 2), { label: 'Delta', x: 0.6, styles: { strokeColor: '#fff', strokeWidth: '3px' } });
    expect(source).toContain('Delta: [0.6, 0.4] stroke-color: #fff, stroke-width: 3px');
    source = moveQuadrantPoint(source, identity(source, 2), 'up');
    expect(getQuadrantDiagramSnapshot(source).points.map((point) => point.label)).toEqual(['Alpha', 'Delta', 'Beta']);
    source = deleteQuadrantPoint(source, identity(source, 1));
    expect(getQuadrantDiagramSnapshot(source).points.map((point) => point.label)).toEqual(['Alpha', 'Beta']);
    source = setQuadrantAxis(source, 'y', null);
    source = setQuadrantLabel(source, 2, null);
    source = editQuadrantTitle(source, null);
    await expect(mermaid.parse(source)).resolves.toBeDefined();
  });

  it('preserves BOM, frontmatter, comments, directives, EOL variants, and no-final-newline policy', async () => {
    mermaid.initialize({ startOnLoad: false });
    const authored = '\uFEFF---\nconfig:\n  theme: neutral\n---\n%%{init: {}}%%\n%% authored\nquadrantChart\n  A: [0.1, 0.9]';
    const changed = addQuadrantPoint(authored, { label: 'B', x: 0.7, y: 0.3, styles: {} });
    expect(changed.startsWith('\uFEFF---')).toBe(true);
    expect(changed).toContain('%%{init: {}}%%\n%% authored\nquadrantChart');
    expect(changed.endsWith('B: [0.7, 0.3]')).toBe(true);
    await expect(mermaid.parse(changed)).resolves.toBeDefined();
    for (const ending of ['\n', '\r\n', '\r']) {
      const source = `quadrantChart${ending}  A: [0.1, 0.9]`;
      const added = addQuadrantPoint(source, { label: 'B', x: 0.8, y: 0.2, styles: {} });
      expect(added).toBe(`${source}${ending}  B: [0.8, 0.2]`);
      expect(deleteQuadrantPoint(added, identity(added, 1))).toBe(source);
      await expect(mermaid.parse(added)).resolves.toBeDefined();
      expect(moveQuadrantPoint(added, identity(added, 1), 'up')).toBe(`quadrantChart${ending}  B: [0.8, 0.2]${ending}  A: [0.1, 0.9]`);
    }
    const mixed = 'quadrantChart\r\n  A: [0.1, 0.9]\n';
    expect(addQuadrantPoint(mixed, { label: 'B', x: 0.8, y: 0.2, styles: {} })).toBe('quadrantChart\r\n  A: [0.1, 0.9]\n  B: [0.8, 0.2]\n');
  });

  it('uses collaboration-safe identities and fails closed for invalid or unfamiliar syntax', () => {
    expect(isQuadrantSourceRepresentable('quadrantChart\n  A: [0.2, 0.8]\n  A: [0.3, 0.7]')).toBe(false);
    expect(isQuadrantSourceRepresentable('quadrantChart\n  A: [1.1, 0.8]')).toBe(false);
    expect(isQuadrantSourceRepresentable('quadrantChart\n  A: [-0.1, 0.8]')).toBe(false);
    expect(isQuadrantSourceRepresentable('quadrantChart\n  A: [0.2, 0.8] color: red')).toBe(false);
    expect(isQuadrantSourceRepresentable('quadrantChart\n  A:::hot: [0.2, 0.8]\n  classDef hot color: #fff')).toBe(false);
    expect(isQuadrantSourceRepresentable('quadrantChart\n  x-axis Low')).toBe(false);
    expect(isQuadrantSourceRepresentable('  ---\nconfig: {}\n  ---\nquadrantChart\n  A: [0.2, 0.8]')).toBe(false);
    expect(() => addQuadrantPoint('quadrantChart', { label: 'Bad', x: Number.NaN, y: 0.5, styles: {} })).toThrow('coordinates');
    const original = identity(FIXTURE, 0);
    const prepended = FIXTURE.replace('Alpha:', 'Remote: [0.3, 0.3]\n  Alpha:');
    expect(editQuadrantPoint(prepended, original, { y: 0.7 })).toContain('Alpha: [0.2, 0.7]');
    const replaced = FIXTURE.replace('[0.2, 0.8]', '[0.2, 0.6]');
    expect(() => editQuadrantPoint(replaced, original, { y: 0.7 })).toThrow('changed remotely');
  });
});
