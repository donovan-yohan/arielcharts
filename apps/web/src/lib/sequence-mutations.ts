export interface SequenceParticipant { id: string; label: string; }
export type SequenceParticipantKind = 'participant' | 'actor';
export type SequenceArrow = '->' | '-->' | '->>' | '-->>' | '-x' | '--x' | '-)' | '--)' | '<<->>' | '<<-->>';
export type SequenceFragmentKind = 'alt' | 'opt' | 'loop' | 'par' | 'critical' | 'break';
export type SequenceActivationAction = 'activate' | 'deactivate';

export interface SequenceSourceRange { start: number; end: number; }
export interface SequenceStatement { id: string; kind: string; range: SequenceSourceRange; sourceText: string; }
export interface SequenceParticipantModel extends SequenceParticipant {
  declarationId?: string; implicit: boolean; kind?: SequenceParticipantKind; created?: boolean; range?: SequenceSourceRange;
}
export interface SequenceMessage extends SequenceStatement {
  kind: 'message'; from: string; to: string; arrow: SequenceArrow; text: string; fragmentPath: string[];
}
export interface SequenceNote extends SequenceStatement {
  kind: 'note'; placement: 'over' | 'left of' | 'right of'; participants: string[]; text: string; fragmentPath: string[];
}
export interface SequenceActivation extends SequenceStatement {
  kind: 'activation'; action: SequenceActivationAction; participant: string; fragmentPath: string[];
}
export interface SequenceAutonumber extends SequenceStatement { kind: 'autonumber'; value: string; }
export interface SequenceFragmentBranch extends SequenceStatement { kind: 'else' | 'and' | 'option'; label: string; }
export interface SequenceFragment extends SequenceStatement {
  kind: SequenceFragmentKind; label: string; endId: string; endRange: SequenceSourceRange; branches: SequenceFragmentBranch[]; depth: number; parentId?: string;
}
export interface SequenceDiagramSnapshot {
  participants: SequenceParticipantModel[]; messages: SequenceMessage[]; notes: SequenceNote[]; activations: SequenceActivation[];
  autonumber?: SequenceAutonumber; fragments: SequenceFragment[]; statements: SequenceStatement[];
}
export type SequenceRepresentability = { representable: true; snapshot: SequenceDiagramSnapshot } | {
  representable: false; reason: string; statement?: SequenceStatement;
};

type InternalStatement = SequenceStatement & { indent: string; lineEnd: number; lineStart: number; raw: string; text: string; };
type ParticipantRecord = SequenceParticipantModel & { statement: InternalStatement; };
type Parsed = SequenceDiagramSnapshot & { participantRecords: ParticipantRecord[]; records: InternalStatement[]; };

const HEADER = 'sequenceDiagram';
// A trailing hyphen is ambiguous with a message arrow (`A-->>B`), so the
// source model deliberately excludes it while retaining ordinary hyphenated ids.
const ID = '[A-Za-z0-9_.]+(?:-[A-Za-z0-9_.]+)*';
const idPattern = new RegExp(`^${ID}$`);
const participantPattern = new RegExp(`^(\\s*)(create\\s+)?(participant|actor)\\s+(${ID})(?:\\s+as\\s+(.+?))?\\s*$`, 'i');
const messagePattern = new RegExp(`^(\\s*)(${ID})\\s*(<<-{1,2}(?:>>|>)|-{1,2}(?:>>|>|x|\\)))\\s*(${ID})\\s*:\\s*(.*?)\\s*$`);
const notePattern = new RegExp(`^(\\s*)note\\s+(over|left\\s+of|right\\s+of)\\s+(${ID}(?:\\s*,\\s*${ID})?)\\s*:\\s*(.*?)\\s*$`, 'i');
const activationPattern = new RegExp(`^(\\s*)(activate|deactivate)\\s+(${ID})\\s*$`, 'i');
const fragmentPattern = /^(\s*)(alt|opt|loop|par|critical|break)(?:\s+(.*?))?\s*$/i;
const branchPattern = /^(\s*)(else|and|option)(?:\s+(.*?))?\s*$/i;
const endPattern = /^\s*end\s*$/i;
const autonumberPattern = /^(\s*)autonumber(?:\s+(.*?))?\s*$/i;
const FRONTMATTER = /^\uFEFF?---[ \t]*(?:\r\n|\n|\r)[\s\S]*?(?:\r\n|\n|\r)---[ \t]*(?:(?:\r\n|\n|\r)|$)/;
const ENDING = /\r\n|\n|\r/;
const TRAILING_ENDING = /(?:\r\n|\n|\r)$/;
const SAFE_ARROWS = new Set<SequenceArrow>(['->', '-->', '->>', '-->>', '-x', '--x', '-)', '--)', '<<->>', '<<-->>']);
const SAFE_FRAGMENT_KINDS = new Set<SequenceFragmentKind>(['alt', 'opt', 'loop', 'par', 'critical', 'break']);
const ESCAPES: Readonly<Record<string, string>> = { '"': '”', '#': '＃', '&': '＆', "'": '’', ',': '，', ':': '：', ';': '；', '<': '‹', '>': '›', '@': '＠', '`': '｀' };

