import { createArchitectureServices, type Architecture } from '@mermaid-js/parser';

export type ArchitecturePort = 'B' | 'L' | 'R' | 'T';
export type ArchitectureAlignmentDirection = 'column' | 'row';

export interface ArchitectureGroup {
  icon?: string;
  id: string;
  parentId?: string;
  title?: string;
}

export interface ArchitectureService {
  icon?: string;
  iconText?: string;
  id: string;
  parentId?: string;
  title?: string;
}

export interface ArchitectureJunction {
  id: string;
  parentId?: string;
}

export interface ArchitectureEdge {
  from: string;
  fromGroup: boolean;
  fromInto: boolean;
  fromPort: ArchitecturePort;
  to: string;
  toGroup: boolean;
  toInto: boolean;
  toPort: ArchitecturePort;
}

export interface ArchitectureEdgeIdentity extends ArchitectureEdge {
  /** Duplicate edge signatures deliberately fail closed after a remote change. */
  occurrenceCount: number;
}

export interface ArchitectureAlignment {
  direction: ArchitectureAlignmentDirection;
  members: string[];
}

export interface ArchitectureAlignmentIdentity extends ArchitectureAlignment {
  /** Duplicate alignment signatures deliberately fail closed after a remote change. */
  occurrenceCount: number;
}

export interface ArchitectureDiagramSnapshot {
  alignments: ArchitectureAlignment[];
  edges: ArchitectureEdge[];
  groups: ArchitectureGroup[];
  junctions: ArchitectureJunction[];
  services: ArchitectureService[];
}

interface SourceRange {
  end: number;
  start: number;
}

interface CstBacked {
  $cstNode?: { length: number; offset: number };
}

interface ArchitectureGroupRecord extends ArchitectureGroup { range: SourceRange; }
interface ArchitectureServiceRecord extends ArchitectureService { range: SourceRange; }
interface ArchitectureJunctionRecord extends ArchitectureJunction { range: SourceRange; }
interface ArchitectureEdgeRecord extends ArchitectureEdge { range: SourceRange; }
interface ArchitectureAlignmentRecord extends ArchitectureAlignment { range: SourceRange; }
interface ParsedArchitecture {
  alignments: ArchitectureAlignmentRecord[];
  edges: ArchitectureEdgeRecord[];
  groups: ArchitectureGroupRecord[];
  junctions: ArchitectureJunctionRecord[];
  services: ArchitectureServiceRecord[];
}

const architectureParser = createArchitectureServices().Architecture.parser.LangiumParser;
const ID = /^[A-Za-z_][A-Za-z0-9_-]*$/;
const ICON = /^[A-Za-z0-9:_-]+$/;
const PORTS = new Set<ArchitecturePort>(['B', 'L', 'R', 'T']);

/**
 * Architecture uses Mermaid's typed Langium AST and its CST offsets. The
 * model only writes declaration/edge/alignment ranges; fCOSE remains Mermaid's
 * renderer-owned layout authority.
 */
export function isArchitectureSourceRepresentable(source: string): boolean {
  return parseArchitecture(source) !== null;
}

export function getArchitectureDiagramSnapshot(source: string): ArchitectureDiagramSnapshot {
  const parsed = requireArchitecture(source);
  return {
    groups: parsed.groups.map(({ icon, id, parentId, title }) => ({ icon, id, parentId, title })),
    services: parsed.services.map(({ icon, iconText, id, parentId, title }) => ({ icon, iconText, id, parentId, title })),
    junctions: parsed.junctions.map(({ id, parentId }) => ({ id, parentId })),
    edges: parsed.edges.map(publicEdge),
    alignments: parsed.alignments.map(publicAlignment),
  };
}

export function addArchitectureGroup(source: string, group: ArchitectureGroup): string {
  const parsed = source.trim() ? requireArchitecture(source) : null;
  const normalized = normalizeGroup(group, parsed);
  if (!parsed) return `architecture-beta\n  ${formatGroup(normalized)}`;
  return append(source, `${indentationForAppend(source)}${formatGroup(normalized)}`);
}

