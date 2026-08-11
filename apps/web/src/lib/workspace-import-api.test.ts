import { afterEach, describe, expect, it, vi } from 'vitest';
import { importWorkspaceBundle, readWorkspaceRevision, WorkspaceImportApiError } from './workspace-import-api';

const bundle = {
  format: 'arielcharts.workspace' as const,
  version: 1 as const,
  integrity: { algorithm: 'SHA-256' as const, value: 'a'.repeat(64) },
  payload: { schema_version: 1 as const, order: [], diagrams: [] },
};

afterEach(() => vi.unstubAllGlobals());

describe('workspace import API', () => {
  it('reads the authoritative revision then submits the intact signed envelope', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 'head-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 'head-2' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(importWorkspaceBundle('abc123de', bundle)).resolves.toEqual({ revision: 'head-2' });
    expect(fetchMock).toHaveBeenNthCalledWith(1, expect.stringContaining('/api/sessions/abc123de/workspace'), { credentials: 'include' });
    const second = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(second.method).toBe('POST'); expect(JSON.parse(String(second.body))).toEqual({ expected_revision: 'head-1', bundle });
  });

  it('surfaces a stale server conflict and never retries or touches local state', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ revision: 'head-1' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: 'Stale workspace revision. Read the workspace revision and retry.', revision: 'head-2' }), { status: 409 })));
    await expect(importWorkspaceBundle('abc123de', bundle)).rejects.toMatchObject({ name: 'WorkspaceImportApiError', status: 409, currentRevision: 'head-2' });
  });

  it('rejects malformed authoritative revision responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    await expect(readWorkspaceRevision('abc123de')).rejects.toBeInstanceOf(WorkspaceImportApiError);
  });
});
