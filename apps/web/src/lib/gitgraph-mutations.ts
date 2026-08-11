export type GitGraphDirection = 'BT' | 'LR' | 'TB';
export type GitCommitType = 'HIGHLIGHT' | 'NORMAL' | 'REVERSE';

export interface GitGraphCommit { id?: string; tags: string[]; type?: GitCommitType; }
export interface GitGraphBranch { name: string; order?: number; }
export interface GitGraphCheckout { branch: string; keyword: 'checkout' | 'switch'; }
export interface GitGraphMerge { branch: string; id?: string; tags: string[]; type?: GitCommitType; }
export interface GitGraphCherryPick { id: string; parent?: string; tags: string[]; }
export type GitGraphOperation =
  | { kind: 'branch'; value: GitGraphBranch }
  | { kind: 'checkout'; value: GitGraphCheckout }
  | { kind: 'cherry-pick'; value: GitGraphCherryPick }
  | { kind: 'commit'; value: GitGraphCommit }
  | { kind: 'merge'; value: GitGraphMerge };
export interface GitGraphDiagramSnapshot { direction?: GitGraphDirection; operations: GitGraphOperation[]; }
/** A source-derived fingerprint; duplicates intentionally fail stale rather than guessing. */
export interface GitGraphOperationIdentity { operation: GitGraphOperation; occurrenceCount: number; }

interface Line { end: number; raw: string; start: number; text: string; }
interface StatementRecord { line: Line; operation: GitGraphOperation; }
interface Parsed { direction?: GitGraphDirection; records: StatementRecord[]; }

const HEADER = /^\s*gitGraph(?:\s+(LR|TB|BT):?)?\s*$/i;
const NAME = '(?:"[^"\\r\\n]+"|[A-Za-z_][A-Za-z0-9_.-]*)';
const QUOTED = '"([^"\\r\\n]+)"';
const ATTR = new RegExp(`\\s+(id|tag|type|order|parent):\\s*(?:${QUOTED}|([A-Za-z_][A-Za-z0-9_.-]*|[0-9]+))`, 'gi');
const BRANCH = new RegExp(`^\\s*branch\\s+(${NAME})(.*)$`, 'i');
const CHECKOUT = new RegExp(`^\\s*(checkout|switch)\\s+(${NAME})\\s*$`, 'i');
const MERGE = new RegExp(`^\\s*merge\\s+(${NAME})(.*)$`, 'i');
const CHERRY_PICK = /^\s*cherry-pick\s+(.+)$/i;
const COMMIT = /^\s*commit(.*)$/i;

export function isGitGraphDiagramSource(source: string): boolean { return parseGitGraph(source) !== null; }
export function isGitGraphSourceRepresentable(source: string): boolean { return parseGitGraph(source) !== null; }
export function getGitGraphDiagramSnapshot(source: string): GitGraphDiagramSnapshot {
  const parsed = requireGitGraph(source);
  return { ...(parsed.direction ? { direction: parsed.direction } : {}), operations: parsed.records.map((record) => publicOperation(record.operation)) };
}
export function getGitGraphOperationIdentity(operation: GitGraphOperation, operations: readonly GitGraphOperation[] = []): GitGraphOperationIdentity { return { operation: publicOperation(operation), occurrenceCount: operations.length ? operations.filter((candidate) => sameOperation(candidate, operation)).length : 1 }; }
export function resolveGitGraphOperationIndex(operations: readonly GitGraphOperation[], identity: GitGraphOperationIdentity): number { if (identity.occurrenceCount !== 1) throw stale(); const matches = operations.map((operation, index) => ({ operation, index })).filter(({ operation }) => sameOperation(operation, identity.operation)); if (matches.length !== 1 || !matches[0]) throw stale(); return matches[0].index; }

