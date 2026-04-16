# Planner assessment: MermaidFlow Phase 2 resume

## Repo state observed
- `main` is at PR #1 scaffold commit (`e83f900`).
- Uncommitted server work exists in `apps/server` plus `docs/shared-contracts.md`.
- Current server build/typecheck/tests pass locally, but that is not sufficient to declare Phase 2 complete.

## Initial assessment of current Phase 2 backend work

### What looks good
- Clear separation of concerns across `mcp.ts`, `session-manager.ts`, `persistence.ts`, `origin.ts`, `http.ts`, `websocket.ts`, and `env.ts`.
- LevelDB-backed persistence is wired and unit-tested.
- MCP handlers validate payload shape and session ids.
- Cleanup path exists and tests cover idle-vs-active eviction.
- Shared contract artifact `docs/shared-contracts.md` exists and matches `packages/shared/src/types.ts` at a high level.

### Major gaps / risks before Phase 2 can be considered done
1. **Websocket protocol is too thin for Phase 3 integration**
   - `apps/server/src/lib/websocket.ts` currently forwards raw Yjs updates with a single custom message type byte.
   - This is not clearly `y-websocket`-compatible, and it does not appear to implement awareness/presence messaging required by Phase 3 acceptance criteria.
2. **Presence / awareness contract is not really implemented server-side**
   - `session-manager.ts` stores a `presence` map in the Y.Doc, but the websocket layer does not manage per-client awareness lifecycle.
   - This is likely a frontend blocker for presence bars/cursors/activity attribution.
3. **Timestamp semantics look unstable**
   - `SessionManager.snapshot()` sets `updatedAt: Date.now()` on every snapshot/read path, which can distort listing order and persistence semantics.
4. **MCP surface may not be sufficient for real Streamable HTTP expectations**
   - `/mcp` currently accepts a custom JSON envelope and returns `{ result }`; may be acceptable for local integration, but needs a deliberate decision against the intended MCP transport contract.
5. **Operational correctness needs sharper verification**
   - Tests currently cover unit-level behavior, but not websocket interoperability, persistence reload behavior after process restart, or end-to-end MCP-to-Yjs update propagation.
6. **Build output layout may need validation against runtime scripts**
   - `tsconfig` rootDir changes generate nested output paths; startup script compatibility should be rechecked.

## Coordination decision
- Do **not** begin full Phase 3 implementation until Phase 2 websocket/awareness behavior and shared contracts are stabilized.
- Frontend can still prepare a readiness assessment and identify independent UI work.

## Active delegations
- Backend specialist: complete/harden Phase 2 and verify acceptance criteria.
- Reviewer specialist: perform critical review of the current backend implementation and advise go/no-go for Phase 3.
- Frontend specialist: assess Phase 3 readiness and isolate work that can proceed independently.
