# ArielCharts

ArielCharts is a collaborative Mermaid diagram editor with a Next.js web client, a Node.js realtime/MCP server, and shared TypeScript contracts.

## Current architecture

The repo now includes the Phase 2 + Phase 3 implementation baseline:

- `apps/web` — Next.js 15 app with:
  - landing page to create or join sessions
  - `/s/[id]` session route with route validation
  - CodeMirror 6 + Yjs collaborative editor
  - Mermaid preview with last-valid-SVG fallback on parse errors
  - presence strip, activity feed, share URL, and connection status UI
  - configurable server/websocket endpoints via `NEXT_PUBLIC_SERVER_URL` and `NEXT_PUBLIC_WS_URL`
- `apps/server` — Node.js TypeScript server with:
  - protected-room creation, browser access exchange, key rotation, and cookie-gated Yjs/history routes
  - modern-only MCP `2026-07-28` `POST /mcp` endpoint for the one room named by its bearer capability (`getSession`, `createDiagram`, `readDiagram`, `listDiagramHistory`, `readDiagramRevision`, `writeDiagram`, `renameDiagram`, `deleteDiagram`, and `restoreDiagramRevision`)
  - `OPTIONS /mcp` preflight handling and CORS response headers for browser-origin MCP requests
  - `/health` health endpoint
  - cookie-authorized `/ws/:roomId` Yjs-compatible websocket rooms
  - LevelDB-backed session persistence and cleanup timers
  - origin allowlisting via `ALLOWED_ORIGINS`
- `packages/shared` — shared contracts and types consumed by both apps

## Workspace layout

- `apps/web`
- `apps/server`
- `packages/shared`
- `docs` — phase plan and shared contracts
- `reports` — verification and planning notes

## Prerequisites

- Node.js 24+
- pnpm 10+

## Environment setup

### Web

Copy `apps/web/.env.example` to `apps/web/.env.local` and adjust as needed:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Default local values:

- `NEXT_PUBLIC_SERVER_URL=http://localhost:4000`
- `NEXT_PUBLIC_WS_URL=ws://localhost:4000`

### Server

The server reads configuration from environment variables with sensible defaults for local development. No `.env` file is needed for `pnpm dev`. To override values, export them in your shell or use a tool like `dotenv-cli`.

Runtime variables used by `apps/server/src/lib/env.ts`:

- `PORT` — HTTP port, defaults to `4000`
- `DATA_DIR` — LevelDB/session storage directory, defaults to `.data/arielcharts`
- `CLEANUP_INTERVAL_MS` — cleanup timer interval
- `SESSION_TTL_MS` — idle session TTL before cleanup
- `ALLOWED_ORIGINS` — comma-separated browser/websocket origin allowlist
- `ROOM_COOKIE_SECRET` — long random production secret used to sign room cookies; required when `NODE_ENV=production`
- `ROOM_COOKIE_TTL_MS` — browser-access cookie lifetime, defaulting to eight hours
- `ROOM_COOKIE_SECURE` — set `true` in production
- `ROOM_COOKIE_SAME_SITE` — `Lax`, `Strict`, or `None`; use `Lax` for the canonical same-site deployment below
- `CLIENT_ADDRESS_PROFILE` — `none` locally/default; `fly` trusts only one valid `Fly-Client-IP` header and ignores `X-Forwarded-For`
- `UV_THREADPOOL_SIZE` — pinned to `2` on Fly to bound concurrent scrypt memory; do not increase it on the single machine

For local development, `ALLOWED_ORIGINS=http://localhost:3000` is sufficient for the default Next.js dev server.

### Production room-access topology

Use `https://arielcharts.donovanyohan.com` for the web app and
`https://api.arielcharts.donovanyohan.com` for HTTP, WebSocket, and MCP. They
are same-site subdomains, so the browser origin allowlist should contain the
web origin exactly:

```bash
ALLOWED_ORIGINS=https://arielcharts.donovanyohan.com
ROOM_COOKIE_SECRET=<long-random-secret>
ROOM_COOKIE_SECURE=true
ROOM_COOKIE_SAME_SITE=Lax
CLIENT_ADDRESS_PROFILE=fly
UV_THREADPOOL_SIZE=2
```

