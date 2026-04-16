# Phase 4 verification plan

Repo: MermaidFlow
Prepared during Phase 3 kickoff, then refreshed after the Phase 2 + 3 implementation landed and Phase 4 hardening began.

## Current state snapshot

Validated locally before this refresh:
- `pnpm test` ✅
- `pnpm typecheck` ✅
- `pnpm build` ✅

Observed implementation state:
- Backend Phase 2 foundation is present:
  - `/health` and `/mcp` routes in `apps/server/src/index.ts`
  - websocket upgrade path under `/ws/:roomId` in `apps/server/src/index.ts`
  - MCP tools tested in `apps/server/src/lib/mcp.test.ts`
  - origin allowlisting and browser-facing `/mcp` CORS/preflight coverage in server tests
- Frontend Phase 3 MVP is present:
  - landing page supports create and join flows in `apps/web/src/components/landing-page-client.tsx`
  - `/s/[id]` validates session ids in `apps/web/src/app/s/[id]/page.tsx`
  - collaborative workspace lives in `apps/web/src/components/session-workspace.tsx`
  - CodeMirror + Yjs + Mermaid preview + presence + activity feed are implemented under `apps/web/src`
  - frontend endpoint configuration uses `NEXT_PUBLIC_SERVER_URL` and `NEXT_PUBLIC_WS_URL` from `apps/web/src/lib/session.ts`
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

The matrix below assumes the current Phase 2 + 3 implementation and focuses on Phase 4 verification gaps.

### P0 end-to-end cases (must pass before Phase 4 signoff)

| ID | Priority | Flow | Level | Preconditions | Steps | Expected result |
|---|---|---|---|---|---|---|
| E2E-01 | P0 | New session creation from landing page | Playwright | Web and server running on fixed local URLs | Open `/`; click create session CTA; capture routed session id | Browser navigates to `/s/:id`; session id matches contract (`[a-z0-9_-]{6,32}`); workspace loads without console errors |
| E2E-02 | P0 | Multiplayer sync across two browser contexts | Playwright | Same session URL opened in two contexts/users | User A edits Mermaid text; wait for sync in User B | Editor contents converge in both tabs; no disconnect loop; preview/state updates consistently |
| E2E-03 | P0 | MCP agent write reflected in active browser session | Playwright + HTTP helper | Active session open in browser; backend `/mcp` reachable | Browser opens session; test posts `write_diagram` to `/mcp`; browser waits for UI update | Editor/preview update to MCP-written Mermaid text; activity feed shows agent action attribution; no page reload required |

### Required non-P0 behavior coverage

| ID | Priority | Flow | Level | Preconditions | Steps | Expected result |
|---|---|---|---|---|---|---|
| E2E-04 | P1 | Last-valid Mermaid preview fallback on parse error | Playwright | Session open with known-good diagram rendered | Type invalid Mermaid; observe error state; then fix diagram | Last valid SVG remains visible while parse error is shown; after fix, preview updates to new valid diagram |
| E2E-05 | P1 | Presence / connection indicator behavior | Playwright | Two browser contexts in same session; ability to stop/restart server or simulate disconnect | Observe presence entries in both tabs; interrupt websocket/server; restore connectivity | Presence count/users appear across tabs; connection state moves through reconnect/disconnected/connected states without stale UI |
| INT-06 | P1 | Browser-facing MCP HTTP semantics | Server integration test | Test app booted with allowed/disallowed origins | Exercise success, malformed JSON, unsupported tool, nonexistent session, disallowed origin, and preflight | Success returns 200 + `{result}`; validation failures are deterministic; disallowed origin returns 403; preflight/CORS behavior matches deployment design |
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
   - MCP HTTP semantics, including CORS/preflight
   - `/health`
   - websocket/origin edge cases
3. **Frontend integration/unit tests**
   - session route validation
   - deterministic session creation helper if introduced
   - parse-state reducer/hooks/selectors if introduced
4. **Playwright E2E**
   - E2E-01 through E2E-05
5. **Deployment smoke**
   - verify env wiring against preview/prod URLs
   - verify health endpoint and browser-to-server origin behavior

## Concrete deployment-readiness checklist

### A. Environment and docs
- [x] Root README updated to current architecture and run/build/test workflow
- [x] Local dev instructions document how to run web + server together
- [ ] Local E2E instructions document exact commands, ports, and test data isolation
- [ ] Canonical env docs exist for both apps
- [x] `apps/server/.env.example` matches actual runtime variables from `apps/server/src/lib/env.ts`
- [x] `apps/web/.env.example` variables are consumed by frontend code
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
- [x] `PORT` respected by runtime
- [ ] graceful shutdown behavior verified during Fly stop/redeploy

### D. Cross-origin/browser integration
- [ ] Browser calls from Vercel web to Fly server succeed for `/mcp`
- [x] CORS response headers are emitted for browser MCP calls
- [x] `OPTIONS` preflight handling exists for deployed frontend request shapes
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

### Frontend
1. **Stable test selectors**
   Add `data-testid` to core controls and surfaces used by Phase 4 Playwright coverage.

2. **Deterministic session creation hook**
   Current create flow uses random ids, so E2E should either:
   - create through the landing page and capture the resulting URL, or
   - add an explicit deterministic override/helper

3. **Machine-readable readiness states**
   Expose stable selectors/attributes for:
   - websocket connected / reconnecting / disconnected
   - preview valid / invalid / last-valid-rendered
   - initial session loading / ready

### Backend
4. **Diagnostic HTTP error mapping**
   `apps/server/src/index.ts` still collapses MCP application errors to HTTP 400.
   Prefer separating validation errors, not found, and unexpected failures if low-risk.

5. **Request/connection observability hooks**
   Add lightweight structured logging for:
   - MCP tool name + status code + duration
   - websocket connect/disconnect/reject reason
   - startup env summary (without secrets)

6. **Health/readiness expansion**
   `/health` currently returns static metadata only.
   Consider including version/build info and readiness of storage/open server components if low-risk.

## Risks still visible

1. **Deployment config is still absent**
   No `vercel.json`, `fly.toml`, or container config exists.
2. **Phase 4 automation is still absent**
   There is no Playwright harness or CI E2E job yet.
3. **Cross-origin success is improved but not deployed-verified**
   `/mcp` now has explicit browser CORS/preflight handling, but preview/prod origin wiring still needs deployment validation.
4. **Websocket deployed-origin behavior still needs explicit testing**
   HTTP CORS is addressed separately from websocket origin checks.

## Recommended Phase 4 exit criteria

Do not mark Phase 4 complete until all are true:
- the 7 required matrix items above are implemented and passing
- P0 flows pass in Playwright against real web + server processes
- CI runs the E2E suite automatically
- deployment docs/config exist for both Vercel and Fly.io
- preview/prod env and origin wiring are documented and verified