export function editArchitectureGroup(source: string, id: string, patch: Partial<ArchitectureGroup> & { id?: string }): string {
  const parsed = requireArchitecture(source);
  const current = findGroup(parsed, id);
  const next = normalizeGroup({ ...current, ...patch, id: patch.id ?? current.id }, parsed, id);
  const replacements: Replacement[] = [{ range: current.range, value: statementReplacement(source, current.range, formatGroup(next)) }];
  if (next.id !== id) replacements.push(...renameReferences(source, parsed, id, next.id));
  return replaceValues(source, replacements);
}

export function deleteArchitectureGroup(source: string, id: string): string {
  const parsed = requireArchitecture(source);
  const group = findGroup(parsed, id);
  if (parsed.groups.some((candidate) => candidate.parentId === id)
    || parsed.services.some((candidate) => candidate.parentId === id)
    || parsed.junctions.some((candidate) => candidate.parentId === id)
    || parsed.edges.some((edge) => edge.from === id || edge.to === id)
    || parsed.alignments.some((alignment) => alignment.members.includes(id))) {
    throw new Error('Delete or move the group contents and references before deleting it.');
  }
  return replaceValues(source, [{ range: group.range, value: '' }]);
}

export function addArchitectureService(source: string, service: ArchitectureService): string {
  if (!source.trim()) return `architecture-beta\n  ${formatService(normalizeServiceForEmpty(service))}`;
  const parsed = requireArchitecture(source);
  return append(source, `${indentationForAppend(source)}${formatService(normalizeService(service, parsed))}`);
}

export function editArchitectureService(source: string, id: string, patch: Partial<ArchitectureService> & { id?: string }): string {
  const parsed = requireArchitecture(source);
  const current = findService(parsed, id);
  const next = normalizeService({ ...current, ...patch, id: patch.id ?? current.id }, parsed, id);
  const replacements: Replacement[] = [{ range: current.range, value: statementReplacement(source, current.range, formatService(next)) }];
  if (next.id !== id) replacements.push(...renameReferences(source, parsed, id, next.id));
  return replaceValues(source, replacements);
}

export function deleteArchitectureService(source: string, id: string): string {
  const parsed = requireArchitecture(source);
  const service = findService(parsed, id);
  return removeNodeAndReferences(source, parsed, service.range, id);
}

export function addArchitectureJunction(source: string, junction: ArchitectureJunction): string {
  if (!source.trim()) return `architecture-beta\n  ${formatJunction(normalizeJunctionForEmpty(junction))}`;
  const parsed = requireArchitecture(source);
  return append(source, `${indentationForAppend(source)}${formatJunction(normalizeJunction(junction, parsed))}`);
}

export function editArchitectureJunction(source: string, id: string, patch: Partial<ArchitectureJunction> & { id?: string }): string {
  const parsed = requireArchitecture(source);
  const current = findJunction(parsed, id);
  const next = normalizeJunction({ ...current, ...patch, id: patch.id ?? current.id }, parsed, id);
  const replacements: Replacement[] = [{ range: current.range, value: statementReplacement(source, current.range, formatJunction(next)) }];
  if (next.id !== id) replacements.push(...renameReferences(source, parsed, id, next.id));
  return replaceValues(source, replacements);
}

export function deleteArchitectureJunction(source: string, id: string): string {
  const parsed = requireArchitecture(source);
  const junction = findJunction(parsed, id);
  return removeNodeAndReferences(source, parsed, junction.range, id);
}

export function addArchitectureEdge(source: string, edge: ArchitectureEdge): string {
  if (!source.trim()) throw new Error('Add architecture endpoints before adding an edge.');
  const parsed = requireArchitecture(source);
  const normalized = normalizeEdge(edge, parsed);
  return append(source, `${indentationForAppend(source)}${formatEdge(normalized)}`);
}

export function getArchitectureEdgeIdentity(edge: ArchitectureEdge, edges: readonly ArchitectureEdge[] = []): ArchitectureEdgeIdentity {
  return { ...edge, occurrenceCount: edges.length ? edges.filter((candidate) => sameEdge(candidate, edge)).length : 1 };
}