/** The form editor intentionally accepts only a grammar it can map back to exact source ranges. */
export function getSequenceRepresentability(source: string): SequenceRepresentability {
  const parsed = parseSequence(source);
  return parsed ? { representable: true, snapshot: publicSnapshot(parsed) } : { representable: false, reason: lastParseFailure ?? 'The sequence source contains syntax the form editor cannot safely map.' };
}

export function isSequenceDiagramSource(source: string): boolean { return sequenceBodyStart(source) !== null; }
export function isSequenceSourceRepresentable(source: string): boolean { return getSequenceRepresentability(source).representable; }
export function getSequenceDiagramSnapshot(source: string): SequenceDiagramSnapshot { return publicSnapshot(requireSequence(source)); }
export function getSequenceParticipants(source: string): SequenceParticipant[] {
  const result = getSequenceRepresentability(source);
  return result.representable ? result.snapshot.participants.map(({ id, label }) => ({ id, label })) : [];
}

export function createSequenceParticipantId(label: string, existingIds: Iterable<string>): string {
  const base = label.normalize('NFKD').replace(/[^A-Za-z0-9]+/g, ' ').trim().split(/\s+/).filter(Boolean)
    .map((word) => `${word[0]?.toUpperCase() ?? ''}${word.slice(1)}`).join('') || 'Participant';
  const occupied = new Set(existingIds); let candidate = base; let suffix = 2;
  while (occupied.has(candidate)) { candidate = `${base}${suffix}`; suffix += 1; }
  return candidate;
}

export function addSequenceParticipant(source: string, label: string, kind: SequenceParticipantKind = 'participant'): string {
  if (source.trim() && !isSequenceSourceRepresentable(source)) throw unsupported();
  const normalized = normalizeText(label) || 'Participant';
  const id = createSequenceParticipantId(normalized, getSequenceParticipants(source).map((participant) => participant.id));
  return appendStatement(source, `  ${kind} ${id} as ${normalized}`);
}

/** Renames the display label. The Mermaid identifier and all references remain unchanged. */
export function renameSequenceParticipant(source: string, participantId: string, label: string): string {
  const parsed = requireSequence(source); const participant = findParticipantDeclaration(parsed, participantId);
  const next = normalizeText(label) || participantId;
  return replace(source, participant.statement.range, `${participant.statement.indent}${participant.created ? 'create ' : ''}${participant.kind} ${participantId} as ${next}`);
}

/** Renames an identifier and rewrites every representable reference in one atomic minimal diff. */
export function renameSequenceParticipantId(source: string, participantId: string, nextId: string): string {
  const parsed = requireSequence(source); assertId(nextId);
  if (participantId === nextId) return source;
  if (parsed.participants.some((participant) => participant.id === nextId)) throw new Error(`A participant named ${nextId} already exists.`);
  if (!parsed.participants.some((participant) => participant.id === participantId)) throw new Error(`Participant ${participantId} no longer exists.`);
  return replaceMany(source, getSemanticIdentifierChanges(parsed, participantId, nextId));
}

/** Deletes the declaration and every representable statement that references it, never leaving a dangling lifeline. */
export function deleteSequenceParticipant(source: string, participantId: string): string {
  const parsed = requireSequence(source);
  const participant = parsed.participants.find((candidate) => candidate.id === participantId);
  if (!participant) throw new Error(`Participant ${participantId} no longer exists.`);
  const doomed = parsed.records.filter((record) => semanticStatementReferences(record, participantId));
  return deleteStatements(source, doomed);
}

