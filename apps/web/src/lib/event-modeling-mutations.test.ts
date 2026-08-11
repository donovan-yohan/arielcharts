// @vitest-environment happy-dom

import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { addEventModelingDataBlock, addEventModelingTimeframe, editEventModelingDataBlock, getEventModelingDiagramSnapshot, isEventModelingSourceRepresentable, moveEventModelingTimeframe } from './event-modeling-mutations';

const SOURCE = `%% source-owned payload\neventmodeling\n  entity Inventory.Stock\n  tf 01 ui Inventory.Stock\n  tf 02 cmd ReserveStock ->> 01 [[ReserveStock01]]\n  data ReserveStock01 \`json\`{\n    "sku": "A-1"\n}`;

describe('Event Modeling source mutations', () => {
  it('keeps the supported Event Modeling subset accepted by Mermaid 11.16.1', async () => {
    mermaid.initialize({ startOnLoad: false });
    await expect(mermaid.parse(SOURCE)).resolves.toMatchObject({ diagramType: 'eventmodeling' });
  });
  it('models timeframe entities/namespaces, links, and literal data payloads', () => {
    expect(getEventModelingDiagramSnapshot(SOURCE)).toEqual({ entities: [{ name: 'Inventory.Stock', namespace: 'Inventory' }], timeframes: [{ kind: 'tf', index: '01', entityType: 'ui', entity: 'Inventory.Stock', namespace: 'Inventory', links: [] }, { kind: 'tf', index: '02', entityType: 'cmd', entity: 'ReserveStock', links: ['01'], dataId: 'ReserveStock01' }], dataBlocks: [{ name: 'ReserveStock01', dataType: 'json', payload: '    "sku": "A-1"\n' }] });
  });
  it('keeps data payload text literal and rejects unknown links/data', () => {
    const added = addEventModelingDataBlock(SOURCE, { name: 'Later', payload: '  preserved  \n', dataType: 'text' });
    expect(editEventModelingDataBlock(added, 'Later', { payload: '  unchanged spacing\n' })).toContain('  unchanged spacing');
    expect(isEventModelingSourceRepresentable('eventmodeling\n  tf 01 cmd Add ->> 99')).toBe(false);
    expect(isEventModelingSourceRepresentable('eventmodeling\n  tf 01 cmd Add [[missing]]')).toBe(false);
  });
  it('only accepts source order changes whose relationships stay meaningful', () => {
    const third = addEventModelingTimeframe(SOURCE, { kind: 'timeframe', index: '03', entityType: 'evt', entity: 'StockReserved', links: ['02'] });
    expect(moveEventModelingTimeframe(third, '03', 1)).toContain('timeframe 03 evt StockReserved ->> 02');
  });
  it('preserves physical terminators for one-place timeframe moves', () => {
    for (const ending of ['\n', '\r\n', '\r']) {
      const source = [`eventmodeling`, `  tf 01 cmd First`, `  tf 02 evt Second`].join(ending);
      const moved = moveEventModelingTimeframe(source, '02', 0);
      expect(moved.match(/\r\n|\n|\r/g)).toEqual(source.match(/\r\n|\n|\r/g));
      expect(moved.endsWith(ending)).toBe(false);
    }
    const mixed = 'eventmodeling\r\n  tf 01 cmd First\n  tf 02 evt Second\r  tf 03 ui Third';
    expect(moveEventModelingTimeframe(mixed, '03', 1).match(/\r\n|\n|\r/g)).toEqual(mixed.match(/\r\n|\n|\r/g));
  });
  it('keeps existing mixed payload bytes verbatim on name and type edits', () => {
    const source = 'eventmodeling\r\n  data Payload `json`{\n    one\r    two\n}\r\n';
    const payload = '    one\r    two\n';
    const edited = editEventModelingDataBlock(source, 'Payload', { name: 'Renamed', dataType: 'text' });
    expect(edited).toContain(`data Renamed \`text\`{\n${payload}}`);
    expect(edited.match(/\r\n|\n|\r/g)).toEqual(source.match(/\r\n|\n|\r/g));
  });
});