Each production scrypt verification uses roughly 128 MiB through Node's shared
libuv pool. `fly.toml` pins the server to shared-cpu-1x with 512 MiB so two
bounded verifications plus Node/Yjs overhead do not rely on Fly's default
memory. A process-wide queued-work limiter remains follow-up security debt.

Set `NEXT_PUBLIC_SERVER_URL=https://api.arielcharts.donovanyohan.com` and
`NEXT_PUBLIC_WS_URL=wss://api.arielcharts.donovanyohan.com` in the web
deployment. Do not use wildcard origins, put a room key in a query string, or
use `SameSite=None` merely to bridge unrelated production domains.

## Local development

Install dependencies once:

```bash
pnpm install
```

Run both apps together from the repo root:

```bash
pnpm dev
```

This starts:

- web app on `http://localhost:3000`
- server on `http://localhost:4000`

You can also run each workspace separately:

```bash
pnpm --filter @arielcharts/server dev
pnpm --filter @arielcharts/web dev
```

## Build, typecheck, and test

Run the full workspace checks from the repo root:

```bash
pnpm build
pnpm typecheck
pnpm test
```

Run server-only checks:

```bash
pnpm --filter @arielcharts/server build
pnpm --filter @arielcharts/server typecheck
pnpm --filter @arielcharts/server test
```

Run web-only checks:

```bash
pnpm --filter @arielcharts/web build
pnpm --filter @arielcharts/web typecheck
pnpm --filter @arielcharts/web test
```

For the protected collaboration boundary, run:

```bash
pnpm test:e2e-collaboration
```

After a deployment to the canonical DNS names, run the production smoke gate
explicitly. It creates and rotates a real private room, so it refuses any
other target:

```bash
E2E_PRODUCTION_SMOKE=1 \
E2E_BASE_URL=https://arielcharts.donovanyohan.com \
E2E_MCP_URL=https://api.arielcharts.donovanyohan.com/mcp \
pnpm test:e2e-production-smoke
```

## Core HTTP and websocket contracts

- `POST /mcp` implements MCP protocol `2026-07-28`. It is modern-only: use `server/discover` instead of `initialize`; requests carry the MCP protocol envelope plus `MCP-Protocol-Version`, `Mcp-Method`, and (for `tools/call`) `Mcp-Name` headers. MCP transport sessions and `Mcp-Session-Id` are not used.
- `POST /api/rooms` creates the only kind of room: a protected one. It returns `{ session_id, room_key }`; share it as `https://…/s/<sessionId>#roomKey=<roomKey>`. The fragment is exchanged for a signed, HttpOnly room cookie and removed before the workspace mounts. A bare room URL shows the RoomGate instead of session content.
- `POST /api/rooms/:sessionId/access` exchanges a room key for that browser cookie. `POST /api/rooms/:sessionId/rotate` requires that cookie, returns a replacement key, advances the access version, and closes current room sockets. Keep the raw key in memory only; a cookie-only reload can open an already-authorized room but cannot re-share its key.
- MCP is room-scoped rather than a session directory. Configure `Authorization: Bearer <sessionId>.<roomKey>` on every MCP request. The bearer may access only that session; no `listSessions` discovery capability exists.
- ArielCharts collaboration is application state, not MCP transport state: pass the authorized `sessionId` and stable `diagramId` to diagram tools. Always call `getSession` before creating a tab, then pass its fresh session revision as `expectedRevision`. Immediately before writing, renaming, deleting, or restoring a tab, call `readDiagram` and use its latest diagram revision. On a stale-revision error, re-read, merge deliberately, and retry only with that fresh revision—never blindly overwrite.
- `OPTIONS /mcp` supports browser preflight for the protocol headers above.
- `/health` returns a simple readiness payload
- `/ws/:roomId` hosts Yjs collaboration rooms only after the browser has a valid room cookie

The detailed contract source of truth lives in `docs/shared-contracts.md` and `packages/shared/src/types.ts`.

## Current status

- Phase 1 scaffold: complete
- Phase 2 realtime server + MCP foundation: implemented
- Phase 3 collaborative frontend MVP: implemented
- Phase 4 deployment/E2E hardening: in progress