export function editArchitectureEdge(source: string, identity: ArchitectureEdgeIdentity, edge: ArchitectureEdge): string {
  const parsed = requireArchitecture(source);
  const current = resolveEdge(parsed.edges, identity);
  return replaceValues(source, [{ range: current.range, value: statementReplacement(source, current.range, formatEdge(normalizeEdge(edge, parsed))) }]);
}

export function deleteArchitectureEdge(source: string, identity: ArchitectureEdgeIdentity): string {
  const parsed = requireArchitecture(source);
  return replaceValues(source, [{ range: resolveEdge(parsed.edges, identity).range, value: '' }]);
}

export function addArchitectureAlignment(source: string, alignment: ArchitectureAlignment): string {
  if (!source.trim()) throw new Error('Add architecture members before aligning them.');
  const parsed = requireArchitecture(source);
  return append(source, `${indentationForAppend(source)}${formatAlignment(normalizeAlignment(alignment, parsed))}`);
}

export function getArchitectureAlignmentIdentity(alignment: ArchitectureAlignment, alignments: readonly ArchitectureAlignment[] = []): ArchitectureAlignmentIdentity {
  return { ...alignment, members: [...alignment.members], occurrenceCount: alignments.length ? alignments.filter((candidate) => sameAlignment(candidate, alignment)).length : 1 };
}

export function editArchitectureAlignment(source: string, identity: ArchitectureAlignmentIdentity, alignment: ArchitectureAlignment): string {
  const parsed = requireArchitecture(source);
  const current = resolveAlignment(parsed.alignments, identity);
  return replaceValues(source, [{ range: current.range, value: statementReplacement(source, current.range, formatAlignment(normalizeAlignment(alignment, parsed))) }]);
}

export function deleteArchitectureAlignment(source: string, identity: ArchitectureAlignmentIdentity): string {
  const parsed = requireArchitecture(source);
  return replaceValues(source, [{ range: resolveAlignment(parsed.alignments, identity).range, value: '' }]);
}

function parseArchitecture(source: string): ParsedArchitecture | null {
  const result = architectureParser.parse<Architecture>(maskNonArchitectureText(source));
  if (result.parserErrors.length > 0) return null;
  const architecture = result.value;
  if (architecture.title || architecture.accDescr || architecture.accTitle) return null;
  const groups = architecture.groups.map((item) => ({
    icon: item.icon, id: item.id, parentId: item.in || undefined, title: item.title, range: getRange(item),
  }));
  const services = architecture.services.map((item) => ({
    icon: item.icon, iconText: item.iconText, id: item.id, parentId: item.in || undefined, title: item.title, range: getRange(item),
  }));
  const junctions = architecture.junctions.map((item) => ({ id: item.id, parentId: item.in || undefined, range: getRange(item) }));
  const edges = architecture.edges.map((item) => ({
    from: item.lhsId, fromGroup: item.lhsGroup, fromInto: item.lhsInto, fromPort: asPort(item.lhsDir),
    to: item.rhsId, toGroup: item.rhsGroup, toInto: item.rhsInto, toPort: asPort(item.rhsDir), range: getRange(item),
  }));
  const alignments = architecture.alignments.map((item) => ({ direction: item.direction, members: [...item.members], range: getRange(item) }));
  if ([...groups, ...services, ...junctions, ...edges, ...alignments].some((item) => !item.range)) return null;
  const parsed = { groups, services, junctions, edges, alignments } as ParsedArchitecture;
  try {
    validateParsedArchitecture(parsed);
    return parsed;
  } catch {
    return null;
  }
}

function getRange(item: CstBacked): SourceRange | null {
  const node = item.$cstNode;
  if (!node || !Number.isSafeInteger(node.offset) || !Number.isSafeInteger(node.length) || node.length <= 0) return null;
  return { start: node.offset, end: node.offset + node.length };
}

