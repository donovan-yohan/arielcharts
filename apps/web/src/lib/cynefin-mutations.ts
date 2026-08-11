import { isSafeMermaidFrontmatter } from './mermaid-frontmatter';

export const CYNEFIN_DOMAIN_NAMES = [
  'complex',
  'complicated',
  'clear',
  'chaotic',
  'confusion',
] as const;

export type CynefinDomainName = typeof CYNEFIN_DOMAIN_NAMES[number];

export interface CynefinItem {
  domain: CynefinDomainName;
  label: string;
}

export interface CynefinItemIdentity {
  item: CynefinItem;
  occurrenceCount: number;
}

export interface CynefinTransition {
  from: CynefinDomainName;
  label?: string | null;
  to: CynefinDomainName;
}

export interface CynefinTransitionIdentity {
  occurrenceCount: number;
  transition: CynefinTransition;
}

export interface CynefinDomain {
  items: CynefinItem[];
  name: CynefinDomainName;
}

export interface CynefinDiagramSnapshot {
  domains: CynefinDomain[];
  transitions: CynefinTransition[];
}

interface Line {
  end: number;
  raw: string;
  start: number;
  text: string;
}

interface Range {
  end: number;
  start: number;
}

interface DomainRecord {
  indent: string;
  line: Line;
  name: CynefinDomainName;
}

interface ItemRecord extends CynefinItem {
  indent: string;
  line: Line;
  token: Range;
}

interface TransitionRecord extends CynefinTransition {
  fromToken: Range;
  indent: string;
  labelClause?: Range;
  labelToken?: Range;
  line: Line;
  toToken: Range;
}

interface ParsedCynefin {
  domains: DomainRecord[];
  header: Line;
  items: ItemRecord[];
  lines: Line[];
  transitions: TransitionRecord[];
}

const HEADER = 'cynefin-beta';
const DOMAIN_PATTERN = CYNEFIN_DOMAIN_NAMES.join('|');
const QUOTED_PATTERN = String.raw`(?:"(?:[^"\\\r\n]|\\["\\])*"|'(?:[^'\\\r\n]|\\['\\])*')`;
const DOMAIN = new RegExp(`^([\\t ]*)(${DOMAIN_PATTERN})[\\t ]*$`, 'u');
const ITEM = new RegExp(`^([\\t ]*)(${QUOTED_PATTERN})[\\t ]*$`, 'u');
const TRANSITION = new RegExp(
  `^([\\t ]*)(${DOMAIN_PATTERN})[\\t ]*-->[\\t ]*(${DOMAIN_PATTERN})(?:[\\t ]*:[\\t ]*(${QUOTED_PATTERN}))?[\\t ]*$`,
  'u',
);

export function isCynefinDiagramSource(source: string): boolean {
  return parseCynefin(source) !== null;
}

export function isCynefinSourceRepresentable(source: string): boolean {
  return parseCynefin(source) !== null;
}

export function getCynefinDiagramSnapshot(source: string): CynefinDiagramSnapshot {
  const parsed = requireCynefin(source);
  return {
    domains: CYNEFIN_DOMAIN_NAMES.map((name) => ({
      items: parsed.items.filter((item) => item.domain === name).map(publicItem),
      name,
    })),
    transitions: parsed.transitions.map(publicTransition),
  };
}

export function getCynefinItemIdentity(
  item: CynefinItem,
  items: readonly CynefinItem[] = [],
): CynefinItemIdentity {
  const value = publicItem(item);
  return {
    item: value,
    occurrenceCount: items.length
      ? items.filter((candidate) => sameItem(candidate, value)).length
      : 1,
  };
}

export function getCynefinTransitionIdentity(
  transition: CynefinTransition,
  transitions: readonly CynefinTransition[] = [],
): CynefinTransitionIdentity {
  const value = publicTransition(transition);
  return {
    occurrenceCount: transitions.length
      ? transitions.filter((candidate) => sameTransition(candidate, value)).length
      : 1,
    transition: value,
  };
}

export function resolveCynefinItem(source: string, identity: CynefinItemIdentity): CynefinItem {
  return publicItem(resolveItem(requireCynefin(source), identity));
}

