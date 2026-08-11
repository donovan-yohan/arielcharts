import { isSafeMermaidFrontmatter } from './mermaid-frontmatter';

export interface VennSubset {
  /** The literal source value, or null when Mermaid supplies its default. */
  authoredValue?: number | null;
  label: string | null;
  sets: string[];
  /** The effective Mermaid value. */
  value: number;
}

export interface VennSubsetIdentity {
  occurrenceCount: number;
  subset: VennSubset;
}

export interface VennStyleProperty {
  name: string;
  value: string;
}

export interface VennStyle {
  properties: VennStyleProperty[];
  sets: string[];
}

export interface VennStyleIdentity {
  occurrenceCount: number;
  style: VennStyle;
}

export interface VennDiagramSnapshot {
  styles: VennStyle[];
  subsets: VennSubset[];
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

interface SubsetRecord extends VennSubset {
  idTokens: Range[];
  labelClause?: Range;
  labelToken?: Range;
  line: Line;
  valueClause?: Range;
  valueToken?: Range;
}

interface StyleRecord extends VennStyle {
  idTokens: Range[];
  line: Line;
}

interface ParsedVenn {
  header: Line;
  lines: Line[];
  styles: StyleRecord[];
  subsets: SubsetRecord[];
}

const IDENTIFIER = '[A-Za-z_][A-Za-z0-9_-]*';
const NUMBER = '[+]?(?:[0-9]+(?:\\.[0-9]+)?|\\.[0-9]+)';
const LABEL = '\\[(?:"[^"]*"|[^\\]"\\r\\n]+)\\]';
const SET = new RegExp(
  `^([ \\t]*)set[ \\t]+(${IDENTIFIER})([ \\t]*)(?:(${LABEL})([ \\t]*))?(?::([ \\t]*)(${NUMBER})([ \\t]*))?$`,
  'u',
);
const UNION = new RegExp(
  `^([ \\t]*)union[ \\t]+(${IDENTIFIER}(?:[ \\t]*,[ \\t]*${IDENTIFIER})+)([ \\t]*)(?:(${LABEL})([ \\t]*))?(?::([ \\t]*)(${NUMBER})([ \\t]*))?$`,
  'u',
);
const STYLE = new RegExp(`^([ \\t]*)style[ \\t]+(${IDENTIFIER}(?:[ \\t]*,[ \\t]*${IDENTIFIER})*)[ \\t]+(.+?)([ \\t]*)$`, 'u');
const STYLE_NAMES = new Set([
  'color',
  'fill',
  'fill-opacity',
  'opacity',
  'stroke',
  'stroke-opacity',
  'stroke-width',
]);

export function isVennDiagramSource(source: string): boolean {
  return parseVenn(source) !== null;
}

export function isVennSourceRepresentable(source: string): boolean {
  return parseVenn(source) !== null;
}

export function getVennDiagramSnapshot(source: string): VennDiagramSnapshot {
  const parsed = requireVenn(source);
  return {
    styles: parsed.styles.map(publicStyle),
    subsets: parsed.subsets.map(publicSubset),
  };
}

export function getVennSubsetIdentity(
  subset: VennSubset,
  subsets: readonly VennSubset[] = [],
): VennSubsetIdentity {
  const fingerprint = publicSubset(subset);
  return {
    subset: fingerprint,
    occurrenceCount: subsets.length
      ? subsets.filter((candidate) => sameSubset(candidate, fingerprint)).length
      : 1,
  };
}

export function getVennStyleIdentity(
  style: VennStyle,
  styles: readonly VennStyle[] = [],
): VennStyleIdentity {
  const fingerprint = publicStyle(style);
  return {
    style: fingerprint,
    occurrenceCount: styles.length
      ? styles.filter((candidate) => sameStyle(candidate, fingerprint)).length
      : 1,
  };
}

export function resolveVennSubset(source: string, identity: VennSubsetIdentity): VennSubset {
  return publicSubset(resolveSubset(requireVenn(source), identity));
}

export function resolveVennStyle(source: string, identity: VennStyleIdentity): VennStyle {
  return publicStyle(resolveStyle(requireVenn(source), identity));
}

export function addVennSubset(source: string, subset: VennSubset): string {
  const parsed = requireVenn(source);
  const value = normalizeSubset(subset);
  const candidate = [...parsed.subsets.map(publicSubset), value];
  validateSubsets(candidate);
  if (parsed.subsets.some((existing) => subsetKey(existing.sets) === subsetKey(value.sets))) {
    throw new Error('Venn diagrams cannot contain duplicate semantic subsets.');
  }

  const firstStyle = parsed.styles[0];
  const firstUnion = parsed.subsets.find((existing) => existing.sets.length > 1);
  const insertion = value.sets.length === 1
    ? firstUnion?.line.start ?? firstStyle?.line.start ?? source.length
    : firstStyle?.line.start ?? source.length;
  const next = insertStatement(source, insertion, `  ${formatSubset(value)}`);
  return requireValidMutation(next);
}

export function editVennSubset(
  source: string,
  identity: VennSubsetIdentity,
  patch: Partial<VennSubset>,
): string {
  let parsed = requireVenn(source);
  let current = resolveSubset(parsed, identity);
  const requestedSets = patch.sets ?? current.sets;
  if ((requestedSets.length === 1) !== (current.sets.length === 1)) {
    throw new Error('Venn base sets and intersections cannot change statement kind.');
  }

  if (current.sets.length === 1 && requestedSets[0] !== current.sets[0]) {
    source = renameVennSet(source, identity, requestedSets[0]!);
    parsed = requireVenn(source);
    current = parsed.subsets.find((candidate) => candidate.sets.length === 1 && candidate.sets[0] === requestedSets[0])!;
  }
  const value = normalizeSubset({
    authoredValue: patch.value === undefined ? current.authoredValue : patch.value,
    label: patch.label === undefined ? current.label : patch.label,
    sets: current.sets.length === 1 ? current.sets : requestedSets,
    value: patch.value ?? current.value,
  });
  if (sameSubset(current, value)) return source;
  const candidate = parsed.subsets.map((subset) => subset === current ? value : publicSubset(subset));
  validateSubsets(candidate);
  if (candidate.some((subset, index) => candidate.findIndex((other) => subsetKey(other.sets) === subsetKey(subset.sets)) !== index)) {
    throw new Error('Venn diagrams cannot contain duplicate semantic subsets.');
  }

  const replacements: Array<{ range: Range; value: string }> = [];
  if (current.sets.length > 1 && !sameSets(current.sets, value.sets)) {
    replacements.push({
      range: { end: current.idTokens.at(-1)!.end, start: current.idTokens[0]!.start },
      value: value.sets.join(', '),
    });
  }
  if (current.label !== value.label) {
    if (current.labelToken && value.label !== null) {
      replacements.push({ range: current.labelToken, value: encodeBracketLabel(value.label) });
    } else if (current.labelClause && value.label === null) {
      replacements.push({ range: current.labelClause, value: '' });
    } else if (value.label !== null) {
      const insertion = current.idTokens.at(-1)!.end;
      replacements.push({ range: { end: insertion, start: insertion }, value: encodeBracketLabel(value.label) });
    }
  }
  if (current.authoredValue !== value.authoredValue) {
    if (current.valueToken && value.authoredValue !== null) {
      replacements.push({ range: current.valueToken, value: formatNumber(value.authoredValue ?? value.value) });
    } else if (current.valueClause && value.authoredValue === null) {
      replacements.push({ range: current.valueClause, value: '' });
    } else if (value.authoredValue !== null) {
      const insertion = current.labelToken?.end ?? current.idTokens.at(-1)!.end;
      replacements.push({ range: { end: insertion, start: insertion }, value: `: ${formatNumber(value.authoredValue ?? value.value)}` });
    }
  }
  return requireValidMutation(replaceRanges(source, replacements));
}

export function deleteVennSubset(source: string, identity: VennSubsetIdentity): string {
  const parsed = requireVenn(source);
  const current = resolveSubset(parsed, identity);
  const key = subsetKey(current.sets);
  if (current.sets.length === 1) {
    const id = current.sets[0]!;
    if (parsed.subsets.some((subset) => subset !== current && subset.sets.includes(id))) {
      throw new Error('A Venn set cannot be deleted while intersections depend on it.');
    }
  }
  if (parsed.styles.some((style) => subsetKey(style.sets) === key)) {
    throw new Error('A Venn subset cannot be deleted while a style depends on it.');
  }
  return requireValidMutation(deleteLines(source, [current.line]));
}

export function moveVennSubset(
  source: string,
  identity: VennSubsetIdentity,
  direction: 'up' | 'down',
): string {
  const parsed = requireVenn(source);
  const current = resolveSubset(parsed, identity);
  const peers = parsed.subsets.filter((subset) => (subset.sets.length === 1) === (current.sets.length === 1));
  const other = peers[peers.indexOf(current) + (direction === 'up' ? -1 : 1)];
  if (!other) return source;
  return requireValidMutation(swapLineText(source, current.line, other.line));
}

export function renameVennSet(
  source: string,
  identity: VennSubsetIdentity,
  nextIdentifier: string,
): string {
  const parsed = requireVenn(source);
  const current = resolveSubset(parsed, identity);
  if (current.sets.length !== 1) throw new Error('Only base Venn sets can be renamed.');
  const previous = current.sets[0]!;
  const next = normalizeIdentifier(nextIdentifier);
  if (previous === next) return source;
  if (parsed.subsets.some((subset) => subset.sets.length === 1 && subset.sets[0] === next)) {
    throw new Error(`Venn set ${next} already exists.`);
  }

  const replacements: Array<{ range: Range; value: string }> = [];
  for (const subset of parsed.subsets) {
    subset.sets.forEach((identifier, index) => {
      if (identifier === previous) replacements.push({ range: subset.idTokens[index]!, value: next });
    });
  }
  for (const style of parsed.styles) {
    style.sets.forEach((identifier, index) => {
      if (identifier === previous) replacements.push({ range: style.idTokens[index]!, value: next });
    });
  }
  return requireValidMutation(replaceRanges(source, replacements));
}

export function addVennStyle(source: string, style: VennStyle): string {
  const parsed = requireVenn(source);
  const value = normalizeStyle(style);
  validateStyleTarget(value, parsed.subsets);
  if (parsed.styles.some((candidate) => subsetKey(candidate.sets) === subsetKey(value.sets))) {
    throw new Error('A Venn subset can have only one structured style statement.');
  }
  return requireValidMutation(appendStatement(source, `  ${formatStyle(value)}`));
}

export function editVennStyle(
  source: string,
  identity: VennStyleIdentity,
  patch: Partial<VennStyle>,
): string {
  const parsed = requireVenn(source);
  const current = resolveStyle(parsed, identity);
  const value = normalizeStyle({
    properties: patch.properties ?? current.properties,
    sets: patch.sets ?? current.sets,
  });
  validateStyleTarget(value, parsed.subsets);
  if (sameStyle(current, value)) return source;
  if (parsed.styles.some((candidate) => candidate !== current && subsetKey(candidate.sets) === subsetKey(value.sets))) {
    throw new Error('A Venn subset can have only one structured style statement.');
  }
  return requireValidMutation(replaceLine(source, current.line, `${indent(current.line)}${formatStyle(value)}`));
}

export function deleteVennStyle(source: string, identity: VennStyleIdentity): string {
  const parsed = requireVenn(source);
  const current = resolveStyle(parsed, identity);
  return requireValidMutation(deleteLines(source, [current.line]));
}

export function moveVennStyle(
  source: string,
  identity: VennStyleIdentity,
  direction: 'up' | 'down',
): string {
  const parsed = requireVenn(source);
  const current = resolveStyle(parsed, identity);
  const other = parsed.styles[parsed.styles.indexOf(current) + (direction === 'up' ? -1 : 1)];
  if (!other) return source;
  return requireValidMutation(swapLineText(source, current.line, other.line));
}

function parseVenn(source: string): ParsedVenn | null {
  try {
    if (!source || source.indexOf('\uFEFF') > 0 || hasUnexpectedControls(source)) return null;
    const lines = splitLines(source);
    const headerIndex = firstStatement(lines);
    const header = lines[headerIndex];
    if (!header || sourceLineText(header) !== 'venn-beta') return null;

    const subsets: SubsetRecord[] = [];
    const styles: StyleRecord[] = [];
    let sawUnion = false;
    let sawStyle = false;
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]!;
      const text = sourceLineText(line);
      if (ignorable(text)) continue;
      const setMatch = text.match(SET);
      const unionMatch = text.match(UNION);
      const styleMatch = text.match(STYLE);
      if (setMatch) {
        if (sawUnion || sawStyle) return null;
        subsets.push(parseSubsetRecord(line, setMatch, false));
      } else if (unionMatch) {
        if (sawStyle) return null;
        sawUnion = true;
        subsets.push(parseSubsetRecord(line, unionMatch, true));
      } else if (styleMatch) {
        sawStyle = true;
        styles.push(parseStyleRecord(line, styleMatch));
      } else {
        return null;
      }
    }
    validateSubsets(subsets);
    const subsetKeys = new Set(subsets.map((subset) => subsetKey(subset.sets)));
    if (subsetKeys.size !== subsets.length) return null;
    for (const style of styles) validateStyleTarget(style, subsets);
    if (new Set(styles.map((style) => subsetKey(style.sets))).size !== styles.length) return null;
    return { header, lines, styles, subsets };
  } catch {
    return null;
  }
}

