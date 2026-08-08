# Server context

`src/lib/session-manager.ts` owns the in-memory Yjs session and its LevelDB
snapshot. `websocket.ts` replicates that document and awareness. `mcp.ts` is
the internal tool boundary; `mcp-server.ts` exposes the modern MCP contract;
`index.ts` owns HTTP lifecycle and routing.

## Durable-document invariants

- The root Yjs keys are `diagrams`, `diagramOrder`, `activity`, and `presence`.
  A diagram contains `name`, `mermaid` (`Y.Text`), and `nodePositions`
  (`Y.Map`). Preserve this shape or migrate it deliberately with persistence
  coverage.
- The server initializes exactly one `main`/`Main` diagram before clients can
  observe a new session. Server and MCP commands retain at least one diagram;
  raw browser Yjs writes can currently bypass that guard and produce zero.
  Deterministic name reconciliation is current behavior; zero-tab
  preservation/reseeding is a #13 invariant and proof target.
- Server-owned document mutations are transactions. Persist only a coherent
  document snapshot after mutation or accepted websocket sync.
- `getSession`/create use a whole-session revision; read/write/rename/delete
  use the target diagram revision. Revisions are server-derived, checked
  before mutation, and stale errors are retry instructions—not permission to
  overwrite.

## Collaboration and protocol boundaries

- Awareness is live, per-connection presence. Do not put browser-local UI
  state in awareness or durable document state. If presence persistence is
  changed, keep the snapshot/listing reason explicit and test cleanup and
  reconnect behavior.
- Keep activity as a bounded collaboration feed. It is not a version-history
  store; snapshots/restore need their own revision model.
- `POST /mcp` is modern-only MCP `2026-07-28`; application `sessionId` and
  `diagramId` are explicit tool inputs, not MCP transport-session state. Keep
  header validation and CORS behavior covered in `src/index.test.ts`.

Run the server suite with `pnpm --filter @arielcharts/server test`; use the
root gates for a cross-package or protocol change.