export function resolveCynefinTransition(
  source: string,
  identity: CynefinTransitionIdentity,
): CynefinTransition {
  return publicTransition(resolveTransition(requireCynefin(source), identity));
}

export function addCynefinItem(
  source: string,
  item: CynefinItem,
  targetIndex?: number,
): string {
  const value = normalizeItem(item);
  const base = source === '' ? HEADER : source;
  const parsed = requireCynefin(base);
  if (parsed.items.some((candidate) => sameItem(candidate, value))) throw duplicateItem(value);
  return requireValidMutation(insertItem(base, parsed, value, targetIndex));
}

export function editCynefinItem(
  source: string,
  identity: CynefinItemIdentity,
  patch: Partial<CynefinItem>,
): string {
  const parsed = requireCynefin(source);
  const current = resolveItem(parsed, identity);
  const value = normalizeItem({
    domain: patch.domain ?? current.domain,
    label: patch.label ?? current.label,
  });
  if (sameItem(current, value)) return source;
  if (parsed.items.some((candidate) => candidate !== current && sameItem(candidate, value))) {
    throw duplicateItem(value);
  }
  if (current.domain === value.domain) {
    return requireValidMutation(replaceRange(source, current.token, encodeLabel(value.label)));
  }
  const targetCount = parsed.items.filter((item) => item.domain === value.domain).length;
  return relocateItem(source, parsed, current, value, targetCount);
}

export function deleteCynefinItem(source: string, identity: CynefinItemIdentity): string {
  const parsed = requireCynefin(source);
  const current = resolveItem(parsed, identity);
  return requireValidMutation(deleteLines(source, [current.line]));
}

export function moveCynefinItem(
  source: string,
  identity: CynefinItemIdentity,
  domain: CynefinDomainName,
  targetIndex: number,
): string {
  const parsed = requireCynefin(source);
  const current = resolveItem(parsed, identity);
  const destination = normalizeDomain(domain);
  const peers = parsed.items.filter(
    (item) => item.domain === destination && item !== current,
  );
  validateTargetIndex(targetIndex, peers.length, 'Cynefin item');
  if (destination === current.domain) {
    const currentIndex = parsed.items.filter((item) => item.domain === current.domain).indexOf(current);
    if (currentIndex === targetIndex) return source;
  }
  return relocateItem(
    source,
    parsed,
    current,
    { domain: destination, label: current.label },
    targetIndex,
  );
}

export function addCynefinTransition(source: string, transition: CynefinTransition): string {
  const value = normalizeTransition(transition);
  const base = source === '' ? HEADER : source;
  const parsed = requireCynefin(base);
  if (parsed.transitions.some((candidate) => sameTransition(candidate, value))) {
    throw duplicateTransition();
  }
  return requireValidMutation(appendStatement(base, `  ${formatTransition(value)}`));
}

export function editCynefinTransition(
  source: string,
  identity: CynefinTransitionIdentity,
  patch: Partial<CynefinTransition>,
): string {
  const parsed = requireCynefin(source);
  const current = resolveTransition(parsed, identity);
  const value = normalizeTransition({
    from: patch.from ?? current.from,
    label: patch.label === undefined ? current.label : patch.label,
    to: patch.to ?? current.to,
  });
  if (sameTransition(current, value)) return source;
  if (parsed.transitions.some((candidate) => candidate !== current && sameTransition(candidate, value))) {
    throw duplicateTransition();
  }
  const replacements: Array<{ range: Range; value: string }> = [];
  if (current.from !== value.from) replacements.push({ range: current.fromToken, value: value.from });
  if (current.to !== value.to) replacements.push({ range: current.toToken, value: value.to });
  if ((current.label ?? null) !== (value.label ?? null)) {
    if (current.labelToken && value.label != null) {
      replacements.push({
        range: current.labelToken,
        value: encodeLabel(value.label, source[current.labelToken.start] === "'" ? "'" : '"'),
      });
    } else if (current.labelClause && value.label == null) {
      replacements.push({ range: current.labelClause, value: '' });
    } else if (value.label != null) {
      const text = sourceLineText(current.line);
      const trailingWhitespace = text.match(/[\t ]*$/u)?.[0].length ?? 0;
      const offset = current.line.start + text.length - trailingWhitespace;
      replacements.push({
        range: { end: offset, start: offset },
        value: ` : ${encodeLabel(value.label)}`,
      });
    }
  }
  return requireValidMutation(replaceRanges(source, replacements));
}