function validateParsedArchitecture(parsed: ParsedArchitecture): void {
  const ids = new Set<string>();
  for (const node of [...parsed.groups, ...parsed.services, ...parsed.junctions]) {
    assertId(node.id);
    if (ids.has(node.id)) throw new Error('Architecture ids must be unique.');
    ids.add(node.id);
  }
  const groupIds = new Set(parsed.groups.map((group) => group.id));
  for (const group of parsed.groups) {
    assertText(group.title, 'Group titles'); assertIcon(group.icon);
    if (group.parentId && (!groupIds.has(group.parentId) || group.parentId === group.id)) throw new Error('Groups must belong to another group.');
  }
  assertAcyclicGroupContainment(parsed.groups);
  for (const service of parsed.services) {
    assertText(service.title, 'Service titles'); assertIcon(service.icon);
    if (service.iconText) throw new Error('Quoted service icon text is not supported by Mermaid rendering.');
    if (service.parentId && !groupIds.has(service.parentId)) throw new Error('Services can only belong to a group.');
  }
  for (const junction of parsed.junctions) if (junction.parentId && !groupIds.has(junction.parentId)) throw new Error('Junctions can only belong to a group.');
  for (const edge of parsed.edges) validateEdge(edge, ids, groupIds);
  for (const alignment of parsed.alignments) validateAlignment(alignment, ids);
}

function requireArchitecture(source: string): ParsedArchitecture {
  const parsed = parseArchitecture(source);
  if (!parsed) throw new Error('This source is not a safely representable architecture diagram.');
  return parsed;
}

function normalizeGroup(group: ArchitectureGroup, parsed: ParsedArchitecture | null, currentId?: string): ArchitectureGroup {
  const normalized = { icon: cleanOptional(group.icon), id: cleanId(group.id), parentId: cleanOptionalId(group.parentId), title: cleanOptional(group.title) };
  assertIcon(normalized.icon); assertText(normalized.title, 'Group titles');
  if (parsed) {
    assertUniqueId(parsed, normalized.id, currentId);
    if (normalized.parentId && (normalized.parentId === normalized.id || !parsed.groups.some((candidate) => candidate.id === normalized.parentId))) throw new Error('Groups can only belong to another existing group.');
    const groups = currentId
      ? parsed.groups.map((candidate) => candidate.id === currentId
        ? normalized
        : candidate.parentId === currentId && normalized.id !== currentId
          ? { ...candidate, parentId: normalized.id }
          : candidate)
      : [...parsed.groups, normalized];
    assertAcyclicGroupContainment(groups);
  } else if (normalized.parentId) throw new Error('Create the parent group before adding a nested group.');
  return normalized;
}

function assertAcyclicGroupContainment(groups: readonly Pick<ArchitectureGroup, 'id' | 'parentId'>[]): void {
  const byId = new Map(groups.map((group) => [group.id, group]));
  for (const group of groups) {
    const visited = new Set<string>();
    let current: Pick<ArchitectureGroup, 'id' | 'parentId'> | undefined = group;
    while (current?.parentId) {
      if (visited.has(current.id)) throw new Error('Architecture group containment cannot form a cycle.');
      visited.add(current.id);
      current = byId.get(current.parentId);
    }
  }
}

function normalizeService(service: ArchitectureService, parsed: ParsedArchitecture, currentId?: string): ArchitectureService {
  const normalized = { icon: cleanOptional(service.icon), iconText: cleanOptional(service.iconText), id: cleanId(service.id), parentId: cleanOptionalId(service.parentId), title: cleanOptional(service.title) };
  assertIcon(normalized.icon); assertText(normalized.title, 'Service titles');
  if (normalized.iconText) throw new Error('Quoted service icon text is not supported by Mermaid rendering.');
  assertUniqueId(parsed, normalized.id, currentId);
  if (normalized.parentId && !parsed.groups.some((candidate) => candidate.id === normalized.parentId)) throw new Error('Services can only belong to an existing group.');
  return normalized;
}

