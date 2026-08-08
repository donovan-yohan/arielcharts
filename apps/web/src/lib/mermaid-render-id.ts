/** Mermaid uses its render id in DOM selectors, so only selector-safe bytes belong here. */
export function getMermaidRenderId(sessionId: string, renderScope: string, sequence: number): string {
  const safeSessionId = sessionId.replace(/[^a-zA-Z0-9_-]+/gu, '-');
  const safeScope = renderScope.replace(/[^a-zA-Z0-9_-]+/gu, '-');
  return `arielcharts-${safeSessionId}-${safeScope}-${sequence}`;
}