export function deleteCynefinTransition(
  source: string,
  identity: CynefinTransitionIdentity,
): string {
  const parsed = requireCynefin(source);
  const current = resolveTransition(parsed, identity);
  return requireValidMutation(deleteLines(source, [current.line]));
}

export function moveCynefinTransition(
  source: string,
  identity: CynefinTransitionIdentity,
  direction: 'up' | 'down',
): string {
  const parsed = requireCynefin(source);
  const current = resolveTransition(parsed, identity);
  const index = parsed.transitions.indexOf(current);
  const other = parsed.transitions[index + (direction === 'up' ? -1 : 1)];
  if (!other) return source;
  return requireValidMutation(swapLineText(source, current.line, other.line));
}

function parseCynefin(source: string): ParsedCynefin | null {
  try {
    if (!source || source.indexOf('\uFEFF') > 0 || hasUnexpectedSourceCharacters(source)) return null;
    const lines = splitLines(source);
    const headerIndex = firstStatement(lines);
    const header = lines[headerIndex];
    if (!header || sourceLineText(header) !== HEADER) return null;

    const domains: DomainRecord[] = [];
    const items: ItemRecord[] = [];
    const transitions: TransitionRecord[] = [];
    let currentDomain: CynefinDomainName | null = null;
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]!;
      const text = sourceLineText(line);
      if (blank(text) || comment(text)) continue;
      if (directive(text)) return null;

      const transitionMatch = text.match(TRANSITION);
      if (transitionMatch) {
        currentDomain = null;
        const value = normalizeTransition({
          from: normalizeDomain(transitionMatch[2]!),
          label: transitionMatch[4] ? decodeLabel(transitionMatch[4]) : null,
          to: normalizeDomain(transitionMatch[3]!),
        });
        if (transitions.some((candidate) => sameTransition(candidate, value))) return null;
        const indent = transitionMatch[1]!;
        const fromOffset = indent.length;
        const arrowOffset = text.indexOf('-->', fromOffset + transitionMatch[2]!.length);
        const toOffset = text.indexOf(transitionMatch[3]!, arrowOffset + 3);
        const labelOffset = transitionMatch[4] ? text.lastIndexOf(transitionMatch[4]!) : -1;
        let labelClauseOffset = labelOffset;
        if (labelOffset >= 0) {
          labelClauseOffset = text.lastIndexOf(':', labelOffset);
          while (
            labelClauseOffset > toOffset + transitionMatch[3]!.length
            && /[\t ]/u.test(text[labelClauseOffset - 1]!)
          ) {
            labelClauseOffset -= 1;
          }
        }
        transitions.push({
          ...value,
          fromToken: {
            end: line.start + fromOffset + transitionMatch[2]!.length,
            start: line.start + fromOffset,
          },
          indent,
          ...(labelOffset >= 0 ? {
            labelClause: {
              end: line.start + labelOffset + transitionMatch[4]!.length,
              start: line.start + labelClauseOffset,
            },
            labelToken: {
              end: line.start + labelOffset + transitionMatch[4]!.length,
              start: line.start + labelOffset,
            },
          } : {}),
          line,
          toToken: {
            end: line.start + toOffset + transitionMatch[3]!.length,
            start: line.start + toOffset,
          },
        });
        continue;
      }

      const domainMatch = text.match(DOMAIN);
      if (domainMatch) {
        const name = normalizeDomain(domainMatch[2]!);
        if (domains.some((domain) => domain.name === name)) return null;
        currentDomain = name;
        domains.push({ indent: domainMatch[1]!, line, name });
        continue;
      }

      const itemMatch = text.match(ITEM);
      if (!currentDomain || !itemMatch) return null;
      const value = normalizeItem({ domain: currentDomain, label: decodeLabel(itemMatch[2]!) });
      if (items.some((candidate) => sameItem(candidate, value))) return null;
      const tokenOffset = text.indexOf(itemMatch[2]!);
      items.push({
        ...value,
        indent: itemMatch[1]!,
        line,
        token: {
          end: line.start + tokenOffset + itemMatch[2]!.length,
          start: line.start + tokenOffset,
        },
      });
    }
    return { domains, header, items, lines, transitions };
  } catch {
    return null;
  }
}