function normalizeServiceForEmpty(service: ArchitectureService): ArchitectureService {
  const normalized = { icon: cleanOptional(service.icon), iconText: cleanOptional(service.iconText), id: cleanId(service.id), parentId: cleanOptionalId(service.parentId), title: cleanOptional(service.title) };
  assertIcon(normalized.icon); assertText(normalized.title, 'Service titles');
  if (normalized.iconText) throw new Error('Quoted service icon text is not supported by Mermaid rendering.');
  if (normalized.parentId) throw new Error('Create the parent group before adding a nested service.');
  return normalized;
}

function normalizeJunction(junction: ArchitectureJunction, parsed: ParsedArchitecture, currentId?: string): ArchitectureJunction {
  const normalized = { id: cleanId(junction.id), parentId: cleanOptionalId(junction.parentId) };
  assertUniqueId(parsed, normalized.id, currentId);
  if (normalized.parentId && !parsed.groups.some((candidate) => candidate.id === normalized.parentId)) throw new Error('Junctions can only belong to an existing group.');
  return normalized;
}

function normalizeJunctionForEmpty(junction: ArchitectureJunction): ArchitectureJunction {
  const normalized = { id: cleanId(junction.id), parentId: cleanOptionalId(junction.parentId) };
  if (normalized.parentId) throw new Error('Create the parent group before adding a nested junction.');
  return normalized;
}

function normalizeEdge(edge: ArchitectureEdge, parsed: ParsedArchitecture): ArchitectureEdge {
  const normalized: ArchitectureEdge = {
    from: cleanId(edge.from), fromGroup: Boolean(edge.fromGroup), fromInto: Boolean(edge.fromInto), fromPort: normalizePort(edge.fromPort),
    to: cleanId(edge.to), toGroup: Boolean(edge.toGroup), toInto: Boolean(edge.toInto), toPort: normalizePort(edge.toPort),
  };
  validateEdge(normalized, new Set(getAllIds(parsed)), new Set(parsed.groups.map((group) => group.id)));
  return normalized;
}

function normalizeAlignment(alignment: ArchitectureAlignment, parsed: ParsedArchitecture): ArchitectureAlignment {
  const direction = alignment.direction;
  const members = alignment.members.map(cleanId);
  if (direction !== 'row' && direction !== 'column') throw new Error('Architecture alignments must be rows or columns.');
  if (members.length < 2 || new Set(members).size !== members.length) throw new Error('Architecture alignments need at least two distinct members.');
  validateAlignment({ direction, members }, new Set(getAllIds(parsed)));
  return { direction, members };
}

function validateEdge(edge: ArchitectureEdge, ids: ReadonlySet<string>, groupIds: ReadonlySet<string>): void {
  if (!ids.has(edge.from) || !ids.has(edge.to)) throw new Error('Architecture edges require existing endpoints.');
  if (edge.fromGroup !== groupIds.has(edge.from) || edge.toGroup !== groupIds.has(edge.to)) throw new Error('Architecture group edge markers must match group endpoints.');
  normalizePort(edge.fromPort); normalizePort(edge.toPort);
}

function validateAlignment(alignment: ArchitectureAlignment, ids: ReadonlySet<string>): void {
  if ((alignment.direction !== 'row' && alignment.direction !== 'column') || alignment.members.length < 2 || new Set(alignment.members).size !== alignment.members.length || alignment.members.some((id) => !ids.has(id))) throw new Error('Architecture alignments need distinct existing members.');
}

