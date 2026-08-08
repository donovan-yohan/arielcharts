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
- Catalog repair validates diagram structure, canonicalizes order and names,
  and reseeds `main`/`Main` only when no valid diagram remains. It runs after
  raw Yjs updates and persisted loads with a server-private origin; preserve
  valid concurrent entries and cover changes in `src/lib/session-manager.test.ts`.
- Server-owned document mutations are transactions. Persist only a coherent
  document snapshot after mutation or accepted websocket sync.
- `writeDiagram` resolves canonical source membership before its replacement
  transaction. Accepted flowchart, generic, and blank source prunes obsolete
  `nodePositions`; invalid source preserves settled layout. Keep this policy in
  `@arielcharts/shared` so inactive MCP writes and active browser updates do
  not drift.
- `getSession`/create use a whole-session revision; read/write/rename/delete
  use the target diagram revision. Revisions are server-derived, checked
  before mutation, and stale errors are retry instructions—not permission to
  overwrite.

## Collaboration and protocol boundaries

- Awareness is live, per-connection presence. Do not put browser-local UI
  state in awareness or durable document state. Each live socket owns its
  claimed client ids; stale/idempotent foreign echoes are filtered, while
  novel or advancing foreign entries are rejected. Preserve reconnect-safe
  ownership cleanup and `src/lib/websocket.test.ts` coverage.
- Keep activity as a bounded collaboration feed. It is not a version-history
  store; MCP mutations identify the diagram and record applicable base/result
  revisions. Snapshots/restore need their own revision model.
- `POST /mcp` is modern-only MCP `2026-07-28`; application `sessionId` and
  `diagramId` are explicit tool inputs, not MCP transport-session state. Keep
  fetch-before-write revision checks, header validation, and CORS behavior
  covered in `src/lib/mcp.test.ts` and `src/index.test.ts`.

Run the server suite with `pnpm --filter @arielcharts/server test`; use the
root gates for a cross-package or protocol change.