function requireCynefin(source: string): ParsedCynefin {
  const parsed = parseCynefin(source);
  if (!parsed) throw new Error('This source is not a safely representable Cynefin diagram.');
  return parsed;
}

function requireValidMutation(source: string): string {
  requireCynefin(source);
  return source;
}

function resolveItem(parsed: ParsedCynefin, identity: CynefinItemIdentity): ItemRecord {
  const matches = parsed.items.filter((item) => sameItem(item, identity.item));
  if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw staleItem();
  return matches[0];
}

function resolveTransition(
  parsed: ParsedCynefin,
  identity: CynefinTransitionIdentity,
): TransitionRecord {
  const matches = parsed.transitions.filter((transition) => (
    sameTransition(transition, identity.transition)
  ));
  if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) {
    throw staleTransition();
  }
  return matches[0];
}

function insertItem(
  source: string,
  parsed: ParsedCynefin,
  item: CynefinItem,
  targetIndex = parsed.items.filter((candidate) => candidate.domain === item.domain).length,
): string {
  const peers = parsed.items.filter((candidate) => candidate.domain === item.domain);
  validateTargetIndex(targetIndex, peers.length, 'Cynefin item');
  const domain = parsed.domains.find((candidate) => candidate.name === item.domain);
  if (!domain) {
    const transition = parsed.transitions[0];
    return insertBeforeLine(
      source,
      transition?.line,
      [`  ${item.domain}`, `    ${encodeLabel(item.label)}`],
    );
  }
  const indent = peers[0]?.indent ?? `${domain.indent}  `;
  const before = peers[targetIndex];
  if (before) return insertBeforeLine(source, before.line, [`${indent}${encodeLabel(item.label)}`]);
  return insertAfterLine(
    source,
    peers.at(-1)?.line ?? domain.line,
    [`${indent}${encodeLabel(item.label)}`],
  );
}

function relocateItem(
  source: string,
  parsed: ParsedCynefin,
  current: ItemRecord,
  value: CynefinItem,
  targetIndex: number,
): string {
  const destination = parsed.domains.find((domain) => domain.name === value.domain);
  const peers = parsed.items.filter((item) => item.domain === value.domain && item !== current);
  validateTargetIndex(targetIndex, peers.length, 'Cynefin item');
  if (!destination) {
    const without = deleteLines(source, [current.line]);
    return requireValidMutation(insertItem(without, requireCynefin(without), value, targetIndex));
  }
  const before = peers[targetIndex]?.line;
  const after = before ? undefined : peers.at(-1)?.line ?? destination.line;
  const indent = peers[0]?.indent
    ?? (destination.name === current.domain ? current.indent : `${destination.indent}  `);
  return requireValidMutation(
    moveLineText(source, current.line, `${indent}${encodeLabel(value.label)}`, before, after),
  );
}

function normalizeItem(item: CynefinItem): CynefinItem {
  return { domain: normalizeDomain(item.domain), label: normalizeLabel(item.label, 'Cynefin items') };
}

function normalizeTransition(transition: CynefinTransition): CynefinTransition {
  const from = normalizeDomain(transition.from);
  const to = normalizeDomain(transition.to);
  if (from === to) throw new Error('Cynefin transitions must connect two different domains.');
  return {
    from,
    label: transition.label == null
      ? null
      : normalizeLabel(transition.label, 'Cynefin transition labels'),
    to,
  };
}

