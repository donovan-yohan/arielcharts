import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PresenterAwarenessState } from '@arielcharts/shared';
import { PresenterAwarenessPublisher } from './presenter-awareness-publisher';

afterEach(() => vi.useRealTimers());

describe('PresenterAwarenessPublisher', () => {
  it('retains a fresh spotlight when an older queued camera timer runs', () => {
    vi.useFakeTimers();
    let now = 1_000;
    const sent: Array<PresenterAwarenessState | null> = [];
    const publisher = new PresenterAwarenessPublisher((state) => sent.push(state), () => now);
    publisher.start('main', { panX: 0, panY: 0, zoom: 1 });
    now += 20;
    publisher.update('main', { panX: 40, panY: 60, zoom: 1.2 });
    publisher.spotlight();
    now += 125;
    vi.advanceTimersByTime(125);
    const live = sent.filter((state): state is PresenterAwarenessState => state !== null);
    expect(live.at(-1)).toMatchObject({ spotlight_sequence: 1, viewport: { pan_x: 40, pan_y: 60, zoom: 1.2 } });
    expect(live.every((state, index) => index === 0 || state.spotlight_sequence === 1)).toBe(true);
  });
});
