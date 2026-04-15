import { describe, expect, it } from 'vitest';
import type { ActivityEvent, AwarenessState } from './types.js';

describe('shared types', () => {
  it('supports awareness and activity shapes', () => {
    const awareness: AwarenessState = {
      user: { name: 'Sarah', color: '#a371f7', type: 'human' },
      cursor: { anchor: 0, head: 4 },
    };

    const event: ActivityEvent = {
      id: 'evt_1',
      timestamp: Date.now(),
      actor: { name: 'claude-code', type: 'agent' },
      action: 'edited',
      detail: 'updated diagram text',
    };

    expect(awareness.user.type).toBe('human');
    expect(event.actor.type).toBe('agent');
  });
});
