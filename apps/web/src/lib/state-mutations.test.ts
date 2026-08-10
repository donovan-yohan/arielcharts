import { describe, expect, it } from 'vitest';
import {
  addState,
  addStateTransition,
  deleteState,
  deleteStateTransition,
  editState,
  editStateTransition,
  getStateDiagramSnapshot,
  getStateTransitionIdentity,
  isStateSourceRepresentable,
} from './state-mutations';

const SOURCE = `%% preserve comment
stateDiagram-v2
  [*] --> Idle : boot
  state Idle as Waiting
  Idle --> Active : start
  Active --> [*]
`;

describe('state source mutations', () => {
  it('models declaration labels, transitions, and initial/final markers', () => {
    expect(getStateDiagramSnapshot(SOURCE)).toEqual({
      states: [
        { id: 'Idle', kind: 'state', label: 'Waiting' }, { id: 'Active', kind: 'state' },
        { id: '[*]', kind: 'initial' }, { id: '[*]', kind: 'final' },
      ],
      transitions: [{ from: '[*]', to: 'Idle', label: 'boot' }, { from: 'Idle', to: 'Active', label: 'start' }, { from: 'Active', to: '[*]' }],
    });
  });

  it('creates, edits, deletes, and preserves outside bytes', () => {
    const added = addState(SOURCE, 'Paused', 'On hold');
    expect(added).toContain('state Paused as On hold');
    const transition = addStateTransition(added, { from: 'Active', to: 'Paused', label: 'pause' });
    const renamed = editState(transition, 'Paused', { id: 'Holding', label: 'Hold' });
    expect(renamed).toContain('Active --> Holding : pause');
    const transitions = getStateDiagramSnapshot(renamed).transitions;
    const updated = editStateTransition(renamed, getStateTransitionIdentity(transitions[3]!, 3, transitions), { from: 'Holding', to: 'Active', label: 'resume' });
    expect(updated).toContain('Holding --> Active : resume');
    const updatedTransitions = getStateDiagramSnapshot(updated).transitions;
    const noTransition = deleteStateTransition(updated, getStateTransitionIdentity(updatedTransitions[3]!, 3, updatedTransitions));
    expect(deleteState(noTransition, 'Holding')).not.toContain('Holding');
    expect(noTransition).toContain('%% preserve comment');
  });

  it('fails closed for nested and unsupported state grammar', () => {
    expect(isStateSourceRepresentable('stateDiagram-v2\n  state Active {\n    [*] --> Ready\n  }')).toBe(false);
    expect(isStateSourceRepresentable('stateDiagram-v2\n  note right of Active\n    detail\n  end note')).toBe(false);
    expect(isStateSourceRepresentable('stateDiagram-v2\n  direction LR')).toBe(false);
  });

  it('re-resolves a transition after remote insertion and fails closed for duplicates', () => {
    const transitions = getStateDiagramSnapshot(SOURCE).transitions;
    const identity = getStateTransitionIdentity(transitions[1]!, 1, transitions);
    const inserted = SOURCE.replace('  Idle --> Active : start', '  [*] --> Active : shortcut\n  Idle --> Active : start');
    expect(editStateTransition(inserted, identity, { from: 'Idle', to: 'Active', label: 'continue' })).toContain('Idle --> Active : continue');
    const ambiguous = SOURCE.replace('  Idle --> Active : start', '  Idle --> Active : start\n  Idle --> Active : start');
    expect(() => deleteStateTransition(ambiguous, identity)).toThrow('resolved safely');
  });
});
