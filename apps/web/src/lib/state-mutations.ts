export type StateNodeKind = 'final' | 'initial' | 'state';
export interface StateNode { id: string; kind: StateNodeKind; label?: string; }
export interface StateTransition { from: string; label?: string; to: string; }
/** A transition remains addressable across an unrelated remote insertion. */
export interface StateTransitionIdentity extends StateTransition { index: number; occurrenceCount: number; }
export interface StateDiagramSnapshot { states: StateNode[]; transitions: StateTransition[]; }

interface SourceLine { end: number; raw: string; start: number; text: string; }
interface StateRecord extends StateNode { line?: SourceLine; }
interface TransitionRecord extends StateTransition { line: SourceLine; }
interface ParsedState { lines: SourceLine[]; states: StateRecord[]; transitions: TransitionRecord[]; }

const HEADER = /^\s*stateDiagram(?:-v2)?\s*$/i;
const ID = '[A-Za-z_][A-Za-z0-9_.-]*';
const idPattern = new RegExp(`^${ID}$`);
const DECLARATION = new RegExp(`^(\\s*)state\\s+(${ID})(?:\\s+as\\s+([^{}\\r\\n]+?))?\\s*$`, 'i');
const TRANSITION = new RegExp(`^\\s*(${ID}|\\[\\*\\])\\s*--?>\\s*(${ID}|\\[\\*\\])(?:\\s*:\\s*([^\\r\\n]*?))?\\s*$`);

export function isStateDiagramSource(source: string): boolean { return parseState(source) !== null; }
export function isStateSourceRepresentable(source: string): boolean { return parseState(source) !== null; }
export function getStateDiagramSnapshot(source: string): StateDiagramSnapshot {
  const parsed = requireState(source); return { states: parsed.states.map(publicState), transitions: parsed.transitions.map(publicTransition) };
}

export function addState(source: string, name = 'State', label?: string): string {
  if (!source.trim()) return `stateDiagram-v2\n  state ${normalizeId(name)}${label ? ` as ${normalizeLabel(label)}` : ''}`;
  const parsed = requireState(source); const id = uniqueId(normalizeId(name), parsed.states.filter((state) => state.kind === 'state').map((state) => state.id));
  return append(source, `  state ${id}${label ? ` as ${normalizeLabel(label)}` : ''}`);
}
export function editState(source: string, currentId: string, patch: { id?: string; label?: string }): string {
  const parsed = requireState(source); const state = findState(parsed, currentId); if (!state.line) throw new Error('Pseudo-states cannot be edited.');
  const id = patch.id ? normalizeId(patch.id) : currentId; if (id !== currentId && parsed.states.some((entry) => entry.kind === 'state' && entry.id === id)) throw new Error(`A state named ${id} already exists.`);
  let next = replace(source, state.line, `${indent(state.line)}state ${id}${patch.label === undefined ? state.label ? ` as ${state.label}` : '' : patch.label ? ` as ${normalizeLabel(patch.label)}` : ''}`);
  if (id === currentId) return next;
  const after = requireState(next);
  for (const transition of [...after.transitions].reverse()) {
    if (transition.from !== currentId && transition.to !== currentId) continue;
    next = replace(next, transition.line, `${indent(transition.line)}${transition.from === currentId ? id : transition.from} --> ${transition.to === currentId ? id : transition.to}${transition.label ? ` : ${transition.label}` : ''}`);
  }
  return next;
}
export function deleteState(source: string, id: string): string {
  const parsed = requireState(source); const state = findState(parsed, id); if (!state.line) throw new Error('Pseudo-states cannot be deleted.');
  return deleteLines(source, [state.line, ...parsed.transitions.filter((transition) => transition.from === id || transition.to === id).map((transition) => transition.line)]);
}

export function addStateTransition(source: string, transition: StateTransition): string {
  const parsed = requireState(source); assertTransition(parsed, transition); return append(source, `  ${formatTransition(transition)}`);
}
export function getStateTransitionIdentity(transition: StateTransition, index: number, transitions: readonly StateTransition[] = []): StateTransitionIdentity {
  return { ...transition, index, occurrenceCount: transitions.length ? transitions.filter((candidate) => isSameTransition(candidate, transition)).length : 1 };
}
export function resolveStateTransitionIndex(transitions: readonly StateTransition[], identity: StateTransitionIdentity): number {
  if (identity.occurrenceCount !== 1) throw new Error('State transition changed remotely and can no longer be resolved safely.');
  const matches = transitions.map((transition, index) => ({ index, transition })).filter(({ transition }) => isSameTransition(transition, identity));
  if (matches.length !== 1 || !matches[0]) throw new Error('State transition changed remotely and can no longer be resolved safely.');
  return matches[0].index;
}
export function editStateTransition(source: string, identity: StateTransitionIdentity, transition: StateTransition): string {
  const parsed = requireState(source); const index = resolveStateTransitionIndex(parsed.transitions, identity); const current = parsed.transitions[index]; if (!current) throw new Error('State transition no longer exists.'); assertTransition(parsed, transition); return replace(source, current.line, `${indent(current.line)}${formatTransition(transition)}`);
}
export function deleteStateTransition(source: string, identity: StateTransitionIdentity): string { const parsed = requireState(source); const index = resolveStateTransitionIndex(parsed.transitions, identity); const transition = parsed.transitions[index]; if (!transition) throw new Error('State transition no longer exists.'); return deleteLines(source, [transition.line]); }