function parseSubsetRecord(line: Line, match: RegExpMatchArray, union: boolean): SubsetRecord {
  const identifiersText = match[2]!;
  const keyword = union ? 'union' : 'set';
  const identifierOffset = line.text.indexOf(identifiersText, match[1]!.length + keyword.length);
  if (identifierOffset < 0) throw new Error('Malformed Venn identifier range.');
  const { identifiers, tokens } = parseIdentifierTokens(line, identifiersText, identifierOffset);
  const labelRaw = match[4];
  const label = labelRaw === undefined ? null : decodeBracketLabel(labelRaw);
  const valueRaw = match[7];
  const valueOffset = valueRaw === undefined ? -1 : line.text.lastIndexOf(valueRaw);
  const labelOffset = labelRaw === undefined ? -1 : line.text.indexOf(labelRaw, tokens.at(-1)!.end - line.start);
  const subset = normalizeSubset({
    authoredValue: valueRaw === undefined ? null : Number(valueRaw),
    label,
    sets: identifiers,
    value: valueRaw === undefined ? defaultSubsetValue(identifiers.length) : Number(valueRaw),
  });
  return {
    ...subset,
    idTokens: tokens,
    ...(labelRaw === undefined ? {} : {
      labelClause: { end: line.start + labelOffset + labelRaw.length, start: line.start + labelOffset },
      labelToken: { end: line.start + labelOffset + labelRaw.length, start: line.start + labelOffset },
    }),
    line,
    ...(valueRaw === undefined ? {} : {
      valueClause: {
        end: line.start + valueOffset + valueRaw.length,
        start: line.start + line.text.lastIndexOf(':', valueOffset),
      },
      valueToken: { end: line.start + valueOffset + valueRaw.length, start: line.start + valueOffset },
    }),
  };
}

