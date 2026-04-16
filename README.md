# MermaidFlow

MermaidFlow is a collaborative Mermaid diagram editor with a Next.js web client, a Node.js realtime/MCP server, and shared TypeScript contracts.

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
  - `POST /mcp` MCP HTTP endpoint for `read_diagram`, `write_diagram`, and `list_sessions`
  - `OPTIONS /mcp` preflight handling and CORS response headers for browser-origin MCP requests
  - `/health` health endpoint
  - `/ws/:roomId` Yjs-compatible websocket rooms
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

Copy `apps/server/.env.example` to `apps/server/.env` and adjust as needed:

```bash
cp apps/server/.env.example apps/server/.env
```

Runtime variables used by `apps/server/src/lib/env.ts`:

- `PORT` — HTTP port, defaults to `4000`
- `DATA_DIR` — LevelDB/session storage directory, defaults to `.data/mermaidflow`
- `CLEANUP_INTERVAL_MS` — cleanup timer interval
- `SESSION_TTL_MS` — idle session TTL before cleanup
- `ALLOWED_ORIGINS` — comma-separated browser/websocket origin allowlist

For local development, `ALLOWED_ORIGINS=http://localhost:3000` is sufficient for the default Next.js dev server.

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
pnpm --filter @mermaidflow/server dev
pnpm --filter @mermaidflow/web dev
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
pnpm --filter @mermaidflow/server build
pnpm --filter @mermaidflow/server typecheck
pnpm --filter @mermaidflow/server test
```

Run web-only checks:

```bash
pnpm --filter @mermaidflow/web build
pnpm --filter @mermaidflow/web typecheck
pnpm --filter @mermaidflow/web test
```

## Core HTTP and websocket contracts

- `POST /mcp` accepts `{ tool, input }` JSON and returns `{ result }`
- `OPTIONS /mcp` supports browser preflight for deployed web-to-server requests
- `/health` returns a simple readiness payload
- `/ws/:roomId` hosts Yjs collaboration rooms

The detailed contract source of truth lives in `docs/shared-contracts.md` and `packages/shared/src/types.ts`.

## Current status

- Phase 1 scaffold: complete
- Phase 2 realtime server + MCP foundation: implemented
- Phase 3 collaborative frontend MVP: implemented
- Phase 4 deployment/E2E hardening: in progress