export function addGitGraphCommit(source: string, commit: GitGraphCommit): string {
  const value = normalizeCommit(commit);
  if (!source.trim()) return `gitGraph\n  ${formatCommit(value)}`;
  const parsed = requireGitGraph(source);
  if (value.id && commitIds(parsed).has(value.id)) throw new Error(`A commit named ${value.id} already exists.`);
  return appendAndValidate(source, `  ${formatCommit(value)}`);
}
export function editGitGraphCommit(source: string, identity: GitGraphOperationIdentity, patch: Partial<GitGraphCommit>): string {
  const parsed = requireGitGraph(source); const record = findOperation(parsed, identity, 'commit'); const current = record.operation.value;
  const value = normalizeCommit({ ...current, ...patch, tags: patch.tags ?? current.tags });
  const ids = commitIds(parsed); if (current.id) ids.delete(current.id); if (value.id && ids.has(value.id)) throw new Error(`A commit named ${value.id} already exists.`);
  return replaceAndValidate(source, record.line, `${indent(record.line)}${formatCommit(value)}`);
}
export function addGitGraphBranch(source: string, branch: GitGraphBranch): string {
  const parsed = requireGitGraph(source); const value = normalizeBranch(branch);
  if (branchNames(parsed).has(value.name)) throw new Error(`A branch named ${value.name} already exists.`);
  return appendAndValidate(source, `  ${formatBranch(value)}`);
}
export function editGitGraphBranch(source: string, identity: GitGraphOperationIdentity, patch: Partial<GitGraphBranch>): string {
  const parsed = requireGitGraph(source); const record = findOperation(parsed, identity, 'branch'); const current = record.operation.value; const value = normalizeBranch({ ...current, ...patch });
  if (value.name !== current.name && branchNames(parsed).has(value.name)) throw new Error(`A branch named ${value.name} already exists.`);
  const replacements = [{ line: record.line, value: `${indent(record.line)}${formatBranch(value)}` }, ...value.name === current.name ? [] : parsed.records.flatMap((item) => {
    if (item.operation.kind === 'checkout' && item.operation.value.branch === current.name) return [{ line: item.line, value: `${indent(item.line)}${formatCheckout({ ...item.operation.value, branch: value.name })}` }];
    if (item.operation.kind === 'merge' && item.operation.value.branch === current.name) return [{ line: item.line, value: `${indent(item.line)}${formatMerge({ ...item.operation.value, branch: value.name })}` }];
    return [];
  })];
  const next = replaceLines(source, replacements);
  return requireGitGraph(next), next;
}
export function addGitGraphCheckout(source: string, checkout: GitGraphCheckout): string {
  const parsed = requireGitGraph(source); const value = normalizeCheckout(checkout);
  if (!branchNames(parsed).has(value.branch)) throw new Error(`Branch ${value.branch} does not exist.`);
  return appendAndValidate(source, `  ${formatCheckout(value)}`);
}
export function editGitGraphCheckout(source: string, identity: GitGraphOperationIdentity, patch: Partial<GitGraphCheckout>): string {
  const parsed = requireGitGraph(source); const record = findOperation(parsed, identity, 'checkout'); const value = normalizeCheckout({ ...record.operation.value, ...patch });
  if (!branchNames(parsed).has(value.branch)) throw new Error(`Branch ${value.branch} does not exist.`); return replaceAndValidate(source, record.line, `${indent(record.line)}${formatCheckout(value)}`);
}
export function addGitGraphMerge(source: string, merge: GitGraphMerge): string {
  const parsed = requireGitGraph(source); const value = normalizeMerge(merge);
  if (value.id && commitIds(parsed).has(value.id)) throw new Error(`A commit named ${value.id} already exists.`);
  return appendAndValidate(source, `  ${formatMerge(value)}`);
}
export function editGitGraphMerge(source: string, identity: GitGraphOperationIdentity, patch: Partial<GitGraphMerge>): string {
  const parsed = requireGitGraph(source); const record = findOperation(parsed, identity, 'merge'); const current = record.operation.value; const value = normalizeMerge({ ...current, ...patch, tags: patch.tags ?? current.tags });
  const ids = commitIds(parsed); if (current.id) ids.delete(current.id); if (value.id && ids.has(value.id)) throw new Error(`A commit named ${value.id} already exists.`); return replaceAndValidate(source, record.line, `${indent(record.line)}${formatMerge(value)}`);
}
export function addGitGraphCherryPick(source: string, cherryPick: GitGraphCherryPick): string {
  const parsed = requireGitGraph(source); const value = normalizeCherryPick(cherryPick);
  return appendAndValidate(source, `  ${formatCherryPick(value)}`);
}
export function editGitGraphCherryPick(source: string, identity: GitGraphOperationIdentity, patch: Partial<GitGraphCherryPick>): string {
  const parsed = requireGitGraph(source); const record = findOperation(parsed, identity, 'cherry-pick'); const current = record.operation.value; const value = normalizeCherryPick({ ...current, ...patch, tags: patch.tags ?? current.tags });
  return replaceAndValidate(source, record.line, `${indent(record.line)}${formatCherryPick(value)}`);
}
/** Reorders one canonical operation only when the resulting history still validates. */
export function moveGitGraphOperation(source: string, identity: GitGraphOperationIdentity, direction: 'up' | 'down'): string {
  const parsed = requireGitGraph(source); const fromIndex = resolveGitGraphOperationIndex(parsed.records.map((record) => record.operation), identity); const toIndex = fromIndex + (direction === 'up' ? -1 : 1); if (toIndex < 0 || toIndex >= parsed.records.length) return source;
  const left = parsed.records[Math.min(fromIndex, toIndex)]!; const right = parsed.records[Math.max(fromIndex, toIndex)]!;
  const next = swapLines(source, left.line, right.line); return requireGitGraph(next), next;
}
export function deleteGitGraphOperation(source: string, identity: GitGraphOperationIdentity): string {
  const parsed = requireGitGraph(source); const record = parsed.records[resolveGitGraphOperationIndex(parsed.records.map((item) => item.operation), identity)]; if (!record) throw stale();
  const next = `${source.slice(0, record.line.start)}${source.slice(record.line.end)}`; return requireGitGraph(next), next;
}

