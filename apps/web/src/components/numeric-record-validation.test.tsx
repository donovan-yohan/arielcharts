// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { DiagramCanvas } from './diagram-canvas';
import { addPieSlice, editPieSlice, getPieDiagramSnapshot } from '../lib/pie-mutations';
import type { DiagramCanvasProps } from './diagram-canvas';
import { getSankeyDiagramSnapshot } from '../lib/sankey-mutations';
import { getPacketDiagramSnapshot } from '../lib/packet-mutations';
import { editTreemapNode, getTreemapDiagramSnapshot } from '../lib/treemap-mutations';
import { getVennDiagramSnapshot } from '../lib/venn-mutations';
import { getQuadrantDiagramSnapshot } from '../lib/quadrant-mutations';
import { getXyChartDiagramSnapshot } from '../lib/xychart-mutations';
import { getRadarDiagramSnapshot } from '../lib/radar-mutations';
import { getWardleyDiagramSnapshot } from '../lib/wardley-mutations';
import { getZenUmlDiagramSnapshot } from '../lib/zenuml-mutations';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  vi.stubGlobal('React', React);
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });
async function edit(label: string, value: string) {
  const input = [...host.querySelectorAll<HTMLInputElement>('input')].find((item) => item.getAttribute('aria-label') === label)!;
  expect(input).not.toBeNull();
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect(input.value).toBe(value);
  return input;
}
async function submit(label: string) {
  const record = [...host.querySelectorAll<HTMLFormElement>('form')].find((item) => item.getAttribute('aria-label') === label)!;
  expect(record).not.toBeNull();
  await act(async () => { record.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  return record;
}
function associatedError(input: HTMLInputElement, record: HTMLFormElement) {
  expect(input.getAttribute('aria-invalid')).toBe('true');
  const id = input.getAttribute('aria-describedby'); expect(id).toBeTruthy();
  const error = document.getElementById(id!); expect(record.contains(error)).toBe(true);
  expect(error?.getAttribute('role')).toBe('alert');
  return error!;
}
it('associates actual Pie failures with only their owning record, retains drafts and clears only the corrected record', async () => {
  let source = 'pie\n  "Revenue" : 5\n  "Cost" : 2';
  const add = vi.fn((slice: Parameters<typeof addPieSlice>[1]) => { source = addPieSlice(source, slice); });
  const save = vi.fn((identity: Parameters<typeof editPieSlice>[1], patch: Parameters<typeof editPieSlice>[2]) => { source = editPieSlice(source, identity, patch); });
  await act(async () => root.render(<DiagramCanvas graph={null} isFlowchart={false} isPie pieDiagram={getPieDiagramSnapshot(source)} svg="<svg viewBox='0 0 100 100'></svg>" onAddPieSlice={add} onEditPieSlice={save} />));
  const field = await edit('New Pie slice value', '-2');
  const record = await submit('New Pie slice');
  const error = associatedError(field, record);
  expect(error.textContent).toMatch(/zero|negative|greater|positive/i);
  const errorId = error.id;
  expect(field.value).toBe('-2'); expect(source).toBe('pie\n  "Revenue" : 5\n  "Cost" : 2');
  expect(host.querySelector('input[aria-label="Pie slice Revenue value"]')?.getAttribute('aria-invalid')).toBeNull();
  const existing = await edit('Pie slice Revenue value', '-3');
  const existingRecord = await submit('Pie slice Revenue');
  const existingError = associatedError(existing, existingRecord);
  expect(existingError.id).not.toBe(errorId);
  await submit('Pie slice Cost');
  expect(associatedError(field, record).id).toBe(errorId);
  expect(associatedError(existing, existingRecord).id).toBe(existingError.id);
  await edit('New Pie slice value', '3'); await submit('New Pie slice');
  expect(field.getAttribute('aria-invalid')).toBeNull(); expect(document.getElementById(errorId)).toBeNull();
  expect(associatedError(existing, existingRecord).id).toBe(existingError.id);
  await edit('Pie slice Revenue value', '7'); await submit('Pie slice Revenue');
  expect(existing.getAttribute('aria-invalid')).toBeNull(); expect(existingRecord.querySelector('[role="alert"]')).toBeNull();
  expect(getPieDiagramSnapshot(source).slices).toEqual([{ label: 'Revenue', value: 7 }, { label: 'Cost', value: 2 }, { label: 'Slice', value: 3 }]);
});

it('retains a cached Treemap leaf draft through real numeric rejection and publishes the correction without invalidating its sibling', async () => {
  const original = 'treemap-beta\n  "Root"\n    "Leaf": 2\n    "Peer": 3';
  let accepted = original;
  function Fixture() {
    const [source, setSource] = React.useState(original);
    return <DiagramCanvas graph={null} isFlowchart={false} svg="<svg viewBox='0 0 100 100'></svg>" isTreemap mermaidSource={source} treemapDiagram={getTreemapDiagramSnapshot(source)} onEditTreemapNode={(identity, patch) => {
      accepted = editTreemapNode(source, identity, patch); setSource(accepted);
    }} />;
  }
  await act(async () => root.render(<Fixture />));
  const recordLabel = 'Treemap node "Root" / "Leaf"';
  const input = await edit(`${recordLabel} value`, '-2');
  const record = await submit(recordLabel); const diagnostic = associatedError(input, record);
  expect(diagnostic.textContent).toMatch(/positive|greater/i); expect(input.value).toBe('-2'); expect(accepted).toBe(original);
  const peer = [...host.querySelectorAll('form')].find((item) => item.getAttribute('aria-label') === 'Treemap node "Root" / "Peer"')!;
  expect(peer.querySelector('[aria-invalid="true"]')).toBeNull();
  await edit(`${recordLabel} value`, '4'); await submit(recordLabel);
  expect(accepted).toContain('"Leaf": 4');
  expect(document.getElementById(diagnostic.id)).toBeNull();
  expect(host.querySelector('[aria-invalid="true"]')).toBeNull();
});

it('keeps a rejected Wardley pipeline deletion on the actual existing pipeline, not the new-pipeline draft', async () => {
  const source = 'wardley-beta\ncomponent Platform [0.5, 0.5]\npipeline Platform {\ncomponent Compute [0.6]\n}';
  const remove = vi.fn(() => ({ applied: false, error: 'Pipeline changed. Review the current pipeline.' }));
  await act(async () => root.render(<DiagramCanvas graph={null} isFlowchart={false} svg="<svg viewBox='0 0 100 100'></svg>" isWardley mermaidSource={source} wardleyDiagram={getWardleyDiagramSnapshot(source)} onDeleteWardleyPipeline={remove} />));
  const button = host.querySelector<HTMLButtonElement>('button[aria-label="Delete Wardley pipeline Platform"]')!;
  await act(async () => button.click());
  expect(remove).toHaveBeenCalledTimes(1);
  expect(button.closest('[data-workspace-record]')?.querySelector('[role="alert"]')?.textContent).toBe('Pipeline changed. Review the current pipeline.');
  expect(host.querySelector('form[aria-label="New Wardley pipeline"] [role="alert"]')).toBeNull();
});

const familyCases: Array<{ name: string; props: Partial<DiagramCanvasProps>; records: string[]; callbacks: Array<keyof DiagramCanvasProps> }> = [
  { name: 'Sankey', props: { isSankey: true, sankeyDiagram: getSankeyDiagramSnapshot('sankey-beta\nSource,Target,2'), mermaidSource: 'sankey-beta\nSource,Target,2' }, records: ['New Sankey link', 'Sankey link Source to Target weight 2', 'Sankey node Source', 'Sankey node Target'], callbacks: ['onAddSankeyLink', 'onEditSankeyLink', 'onRenameSankeyNode'] },
  { name: 'Packet', props: { isPacket: true, packetDiagram: getPacketDiagramSnapshot('packet-beta\n0-2: "Header"'), mermaidSource: 'packet-beta\n0-2: "Header"' }, records: ['New Packet field', 'Packet field Header bits 0-2'], callbacks: ['onAddPacketField', 'onEditPacketField'] },
  { name: 'Treemap', props: { isTreemap: true, treemapDiagram: getTreemapDiagramSnapshot('treemap-beta\n  "Root"\n    "Leaf": 2'), mermaidSource: 'treemap-beta\n  "Root"\n    "Leaf": 2' }, records: ['New Treemap node', 'Treemap node "Root"', 'Treemap node "Root" / "Leaf"'], callbacks: ['onAddTreemapNode', 'onEditTreemapNode'] },
  { name: 'Venn', props: { isVenn: true, vennDiagram: getVennDiagramSnapshot('venn-beta\nset A: 10\nset B: 8\nunion A, B: 4\nstyle A fill:#336699'), mermaidSource: 'venn-beta\nset A: 10\nset B: 8\nunion A, B: 4\nstyle A fill:#336699' }, records: ['New Venn subset', 'New Venn style', 'Venn set A', 'Venn set B', 'Venn overlap A and B', 'Venn style A'], callbacks: ['onAddVennSubset', 'onAddVennStyle', 'onEditVennSubset', 'onEditVennStyle'] },
  { name: 'Quadrant', props: { isQuadrant: true, quadrantDiagram: getQuadrantDiagramSnapshot('quadrantChart\nAlpha: [0.2, 0.8]'), mermaidSource: 'quadrantChart\nAlpha: [0.2, 0.8]' }, records: ['New Quadrant point', 'Quadrant point Alpha'], callbacks: ['onAddQuadrantPoint', 'onEditQuadrantPoint'] },
  { name: 'XY', props: { isXyChart: true, xyChartDiagram: getXyChartDiagramSnapshot('xychart-beta\nx-axis ["Jan", "Feb"]\ny-axis 0 --> 10\nline "Revenue" [2, 4]'), mermaidSource: 'xychart-beta\nx-axis ["Jan", "Feb"]\ny-axis 0 --> 10\nline "Revenue" [2, 4]' }, records: ['New XY series', 'XY x-axis', 'XY y-axis', 'XY series Revenue'], callbacks: ['onAddXySeries', 'onEditXyAxis', 'onEditXySeries'] },
  { name: 'Radar', props: { isRadar: true, radarDiagram: getRadarDiagramSnapshot('radar-beta\naxis speed\naxis quality\naxis safety\ncurve current {4, 5, 3}\nticks 5\nmin 0\nmax 5'), mermaidSource: 'radar-beta\naxis speed\naxis quality\naxis safety\ncurve current {4, 5, 3}\nticks 5\nmin 0\nmax 5' }, records: ['New Radar axis', 'New Radar curve', 'Radar options', 'Radar curve current'], callbacks: ['onAddRadarAxis', 'onAddRadarCurve', 'onEditRadarOptions', 'onEditRadarCurve'] },
  { name: 'Wardley', props: { isWardley: true, wardleyDiagram: getWardleyDiagramSnapshot('wardley-beta\nanchor User [0.95, 0.1]\ncomponent Platform [0.5, 0.55]\nUser -> Platform\nevolve Platform 0.8\nnote "Need" [0.9, 0.15]'), mermaidSource: 'wardley-beta\nanchor User [0.95, 0.1]\ncomponent Platform [0.5, 0.55]\nUser -> Platform\nevolve Platform 0.8\nnote "Need" [0.9, 0.15]' }, records: ['New Wardley node', 'New Wardley pipeline', 'New Wardley link', 'New Wardley evolution', 'New Wardley note', 'Wardley anchor User', 'Wardley component Platform', 'Wardley link User -> Platform', 'Wardley evolution Platform', 'Wardley note Need'], callbacks: ['onAddWardleyNode', 'onAddWardleyPipeline', 'onAddWardleyLink', 'onAddWardleyEvolution', 'onAddWardleyNote', 'onEditWardleyNode', 'onEditWardleyLink', 'onEditWardleyEvolution', 'onEditWardleyNote'] },
  { name: 'ZenUML', props: { isZenUml: true, zenUmlDiagram: getZenUmlDiagramSnapshot('zenuml\n@Actor User\nAPI\nUser->API: request\nif(ok) {\nAPI->User: done\n}'), mermaidSource: 'zenuml\n@Actor User\nAPI\nUser->API: request\nif(ok) {\nAPI->User: done\n}' }, records: ['Add ZenUML participant', 'Add ZenUML message', 'Add ZenUML control'], callbacks: ['onAddZenUmlParticipant', 'onAddZenUmlMessage', 'onAddZenUmlControl'] },
];

it.each(familyCases)('scopes $name numeric/dense action errors to actual records without clearing a sibling failure', async ({ props, records, callbacks }) => {
  let refused = true;
  const action = vi.fn(() => refused ? { applied: false, error: 'Exact current-record rejection detail.' } : { applied: true });
  const actions = Object.fromEntries(callbacks.map((name) => [name, action]));
  await act(async () => root.render(<DiagramCanvas graph={null} isFlowchart={false} svg="<svg viewBox='0 0 100 100'></svg>" {...props} {...actions} />));
  const errors: HTMLElement[] = [];
  for (const label of records) {
    // Attribute-value comparison retains authored quotes in Treemap identities.
    const record = [...host.querySelectorAll<HTMLFormElement>('form')].find((item) => item.getAttribute('aria-label') === label);
    expect(record, label).toBeTruthy();
    const before = [...record!.querySelectorAll<HTMLInputElement>('input')].map((input) => input.value);
    const calls = action.mock.calls.length;
    await act(async () => { record!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
    expect(action.mock.calls.length, label).toBe(calls + 1);
    const field = record!.querySelector<HTMLInputElement>('input:not([type="checkbox"]):not(:disabled), select:not(:disabled)')!;
    errors.push(associatedError(field, record!));
    expect(errors.at(-1)!.textContent).toBe('Exact current-record rejection detail.');
    expect([...record!.querySelectorAll<HTMLInputElement>('input')].map((input) => input.value)).toEqual(before);
    const unrelated = [...host.querySelectorAll<HTMLFormElement>('form')].filter((item) => item !== record && !item.querySelector('[role="alert"]'));
    for (const sibling of unrelated) expect(sibling.querySelector('[aria-invalid="true"]')).toBeNull();
  }
  expect(new Set(errors.map((item) => item.id)).size).toBe(records.length);
  refused = false;
  const last = errors.at(-1)!;
  const record = last.closest('form')!;
  await act(async () => { record.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  expect(record.querySelector('[aria-invalid="true"]')).toBeNull();
  expect(record.querySelector('[role="alert"]')).toBeNull();
  for (const error of errors.slice(0, -1)) expect(document.getElementById(error.id)).toBe(error);
});
