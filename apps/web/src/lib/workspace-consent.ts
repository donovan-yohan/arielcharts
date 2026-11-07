import type * as Y from 'yjs';

export interface WorkspaceConsentScope {
  readonly document: Y.Doc;
  readonly sessionId: string;
  readonly content: string;
}

function workspaceContent(doc: Y.Doc): string {
  return JSON.stringify({ diagrams: doc.getMap('diagrams').toJSON(), order: doc.getArray('diagramOrder').toArray(), overlays: doc.getMap('overlays').toJSON() });
}

/** Consent covers raw durable content, including opaque scenes, never presence or activity. */
export function captureWorkspaceConsentScope(document: Y.Doc, sessionId: string): WorkspaceConsentScope {
  return { document, sessionId, content: workspaceContent(document) };
}
export function isWorkspaceConsentScopeCurrent(scope: WorkspaceConsentScope, document: Y.Doc, sessionId: string): boolean {
  return scope.document === document && scope.sessionId === sessionId && scope.content === workspaceContent(document);
}
