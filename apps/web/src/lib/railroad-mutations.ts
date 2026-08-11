export type RailroadNotation = 'abnf' | 'ebnf' | 'ir' | 'peg';
export interface RailroadRule { definition: string; name: string; }
export interface RailroadRuleIdentity extends RailroadRule { notation: RailroadNotation; occurrenceCount: number; }
export interface RailroadDiagramSnapshot { notation: RailroadNotation; rules: RailroadRule[]; }

interface Line { end: number; raw: string; start: number; text: string; }
interface RuleRecord extends RailroadRule {
  definitionStart: number;
  line: Line;
  nameEnd: number;
  nameStart: number;
  operator: string;
}
interface Parsed { header: Line; notation: RailroadNotation; rules: RuleRecord[]; }
interface Token { end: number; start: number; value: string; type: 'id' | 'number' | 'numval' | 'string' | 'symbol'; }

const HEADERS: Record<RailroadNotation, RegExp> = { ir: /^[\t ]*railroad-beta[\t ]*$/, ebnf: /^[\t ]*railroad-ebnf-beta[\t ]*$/, abnf: /^[\t ]*railroad-abnf-beta[\t ]*$/, peg: /^[\t ]*railroad-peg-beta[\t ]*$/ };
const IDENTIFIERS: Record<RailroadNotation, RegExp> = { ir: /^[A-Za-z_][\w-]*$/, ebnf: /^[A-Za-z_][\w-]*$/, abnf: /^[A-Za-z][A-Za-z0-9-]*$/, peg: /^[A-Za-z_][\w-]*$/ };
const HEADER_BY_NOTATION: Record<RailroadNotation, string> = { ir: 'railroad-beta', ebnf: 'railroad-ebnf-beta', abnf: 'railroad-abnf-beta', peg: 'railroad-peg-beta' };

/** The safe model supports all four Mermaid 11.16.1 Railroad entry grammars. */
export function isRailroadDiagramSource(source: string): boolean { return parseRailroad(source) !== null; }
export function isRailroadSourceRepresentable(source: string): boolean { return parseRailroad(source) !== null; }
export function getRailroadDiagramSnapshot(source: string): RailroadDiagramSnapshot { const parsed = requireRailroad(source); return { notation: parsed.notation, rules: parsed.rules.map(publicRule) }; }
export function createRailroadDiagram(notation: RailroadNotation = 'ebnf'): string { return HEADER_BY_NOTATION[notation]; }
export function getRailroadRuleIdentity(rule: RailroadRule, rules: readonly RailroadRule[], notation: RailroadNotation): RailroadRuleIdentity { return { ...rule, notation, occurrenceCount: rules.length ? rules.filter((entry) => sameRule(entry, rule, notation)).length : 1 }; }
export function resolveRailroadRule(source: string, identity: RailroadRuleIdentity): RailroadRule { return publicRule(resolveRule(requireRailroad(source), identity)); }

export function addRailroadRule(source: string, rule: RailroadRule, notation: RailroadNotation = 'ebnf'): string {
  const parsed = isBlankDocument(source) ? null : requireRailroad(source); const activeNotation = parsed?.notation ?? notation; const value = normalizeRule(rule, activeNotation);
  if (!parsed) return `${createRailroadDiagram(activeNotation)}\n  ${formatRule(value, activeNotation)}`;
  if (parsed.rules.some((entry) => sameName(entry.name, value.name, activeNotation))) throw new Error(`A Railroad rule named ${value.name} already exists.`);
  return append(source, `  ${formatRule(value, activeNotation)}`);
}
export function editRailroadRule(source: string, identity: RailroadRuleIdentity, patch: Partial<RailroadRule>): string {
  const parsed = requireRailroad(source); const current = resolveRule(parsed, identity); if (patch.name !== undefined && trimHorizontal(patch.name) !== current.name) return renameRailroadRule(source, identity, patch.name);
  const value = normalizeRule({ name: current.name, definition: patch.definition ?? current.definition }, parsed.notation);
  return replaceLine(source, current.line, `${indent(current.line)}${value.name} ${current.operator} ${value.definition} ;`);
}
/** Renames a production and only unambiguous nonterminal references in the same parsed source revision. */
export function renameRailroadRule(source: string, identity: RailroadRuleIdentity, name: string): string {
  const parsed = requireRailroad(source); const current = resolveRule(parsed, identity); const nextName = normalizeName(name, parsed.notation);
  if (nextName === current.name) return source; if (parsed.rules.some((rule) => rule !== current && sameName(rule.name, nextName, parsed.notation))) throw new Error(`A Railroad rule named ${nextName} already exists.`);
  const replacements = [{ end: current.nameEnd, start: current.nameStart, value: nextName }, ...parsed.rules.flatMap((rule) => referenceReplacements(rule, parsed.notation, current.name, nextName))];
  const next = replaceRanges(source, replacements); return requireRailroad(next), next;
}
export function deleteRailroadRule(source: string, identity: RailroadRuleIdentity): string { const parsed = requireRailroad(source); return deleteLines(source, [resolveRule(parsed, identity).line]); }
/** Reorders only top-level grammar rules while keeping the document's physical terminators positional. */
export function moveRailroadRule(source: string, identity: RailroadRuleIdentity, direction: 'up' | 'down'): string {
  const parsed = requireRailroad(source); const current = resolveRule(parsed, identity); const index = parsed.rules.indexOf(current); const other = parsed.rules[index + (direction === 'up' ? -1 : 1)]; if (!other) return source;
  return swapLines(source, direction === 'up' ? other.line : current.line, direction === 'up' ? current.line : other.line);
}

