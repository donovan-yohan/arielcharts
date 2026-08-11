export type EventModelingEntityType = 'cmd' | 'command' | 'evt' | 'event' | 'pcr' | 'processor' | 'readmodel' | 'rmo' | 'ui';
export type EventModelingFrameKind = 'resetframe' | 'rf' | 'tf' | 'timeframe';
export type EventModelingDataType = 'figma' | 'html' | 'json' | 'jsobj' | 'md' | 'salt' | 'text' | 'uri';

export interface EventModelingTimeframe { dataId?: string; entity: string; entityType: EventModelingEntityType; index: string; kind: EventModelingFrameKind; links: string[]; namespace?: string; }
export interface EventModelingDataBlock { dataType?: EventModelingDataType; name: string; payload: string; }
export interface EventModelingDiagramSnapshot { dataBlocks: EventModelingDataBlock[]; entities: { name: string; namespace?: string }[]; timeframes: EventModelingTimeframe[]; }

interface Line { end: number; raw: string; start: number; text: string; }
interface FrameRecord extends EventModelingTimeframe { line: Line; }
interface DataRecord extends EventModelingDataBlock { close: Line; open: Line; }
interface Parsed { dataBlocks: DataRecord[]; entities: { line: Line; name: string; namespace?: string }[]; frames: FrameRecord[]; }

const HEADER = /^\s*eventmodeling\s*$/i;
const ID = '[A-Za-z_][A-Za-z0-9_]*';
const QUALIFIED = `${ID}(?:\\.${ID})?`;
const TYPES = 'rmo|readmodel|ui|cmd|command|evt|event|pcr|processor';
const FRAME = new RegExp(`^\\s*(tf|timeframe|rf|resetframe)\\s+(\\d{1,3})\\s+(${TYPES})\\s+(${QUALIFIED})(.*)$`, 'i');
const ENTITY = new RegExp(`^\\s*entity\\s+(${QUALIFIED})\\s*$`, 'i');
const DATA_OPEN = new RegExp(`^\\s*data\\s+(${ID})(?:\\s+\\\`(json|jsobj|figma|salt|uri|md|html|text)\\\`\\{|\\s+\\{)\\s*$`, 'i');
const LINK = /^\s*(?:->>\s*(\d{1,3})\s*)*/;

export function isEventModelingDiagramSource(source: string): boolean { return parseEventModeling(source) !== null; }
export function isEventModelingSourceRepresentable(source: string): boolean { return parseEventModeling(source) !== null; }
export function getEventModelingDiagramSnapshot(source: string): EventModelingDiagramSnapshot {
  const parsed = requireEventModeling(source);
  return { timeframes: parsed.frames.map(publicFrame), entities: parsed.entities.map(({ name, namespace }) => ({ name, ...(namespace ? { namespace } : {}) })), dataBlocks: parsed.dataBlocks.map(({ dataType, name, payload }) => ({ name, payload, ...(dataType ? { dataType } : {}) })) };
}

