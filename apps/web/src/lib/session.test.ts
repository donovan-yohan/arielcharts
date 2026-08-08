import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { ActivityEvent } from '@arielcharts/shared';
import { getDefaultMermaidText, getWebsocketServerUrl, isValidSessionId, randomSessionId } from './session';
import {
  commitLayoutActivityCheckpoint,
  getActiveDiagramName,
  getAgentCountLabel,
  getAgentWorkflowPrompt,
  getLatestDiagramCheckpointId,
  getModalWrappedFocusIndex,
  getTemplateDiagramCreation,
  getTemplateDiagramName,
  reconcileSelectionForAcceptedRender,
  shouldApplyHistoryPreviewResponse,
} from '../components/session-workspace';

describe('session helpers', () => {
  it('creates session ids in the expected shape', () => {
    expect(randomSessionId()).toMatch(/^[a-z0-9]{8}$/);
  });

  it('validates supported session ids', () => {
    expect(isValidSessionId('a7x9k2mn')).toBe(true);
    expect(isValidSessionId('bad id')).toBe(false);
  });

  it('returns starter mermaid text', () => {
    expect(getDefaultMermaidText()).toContain('flowchart LR');
  });

  it.each([
    ['http://charts.test', 'ws://charts.test/ws'],
    ['https://charts.test', 'wss://charts.test/ws'],
    ['ws://charts.test', 'ws://charts.test/ws'],
    ['wss://charts.test', 'wss://charts.test/ws'],
  ])('normalizes the supported %s websocket base without downgrading security', (baseUrl, expected) => {
    expect(getWebsocketServerUrl(baseUrl)).toBe(expected);
  });

  it('preserves base paths while normalizing trailing slashes and removing URL-only metadata', () => {
    expect(getWebsocketServerUrl('wss://charts.test/base/path///?token=secret#fragment')).toBe('wss://charts.test/base/path/ws');
    expect(getWebsocketServerUrl('ws://charts.test/base')).toBe('ws://charts.test/base/ws');
  });

  it('rejects protocols that cannot carry the Yjs WebSocket connection', () => {
    expect(() => getWebsocketServerUrl('ftp://charts.test')).toThrow('Unsupported WebSocket base URL protocol: ftp:');
  });

  it('copies a modern MCP prompt that requires a fresh revision before writes', () => {
    const prompt = getAgentWorkflowPrompt('abc123de', 'https://charts.test/mcp', 'raw-key');
    expect(prompt).toContain('Authorization: Bearer abc123de.raw-key');
    expect(prompt).toContain('distinct from the raw room key');
    expect(prompt).toContain('getSession');
    expect(prompt).toContain('readDiagram');
    expect(prompt).toContain('writeDiagram');
    expect(prompt).toContain('expectedRevision');
    expect(prompt).toContain('listDiagramHistory');
    expect(prompt).toContain('readDiagramRevision');
    expect(prompt).toContain('restoreDiagramRevision');
    expect(prompt).toContain('Immediately before restoreDiagramRevision, call readDiagram again');
    expect(prompt).toContain('never blindly retry');
    expect(prompt).not.toContain('get_session');
  });

  it('commits visual layout before its single activity checkpoint becomes observable', () => {
    const doc = new Y.Doc();
    const activity = doc.getArray<ActivityEvent>('activity');
    const positions = doc.getMap<{ x: number; y: number }>('positions');
    const observed: Array<{ activityCount: number; positions: Record<string, { x: number; y: number }> }> = [];
    doc.on('afterTransaction', () => {
      observed.push({ activityCount: activity.length, positions: positions.toJSON() });
    });

    commitLayoutActivityCheckpoint(doc, activity, positions, { node: { x: 48, y: 72 } }, 'merge', {
      action: 'edited',
      actor: { name: 'Human-aa', type: 'human' },
      diagram_id: 'main',
      id: 'checkpoint-1',
      timestamp: 1,
    });

    expect(observed).toEqual([{ activityCount: 1, positions: { node: { x: 48, y: 72 } } }]);

    observed.length = 0;
    commitLayoutActivityCheckpoint(doc, activity, positions, {}, 'replace', {
      action: 'edited',
      actor: { name: 'Human-aa', type: 'human' },
      diagram_id: 'main',
      id: 'checkpoint-2',
      timestamp: 2,
    });

    expect(observed).toEqual([{ activityCount: 2, positions: {} }]);
    doc.destroy();
  });

  it('preserves canonical selection across detached preview entry and cancellation', () => {
    const selected = ['Browser'];
    const duringPreview = reconcileSelectionForAcceptedRender(selected, 'detached-preview', 'flowchart');
    const afterCancel = reconcileSelectionForAcceptedRender(duringPreview, 'live', 'flowchart');

    expect(duringPreview).toBe(selected);
    expect(afterCancel).toBe(selected);
    expect(reconcileSelectionForAcceptedRender(selected, 'detached-preview', 'invalid')).toBe(selected);
    expect(reconcileSelectionForAcceptedRender(selected, 'live', 'generic')).toEqual([]);
    expect(reconcileSelectionForAcceptedRender(selected, 'live', 'invalid')).toEqual([]);
  });

  it('derives one stable refresh checkpoint from the latest active-diagram activity', () => {
    const events: ActivityEvent[] = [
      { action: 'edited', actor: { name: 'Peer', type: 'human' }, diagram_id: 'other', id: 'other-3', timestamp: 3 },
      { action: 'edited', actor: { name: 'Ada', type: 'human' }, diagram_id: 'main', id: 'main-2', timestamp: 2 },
      { action: 'created', actor: { name: 'Ada', type: 'human' }, diagram_id: 'main', id: 'main-1', timestamp: 1 },
    ];

    expect(getLatestDiagramCheckpointId(events, 'main')).toBe('main-2');
    expect(getLatestDiagramCheckpointId(events, 'other')).toBe('other-3');
    expect(getLatestDiagramCheckpointId(events, null)).toBeNull();
  });

  it('accepts only the latest preview response for the still-active diagram', () => {
    expect(shouldApplyHistoryPreviewResponse(2, 2, 'main', 'main', 'main')).toBe(true);
    expect(shouldApplyHistoryPreviewResponse(1, 2, 'main', 'main', 'main')).toBe(false);
    expect(shouldApplyHistoryPreviewResponse(2, 2, 'main', 'other', 'main')).toBe(false);
    expect(shouldApplyHistoryPreviewResponse(2, 2, 'main', 'main', 'other')).toBe(false);
  });

  it('reads active-tab metadata from the latest diagram catalog without changing its ID', () => {
    const activeId = 'main';
    expect(getActiveDiagramName([{ id: activeId, name: 'Main' }], activeId)).toBe('Main');
    expect(getActiveDiagramName([{ id: activeId, name: 'API request flow' }], activeId)).toBe('API request flow');
  });

  it('creates an ordinary collision-safe template tab from the shared starter source', () => {
    const creation = getTemplateDiagramCreation('api-sequence', 'diagram_1234567890abcdef', ['API sequence cdef']);
    expect(creation.name).toBe('API sequence 90abcdef');
    expect(creation.source).toContain('sequenceDiagram');
    expect(creation.id).toBe('diagram_1234567890abcdef');
  });

  it('falls back to the complete stable ID if both short suffix names collide', () => {
    expect(getTemplateDiagramName('Blank', 'diagram_1234567890abcdef', [
      'Blank cdef',
      'Blank 90abcdef',
    ])).toBe('Blank diagram_1234567890abcdef');
  });

  it('normalizes template collision names without depending on the browser locale', () => {
    expect(getTemplateDiagramName('API   sequence', 'diagram_1234567890abcdef', [
      '  api sequence cdef  ',
      'API sequence 90abcdef',
    ])).toBe('API sequence diagram_1234567890abcdef');
  });

  it('reports the exact current MCP agent count', () => {
    expect(getAgentCountLabel(0)).toBe('0 MCP agents connected');
    expect(getAgentCountLabel(1)).toBe('1 MCP agent connected');
    expect(getAgentCountLabel(2)).toBe('2 MCP agents connected');
  });

  it('wraps modal focus only at its two boundaries', () => {
    expect(getModalWrappedFocusIndex(0, 2, true)).toBe(1);
    expect(getModalWrappedFocusIndex(1, 2, false)).toBe(0);
    expect(getModalWrappedFocusIndex(0, 2, false)).toBeNull();
    expect(getModalWrappedFocusIndex(-1, 2, false)).toBeNull();
  });
});