function findGroup(parsed: ParsedArchitecture, id: string): ArchitectureGroupRecord { const entry = parsed.groups.find((group) => group.id === id); if (!entry) throw new Error(`Architecture group ${id} no longer exists.`); return entry; }
function findService(parsed: ParsedArchitecture, id: string): ArchitectureServiceRecord { const entry = parsed.services.find((service) => service.id === id); if (!entry) throw new Error(`Architecture service ${id} no longer exists.`); return entry; }
function findJunction(parsed: ParsedArchitecture, id: string): ArchitectureJunctionRecord { const entry = parsed.junctions.find((junction) => junction.id === id); if (!entry) throw new Error(`Architecture junction ${id} no longer exists.`); return entry; }
function getAllIds(parsed: ParsedArchitecture): string[] { return [...parsed.groups, ...parsed.services, ...parsed.junctions].map((node) => node.id); }
function assertUniqueId(parsed: ParsedArchitecture, id: string, currentId?: string): void { if (getAllIds(parsed).some((candidate) => candidate === id && candidate !== currentId)) throw new Error(`An architecture item named ${id} already exists.`); }
function assertId(id: string): void { if (!ID.test(id)) throw new Error('Architecture ids must be Mermaid-safe identifiers.'); }
function cleanId(value: string): string { const id = value.trim().replace(/[^A-Za-z0-9_-]/g, '_').replace(/^[^A-Za-z_]+/, ''); assertId(id); return id; }
function cleanOptionalId(value: string | undefined): string | undefined { if (!value?.trim()) return undefined; return cleanId(value); }
function cleanOptional(value: string | undefined): string | undefined { const text = value?.trim(); return text || undefined; }
function assertIcon(icon: string | undefined): void { if (icon !== undefined && !ICON.test(icon)) throw new Error('Architecture icons must be Mermaid icon identifiers.'); }
function assertText(value: string | undefined, name: string): void { if (value !== undefined && (!value || /[\r\n\[\]\(\)]/.test(value))) throw new Error(`${name} must be single-line Mermaid text.`); }
function normalizePort(port: ArchitecturePort): ArchitecturePort { const value = String(port).toUpperCase() as ArchitecturePort; if (!PORTS.has(value)) throw new Error('Architecture edge ports must be L, R, T, or B.'); return value; }
function asPort(value: string): ArchitecturePort { return normalizePort(value as ArchitecturePort); }

function publicEdge({ from, fromGroup, fromInto, fromPort, to, toGroup, toInto, toPort }: ArchitectureEdgeRecord): ArchitectureEdge { return { from, fromGroup, fromInto, fromPort, to, toGroup, toInto, toPort }; }
function publicAlignment(alignment: ArchitectureAlignment): ArchitectureAlignment { return { direction: alignment.direction, members: [...alignment.members] }; }
function sameEdge(left: ArchitectureEdge, right: ArchitectureEdge): boolean { return left.from === right.from && left.fromGroup === right.fromGroup && left.fromInto === right.fromInto && left.fromPort === right.fromPort && left.to === right.to && left.toGroup === right.toGroup && left.toInto === right.toInto && left.toPort === right.toPort; }
function sameAlignment(left: ArchitectureAlignment, right: ArchitectureAlignment): boolean { return left.direction === right.direction && left.members.length === right.members.length && left.members.every((member, index) => member === right.members[index]); }
function resolveEdge(edges: readonly ArchitectureEdgeRecord[], identity: ArchitectureEdgeIdentity): ArchitectureEdgeRecord { const matches = edges.filter((edge) => sameEdge(edge, identity)); if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw new Error('Architecture edge changed remotely and can no longer be resolved safely.'); return matches[0]; }
function resolveAlignment(alignments: readonly ArchitectureAlignmentRecord[], identity: ArchitectureAlignmentIdentity): ArchitectureAlignmentRecord { const matches = alignments.filter((alignment) => sameAlignment(alignment, identity)); if (identity.occurrenceCount !== 1 || matches.length !== 1 || !matches[0]) throw new Error('Architecture alignment changed remotely and can no longer be resolved safely.'); return matches[0]; }

function renameReferences(source: string, parsed: ParsedArchitecture, previousId: string, nextId: string): Replacement[] {
  return [
    ...parsed.groups.filter((item) => item.parentId === previousId).map((item) => ({ range: item.range, value: statementReplacement(source, item.range, formatGroup({ ...item, parentId: nextId })) })),
    ...parsed.services.filter((item) => item.parentId === previousId).map((item) => ({ range: item.range, value: statementReplacement(source, item.range, formatService({ ...item, parentId: nextId })) })),
    ...parsed.junctions.filter((item) => item.parentId === previousId).map((item) => ({ range: item.range, value: statementReplacement(source, item.range, formatJunction({ ...item, parentId: nextId })) })),
    ...parsed.edges.filter((item) => item.from === previousId || item.to === previousId).map((item) => ({ range: item.range, value: statementReplacement(source, item.range, formatEdge({ ...item, from: item.from === previousId ? nextId : item.from, to: item.to === previousId ? nextId : item.to })) })),
    ...parsed.alignments.filter((item) => item.members.includes(previousId)).map((item) => ({ range: item.range, value: statementReplacement(source, item.range, formatAlignment({ ...item, members: item.members.map((member) => member === previousId ? nextId : member) })) })),
  ];
}

