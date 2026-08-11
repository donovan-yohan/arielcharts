import { HighlightStyle, StreamLanguage, syntaxHighlighting, type StreamParser } from '@codemirror/language';
import { tags } from '@lezer/highlight';

/**
 * Mermaid's public parser is intentionally renderer-oriented: it does not
 * expose one stable, incremental grammar for every built-in diagram family.
 * This bounded line tokenizer is therefore presentation-only. It accepts
 * incomplete text, never calls Mermaid, and is deliberately conservative
 * about family-specific grammar; canonical source remains the Y.Text binding.
 */
const MERMAID_HEADERS = new Set([
  'architecture-beta', 'block-beta', 'c4component', 'c4container', 'c4context', 'c4dynamic',
  'classdiagram', 'classdiagram-v2', 'cynefin-beta', 'erdiagram', 'eventmodeling', 'flowchart', 'flowchart-elk',
  'gantt', 'gitgraph', 'graph', 'ishikawa-beta', 'journey', 'kanban', 'mindmap', 'packet-beta', 'pie',
  'quadrantchart', 'radar-beta', 'railroad-abnf-beta', 'railroad-beta', 'railroad-ebnf-beta', 'railroad-peg-beta',
  'requirementdiagram', 'sankey-beta', 'sequencediagram', 'statediagram', 'statediagram-v2', 'swimlane-beta',
  'timeline', 'treeview-beta', 'treemap-beta', 'venn-beta', 'wardley-beta', 'xychart-beta', 'zenuml',
]);

const MERMAID_KEYWORDS = new Set([
  'accdescr', 'acctitle', 'activate', 'actor', 'align', 'alt', 'and', 'as', 'at', 'autonumber', 'axisformat',
  'block', 'boundary', 'branch', 'break', 'callback', 'checkout', 'cherry-pick', 'class', 'classdef', 'click',
  'columns', 'commit', 'component', 'container', 'create', 'critical', 'dateformat', 'db', 'deactivate', 'destroy',
  'direction', 'else', 'end', 'enum', 'exclude', 'extends', 'group', 'implements', 'in', 'include', 'interface',
  'junction', 'link', 'loop', 'merge', 'namespace', 'note', 'of', 'opt', 'option', 'over', 'par', 'participant',
  'person', 'rect', 'relationship', 'requirement', 'section', 'service', 'state', 'style', 'subgraph', 'system',
  'title', 'type', 'updateelementstyle', 'verify', 'verifyby', 'verifymethod', 'where',
  'bt', 'lr', 'rl', 'tb', 'td',
]);

/**
 * These are grammar words that only have meaning after their own diagram
 * header. Keeping them family-scoped avoids colouring an ordinary flowchart
 * node named `set` or `axis` as a keyword.
 */
const FAMILY_KEYWORDS: Readonly<Record<string, ReadonlySet<string>>> = {
  'architecture-beta': new Set(['group', 'service', 'junction', 'align', 'in']),
  'block-beta': new Set(['columns', 'block', 'end']),
  c4component: new Set(['boundary', 'person', 'system', 'container', 'component', 'rel']),
  c4container: new Set(['boundary', 'person', 'system', 'container', 'component', 'rel']),
  c4context: new Set(['boundary', 'person', 'system', 'container', 'component', 'rel']),
  c4dynamic: new Set(['boundary', 'person', 'system', 'container', 'component', 'rel']),
  'classdiagram': new Set(['class', 'enum', 'interface', 'namespace', 'extends', 'implements']),
  'classdiagram-v2': new Set(['class', 'enum', 'interface', 'namespace', 'extends', 'implements']),
  'cynefin-beta': new Set(['complex', 'complicated', 'clear', 'chaotic', 'confusion']),
  erdiagram: new Set(['string', 'int', 'float', 'date', 'boolean']),
  eventmodeling: new Set(['entity', 'tf', 'evt', 'cmd', 'act', 'agg', 'pol', 'read', 'ui']),
  flowchart: new Set(['subgraph', 'end', 'direction']),
  'flowchart-elk': new Set(['subgraph', 'end', 'direction']),
  graph: new Set(['subgraph', 'end', 'direction']),
  gantt: new Set(['title', 'dateformat', 'axisformat', 'section', 'done', 'active', 'crit', 'milestone', 'after']),
  gitgraph: new Set(['commit', 'branch', 'checkout', 'merge', 'cherry-pick']),
  journey: new Set(['title', 'section']),
  pie: new Set(['title', 'showdata']),
  quadrantchart: new Set(['title', 'x-axis', 'y-axis', 'quadrant-1', 'quadrant-2', 'quadrant-3', 'quadrant-4']),
  'radar-beta': new Set(['title', 'axis', 'curve', 'ticks', 'min', 'max', 'showlegend', 'graticule']),
  'railroad-beta': new Set(['terminal', 'optional', 'sequence', 'choice', 'oneormore', 'zeroormore']),
  'railroad-ebnf-beta': new Set(['terminal', 'optional', 'sequence', 'choice', 'oneormore', 'zeroormore']),
  'railroad-abnf-beta': new Set(['terminal', 'optional', 'sequence', 'choice', 'oneormore', 'zeroormore']),
  'railroad-peg-beta': new Set(['terminal', 'optional', 'sequence', 'choice', 'oneormore', 'zeroormore']),
  requirementdiagram: new Set(['requirement', 'element', 'functionalrequirement', 'type', 'text', 'risk', 'verifymethod', 'verifyby']),
  sequencediagram: new Set(['autonumber', 'participant', 'actor', 'activate', 'deactivate', 'note', 'over', 'loop', 'alt', 'else', 'opt', 'par', 'critical', 'break']),
  statediagram: new Set(['state']),
  'statediagram-v2': new Set(['state']),
  'swimlane-beta': new Set(['subgraph', 'end']),
  timeline: new Set(['title', 'section']),
  'venn-beta': new Set(['title', 'set', 'union', 'style']),
  'wardley-beta': new Set(['title', 'anchor', 'component', 'evolve', 'pipeline', 'note', 'inertia']),
  'xychart-beta': new Set(['title', 'x-axis', 'y-axis', 'line', 'bar']),
};

