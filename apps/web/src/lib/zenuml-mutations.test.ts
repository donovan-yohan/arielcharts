import { describe, expect, it } from 'vitest';
import {
  addZenUmlControl, addZenUmlMessage, addZenUmlParticipant, deleteZenUmlControl, deleteZenUmlMessage,
  deleteZenUmlParticipant, editZenUmlControl, editZenUmlMessage, editZenUmlParticipant,
  getZenUmlControlIdentity, getZenUmlDiagramSnapshot, getZenUmlMessageIdentity, getZenUmlParticipantIdentity,
  isZenUmlSourceRepresentable, moveZenUmlControl, moveZenUmlMessage, moveZenUmlParticipant,
} from './zenuml-mutations';

const CORE = `zenuml
  @Actor User
  API as Checkout API
  User->API: create order
  receipt = API.create(order)
  if(receipt) {
    API->User: created
  }
  else {
    API->User: failed
  }
  return receipt`;

describe('ZenUML source model', () => {
  it('parses participants, async/sync/return messages, annotators, and nested controls', () => {
    const value = getZenUmlDiagramSnapshot(CORE);
    expect(value.participants).toEqual([
      { alias: 'User', kind: 'actor', label: 'User' },
      { alias: 'API', kind: 'participant', label: 'Checkout API' },
    ]);
    expect(value.messages.map((item) => item.kind)).toEqual(['async', 'sync', 'async', 'async', 'return']);
    expect(value.controls).toEqual([
      { depth: 0, kind: 'if', label: 'receipt' },
      { depth: 0, kind: 'else', label: '' },
    ]);
  });

  it('supports the agreed control and annotator families', () => {
    expect(getZenUmlDiagramSnapshot('zenuml\n  Alice\n  Alice->Bob: hi').participants).toEqual([
      { alias: 'Alice', kind: 'participant', label: 'Alice' },
      { alias: 'Bob', kind: 'participant', label: 'Bob' },
    ]);
    for (const annotator of ['Actor', 'Database', 'Boundary', 'Control', 'Entity', 'Queue']) {
      expect(isZenUmlSourceRepresentable(`zenuml\n  @${annotator} A\n  A->B: hi`)).toBe(true);
    }
    for (const block of ['if(ok)', 'opt', 'par', 'while(ok)', 'for(i)', 'foreach(i)', 'forEach(i)', 'loop(all)', 'try']) {
      expect(isZenUmlSourceRepresentable(`zenuml\n  ${block} {\n    A->B: hi\n  }`), block).toBe(true);
    }
    expect(isZenUmlSourceRepresentable('zenuml\n  try {\n    A.work()\n  }\n  catch(Error) {\n    B.work()\n  }\n  finally {\n    C.work()\n  }')).toBe(true);
    const compound = getZenUmlDiagramSnapshot('zenuml\n  if(first) {\n    A->B: one\n  } else if(second) {\n    A->B: two\n  } else {\n    A->B: three\n  }');
    expect(compound.controls.map((item) => [item.kind, item.label])).toEqual([['if', 'first'], ['else-if', 'second'], ['else', '']]);
  });

  it('models documented nested caller-to-method blocks and inserts into explicit parents', () => {
    let source = 'zenuml\n  Client->API.checkout() {\n  }';
    let diagram = getZenUmlDiagramSnapshot(source);
    expect(diagram.messages[0]).toMatchObject({ from: 'Client', kind: 'sync', text: 'checkout()', to: 'API' });
    expect(diagram.blocks).toHaveLength(1);
    source = addZenUmlMessage(source, { assignment: null, from: 'API', kind: 'async', text: 'reserve', to: 'Inventory' }, diagram.blocks[0]!.identity);
    diagram = getZenUmlDiagramSnapshot(source);
    source = addZenUmlControl(source, { depth: 1, kind: 'if', label: 'available' }, diagram.blocks[0]!.identity);
    expect(source).toBe('zenuml\n  Client->API.checkout() {\n    API->Inventory: reserve\n    if(available) {\n    }\n  }');
  });

  it('preserves compound alternatives for safe edits and fails closed for structural chain deletion', () => {
    const source = 'zenuml\n  if(first) {\n    A->B: one\n  } else if(second) {\n    A->B: two\n  }';
    let diagram = getZenUmlDiagramSnapshot(source);
    const edited = editZenUmlControl(source, getZenUmlControlIdentity(diagram.controls[1]!, diagram.controls), { label: 'fallback' });
    expect(edited).toContain('} else if(fallback) {');
    diagram = getZenUmlDiagramSnapshot(edited);
    const continuation = diagram.blocks.find((block) => block.label === 'else-if (fallback)');
    expect(addZenUmlMessage(edited, { assignment: null, from: 'B', kind: 'async', text: 'nested', to: 'A' }, continuation?.identity))
      .toContain('  } else if(fallback) {\n    A->B: two\n    B->A: nested\n  }');
    expect(() => deleteZenUmlControl(edited, getZenUmlControlIdentity(diagram.controls[0]!, diagram.controls))).toThrow('complete ZenUML alternative chain');
  });

  it('fails closed for unfamiliar valid advanced syntax and malformed structure', () => {
    expect(isZenUmlSourceRepresentable('zenuml\n  title Advanced\n  A->B: hi')).toBe(false);
    expect(isZenUmlSourceRepresentable('zenuml\n  A->B: hi\n  }')).toBe(false);
    expect(() => getZenUmlDiagramSnapshot('zenuml\n  title Advanced')).toThrow('Edit it as source');
  });

  it('creates, edits, reorders, and deletes declared participants without rewriting unrelated bytes', () => {
    expect(addZenUmlParticipant('zenuml', { alias: 'Service', kind: 'participant', label: 'Service' })).toBe('zenuml\n  Service');
    let source = addZenUmlParticipant('zenuml', { alias: 'A', kind: 'actor', label: 'Alice' });
    source = addZenUmlParticipant(source, { alias: 'B', kind: 'database', label: 'Orders' });
    let diagram = getZenUmlDiagramSnapshot(source);
    source = moveZenUmlParticipant(source, getZenUmlParticipantIdentity(diagram.participants[1]!, diagram.participants), 'up');
    diagram = getZenUmlDiagramSnapshot(source);
    source = editZenUmlParticipant(source, getZenUmlParticipantIdentity(diagram.participants[0]!, diagram.participants), { label: 'Primary Orders' });
    diagram = getZenUmlDiagramSnapshot(source);
    source = deleteZenUmlParticipant(source, getZenUmlParticipantIdentity(diagram.participants[1]!, diagram.participants));
    expect(source).toBe('zenuml\n  @Database B as Primary Orders\n');
  });

  it('renames declared aliases through messages but not message text', () => {
    const source = 'zenuml\n  A as Alice\n  A->B: tell A\n  B.work()\n  A->B.nested() {\n  }';
    const diagram = getZenUmlDiagramSnapshot(source);
    expect(editZenUmlParticipant(source, getZenUmlParticipantIdentity(diagram.participants[0]!, diagram.participants), { alias: 'User' }))
      .toBe('zenuml\n  User as Alice\n  User->B: tell A\n  B.work()\n  User->B.nested() {\n  }');
  });

  it('blocks deleting referenced or implicit participants', () => {
    const diagram = getZenUmlDiagramSnapshot(CORE);
    expect(() => deleteZenUmlParticipant(CORE, getZenUmlParticipantIdentity(diagram.participants[0]!, diagram.participants))).toThrow('Delete messages');
    expect(() => deleteZenUmlParticipant('zenuml\n  A->B: hi', getZenUmlParticipantIdentity({ alias: 'A', kind: 'participant', label: 'A' }))).toThrow('Implicit');
  });

  it('creates, edits, reorders, and deletes messages with stable occurrence identities', () => {
    let source = addZenUmlMessage('zenuml', { assignment: null, from: 'A', kind: 'async', text: 'one', to: 'B' });
    source = addZenUmlMessage(source, { assignment: null, from: 'A', kind: 'async', text: 'two', to: 'B' });
    let diagram = getZenUmlDiagramSnapshot(source);
    source = moveZenUmlMessage(source, getZenUmlMessageIdentity(diagram.messages[1]!, diagram.messages), 'up');
    diagram = getZenUmlDiagramSnapshot(source);
    source = editZenUmlMessage(source, getZenUmlMessageIdentity(diagram.messages[0]!, diagram.messages), { text: 'second' });
    diagram = getZenUmlDiagramSnapshot(source);
    source = deleteZenUmlMessage(source, getZenUmlMessageIdentity(diagram.messages[1]!, diagram.messages));
    expect(source).toBe('zenuml\n  A->B: second\n');
  });

  it('round-trips sync assignments and return messages', () => {
    let source = addZenUmlMessage('zenuml', { assignment: 'item', from: null, kind: 'sync', text: 'find(id)', to: 'Repo' });
    source = addZenUmlMessage(source, { assignment: null, from: null, kind: 'return', text: 'item', to: null });
    const diagram = getZenUmlDiagramSnapshot(source);
    expect(editZenUmlMessage(source, getZenUmlMessageIdentity(diagram.messages[0]!, diagram.messages), { assignment: 'result', text: 'load(id)' }))
      .toContain('result = Repo.load(id)');
    expect(addZenUmlMessage('zenuml', { assignment: null, from: null, kind: 'return', text: '', to: null })).toBe('zenuml\n  return');
  });

  it('creates, edits, reorders, and deletes whole control subtrees', () => {
    let source = addZenUmlControl('zenuml', { depth: 0, kind: 'if', label: 'ready' });
    source = addZenUmlControl(source, { depth: 0, kind: 'while', label: 'open' });
    let diagram = getZenUmlDiagramSnapshot(source);
    source = moveZenUmlControl(source, getZenUmlControlIdentity(diagram.controls[1]!, diagram.controls), 'up');
    diagram = getZenUmlDiagramSnapshot(source);
    source = editZenUmlControl(source, getZenUmlControlIdentity(diagram.controls[0]!, diagram.controls), { label: 'active' });
    diagram = getZenUmlDiagramSnapshot(source);
    source = deleteZenUmlControl(source, getZenUmlControlIdentity(diagram.controls[1]!, diagram.controls));
    expect(source).toBe('zenuml\n  while(active) {\n  }\n');
  });

  it('preserves CRLF source endings for appended mutations', () => {
    expect(addZenUmlMessage('zenuml\r\n', { assignment: null, from: 'A', kind: 'async', text: 'hi', to: 'B' }))
      .toBe('zenuml\r\n  A->B: hi');
  });

  it('rejects injection-shaped form values', () => {
    expect(() => addZenUmlParticipant('zenuml', { alias: 'A\nB', kind: 'actor', label: 'A' })).toThrow('simple identifier');
    expect(() => addZenUmlMessage('zenuml', { assignment: null, from: 'A', kind: 'async', text: 'x\n  Evil->B: y', to: 'B' })).toThrow('one source line');
    expect(() => addZenUmlControl('zenuml', { depth: 0, kind: 'if', label: '' })).toThrow('require a condition');
  });
});