function parseStyleRecord(line: Line, match: RegExpMatchArray): StyleRecord {
  const identifiersText = match[2]!;
  const identifierOffset = line.text.indexOf(identifiersText, match[1]!.length + 'style'.length);
  if (identifierOffset < 0) throw new Error('Malformed Venn style target range.');
  const { identifiers, tokens } = parseIdentifierTokens(line, identifiersText, identifierOffset);
  return {
    ...normalizeStyle({ properties: parseStyleProperties(match[3]!), sets: identifiers }),
    idTokens: tokens,
    line,
  };
}

function parseIdentifierTokens(
  line: Line,
  text: string,
  offset: number,
): { identifiers: string[]; tokens: Range[] } {
  const identifiers: string[] = [];
  const tokens: Range[] = [];
  const matcher = new RegExp(IDENTIFIER, 'gu');
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text))) {
    identifiers.push(match[0]);
    tokens.push({
      end: line.start + offset + match.index + match[0].length,
      start: line.start + offset + match.index,
    });
  }
  return { identifiers, tokens };
}

function requireVenn(source: string): ParsedVenn {
  const parsed = parseVenn(source);
  if (!parsed) throw new Error('This source is not a safely representable Venn diagram.');
  return parsed;
}

function requireValidMutation(source: string): string {
  requireVenn(source);
  return source;
}

