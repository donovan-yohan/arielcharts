import { describe, expect, it } from 'vitest';
import type { ActivityEvent, AwarenessState, Diagram, GetSessionOutput, McpOverlayScene } from './types.js';

describe('shared types', () => {
  it('supports awareness and activity shapes', () => {
    const awareness: AwarenessState = {
      user: { name: 'Sarah', color: '#a371f7', type: 'human' },
      cursor: { anchor: 0, head: 4 },
      canvas: {
        diagram_id: 'main',
        cursor: { x: 120, y: 64 },
        selected_node_ids: ['Gateway'],
      },
    };

    const event: ActivityEvent = {
      id: 'evt_1',
      timestamp: Date.now(),
      actor: { name: 'claude-code', type: 'agent' },
      action: 'edited',
      detail: 'updated diagram text',
    };

    expect(awareness.user.type).toBe('human');
    expect(awareness.canvas?.selected_node_ids).toEqual(['Gateway']);
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

  it('models an explicit opaque overlay rather than silently projecting it as a v1 object', () => {
    const scene: McpOverlayScene = {
      version: 1,
      diagram_id: 'main',
      overlay_revision: 'server-derived-raw-revision',
      writable: true,
      objects: [],
      opaque_objects: [{ id: 'future', kind: 'future.card', version: 2 }],
    };

    expect(scene.opaque_objects[0]?.kind).toBe('future.card');
  });
});
