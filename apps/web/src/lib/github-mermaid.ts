/** Format Mermaid source for GitHub issues, pull requests, and comments. */
export function formatMermaidForGitHub(source: string): string {
  const normalizedSource = source.replace(/\r\n?/gu, '\n');
  const body = normalizedSource.endsWith('\n') ? normalizedSource : `${normalizedSource}\n`;
  const longestBacktickRun = Math.max(0, ...Array.from(normalizedSource.matchAll(/`+/gu), ([run]) => run.length));
  const fence = '`'.repeat(Math.max(3, longestBacktickRun + 1));

  return `${fence}mermaid\n${body}${fence}`;
}
