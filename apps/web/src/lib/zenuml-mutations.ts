export type ZenUmlParticipantKind = 'participant' | 'actor' | 'database' | 'boundary' | 'control' | 'entity' | 'queue';
export type ZenUmlMessageKind = 'async' | 'sync' | 'return';
export type ZenUmlControlKind = 'if' | 'else-if' | 'else' | 'opt' | 'par' | 'while' | 'for' | 'foreach' | 'loop' | 'try' | 'catch' | 'finally';

export interface ZenUmlParticipant { alias: string; kind: ZenUmlParticipantKind; label: string; }
export interface ZenUmlMessage { assignment: string | null; from: string | null; kind: ZenUmlMessageKind; text: string; to: string | null; }
export interface ZenUmlControl { depth: number; kind: ZenUmlControlKind; label: string; }
export type ZenUmlBlockIdentity = { identity: ZenUmlControlIdentity; type: 'control' } | { identity: ZenUmlMessageIdentity; type: 'message' };
export interface ZenUmlBlock { depth: number; identity: ZenUmlBlockIdentity; label: string; }
export interface ZenUmlDiagramSnapshot { blocks: ZenUmlBlock[]; controls: ZenUmlControl[]; messages: ZenUmlMessage[]; participants: ZenUmlParticipant[]; }
export interface ZenUmlParticipantIdentity { occurrence: number; participant: ZenUmlParticipant; }
export interface ZenUmlMessageIdentity { message: ZenUmlMessage; occurrence: number; }
export interface ZenUmlControlIdentity { control: ZenUmlControl; occurrence: number; }

interface Line { compoundFragment?: 'close' | 'open'; contentEnd: number; end: number; index: number; physicalIndent?: string; start: number; text: string; }
interface ParticipantRecord extends ZenUmlParticipant { line: Line | null; }
interface MessageRecord extends ZenUmlMessage { close: Line | null; depth: number; line: Line; }
interface ControlRecord extends ZenUmlControl { close: Line; line: Line; }
interface ParsedZenUml { controls: ControlRecord[]; header: Line; lines: Line[]; messages: MessageRecord[]; participants: ParticipantRecord[]; }

const HEADER = /^zenuml[\t ]*$/iu;
const IDENTIFIER = String.raw`[A-Za-z_$][A-Za-z0-9_$.-]*`;
const ANNOTATOR = new RegExp(`^@(Actor|Database|Boundary|Control|Entity|Queue)[\\t ]+(${IDENTIFIER})(?:[\\t ]+as[\\t ]+(.+))?[\\t ]*$`, 'u');
const ALIAS = new RegExp(`^(${IDENTIFIER})[\\t ]+as[\\t ]+(.+?)[\\t ]*$`, 'u');
const BARE_PARTICIPANT = new RegExp(`^(${IDENTIFIER})[\\t ]*$`, 'u');
const ASYNC = new RegExp(`^(${IDENTIFIER})[\\t ]*->[\\t ]*(${IDENTIFIER})[\\t ]*:[\\t ]*(.+?)[\\t ]*$`, 'u');
const SYNC = new RegExp(`^(?:(${IDENTIFIER})[\\t ]*=[\\t ]*)?(?:(${IDENTIFIER})[\\t ]*->[\\t ]*)?(${IDENTIFIER})\\.([A-Za-z_$][A-Za-z0-9_$]*)(\\([^{}\\r\\n]*\\))?[\\t ]*(\\{)?[\\t ]*$`, 'u');
const RETURN = /^return(?:[\t ]+(.+?))?[\t ]*$/u;
const CONTROL = /^(?:(if|while|for|foreach|forEach|loop|catch)[\t ]*(?:\(([^{}\r\n]*)\))?|(?:else[\t ]+if)[\t ]*\(([^{}\r\n]*)\)|(else|opt|par|try|finally))[\t ]*\{[\t ]*$/u;
const COMPOUND_CONTINUATION = /^\}[\t ]+((?:else[\t ]+if)[\t ]*\([^{}\r\n]*\)|else|catch(?:[\t ]*\([^{}\r\n]*\))?|finally)[\t ]*\{[\t ]*$/u;
const CLOSE_CONTROL = /^\}[\t ]*$/u;
const COMMENT = /^\/\//u;