export function moveSequenceParticipant(source: string, participantId: string, directionOrIndex: 'up' | 'down' | number): string {
  const parsed = requireSequence(source); const declarations = parsed.participantRecords;
  const index = declarations.findIndex((participant) => participant.id === participantId);
  if (index < 0) throw new Error(`Participant ${participantId} must have an explicit declaration to move.`);
  const target = resolveMove(index, declarations.length, directionOrIndex); if (target === index) return source;
  return swapStatements(source, declarations[index]?.statement, declarations[target]?.statement);
}

export function addSequenceMessage(source: string, from: string, to: string, text: string, arrow: SequenceArrow = '->>'): string {
  const parsed = requireSequence(source); assertEndpoints(parsed, from, to); assertArrow(arrow);
  return appendStatement(source, `  ${from}${arrow}${to}: ${normalizeText(text) || 'Message'}`);
}

export function editSequenceMessage(source: string, statementId: string, patch: Partial<Pick<SequenceMessage, 'from' | 'to' | 'arrow' | 'text'>>): string {
  const parsed = requireSequence(source); const message = findById(parsed.messages, statementId, 'Message');
  const from = patch.from ?? message.from; const to = patch.to ?? message.to; const arrow = patch.arrow ?? message.arrow;
  assertEndpoints(parsed, from, to); assertArrow(arrow);
  return replace(source, message.range, `${statementIndent(parsed, message.id)}${from}${arrow}${to}: ${normalizeText(patch.text ?? message.text) || 'Message'}`);
}
export function deleteSequenceMessage(source: string, statementId: string): string { const parsed = requireSequence(source); return deleteStatements(source, [findById(parsed.messages, statementId, 'Message')]); }
export function moveSequenceMessage(source: string, statementId: string, directionOrIndex: 'up' | 'down' | number): string {
  const parsed = requireSequence(source); const message = findById(parsed.messages, statementId, 'Message');
  const siblings = parsed.messages.filter((candidate) => samePath(candidate.fragmentPath, message.fragmentPath));
  const index = siblings.findIndex((candidate) => candidate.id === statementId); const target = resolveMove(index, siblings.length, directionOrIndex);
  if (target === index) return source; return swapStatements(source, siblings[index], siblings[target]);
}

export function addSequenceNote(source: string, placement: SequenceNote['placement'], participants: readonly string[], text: string): string {
  const parsed = requireSequence(source); assertNote(parsed, placement, participants);
  return appendStatement(source, `  Note ${placement} ${participants.join(',')}: ${normalizeText(text) || 'Note'}`);
}
export function editSequenceNote(source: string, statementId: string, patch: Partial<Pick<SequenceNote, 'placement' | 'participants' | 'text'>>): string {
  const parsed = requireSequence(source); const note = findById(parsed.notes, statementId, 'Note'); const placement = patch.placement ?? note.placement;
  const participants = patch.participants ?? note.participants; assertNote(parsed, placement, participants);
  return replace(source, note.range, `${statementIndent(parsed, note.id)}Note ${placement} ${participants.join(',')}: ${normalizeText(patch.text ?? note.text) || 'Note'}`);
}
export function deleteSequenceNote(source: string, statementId: string): string { const parsed = requireSequence(source); return deleteStatements(source, [findById(parsed.notes, statementId, 'Note')]); }
export function moveSequenceNote(source: string, statementId: string, directionOrIndex: 'up' | 'down' | number): string {
  const parsed = requireSequence(source); const note = findById(parsed.notes, statementId, 'Note'); const siblings = parsed.notes.filter((candidate) => samePath(candidate.fragmentPath, note.fragmentPath));
  const index = siblings.findIndex((candidate) => candidate.id === statementId); const target = resolveMove(index, siblings.length, directionOrIndex);
  return target === index ? source : swapStatements(source, siblings[index], siblings[target]);
}

