import { SESSION_ID_PATTERN } from './constants.js';

export function isValidSessionId(sessionId: string): boolean {
  return SESSION_ID_PATTERN.test(sessionId);
}

export function assertValidSessionId(sessionId: string): void {
  if (!isValidSessionId(sessionId)) {
    throw new Error('Invalid session_id. Expected lowercase letters, digits, underscores, or hyphens (length 6-32).');
  }
}
