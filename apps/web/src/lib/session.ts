const SESSION_ID_LENGTH = 8;
const SESSION_ID_REGEX = /^[a-z0-9_-]{6,32}$/;

export function randomSessionId(): string {
  return Math.random().toString(36).slice(2, 2 + SESSION_ID_LENGTH);
}

export function isValidSessionId(id: string): boolean {
  return SESSION_ID_REGEX.test(id);
}

export function getDefaultMermaidText(): string {
  return ['graph TD', '  Human-->Editor', '  Editor-->Preview', '  Agent-->MCP'].join('\n');
}