function normalizeDomain(value: string): CynefinDomainName {
  if (!CYNEFIN_DOMAIN_NAMES.includes(value as CynefinDomainName)) {
    throw new Error(`Unknown Cynefin domain ${value}.`);
  }
  return value as CynefinDomainName;
}

function normalizeLabel(value: string, noun: string): string {
  if (!value.trim() || /[\u0000-\u001F\u007F]/u.test(value)) {
    throw new Error(`${noun} must be non-empty one-line text.`);
  }
  return value;
}

function decodeLabel(token: string): string {
  const quote = token[0];
  let value = '';
  for (let index = 1; index < token.length - 1; index += 1) {
    const character = token[index]!;
    if (character !== '\\') {
      value += character;
      continue;
    }
    const escaped = token[index += 1];
    if (escaped !== quote && escaped !== '\\') {
      throw new Error('Cynefin labels use unsupported escape syntax.');
    }
    value += escaped;
  }
  return normalizeLabel(value, 'Cynefin labels');
}

function encodeLabel(value: string, quote: '"' | "'" = '"'): string {
  const label = normalizeLabel(value, 'Cynefin labels');
  return `${quote}${label.replace(/\\/gu, '\\\\').replace(new RegExp(quote, 'gu'), `\\${quote}`)}${quote}`;
}

function formatTransition(transition: CynefinTransition): string {
  return `${transition.from} --> ${transition.to}${
    transition.label == null ? '' : ` : ${encodeLabel(transition.label)}`
  }`;
}

function publicItem(item: CynefinItem): CynefinItem {
  return { domain: item.domain, label: item.label };
}

function publicTransition(transition: CynefinTransition): CynefinTransition {
  return { from: transition.from, label: transition.label ?? null, to: transition.to };
}

function sameItem(left: CynefinItem, right: CynefinItem): boolean {
  return left.domain === right.domain && left.label === right.label;
}

function sameTransition(left: CynefinTransition, right: CynefinTransition): boolean {
  return left.from === right.from
    && left.to === right.to
    && (left.label ?? null) === (right.label ?? null);
}

function duplicateItem(item: CynefinItem): Error {
  return new Error(`Cynefin domain ${item.domain} already contains item ${item.label}.`);
}

function duplicateTransition(): Error {
  return new Error('An identical Cynefin transition already exists.');
}

function staleItem(): Error {
  return new Error('Cynefin item changed remotely and can no longer be resolved safely.');
}

function staleTransition(): Error {
  return new Error('Cynefin transition changed remotely and can no longer be resolved safely.');
}

function validateTargetIndex(index: number, maximum: number, noun: string): void {
  if (!Number.isInteger(index) || index < 0 || index > maximum) {
    throw new Error(`${noun} position is out of range.`);
  }
}

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  const matcher = /.*?(?:\r\n|\n|\r|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source)) && match[0]) {
    const raw = match[0];
    lines.push({
      end: match.index + raw.length,
      raw,
      start: match.index,
      text: raw.replace(/\r\n|\n|\r$/u, ''),
    });
  }
  return lines;
}

function sourceLineText(line: Line): string {
  return line.start === 0 ? line.text.replace(/^\uFEFF/u, '') : line.text;
}

function firstStatement(lines: readonly Line[]): number {
  let index = 0;
  if (lines[0] && sourceLineText(lines[0]) === '---') {
    const close = lines.findIndex(
      (line, candidate) => candidate > 0 && sourceLineText(line) === '---',
    );
    if (
      close < 0
      || !isSafeMermaidFrontmatter(lines.slice(1, close).map(sourceLineText))
      || lines.slice(1, close).some((line) => /^[ ]*config[ ]*:/u.test(sourceLineText(line)))
    ) {
      return lines.length;
    }
    index = close + 1;
  }
  while (
    index < lines.length
    && (blank(sourceLineText(lines[index]!)) || comment(sourceLineText(lines[index]!)))
  ) {
    index += 1;
  }
  return index;
}

function blank(value: string): boolean {
  return /^[\t ]*$/u.test(value);
}