export function addEventModelingTimeframe(source: string, timeframe: EventModelingTimeframe): string {
  const value = normalizeFrame(timeframe); if (!source.trim()) return `eventmodeling\n  ${formatFrame(value)}`;
  const parsed = requireEventModeling(source); if (parsed.frames.some((frame) => frame.index === value.index)) throw new Error(`A timeframe named ${value.index} already exists.`);
  return appendAndValidate(source, `  ${formatFrame(value)}`);
}
export function editEventModelingTimeframe(source: string, index: string, patch: Partial<EventModelingTimeframe> & { index?: string }): string {
  const parsed = requireEventModeling(source); const current = findFrame(parsed, index); const value = normalizeFrame({ ...current, ...patch, links: patch.links ?? current.links, index: patch.index ?? current.index });
  if (value.index !== current.index && parsed.frames.some((frame) => frame.index === value.index)) throw new Error(`A timeframe named ${value.index} already exists.`);
  let next = replaceLine(source, current.line, `${indent(current.line)}${formatFrame(value)}`);
  if (value.index !== current.index) next = replaceFrameLinks(next, current.index, value.index);
  return requireEventModeling(next), next;
}
export function deleteEventModelingTimeframe(source: string, index: string): string {
  const parsed = requireEventModeling(source); const current = findFrame(parsed, index); if (parsed.frames.some((frame) => frame.links.includes(current.index))) throw new Error('Remove links to this timeframe before deleting it.');
  const next = `${source.slice(0, current.line.start)}${source.slice(current.line.end)}`; return requireEventModeling(next), next;
}
/** Moves one whole timeframe statement; inferred Mermaid layout remains renderer-owned. */
export function moveEventModelingTimeframe(source: string, index: string, targetIndex: number): string {
  const parsed = requireEventModeling(source); const current = findFrame(parsed, index); if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= parsed.frames.length) throw new Error('Timeframe position is out of range.');
  const from = parsed.frames.indexOf(current); if (from === targetIndex) return source;
  // The UI only offers one-place moves. Swapping statement text keeps every
  // physical line terminator where it was, including mixed and no-final input.
  if (Math.abs(from - targetIndex) !== 1) throw new Error('Timeframes can move one position at a time.');
  const other = parsed.frames[targetIndex]!; const next = swapLineText(source, current.line, other.line);
  return requireEventModeling(next), next;
}
export function addEventModelingEntity(source: string, identifier: string): string {
  const normalized = normalizeQualified(identifier, 'Event Modeling entity'); if (!source.trim()) return `eventmodeling\n  entity ${normalized}`; const parsed = requireEventModeling(source);
  if (parsed.entities.some((entity) => entity.name === normalized)) throw new Error(`An entity named ${normalized} already exists.`); return appendAndValidate(source, `  entity ${normalized}`);
}
export function renameEventModelingEntity(source: string, identifier: string, nextIdentifier: string): string {
  const parsed = requireEventModeling(source); const current = parsed.entities.find((entity) => entity.name === identifier); if (!current) throw new Error(`Entity ${identifier} no longer exists.`); const next = normalizeQualified(nextIdentifier, 'Event Modeling entity');
  if (next !== current.name && parsed.entities.some((entity) => entity.name === next)) throw new Error(`An entity named ${next} already exists.`);
  const replacements = [{ line: current.line, value: `${indent(current.line)}entity ${next}` }, ...parsed.frames.filter((frame) => frame.entity === current.name).map((frame) => ({ line: frame.line, value: `${indent(frame.line)}${formatFrame({ ...frame, entity: next, namespace: namespaceOf(next) })}` }))];
  const result = replaceLines(source, replacements); return requireEventModeling(result), result;
}
export function deleteEventModelingEntity(source: string, identifier: string): string {
  const parsed = requireEventModeling(source); const current = parsed.entities.find((entity) => entity.name === identifier); if (!current) throw new Error(`Entity ${identifier} no longer exists.`); if (parsed.frames.some((frame) => frame.entity === current.name)) throw new Error('Move or rename the entity timeframes before deleting it.');
  const next = `${source.slice(0, current.line.start)}${source.slice(current.line.end)}`; return requireEventModeling(next), next;
}
export function addEventModelingDataBlock(source: string, data: EventModelingDataBlock): string {
  const value = normalizeData(data); if (!source.trim()) return `eventmodeling\n${formatData(value, '  ', '\n')}`; const parsed = requireEventModeling(source); if (parsed.dataBlocks.some((item) => item.name === value.name)) throw new Error(`A data block named ${value.name} already exists.`); return appendAndValidate(source, formatData(value, '  ', lineEnding(source)));
}
/** Payload is intentionally literal text: formatting, whitespace, and line endings are never normalized. */
export function editEventModelingDataBlock(source: string, name: string, patch: Partial<EventModelingDataBlock> & { name?: string }): string {
  const parsed = requireEventModeling(source); const current = findData(parsed, name); const value = normalizeData({ ...current, ...patch, name: patch.name ?? current.name, payload: patch.payload ?? current.payload });
  if (value.name !== current.name && parsed.dataBlocks.some((item) => item.name === value.name)) throw new Error(`A data block named ${value.name} already exists.`);
  // Existing payload source is opaque. A rename/type edit therefore replaces
  // only the opening declaration line; supplied replacement payloads are new
  // source and use the document's preferred ending.
  let next = patch.payload === undefined
    ? replaceLine(source, current.open, formatDataOpen(value, indent(current.open)))
    : `${source.slice(0, current.open.start)}${formatData(value, indent(current.open), lineEnding(source))}${current.close.raw.slice(current.close.text.length)}${source.slice(current.close.end)}`;
  if (value.name !== current.name) next = replaceDataReferences(next, current.name, value.name); return requireEventModeling(next), next;
}
export function deleteEventModelingDataBlock(source: string, name: string): string {
  const parsed = requireEventModeling(source); const current = findData(parsed, name); if (parsed.frames.some((frame) => frame.dataId === name)) throw new Error('Remove timeframe references before deleting this data block.'); const next = `${source.slice(0, current.open.start)}${source.slice(current.close.end)}`; return requireEventModeling(next), next;
}