export function isZenUmlDiagramSource(source: string): boolean { return parseZenUml(source) !== null; }
export function isZenUmlSourceRepresentable(source: string): boolean { return parseZenUml(source) !== null; }
export function getZenUmlDiagramSnapshot(source: string): ZenUmlDiagramSnapshot {
  const parsed = requireZenUml(source);
  const controls = parsed.controls.map(publicControl);
  const messages = parsed.messages.map(publicMessage);
  return {
    blocks: [
      ...parsed.controls.map((control, index) => ({ depth: control.depth, identity: { identity: getZenUmlControlIdentity(controls[index]!, controls), type: 'control' as const }, label: `${control.kind}${control.label ? ` (${control.label})` : ''}` })),
      ...parsed.messages.flatMap((message, index) => message.close ? [{ depth: message.depth, identity: { identity: getZenUmlMessageIdentity(messages[index]!, messages), type: 'message' as const }, label: `${message.to ?? 'call'}.${message.text}` }] : []),
    ].sort((a, b) => resolveBlockRecord(parsed, a.identity).line.start - resolveBlockRecord(parsed, b.identity).line.start),
    controls,
    messages,
    participants: parsed.participants.map(publicParticipant),
  };
}

export function getZenUmlParticipantIdentity(value: ZenUmlParticipant, values: readonly ZenUmlParticipant[] = []): ZenUmlParticipantIdentity {
  return { participant: publicParticipant(value), occurrence: occurrence(value, values, sameParticipant) };
}
export function getZenUmlMessageIdentity(value: ZenUmlMessage, values: readonly ZenUmlMessage[] = []): ZenUmlMessageIdentity {
  return { message: publicMessage(value), occurrence: occurrence(value, values, sameMessage) };
}
export function getZenUmlControlIdentity(value: ZenUmlControl, values: readonly ZenUmlControl[] = []): ZenUmlControlIdentity {
  return { control: publicControl(value), occurrence: occurrence(value, values, sameControl) };
}

export function addZenUmlParticipant(source: string, participant: ZenUmlParticipant): string {
  const parsed = requireZenUml(source || 'zenuml'); const value = normalizeParticipant(participant);
  if (parsed.participants.some((item) => item.alias === value.alias)) throw new Error('A ZenUML participant with that alias already exists.');
  const prefix = value.kind === 'participant' ? '' : `@${capitalize(value.kind)} `;
  const statement = value.kind === 'participant'
    ? value.label === value.alias ? value.alias : `${value.alias} as ${value.label}`
    : `${prefix}${value.alias}${value.label === value.alias ? '' : ` as ${value.label}`}`;
  return requireValidMutation(appendStatement(source || 'zenuml', `  ${statement}`));
}

export function editZenUmlParticipant(source: string, identity: ZenUmlParticipantIdentity, patch: Partial<ZenUmlParticipant>): string {
  const parsed = requireZenUml(source); const current = resolveParticipant(parsed, identity); const value = normalizeParticipant({ ...publicParticipant(current), ...patch });
  if (!current.line) throw new Error('Implicit ZenUML participants must be declared before their metadata can be edited.');
  if (value.alias !== current.alias && parsed.participants.some((item) => item !== current && item.alias === value.alias)) throw new Error('A ZenUML participant with that alias already exists.');
  const declaration = value.kind === 'participant'
    ? value.label === value.alias ? value.alias : `${value.alias} as ${value.label}`
    : `@${capitalize(value.kind)} ${value.alias}${value.label === value.alias ? '' : ` as ${value.label}`}`;
  let next = replaceLine(source, current.line, `${indentOf(current.line.text)}${declaration}`);
  if (value.alias !== current.alias) {
    const reparsed = requireZenUml(next); const replacements = reparsed.messages.flatMap((message) => {
      const line = message.line.text; let body = line;
      if (message.kind === 'async') {
        const match = ASYNC.exec(line.trim());
        if (match) body = `${indentOf(line)}${match[1] === current.alias ? value.alias : match[1]}->${match[2] === current.alias ? value.alias : match[2]}: ${match[3]}`;
      }
      else if (message.kind === 'sync' && (message.from === current.alias || message.to === current.alias)) {
        const match = SYNC.exec(line.trim());
        if (match) body = `${indentOf(line)}${match[1] ? `${match[1]} = ` : ''}${match[2] ? `${match[2] === current.alias ? value.alias : match[2]}->` : ''}${match[3] === current.alias ? value.alias : match[3]}.${match[4]}${match[5] ?? ''}${match[6] ? ' {' : ''}`;
      }
      return body === line ? [] : [{ line: message.line, text: body }];
    });
    next = replaceLines(next, replacements);
  }
  return requireValidMutation(next);
}

