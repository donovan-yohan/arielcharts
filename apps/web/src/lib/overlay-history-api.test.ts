import { afterEach, describe, expect, it, vi } from 'vitest';
import { listOverlayHistory, pairWorkspaceSnapshot, readCurrentOverlayScene, readOverlayRevision, restoreOverlayRevision } from './overlay-history-api';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => fetchMock.mockReset());

describe('overlay history api', () => {
  it('keeps overlay history on browser-cookie routes separate from Mermaid history', async () => {
    fetchMock
      .mockResolvedValueOnce(response({ scene: { version: 1, diagram_id: 'main', objects: [] }, revision: 'overlay-head' }))
      .mockResolvedValueOnce(response({ revisions: [], current_revision: 'overlay-head' }))
      .mockResolvedValueOnce(response({ revision: { revision_id: 'overlay/1' } }));
    await readCurrentOverlayScene('room one', 'main');
    await listOverlayHistory('room one', 'main');
    await readOverlayRevision('room one', 'main', 'overlay/1');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      'http://localhost:4000/api/sessions/room%20one/diagrams/main/overlays',
      'http://localhost:4000/api/sessions/room%20one/diagrams/main/overlays/history',
      'http://localhost:4000/api/sessions/room%20one/diagrams/main/overlays/history/overlay%2F1',
    ]);
    expect(fetchMock.mock.calls.every(([, init]) => init?.credentials === 'include')).toBe(true);
  });

  it('returns stale overlay restore without retrying it', async () => {
    fetchMock.mockResolvedValueOnce(response({ status: 'stale', current_revision: 'new', scene: { version: 1, diagram_id: 'main', objects: [] } }, 409));
    await expect(restoreOverlayRevision('room', 'main', 'old', 'expected', { name: 'Ada', type: 'human' })).resolves.toMatchObject({ status: 'stale' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('pairs independent revision identities explicitly', () => {
    expect(pairWorkspaceSnapshot('mermaid-2', 'overlay-7')).toEqual({ mermaidRevisionId: 'mermaid-2', overlayRevisionId: 'overlay-7' });
    expect(() => pairWorkspaceSnapshot('', 'overlay-7')).toThrow(/Both/u);
  });
});
