# ArielCharts

ArielCharts is a collaborative Mermaid workspace for people and agents. A
browser user and an MCP client work on the same named diagrams in real time,
while Mermaid source remains the canonical representation.

## What it does

- Creates private, capability-protected rooms with share links that exchange a
  fragment-only room key for an HttpOnly browser cookie.
- Keeps named diagram tabs, Mermaid source, accepted node positions, activity,
  and agent membership convergent through Yjs.
- Provides a canvas-first workspace with CodeMirror source editing, flowchart
  structure controls, sequence participant/message controls, last-valid SVG
  fallback, local camera/selection state, and responsive light/dark themes.
- Includes a catalog-backed starter for every built-in Mermaid family plus blank sheets,
  ER diagrams, state machines, timelines, and deployment diagrams.
- Stores immutable per-diagram revision history that can be previewed and
  deliberately restored as a new revision.
- Exposes a room-scoped, revision-checked MCP server so agents can safely read,
  create, update, rename, delete, inspect history, and restore named tabs.

## Architecture and repository map

Start with [ARCHITECTURE.md](ARCHITECTURE.md) for the stack and request/data
flows. [docs/context-map.md](docs/context-map.md) is the detailed ownership,
invariant, scaling, and evidence map. Public shapes live in
[packages/shared/src/types.ts](packages/shared/src/types.ts).

| Path | Purpose |
| --- | --- |
| `apps/web` | Next.js 16 / React browser workspace, including the editor, canvas, room gate, and local interaction state. |
| `apps/server` | Node.js TypeScript HTTP, WebSocket, Yjs, LevelDB, protected-room, history, and MCP service. |
| `packages/shared` | Browser- and server-neutral contracts, Mermaid/source helpers, and starter-template registry. |
| `docs` | Current context and architecture documents; `arielcharts-spec.md` is explicitly historical product-planning material. |
| `e2e` and `e2e-*-validate.ts` | Playwright support plus focused browser/collaboration validation. |
| `reports` | Design and verification artifacts. |

## Prerequisites

- Node.js 24 or newer
- pnpm 10.15.0 (the version pinned in `package.json` and CI)

If `pnpm` is not installed, use `npx --yes pnpm@10.15.0` in place of `pnpm`
in the commands below.

## Local development

Install dependencies once:

```bash
pnpm install
```

The browser defaults to `http://localhost:3000`; the server defaults to
`http://localhost:4000`. Credentialed browser requests require an explicit
allowed origin, so start the default pair with:

```bash
ALLOWED_ORIGINS=http://localhost:3000 pnpm dev
```

To override the browser's public endpoints, copy the app-local example before
starting Next.js:

```bash
cp apps/web/.env.example apps/web/.env.local
```

Or start them separately:

```bash
ALLOWED_ORIGINS=http://localhost:3000 pnpm --filter @arielcharts/server dev
pnpm --filter @arielcharts/web dev
```

`apps/server/.env.example` is an environment-variable inventory, not a file
that the server loads automatically. Export server variables in your shell or
use a dotenv runner deliberately. The root [.env.example](.env.example) is a
small cross-workspace reference only; normal commands read browser settings
from `apps/web/.env.local` and server settings from the process environment.

### Server configuration

Set `ALLOWED_ORIGINS=http://localhost:3000` for the normal `3000` web / `4000`
server pair. The server accepts these variables:

| Variable | Runtime default or rule |
| --- | --- |
| `PORT` | `4000` |
| `DATA_DIR` | `.data/arielcharts` |
| `CLEANUP_INTERVAL_MS` | `30000` |
| `SESSION_TTL_MS` | `300000` (five minutes of inactivity) |
| `DISK_TTL_MS` | `604800000` (seven days) |
| `ALLOWED_ORIGINS` | Comma-separated explicit browser origins; required for credentialed browser requests, including local development. |
| `ROOM_COOKIE_SECRET` | Required in production; use a unique, long random secret. |
| `ROOM_COOKIE_TTL_MS` | `28800000` (eight hours) |
| `ROOM_COOKIE_SECURE` / `ROOM_COOKIE_SAME_SITE` | Production defaults to secure cookies; `None` requires `ROOM_COOKIE_SECURE=true`. |
| `CLIENT_ADDRESS_PROFILE` | `none` locally; `fly` trusts only one valid `Fly-Client-IP` header. |
| `UV_THREADPOOL_SIZE` | Set to `2` for the documented single-machine Fly deployment. |

`TRUST_PROXY` is intentionally rejected; use `CLIENT_ADDRESS_PROFILE` instead.
`ROOM_ACCESS_CRYPTO_PROFILE=test` is guarded for `NODE_ENV=test` E2E use only
and must not be set in local or production deployment configuration.

## Verification

The baseline CI sequence is:

