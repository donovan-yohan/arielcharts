# MermaidFlow planner phase gate

## Phase 2 gate decision
Status: **greenlit for Phase 3 frontend integration**

### Evidence checked
- `pnpm --filter @mermaidflow/server test`
- `pnpm --filter @mermaidflow/server typecheck`
- `pnpm --filter @mermaidflow/server build`

All passed after Phase 2 hardening.

### Phase 2 quality notes
- Websocket server now uses y-websocket-style sync and awareness framing.
- Reopen-after-cleanup regression is covered by `apps/server/src/lib/websocket.test.ts`.
- MCP, origin validation, cleanup, and HTTP integration have direct test coverage.
- Shared backend/frontend contract is documented in `docs/shared-contracts.md`.

### Non-blocking risks to carry forward
1. HTTP CORS response headers are not yet emitted even though origin allow/deny checks exist.
2. Session persistence currently rewrites the full encoded Yjs document on each persisted update; acceptable for MVP, but a scalability risk.
3. Backend activity feed semantics are still strongest for MCP writes; frontend join/leave/edit activity may need additional implementation decisions during Phase 3.
4. Participant persistence is name-keyed, so duplicate display names can collapse; acceptable to defer unless Phase 3 UX depends on exact duplicate-name handling.

## Next orchestration decisions
### Phase 3
Proceed with full frontend MVP implementation in `apps/web`, consuming the stabilized Phase 2 contracts.

Acceptance targets:
- landing page creates/navigates to session ids
- `/s/[id]` connects to websocket server and syncs text
- CodeMirror 6 + Yjs collaborative editing across tabs
- Mermaid preview with last-valid-diagram fallback on parse errors
- presence bar, top bar, share URL, activity feed, connection indicator

### Phase 4 prep
QA can begin planning the end-to-end matrix and deployment readiness checklist in parallel, but final implementation depends on merged Phase 3 flows.