function parseGitGraph(source: string): Parsed | null {
  try {
    const lines = splitLines(source); const headerIndex = firstStatement(lines); const header = lines[headerIndex]?.text.replace(/^\uFEFF/, '').match(HEADER); if (!header) return null;
    const records: StatementRecord[] = [];
    for (let index = headerIndex + 1; index < lines.length; index += 1) {
      const line = lines[index]!; if (!line.text.trim() || ignorable(line.text)) continue;
      const operation = parseOperation(line.text); if (!operation) return null; records.push({ line, operation });
    }
    const parsed = { ...(header[1] ? { direction: header[1].toUpperCase() as GitGraphDirection } : {}), records };
    validateHistory(parsed); return parsed;
  } catch { return null; }
}
function parseOperation(text: string): GitGraphOperation | null {
  let match = text.match(BRANCH); if (match) { const attrs = parseAttributes(match[2]!); if (!attrs || attrs.id || attrs.tag || attrs.type || attrs.parent || (attrs.order && !/^\d+$/.test(attrs.order))) return null; return { kind: 'branch', value: { name: normalizeName(unquote(match[1]!)), ...(attrs.order ? { order: Number(attrs.order) } : {}) } }; }
  match = text.match(CHECKOUT); if (match) return { kind: 'checkout', value: { keyword: match[1]!.toLowerCase() as 'checkout' | 'switch', branch: normalizeName(unquote(match[2]!)) } };
  match = text.match(COMMIT); if (match) { const attrs = parseAttributes(match[1]!); if (!attrs || attrs.order || attrs.parent) return null; return { kind: 'commit', value: { ...(attrs.id ? { id: attrs.id } : {}), ...(attrs.tag ? { tags: attrs.tag.split('\u0000') } : { tags: [] }), ...(attrs.type ? { type: asType(attrs.type) } : {}) } }; }
  match = text.match(MERGE); if (match) { const attrs = parseAttributes(match[2]!); if (!attrs || attrs.order || attrs.parent) return null; return { kind: 'merge', value: { branch: normalizeName(unquote(match[1]!)), ...(attrs.id ? { id: attrs.id } : {}), ...(attrs.tag ? { tags: attrs.tag.split('\u0000') } : { tags: [] }), ...(attrs.type ? { type: asType(attrs.type) } : {}) } }; }
  match = text.match(CHERRY_PICK); if (match) { const attrs = parseAttributes(` ${match[1]!}`); if (!attrs?.id || attrs.order || attrs.type || !match[1]!.trim().startsWith('id:')) return null; return { kind: 'cherry-pick', value: { id: attrs.id, ...(attrs.parent ? { parent: attrs.parent } : {}), tags: attrs.tag ? attrs.tag.split('\u0000') : [] } }; }
  return null;
}
function parseAttributes(input: string): Record<string, string> | null { const attrs: Record<string, string> = {}; ATTR.lastIndex = 0; let consumed = ''; let match: RegExpExecArray | null; while ((match = ATTR.exec(input))) { consumed += match[0]!; const key = match[1]!.toLowerCase(); const value = match[2] ?? match[3]!; if (key in attrs && key !== 'tag') return null; attrs[key] = key === 'tag' && attrs.tag ? `${attrs.tag}\u0000${value}` : value; } return consumed === input ? attrs : null; }
function validateHistory(parsed: Parsed): void {
  const branches = new Map<string, string | undefined>([['main', undefined]]); const commits = new Map<string, { branch: string; parents: string[] }>(); let current = 'main'; let generated = 0;
  for (const { operation } of parsed.records) {
    if (operation.kind === 'commit') { const id = operation.value.id; const head = id ?? `__generated_${generated += 1}`; if (id && commits.has(id)) throw new Error('Duplicate commit id.'); if (id) commits.set(id, { branch: current, parents: branches.get(current) ? [branches.get(current)!] : [] }); branches.set(current, head); continue; }
    if (operation.kind === 'branch') { if (branches.has(operation.value.name) || !branches.get(current)) throw new Error('A branch requires an existing current-branch commit.'); branches.set(operation.value.name, branches.get(current)); current = operation.value.name; continue; }
    if (operation.kind === 'checkout') { if (!branches.has(operation.value.branch)) throw new Error('Unknown branch.'); current = operation.value.branch; continue; }
    if (operation.kind === 'merge') { if (!branches.has(operation.value.branch) || operation.value.branch === current || !branches.get(operation.value.branch) || !branches.get(current) || branches.get(operation.value.branch) === branches.get(current)) throw new Error('Invalid merge.'); const id = operation.value.id; const head = id ?? `__generated_${generated += 1}`; if (id && commits.has(id)) throw new Error('Duplicate commit id.'); if (id) commits.set(id, { branch: current, parents: [branches.get(current)!, branches.get(operation.value.branch)!] }); branches.set(current, head); continue; }
    const source = commits.get(operation.value.id); if (!source || source.branch === current || !branches.get(current)) throw new Error('Invalid cherry-pick.'); if (source.parents.length > 1 && !operation.value.parent) throw new Error('A merge cherry-pick requires a parent.'); if (operation.value.parent && !source.parents.includes(operation.value.parent)) throw new Error('Cherry-pick parent is not an immediate parent.');
  }
}
function requireGitGraph(source: string): Parsed { const parsed = parseGitGraph(source); if (!parsed) throw new Error('This source is not a safely representable GitGraph history.'); return parsed; }
function findOperation<K extends GitGraphOperation['kind']>(parsed: Parsed, identity: GitGraphOperationIdentity, kind: K): StatementRecord & { operation: Extract<GitGraphOperation, { kind: K }> } { const record = parsed.records[resolveGitGraphOperationIndex(parsed.records.map((item) => item.operation), identity)]; if (!record || record.operation.kind !== kind) throw stale(); return record as StatementRecord & { operation: Extract<GitGraphOperation, { kind: K }> }; }
function publicOperation(operation: GitGraphOperation): GitGraphOperation { return operation.kind === 'commit' ? { kind: 'commit', value: { ...operation.value, tags: [...operation.value.tags] } } : operation.kind === 'merge' ? { kind: 'merge', value: { ...operation.value, tags: [...operation.value.tags] } } : operation.kind === 'cherry-pick' ? { kind: 'cherry-pick', value: { ...operation.value, tags: [...operation.value.tags] } } : { ...operation, value: { ...operation.value } } as GitGraphOperation; }
function normalizeCommit(value: GitGraphCommit): GitGraphCommit { return { ...(value.id ? { id: text(value.id, 'Commit ids') } : {}), tags: normalizeTags(value.tags), ...(value.type ? { type: asType(value.type) } : {}) }; }
function normalizeBranch(value: GitGraphBranch): GitGraphBranch { return { name: normalizeName(value.name), ...(value.order === undefined ? {} : { order: integer(value.order, 'Branch order') }) }; }
function normalizeCheckout(value: GitGraphCheckout): GitGraphCheckout { return { keyword: value.keyword === 'switch' ? 'switch' : 'checkout', branch: normalizeName(value.branch) }; }
function normalizeMerge(value: GitGraphMerge): GitGraphMerge { return { branch: normalizeName(value.branch), ...(value.id ? { id: text(value.id, 'Merge ids') } : {}), tags: normalizeTags(value.tags), ...(value.type ? { type: asType(value.type) } : {}) }; }
function normalizeCherryPick(value: GitGraphCherryPick): GitGraphCherryPick { return { id: text(value.id, 'Cherry-pick ids'), ...(value.parent ? { parent: text(value.parent, 'Cherry-pick parents') } : {}), tags: normalizeTags(value.tags) }; }
function formatCommit(value: GitGraphCommit): string { return `commit${value.id ? ` id: ${quote(value.id)}` : ''}${value.type ? ` type: ${value.type}` : ''}${value.tags.map((tag) => ` tag: ${quote(tag)}`).join('')}`; }
function formatBranch(value: GitGraphBranch): string { return `branch ${branchToken(value.name)}${value.order === undefined ? '' : ` order: ${value.order}`}`; }
function formatCheckout(value: GitGraphCheckout): string { return `${value.keyword} ${branchToken(value.branch)}`; }
function formatMerge(value: GitGraphMerge): string { return `merge ${branchToken(value.branch)}${value.id ? ` id: ${quote(value.id)}` : ''}${value.type ? ` type: ${value.type}` : ''}${value.tags.map((tag) => ` tag: ${quote(tag)}`).join('')}`; }
function formatCherryPick(value: GitGraphCherryPick): string { return `cherry-pick id: ${quote(value.id)}${value.parent ? ` parent: ${quote(value.parent)}` : ''}${value.tags.map((tag) => ` tag: ${quote(tag)}`).join('')}`; }
function branchNames(parsed: Parsed): Set<string> { const names = new Set(['main']); for (const item of parsed.records) if (item.operation.kind === 'branch') names.add(item.operation.value.name); return names; }
function commitIds(parsed: Parsed): Set<string> { const ids = new Set<string>(); for (const item of parsed.records) if ((item.operation.kind === 'commit' || item.operation.kind === 'merge') && item.operation.value.id) ids.add(item.operation.value.id); return ids; }
function asType(value: string): GitCommitType { const type = value.toUpperCase(); if (type !== 'NORMAL' && type !== 'REVERSE' && type !== 'HIGHLIGHT') throw new Error('Unsupported GitGraph commit type.'); return type; }
function normalizeName(value: string): string { const name = value.trim(); if (!/^[A-Za-z_][A-Za-z0-9_.-]*$/.test(name) || /^(branch|checkout|switch|commit|merge|cherry-pick)$/i.test(name)) throw new Error('GitGraph branch names must be Mermaid-safe identifiers.'); return name; }
function text(value: string, noun: string): string { const result = value.trim(); if (!result || /["\r\n]/.test(result)) throw new Error(`${noun} must be non-empty single-line text.`); return result; }
function normalizeTags(tags: readonly string[] = []): string[] { const normalized = tags.map((tag) => text(tag, 'GitGraph tags')); if (new Set(normalized).size !== normalized.length) throw new Error('GitGraph tags must be unique per operation.'); return normalized; }
function integer(value: number, noun: string): number { if (!Number.isInteger(value) || value < 0) throw new Error(`${noun} must be a non-negative integer.`); return value; }
function quote(value: string): string { return `"${value}"`; } function branchToken(value: string): string { return value; } function unquote(value: string): string { return value.startsWith('"') ? value.slice(1, -1) : value; }
function splitLines(source: string): Line[] { const lines: Line[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; lines.push({ start: match.index, end: match.index + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function firstStatement(lines: readonly Line[]): number { let index = 0; if (lines[0]?.text.replace(/^\uFEFF/, '').trim() === '---') { const close = lines.findIndex((line, candidate) => candidate > 0 && line.text.trim() === '---'); index = close < 0 ? lines.length : close + 1; } while (index < lines.length && (!lines[index]!.text.trim() || ignorable(lines[index]!.text))) index += 1; return index; }
function ignorable(text: string): boolean { return /^\s*%%/.test(text); } function indent(line: Line): string { return line.text.match(/^\s*/)?.[0] ?? ''; } function lineEnding(source: string): string { return source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'; }
function append(source: string, statement: string): string { const ending = lineEnding(source); return `${source}${source && !/(?:\r\n|\n|\r)$/.test(source) ? ending : ''}${statement}`; } function appendAndValidate(source: string, statement: string): string { const next = append(source, statement); return requireGitGraph(next), next; }
function replaceLine(source: string, line: Line, value: string): string { return `${source.slice(0, line.start)}${value}${line.raw.slice(line.text.length)}${source.slice(line.end)}`; } function replaceAndValidate(source: string, line: Line, value: string): string { const next = replaceLine(source, line, value); return requireGitGraph(next), next; }
function replaceLines(source: string, values: readonly { line: Line; value: string }[]): string { return [...values].sort((left, right) => right.line.start - left.line.start).reduce((next, item) => replaceLine(next, item.line, item.value), source); }
function sameOperation(left: GitGraphOperation, right: GitGraphOperation): boolean { return left.kind === right.kind && JSON.stringify(left.value) === JSON.stringify(right.value); }
function stale(): Error { return new Error('GitGraph operation changed remotely and can no longer be resolved safely.'); }
function swapLines(source: string, left: Line, right: Line): string { const first = left.start < right.start ? left : right; const second = first === left ? right : left; const firstEnding = first.raw.slice(first.text.length); const secondEnding = second.raw.slice(second.text.length); return `${source.slice(0, first.start)}${second.text}${firstEnding}${source.slice(first.end, second.start)}${first.text}${secondEnding}${source.slice(second.end)}`; }
