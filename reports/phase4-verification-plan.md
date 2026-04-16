# Phase 4 verification plan

Repo: MermaidFlow
Prepared during Phase 3 kickoff, based on current Phase 4 requirements in `docs/phase-plan.md:69-86` and current repo state as of this review.

## Current state snapshot

Validated locally:
- `pnpm test` ✅
- `pnpm typecheck` ✅
- `pnpm build` ✅

Observed implementation state:
- Backend Phase 2 foundation is present and green:
  - `/health` and `/mcp` routes in `apps/server/src/index.ts:23-46`
  - websocket upgrade path under `/ws/:roomId` in `apps/server/src/index.ts:49-63`
  - MCP tools tested in `apps/server/src/lib/mcp.test.ts:34-156`
- Frontend is still mostly scaffolded, not yet at Phase 3 acceptance:
  - landing page still says Phase 1 scaffold in `apps/web/src/app/page.tsx:14-16`
  - session route still says `Scaffold only` in `apps/web/src/app/s/[id]/page.tsx:19-21`
  - no websocket/Yjs/CodeMirror/Mermaid/presence/activity implementation found under `apps/web/src`
- No Playwright or E2E harness is wired yet.
- No Vercel/Fly deployment config is present yet.

## Phase 4 target interpretation

Per `docs/phase-plan.md:72-82`, Phase 4 must deliver:
1. 7 required test cases covered via Playwright and targeted unit/integration tests
2. local dev/test orchestration docs
3. deployment config + env docs for Vercel and Fly.io
4. passing P0 end-to-end flows:
   - multiplayer sync
   - MCP agent write
   - new session creation

## Proposed executable test matrix

The matrix below is designed to be run once Phase 3 lands. It separates P0 end-to-end coverage from lower-level integration/unit coverage so failures are easier to localize.

### P0 end-to-end cases (must pass before Phase 4 signoff)

| ID | Priority | Flow | Level | Preconditions | Steps | Expected result |
|---|---|---|---|---|---|---|
| E2E-01 | P0 | New session creation from landing page | Playwright | Web and server running on fixed local URLs; deterministic session creation path available | Open `/`; click create/start session CTA; capture routed session id | Browser navigates to `/s/:id`; session id matches contract (`[a-z0-9_-]{6,32}`); editor and preview shell load without console errors |
| E2E-02 | P0 | Multiplayer sync across two browser contexts | Playwright | Same session URL opened in two contexts/users | User A edits Mermaid text; wait for sync in User B | Editor contents converge in both tabs; no disconnect loop; preview/state updates consistently |
| E2E-03 | P0 | MCP agent write reflected in active browser session | Playwright + HTTP helper | Active session open in browser; backend `/mcp` reachable | Browser opens session; test posts `write_diagram` to `/mcp`; browser waits for UI update | Editor/preview update to MCP-written Mermaid text; activity feed shows agent action attribution; no page reload required |

### Required non-P0 behavior coverage

| ID | Priority | Flow | Level | Preconditions | Steps | Expected result |
|---|---|---|---|---|---|---|
| E2E-04 | P1 | Last-valid Mermaid preview fallback on parse error | Playwright | Session open with known-good diagram rendered | Type invalid Mermaid; observe error state; then fix diagram | Last valid SVG remains visible while parse error is shown; after fix, preview updates to new valid diagram |
| E2E-05 | P1 | Presence / connection indicator behavior | Playwright | Two browser contexts in same session; ability to stop/restart server or simulate disconnect | Observe presence entries in both tabs; interrupt websocket/server; restore connectivity | Presence count/users appear across tabs; connection state moves through reconnect/disconnected/connected states without stale UI |
| INT-06 | P1 | Browser-facing MCP HTTP semantics | Server integration test | Test app booted with allowed/disallowed origins | Exercise success, malformed JSON, unsupported tool, nonexistent session, disallowed origin, optional preflight | Success returns 200 + `{result}`; validation failures are deterministic; disallowed origin returns 403; preflight/CORS behavior matches deployment design |
| INT-07 | P1 | Session routing and validation boundaries | Web unit/integration test | None | Test valid ids, invalid ids, deterministic creation helper, deep link load | Valid ids render session page; invalid ids 404; create/join path produces testable route behavior |

## Additional recommended coverage if time allows

These are not the minimum 7, but they materially reduce release risk.

| ID | Priority | Flow | Level | Why it matters |
|---|---|---|---|---|
| E2E-08 | P1 | Share URL copy/join flow | Playwright | Verifies collaboration entry point works outside initial create flow |
| E2E-09 | P1 | Activity feed ordering and duplicate-event resistance | Playwright or integration | Protects against noisy Yjs/MCP state races |
| E2E-10 | P1 | Refresh/reopen persisted session state | Playwright | Verifies backend persistence survives browser reload/new client join |
| E2E-11 | P2 | Invalid session id URL handling | Playwright | Confirms routing guard and not-found UX |
| INT-12 | P2 | `/health` response contract | Server integration | Useful for Fly readiness probes and smoke tests |

## Execution order for Phase 4

1. **Smoke gate**
   - `pnpm test`
   - `pnpm typecheck`
   - `pnpm build`
2. **Targeted backend integration tests**
   - MCP HTTP semantics
   - `/health`
   - websocket/origin edge cases if added
3. **Frontend integration/unit tests**
   - session route validation
   - deterministic session creation helper
   - parse-state reducer/hooks if introduced
4. **Playwright E2E**
   - E2E-01 through E2E-05
5. **Deployment smoke**
   - verify env wiring against preview/prod URLs
   - verify health endpoint and browser-to-server origin behavior

## Concrete deployment-readiness checklist