```bash
pnpm --filter @arielcharts/shared build
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Focused package checks are also available:

```bash
pnpm --filter @arielcharts/server test
pnpm --filter @arielcharts/web test
```

Install Chromium once for local Playwright runs:

```bash
pnpm exec playwright install chromium
```

### Browser and collaboration gates

| Command | Coverage | Service lifecycle |
| --- | --- | --- |
| `pnpm test:e2e-workspace-ux` | Production-mode workspace, templates, themes, flyouts, history, focus, layout, and responsive behavior. | Builds and owns loopback services on `3303` (web) and `4300` (server) by default. |
| `pnpm test:e2e-subgraphs` | Nested-subgraph editing and layout behavior. | Uses the same owned-service harness and default ports. |
| `pnpm test:e2e-collaboration` | Room access, cookie/key rotation, browser/MCP concurrency, awareness, persistence, and local-state isolation. | Uses the same owned-service harness and default ports. |
| `pnpm test:e2e-sequence` | Flowchart, sequence, and generic Mermaid canvas behavior, including screenshots in `/tmp`. | Requires a manually started web app on `3003` and server on `4000` unless endpoints are overridden. |
| `npx tsx e2e-validate.ts` | Legacy canvas interaction and alignment coverage. | Requires the same manually started `3003` web / `4000` server pair unless endpoints are overridden. |

The owned-service gates accept an external target only when both
`E2E_BASE_URL` and `E2E_MCP_URL` are set. For the manually started gates, use
three terminals:

```bash
# terminal 1
ALLOWED_ORIGINS=http://localhost:3003 PORT=4000 pnpm --filter @arielcharts/server dev

# terminal 2
PORT=3003 NEXT_PUBLIC_SERVER_URL=http://localhost:4000 NEXT_PUBLIC_WS_URL=ws://localhost:4000 pnpm --filter @arielcharts/web dev

# terminal 3
pnpm test:e2e-sequence
```

Run `npx tsx e2e-validate.ts` in terminal 3 instead when validating its legacy
coverage. Inspect `/tmp/arielcharts-sequence.png` and
`/tmp/arielcharts-sequence-isolation.png` after Mermaid canvas changes.

## Private rooms and MCP workflow

`POST /api/rooms` creates a protected room and returns a session ID plus room
key. Share the browser link as `/s/<sessionId>#roomKey=<roomKey>`: the browser
exchanges the fragment for an HttpOnly cookie and removes it before mounting
the workspace. The key is a capability; do not put it in query parameters,
browser storage, logs, or source control.

MCP uses `Authorization: Bearer <sessionId>.<roomKey>` for one room only. It
has no room-directory capability. Use the tool workflow below whenever an
agent changes a live workspace:

1. Call `getSession` before creating a tab and pass its returned session
   revision to `createDiagram`.
2. Call `readDiagram` immediately before writing, renaming, deleting, or
   restoring an existing tab; pass that diagram revision as `expectedRevision`.
3. On a stale write, re-read, merge the concurrent change deliberately, then
   retry with the fresh revision. Never replace a tab blindly.
4. Before restore, read the current diagram again. A stale restore is a no-op
   that requires review and explicit reconfirmation, not an automatic retry.

See [ARCHITECTURE.md](ARCHITECTURE.md) and
[docs/context-map.md](docs/context-map.md) for the HTTP, WebSocket, Yjs,
history, and MCP boundaries.

## Deployment topology

The configured topology uses a Vercel-hosted web app at
`https://arielcharts.donovanyohan.com` and a Fly-hosted server at
`https://api.arielcharts.donovanyohan.com`. The API host serves HTTP, MCP,
`/health`, and cookie-authorized Yjs at `/ws/:sessionId`; `fly.toml` provides
the persistent LevelDB mount and production cookie/origin settings.

Set the web deployment's public variables to the API host:

```bash
NEXT_PUBLIC_SERVER_URL=https://api.arielcharts.donovanyohan.com
NEXT_PUBLIC_WS_URL=wss://api.arielcharts.donovanyohan.com
```

Set `ALLOWED_ORIGINS=https://arielcharts.donovanyohan.com`, a real
`ROOM_COOKIE_SECRET`, `ROOM_COOKIE_SECURE=true`, `ROOM_COOKIE_SAME_SITE=Lax`,
`CLIENT_ADDRESS_PROFILE=fly`, and `UV_THREADPOOL_SIZE=2` for the server. The
main-branch CI deploy job publishes the server only after its baseline and
browser/collaboration gates succeed. The production smoke gate is intentionally
restricted to the canonical topology because it creates and rotates a real
private room:

```bash
E2E_PRODUCTION_SMOKE=1 \
E2E_BASE_URL=https://arielcharts.donovanyohan.com \
E2E_MCP_URL=https://api.arielcharts.donovanyohan.com/mcp \
pnpm test:e2e-production-smoke
```