export function addSequenceActivation(source: string, action: SequenceActivationAction, participant: string): string {
  const parsed = requireSequence(source); assertActivation(parsed, action, participant); return appendStatement(source, `  ${action} ${participant}`);
}
export function editSequenceActivation(source: string, statementId: string, patch: Partial<Pick<SequenceActivation, 'action' | 'participant'>>): string {
  const parsed = requireSequence(source); const activation = findById(parsed.activations, statementId, 'Activation'); const action = patch.action ?? activation.action; const participant = patch.participant ?? activation.participant;
  assertActivation(parsed, action, participant); return replace(source, activation.range, `${statementIndent(parsed, activation.id)}${action} ${participant}`);
}
export function deleteSequenceActivation(source: string, statementId: string): string { const parsed = requireSequence(source); return deleteStatements(source, [findById(parsed.activations, statementId, 'Activation')]); }
export function moveSequenceActivation(source: string, statementId: string, directionOrIndex: 'up' | 'down' | number): string {
  const parsed = requireSequence(source); const activation = findById(parsed.activations, statementId, 'Activation'); const siblings = parsed.activations.filter((candidate) => samePath(candidate.fragmentPath, activation.fragmentPath));
  const index = siblings.findIndex((candidate) => candidate.id === statementId); const target = resolveMove(index, siblings.length, directionOrIndex);
  return target === index ? source : swapStatements(source, siblings[index], siblings[target]);
}

export function setSequenceAutonumber(source: string, value: string | null = ''): string {
  const parsed = requireSequence(source); const normalized = normalizeAutonumber(value);
  if (!normalized) return parsed.autonumber ? deleteStatements(source, [parsed.autonumber]) : source;
  const statement = `  autonumber${normalized ? ` ${normalized}` : ''}`;
  return parsed.autonumber ? replace(source, parsed.autonumber.range, `${statementIndent(parsed, parsed.autonumber.id)}${statement.trimStart()}`) : appendStatement(source, statement);
}

export function addSequenceFragment(source: string, kind: SequenceFragmentKind, label = ''): string {
  requireSequence(source); assertFragmentKind(kind); const suffix = normalizeText(label); const ending = lineEnding(source);
  return appendStatement(source, `  ${kind}${suffix ? ` ${suffix}` : ''}${ending}  end`);
}
export function editSequenceFragment(source: string, statementId: string, label: string): string {
  const parsed = requireSequence(source); const fragment = findById(parsed.fragments, statementId, 'Fragment');
  return replace(source, fragment.range, `${statementIndent(parsed, fragment.id)}${fragment.kind}${normalizeText(label) ? ` ${normalizeText(label)}` : ''}`);
}
/** Deleting a fragment removes its complete source block, so nested statements cannot become semantically detached. */
export function deleteSequenceFragment(source: string, statementId: string): string {
  const parsed = requireSequence(source); const fragment = findById(parsed.fragments, statementId, 'Fragment');
  return deleteRangeWithLineEnding(source, { start: fragment.range.start, end: fragment.endRange.end });
}
export function moveSequenceFragment(source: string, statementId: string, directionOrIndex: 'up' | 'down' | number): string {
  const parsed = requireSequence(source); const fragment = findById(parsed.fragments, statementId, 'Fragment');
  const siblings = parsed.fragments.filter((candidate) => candidate.parentId === fragment.parentId);
  const index = siblings.findIndex((candidate) => candidate.id === statementId); const target = resolveMove(index, siblings.length, directionOrIndex);
  if (target === index) return source; const other = siblings[target]; if (!other) return source;
  return swapRanges(source, { start: fragment.range.start, end: fragment.endRange.end }, { start: other.range.start, end: other.endRange.end });
}

/** Used by SVG inline editors. It refuses a stale identity or a replacement that makes the full source unrepresentable. */
export function editSequenceStatement(source: string, statementId: string, text: string): string {
  const parsed = requireSequence(source); const statement = parsed.records.find((candidate) => candidate.id === statementId);
  if (!statement) throw new Error('This sequence statement changed remotely and can no longer be resolved safely.');
  const next = replace(source, statement.range, `${statement.indent}${text.trim()}`);
  if (!isSequenceSourceRepresentable(next)) throw new Error('This edit is not safely representable as a sequence statement.');
  return next;
}

/**
 * Narrow inline-edit adapter for Mermaid SVG labels. It never treats visible
 * text as source syntax: the current source identity chooses the semantic field.
 */