function parseRailroad(source: string): Parsed | null {
  try {
    if (source.indexOf('\uFEFF') > 0 || hasNonMermaidWhitespace(source.startsWith('\uFEFF') ? source.slice(1) : source)) return null;
    const lines = splitLines(source); const headerIndex = firstStatement(lines); const header = lines[headerIndex]; if (!header) return null;
    const notation = (Object.keys(HEADERS) as RailroadNotation[]).find((candidate) => HEADERS[candidate].test(sourceLineText(header))); if (!notation) return null;
    const rules: RuleRecord[] = []; let sawRule = false;
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]!; const text = sourceLineText(line); if (isBlankLine(text) || ignorable(text)) continue;
      if (!sawRule && metadata(text)) continue;
      const rule = parseRule(text, line, notation); if (!rule || rules.some((entry) => sameName(entry.name, rule.name, notation))) return null; rules.push(rule); sawRule = true;
    }
    return { header, notation, rules };
  } catch { return null; }
}
function parseRule(text: string, line: Line, notation: RailroadNotation): RuleRecord | null {
  const match = text.match(notation === 'peg' ? /^[\t ]*([A-Za-z_][\w-]*)[\t ]*(<-)[\t ]*(.*?)[\t ]*;[\t ]*$/ : notation === 'ebnf' ? /^[\t ]*([A-Za-z_][\w-]*)[\t ]*(=|::=)[\t ]*(.*?)[\t ]*;[\t ]*$/ : notation === 'abnf' ? /^[\t ]*([A-Za-z][A-Za-z0-9-]*)[\t ]*(=)[\t ]*(.*?)[\t ]*;[\t ]*$/ : /^[\t ]*([A-Za-z_][\w-]*)[\t ]*(=)[\t ]*(.*?)[\t ]*;[\t ]*$/);
  if (!match || !match[3] || !validateDefinition(match[3], notation)) return null;
  const name = match[1]!; const definition = trimHorizontal(match[3]!); const nameStart = line.start + text.indexOf(name);
  const rawDefinitionStart = text.indexOf(match[3]!, nameStart - line.start + name.length);
  const definitionStart = line.start + rawDefinitionStart + (match[3]!.length - trimHorizontalStart(match[3]!).length);
  return { name, nameEnd: nameStart + name.length, nameStart, operator: match[2]!, definition, definitionStart, line };
}
function requireRailroad(source: string): Parsed { const parsed = parseRailroad(source); if (!parsed) throw new Error('This source is not a safely representable Railroad diagram.'); return parsed; }
function resolveRule(parsed: Parsed, identity: RailroadRuleIdentity): RuleRecord { const matches = parsed.rules.filter((entry) => sameRule(entry, identity, parsed.notation)); if (identity.notation !== parsed.notation || identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw stale(); return matches[0]; }
function publicRule(rule: RuleRecord): RailroadRule { return { name: rule.name, definition: rule.definition }; }
function sameRule(left: RailroadRule, right: RailroadRule, notation: RailroadNotation): boolean { return sameName(left.name, right.name, notation) && left.definition === right.definition; }
function sameName(left: string, right: string, notation: RailroadNotation): boolean { return notation === 'abnf' ? left.toLowerCase() === right.toLowerCase() : left === right; }
function stale(): Error { return new Error('Railroad rule changed remotely and can no longer be resolved safely.'); }
function normalizeRule(value: RailroadRule, notation: RailroadNotation): RailroadRule { const name = normalizeName(value.name, notation); const definition = trimHorizontal(value.definition); if (!definition || /[\r\n]/.test(definition) || hasNonMermaidWhitespace(definition) || !validateDefinition(definition, notation)) throw new Error('Railroad definitions must use the active Mermaid grammar subset.'); return { name, definition }; }
function normalizeName(value: string, notation: RailroadNotation): string { const name = trimHorizontal(value); if (hasNonMermaidWhitespace(name) || !IDENTIFIERS[notation].test(name)) throw new Error('Railroad rule names must match the active Mermaid notation.'); return name; }
function formatRule(rule: RailroadRule, notation: RailroadNotation): string { return `${rule.name} ${notation === 'peg' ? '<-' : '='} ${rule.definition} ;`; }
function metadata(text: string): boolean { return /^[\t ]*(?:title[\t ]+[^\r\n]+|accTitle[\t ]*:[\t ]*[^\r\n]+|accDescr[\t ]*:[\t ]*[^{}\r\n]+)[\t ]*$/.test(text); }

function validateDefinition(input: string, notation: RailroadNotation): boolean { const tokens = tokenize(input); if (!tokens?.length) return false; const state = { index: 0, tokens }; const valid = notation === 'ir' ? parseIr(state) : notation === 'ebnf' ? parseEbnfChoice(state) : notation === 'abnf' ? parseAbnfAlternation(state) : parsePegChoice(state); return valid && state.index === tokens.length; }
function tokenize(input: string): Token[] | null {
  const tokens: Token[] = []; for (let index = 0; index < input.length;) { const rest = input.slice(index); const whitespace = rest.match(/^[\t ]+/); if (whitespace) { index += whitespace[0].length; continue; }
    const start = index; const quote = rest[0]; if (quote === '"' || quote === "'") { let end = 1; let escaped = false; for (; end < rest.length; end += 1) { if (!escaped && rest[end] === quote) break; escaped = !escaped && rest[end] === '\\'; if (rest[end] !== '\\') escaped = false; } if (end >= rest.length) return null; index += end + 1; tokens.push({ start, end: index, type: 'string', value: rest.slice(0, end + 1) }); continue; }
    const multi = rest.match(/^(::=|<-)/)?.[0]; if (multi) { index += multi.length; tokens.push({ start, end: index, type: 'symbol', value: multi }); continue; }
    const numval = rest.match(/^%[xXdDbB][0-9A-Fa-f]+(?:-[0-9A-Fa-f]+|\.[0-9A-Fa-f]+)*/)?.[0]; if (numval) { index += numval.length; tokens.push({ start, end: index, type: 'numval', value: numval }); continue; }
    const id = rest.match(/^[A-Za-z_][\w-]*/)?.[0]; if (id) { index += id.length; tokens.push({ start, end: index, type: 'id', value: id }); continue; }
    const number = rest.match(/^\d+/)?.[0]; if (number) { index += number.length; tokens.push({ start, end: index, type: 'number', value: number }); continue; }
    if ('()[]{}=|,?*+-/&!.'.includes(rest[0]!)) { index += 1; tokens.push({ start, end: index, type: 'symbol', value: rest[0]! }); continue; } return null;
  } return tokens;
}
function accept(state: { index: number; tokens: Token[] }, value: string): boolean { if (state.tokens[state.index]?.value !== value) return false; state.index += 1; return true; }
function parseIr(state: { index: number; tokens: Token[] }): boolean { const name = state.tokens[state.index]; if (name?.type !== 'id' || !['terminal', 'nonterminal', 'sequence', 'choice'].includes(name.value)) return false; state.index += 1; if (!accept(state, '(')) return false; if (['terminal', 'nonterminal'].includes(name.value)) { const string = state.tokens[state.index++]; return string?.type === 'string' && accept(state, ')'); } if (!parseIr(state)) return false; while (accept(state, ',')) if (!parseIr(state)) return false; return accept(state, ')'); }
function parseEbnfChoice(state: { index: number; tokens: Token[] }): boolean { if (!parseEbnfSequence(state)) return false; while (accept(state, '|')) if (!parseEbnfSequence(state)) return false; return true; }
function parseEbnfSequence(state: { index: number; tokens: Token[] }): boolean { if (!startEbnf(state.tokens[state.index])) return false; state.index += 1; while (true) { if (accept(state, ',')) { if (!startEbnf(state.tokens[state.index])) return false; state.index += 1; continue; } if (startEbnf(state.tokens[state.index])) { state.index += 1; continue; } return true; } }
function startEbnf(token: Token | undefined): boolean { return token?.type === 'id' || token?.type === 'string'; }
function parseAbnfAlternation(state: { index: number; tokens: Token[] }): boolean { if (!parseAbnfSequence(state)) return false; while (accept(state, '/')) if (!parseAbnfSequence(state)) return false; return true; }
function parseAbnfSequence(state: { index: number; tokens: Token[] }): boolean { if (!startAbnf(state.tokens[state.index])) return false; state.index += 1; while (startAbnf(state.tokens[state.index])) state.index += 1; return true; }
function startAbnf(token: Token | undefined): boolean { return token?.type === 'id' || token?.type === 'string'; }
function parsePegChoice(state: { index: number; tokens: Token[] }): boolean { if (!parsePegSequence(state)) return false; while (accept(state, '/')) if (!parsePegSequence(state)) return false; return true; }
function parsePegSequence(state: { index: number; tokens: Token[] }): boolean { if (!startPeg(state.tokens[state.index])) return false; state.index += 1; while (startPeg(state.tokens[state.index])) state.index += 1; return true; }
function startPeg(token: Token | undefined): boolean { return token?.type === 'id' || token?.type === 'string'; }
function referenceReplacements(rule: RuleRecord, notation: RailroadNotation, from: string, to: string): { end: number; start: number; value: string }[] {
  const tokens = tokenize(rule.definition); if (!tokens) return [];
  if (notation === 'ir') {
    const replacements: { end: number; start: number; value: string }[] = [];
    for (let index = 0; index + 3 < tokens.length; index += 1) {
      const [functionName, open, target, close] = tokens.slice(index, index + 4);
      if (functionName?.type !== 'id' || functionName.value !== 'nonterminal' || open?.value !== '(' || target?.type !== 'string' || close?.value !== ')') continue;
      const value = target.value.slice(1, -1);
      if (sameName(value, from, notation)) replacements.push({ start: rule.definitionStart + target.start + 1, end: rule.definitionStart + target.end - 1, value: to });
    }
    return replacements;
  }
  return tokens
    .filter((token) => token.type === 'id' && sameName(token.value, from, notation))
    .map((token) => ({ start: rule.definitionStart + token.start, end: rule.definitionStart + token.end, value: to }));
}

function splitLines(source: string): Line[] { const lines: Line[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; lines.push({ start: match.index, end: match.index + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function sourceLineText(line: Line): string { return line.start === 0 ? line.text.replace(/^\uFEFF/, '') : line.text; }
function firstStatement(lines: readonly Line[]): number { let index = 0; if (lines[0] && sourceLineText(lines[0]) === '---') { const close = lines.findIndex((line, candidate) => candidate > 0 && sourceLineText(line) === '---'); index = close < 0 ? lines.length : close + 1; } while (index < lines.length && (isBlankLine(sourceLineText(lines[index]!)) || ignorable(sourceLineText(lines[index]!)))) index += 1; return index; }
function isBlankDocument(value: string): boolean { return /^[\t \r\n]*$/.test(value); }
function isBlankLine(value: string): boolean { return /^[\t ]*$/.test(value); }
function hasNonMermaidWhitespace(value: string): boolean { return /[^\S\r\n\t ]/u.test(value); }
function trimHorizontal(value: string): string { return value.replace(/^[\t ]+|[\t ]+$/g, ''); }
function trimHorizontalStart(value: string): string { return value.replace(/^[\t ]+/, ''); }
function ignorable(value: string): boolean { return /^[\t ]*%%/.test(value); } function indent(line: Line): string { return line.text.match(/^[\t ]*/)?.[0] ?? ''; }
function localLineEnding(source: string): string { const endings = source.match(/\r\n|\n|\r/g); return endings?.at(-1) ?? '\n'; }
function hasFinalLineEnding(source: string): boolean { return /(?:\r\n|\n|\r)$/.test(source); }
function append(source: string, statement: string): string { const ending = localLineEnding(source); if (!source) return statement; return hasFinalLineEnding(source) ? `${source}${statement}${ending}` : `${source}${ending}${statement}`; }
function replaceLine(source: string, line: Line, value: string): string { return `${source.slice(0, line.start)}${value}${line.raw.slice(line.text.length)}${source.slice(line.end)}`; }
function deleteLines(source: string, lines: readonly Line[]): string {
  const hadFinalEnding = hasFinalLineEnding(source);
  const next = [...lines].sort((left, right) => right.start - left.start).reduce((value, line) => `${value.slice(0, line.start)}${value.slice(line.end)}`, source);
  if (hadFinalEnding || !hasFinalLineEnding(next)) return next;
  return next.replace(/(?:\r\n|\n|\r)$/u, '');
}
function replaceLines(source: string, values: readonly { line: Line; value: string }[]): string { return [...values].sort((left, right) => right.line.start - left.line.start).reduce((next, item) => replaceLine(next, item.line, item.value), source); }
function swapLines(source: string, left: Line, right: Line): string { const first = left.start < right.start ? left : right; const second = first === left ? right : left; return `${source.slice(0, first.start)}${second.text}${terminator(first)}${source.slice(first.end, second.start)}${first.text}${terminator(second)}${source.slice(second.end)}`; } function terminator(line: Line): string { return line.raw.slice(line.text.length); }
function replaceRanges(source: string, values: readonly { end: number; start: number; value: string }[]): string { return [...values].sort((left, right) => right.start - left.start).reduce((next, item) => `${next.slice(0, item.start)}${item.value}${next.slice(item.end)}`, source); }