export function deleteZenUmlParticipant(source: string, identity: ZenUmlParticipantIdentity): string {
  const parsed = requireZenUml(source); const current = resolveParticipant(parsed, identity);
  if (!current.line) throw new Error('Implicit ZenUML participants are removed by deleting their messages.');
  if (parsed.messages.some((item) => item.from === current.alias || item.to === current.alias)) throw new Error('Delete messages that reference this ZenUML participant first.');
  return requireValidMutation(deleteLines(source, [current.line]));
}

export function moveZenUmlParticipant(source: string, identity: ZenUmlParticipantIdentity, direction: 'up' | 'down'): string {
  const parsed = requireZenUml(source); const current = resolveParticipant(parsed, identity); if (!current.line) return source;
  const declared = parsed.participants.filter((item): item is ParticipantRecord & { line: Line } => item.line !== null);
  const index = declared.indexOf(current as ParticipantRecord & { line: Line }); const other = declared[index + (direction === 'up' ? -1 : 1)];
  return other ? requireValidMutation(swapLineText(source, current.line, other.line)) : source;
}

export function addZenUmlMessage(source: string, message: ZenUmlMessage, parent?: ZenUmlBlockIdentity): string {
  const parsed = requireZenUml(source || 'zenuml'); const value = normalizeMessage(message);
  const statement = value.kind === 'return' ? `return${value.text ? ` ${value.text}` : ''}` : (() => {
    if (!value.to) throw new Error('ZenUML messages require a recipient.');
    return value.kind === 'async'
      ? `${value.from ?? parsed.participants[0]?.alias ?? 'Client'}->${value.to}: ${value.text}`
      : `${value.assignment ? `${value.assignment} = ` : ''}${value.from ? `${value.from}->` : ''}${value.to}.${value.text}`;
  })();
  return requireValidMutation(insertBlockStatement(source || 'zenuml', parsed, statement, parent));
}

export function editZenUmlMessage(source: string, identity: ZenUmlMessageIdentity, patch: Partial<ZenUmlMessage>): string {
  const parsed = requireZenUml(source); const current = resolveMessage(parsed, identity); const value = normalizeMessage({ ...publicMessage(current), ...patch });
  if (value.kind !== current.kind) throw new Error('Changing a ZenUML message kind is not supported by this form.');
  let statement: string;
  if (value.kind === 'return') statement = `return${value.text ? ` ${value.text}` : ''}`;
  else if (value.kind === 'async') {
    if (!value.from || !value.to) throw new Error('Async ZenUML messages require sender and recipient aliases.');
    statement = `${value.from}->${value.to}: ${value.text}`;
  } else {
    if (!value.to) throw new Error('Sync ZenUML calls require a recipient.');
    statement = `${value.assignment ? `${value.assignment} = ` : ''}${value.from ? `${value.from}->` : ''}${value.to}.${value.text}${current.line.text.trimEnd().endsWith('{') ? ' {' : ''}`;
  }
  return requireValidMutation(replaceLine(source, current.line, `${indentOf(current.line.text)}${statement}`));
}

export function deleteZenUmlMessage(source: string, identity: ZenUmlMessageIdentity): string {
  const parsed = requireZenUml(source); const current = resolveMessage(parsed, identity);
  if (current.line.text.trimEnd().endsWith('{')) throw new Error('Delete the matching nested call block from source after removing its contents.');
  return requireValidMutation(deleteLines(source, [current.line]));
}

