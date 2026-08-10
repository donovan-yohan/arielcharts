import { describe, expect, it } from 'vitest';
import {
  addSequenceMessage,
  addSequenceParticipant,
  createSequenceParticipantId,
  getSequenceParticipants,
  isSequenceDiagramSource,
  isSequenceSourceRepresentable,
} from './sequence-mutations';

describe('sequence source mutations', () => {
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

  it('withholds Note-only sequence diagrams because their participant ownership is not safely mutable', () => {
    const source = `sequenceDiagram
  Note over A,B: hello`;

    expect(isSequenceSourceRepresentable(source)).toBe(false);
    expect(getSequenceParticipants(source)).toEqual([]);
    expect(() => addSequenceParticipant(source, 'Client')).toThrow('representable sequence diagram source');
    expect(() => addSequenceMessage(source, 'A', 'B', 'hi')).toThrow('representable sequence diagram source');
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
});
