import { APP_NAME } from './constants.js';

export function healthResponse() {
  return {
    name: APP_NAME,
    status: 'ok' as const,
    phase: 'scaffold' as const,
  };
}
