export type SwimlaneDirection = 'BT' | 'LR' | 'RL' | 'TB' | 'TD';
export interface Swimlane { id: string; label: string; }
export interface SwimlaneNode { id: string; label: string; laneId: string; }
export interface SwimlaneHandoff { from: string; label?: string; to: string; }
export interface SwimlaneHandoffIdentity extends SwimlaneHandoff { index: number; occurrenceCount: number; }
export interface SwimlaneDiagramSnapshot { direction: SwimlaneDirection; handoffs: SwimlaneHandoff[]; lanes: Swimlane[]; nodes: SwimlaneNode[]; }

interface Line { end: number; raw: string; start: number; text: string; }
interface LaneRecord extends Swimlane { close: Line; line: Line; }
interface NodeRecord extends SwimlaneNode { line: Line; }
interface HandoffRecord extends SwimlaneHandoff { line: Line; }
interface Parsed { direction: SwimlaneDirection; handoffs: HandoffRecord[]; lanes: LaneRecord[]; nodes: NodeRecord[]; }

const HEADER = /^\s*swimlane-beta(?:\s+(TB|TD|BT|LR|RL))?\s*$/i;
const ID = '[A-Za-z_][A-Za-z0-9_-]*';
const idPattern = new RegExp(`^${ID}$`);
const LANE_WITH_LABEL = new RegExp(`^\\s*subgraph\\s+(${ID})\\s*\\[([^\\]\\r\\n]+)\\]\\s*$`, 'i');
const LANE = new RegExp(`^\\s*subgraph\\s+(${ID})\\s*$`, 'i');
const NODE = new RegExp(`^\\s*(${ID})\\s*\\[([^\\]\\r\\n]+)\\]\\s*$`);
const HANDOFF = new RegExp(`^\\s*(${ID})\\s*-->(?:\\|([^|\\r\\n]+)\\|)?\\s*(${ID})\\s*$`);

export function isSwimlaneDiagramSource(source: string): boolean { return parseSwimlane(source) !== null; }
export function isSwimlaneSourceRepresentable(source: string): boolean { return parseSwimlane(source) !== null; }
export function getSwimlaneDiagramSnapshot(source: string): SwimlaneDiagramSnapshot { const parsed = requireSwimlane(source); return { direction: parsed.direction, lanes: parsed.lanes.map(({ id, label }) => ({ id, label })), nodes: parsed.nodes.map(({ id, label, laneId }) => ({ id, label, laneId })), handoffs: parsed.handoffs.map(({ from, to, label }) => ({ from, to, ...(label ? { label } : {}) })) }; }

