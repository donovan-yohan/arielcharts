import { classHighlighter, highlightTree } from '@lezer/highlight';
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { MERMAID_CAPABILITY_FIXTURES } from './diagram-capabilities.fixtures';
import {
  MERMAID_HIGHLIGHT_PARSE_BUDGET_MS,
  MERMAID_HIGHLIGHT_STRESS_FIXTURE_LINES,
  createMermaidHighlightStressFixture,
  mermaidLanguage,
} from './mermaid-language';

type TokenSpan = { className: string; from: number; to: number };

function tokenClasses(source: string): string[] {
  return tokenSpans(source).map(({ className }) => className);
}

function tokenSpans(source: string): TokenSpan[] {
  const spans: TokenSpan[] = [];
  highlightTree(mermaidLanguage.parser.parse(source), classHighlighter, (from, to, className) => spans.push({ className, from, to }));
  return spans;
}

function expectTokenSpan(source: string, token: string, className: string): void {
  const from = source.indexOf(token, Math.max(0, source.indexOf('\n') + 1));
  expect(from, `Could not find ${JSON.stringify(token)} in source`).toBeGreaterThanOrEqual(0);
  expect(tokenSpans(source)).toContainEqual({ className, from, to: from + token.length });
}

const FAMILY_GRAMMAR_EXPECTATIONS = {
  architecture: ['service', 'tok-keyword'],
  block: ['columns', 'tok-keyword'],
  c4: ['Person', 'tok-keyword'],
  class: ['class', 'tok-keyword'],
  cynefin: ['complex', 'tok-keyword'],
  'entity-relationship': ['string', 'tok-keyword'],
  'event-modeling': ['entity', 'tok-keyword'],
  flowchart: ['subgraph', 'tok-keyword'],
  gantt: ['dateFormat', 'tok-keyword'],
  gitgraph: ['commit', 'tok-keyword'],
  ishikawa: ['"Problem"', 'tok-string'],
  journey: ['section', 'tok-keyword'],
  kanban: ['todo', 'tok-variableName'],
  mindmap: ['Root', 'tok-variableName'],
  packet: ['"Version"', 'tok-string'],
  pie: ['title', 'tok-keyword'],
  quadrant: ['x-axis', 'tok-keyword'],
  radar: ['axis', 'tok-keyword'],
  railroad: ['optional', 'tok-keyword'],
  requirement: ['requirement', 'tok-keyword'],
  sankey: ['A', 'tok-variableName'],
  sequence: ['participant', 'tok-keyword'],
  state: ['state', 'tok-keyword'],
  swimlane: ['subgraph', 'tok-keyword'],
  timeline: ['title', 'tok-keyword'],
  'tree-view': ['Root', 'tok-variableName'],
  treemap: ['"Root"', 'tok-string'],
  venn: ['set', 'tok-keyword'],
  wardley: ['component', 'tok-keyword'],
  'xy-chart': ['x-axis', 'tok-keyword'],
} as const;

describe('mermaid source language', () => {
  it('recognizes every current catalog family header without importing the renderer parser', () => {
    for (const fixture of MERMAID_CAPABILITY_FIXTURES) {
      expect(tokenClasses(fixture.headerOnlySource), fixture.family).toContain('tok-typeName');
    }
  });

  it('uses position-aware grammar classes across every current catalog fixture', () => {
    for (const fixture of MERMAID_CAPABILITY_FIXTURES) {
      const expectation = FAMILY_GRAMMAR_EXPECTATIONS[fixture.family];
      expect(expectation, `${fixture.family} needs an explicit grammar-token expectation`).toBeDefined();
      expectTokenSpan(fixture.advancedSource, expectation[0], expectation[1]);
    }
  });

  it('recognizes supported authored header aliases', () => {
    for (const header of ['classDiagram-v2', 'flowchart-elk TD', 'graph LR', 'railroad-ebnf-beta', 'stateDiagram', 'zenuml']) {
      expect(tokenClasses(header), header).toContain('tok-typeName');
    }
  });

  it('classifies directives, frontmatter, comments, labels, connectors, numbers, and keywords', () => {
    const source = `---\nconfig:\n  theme: dark\n---\n%%{init: { \"theme\": \"base\" }}%%\nflowchart LR\n  A[\"Label\"] --> B\n  classDef hot fill:#ff0\n  value: 42\n  %% comment`;
    const classes = tokenClasses(source);
    expect(classes).toEqual(expect.arrayContaining([
      'tok-meta', 'tok-propertyName', 'tok-string', 'tok-typeName', 'tok-variableName',
      'tok-operator', 'tok-keyword', 'tok-number', 'tok-punctuation', 'tok-comment',
    ]));
    const directive = '%%{init: { "theme": "base" }}%%';
    expectTokenSpan(source, directive, 'tok-meta');
    const directiveStart = source.indexOf(directive);
    expect(tokenSpans(source).some((span) => span.className === 'tok-comment'
      && span.from < directiveStart + directive.length
      && span.to > directiveStart)).toBe(false);
    expectTokenSpan(source, '%% comment', 'tok-comment');
  });

  it('keeps compact relation spans intact and marks unsupported characters explicitly', () => {
    for (const [source, connector] of [
      ['flowchart LR\n  node-name-->peer-node', '-->'],
      ['sequenceDiagram\n  Alice->>Bob: request', '->>'],
      ['erDiagram\n  CUSTOMER ||--o{ ORDER : places', '||--o{'],
    ]) {
      expectTokenSpan(source, connector, 'tok-operator');
    }
    expectTokenSpan('flowchart LR\n  node-name-->peer-node', 'node-name', 'tok-variableName');
    expectTokenSpan('flowchart LR\n  node-name-->peer-node', 'peer-node', 'tok-variableName');
    expectTokenSpan('flowchart LR\n  A ? B', '?', 'tok-invalid');
  });

  it('fails soft for partial and invalid input', () => {
    expect(() => tokenClasses('sequenceDiagram\n  participant Alice\n  Alice->>')).not.toThrow();
    expect(() => tokenClasses('---\nconfig: [\nflowchart LR\n  A[unterminated')).not.toThrow();
  });

  it(`parses ${MERMAID_HIGHLIGHT_STRESS_FIXTURE_LINES.toLocaleString()} source lines within the ${MERMAID_HIGHLIGHT_PARSE_BUDGET_MS}ms budget`, () => {
    const source = createMermaidHighlightStressFixture();
    const startedAt = performance.now();
    const tree = mermaidLanguage.parser.parse(source);
    const elapsedMs = performance.now() - startedAt;
    expect(tree.length).toBe(source.length);
    expect(elapsedMs).toBeLessThan(MERMAID_HIGHLIGHT_PARSE_BUDGET_MS);
  });

  it('adds presentation data without normalizing source during incremental edits', () => {
    const source = 'flowchart LR\n  Browser --> API';
    const initial = EditorState.create({ doc: source, extensions: mermaidLanguage });
    const updated = initial.update({ changes: { from: initial.doc.length, insert: '\n  API --> DB' } }).state;
    expect(initial.doc.toString()).toBe(source);
    expect(updated.doc.toString()).toBe(`${source}\n  API --> DB`);
    expect(tokenClasses(updated.doc.toString())).toContain('tok-operator');
  });
});