export function moveZenUmlMessage(source: string, identity: ZenUmlMessageIdentity, direction: 'up' | 'down'): string {
  const parsed = requireZenUml(source); const current = resolveMessage(parsed, identity);
  const peers = parsed.messages.filter((item) => item.depth === current.depth && !item.line.text.trimEnd().endsWith('{'));
  const index = peers.indexOf(current); const other = peers[index + (direction === 'up' ? -1 : 1)];
  return other ? requireValidMutation(swapLineText(source, current.line, other.line)) : source;
}

export function addZenUmlControl(source: string, control: ZenUmlControl, parent?: ZenUmlBlockIdentity): string {
  requireZenUml(source || 'zenuml'); const value = normalizeControl(control); const head = formatControl(value);
  const parsed = requireZenUml(source || 'zenuml');
  return requireValidMutation(insertBlockStatement(source || 'zenuml', parsed, `${head} {${preferredEol(source || 'zenuml')}__CLOSE__`, parent));
}
export function editZenUmlControl(source: string, identity: ZenUmlControlIdentity, patch: Partial<ZenUmlControl>): string {
  const parsed = requireZenUml(source); const current = resolveControl(parsed, identity); const value = normalizeControl({ ...publicControl(current), ...patch, depth: current.depth });
  if (value.kind !== current.kind) throw new Error('Changing a ZenUML control kind is not supported by this form.');
  return requireValidMutation(replaceLine(source, current.line, `${indentOf(current.line.text)}${formatControl(value)} {`));
}
export function deleteZenUmlControl(source: string, identity: ZenUmlControlIdentity): string {
  const parsed = requireZenUml(source); const current = resolveControl(parsed, identity);
  if (current.close.compoundFragment === 'close') throw new Error('Delete the complete ZenUML alternative chain from source.');
  return requireValidMutation(deleteRange(source, current.line.start, current.close.end));
}
export function moveZenUmlControl(source: string, identity: ZenUmlControlIdentity, direction: 'up' | 'down'): string {
  const parsed = requireZenUml(source); const current = resolveControl(parsed, identity); const peers = parsed.controls.filter((item) => item.depth === current.depth);
  const index = peers.indexOf(current); const other = peers[index + (direction === 'up' ? -1 : 1)]; if (!other) return source;
  if (current.line.compoundFragment || current.close.compoundFragment || other.line.compoundFragment || other.close.compoundFragment) throw new Error('Reorder compound ZenUML alternatives from source.');
  return requireValidMutation(swapRanges(source, { start: current.line.start, end: current.close.contentEnd }, { start: other.line.start, end: other.close.contentEnd }));
}

