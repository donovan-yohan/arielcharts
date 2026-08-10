// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
  addSequenceMessage,
  addSequenceActivation,
  addSequenceFragment,
  addSequenceNote,
  addSequenceParticipant,
  createSequenceParticipantId,
  deleteSequenceParticipant,
  deleteSequenceActivation,
  deleteSequenceFragment,
  deleteSequenceMessage,
  deleteSequenceNote,
  editSequenceActivation,
  editSequenceFragment,
  editSequenceMessage,
  editSequenceInlineText,
  editSequenceNote,
  getSequenceDiagramSnapshot,
  getSequenceParticipants,
  isSequenceDiagramSource,
  isSequenceSourceRepresentable,
  moveSequenceMessage,
  moveSequenceActivation,
  moveSequenceNote,
  moveSequenceParticipant,
  renameSequenceParticipant,
  renameSequenceParticipantId,
  setSequenceAutonumber,
} from './sequence-mutations';

describe('sequence source mutations', () => {
  it('accepts only Mermaid 11.16.1 autonumber forms and never emits arbitrary source', async () => {
    mermaid.initialize({ startOnLoad: false });
    const validValues = ['', 'off', '1', '1 2', '.5 1.5'];
    for (const value of validValues) {
      const source = `sequenceDiagram\n  autonumber${value ? ` ${value}` : ''}`;
      expect(isSequenceSourceRepresentable(source), value || 'bare').toBe(true);
      await expect(mermaid.parse(source), value || 'bare').resolves.toMatchObject({ diagramType: 'sequence' });
    }

    for (const value of ['start', '1 next', '1 2 3', '-1', 'off 1']) {
      const source = `sequenceDiagram\n  autonumber ${value}`;
      expect(isSequenceSourceRepresentable(source), value).toBe(false);
      await expect(mermaid.parse(source), value).rejects.toThrow();
    }

    const source = 'sequenceDiagram\n  A->>B: request';
    for (const value of ['', 'off', '1', '1 2', '.5 1.5']) {
      const mutated = setSequenceAutonumber(source, value);
      expect(mutated).toContain(`autonumber${value ? ` ${value}` : ''}`);
      await expect(mermaid.parse(mutated), value).resolves.toMatchObject({ diagramType: 'sequence' });
    }
    const bareSource = 'sequenceDiagram\n  autonumber';
    expect(setSequenceAutonumber(bareSource, '')).toBe(bareSource);
    expect(setSequenceAutonumber(bareSource, null)).toBe('sequenceDiagram\n');
    for (const value of ['start', '1 next', '1 2 3', '-1', 'off 1', '1\n2']) {
      expect(() => setSequenceAutonumber(source, value), value).toThrow('Autonumber accepts');
    }
  });

  it('recognizes only sequence source and derives declared and implicit participants', () => {
    const source = `sequenceDiagram
  participant Browser as Web browser
  Browser->>API: request
  API-->>Store: lookup`;
    expect(isSequenceDiagramSource(source)).toBe(true);
    expect(getSequenceParticipants(source)).toEqual([
      { id: 'Browser', label: 'Web browser' },
      { id: 'API', label: 'API' },
      { id: 'Store', label: 'Store' },
    ]);
    expect(getSequenceParticipants('classDiagram\nA <|-- B')).toEqual([]);
  });

  it('understands Mermaid frontmatter, semicolon statements, and bidirectional messages', () => {
    const source = [
      '---',
      'config:',
      '  theme: neutral',
      '---',
      'sequenceDiagram; create participant Browser as Web browser; create participant edge.api-v2 as Edge API; Browser<<->>API: request; API<<-->>Store: lookup',
    ].join('\n');

    expect(isSequenceDiagramSource(source)).toBe(true);
    expect(isSequenceSourceRepresentable(source)).toBe(true);
    expect(getSequenceParticipants(source)).toEqual([
      { id: 'Browser', label: 'Web browser' },
      { id: 'edge.api-v2', label: 'Edge API' },
      { id: 'API', label: 'API' },
      { id: 'Store', label: 'Store' },
    ]);
  });

  it('withholds unsupported participant syntax instead of inferring unsafe ids', () => {
    const source = [
      'sequenceDiagram',
      '  participant "Web browser" as Browser',
      '  "Web browser"->>API: request',
      '  Note over API: not a participant declaration',
    ].join('\n');

    expect(getSequenceParticipants(source)).toEqual([]);
    expect(isSequenceSourceRepresentable(source)).toBe(false);
    expect(isSequenceSourceRepresentable('sequenceDiagram\n  "Web browser"->>API: request')).toBe(false);
    expect(isSequenceSourceRepresentable('sequenceDiagram\n  Web browser->>API: request')).toBe(false);
    expect(isSequenceSourceRepresentable('sequenceDiagram\n  participant Web browser as Browser')).toBe(false);
    expect(getSequenceParticipants('sequenceDiagram\n  %% ignored; Ghost->>API: not real'))
      .toEqual([]);
  });

  it.each(['#', '%', '%{'])('withholds quoted implicit endpoints containing %s', (delimiter) => {
    const source = `sequenceDiagram\n  "Web${delimiter}browser"->>API: request`;

    expect(isSequenceSourceRepresentable(source)).toBe(false);
    expect(getSequenceParticipants(source)).toEqual([]);
  });

  it('ignores only full-line Mermaid comments and directives without treating # or % as comments', () => {
    const source = [
      'sequenceDiagram',
      '  %%{init: {"theme": "neutral"}}%%',
      '  %% Ghost->>API: not real',
      '  participant Browser',
      '  Browser->>API: request #42 at 100%',
    ].join('\n');

    expect(isSequenceSourceRepresentable(source)).toBe(true);
    expect(getSequenceParticipants(source)).toEqual([
      { id: 'Browser', label: 'Browser' },
      { id: 'API', label: 'API' },
    ]);
    expect(addSequenceMessage(source, 'Browser', 'API', 'Keep 100% #42')).toContain('Keep 100% ＃42');
  });

  it('stops a physical line at a semicolon-delimited Mermaid comment without losing quoted semicolons', () => {
    const source = `sequenceDiagram; %% hidden; Ghost->>API: not real
  participant A as "Alpha; client"
  A->>B: yes`;

    expect(isSequenceSourceRepresentable(source)).toBe(true);
    expect(getSequenceParticipants(source)).toEqual([
      { id: 'A', label: '"Alpha; client"' },
      { id: 'B', label: 'B' },
    ]);
    expect(addSequenceMessage(source, 'A', 'B', 'safe')).toContain('A->>B: safe');
  });

  it('withholds hash-bearing actor identifiers rather than truncating them as comments', () => {
    const source = `sequenceDiagram
  participant A#comment
  A#comment->>B: hi`;

    expect(isSequenceSourceRepresentable(source)).toBe(false);
    expect(getSequenceParticipants(source)).toEqual([]);
    expect(() => addSequenceParticipant(source, 'Client')).toThrow('representable sequence diagram source');
    expect(() => addSequenceMessage(source, 'A', 'B', 'hi')).toThrow('representable sequence diagram source');
  });

  it('represents Note-only sequence diagrams as source-backed notes', () => {
    const source = `sequenceDiagram
  Note over A,B: hello`;

    expect(isSequenceSourceRepresentable(source)).toBe(true);
    expect(getSequenceParticipants(source)).toEqual([{ id: 'A', label: 'A' }, { id: 'B', label: 'B' }]);
    expect(addSequenceParticipant(source, 'Client')).toContain('participant Client as Client');
  });

  it('adds ordinary Mermaid participants with collision-safe ids', () => {
    const first = addSequenceParticipant('', 'API Gateway');
    const second = addSequenceParticipant(first, 'API Gateway');
    expect(first).toBe('sequenceDiagram\n  participant APIGateway as API Gateway');
    expect(second).toContain('participant APIGateway2 as API Gateway');
    expect(createSequenceParticipantId('', [])).toBe('Participant');
    expect(() => addSequenceParticipant('classDiagram\n  A', 'API'))
      .toThrow('sequence diagram source');
    expect(addSequenceParticipant('  \r\n', 'API')).toBe(
      '  \r\nsequenceDiagram\r\n  participant API as API',
    );
  });

  it('adds messages only between participants already represented in source', () => {
    const source = `sequenceDiagram
  participant Browser
  participant API`;
    expect(addSequenceMessage(source, 'Browser', 'API', 'Fetch data'))
      .toContain('Browser->>API: Fetch data');
    expect(() => addSequenceMessage(source, 'Browser', 'Store', 'Fetch data'))
      .toThrow('existing participants');
  });

  it('preserves source bytes and line endings while appending delimiter-safe content', () => {
    const source = [
      '---',
      'config:',
      '  theme: neutral',
      '---',
      'sequenceDiagram; A<<->>B: ping',
      '',
      '',
    ].join('\r\n');
    const withParticipant = addSequenceParticipant(source, 'Web; #"<browser>" & client\nnext');
    expect(withParticipant).toBe(`${source}  participant WebBrowserClientNext as Web； ＃”‹browser›” ＆ client next`);
    expect(addSequenceMessage(withParticipant, 'A', 'B', 'pong; #"<ok>" & received\r\nnext')).toBe(
      `${withParticipant}\r\n  A->>B: pong； ＃”‹ok›” ＆ received next`,
    );
  });

  it('models nested semantic statements with source identities and preserves untouched CRLF source', () => {
    const source = [
      'sequenceDiagram',
      '  actor User as Person',
      '  participant API',
      '  autonumber 10 10',
      '  alt accepted',
      '    User->>API: create',
      '    activate API',
      '    Note right of API: processing',
      '  else rejected',
      '    API--xUser: denied',
      '  end',
    ].join('\r\n');
    const snapshot = getSequenceDiagramSnapshot(source);

    expect(snapshot.participants.map(({ id, kind }) => ({ id, kind }))).toEqual([
      { id: 'User', kind: 'actor' }, { id: 'API', kind: 'participant' },
    ]);
    expect(snapshot.autonumber?.value).toBe('10 10');
    expect(snapshot.fragments).toHaveLength(1);
    expect(snapshot.fragments[0]?.branches.map((branch) => branch.kind)).toEqual(['else']);
    expect(snapshot.messages[0]?.fragmentPath).toEqual([snapshot.fragments[0]?.id, `${snapshot.fragments[0]?.id}#main`]);
    expect(snapshot.notes[0]?.participants).toEqual(['API']);
    expect(snapshot.messages.every((message) => message.id.includes(':'))).toBe(true);
    expect(editSequenceNote(source, snapshot.notes[0]?.id ?? '', { text: 'still processing' })).toContain('Note right of API: still processing');
  });

  it('performs reference-safe participant and message mutations without rewriting unrelated statements', () => {
    const source = `sequenceDiagram
  participant Browser as Web
  participant API
  Browser->>API: fetch
  API-->>Browser: ok`;
    const renamed = renameSequenceParticipant(source, 'Browser', 'Web browser');
    expect(renamed).toContain('participant Browser as Web browser');
    const withId = renameSequenceParticipantId(renamed, 'Browser', 'Client');
    expect(withId).toContain('Client->>API: fetch');
    const snapshot = getSequenceDiagramSnapshot(withId);
    const edited = editSequenceMessage(withId, snapshot.messages[0]?.id ?? '', { arrow: '-->>', text: 'request' });
    expect(edited).toContain('Client-->>API: request');
    expect(moveSequenceMessage(edited, getSequenceDiagramSnapshot(edited).messages[1]?.id ?? '', 'up')).toContain('API-->>Client: ok\n  Client-->>API: request');
    const deleted = deleteSequenceParticipant(edited, 'API');
    expect(deleted).toContain('participant Client as Web browser');
    expect(deleted).not.toMatch(/API|Client->>/);
  });

  it('adds notes, activation, autonumber, and balanced fragments while rejecting ambiguous syntax', () => {
    const source = `sequenceDiagram\n  participant A\n  participant B`;
    const next = addSequenceFragment(
      setSequenceAutonumber(addSequenceActivation(addSequenceNote(source, 'over', ['A', 'B'], 'hello'), 'activate', 'A'), '1 1'),
      'critical',
      'payment',
    );
    expect(next).toContain('autonumber 1 1');
    expect(next).toContain('critical payment\n  end');
    expect(isSequenceSourceRepresentable('sequenceDiagram\n  rect rgb(0, 0, 0)\n  end')).toBe(false);
    expect(isSequenceSourceRepresentable('sequenceDiagram\n  alt x\n  and no\n  end')).toBe(false);
  });

  it('edits only the semantic field selected by a current source identity', () => {
    const source = `sequenceDiagram
  participant A as Alpha
  participant B
  A->>B: request
  Note over B: pending
  opt retry
  end`;
    const snapshot = getSequenceDiagramSnapshot(source);
    const participant = snapshot.participants[0];
    const message = snapshot.messages[0];
    const note = snapshot.notes[0];
    const fragment = snapshot.fragments[0];
    expect(editSequenceInlineText(source, participant?.declarationId ?? '', 'Alice')).toContain('participant A as Alice');
    expect(editSequenceInlineText(source, message?.id ?? '', 'fetch')).toContain('A->>B: fetch');
    expect(editSequenceInlineText(source, note?.id ?? '', 'waiting')).toContain('Note over B: waiting');
    expect(editSequenceInlineText(source, fragment?.id ?? '', 'fallback')).toContain('opt fallback');
    expect(() => editSequenceInlineText(source, 'stale', 'nope')).toThrow('changed remotely');
  });

  it('keeps reorders scoped and all delete mutations source-safe', () => {
    const source = `sequenceDiagram
  participant A
  participant B
  A->>B: one
  A->>B: two
  Note over A,B: note one
  Note over A,B: note two
  activate A
  deactivate A
  loop work
    A->>B: nested
  end`;
    expect(moveSequenceParticipant(source, 'B', 'up')).toContain('participant B\n  participant A');
    const snapshot = getSequenceDiagramSnapshot(source);
    const messages = snapshot.messages;
    const notes = snapshot.notes;
    const activations = snapshot.activations;
    const fragment = snapshot.fragments[0];
    expect(moveSequenceMessage(source, messages[1]?.id ?? '', 'up')).toContain('A->>B: two\n  A->>B: one');
    expect(moveSequenceNote(source, notes[1]?.id ?? '', 'up')).toContain('Note over A,B: note two\n  Note over A,B: note one');
    expect(moveSequenceActivation(source, activations[1]?.id ?? '', 'up')).toContain('deactivate A\n  activate A');
    expect(editSequenceActivation(source, activations[0]?.id ?? '', { action: 'deactivate' })).toContain('deactivate A');
    expect(editSequenceFragment(source, fragment?.id ?? '', 'again')).toContain('loop again');
    expect(deleteSequenceMessage(source, messages[0]?.id ?? '')).not.toContain('A->>B: one');
    expect(deleteSequenceNote(source, notes[0]?.id ?? '')).not.toContain('Note over A,B: note one');
    expect(deleteSequenceActivation(source, activations[0]?.id ?? '')).not.toMatch(/^  activate A$/m);
    expect(deleteSequenceFragment(source, fragment?.id ?? '')).not.toContain('nested');
  });

  it('renames and deletes only semantic references, never matching prose or aliases', () => {
    const source = `sequenceDiagram
  participant A as B
  participant B as Bee
  participant C
  A->>C: ask B
  Note over C: B is only prose
  activate B`;
    const renamed = renameSequenceParticipantId(source, 'B', 'Renamed');
    expect(renamed).toContain('participant A as B');
    expect(renamed).toContain('participant Renamed as Bee');
    expect(renamed).toContain('A->>C: ask B');
    expect(renamed).toContain('Note over C: B is only prose');
    expect(renamed).toContain('activate Renamed');
    const deleted = deleteSequenceParticipant(source, 'B');
    expect(deleted).toContain('participant A as B');
    expect(deleted).toContain('A->>C: ask B');
    expect(deleted).toContain('Note over C: B is only prose');
    expect(deleted).not.toContain('participant B as Bee');
    expect(deleted).not.toContain('activate B');
  });

  it('never moves a message across alt branches', () => {
    const source = `sequenceDiagram
  participant A
  participant B
  alt yes
    A->>B: primary
  else no
    A->>B: fallback
  end`;
    const messages = getSequenceDiagramSnapshot(source).messages;
    const fallback = messages.find((message) => message.text === 'fallback');
    expect(moveSequenceMessage(source, fallback?.id ?? '', 'up')).toBe(source);
  });
});
