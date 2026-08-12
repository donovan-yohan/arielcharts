import type { WorkspaceBundle } from './workspace-bundle';
import { getServerHttpUrl } from './session';

export class WorkspaceImportApiError extends Error {
  constructor(message: string, readonly status: number, readonly currentRevision?: string) {
    super(message);
    this.name = 'WorkspaceImportApiError';
  }
}

function path(sessionId: string): string {
  return `${getServerHttpUrl()}/api/sessions/${encodeURIComponent(sessionId)}/workspace`;
}

async function responseError(response: Response): Promise<WorkspaceImportApiError> {
  const body = await response.json().catch(() => null) as { error?: unknown; revision?: unknown } | null;
  return new WorkspaceImportApiError(
    typeof body?.error === 'string' ? body.error : `Workspace import failed (${response.status}).`,
    response.status,
    typeof body?.revision === 'string' ? body.revision : undefined,
  );
}

/** Reads the server-owned revision immediately before an all-workspace replacement. */
export async function readWorkspaceRevision(sessionId: string): Promise<string> {
  const response = await fetch(path(sessionId), { credentials: 'include' });
  if (!response.ok) throw await responseError(response);
  const body = await response.json().catch(() => null) as { revision?: unknown } | null;
  if (typeof body?.revision !== 'string' || !body.revision) throw new WorkspaceImportApiError('The workspace revision response was invalid.', response.status);
  return body.revision;
}

/** Server validation/admission is authoritative; this never mutates the local Yjs document. */
export async function importWorkspaceBundle(sessionId: string, bundle: WorkspaceBundle): Promise<{ revision: string }> {
  const expectedRevision = await readWorkspaceRevision(sessionId);
  const response = await fetch(path(sessionId), {
    method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expected_revision: expectedRevision, bundle }),
  });
  if (!response.ok) throw await responseError(response);
  const body = await response.json().catch(() => null) as { revision?: unknown } | null;
  if (typeof body?.revision !== 'string' || !body.revision) throw new WorkspaceImportApiError('The workspace import response was invalid.', response.status);
  return { revision: body.revision };
}
