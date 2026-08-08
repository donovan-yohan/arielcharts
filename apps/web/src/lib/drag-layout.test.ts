import { describe, expect, it, vi } from 'vitest';
import { DragLayoutCommitter } from './drag-layout';

describe('DragLayoutCommitter', () => {
  it('keeps only the latest position per node within a bounded write window', () => {
    vi.useFakeTimers();
    const commits: Array<Record<string, { x: number; y: number }>> = [];
    const committer = new DragLayoutCommitter((positions) => { commits.push(positions); }, 120);

    committer.update('A', { x: 1, y: 2 });
    committer.update('A', { x: 3, y: 4 });
    committer.update('B', { x: 5, y: 6 });
    vi.advanceTimersByTime(119);
    expect(commits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(commits).toEqual([{ A: { x: 3, y: 4 }, B: { x: 5, y: 6 } }]);
    vi.useRealTimers();
  });

  it('unconditionally flushes the final drag position on lifecycle cleanup', () => {
    const commits: Array<Record<string, { x: number; y: number }>> = [];
    const committer = new DragLayoutCommitter((positions) => { commits.push(positions); });

    committer.update('A', { x: 30, y: 40 });
    committer.destroy();

    expect(commits).toEqual([{ A: { x: 30, y: 40 } }]);
  });

  it('makes teardown idempotent so a session flush can precede per-tab cleanup', () => {
    const commits: Array<Record<string, { x: number; y: number }>> = [];
    const committer = new DragLayoutCommitter((positions) => { commits.push(positions); });

    committer.update('A', { x: 30, y: 40 });
    committer.destroy();
    committer.destroy();
    committer.update('A', { x: 50, y: 60 });

    expect(commits).toEqual([{ A: { x: 30, y: 40 } }]);
  });
});