function resolveSubset(parsed: ParsedVenn, identity: VennSubsetIdentity): SubsetRecord {
  const matches = parsed.subsets.filter((candidate) => sameSubset(candidate, identity.subset));
  if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw staleSubset();
  return matches[0];
}

function resolveStyle(parsed: ParsedVenn, identity: VennStyleIdentity): StyleRecord {
  const matches = parsed.styles.filter((candidate) => sameStyle(candidate, identity.style));
  if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw staleStyle();
  return matches[0];
}

function normalizeSubset(subset: VennSubset): VennSubset {
  const sets = subset.sets.map(normalizeIdentifier);
  if (!sets.length || new Set(sets).size !== sets.length) {
    throw new Error('Venn subsets require one or more distinct set identifiers.');
  }
  const authoredValue = subset.authoredValue === undefined ? subset.value : subset.authoredValue;
  if (authoredValue !== null && sets.length === 1 && (!Number.isFinite(authoredValue) || authoredValue <= 0)) {
    throw new Error('Venn base set values must be finite numbers greater than zero.');
  }
  if (authoredValue !== null && (!Number.isFinite(authoredValue) || authoredValue < 0)) {
    throw new Error('Venn subset values must be finite numbers greater than or equal to zero.');
  }
  const value = authoredValue ?? defaultSubsetValue(sets.length);
  if (!Number.isFinite(value) || value < 0) throw new Error('Venn subset values must resolve to finite non-negative numbers.');
  if (sets.length === 1 && value <= 0) {
    throw new Error('Venn base set values must be finite numbers greater than zero.');
  }
  return {
    authoredValue,
    label: subset.label === null ? null : normalizeLabel(subset.label),
    sets,
    value,
  };
}

