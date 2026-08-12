import { describe, expect, it } from 'vitest';
import { LaserPresencePublisher } from './laser-presence-publisher';
import { getSafeSessionStorage, readLaserSequenceHighWater, writeLaserSequenceHighWater } from './laser-sequence-storage';

function memoryStorage(): Storage {
  const entries = new Map<string, string>();
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => { entries.set(key, value); },
  } as Storage;
}

describe('laser reconnect sequence storage', () => {
  it('continues a reused awareness client through repeated reloads without sharing another client watermark', () => {
    const storage = memoryStorage();
    writeLaserSequenceHighWater(storage, 'public-room', 42, 7);
    expect(readLaserSequenceHighWater(storage, 'public-room', 42)).toBe(7);
    writeLaserSequenceHighWater(storage, 'public-room', 42, 8);
    expect(readLaserSequenceHighWater(storage, 'public-room', 42)).toBe(8);
    writeLaserSequenceHighWater(storage, 'public-room', 42, 9);
    expect(readLaserSequenceHighWater(storage, 'public-room', 42)).toBe(9);
    expect(readLaserSequenceHighWater(storage, 'public-room', 43)).toBe(0);
    expect(readLaserSequenceHighWater(storage, 'other-room', 42)).toBe(0);
  });

  it('wires a stored room-and-client high-water mark into the next publisher sample', () => {
    const storage = memoryStorage();
    writeLaserSequenceHighWater(storage, 'public-room', 42, 11);
    const published: Array<{ sequence: number }> = [];
    const publisher = new LaserPresencePublisher((laser) => published.push(laser), readLaserSequenceHighWater(storage, 'public-room', 42));
    publisher.move({ x: 2, y: 4 });
    expect(published).toEqual([{ active: true, point: { x: 2, y: 4 }, sequence: 12 }]);
  });

  it('fails closed for malformed, unsafe, and exhausted values rather than overflowing a laser sequence', () => {
    const storage = memoryStorage();
    storage.setItem('arielcharts.laser-sequence.v1:public-room:42', 'not-a-number');
    expect(readLaserSequenceHighWater(storage, 'public-room', 42)).toBe(0);
    storage.setItem('arielcharts.laser-sequence.v1:public-room:42', String(Number.MAX_SAFE_INTEGER));
    expect(readLaserSequenceHighWater(storage, 'public-room', 42)).toBe(0);
    writeLaserSequenceHighWater(storage, 'public-room', 42, Number.MAX_SAFE_INTEGER);
    expect(readLaserSequenceHighWater(storage, 'public-room', 42)).toBe(0);
  });

  it('keeps the pointer usable when browser storage is unavailable', () => {
    const unavailable = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    } as unknown as Storage;
    expect(readLaserSequenceHighWater(unavailable, 'public-room', 42)).toBe(0);
    expect(() => writeLaserSequenceHighWater(unavailable, 'public-room', 42, 1)).not.toThrow();
    expect(readLaserSequenceHighWater(null, 'public-room', 42)).toBe(0);
    expect(() => writeLaserSequenceHighWater(null, 'public-room', 42, 1)).not.toThrow();
    expect(getSafeSessionStorage(Object.defineProperty({}, 'sessionStorage', { get: () => { throw new Error('blocked'); } }) as { sessionStorage: Storage })).toBeNull();
  });
});
