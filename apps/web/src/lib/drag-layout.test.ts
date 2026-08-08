import { describe, expect, it, vi } from 'vitest';
import { DragLayoutCommitter, getDragLayoutTeardownOptions } from './drag-layout';

describe('DragLayoutCommitter', () => {
  it('final-flushes only when the tab still exists at owner teardown', () => {
    expect(getDragLayoutTeardownOptions(true)).toEqual({ flush: true });
    expect(getDragLayoutTeardownOptions(false)).toEqual({ flush: false });
  });

  it('keeps only the latest position per allowed node within a bounded write window', () => {
    vi.useFakeTimers();
    const commits: Array<Record<string, { x: number; y: number }>> = [];
    const committer = new DragLayoutCommitter((positions) => { commits.push(positions); }, 120);
    committer.setAllowedNodeIds(['A', 'B']);
    expect(committer.begin(['A', 'B'])).toBe(true);

    committer.update({ A: { x: 1, y: 2 }, B: { x: 5, y: 6 } });
    committer.update({ A: { x: 3, y: 4 }, B: { x: 7, y: 8 } });
    vi.advanceTimersByTime(119);
    expect(commits).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(commits).toEqual([{ A: { x: 3, y: 4 }, B: { x: 7, y: 8 } }]);
    vi.useRealTimers();
  });

  it('prunes an invalidated group and rejects its delayed callbacks until a new begin', () => {
    vi.useFakeTimers();
    const commits: Array<Record<string, { x: number; y: number }>> = [];
    const committer = new DragLayoutCommitter((positions) => { commits.push(positions); }, 120);
    committer.setAllowedNodeIds(['A', 'B']);
    committer.begin(['A', 'B']);
    committer.update({ A: { x: 10, y: 20 }, B: { x: 30, y: 40 } });

    committer.setAllowedNodeIds(['A']);
    expect(committer.update({ A: { x: 12, y: 22 }, B: { x: 32, y: 42 } })).toBe(false);

    // Reintroducing the previous source membership must not revive the old
    // React Flow drag group. Only a fresh drag start may establish one.
    committer.setAllowedNodeIds(['A', 'B']);
    expect(committer.update({ A: { x: 13, y: 23 }, B: { x: 33, y: 43 } })).toBe(false);
    vi.advanceTimersByTime(120);
    expect(commits).toEqual([{ A: { x: 10, y: 20 } }]);

    expect(committer.begin(['A'])).toBe(true);
    expect(committer.finish({ A: { x: 14, y: 24 } })).toBe(true);
    expect(commits).toEqual([{ A: { x: 10, y: 20 } }, { A: { x: 14, y: 24 } }]);
    vi.useRealTimers();
  });

  it('cancels empty or parse-failure invalidation without a durable write', () => {
    vi.useFakeTimers();
    const commits: Array<Record<string, { x: number; y: number }>> = [];
    const committer = new DragLayoutCommitter((positions) => { commits.push(positions); }, 120);
    committer.setAllowedNodeIds(['A']);
    committer.begin(['A']);
    committer.update({ A: { x: 30, y: 40 } });
    committer.cancel();
    expect(committer.begin(['A'])).toBe(false);
    committer.destroy();
    vi.advanceTimersByTime(120);

    expect(commits).toEqual([]);
    vi.useRealTimers();
  });

  it('flushes valid pending positions on normal teardown and stays idempotent', () => {
    const commits: Array<Record<string, { x: number; y: number }>> = [];
    const committer = new DragLayoutCommitter((positions) => { commits.push(positions); });
    committer.setAllowedNodeIds(['A']);
    committer.begin(['A']);
    committer.update({ A: { x: 30, y: 40 } });
    committer.destroy();
    committer.destroy();
    expect(committer.update({ A: { x: 50, y: 60 } })).toBe(false);

    expect(commits).toEqual([{ A: { x: 30, y: 40 } }]);
  });

  it('drops a valid pending batch for deleted-tab teardown and ignores late writes', () => {
    vi.useFakeTimers();
    const commits: Array<Record<string, { x: number; y: number }>> = [];
    const committer = new DragLayoutCommitter((positions) => { commits.push(positions); }, 120);
    committer.setAllowedNodeIds(['A']);
    committer.begin(['A']);
    committer.update({ A: { x: 30, y: 40 } });

    committer.destroy({ flush: false });
    committer.destroy({ flush: false });
    expect(committer.update({ A: { x: 50, y: 60 } })).toBe(false);
    vi.advanceTimersByTime(120);

    expect(commits).toEqual([]);
    vi.useRealTimers();
  });
});