function validateSubsets(subsets: readonly VennSubset[]): void {
  const bases = new Set<string>();
  const values = new Map<string, number>();
  for (const candidate of subsets) {
    const subset = normalizeSubset(candidate);
    if (subset.sets.length === 1) {
      const identifier = subset.sets[0]!;
      if (bases.has(identifier)) throw new Error(`Venn set ${identifier} is duplicated.`);
      bases.add(identifier);
    } else {
      for (const identifier of subset.sets) {
        if (!bases.has(identifier)) throw new Error(`Venn intersection references unknown set ${identifier}.`);
      }
    }
    const key = subsetKey(subset.sets);
    if (values.has(key)) throw new Error('Venn diagrams cannot contain duplicate semantic subsets.');
    values.set(key, subset.value);
  }
  const entries = [...values].map(([key, value]) => ({ sets: key.split('\u0000'), value }));
  for (const candidate of entries) {
    if (candidate.sets.length < 3) continue;
    for (let size = 2; size < candidate.sets.length; size += 1) {
      for (const dependency of combinations(candidate.sets, size)) {
        const dependencyValue = values.get(subsetKey(dependency));
        if (dependencyValue === undefined || dependencyValue <= 0) {
          throw new Error('Venn intersections of three or more sets require every positive lower-order subset.');
        }
      }
    }
  }
  for (const candidate of entries) {
    for (const containing of entries) {
      if (containing.sets.length < candidate.sets.length
        && containing.sets.every((identifier) => candidate.sets.includes(identifier))
        && candidate.value > containing.value) {
        throw new Error('Venn intersection values cannot exceed their declared containing subsets.');
      }
    }
  }
}