function parseEventModeling(source: string): Parsed | null {
  const lines = splitLines(source); const headerIndex = firstStatement(lines); if (!HEADER.test(lines[headerIndex]?.text.replace(/^\uFEFF/, '') ?? '')) return null;
  const frames: FrameRecord[] = []; const entities: Parsed['entities'] = []; const dataBlocks: DataRecord[] = [];
  for (let index = headerIndex + 1; index < lines.length; index += 1) {
    const line = lines[index]!; if (!line.text.trim() || ignorable(line.text)) continue;
    const entity = line.text.match(ENTITY); if (entity) { const name = entity[1]!; if (entities.some((item) => item.name === name)) return null; entities.push({ line, name, namespace: namespaceOf(name) }); continue; }
    const frame = parseFrame(line); if (frame) { frames.push(frame); continue; }
    const data = line.text.match(DATA_OPEN); if (data) { const closeIndex = lines.findIndex((candidate, candidateIndex) => candidateIndex > index && candidate.text === '}'); if (closeIndex < 0) return null; const close = lines[closeIndex]!; const payload = source.slice(line.end, close.start); dataBlocks.push({ name: data[1]!, payload, ...(data[2] ? { dataType: data[2]!.toLowerCase() as EventModelingDataType } : {}), open: line, close }); index = closeIndex; continue; }
    return null;
  }
  const parsed = { frames, entities, dataBlocks }; try { validate(parsed); return parsed; } catch { return null; }
}
function parseFrame(line: Line): FrameRecord | null {
  const match = line.text.match(FRAME); if (!match) return null; const tail = match[5]!; const refs = [...tail.matchAll(/->>\s*(\d{1,3})/g)].map((entry) => entry[1]!); const stripped = tail.replace(/->>\s*\d{1,3}/g, '').trim(); const data = stripped.match(/^\[\[([A-Za-z_][A-Za-z0-9_]*)\]\]$/); if (stripped && !data) return null;
  const entity = match[4]!; return { kind: match[1]!.toLowerCase() as EventModelingFrameKind, index: match[2]!, entityType: match[3]!.toLowerCase() as EventModelingEntityType, entity, namespace: namespaceOf(entity), links: refs, ...(data ? { dataId: data[1]! } : {}), line };
}
function validate(parsed: Parsed): void { const indices = new Set<string>(); for (const frame of parsed.frames) { if (indices.has(frame.index)) throw new Error('Timeframe indices must be unique.'); indices.add(frame.index); } for (const frame of parsed.frames) { if (frame.links.some((link) => !indices.has(link) || link === frame.index)) throw new Error('Timeframe links must refer to another timeframe.'); if (frame.dataId && !parsed.dataBlocks.some((data) => data.name === frame.dataId)) throw new Error('Unknown timeframe data block.'); } if (new Set(parsed.dataBlocks.map((data) => data.name)).size !== parsed.dataBlocks.length) throw new Error('Data block names must be unique.'); }
function requireEventModeling(source: string): Parsed { const parsed = parseEventModeling(source); if (!parsed) throw new Error('This source is not a safely representable Event Modeling diagram.'); return parsed; }
function findFrame(parsed: Parsed, index: string): FrameRecord { const frame = parsed.frames.find((item) => item.index === index); if (!frame) throw new Error(`Timeframe ${index} no longer exists.`); return frame; } function findData(parsed: Parsed, name: string): DataRecord { const data = parsed.dataBlocks.find((item) => item.name === name); if (!data) throw new Error(`Data block ${name} no longer exists.`); return data; }
function publicFrame(frame: FrameRecord): EventModelingTimeframe { return { kind: frame.kind, index: frame.index, entityType: frame.entityType, entity: frame.entity, links: [...frame.links], ...(frame.namespace ? { namespace: frame.namespace } : {}), ...(frame.dataId ? { dataId: frame.dataId } : {}) }; }
function normalizeFrame(value: EventModelingTimeframe): EventModelingTimeframe { const index = value.index.trim(); if (!/^\d{1,3}$/.test(index)) throw new Error('Event Modeling timeframe indices must contain one to three digits.'); const entity = normalizeQualified(value.entity, 'Event Modeling entity'); if (!TYPES.split('|').includes(value.entityType)) throw new Error('Unsupported Event Modeling entity type.'); const kind = value.kind; if (!['tf', 'timeframe', 'rf', 'resetframe'].includes(kind)) throw new Error('Unsupported Event Modeling frame type.'); const links = value.links.map((link) => { const item = link.trim(); if (!/^\d{1,3}$/.test(item) || item === index) throw new Error('Timeframe links must be other valid indices.'); return item; }); if (new Set(links).size !== links.length) throw new Error('Timeframe links must be unique.'); return { kind, index, entityType: value.entityType, entity, links, namespace: namespaceOf(entity), ...(value.dataId ? { dataId: normalizeId(value.dataId, 'Data block identifiers') } : {}) }; }
function normalizeData(value: EventModelingDataBlock): EventModelingDataBlock { const payload = value.payload; if (!payload || !/(?:^|\r?\n|\r)\s*$/.test(payload)) throw new Error('Event Modeling data block payloads must retain a closing line break.'); if (/^\s*}\s*$/m.test(payload)) throw new Error('Data payload cannot contain a standalone closing brace line.'); if (value.dataType && !['json', 'jsobj', 'figma', 'salt', 'uri', 'md', 'html', 'text'].includes(value.dataType)) throw new Error('Unsupported Event Modeling data type.'); return { name: normalizeId(value.name, 'Data block identifiers'), payload, ...(value.dataType ? { dataType: value.dataType } : {}) }; }
function formatFrame(value: EventModelingTimeframe): string { return `${value.kind} ${value.index} ${value.entityType} ${value.entity}${value.links.map((link) => ` ->> ${link}`).join('')}${value.dataId ? ` [[${value.dataId}]]` : ''}`; }
function formatDataOpen(value: EventModelingDataBlock, indentation: string): string { return `${indentation}data ${value.name}${value.dataType ? ` \`${value.dataType}\`` : ' '}{`; }
function formatData(value: EventModelingDataBlock, indentation: string, ending: string): string { const payload = value.payload.replace(/\r\n|\n|\r/g, ending); return `${formatDataOpen(value, indentation)}${ending}${payload}}`; }
function replaceFrameLinks(source: string, from: string, to: string): string { const parsed = requireEventModeling(source); return replaceLines(source, parsed.frames.filter((frame) => frame.links.includes(from)).map((frame) => ({ line: frame.line, value: `${indent(frame.line)}${formatFrame({ ...frame, links: frame.links.map((link) => link === from ? to : link) })}` }))); }
function replaceDataReferences(source: string, from: string, to: string): string { const parsed = requireEventModeling(source); return replaceLines(source, parsed.frames.filter((frame) => frame.dataId === from).map((frame) => ({ line: frame.line, value: `${indent(frame.line)}${formatFrame({ ...frame, dataId: to })}` }))); }
function normalizeQualified(value: string, noun: string): string { const result = value.trim(); if (!new RegExp(`^${QUALIFIED}$`).test(result)) throw new Error(`${noun} must be a Mermaid-safe identifier or namespace.identifier.`); return result; } function normalizeId(value: string, noun: string): string { const result = value.trim(); if (!new RegExp(`^${ID}$`).test(result)) throw new Error(`${noun} must be Mermaid-safe identifiers.`); return result; } function namespaceOf(value: string): string | undefined { return value.includes('.') ? value.split('.')[0] : undefined; }
function splitLines(source: string): Line[] { const lines: Line[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; lines.push({ start: match.index, end: match.index + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; } function firstStatement(lines: readonly Line[]): number { let index = 0; if (lines[0]?.text.replace(/^\uFEFF/, '').trim() === '---') { const close = lines.findIndex((line, candidate) => candidate > 0 && line.text.trim() === '---'); index = close < 0 ? lines.length : close + 1; } while (index < lines.length && (!lines[index]!.text.trim() || ignorable(lines[index]!.text))) index += 1; return index; } function ignorable(text: string): boolean { return /^\s*%%/.test(text); } function indent(line: Line): string { return line.text.match(/^\s*/)?.[0] ?? ''; } function lineEnding(source: string): string { return source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'; }
function append(source: string, statement: string): string { const ending = lineEnding(source); return `${source}${source && !/(?:\r\n|\n|\r)$/.test(source) ? ending : ''}${statement}`; } function appendAndValidate(source: string, statement: string): string { const next = append(source, statement); return requireEventModeling(next), next; } function replaceLine(source: string, line: Line, value: string): string { return `${source.slice(0, line.start)}${value}${line.raw.slice(line.text.length)}${source.slice(line.end)}`; } function replaceLines(source: string, values: readonly { line: Line; value: string }[]): string { return [...values].sort((left, right) => right.line.start - left.line.start).reduce((next, item) => replaceLine(next, item.line, item.value), source); }
function swapLineText(source: string, left: Line, right: Line): string { const first = left.start < right.start ? left : right; const second = first === left ? right : left; const firstEnding = first.raw.slice(first.text.length); const secondEnding = second.raw.slice(second.text.length); return `${source.slice(0, first.start)}${second.text}${firstEnding}${source.slice(first.end, second.start)}${first.text}${secondEnding}${source.slice(second.end)}`; }