function parseState(source: string): ParsedState | null {
  const lines = splitLines(source); const bodyStart = firstStatementIndex(lines); const headerIndex = lines.findIndex((line, index) => index >= bodyStart && line.text.trim() && !ignorable(line.text)); if (headerIndex < 0 || !HEADER.test(lines[headerIndex]?.text ?? '')) return null;
  const states = new Map<string, StateRecord>(); const transitions: TransitionRecord[] = [];
  const ensureState = (id: string): StateRecord => {
    if (id === '[*]') { const kind: StateNodeKind = transitions.some((transition) => transition.to === '[*]') ? 'final' : 'initial'; const record = states.get(`${kind}:[*]`) ?? { id, kind }; states.set(`${kind}:[*]`, record); return record; }
    const existing = states.get(id); if (existing) return existing; const record: StateRecord = { id, kind: 'state' }; states.set(id, record); return record;
  };
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!; const text = line.text;
    if (!text.trim() || ignorable(text)) continue;
    if (/[{}]/.test(text) || /^\s*(?:note|direction|state\s+\[)/i.test(text)) return null;
    const declaration = text.match(DECLARATION);
    if (declaration) { const id = declaration[2]!; const existing = states.get(id); if (existing?.line) return null; states.set(id, { id, kind: 'state', ...(declaration[3]?.trim() ? { label: declaration[3]!.trim() } : {}), line }); continue; }
    const transition = text.match(TRANSITION);
    if (!transition) return null;
    const from = transition[1]!; const to = transition[2]!; ensureState(from); ensureState(to); transitions.push({ from, to, ...(transition[3]?.trim() ? { label: transition[3]!.trim() } : {}), line });
  }
  // The renderer assigns the final marker after parsing all arrows. Rebuild marker kinds deterministically.
  const ordinary = [...states.values()].filter((state) => state.id !== '[*]'); const pseudo: StateRecord[] = [];
  if (transitions.some((transition) => transition.from === '[*]')) pseudo.push({ id: '[*]', kind: 'initial' });
  if (transitions.some((transition) => transition.to === '[*]')) pseudo.push({ id: '[*]', kind: 'final' });
  return { lines, states: [...ordinary, ...pseudo], transitions };
}

function requireState(source: string): ParsedState { const parsed = parseState(source); if (!parsed) throw new Error('This source is not a safely representable state diagram. Nested, composite, and note syntax remain source-only.'); return parsed; }
function findState(parsed: ParsedState, id: string): StateRecord { const state = parsed.states.find((entry) => entry.kind === 'state' && entry.id === id); if (!state) throw new Error(`State ${id} no longer exists.`); return state; }
function publicState(state: StateRecord): StateNode { return { id: state.id, kind: state.kind, ...(state.label ? { label: state.label } : {}) }; }
function publicTransition(transition: TransitionRecord): StateTransition { return { from: transition.from, to: transition.to, ...(transition.label ? { label: transition.label } : {}) }; }
function isSameTransition(left: StateTransition, right: StateTransition): boolean { return left.from === right.from && left.to === right.to && left.label === right.label; }
function assertTransition(parsed: ParsedState, transition: StateTransition): void { if (!transition.from || !transition.to || transition.label?.includes('\n')) throw new Error('State transitions must be one line.'); const stateIds = new Set(parsed.states.map((state) => state.id)); if (!stateIds.has(transition.from) || !stateIds.has(transition.to)) throw new Error('State transitions require existing states.'); }
function formatTransition(transition: StateTransition): string { return `${transition.from} --> ${transition.to}${transition.label?.trim() ? ` : ${transition.label.trim()}` : ''}`; }
function normalizeId(value: string): string { const id = value.trim().replace(/[^A-Za-z0-9_.-]/g, '_').replace(/^[^A-Za-z_]+/, ''); if (!idPattern.test(id)) throw new Error('State names must be Mermaid-safe identifiers.'); return id; }
function normalizeLabel(value: string): string { const label = value.trim().replace(/[\r\n{}]/g, ''); if (!label) throw new Error('State label is required.'); return label; }
function uniqueId(base: string, existing: readonly string[]): string { const occupied = new Set(existing); let candidate = base; let suffix = 2; while (occupied.has(candidate)) { candidate = `${base}${suffix}`; suffix += 1; } return candidate; }
function splitLines(source: string): SourceLine[] { const lines: SourceLine[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; const start = match.index; lines.push({ start, end: start + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function firstStatementIndex(lines: readonly SourceLine[]): number { if (lines[0]?.text.replace(/^\uFEFF/, '').trim() !== '---') return 0; const close = lines.findIndex((line, index) => index > 0 && line.text.trim() === '---'); return close < 0 ? lines.length : close + 1; }
function ignorable(text: string): boolean { return /^\s*%%/.test(text); }
function indent(line: SourceLine): string { return line.text.match(/^\s*/)?.[0] ?? ''; }
function lineEnding(source: string): string { return source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'; }
function append(source: string, statement: string): string { const ending = lineEnding(source); return `${source}${source && !/(?:\r\n|\n|\r)$/.test(source) ? ending : ''}${statement}`; }
function replace(source: string, line: SourceLine, value: string): string { return `${source.slice(0, line.start)}${value}${line.raw.slice(line.text.length)}${source.slice(line.end)}`; }
function deleteLines(source: string, lines: readonly SourceLine[]): string { return [...lines].sort((left, right) => right.start - left.start).reduce((next, line) => `${next.slice(0, line.start)}${next.slice(line.end)}`, source); }
