export interface SequenceParticipant {
  id: string;
  label: string;
}

const SEQUENCE_HEADER = 'sequenceDiagram';
const PARTICIPANT_ID = '[A-Za-z0-9_.-]+';
const PARTICIPANT_PATTERN = new RegExp(
  `^\\s*(?:create\\s+)?(?:participant|actor)\\s+(${PARTICIPANT_ID})(?:\\s+as\\s+(.+?))?\\s*$`,
);
const MESSAGE_PATTERN = new RegExp(
  `^\\s*(${PARTICIPANT_ID}?)\\s*(?:-{1,2}(?:>>|>|x|\\))|<<-{1,2}(?:>>|>))\\s*(${PARTICIPANT_ID})\\s*:`,
);
const PARTICIPANT_DECLARATION_PATTERN = /^\s*(?:create\s+)?(?:participant|actor)\b/i;
const MESSAGE_ARROW_PATTERN = /(?:-{1,2}(?:>>|>|x|\))|<<-{1,2}(?:>>|>))/;
const NOTE_PATTERN = /^\s*note\b/i;
const MERMAID_COMMENT_PATTERN = /^\s*%%/;
const FRONTMATTER_PATTERN = /^\uFEFF?---[ \t]*(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)---[ \t]*(?:(?:\r\n|\n|\r)|$)/;
const LINE_ENDING_PATTERN = /\r\n|\n|\r/;
const TRAILING_LINE_ENDING_PATTERN = /(?:\r\n|\n|\r)$/;
const TEXT_ESCAPE_MAP: Readonly<Record<string, string>> = {
  '"': '”',
  '#': '＃',
  '&': '＆',
  "'": '’',
  ',': '，',
  ':': '：',
  ';': '；',
  '<': '‹',
  '>': '›',
  '@': '＠',
  '`': '｀',
};
const TEXT_DELIMITER_PATTERN = /["#&',:;<>@`]/g;
const TEXT_LINE_BREAK_PATTERN = /[\r\n\u2028\u2029]+/g;

export function isSequenceDiagramSource(source: string): boolean {
  return getSequenceBody(source) !== null;
}

export function isSequenceSourceRepresentable(source: string): boolean {
  const body = getSequenceBody(source);
  if (body === null) return false;

  return getSequenceStatements(body).every((statement) => {
    if (!statement.trim()) return true;
    if (NOTE_PATTERN.test(statement)) return false;
    if (PARTICIPANT_DECLARATION_PATTERN.test(statement)) {
      return PARTICIPANT_PATTERN.test(statement);
    }

    const messageSignature = statement.slice(0, statement.indexOf(':') < 0 ? undefined : statement.indexOf(':'));
    if (MESSAGE_ARROW_PATTERN.test(messageSignature)) {
      return MESSAGE_PATTERN.test(statement);
    }
    return true;
  });
}

export function getSequenceParticipants(source: string): SequenceParticipant[] {
  const body = getSequenceBody(source);
  if (body === null) return [];

  const participants = new Map<string, SequenceParticipant>();
  const add = (id: string, label = id) => {
    if (!participants.has(id)) participants.set(id, { id, label });
  };

  for (const statement of getSequenceStatements(body)) {
    const declaration = statement.match(PARTICIPANT_PATTERN);
    if (declaration?.[1]) {
      add(declaration[1], declaration[2]?.trim() || declaration[1]);
      continue;
    }
    const message = statement.match(MESSAGE_PATTERN);
    if (message?.[1] && message[2]) {
      add(message[1]);
      add(message[2]);
    }
  }

  return [...participants.values()];
}

function getSequenceStatements(body: string): string[] {
  return body.split(/\r\n|\n|\r/).flatMap(splitSequencePhysicalLine);
}

function splitSequencePhysicalLine(line: string): string[] {
  const statements: string[] = [];
  let current = '';
  let escaped = false;
  let inQuotedValue = false;

  for (const character of line) {
    if (inQuotedValue) {
      current += character;
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inQuotedValue = false;
      }
      continue;
    }

    if (character === '"') {
      current += character;
      inQuotedValue = true;
      continue;
    }

    if (character === ';') {
      if (MERMAID_COMMENT_PATTERN.test(current)) return statements;
      statements.push(current);
      current = '';
      continue;
    }

    current += character;
  }

  return MERMAID_COMMENT_PATTERN.test(current) ? statements : [...statements, current];
}

export function createSequenceParticipantId(label: string, existingIds: Iterable<string>): string {
  const base = label
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`)
    .join('') || 'Participant';
  const occupied = new Set(existingIds);
  let candidate = base;
  let suffix = 2;
  while (occupied.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  return candidate;
}

export function addSequenceParticipant(source: string, label: string): string {
  if (source.trim() && (!isSequenceDiagramSource(source) || !isSequenceSourceRepresentable(source))) {
    throw new Error('Sequence participants require representable sequence diagram source.');
  }
  const normalizedLabel = normalizeSequenceText(label) || 'Participant';
  const participants = getSequenceParticipants(source);
  const id = createSequenceParticipantId(normalizedLabel, participants.map((participant) => participant.id));
  return appendSequenceLine(source, `  participant ${id} as ${normalizedLabel}`);
}

export function addSequenceMessage(source: string, from: string, to: string, message: string): string {
  if (!isSequenceSourceRepresentable(source)) {
    throw new Error('Sequence messages require representable sequence diagram source.');
  }
  const participants = getSequenceParticipants(source);
  const ids = new Set(participants.map((participant) => participant.id));
  if (!ids.has(from) || !ids.has(to)) {
    throw new Error('Sequence messages require existing participants.');
  }
  const normalizedMessage = normalizeSequenceText(message) || 'Message';
  return appendSequenceLine(source, `  ${from}->>${to}: ${normalizedMessage}`);
}

function appendSequenceLine(source: string, line: string): string {
  if (source.length === 0) return `${SEQUENCE_HEADER}\n${line}`;

  const lineEnding = source.match(LINE_ENDING_PATTERN)?.[0] ?? '\n';
  if (source.trim().length === 0) {
    const separator = TRAILING_LINE_ENDING_PATTERN.test(source) ? '' : lineEnding;
    return `${source}${separator}${SEQUENCE_HEADER}${lineEnding}${line}`;
  }
  const separator = TRAILING_LINE_ENDING_PATTERN.test(source) ? '' : lineEnding;
  return `${source}${separator}${line}`;
}

function getSequenceBody(source: string): string | null {
  const sourceWithoutFrontmatter = source.slice(source.match(FRONTMATTER_PATTERN)?.[0].length ?? 0);
  const header = sourceWithoutFrontmatter.match(/^[\s]*sequenceDiagram\b/i);
  if (!header) return null;

  const remainder = sourceWithoutFrontmatter.slice(header[0].length);
  return /^(?:[ \t]*(?:;|\r\n|\n|\r|$))/.test(remainder) ? remainder : null;
}

function normalizeSequenceText(value: string): string {
  return value
    .replace(TEXT_LINE_BREAK_PATTERN, ' ')
    .replace(TEXT_DELIMITER_PATTERN, (delimiter) => TEXT_ESCAPE_MAP[delimiter] ?? '')
    .trim();
}