function comment(value: string): boolean {
  return /^[\t ]*%%(?!\{)[^\r\n]*$/u.test(value);
}

function directive(value: string): boolean {
  return /^[\t ]*%%\{/u.test(value);
}

function hasUnexpectedSourceCharacters(source: string): boolean {
  const value = source.startsWith('\uFEFF') ? source.slice(1) : source;
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]|[^\S\r\n\t ]/u.test(value);
}

function terminator(line: Line): string {
  return line.raw.slice(line.text.length);
}

function hasFinalLineEnding(source: string): boolean {
  return /(?:\r\n|\n|\r)$/u.test(source);
}

function localLineEnding(source: string, offset = source.length): string {
  const before = source.slice(0, offset).match(/\r\n|\n|\r/gu)?.at(-1);
  if (before) return before;
  return source.slice(offset).match(/\r\n|\n|\r/u)?.[0] ?? '\n';
}

function appendStatement(source: string, statement: string): string {
  const ending = localLineEnding(source);
  return hasFinalLineEnding(source)
    ? `${source}${statement}${ending}`
    : `${source}${ending}${statement}`;
}

function insertBeforeLine(source: string, before: Line | undefined, texts: readonly string[]): string {
  if (!before) {
    const ending = localLineEnding(source);
    if (hasFinalLineEnding(source)) return `${source}${texts.map((text) => `${text}${ending}`).join('')}`;
    return `${source}${source ? ending : ''}${texts.join(ending)}`;
  }
  const ending = localLineEnding(source, before.start);
  return `${source.slice(0, before.start)}${texts.map((text) => `${text}${ending}`).join('')}${source.slice(before.start)}`;
}

function insertAfterLine(source: string, after: Line, texts: readonly string[]): string {
  const ending = terminator(after) || localLineEnding(source, after.end);
  if (terminator(after)) {
    return `${source.slice(0, after.end)}${texts.map((text) => `${text}${ending}`).join('')}${source.slice(after.end)}`;
  }
  return `${source.slice(0, after.end)}${ending}${texts.join(ending)}${source.slice(after.end)}`;
}

function replaceRange(source: string, range: Range, value: string): string {
  return `${source.slice(0, range.start)}${value}${source.slice(range.end)}`;
}

function replaceRanges(source: string, replacements: readonly { range: Range; value: string }[]): string {
  return [...replacements]
    .sort((left, right) => right.range.start - left.range.start)
    .reduce((value, replacement) => replaceRange(value, replacement.range, replacement.value), source);
}

function deleteLines(source: string, lines: readonly Line[]): string {
  const hadFinalLineEnding = hasFinalLineEnding(source);
  const next = [...lines]
    .sort((left, right) => right.start - left.start)
    .reduce(
      (value, line) => `${value.slice(0, line.start)}${value.slice(line.end)}`,
      source,
    );
  return !hadFinalLineEnding && hasFinalLineEnding(next)
    ? next.replace(/(?:\r\n|\n|\r)$/u, '')
    : next;
}

function swapLineText(source: string, left: Line, right: Line): string {
  const first = left.start < right.start ? left : right;
  const second = first === left ? right : left;
  return `${source.slice(0, first.start)}${second.text}${terminator(first)}`
    + `${source.slice(first.end, second.start)}${first.text}${terminator(second)}`
    + source.slice(second.end);
}

function moveLineText(
  source: string,
  line: Line,
  text: string,
  before?: Line,
  after?: Line,
): string {
  const lines = splitLines(source);
  const endings = lines.map(terminator);
  const sourceIndex = lines.findIndex((candidate) => candidate.start === line.start);
  if (sourceIndex < 0) throw staleItem();
  const [moved] = lines.splice(sourceIndex, 1);
  if (!moved) throw staleItem();
  let destination = lines.length;
  if (before) {
    destination = lines.findIndex((candidate) => candidate.start === before.start);
  } else if (after) {
    const afterIndex = lines.findIndex((candidate) => candidate.start === after.start);
    destination = afterIndex < 0 ? lines.length : afterIndex + 1;
  }
  if (destination < 0) throw staleItem();
  lines.splice(destination, 0, { ...moved, text });
  return lines.map((candidate, index) => `${candidate.text}${endings[index] ?? ''}`).join('');
}
