import type {
  Diagram,
  DiagramRevision,
  ListDiagramHistoryOutput,
  Participant,
  RestoreDiagramRevisionResult,
} from '@arielcharts/shared';
import { getServerHttpUrl } from './session';

export class HistoryApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
    this.name = 'HistoryApiError';
  }
}

function getDiagramApiPath(sessionId: string, diagramId: string): string {
  return `${getServerHttpUrl()}/api/sessions/${encodeURIComponent(sessionId)}/diagrams/${encodeURIComponent(diagramId)}`;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as { error?: unknown } | null;
  if (!response.ok) {
    const message = typeof body?.error === 'string' ? body.error : `History request failed (${response.status}).`;
    throw new HistoryApiError(message, response.status);
  }
  return body as T;
}

/** Fetches the canonical diagram head immediately before a restore attempt. */
export async function readCurrentDiagram(sessionId: string, diagramId: string, signal?: AbortSignal): Promise<Diagram> {
  const response = await fetch(getDiagramApiPath(sessionId, diagramId), { signal });
  const body = await readJson<{ diagram: Diagram }>(response);
  return body.diagram;
}

export async function listDiagramHistory(sessionId: string, diagramId: string, signal?: AbortSignal): Promise<ListDiagramHistoryOutput> {
  const response = await fetch(`${getDiagramApiPath(sessionId, diagramId)}/history`, { signal });
  return readJson<ListDiagramHistoryOutput>(response);
}

export async function readDiagramRevision(sessionId: string, diagramId: string, revisionId: string, signal?: AbortSignal): Promise<DiagramRevision> {
  const response = await fetch(`${getDiagramApiPath(sessionId, diagramId)}/history/${encodeURIComponent(revisionId)}`, { signal });
  const body = await readJson<{ revision: DiagramRevision }>(response);
  return body.revision;
}

export async function restoreDiagramRevision(
  sessionId: string,
  diagramId: string,
  revisionId: string,
  expectedRevision: string,
  actor: Pick<Participant, 'name' | 'type'>,
): Promise<RestoreDiagramRevisionResult> {
  const response = await fetch(`${getDiagramApiPath(sessionId, diagramId)}/history/${encodeURIComponent(revisionId)}/restore`, {
    body: JSON.stringify({ actor_name: actor.name, actor_type: actor.type, expected_revision: expectedRevision }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
  return readJson<RestoreDiagramRevisionResult>(response);
}
