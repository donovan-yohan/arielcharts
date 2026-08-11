import type {
  ListOverlayHistoryOutput,
  OverlayRevision,
  OverlaySceneSnapshot,
  RestoreOverlayRevisionResult,
  WorkspaceSnapshotPair,
} from '@arielcharts/shared';
import { getServerHttpUrl } from './session';

function path(sessionId: string, diagramId: string): string {
  return `${getServerHttpUrl()}/api/sessions/${encodeURIComponent(sessionId)}/diagrams/${encodeURIComponent(diagramId)}/overlays`;
}

async function json<T>(response: Response): Promise<T> {
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? `Overlay history request failed (${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export function readCurrentOverlayScene(sessionId: string, diagramId: string, signal?: AbortSignal): Promise<{ scene: OverlaySceneSnapshot; revision: string }> {
  return fetch(path(sessionId, diagramId), { credentials: 'include', signal }).then((response) => json<{ scene: OverlaySceneSnapshot; revision: string }>(response));
}

export function listOverlayHistory(sessionId: string, diagramId: string, signal?: AbortSignal): Promise<ListOverlayHistoryOutput> {
  return fetch(`${path(sessionId, diagramId)}/history`, { credentials: 'include', signal }).then((response) => json<ListOverlayHistoryOutput>(response));
}

export async function readOverlayRevision(sessionId: string, diagramId: string, revisionId: string, signal?: AbortSignal): Promise<OverlayRevision> {
  const body = await fetch(`${path(sessionId, diagramId)}/history/${encodeURIComponent(revisionId)}`, { credentials: 'include', signal }).then(json<{ revision: OverlayRevision }>);
  return body.revision;
}

export async function restoreOverlayRevision(
  sessionId: string,
  diagramId: string,
  revisionId: string,
  expectedRevision: string,
  actor: { name: string; type: 'human' | 'agent' },
): Promise<RestoreOverlayRevisionResult> {
  const response = await fetch(`${path(sessionId, diagramId)}/history/${encodeURIComponent(revisionId)}/restore`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ expected_revision: expectedRevision, actor_name: actor.name, actor_type: actor.type }),
  });
  if (response.status === 409) return response.json() as Promise<Extract<RestoreOverlayRevisionResult, { status: 'stale' }>>;
  return json(response);
}

/** Whole-workspace snapshots are explicit revision pairs, never timestamp joins. */
export function pairWorkspaceSnapshot(mermaidRevisionId: string, overlayRevisionId: string): WorkspaceSnapshotPair {
  if (!mermaidRevisionId || !overlayRevisionId) throw new Error('Both Mermaid and overlay revisions are required.');
  return { mermaidRevisionId, overlayRevisionId };
}