### A. Environment and docs
- [ ] Root README updated from Phase 1 scaffold language (`README.md:26-28`) to current architecture and runbook
- [ ] Local dev instructions document how to run web + server together
- [ ] Local E2E instructions document exact commands, ports, and test data isolation
- [ ] Canonical env docs exist for both apps
- [ ] `apps/server/.env.example` matches actual runtime variables from `apps/server/src/lib/env.ts:24-31`
- [ ] `apps/web/.env.example` variables are actually consumed by frontend code
- [ ] Preview and production origin values are documented for `ALLOWED_ORIGINS`

### B. Vercel readiness (web)
- [ ] Web deployment root/build settings documented or encoded in `vercel.json`
- [ ] `NEXT_PUBLIC_SERVER_URL` set to Fly/server URL
- [ ] `NEXT_PUBLIC_WS_URL` set to `wss://...`
- [ ] Session route `/s/[id]` works under deployed base URL
- [ ] Browser console free of mixed-content/CORS errors in preview environment

### C. Fly.io readiness (server)
- [ ] `fly.toml` added
- [ ] Server container/process definition exists (`Dockerfile` or equivalent)
- [ ] Health check targets `/health`
- [ ] Persistent storage strategy for `DATA_DIR` is defined if persistence is required across restarts
- [ ] `PORT` respected by runtime
- [ ] graceful shutdown behavior verified during Fly stop/redeploy

### D. Cross-origin/browser integration
- [ ] Browser calls from Vercel web to Fly server succeed for `/mcp`
- [ ] CORS response headers are emitted if browser MCP calls are expected
- [ ] `OPTIONS` preflight handling exists if required by frontend request shape
- [ ] `ALLOWED_ORIGINS` includes preview + production web origins
- [ ] Websocket origin rules are tested against deployed web origin

### E. QA automation/CI
- [ ] Playwright config added
- [ ] `test:e2e` script added at root or workspace level
- [ ] CI job boots both services and runs E2E suite
- [ ] CI uploads Playwright traces/screenshots/videos on failure
- [ ] E2E uses isolated server data dir to avoid cross-test contamination

### F. Release verification
- [ ] P0 flows pass locally
- [ ] P0 flows pass in CI
- [ ] Health endpoint returns 200 in deployed environment
- [ ] Manual browser smoke confirms create, sync, MCP write, reconnect, and share/join flows

## Hooks / instrumentation the teams should add now

These are the highest-value preparatory additions. They are small and materially reduce Phase 4 friction.

### Frontend
1. **Stable test selectors**
   Add `data-testid` to at least:
   - create-session CTA
   - optional join-session input/button
   - session-id label
   - editor root
   - preview root
   - parse-error banner
   - connection-status badge
   - presence bar
   - activity feed
   - share URL control

   Why now: there are currently no test selectors in `apps/web/src`, so Playwright would otherwise depend on volatile text/CSS.

2. **Deterministic session creation hook**
   Current session creation uses `Math.random()` in `apps/web/src/lib/session.ts:4-6`.
   Add one of:
   - a join/create text input for explicit session ids
   - a test-only query param override
   - a helper function that can be seeded or mocked cleanly

   Why now: Phase 4 E2E needs reproducible URLs and easier cross-tab coordination.

3. **Machine-readable readiness states**
   Expose explicit UI states for:
   - websocket connected / reconnecting / disconnected
   - preview valid / invalid / last-valid-rendered
   - initial session loading / ready

   Why now: E2E waits become stable and assertions become precise.

4. **Consume public env vars in app code**
   `apps/web/.env.example` already defines `NEXT_PUBLIC_SERVER_URL` and `NEXT_PUBLIC_WS_URL`, but current frontend code does not use them.

   Why now: deployment and local E2E orchestration both depend on explicit configurable endpoints.

### Backend
5. **CORS + preflight decision implemented early**
   `docs/planner-phase-gate.md:19-23` already flags missing CORS headers. `apps/server/src/lib/http.ts:18-21` currently sets only `content-type`.

   Why now: if frontend talks to `/mcp` directly from the browser in deployed environments, this becomes a blocker late in Phase 4.

6. **More diagnostic HTTP error mapping**
   `apps/server/src/index.ts:34-41` currently collapses all MCP errors to HTTP 400.
   Prefer separating:
   - validation errors → 400
   - not found / missing session → 404 if intended
   - unexpected server/storage failures → 500

   Why now: Phase 4 debugging and deployment smoke checks become much faster with better error classes.

7. **Request/connection observability hooks**
   Add lightweight structured logging for:
   - MCP tool name + status code + duration
   - websocket connect/disconnect/reject reason
   - startup env summary (without secrets)

   Why now: deploy smoke failures will otherwise be hard to root-cause.

8. **Health/readiness expansion**
   `/health` currently returns static metadata only.
   Consider including version/build info and readiness of storage/open server components if low-risk.

   Why now: Fly health checks and post-deploy smoke tests benefit from a more meaningful readiness signal.

## Risks already visible before Phase 3 lands

1. **Frontend is not near Phase 3 acceptance yet**
   Most of the behaviors Phase 4 must verify do not exist today.
2. **Deployment config is entirely absent**
   No `vercel.json`, `fly.toml`, or container config exists.
3. **Cross-origin behavior is likely the first deployment blocker**
   Origin allowlisting exists, but browser CORS response behavior does not.
4. **Current env examples are inaccurate/incomplete**
   `apps/server/.env.example` does not match `loadServerEnv()`.

## Recommended Phase 4 exit criteria

Do not mark Phase 4 complete until all are true:
- the 7 required matrix items above are implemented and passing
- P0 flows pass in Playwright against real web + server processes
- CI runs the E2E suite automatically
- deployment docs/config exist for both Vercel and Fly.io
- preview/prod env and origin wiring are documented and verified