export function editSequenceInlineText(source: string, statementId: string, text: string): string {
  const parsed = requireSequence(source);
  const participant = parsed.participantRecords.find((candidate) => candidate.declarationId === statementId);
  if (participant) return renameSequenceParticipant(source, participant.id, text);
  const message = parsed.messages.find((candidate) => candidate.id === statementId);
  if (message) return editSequenceMessage(source, statementId, { text });
  const note = parsed.notes.find((candidate) => candidate.id === statementId);
  if (note) return editSequenceNote(source, statementId, { text });
  const fragment = parsed.fragments.find((candidate) => candidate.id === statementId);
  if (fragment) return editSequenceFragment(source, statementId, text);
  const branch = parsed.fragments.flatMap((candidate) => candidate.branches).find((candidate) => candidate.id === statementId);
  if (branch) return replace(source, branch.range, `${statementIndent(parsed, branch.id)}${branch.kind}${normalizeText(text) ? ` ${normalizeText(text)}` : ''}`);
  throw new Error('This SVG label changed remotely or is not safely editable.');
}

let lastParseFailure: string | null = null;
function parseSequence(source: string): Parsed | null {
  lastParseFailure = null;
  const bodyStart = sequenceBodyStart(source); if (bodyStart === null) return fail('Source is not a sequenceDiagram.');
  const records = splitStatements(source, bodyStart); if (!records) return fail('Sequence statements contain an unterminated quoted value.');
  const participants = new Map<string, ParticipantRecord>(); const messages: SequenceMessage[] = []; const notes: SequenceNote[] = []; const activations: SequenceActivation[] = [];
  const fragments: SequenceFragment[] = []; let autonumber: SequenceAutonumber | undefined; const stack: SequenceFragment[] = [];
  const branchByFragment = new Map<string, string | null>();
  const statements: SequenceStatement[] = [];
  const addParticipant = (id: string, statement?: InternalStatement, fields: Partial<ParticipantRecord> = {}) => {
    const current = participants.get(id); if (current) return current;
    const record: ParticipantRecord = { id, label: fields.label ?? id, implicit: !statement, ...(statement ? { declarationId: statement.id, range: statement.range, statement } : {}), ...fields } as ParticipantRecord;
    participants.set(id, record); return record;
  };
  for (const record of records) {
    const content = record.text.trim(); if (!content || /^%%/.test(content)) continue;
    const fragmentPath = stack.flatMap((fragment) => [fragment.id, branchByFragment.get(fragment.id) ?? `${fragment.id}#main`]);
    let match = record.text.match(participantPattern);
    if (match?.[4] && match[3]) {
      const id = match[4]; if (participants.has(id)) return fail(`Participant ${id} is declared more than once.`);
      addParticipant(id, record, { created: Boolean(match[2]), implicit: false, kind: match[3].toLowerCase() as SequenceParticipantKind, label: match[5]?.trim() || id });
      statements.push({ id: record.id, kind: 'participant', range: record.range, sourceText: record.text }); continue;
    }
    match = record.text.match(messagePattern);
    if (match?.[2] && match[3] && match[4]) {
      const arrow = match[3] as SequenceArrow; if (!SAFE_ARROWS.has(arrow)) return fail(`Unsupported message arrow ${arrow}.`, record);
      const message: SequenceMessage = { id: record.id, kind: 'message', range: record.range, sourceText: record.text, from: match[2], arrow, to: match[4], text: match[5] ?? '', fragmentPath };
      addParticipant(message.from); addParticipant(message.to); messages.push(message); statements.push(message); continue;
    }
    match = record.text.match(notePattern);
    if (match?.[2] && match[3]) {
      const placement = match[2].replace(/\s+/g, ' ').toLowerCase() as SequenceNote['placement']; const ids = match[3].split(',').map((id) => id.trim());
      if ((placement === 'over' && (ids.length < 1 || ids.length > 2)) || (placement !== 'over' && ids.length !== 1)) return fail('Unsupported note placement.', record);
      ids.forEach((id) => addParticipant(id)); const note: SequenceNote = { id: record.id, kind: 'note', range: record.range, sourceText: record.text, placement, participants: ids, text: match[4] ?? '', fragmentPath };
      notes.push(note); statements.push(note); continue;
    }
    match = record.text.match(activationPattern);
    if (match?.[2] && match[3]) {
      addParticipant(match[3]); const activation: SequenceActivation = { id: record.id, kind: 'activation', range: record.range, sourceText: record.text, action: match[2].toLowerCase() as SequenceActivationAction, participant: match[3], fragmentPath };
      activations.push(activation); statements.push(activation); continue;
    }
    match = record.text.match(autonumberPattern);
    if (match) {
      if (stack.length || autonumber) return fail('autonumber must appear once outside a fragment.', record);
      autonumber = { id: record.id, kind: 'autonumber', range: record.range, sourceText: record.text, value: match[2]?.trim() ?? '' }; statements.push(autonumber); continue;
    }
    match = record.text.match(fragmentPattern);
    if (match?.[2]) {
      const kind = match[2].toLowerCase() as SequenceFragmentKind; const fragment: SequenceFragment = { id: record.id, kind, range: record.range, sourceText: record.text, label: match[3]?.trim() ?? '', branches: [], depth: stack.length, ...(stack.length ? { parentId: stack[stack.length - 1]?.id } : {}), endId: '', endRange: { start: 0, end: 0 } };
      fragments.push(fragment); stack.push(fragment); branchByFragment.set(fragment.id, null); statements.push(fragment); continue;
    }
    match = record.text.match(branchPattern);
    if (match?.[2]) {
      const parent = stack[stack.length - 1]; const kind = match[2].toLowerCase() as SequenceFragmentBranch['kind'];
      if (!parent || !isAllowedBranch(parent.kind, kind)) return fail(`The ${kind} branch is not valid here.`, record);
      const branch: SequenceFragmentBranch = { id: record.id, kind, range: record.range, sourceText: record.text, label: match[3]?.trim() ?? '' }; parent.branches.push(branch); branchByFragment.set(parent.id, branch.id); statements.push(branch); continue;
    }
    if (endPattern.test(record.text)) {
      const parent = stack.pop(); if (!parent) return fail('Fragment end has no matching opener.', record);
      branchByFragment.delete(parent.id);
      parent.endId = record.id; parent.endRange = record.range; statements.push({ id: record.id, kind: 'end', range: record.range, sourceText: record.text }); continue;
    }
    return fail('The sequence source contains syntax the semantic editor does not support.', record);
  }
  if (stack.length) return fail('A sequence fragment has no matching end.');
  return { participants: [...participants.values()].map(({ statement: _statement, ...participant }) => participant), participantRecords: [...participants.values()].filter((participant) => !participant.implicit), messages, notes, activations, ...(autonumber ? { autonumber } : {}), fragments, statements, records };
}

