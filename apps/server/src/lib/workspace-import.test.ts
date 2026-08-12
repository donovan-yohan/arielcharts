import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { canonicalWorkspaceJson, parseWorkspaceBundle, WorkspaceImportError } from './workspace-import.js';

function signed(payload: unknown) {
  return {
    format: 'arielcharts.workspace', version: 1,
    payload,
    integrity: { algorithm: 'SHA-256', value: createHash('sha256').update(canonicalWorkspaceJson(payload)).digest('hex') },
  };
}

describe('workspace import envelope', () => {
  it('rejects a deeply nested signed-shaped payload before it can reach a candidate document', () => {
    let nested: unknown = { value: true };
    for (let index = 0; index < 30; index += 1) nested = { nested };
    const envelope = { format: 'arielcharts.workspace', version: 1, payload: nested, integrity: { algorithm: 'SHA-256', value: 'a'.repeat(64) } };
    expect(() => parseWorkspaceBundle(envelope)).toThrow(WorkspaceImportError);
  });

  it('rejects an envelope with a valid signature but unsupported additional fields', () => {
    const payload = { schema_version: 1, order: ['main'], diagrams: [{ id: 'main', name: 'Main', mermaid: { schema_version: 1, source: '' }, layout: { schema_version: 1, positions: {} }, overlay: { version: 1, diagram_id: 'main', objects: [], layers: [{ id: 'default', name: 'Default', order_key: 'a', visible: true, locked: false, export: true }] } }] };
    const envelope = { ...signed(payload), secret: 'nope' };
    expect(() => parseWorkspaceBundle(envelope)).toThrow(WorkspaceImportError);
  });
});