function normalizeStyle(style: VennStyle): VennStyle {
  const sets = style.sets.map(normalizeIdentifier);
  if (!sets.length || new Set(sets).size !== sets.length) {
    throw new Error('Venn styles require one or more distinct target identifiers.');
  }
  if (!style.properties.length) throw new Error('Venn styles require at least one property.');
  const properties = style.properties.map((property) => normalizeStyleProperty(property));
  if (new Set(properties.map((property) => property.name)).size !== properties.length) {
    throw new Error('Venn style property names must be unique.');
  }
  return { properties, sets };
}

function normalizeStyleProperty(property: VennStyleProperty): VennStyleProperty {
  const name = property.name.trim();
  const value = property.value.trim();
  if (!STYLE_NAMES.has(name)) throw new Error(`Venn style property ${name} is not in the safe subset.`);
  if (!value || /[\r\n;]/u.test(value)) throw new Error('Venn style values must be safe one-line tokens.');
  if (name === 'fill' || name === 'stroke' || name === 'color') {
    if (!isColor(value)) throw new Error(`Venn ${name} styles require a safe Mermaid color.`);
  } else {
    if (value.includes(',') || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value)) {
      throw new Error(`Venn ${name} styles require a non-negative numeric value.`);
    }
    if (name !== 'stroke-width' && Number(value) > 1) {
      throw new Error(`Venn ${name} styles must be between zero and one.`);
    }
  }
  return { name, value };
}

function parseStyleProperties(value: string): VennStyleProperty[] {
  return splitStyleFields(value).map((field) => {
    const separator = field.indexOf(':');
    if (separator <= 0) throw new Error('Malformed Venn style property.');
    return normalizeStyleProperty({ name: field.slice(0, separator), value: field.slice(separator + 1) });
  });
}

function splitStyleFields(value: string): string[] {
  const fields: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]!;
    if (character === '(') depth += 1;
    else if (character === ')') {
      depth -= 1;
      if (depth < 0) throw new Error('Malformed Venn style value.');
    } else if (character === ',' && depth === 0) {
      fields.push(value.slice(start, index));
      start = index + 1;
    }
  }
  if (depth !== 0) throw new Error('Malformed Venn style value.');
  fields.push(value.slice(start));
  return fields;
}

function validateStyleTarget(style: VennStyle, subsets: readonly VennSubset[]): void {
  const target = subsetKey(style.sets);
  if (!subsets.some((subset) => subsetKey(subset.sets) === target)) {
    throw new Error('Venn styles must target an existing declared subset.');
  }
}

function normalizeIdentifier(value: string): string {
  const identifier = value.trim();
  if (!new RegExp(`^${IDENTIFIER}$`, 'u').test(identifier)) {
    throw new Error('Venn identifiers must start with a letter or underscore and contain only letters, digits, underscores, or hyphens.');
  }
  return identifier;
}