function parseZenUml(source: string): ParsedZenUml | null {
  const lines = splitLines(source); const header = lines.find((line) => line.text.trim() && !COMMENT.test(line.text.trim()));
  if (!header || !HEADER.test(header.text.trim())) return null;
  const participants: ParticipantRecord[] = []; const messages: MessageRecord[] = []; const controls: ControlRecord[] = [];
  const stack: Array<{ control?: Omit<ControlRecord, 'close'>; message?: MessageRecord }> = [];
  const participantByAlias = new Map<string, ParticipantRecord>();
  const ensureParticipant = (alias: string, line: Line | null = null, kind: ZenUmlParticipantKind = 'participant', label = alias) => {
    const current = participantByAlias.get(alias);
    if (current) { if (line && current.line === null) Object.assign(current, { kind, label, line }); return current; }
    const value = { alias, kind, label: normalizeText(label, 'ZenUML participant labels'), line }; participants.push(value); participantByAlias.set(alias, value); return value;
  };
  for (const line of lines.slice(header.index + 1)) {
    const text = line.text.trim(); if (!text || COMMENT.test(text)) continue;
    const compound = COMPOUND_CONTINUATION.exec(text);
    if (compound) {
      const open = stack.pop(); if (!open?.control) return null;
      const closeOffset = line.text.indexOf('}');
      const continuationOffset = line.text.indexOf(compound[1]!, closeOffset + 1);
      const close: Line = { ...line, compoundFragment: 'close', contentEnd: line.start + closeOffset + 1, end: line.start + continuationOffset, text: `${line.text.slice(0, closeOffset)}}` };
      controls.push({ ...open.control, close });
      const continuation: Line = { ...line, compoundFragment: 'open', physicalIndent: indentOf(line.text), start: line.start + continuationOffset, text: `${compound[1]} {` };
      const control = CONTROL.exec(continuation.text);
      if (!control) return null;
      const rawKind = control[1] ?? (continuation.text.startsWith('else if') ? 'else-if' : control[4]);
      const kind = rawKind === 'forEach' ? 'foreach' : rawKind as ZenUmlControlKind;
      stack.push({ control: { depth: stack.length, kind, label: control[2] ?? control[3] ?? '', line: continuation } });
      continue;
    }
    if (CLOSE_CONTROL.test(text)) {
      const open = stack.pop(); if (!open) return null;
      if (open.control) controls.push({ ...open.control, close: line });
      if (open.message) open.message.close = line;
      continue;
    }
    const annotator = ANNOTATOR.exec(text);
    if (annotator) { const alias = annotator[2]!; if (participantByAlias.get(alias)?.line) return null; ensureParticipant(alias, line, annotator[1]!.toLowerCase() as ZenUmlParticipantKind, annotator[3] ?? alias); continue; }
    const alias = ALIAS.exec(text);
    if (alias) { if (participantByAlias.get(alias[1]!)?.line) return null; ensureParticipant(alias[1]!, line, 'participant', alias[2]!); continue; }
    const bareParticipant = BARE_PARTICIPANT.exec(text);
    if (bareParticipant) { if (participantByAlias.get(bareParticipant[1]!)?.line) return null; ensureParticipant(bareParticipant[1]!, line); continue; }
    const asyncMessage = ASYNC.exec(text);
    if (asyncMessage) { ensureParticipant(asyncMessage[1]!); ensureParticipant(asyncMessage[2]!); messages.push({ assignment: null, close: null, depth: stack.length, from: asyncMessage[1]!, kind: 'async', line, text: asyncMessage[3]!, to: asyncMessage[2]! }); continue; }
    const returnMessage = RETURN.exec(text);
    if (returnMessage) { messages.push({ assignment: null, close: null, depth: stack.length, from: null, kind: 'return', line, text: returnMessage[1] ?? '', to: null }); continue; }
    const control = CONTROL.exec(text);
    if (control) {
      const rawKind = control[1] ?? (text.startsWith('else if') ? 'else-if' : control[4]);
      const kind = rawKind === 'forEach' ? 'foreach' : rawKind as ZenUmlControlKind;
      const label = control[2] ?? control[3] ?? '';
      stack.push({ control: { depth: stack.length, kind, label, line } }); continue;
    }
    const sync = SYNC.exec(text);
    if (sync) {
      const to = sync[3]!; if (sync[2]) ensureParticipant(sync[2]); ensureParticipant(to);
      const message: MessageRecord = { assignment: sync[1] ?? null, close: null, depth: stack.length, from: sync[2] ?? null, kind: 'sync', line, text: `${sync[4]}${sync[5] ?? '()'}`, to };
      messages.push(message); if (sync[6]) stack.push({ message }); continue;
    }
    return null;
  }
  if (stack.length) return null;
  controls.sort((a, b) => a.line.start - b.line.start);
  if (!hasValidControlContinuations(controls)) return null;
  return { controls, header, lines, messages, participants };
}

