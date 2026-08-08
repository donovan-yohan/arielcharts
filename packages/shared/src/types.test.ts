import { describe, expect, it } from 'vitest';
import type { ActivityEvent, AwarenessState, Diagram, GetSessionOutput } from './types.js';

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

  it('models named diagram orientation with an opaque revision', () => {
    const diagram: Diagram = {
      id: 'main',
      name: 'Main',
      mermaid_text: 'sequenceDiagram\n  Browser->>API: request',
      revision: 'opaque-yjs-state-vector',
    };
    const session: GetSessionOutput = {
      session_id: 'abc123de',
      diagrams: [{ id: diagram.id, name: diagram.name, revision: diagram.revision }],
      participants: [],
      revision: diagram.revision,
    };

    expect(session.diagrams[0]?.name).toBe('Main');
    expect(session.revision).toBe(diagram.revision);
  });
});