export function addSwimlane(source: string, lane: Swimlane): string { const normalized = normalizeLane(lane); if (!source.trim()) return `swimlane-beta\n  subgraph ${normalized.id} [${normalized.label}]\n  end`; const parsed = requireSwimlane(source); const id = uniqueId(normalized.id, parsed.lanes.map((entry) => entry.id)); return append(source, `  subgraph ${id} [${normalized.label}]\n  end`); }
export function editSwimlane(source: string, id: string, patch: Partial<Swimlane>): string { const parsed = requireSwimlane(source); const current = findLane(parsed, id); const next = normalizeLane({ ...current, ...patch }); if (next.id !== id && parsed.lanes.some((lane) => lane.id === next.id)) throw new Error(`A swimlane named ${next.id} already exists.`); return replace(source, current.line, `${indent(current.line)}subgraph ${next.id} [${next.label}]`); }
export function deleteSwimlane(source: string, id: string): string { const parsed = requireSwimlane(source); const lane = findLane(parsed, id); const nodeIds = new Set(parsed.nodes.filter((node) => node.laneId === id).map((node) => node.id)); return deleteLines(source, [{ start: lane.line.start, end: lane.close.end, raw: '', text: '' }, ...parsed.handoffs.filter((handoff) => nodeIds.has(handoff.from) || nodeIds.has(handoff.to)).map((handoff) => handoff.line)]); }
export function addSwimlaneNode(source: string, node: SwimlaneNode): string { const parsed = requireSwimlane(source); const next = normalizeNode(node); const lane = findLane(parsed, next.laneId); const id = uniqueId(next.id, parsed.nodes.map((entry) => entry.id)); return `${source.slice(0, lane.close.start)}${indent(lane.line)}  ${id}[${next.label}]${lineEnding(source)}${source.slice(lane.close.start)}`; }
export function editSwimlaneNode(source: string, id: string, patch: Partial<Pick<SwimlaneNode, 'id' | 'label'>>): string { const parsed = requireSwimlane(source); const current = findNode(parsed, id); const next = normalizeNode({ ...current, ...patch }); if (next.id !== id && parsed.nodes.some((node) => node.id === next.id)) throw new Error(`A swimlane node named ${next.id} already exists.`); return replaceValues(source, [{ line: current.line, value: `${indent(current.line)}${next.id}[${next.label}]` }, ...parsed.handoffs.filter((handoff) => next.id !== id && (handoff.from === id || handoff.to === id)).map((handoff) => ({ line: handoff.line, value: `${indent(handoff.line)}${formatHandoff({ ...handoff, from: handoff.from === id ? next.id : handoff.from, to: handoff.to === id ? next.id : handoff.to })}` }))]); }
export function deleteSwimlaneNode(source: string, id: string): string { const parsed = requireSwimlane(source); const node = findNode(parsed, id); return deleteLines(source, [node.line, ...parsed.handoffs.filter((handoff) => handoff.from === id || handoff.to === id).map((handoff) => handoff.line)]); }
export function addSwimlaneHandoff(source: string, handoff: SwimlaneHandoff): string { const parsed = requireSwimlane(source); const next = normalizeHandoff(handoff); assertEndpoints(parsed, next); if (parsed.handoffs.some((entry) => sameHandoff(entry, next))) throw new Error('An identical swimlane handoff already exists.'); return append(source, `  ${formatHandoff(next)}`); }
export function getSwimlaneHandoffIdentity(handoff: SwimlaneHandoff, index: number, handoffs: readonly SwimlaneHandoff[] = []): SwimlaneHandoffIdentity { return { ...handoff, index, occurrenceCount: handoffs.length ? handoffs.filter((entry) => sameHandoff(entry, handoff)).length : 1 }; }
export function resolveSwimlaneHandoffIndex(handoffs: readonly SwimlaneHandoff[], identity: SwimlaneHandoffIdentity): number { if (identity.occurrenceCount !== 1) throw stale(); const matches = handoffs.map((handoff, index) => ({ index, handoff })).filter(({ handoff }) => sameHandoff(handoff, identity)); if (matches.length !== 1 || !matches[0]) throw stale(); return matches[0].index; }
export function editSwimlaneHandoff(source: string, identity: SwimlaneHandoffIdentity, patch: Partial<SwimlaneHandoff>): string { const parsed = requireSwimlane(source); const current = parsed.handoffs[resolveSwimlaneHandoffIndex(parsed.handoffs, identity)]; if (!current) throw stale(); const next = normalizeHandoff({ ...current, ...patch }); assertEndpoints(parsed, next); if (!sameHandoff(current, next) && parsed.handoffs.some((entry) => sameHandoff(entry, next))) throw new Error('An identical swimlane handoff already exists.'); return replace(source, current.line, `${indent(current.line)}${formatHandoff(next)}`); }
export function deleteSwimlaneHandoff(source: string, identity: SwimlaneHandoffIdentity): string { const parsed = requireSwimlane(source); const current = parsed.handoffs[resolveSwimlaneHandoffIndex(parsed.handoffs, identity)]; if (!current) throw stale(); return deleteLines(source, [current.line]); }