function requireZenUml(source: string): ParsedZenUml { const value = parseZenUml(source); if (!value) throw new Error('This ZenUML source uses syntax that the form does not safely represent. Edit it as source.'); return value; }
function requireValidMutation(source: string): string { requireZenUml(source); return source; }
function publicParticipant(value: ZenUmlParticipant): ZenUmlParticipant { return { alias: value.alias, kind: value.kind, label: value.label }; }
function publicMessage(value: ZenUmlMessage): ZenUmlMessage { return { assignment: value.assignment, from: value.from, kind: value.kind, text: value.text, to: value.to }; }
function publicControl(value: ZenUmlControl): ZenUmlControl { return { depth: value.depth, kind: value.kind, label: value.label }; }
function sameParticipant(a: ZenUmlParticipant, b: ZenUmlParticipant) { return JSON.stringify(publicParticipant(a)) === JSON.stringify(publicParticipant(b)); }
function sameMessage(a: ZenUmlMessage, b: ZenUmlMessage) { return JSON.stringify(publicMessage(a)) === JSON.stringify(publicMessage(b)); }
function sameControl(a: ZenUmlControl, b: ZenUmlControl) { return JSON.stringify(publicControl(a)) === JSON.stringify(publicControl(b)); }
function occurrence<T>(value: T, values: readonly T[], same: (a: T, b: T) => boolean): number { return Math.max(1, values.slice(0, values.indexOf(value) + 1).filter((item) => same(item, value)).length); }
function resolveOccurrence<T, I>(records: readonly T[], identityValue: I, wanted: number, same: (a: T, b: I) => boolean): T { const matches = records.filter((item) => same(item, identityValue)); const value = matches[wanted - 1]; if (!value) throw new Error('The ZenUML item changed before this update could be applied.'); return value; }
function resolveParticipant(parsed: ParsedZenUml, identity: ZenUmlParticipantIdentity) { return resolveOccurrence(parsed.participants, identity.participant, identity.occurrence, sameParticipant); }
function resolveMessage(parsed: ParsedZenUml, identity: ZenUmlMessageIdentity) { return resolveOccurrence(parsed.messages, identity.message, identity.occurrence, sameMessage); }
function resolveControl(parsed: ParsedZenUml, identity: ZenUmlControlIdentity) { return resolveOccurrence(parsed.controls, identity.control, identity.occurrence, sameControl); }
function resolveBlockRecord(parsed: ParsedZenUml, identity: ZenUmlBlockIdentity): ControlRecord | MessageRecord { return identity.type === 'control' ? resolveControl(parsed, identity.identity) : resolveMessage(parsed, identity.identity); }
function normalizeParticipant(value: ZenUmlParticipant): ZenUmlParticipant { if (!['participant', 'actor', 'database', 'boundary', 'control', 'entity', 'queue'].includes(value.kind)) throw new Error('ZenUML participant kind is unsupported.'); return { alias: normalizeIdentifier(value.alias, 'participant alias'), kind: value.kind, label: normalizeText(value.label, 'participant label') }; }
function normalizeMessage(value: ZenUmlMessage): ZenUmlMessage { if (!['async', 'sync', 'return'].includes(value.kind)) throw new Error('ZenUML message kind is unsupported.'); return { assignment: value.assignment ? normalizeIdentifier(value.assignment, 'assignment') : null, from: value.from ? normalizeIdentifier(value.from, 'sender') : null, kind: value.kind, text: value.kind === 'return' && !value.text.trim() ? '' : normalizeText(value.text, 'message'), to: value.to ? normalizeIdentifier(value.to, 'recipient') : null }; }
function normalizeControl(value: ZenUmlControl): ZenUmlControl { if (!['if', 'else-if', 'else', 'opt', 'par', 'while', 'for', 'foreach', 'loop', 'try', 'catch', 'finally'].includes(value.kind)) throw new Error('ZenUML control kind is unsupported.'); const label = value.label ? normalizeText(value.label, 'control label') : ''; if (['if', 'else-if', 'while', 'for', 'foreach', 'loop'].includes(value.kind) && !label) throw new Error(`ZenUML ${value.kind} controls require a condition.`); return { depth: value.depth, kind: value.kind, label }; }
function hasValidControlContinuations(controls: readonly ControlRecord[]): boolean {
  for (let index = 0; index < controls.length; index += 1) {
    const current = controls[index]!;
    if (!['else-if', 'else', 'catch', 'finally'].includes(current.kind)) continue;
    let previous: ControlRecord | undefined;
    for (let candidate = index - 1; candidate >= 0; candidate -= 1) {
      if (controls[candidate]!.depth === current.depth) { previous = controls[candidate]; break; }
    }
    if ((current.kind === 'else-if' || current.kind === 'else') && !previous?.kind.match(/^(?:if|else-if)$/u)) return false;
    if (current.kind === 'catch' && !previous?.kind.match(/^(?:try|catch)$/u)) return false;
    if (current.kind === 'finally' && !previous?.kind.match(/^(?:try|catch)$/u)) return false;
  }
  return true;
}
function normalizeIdentifier(value: string, label: string): string { const next = value.trim(); if (!new RegExp(`^${IDENTIFIER}$`, 'u').test(next)) throw new Error(`ZenUML ${label} must be a simple identifier.`); return next; }
function normalizeText(value: string, label: string): string { const next = value.trim(); if (!next || /[\r\n{}]/u.test(next)) throw new Error(`${label} must be non-empty and stay on one source line.`); return next; }
function capitalize(value: string) { return `${value[0]?.toUpperCase() ?? ''}${value.slice(1)}`; }
function formatControl(value: ZenUmlControl): string { if (['else', 'opt', 'par', 'try', 'finally'].includes(value.kind)) return value.kind; if (value.kind === 'else-if') return `else if(${value.label})`; return `${value.kind}(${value.label})`; }
function splitLines(source: string): Line[] { const result: Line[] = []; const pattern = /.*?(?:\r\n|\n|\r|$)/gu; let match: RegExpExecArray | null; while ((match = pattern.exec(source)) && match[0]) { const raw = match[0]; const text = raw.replace(/(?:\r\n|\n|\r)$/u, ''); result.push({ contentEnd: match.index + text.length, end: match.index + raw.length, index: result.length, start: match.index, text }); } return result; }
function indentOf(value: string) { return value.match(/^[\t ]*/u)?.[0] ?? ''; }
function preferredEol(source: string) { return source.match(/\r\n|\n|\r/u)?.[0] ?? '\n'; }
function appendStatement(source: string, statement: string): string { const eol = preferredEol(source); return `${source}${source && !/(?:\r\n|\n|\r)$/u.test(source) ? eol : ''}${statement}`; }
function insertBlockStatement(source: string, parsed: ParsedZenUml, statement: string, parent?: ZenUmlBlockIdentity): string {
  const eol = preferredEol(source); const block = parent ? resolveBlockRecord(parsed, parent) : null;
  if (block && !block.close) throw new Error('The selected ZenUML call does not own a nested block.');
  const indent = block ? `${block.line.physicalIndent ?? indentOf(block.line.text)}  ` : '  ';
  const rendered = statement.split(eol).map((part) => `${indent}${part === '__CLOSE__' ? '}' : part}`).join(eol);
  if (!block?.close) return appendStatement(source, rendered);
  return `${source.slice(0, block.close.start)}${rendered}${eol}${source.slice(block.close.start)}`;
}
function replaceLine(source: string, line: Line, text: string) { return `${source.slice(0, line.start)}${text}${source.slice(line.contentEnd)}`; }
function replaceLines(source: string, replacements: Array<{ line: Line; text: string }>) { return [...replacements].sort((a, b) => b.line.start - a.line.start).reduce((next, item) => replaceLine(next, item.line, item.text), source); }
function deleteLines(source: string, lines: readonly Line[]) { return [...lines].sort((a, b) => b.start - a.start).reduce((next, line) => `${next.slice(0, line.start)}${next.slice(line.end)}`, source); }
function deleteRange(source: string, start: number, end: number) { return `${source.slice(0, start)}${source.slice(end)}`; }
function swapLineText(source: string, a: Line, b: Line) { return replaceLines(source, [{ line: a, text: b.text }, { line: b, text: a.text }]); }
function swapRanges(source: string, a: { start: number; end: number }, b: { start: number; end: number }) { const [left, right] = a.start < b.start ? [a, b] : [b, a]; return `${source.slice(0, left.start)}${source.slice(right.start, right.end)}${source.slice(left.end, right.start)}${source.slice(left.start, left.end)}${source.slice(right.end)}`; }
