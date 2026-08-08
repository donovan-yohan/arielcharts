export { APP_NAME } from '@arielcharts/shared';
export const DIAGRAMS_KEY = 'diagrams';
export const DIAGRAM_ORDER_KEY = 'diagramOrder';
export const DIAGRAM_NAME_KEY = 'name';
export const DIAGRAM_MERMAID_TEXT_KEY = 'mermaid';
export const DIAGRAM_NODE_POSITIONS_KEY = 'nodePositions';
// Retained only for low-level websocket protocol tests that exercise arbitrary
// Yjs updates; application state no longer reads this root key.
export const MERMAID_TEXT_KEY = 'mermaid';
export const ACTIVITY_KEY = 'activity';
export const PRESENCE_KEY = 'presence';
export const SESSION_ID_PATTERN = /^[a-z0-9_-]{6,32}$/;
export const DEFAULT_SESSION_TITLE = 'Untitled session';
export const DEFAULT_CLEANUP_INTERVAL_MS = 30_000;
export const DEFAULT_SESSION_TTL_MS = 5 * 60_000;
export const DEFAULT_DISK_TTL_MS = 7 * 24 * 60 * 60_000;