function publicSnapshot(parsed: Parsed): SequenceDiagramSnapshot {
  return { participants: parsed.participants.map(({ ...participant }) => participant), messages: parsed.messages.map((item) => ({ ...item, fragmentPath: [...item.fragmentPath] })), notes: parsed.notes.map((item) => ({ ...item, participants: [...item.participants], fragmentPath: [...item.fragmentPath] })), activations: parsed.activations.map((item) => ({ ...item, fragmentPath: [...item.fragmentPath] })), ...(parsed.autonumber ? { autonumber: { ...parsed.autonumber } } : {}), fragments: parsed.fragments.map((item) => ({ ...item, branches: item.branches.map((branch) => ({ ...branch })) })), statements: parsed.statements.map((item) => ({ ...item, range: { ...item.range } })) };
}
function sequenceBodyStart(source: string): number | null {
  const prefix = source.match(FRONTMATTER)?.[0].length ?? 0; const body = source.slice(prefix); const header = body.match(/^[\s]*sequenceDiagram\b/i);
  if (!header) return null; const end = prefix + header[0].length; return /^(?:[ \t]*(?:;|\r\n|\n|\r|$))/.test(source.slice(end)) ? end : null;
}
function splitStatements(source: string, start: number): InternalStatement[] | null {
  const records: InternalStatement[] = []; let lineStart = start; let segmentStart = start; let quote = false; let escaped = false;
  const push = (end: number) => { const raw = source.slice(segmentStart, end); const text = raw.trim(); if (!text || /^%%/.test(text)) return; const indent = raw.match(/^\s*/)?.[0] ?? ''; records.push({ id: statementId(text, segmentStart, end), kind: 'unknown', range: { start: segmentStart, end }, sourceText: raw, text: raw, raw, indent, lineStart, lineEnd: end }); };
  for (let index = start; index <= source.length; index += 1) {
    const character = source[index];
    if (quote) { if (escaped) escaped = false; else if (character === '\\') escaped = true; else if (character === '"') quote = false; continue; }
    if (character === '"') { quote = true; continue; }
    if (character === ';' || character === '\n' || character === '\r' || index === source.length) {
      const commentStatement = source.slice(segmentStart, index).trimStart().startsWith('%%');
      push(index); if (character === ';') {
        if (commentStatement) {
          const nextLine = source.slice(index + 1).search(/\r\n|\n|\r/);
          if (nextLine < 0) break;
          const endingStart = index + 1 + nextLine;
          index = endingStart + (source[endingStart] === '\r' && source[endingStart + 1] === '\n' ? 1 : 0);
          lineStart = index + 1; segmentStart = index + 1; continue;
        }
        let commentStart = index + 1;
        while (source[commentStart] === ' ' || source[commentStart] === '\t') commentStart += 1;
        if (source.startsWith('%%', commentStart)) {
          const nextLine = source.slice(commentStart).search(/\r\n|\n|\r/);
          if (nextLine < 0) break;
          const endingStart = commentStart + nextLine;
          index = endingStart + (source[endingStart] === '\r' && source[endingStart + 1] === '\n' ? 1 : 0);
          lineStart = index + 1; segmentStart = index + 1; continue;
        }
        segmentStart = index + 1; continue;
      }
      if (character === '\r' && source[index + 1] === '\n') index += 1;
      lineStart = index + 1; segmentStart = index + 1;
    }
  }
  return quote ? null : records;
}
function statementId(text: string, start: number, end: number): string { return `${start}:${end}:${hash(text)}`; }
function hash(value: string): string { let result = 2166136261; for (let index = 0; index < value.length; index += 1) result = Math.imul(result ^ value.charCodeAt(index), 16777619); return (result >>> 0).toString(36); }
function fail(reason: string, statement?: SequenceStatement): null { lastParseFailure = reason; return null; }
function requireSequence(source: string): Parsed { const parsed = parseSequence(source); if (!parsed) throw unsupported(); return parsed; }
function unsupported(): Error { return new Error('Sequence form editing requires representable sequence diagram source.'); }
function findParticipantDeclaration(parsed: Parsed, id: string): ParticipantRecord { const participant = parsed.participantRecords.find((candidate) => candidate.id === id); if (!participant) throw new Error(`Participant ${id} must have an explicit declaration to edit.`); return participant; }
function findById<T extends SequenceStatement>(values: readonly T[], id: string, label: string): T { const value = values.find((candidate) => candidate.id === id); if (!value) throw new Error(`${label} changed remotely and can no longer be resolved safely.`); return value; }
function statementIndent(parsed: Parsed, id: string): string { return parsed.records.find((record) => record.id === id)?.indent ?? '  '; }
function assertId(value: string): void { if (!idPattern.test(value)) throw new Error('Participant identifiers may contain only letters, numbers, dots, underscores, and hyphens.'); }
function assertEndpoints(parsed: Parsed, from: string, to: string): void { if (!parsed.participants.some((participant) => participant.id === from) || !parsed.participants.some((participant) => participant.id === to)) throw new Error('Sequence messages require existing participants.'); }
function assertArrow(arrow: SequenceArrow): void { if (!SAFE_ARROWS.has(arrow)) throw new Error('Choose a supported sequence message arrow.'); }
function assertNote(parsed: Parsed, placement: SequenceNote['placement'], participants: readonly string[]): void { if (!['over', 'left of', 'right of'].includes(placement) || !participants.length || participants.length > 2 || (placement !== 'over' && participants.length !== 1) || !participants.every((id) => parsed.participants.some((participant) => participant.id === id))) throw new Error('Notes require existing participants and a supported placement.'); }
function assertActivation(parsed: Parsed, action: SequenceActivationAction, participant: string): void { if (!['activate', 'deactivate'].includes(action) || !parsed.participants.some((candidate) => candidate.id === participant)) throw new Error('Activations require an existing participant.'); }
function assertFragmentKind(kind: SequenceFragmentKind): void { if (!SAFE_FRAGMENT_KINDS.has(kind)) throw new Error('Choose a supported sequence fragment.'); }
function isAllowedBranch(fragment: SequenceFragmentKind, branch: SequenceFragmentBranch['kind']): boolean { return (fragment === 'alt' && branch === 'else') || (fragment === 'par' && branch === 'and') || (fragment === 'critical' && branch === 'option'); }
function normalizeText(value: string): string { return value.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/["#&',:;<>@`]/g, (character) => ESCAPES[character] ?? '').trim(); }
function normalizeAutonumber(value: string | null): string { return value?.replace(/[\r\n\u2028\u2029]+/g, ' ').replace(/[;`]/g, '').trim() ?? ''; }
function appendStatement(source: string, statement: string): string { if (!source) return `${HEADER}\n${statement}`; const ending = lineEnding(source); if (!source.trim()) return `${source}${TRAILING_ENDING.test(source) ? '' : ending}${HEADER}${ending}${statement}`; return `${source}${TRAILING_ENDING.test(source) ? '' : ending}${statement}`; }
function lineEnding(source: string): string { return source.match(ENDING)?.[0] ?? '\n'; }
function indentOf(text: string): string { return text.match(/^\s*/)?.[0] ?? ''; }
type Change = { range: SequenceSourceRange; value: string };
function replace(source: string, range: SequenceSourceRange, value: string): string { return `${source.slice(0, range.start)}${value}${source.slice(range.end)}`; }
function replaceMany(source: string, changes: Change[]): string { return [...changes].sort((left, right) => right.range.start - left.range.start).reduce((next, change) => replace(next, change.range, change.value), source); }
function deleteStatements(source: string, statements: readonly SequenceStatement[]): string { return [...statements].sort((left, right) => right.range.start - left.range.start).reduce((next, statement) => deleteRangeWithLineEnding(next, statement.range), source); }
function deleteRangeWithLineEnding(source: string, range: SequenceSourceRange): string { const after = source.slice(range.end); const ending = after.match(/^(?:\r\n|\n|\r)/)?.[0]; return `${source.slice(0, range.start)}${source.slice(range.end + (ending?.length ?? 0))}`; }
function swapStatements(source: string, left?: SequenceStatement, right?: SequenceStatement): string { if (!left || !right) return source; return swapRanges(source, left.range, right.range); }
function swapRanges(source: string, left: SequenceSourceRange, right: SequenceSourceRange): string { const first = left.start < right.start ? left : right; const second = left.start < right.start ? right : left; return `${source.slice(0, first.start)}${source.slice(second.start, second.end)}${source.slice(first.end, second.start)}${source.slice(first.start, first.end)}${source.slice(second.end)}`; }
function resolveMove(index: number, length: number, directionOrIndex: 'up' | 'down' | number): number { if (index < 0) throw new Error('Statement no longer exists.'); const target = typeof directionOrIndex === 'number' ? directionOrIndex : index + (directionOrIndex === 'up' ? -1 : 1); return Math.max(0, Math.min(length - 1, target)); }
function samePath(left: readonly string[], right: readonly string[]): boolean { return left.length === right.length && left.every((part, index) => part === right[index]); }
// `-` is normally part of an id, but is also the first byte of every Mermaid arrow.
function getSemanticIdentifierChanges(parsed: Parsed, current: string, next: string): Change[] {
  return parsed.records.flatMap((record) => semanticIdentifierRanges(record, current).map((range) => ({ range, value: next })));
}
function semanticStatementReferences(record: InternalStatement, participantId: string): boolean { return semanticIdentifierRanges(record, participantId).length > 0; }
function semanticIdentifierRanges(record: InternalStatement, id: string): SequenceSourceRange[] {
  const participant = record.text.match(participantPattern);
  if (participant?.[4] === id) return [rangeAt(record, record.text.indexOf(participant[4]), id.length)];
  const message = record.text.match(messagePattern);
  if (message?.[2] && message[4]) {
    const ranges: SequenceSourceRange[] = []; const fromStart = record.text.indexOf(message[2]);
    if (message[2] === id) ranges.push(rangeAt(record, fromStart, id.length));
    const toStart = record.text.indexOf(message[4], fromStart + message[2].length);
    if (message[4] === id) ranges.push(rangeAt(record, toStart, id.length));
    return ranges;
  }
  const note = record.text.match(notePattern);
  if (note?.[3]) {
    const start = record.text.indexOf(note[3]); let offset = 0; const ranges: SequenceSourceRange[] = [];
    for (const participantId of note[3].split(',')) {
      const trimmed = participantId.trim(); const participantStart = note[3].indexOf(trimmed, offset);
      if (trimmed === id) ranges.push(rangeAt(record, start + participantStart, id.length));
      offset = participantStart + trimmed.length;
    }
    return ranges;
  }
  const activation = record.text.match(activationPattern);
  return activation?.[3] === id ? [rangeAt(record, record.text.indexOf(activation[3]), id.length)] : [];
}
function rangeAt(record: InternalStatement, offset: number, length: number): SequenceSourceRange { return { start: record.range.start + offset, end: record.range.start + offset + length }; }
