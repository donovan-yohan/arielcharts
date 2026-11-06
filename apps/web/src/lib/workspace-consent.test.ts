import { expect, it } from 'vitest';
import * as Y from 'yjs';
import { captureWorkspaceConsentScope, isWorkspaceConsentScopeCurrent } from './workspace-consent';
function fixture() { const doc = new Y.Doc(); const diagram = new Y.Map(); diagram.set('name', 'Safe fixture'); diagram.set('mermaid', new Y.Text('flowchart LR')); doc.getMap('diagrams').set('main', diagram); doc.getArray('diagramOrder').push(['main']); return doc; }
it('fences destructive consent to exact document identity and session, without requiring an exportable scene', () => {
  const doc = fixture(); doc.getMap('overlays').set('main', { schema_version: 999, opaque: { future: 'retained' } });
  const scope = captureWorkspaceConsentScope(doc, 'room-a');
  expect(isWorkspaceConsentScopeCurrent(scope, doc, 'room-a')).toBe(true);
  expect(isWorkspaceConsentScopeCurrent(scope, doc, 'room-b')).toBe(false);
  expect(isWorkspaceConsentScopeCurrent(scope, fixture(), 'room-a')).toBe(false);
  doc.getMap<Y.Map<unknown>>('diagrams').get('main')!.set('name', 'Changed');
  expect(isWorkspaceConsentScopeCurrent(scope, doc, 'room-a')).toBe(false);
});
it('does not turn activity or membership changes into a different replacement scope', () => {
  const doc = fixture(); const scope = captureWorkspaceConsentScope(doc, 'room-a');
  doc.getArray('activity').push([{ action: 'edited' }]); doc.getMap('presence').set('fixture', { name: 'Fixture' });
  expect(isWorkspaceConsentScopeCurrent(scope, doc, 'room-a')).toBe(true);
});
