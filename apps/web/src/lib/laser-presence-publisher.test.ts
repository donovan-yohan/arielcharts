import { afterEach, describe, expect, it, vi } from 'vitest';
import { LaserPresencePublisher } from './laser-presence-publisher';

afterEach(() => vi.useRealTimers());

describe('LaserPresencePublisher', () => {
  it('quantizes, coalesces, rate-limits and sequences active samples', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const published: unknown[] = [];
    const publisher = new LaserPresencePublisher((laser) => published.push(laser));
    publisher.move({ x: 10.7, y: 19.2 });
    publisher.move({ x: 15.1, y: 25.1 });
    expect(published).toEqual([{ active: true, point: { x: 10, y: 20 }, sequence: 1 }]);
    vi.advanceTimersByTime(125);
    expect(published).toEqual([
      { active: true, point: { x: 10, y: 20 }, sequence: 1 },
      { active: true, point: { x: 16, y: 26 }, sequence: 2 },
    ]);
  });

  it('drops pending samples and publishes inactive on stop', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const published: unknown[] = [];
    const publisher = new LaserPresencePublisher((laser) => published.push(laser));
    publisher.move({ x: 2, y: 4 });
    publisher.move({ x: 8, y: 10 });
    publisher.stop();
    vi.advanceTimersByTime(100);
    expect(published).toEqual([
      { active: true, point: { x: 2, y: 4 }, sequence: 1 },
      { active: false, sequence: 2 },
    ]);
  });

  it('automatically clears an active laser after input stops', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const published: unknown[] = [];
    const publisher = new LaserPresencePublisher((laser) => published.push(laser));
    publisher.move({ x: 2, y: 4 });
    vi.advanceTimersByTime(1_000);
    expect(published.at(-1)).toEqual({ active: false, sequence: 2 });
  });

  it('keeps sequence monotonic when the live publish callback changes', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const first: unknown[] = [];
    const second: unknown[] = [];
    let publish = (laser: unknown) => first.push(laser);
    const publisher = new LaserPresencePublisher((laser) => publish(laser));
    publisher.move({ x: 2, y: 4 });
    publish = (laser: unknown) => second.push(laser);
    publisher.move({ x: 20, y: 24 });
    vi.advanceTimersByTime(125);
    publisher.stop();
    expect(first).toEqual([{ active: true, point: { x: 2, y: 4 }, sequence: 1 }]);
    expect(second).toEqual([
      { active: true, point: { x: 20, y: 24 }, sequence: 2 },
      { active: false, sequence: 3 },
    ]);
  });

  it('continues from the last page-lifetime sequence after a publisher is recreated', () => {
    const first: Array<{ sequence: number }> = [];
    const original = new LaserPresencePublisher((laser) => first.push(laser));
    original.move({ x: 2, y: 4 });
    original.stop();
    const resumed: Array<{ sequence: number }> = [];
    const afterReload = new LaserPresencePublisher((laser) => resumed.push(laser), first.at(-1)?.sequence);
    afterReload.move({ x: 6, y: 8 });
    expect(first.at(-1)).toEqual({ active: false, sequence: 2 });
    expect(resumed).toEqual([{ active: true, point: { x: 6, y: 8 }, sequence: 3 }]);
  });

  it('does not wrap a near-exhausted sequence into an old laser sample', () => {
    const published: unknown[] = [];
    const publisher = new LaserPresencePublisher((laser) => published.push(laser), Number.MAX_SAFE_INTEGER - 1);
    publisher.move({ x: 2, y: 4 });
    publisher.stop();
    expect(published).toEqual([]);
  });

  it('keeps a sustained 12-second gesture below the shared awareness budget with stop headroom', () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const published: Array<{ active: boolean; sequence: number }> = [];
    const publisher = new LaserPresencePublisher((laser) => published.push(laser));
    for (let elapsed = 0; elapsed < 12_000; elapsed += 10) {
      publisher.move({ x: elapsed, y: elapsed / 2 });
      vi.advanceTimersByTime(10);
    }
    publisher.stop();

    const active = published.filter((laser) => laser.active);
    expect(active).toHaveLength(97);
    expect(published.at(-1)).toEqual({ active: false, sequence: 98 });
    expect(active.filter((_laser, index) => {
      const timestamp = index === 0 ? 1_000 : 1_000 + (index * 125);
      return timestamp < 11_000;
    })).toHaveLength(80);
  });
});
