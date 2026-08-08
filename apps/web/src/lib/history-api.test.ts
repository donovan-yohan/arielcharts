import { afterEach, describe, expect, it, vi } from 'vitest';
import { HistoryApiError, listDiagramHistory, readCurrentDiagram, readDiagramRevision, restoreDiagramRevision } from './history-api';

const fetchMock = vi.fn();

afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' }, status });
}

describe('history api', () => {
  it('uses focused per-diagram routes and preserves opaque revision ids', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock
      .mockResolvedValueOnce(jsonResponse({ diagram: { id: 'main', name: 'Main', mermaid_text: 'flowchart LR', revision: 'head-2' }, participants: [] }))
      .mockResolvedValueOnce(jsonResponse({ revisions: [], current_revision: 'head-2' }))
      .mockResolvedValueOnce(jsonResponse({ revision: { revision_id: 'rev/1', diagram_id: 'main', name: 'Main', sequence: 1, timestamp: 1, actor: { name: 'Human', type: 'human' }, origin: 'browser', action: 'edited', mermaid_text: 'flowchart LR', node_positions: {} } }));

    await expect(readCurrentDiagram('session one', 'main')).resolves.toMatchObject({ revision: 'head-2' });
    await expect(listDiagramHistory('session one', 'main')).resolves.toMatchObject({ current_revision: 'head-2' });
    await expect(readDiagramRevision('session one', 'main', 'rev/1')).resolves.toMatchObject({ revision_id: 'rev/1' });

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:4000/api/sessions/session%20one/diagrams/main',
      'http://localhost:4000/api/sessions/session%20one/diagrams/main/history',
      'http://localhost:4000/api/sessions/session%20one/diagrams/main/history/rev%2F1',
    ]);
    expect(fetchMock.mock.calls.map(([, init]) => init)).toEqual([
      { credentials: 'include', signal: undefined },
      { credentials: 'include', signal: undefined },
      { credentials: 'include', signal: undefined },
    ]);
  });

  it('posts the freshly-read expected revision and actor for a deliberate restore', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: 'restored', diagram: { id: 'main' }, revision: 'head-3' }));

    await restoreDiagramRevision('session', 'main', 'rev-1', 'head-2', { name: 'Ada', type: 'human' });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:4000/api/sessions/session/diagrams/main/history/rev-1/restore',
      expect.objectContaining({
        body: JSON.stringify({ actor_name: 'Ada', actor_type: 'human', expected_revision: 'head-2' }),
        credentials: 'include',
        method: 'POST',
      }),
    );
  });

  it('surfaces an HTTP error without silently retrying a restore', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'Revision not found.' }, 404));

    await expect(readDiagramRevision('session', 'main', 'missing')).rejects.toEqual(
      expect.objectContaining<Partial<HistoryApiError>>({ message: 'Revision not found.', status: 404 }),
    );
  });

  it('returns the discriminated stale result from an HTTP 409 restore conflict', async () => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockResolvedValueOnce(jsonResponse({
      status: 'stale',
      current: { id: 'main', name: 'Main', mermaid_text: 'flowchart LR\n  Peer-->Wins', revision: 'head-3' },
      current_revision: 'head-3',
    }, 409));

    await expect(restoreDiagramRevision('session', 'main', 'rev-1', 'head-2', { name: 'Ada', type: 'human' })).resolves.toEqual({
      status: 'stale',
      current: { id: 'main', name: 'Main', mermaid_text: 'flowchart LR\n  Peer-->Wins', revision: 'head-3' },
      current_revision: 'head-3',
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