const CONNECTOR = /^(?:<-->|<--|-->>|<<--|-->|==>|-.->|---|--|->>|->|[<|o}]+[-.=]+[>|o{]+|[-.=]+[>|o{]+)/u;
const COLOR = /^#[\da-f]{3,8}\b/iu;
const NUMBER = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:e[+-]?\d+)?/iu;
// A hyphen remains part of an identifier only when it cannot begin an arrow.
// That lets `node-name` stay one identifier while `A-->B` yields A, -->, B.
const WORD = /^[\p{L}_$][\p{L}\p{N}_$]*(?:-(?![-.>])[\p{L}\p{N}_$]+)*/u;

interface MermaidTokenizerState {
  family: string | null;
  firstContent: boolean;
  frontmatter: boolean;
}

function readQuoted(stream: Parameters<NonNullable<StreamParser<MermaidTokenizerState>['token']>>[0], quote: string): void {
  stream.next();
  while (!stream.eol()) {
    const character = stream.next();
    if (character === '\\') stream.next();
    else if (character === quote) return;
  }
}

const mermaidTokenizer: StreamParser<MermaidTokenizerState> = {
  startState: () => ({ family: null, firstContent: true, frontmatter: false }),
  token(stream, state) {
    if (stream.sol() && stream.match(/^\s*---\s*$/u, false)) {
      stream.skipToEnd();
      state.frontmatter = !state.frontmatter;
      return 'meta';
    }
    if (stream.eatSpace()) return null;
    if (stream.match(/^%%\{.*\}%%/u)) {
      return 'meta';
    }
    if (stream.match('%%{')) {
      stream.skipToEnd();
      return 'meta';
    }
    if (stream.match('%%')) {
      stream.skipToEnd();
      return 'comment';
    }
    if (state.frontmatter) {
      if (stream.match(/^[\p{L}_-][\p{L}\p{N}_-]*(?=\s*:)/u)) return 'propertyName';
      if (stream.peek() === '"' || stream.peek() === "'") {
        readQuoted(stream, stream.peek()!);
        return 'string';
      }
      if (stream.match(NUMBER)) return 'number';
      if (stream.match(WORD)) return 'variableName';
      stream.next();
      return 'punctuation';
    }
    if (stream.peek() === '"' || stream.peek() === "'") {
      readQuoted(stream, stream.peek()!);
      return 'string';
    }
    if (stream.match(COLOR)) return 'string';
    if (stream.match(CONNECTOR)) return 'operator';
    if (stream.match(NUMBER)) return 'number';
    if (stream.match(/[\[\]{}()<>:,;|@=./+*]/u)) return 'punctuation';
    const word = stream.match(WORD);
    if (word && word !== true) {
      const normalized = word[0].toLowerCase();
      if (state.firstContent && MERMAID_HEADERS.has(normalized)) {
        state.firstContent = false;
        state.family = normalized;
        return 'typeName';
      }
      state.firstContent = false;
      return MERMAID_KEYWORDS.has(normalized) || FAMILY_KEYWORDS[state.family ?? '']?.has(normalized)
        ? 'keyword'
        : 'variableName';
    }
    state.firstContent = false;
    stream.next();
    return 'invalid';
  },
};

export const mermaidLanguage = StreamLanguage.define(mermaidTokenizer);

const mermaidHighlightStyle = HighlightStyle.define([
  { tag: [tags.keyword, tags.typeName, tags.propertyName], color: 'var(--source-syntax-keyword)', fontWeight: '600' },
  { tag: tags.string, color: 'var(--source-syntax-string)' },
  { tag: tags.number, color: 'var(--source-syntax-number)' },
  { tag: tags.comment, color: 'var(--source-syntax-comment)', fontStyle: 'italic' },
  { tag: tags.operator, color: 'var(--source-syntax-operator)' },
  { tag: tags.invalid, color: 'var(--source-syntax-invalid)', textDecoration: 'underline wavy' },
  { tag: tags.punctuation, color: 'var(--ink-muted)' },
  { tag: tags.variableName, color: 'var(--ink)' },
]);

export const mermaidSourceLanguage = [
  mermaidLanguage,
  syntaxHighlighting(mermaidHighlightStyle),
];

export const MERMAID_HIGHLIGHT_STRESS_FIXTURE_LINES = 4_000;
export const MERMAID_HIGHLIGHT_PARSE_BUDGET_MS = 250;

export function createMermaidHighlightStressFixture(lines = MERMAID_HIGHLIGHT_STRESS_FIXTURE_LINES): string {
  return `flowchart LR\n${Array.from({ length: lines }, (_, index) => `  node_${index}[\"Node ${index}\"] --> node_${index + 1}`).join('\n')}`;
}