function parseSwimlane(source: string): Parsed | null {
  const lines = splitLines(source); const headerIndex = statementIndex(lines); const header = lines[headerIndex]?.text.match(HEADER); if (!header) return null; const direction = (header[1]?.toUpperCase() as SwimlaneDirection | undefined) ?? 'TB';
  const lanes: LaneRecord[] = []; const nodes: NodeRecord[] = []; const handoffs: HandoffRecord[] = []; let active: { id: string; label: string; line: Line } | null = null;
  for (let index = headerIndex + 1; index < lines.length; index += 1) { const line = lines[index]!; if (!line.text.trim() || ignorable(line.text)) continue;
    if (/^\s*end\s*$/i.test(line.text)) { if (!active) return null; lanes.push({ ...active, close: line }); active = null; continue; }
    const lane = line.text.match(LANE_WITH_LABEL) ?? line.text.match(LANE); if (lane) { if (active || lanes.some((entry) => entry.id === lane[1])) return null; active = { id: lane[1]!, label: (lane[2] ?? lane[1]!).trim(), line }; continue; }
    const node = line.text.match(NODE); if (node) { if (!active || nodes.some((entry) => entry.id === node[1]!)) return null; nodes.push({ id: node[1]!, label: node[2]!.trim(), laneId: active.id, line }); continue; }
    const handoff = line.text.match(HANDOFF); if (handoff) { if (active) return null; handoffs.push({ from: handoff[1]!, to: handoff[3]!, ...(handoff[2] ? { label: handoff[2]!.trim() } : {}), line }); continue; }
    return null;
  }
  if (active || handoffs.some((handoff) => !nodes.some((node) => node.id === handoff.from) || !nodes.some((node) => node.id === handoff.to))) return null;
  return { direction, lanes, nodes, handoffs };
}
function requireSwimlane(source: string): Parsed { const parsed = parseSwimlane(source); if (!parsed) throw new Error('This source is not a safely representable swimlane diagram.'); return parsed; }
function findLane(parsed: Parsed, id: string): LaneRecord { const lane = parsed.lanes.find((entry) => entry.id === id); if (!lane) throw new Error(`Swimlane ${id} no longer exists.`); return lane; }
function findNode(parsed: Parsed, id: string): NodeRecord { const node = parsed.nodes.find((entry) => entry.id === id); if (!node) throw new Error(`Swimlane node ${id} no longer exists.`); return node; }
function normalizeLane(value: Swimlane): Swimlane { return { id: normalizeId(value.id, 'Swimlane'), label: normalizeText(value.label, 'Swimlane labels') }; }
function normalizeNode(value: SwimlaneNode): SwimlaneNode { return { id: normalizeId(value.id, 'Swimlane node'), label: normalizeText(value.label, 'Swimlane node labels'), laneId: normalizeId(value.laneId, 'Swimlane') }; }
function normalizeHandoff(value: SwimlaneHandoff): SwimlaneHandoff { return { from: normalizeId(value.from, 'Swimlane node'), to: normalizeId(value.to, 'Swimlane node'), ...(value.label ? { label: normalizeText(value.label, 'Swimlane handoff labels') } : {}) }; }
function assertEndpoints(parsed: Parsed, handoff: SwimlaneHandoff): void { if (!parsed.nodes.some((node) => node.id === handoff.from) || !parsed.nodes.some((node) => node.id === handoff.to)) throw new Error('Swimlane handoffs require existing nodes.'); }
function formatHandoff(value: SwimlaneHandoff): string { return `${value.from} -->${value.label ? `|${value.label}|` : ''} ${value.to}`; }
function sameHandoff(left: SwimlaneHandoff, right: SwimlaneHandoff): boolean { return left.from === right.from && left.to === right.to && left.label === right.label; }
function stale(): Error { return new Error('Swimlane handoff changed remotely and can no longer be resolved safely.'); }
function normalizeId(value: string, noun: string): string { const id = value.trim(); if (!idPattern.test(id)) throw new Error(`${noun} identifiers must be Mermaid-safe identifiers.`); return id; }
function normalizeText(value: string, noun: string): string { const text = value.trim(); if (!text || /[\[\]\r\n]/.test(text)) throw new Error(`${noun} must be one-line Mermaid labels.`); return text; }
function uniqueId(base: string, existing: readonly string[]): string { const ids = new Set(existing); let id = base; let suffix = 2; while (ids.has(id)) { id = `${base}${suffix}`; suffix += 1; } return id; }
function splitLines(source: string): Line[] { const lines: Line[] = []; const matcher = /.*?(?:\r\n|\n|\r|$)/g; let match: RegExpExecArray | null; while ((match = matcher.exec(source)) && match[0]) { const raw = match[0]; lines.push({ start: match.index, end: match.index + raw.length, raw, text: raw.replace(/\r\n|\n|\r$/, '') }); } return lines; }
function statementIndex(lines: readonly Line[]): number { let start = 0; if (lines[0]?.text.replace(/^\uFEFF/, '').trim() === '---') { const close = lines.findIndex((line, index) => index > 0 && line.text.trim() === '---'); start = close < 0 ? lines.length : close + 1; } for (let index = start; index < lines.length; index += 1) if (lines[index]!.text.trim() && !ignorable(lines[index]!.text)) return index; return lines.length; }
function ignorable(value: string): boolean { return /^\s*%%/.test(value); }
function indent(line: Line): string { return line.text.match(/^\s*/)?.[0] ?? ''; }
function lineEnding(source: string): string { return source.includes('\r\n') ? '\r\n' : source.includes('\r') ? '\r' : '\n'; }
function append(source: string, value: string): string { const ending = lineEnding(source); return `${source}${source && !/(?:\r\n|\n|\r)$/.test(source) ? ending : ''}${value}`; }
function replace(source: string, line: Line, value: string): string { return `${source.slice(0, line.start)}${value}${line.raw.slice(line.text.length)}${source.slice(line.end)}`; }
function replaceValues(source: string, values: readonly { line: Line; value: string }[]): string { return [...values].sort((left, right) => right.line.start - left.line.start).reduce((next, value) => replace(next, value.line, value.value), source); }
function deleteLines(source: string, lines: readonly Line[]): string { return [...lines].sort((left, right) => right.start - left.start).reduce((next, line) => `${next.slice(0, line.start)}${next.slice(line.end)}`, source); }
