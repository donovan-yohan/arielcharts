# MermaidFlow phased delivery plan

## Phase 1 — Scaffold and CI baseline
Branch: `phase-1/scaffold`

Goal: create a working monorepo skeleton with shared package, web app shell, server app shell, workspace tooling, lint/typecheck/test scripts, and GitHub Actions.

Committable increment:
- pnpm workspace root configured
- `apps/web` Next.js 15 app boots locally
- `apps/server` TypeScript Node app boots locally
- `packages/shared` exports core shared types from the spec
- root scripts run install/dev/build/typecheck/test across workspaces
- MIT license, README, env examples, and baseline CI exist

Acceptance criteria:
- `pnpm install` succeeds
- `pnpm build` succeeds for all workspaces
- `pnpm typecheck` succeeds
- `pnpm test` succeeds with placeholder smoke coverage where real tests are deferred to later phases
- PR is opened and merged to `main`

## Phase 2 — Realtime server and MCP foundation
Branches: `phase-2/server`, `phase-2/shared-contracts`

Goal: implement the Node server with Yjs websocket rooms, session lifecycle, LevelDB-backed persistence, origin validation, and MCP Streamable HTTP tools.

Committable increment:
- `/ws/:roomId` websocket sync working through y-websocket-compatible server wiring
- `/mcp` exposes `read_diagram`, `write_diagram`, `list_sessions`
- session manager cleanup timers implemented
- shared API/types contract finalized and published as artifact
- vitest unit tests for MCP tools, session cleanup, and origin validation

Acceptance criteria:
- server can read/write a deterministic test room
- list_sessions returns active sessions
- MCP writes update Yjs document state and append activity events
- tests cover valid, empty, invalid, and nonexistent-session cases
- PR is opened and merged to `main`

Dependencies:
- Requires Phase 1 scaffold merged
- Shared contract must be stable before frontend integration starts in earnest

## Phase 3 — Collaborative frontend MVP
Branches: `phase-3/frontend`, `phase-3/frontend-polish`

Goal: implement the session UX in Next.js with collaborative text editing, presence, activity feed, connection status, session routing, and Mermaid preview.

Committable increment:
- landing page creates/navigates to session IDs
- `/s/[id]` connects to websocket server and syncs text
- CodeMirror 6 + Yjs collaborative editing works across tabs
- Mermaid preview renders from canonical text with last-valid-diagram fallback on parse errors
- presence bar, top bar, share URL, and activity feed render from Yjs state
- connection status indicator shows reconnect state

Acceptance criteria:
- two browser tabs stay synchronized on same session
- presence and cursors are visible across users
- preview updates on edits and preserves last valid SVG on invalid input
- agent activity/presence can be rendered from shared state
- PR is opened and merged to `main`

Dependencies:
- Requires Phase 2 server API and shared contracts merged

## Phase 4 — End-to-end verification and deployment readiness
Branches: `phase-4/qa`, `phase-4/deploy`

Goal: verify all required flows with Playwright/unit tests, then prepare deployment config for Vercel + Fly.io.

Committable increment:
- 7 required test cases covered via Playwright and targeted unit/integration tests
- local dev/test orchestration documented
- deployment config and env docs added

Acceptance criteria:
- P0 flows pass end-to-end: multiplayer sync, MCP agent write, new session creation
- remaining required behaviors are covered by stable E2E or unit/integration tests
- deployment instructions/config are present for Vercel and Fly.io
- PR is opened and merged to `main`

Dependencies:
- Requires Phases 2 and 3 merged