function normalizeLabel(value: string): string {
  const label = value.trim();
  if (!label || /["\r\n\[\]]/u.test(label)) {
    throw new Error('Venn labels must be non-empty one-line text without brackets or double quotes.');
  }
  return label;
}

function publicSubset(subset: VennSubset): VennSubset {
  return {
    authoredValue: subset.authoredValue ?? null,
    label: subset.label,
    sets: [...subset.sets],
    value: subset.value,
  };
}

function publicStyle(style: VennStyle): VennStyle {
  return {
    properties: style.properties.map((property) => ({ ...property })),
    sets: [...style.sets],
  };
}

function sameSubset(left: VennSubset, right: VennSubset): boolean {
  return left.label === right.label
    && left.value === right.value
    && (left.authoredValue ?? null) === (right.authoredValue ?? null)
    && sameSets(left.sets, right.sets);
}

function sameStyle(left: VennStyle, right: VennStyle): boolean {
  return sameSets(left.sets, right.sets)
    && left.properties.length === right.properties.length
    && left.properties.every((property, index) => {
      const other = right.properties[index];
      return property.name === other?.name && property.value === other.value;
    });
}

function sameSets(left: readonly string[], right: readonly string[]): boolean {
  return subsetKey(left) === subsetKey(right);
}

function subsetKey(sets: readonly string[]): string {
  return [...sets].sort().join('\u0000');
}

function formatSubset(subset: VennSubset): string {
  const keyword = subset.sets.length === 1 ? 'set' : 'union';
  return `${keyword} ${subset.sets.join(', ')}${subset.label === null ? '' : encodeBracketLabel(subset.label)}${subset.authoredValue === null ? '' : `: ${formatNumber(subset.authoredValue ?? subset.value)}`}`;
}

function defaultSubsetValue(setCount: number): number {
  return setCount === 1 ? 10 : 10 / (setCount ** 2);
}

function combinations(values: readonly string[], size: number): string[][] {
  if (size === 0) return [[]];
  if (values.length < size) return [];
  const [head, ...tail] = values;
  if (!head) return [];
  return [
    ...combinations(tail, size - 1).map((items) => [head, ...items]),
    ...combinations(tail, size),
  ];
}

function formatStyle(style: VennStyle): string {
  return `style ${style.sets.join(', ')} ${style.properties.map((property) => `${property.name}:${property.value}`).join(',')}`;
}

function encodeBracketLabel(value: string): string {
  return `["${value}"]`;
}

function decodeBracketLabel(value: string): string {
  const inner = value.slice(1, -1).trim();
  return normalizeLabel(inner.startsWith('"') && inner.endsWith('"') ? inner.slice(1, -1) : inner);
}

function formatNumber(value: number): string {
  return plainNumber(value);
}

function plainNumber(value: number): string {
  const source = String(value);
  if (!/[eE]/u.test(source)) return source;
  const [coefficient, exponentText] = source.toLowerCase().split('e');
  const exponent = Number(exponentText);
  const dot = coefficient!.indexOf('.');
  const digits = coefficient!.replace('.', '');
  const decimal = (dot < 0 ? coefficient!.length : dot) + exponent;
  return decimal <= 0
    ? `0.${'0'.repeat(-decimal)}${digits}`
    : decimal >= digits.length
      ? `${digits}${'0'.repeat(decimal - digits.length)}`
      : `${digits.slice(0, decimal)}.${digits.slice(decimal)}`;
}

function isColor(value: string): boolean {
  if (/^#[0-9A-Fa-f]{3}(?:[0-9A-Fa-f]|[0-9A-Fa-f]{3}|[0-9A-Fa-f]{5})?$/u.test(value)) return true;
  if (/^[A-Za-z_][A-Za-z0-9_-]*$/u.test(value)) return true;
  const rgb = value.match(/^rgb\(([0-9.]+),([0-9.]+),([0-9.]+)\)$/u);
  if (rgb) return rgb.slice(1).every((channel) => Number(channel) <= 255);
  const rgba = value.match(/^rgba\(([0-9.]+),([0-9.]+),([0-9.]+),([0-9.]+)\)$/u);
  return Boolean(rgba
    && rgba.slice(1, 4).every((channel) => Number(channel) <= 255)
    && Number(rgba[4]) <= 1);
}

function replaceRanges(
  source: string,
  replacements: readonly { range: Range; value: string }[],
): string {
  let next = source;
  for (const replacement of [...replacements].sort((left, right) => right.range.start - left.range.start)) {
    next = `${next.slice(0, replacement.range.start)}${replacement.value}${next.slice(replacement.range.end)}`;
  }
  return next;
}

function replaceLine(source: string, line: Line, value: string): string {
  return `${source.slice(0, line.start)}${value}${terminator(line)}${source.slice(line.end)}`;
}

function swapLineText(source: string, left: Line, right: Line): string {
  const first = left.start < right.start ? left : right;
  const second = left.start < right.start ? right : left;
  return replaceRanges(source, [
    { range: { end: first.start + first.text.length, start: first.start }, value: second.text },
    { range: { end: second.start + second.text.length, start: second.start }, value: first.text },
  ]);
}

function deleteLines(source: string, lines: readonly Line[]): string {
  let next = source;
  for (const line of [...lines].sort((left, right) => right.start - left.start)) {
    let start = line.start;
    if (!terminator(line) && line.end === source.length) {
      const preceding = source.slice(0, start).match(/(?:\r\n|\n|\r)$/u)?.[0];
      start -= preceding?.length ?? 0;
    }
    next = `${next.slice(0, start)}${next.slice(line.end)}`;
  }
  return next;
}

function insertStatement(source: string, at: number, statement: string): string {
  const ending = localLineEnding(source, at);
  if (at < source.length) return `${source.slice(0, at)}${statement}${ending}${source.slice(at)}`;
  return appendStatement(source, statement);
}

function appendStatement(source: string, statement: string): string {
  const ending = localLineEnding(source, source.length);
  return hasFinalLineEnding(source)
    ? `${source}${statement}${ending}`
    : `${source}${ending}${statement}`;
}

function splitLines(source: string): Line[] {
  const lines: Line[] = [];
  const matcher = /.*?(?:\r\n|\n|\r|$)/gu;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(source)) && match[0]) {
    lines.push({
      end: match.index + match[0].length,
      raw: match[0],
      start: match.index,
      text: match[0].replace(/(?:\r\n|\n|\r)$/u, ''),
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
    const close = lines.findIndex((line, candidate) => candidate > 0 && sourceLineText(line) === '---');
    const frontmatter = lines.slice(1, close).map(sourceLineText);
    if (close < 0
      || !isSafeMermaidFrontmatter(frontmatter)
      || frontmatter.some((line) => /^[ \t]*config[ \t]*:/u.test(line))) return lines.length;
    index = close + 1;
  }
  while (index < lines.length && ignorable(sourceLineText(lines[index]!))) index += 1;
  return index;
}

function ignorable(value: string): boolean {
  return /^[ \t]*$/u.test(value)
    || /^[ \t]*%%(?!\{)[^\r\n]*$/u.test(value);
}

function indent(line: Line): string {
  return line.text.match(/^[ \t]*/u)?.[0] ?? '';
}

function terminator(line: Line): string {
  return line.raw.slice(line.text.length);
}

function hasUnexpectedControls(source: string): boolean {
  return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(source);
}

function hasFinalLineEnding(source: string): boolean {
  return /(?:\r\n|\n|\r)$/u.test(source);
}

function localLineEnding(source: string, at: number): string {
  const before = source.slice(0, at).match(/\r\n|\n|\r/gu)?.at(-1);
  const after = source.slice(at).match(/\r\n|\n|\r/u)?.[0];
  return before ?? after ?? '\n';
}

function staleSubset(): Error {
  return new Error('Venn subset changed remotely and can no longer be resolved safely.');
}

function staleStyle(): Error {
  return new Error('Venn style changed remotely and can no longer be resolved safely.');
}