function removeNodeAndReferences(source: string, parsed: ParsedArchitecture, nodeRange: SourceRange, id: string): string {
  const ranges = [nodeRange, ...parsed.edges.filter((edge) => edge.from === id || edge.to === id).map((edge) => edge.range), ...parsed.alignments.filter((alignment) => alignment.members.includes(id)).map((alignment) => alignment.range)];
  return replaceValues(source, ranges.map((range) => ({ range, value: '' })));
}

function formatGroup(group: ArchitectureGroup): string { return `group ${group.id}${group.icon ? `(${group.icon})` : ''}${group.title ? `[${group.title}]` : ''}${group.parentId ? ` in ${group.parentId}` : ''}`; }
function formatService(service: ArchitectureService): string { return `service ${service.id}${service.icon ? `(${service.icon})` : ''}${service.title ? `[${service.title}]` : ''}${service.parentId ? ` in ${service.parentId}` : ''}`; }
function formatJunction(junction: ArchitectureJunction): string { return `junction ${junction.id}${junction.parentId ? ` in ${junction.parentId}` : ''}`; }
function formatEdge(edge: ArchitectureEdge): string { return `${edge.from}${edge.fromGroup ? '{group}' : ''}:${edge.fromPort}${edge.fromInto ? '<' : ''} --${edge.toInto ? '>' : ''} ${edge.toPort}:${edge.to}${edge.toGroup ? '{group}' : ''}`; }
function formatAlignment(alignment: ArchitectureAlignment): string { return `align ${alignment.direction} ${alignment.members.join(' ')}`; }

function statementReplacement(source: string, range: SourceRange, statement: string): string { const ending = source.slice(range.start, range.end).match(/(\r\n|\n|\r)$/)?.[0] ?? ''; return `${statement}${ending}`; }
interface Replacement { range: SourceRange; value: string; }
function replaceValues(source: string, replacements: readonly Replacement[]): string { return [...replacements].sort((left, right) => right.range.start - left.range.start).reduce((next, replacement) => `${next.slice(0, replacement.range.start)}${replacement.value}${next.slice(replacement.range.end)}`, source); }
function append(source: string, statement: string): string { const ending = source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'; return `${source}${source && !/(?:\r\n|\n|\r)$/.test(source) ? ending : ''}${statement}`; }
function indentationForAppend(source: string): string { const statement = source.split(/\r\n|\n|\r/).find((line) => /^\s*(?:group\s+[A-Za-z_]|service\s+[A-Za-z_]|junction\s+[A-Za-z_]|align\s+(?:row|column)\s+|[A-Za-z_][A-Za-z0-9_-]*(?:\{group\})?:[BLRT])/i.test(line)); return statement?.match(/^\s*/)?.[0] ?? '  '; }

/** Keep comments/frontmatter byte-aligned so Langium CST offsets target the original Y.Text. */
function maskNonArchitectureText(source: string): string {
  const lines = source.match(/.*?(?:\r\n|\n|\r|$)/g) ?? [];
  let inFrontmatter = false;
  return lines.map((raw, index) => {
    const text = raw.replace(/\r\n|\n|\r$/, '');
    const isDelimiter = text.trim() === '---';
    if (index === 0 && isDelimiter) { inFrontmatter = true; return mask(raw); }
    if (inFrontmatter) { if (isDelimiter) inFrontmatter = false; return mask(raw); }
    return /^\s*%%/.test(text) ? mask(raw) : raw;
  }).join('');
}
function mask(raw: string): string { return raw.replace(/[^\r\n]/g, ' '); }
