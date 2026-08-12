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
  it('keeps one public session monotonic through repeated reloads even when awareness client ids change, repeat, or are unavailable', () => {
    const storage = memoryStorage();
    // Reload 1, client 42; reload 2, client 73; reload 3, client 42 again.
    // No client id is used in the key, so all start above the session high-water.
    writeLaserSequenceHighWater(storage, 'public-room', 7);
    expect(readLaserSequenceHighWater(storage, 'public-room')).toBe(7);
    writeLaserSequenceHighWater(storage, 'public-room', 8);
    expect(readLaserSequenceHighWater(storage, 'public-room')).toBe(8);
    writeLaserSequenceHighWater(storage, 'public-room', 9);
    expect(readLaserSequenceHighWater(storage, 'public-room')).toBe(9);
    expect(readLaserSequenceHighWater(storage, 'other-room')).toBe(0);
  });

  it('wires a stored session-wide high-water mark into the next publisher sample', () => {
    const storage = memoryStorage();
    writeLaserSequenceHighWater(storage, 'public-room', 11);
    const published: Array<{ sequence: number }> = [];
    const publisher = new LaserPresencePublisher((laser) => published.push(laser), readLaserSequenceHighWater(storage, 'public-room'));
    publisher.move({ x: 2, y: 4 });
    expect(published).toEqual([{ active: true, point: { x: 2, y: 4 }, sequence: 12 }]);
  });

  it('keeps a cloned tab safe by preserving an inherited session high-water while server ownership distinguishes clients', () => {
    const source = memoryStorage();
    writeLaserSequenceHighWater(source, 'public-room', 15);
    const clone = memoryStorage();
    clone.setItem('arielcharts.laser-sequence.v1:public-room', source.getItem('arielcharts.laser-sequence.v1:public-room')!);
    expect(readLaserSequenceHighWater(clone, 'public-room')).toBe(15);
    writeLaserSequenceHighWater(clone, 'public-room', 16);
    expect(readLaserSequenceHighWater(clone, 'public-room')).toBe(16);
    // The client identity is deliberately absent: this value is only an
    // ordering floor; the WebSocket server still validates ownership.
  });

  it('fails closed for malformed, unsafe, and exhausted values rather than overflowing a laser sequence', () => {
    const storage = memoryStorage();
    storage.setItem('arielcharts.laser-sequence.v1:public-room', 'not-a-number');
    expect(readLaserSequenceHighWater(storage, 'public-room')).toBe(0);
    storage.setItem('arielcharts.laser-sequence.v1:public-room', String(Number.MAX_SAFE_INTEGER));
    expect(readLaserSequenceHighWater(storage, 'public-room')).toBe(0);
    writeLaserSequenceHighWater(storage, 'public-room', Number.MAX_SAFE_INTEGER);
    expect(readLaserSequenceHighWater(storage, 'public-room')).toBe(0);
  });

  it('keeps the pointer usable when browser storage is unavailable', () => {
    const unavailable = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('blocked'); },
    } as unknown as Storage;
    expect(readLaserSequenceHighWater(unavailable, 'public-room')).toBe(0);
    expect(() => writeLaserSequenceHighWater(unavailable, 'public-room', 1)).not.toThrow();
    expect(readLaserSequenceHighWater(null, 'public-room')).toBe(0);
    expect(() => writeLaserSequenceHighWater(null, 'public-room', 1)).not.toThrow();
    expect(getSafeSessionStorage(Object.defineProperty({}, 'sessionStorage', { get: () => { throw new Error('blocked'); } }) as { sessionStorage: Storage })).toBeNull();
  });
});
