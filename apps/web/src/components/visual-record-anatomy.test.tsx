// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { readFileSync } from 'node:fs';
import { URL as NodeURL } from 'node:url';
import { expect, it, vi } from 'vitest';
import { DiagramCanvas } from './diagram-canvas';
import { getSequenceDiagramSnapshot } from '../lib/sequence-mutations';
import { getC4DiagramSnapshot } from '../lib/c4-mutations';
import { getErDiagramSnapshot } from '../lib/er-mutations';
import { getBlockDiagramSnapshot } from '../lib/block-mutations';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
async function mount(props: Partial<React.ComponentProps<typeof DiagramCanvas>>, check: (host: HTMLElement) => Promise<void> | void) {
  vi.stubGlobal('React', React); vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
  const host = document.createElement('div'); document.body.append(host); const root = createRoot(host);
  try { await act(async () => root.render(<DiagramCanvas graph={null} isFlowchart={false} svg="<svg viewBox='0 0 100 100'></svg>" {...props} />)); await check(host); }
  finally { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); }
}
it.each(['C4', 'Block'] as const)('gives %s containment distinct record headings, single associated labels and a shared narrow scroll owner', async (family) => {
  const c4 = family === 'C4';
  const source = c4 ? 'C4Context\nPerson(user_with_long_identity, "User")\nSystem_Boundary(system, "System") {\nSystem(api, "API")\n}' : 'block-beta\ncolumns 1\nblock:system\napi["API"]\nend\nuser_with_long_identity["User"]';
  const moved = vi.fn();
  await mount(c4 ? { isC4: true, c4Diagram: getC4DiagramSnapshot(source), mermaidSource: source, onMoveC4Element: moved } : { isBlock: true, blockDiagram: getBlockDiagramSnapshot(source), mermaidSource: source, onMoveBlockNode: moved }, async (host) => {
    const pair = host.querySelector('[data-workspace-paired-panels]'); expect(pair).not.toBeNull();
    expect(pair?.querySelectorAll('[data-workspace-panel="semantic"]').length).toBe(2);
    expect(pair?.querySelector('label label')).toBeNull();
    const containment = host.querySelector(`[data-testid="${c4 ? 'c4' : 'block'}-containment-controls"]`)!;
    expect(containment.querySelector('label label')).toBeNull();
    const record = [...containment.querySelectorAll('[data-workspace-containment-record]')].find((item) => item.querySelector('.workspace-record-heading')?.textContent?.includes('user_with_long_identity')); expect(record).toBeTruthy();
    expect(record?.querySelector('.workspace-record-heading')?.textContent).toContain('user_with_long_identity');
    const select = record!.querySelector('select')!;
    expect(record?.querySelectorAll('label').length).toBe(1);
    expect(record?.querySelector('label')?.htmlFor).toBe(select.id);
    await act(async () => { select.value = 'system'; select.dispatchEvent(new Event('change', { bubbles: true })); });
    expect(moved).toHaveBeenCalledWith('user_with_long_identity', 'system');
  });
});
it('names repeated Sequence records and order/delete actions by their actual target without a detached arrow row', async () => {
  const source = 'sequenceDiagram\nparticipant A as Alice\nparticipant B as Bob\nA->>B: Hello\nB-->>A: Reply\nNote over A: Reminder\nactivate B\nalt Ready\nA->>B: Continue\nend';
  const diagram = getSequenceDiagramSnapshot(source); const move = vi.fn();
  await mount({ isSequence: true, sequenceTextItems: [], sequenceDiagram: diagram, sequenceParticipants: diagram.participants, mermaidSource: source, onMoveSequenceMessage: move }, async (host) => {
    const items = host.querySelector('details')!;
    const headings = [...items.querySelectorAll('.workspace-record-heading')].map((item) => item.textContent);
    expect(headings).toContain('Sequence participant Alice (A)');
    expect(headings).toContain('Sequence message 1: A to B');
    expect(headings).toContain('Sequence note 1: A');
    expect(headings).toContain('Sequence activation 1: B');
    expect(headings).toContain('Sequence fragment 1: alt');
    const down = items.querySelector<HTMLButtonElement>('button[aria-label="Move Sequence message 1: A to B down"]'); expect(down).not.toBeNull();
    await act(async () => down!.click()); expect(move).toHaveBeenCalledWith(diagram.messages[0]!.id, 'down');
    expect(items.querySelector('button[aria-label="Delete Sequence message 2: B to A"]')).not.toBeNull();
    expect(host.querySelector('.canvas-sequence-message-form > span[aria-hidden="true"]')).toBeNull();
  });
});
it('marks actual ER entity section boundaries without recursively doubling their nested record insets', async () => {
  const source = 'erDiagram\nCUSTOMER {\nstring id PK\n}\nORDER {\nstring id PK\n}\nCUSTOMER ||--o{ ORDER : places';
  await mount({ isEr: true, mermaidSource: source, erDiagram: getErDiagramSnapshot(source) }, (host) => {
    const list = host.querySelector('[data-workspace-record-list]'); expect(list).not.toBeNull();
    expect(list?.querySelectorAll(':scope > [data-workspace-record-section]').length).toBe(2);
    expect(list?.querySelector('[data-workspace-record-section] .workspace-record-heading')?.textContent).toBe('ER entity CUSTOMER');
  });
});
it('separates only explicit sibling records and uses accepted caption/dialog typography', () => {
  const css = readFileSync(new NodeURL('../app/globals.css', import.meta.url), 'utf8');
  const anatomy = css.slice(css.indexOf("[data-workspace-panel='semantic'] :is(form, section, details > div)"));
  expect(anatomy.match(/^[^{]+\{([^}]+)\}/)?.[1]).not.toContain('border-top:');
  expect(anatomy.match(/^[^{]+\{([^}]+)\}/)?.[1]).not.toContain('margin: var(--workspace-space-3)');
  expect(css).toContain('[data-workspace-record] ~ [data-workspace-record]');
  expect(css).toMatch(/\.canvas-sequence-editor :is\(span, small\)\s*\{[^}]*font:\s*[^;]*12px\/1\.4/);
  expect(css).toMatch(/\.workspace-confirmation h2\s*\{[^}]*font:\s*700 14px\/1\.35/);
  expect(css).toMatch(/\.workspace-shortcuts-dialog h2\s*\{[^}]*font:\s*700 14px\/1\.35/);
});
