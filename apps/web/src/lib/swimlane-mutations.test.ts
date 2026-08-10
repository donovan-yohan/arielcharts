// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addSwimlane,
  addSwimlaneHandoff,
  addSwimlaneNode,
  deleteSwimlaneHandoff,
  deleteSwimlaneNode,
  editSwimlaneHandoff,
  editSwimlaneNode,
  getSwimlaneDiagramSnapshot,
  getSwimlaneHandoffIdentity,
  isSwimlaneSourceRepresentable,
} from './swimlane-mutations';

const SOURCE = `---
config:
  theme: neutral
---
%% roles are authored source
swimlane-beta LR
  subgraph customer [Customer]
    request[Request service]
    receive[Receive update]
  end
  subgraph support [Support]
    triage[Triage request]
    answer[Send answer]
  end
  request --> triage
  triage -->|Known issue| answer
  answer --> receive
`;

describe('swimlane source mutations', () => {
  it('keeps the supported subset accepted by Mermaid 11.16.1', async () => {
    mermaid.initialize({ startOnLoad: false });
    await expect(mermaid.parse(SOURCE)).resolves.toMatchObject({ diagramType: 'swimlane' });
  });

  it('models top-level named lanes, explicit rectangle nodes, and simple handoffs', () => {
    expect(getSwimlaneDiagramSnapshot(SOURCE)).toEqual({
      direction: 'LR',
      lanes: [{ id: 'customer', label: 'Customer' }, { id: 'support', label: 'Support' }],
      nodes: [
        { id: 'request', label: 'Request service', laneId: 'customer' },
        { id: 'receive', label: 'Receive update', laneId: 'customer' },
        { id: 'triage', label: 'Triage request', laneId: 'support' },
        { id: 'answer', label: 'Send answer', laneId: 'support' },
      ],
      handoffs: [
        { from: 'request', to: 'triage' },
        { from: 'triage', to: 'answer', label: 'Known issue' },
        { from: 'answer', to: 'receive' },
      ],
    });
  });

  it('uses source ranges to edit nodes and re-resolves a unique handoff after remote insertion', () => {
    const withEngineering = addSwimlane(SOURCE, { id: 'engineering', label: 'Engineering' });
    const withNode = addSwimlaneNode(withEngineering, { id: 'fix', label: 'Prepare fix', laneId: 'engineering' });
    const handoff = addSwimlaneHandoff(withNode, { from: 'triage', to: 'fix', label: 'Needs code' });
    const renamed = editSwimlaneNode(handoff, 'fix', { id: 'prepare', label: 'Prepare a fix' });
    expect(renamed).toContain('prepare[Prepare a fix]');
    expect(renamed).toContain('triage -->|Needs code| prepare');
    const handoffs = getSwimlaneDiagramSnapshot(renamed).handoffs;
    const changed = editSwimlaneHandoff(renamed, getSwimlaneHandoffIdentity(handoffs[3]!, 3, handoffs), { label: 'Escalated' });
    expect(changed).toContain('triage -->|Escalated| prepare');
    const current = getSwimlaneDiagramSnapshot(changed).handoffs;
    const withoutHandoff = deleteSwimlaneHandoff(changed, getSwimlaneHandoffIdentity(current[3]!, 3, current));
    expect(deleteSwimlaneNode(withoutHandoff, 'prepare')).not.toContain('prepare');
    expect(withoutHandoff).toContain('%% roles are authored source');
  });

  it('rejects stale identities after a duplicate or an unmodelled concurrent source change', () => {
    const handoffs = getSwimlaneDiagramSnapshot(SOURCE).handoffs;
    const identity = getSwimlaneHandoffIdentity(handoffs[2]!, 2, handoffs);
    const inserted = SOURCE.replace('  answer --> receive', '  receive --> answer\n  answer --> receive');
    expect(editSwimlaneHandoff(inserted, identity, { label: 'Update' })).toContain('answer -->|Update| receive');
    const duplicate = SOURCE.replace('  answer --> receive', '  answer --> receive\n  answer --> receive');
    expect(isSwimlaneSourceRepresentable(duplicate)).toBe(true);
    expect(() => deleteSwimlaneHandoff(duplicate, identity)).toThrow('resolved safely');
  });

  it('fails closed for nested/unnamed lanes, implicit nodes, chained links, unsupported shapes, and styles', () => {
    expect(isSwimlaneSourceRepresentable('swimlane-beta\n  subgraph Sales\n    a[A]\n    subgraph Team\n      b[B]\n    end\n  end')).toBe(false);
    expect(isSwimlaneSourceRepresentable('swimlane-beta\n  subgraph Sales\n    a\n  end')).toBe(false);
    expect(isSwimlaneSourceRepresentable('swimlane-beta\n  subgraph Sales\n    a(A)\n  end')).toBe(false);
    expect(isSwimlaneSourceRepresentable('swimlane-beta\n  subgraph Sales\n    a[A]\n    b[B]\n  end\n  a --> b --> a')).toBe(false);
    expect(isSwimlaneSourceRepresentable('swimlane-beta\n  subgraph Sales\n    a[A]:::hot\n  end')).toBe(false);
  });
});
