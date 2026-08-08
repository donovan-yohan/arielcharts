<!-- markdownlint-disable MD013 -->

# ArielCharts context map

## System shape

```text
Browser (Next.js) ── Yjs websocket ──> SessionManager ──> LevelDB snapshot
       │                                      ▲
       └─ Mermaid render / CodeMirror          │
MCP client ── POST /mcp ──> MCP tools ─────────┘
```

The browser and MCP tools write the same session document. Mermaid source is
canonical; the SVG and flowchart interaction model derive from it.

| Concern | Owner and source | Main files | Evidence |
| --- | --- | --- | --- |
| Session catalog | Durable Yjs `diagrams` map plus `diagramOrder`; server initializes `main`/`Main` | `apps/server/src/lib/session-manager.ts`, `packages/shared/src/types.ts` | `session-manager.test.ts` |
| Diagram content | Per-diagram `mermaid: Y.Text`, `name`, and `nodePositions: Y.Map` | `session-manager.ts`, `apps/web/src/components/session-workspace.tsx`, `apps/web/src/lib/diagram-layout.ts` | `session-manager.test.ts`, `diagram-layout.test.ts` |
| Realtime | `y-websocket` browser provider; server websocket protocol/awareness relay | `session-workspace.tsx`, `apps/server/src/lib/websocket.ts` | `websocket.test.ts` |
| MCP writes | Modern-only HTTP MCP maps camelCase tools to session-manager commands | `apps/server/src/lib/mcp-server.ts`, `mcp.ts`, `index.ts` | `mcp.test.ts`, `index.test.ts` |
| Source editing | CodeMirror + Yjs binding, per active tab | `session-workspace.tsx` | `apps/web/src/lib/session.test.ts` |
| Render/navigation | Mermaid SVG; canvas overlays and structural editing only for flowcharts | `session-workspace.tsx`, `diagram-canvas.tsx`, `svg-hit-map.ts` | Current `e2e-validate.ts` is flowchart-only; #12 requires generic, cross-tab SVG browser coverage. |
| Flowchart mutations | Mermaid AST -> mutation -> minimal Y.Text diff | `apps/web/src/lib/diagram-mutations.ts` | `diagram-mutations.test.ts`, `diagram-flow-identity.test.ts` |
| Persistence | LevelDB stores encoded Yjs state and derived session metadata | `apps/server/src/lib/persistence.ts`, `session-manager.ts` | `session-manager.test.ts` |

## State ownership

| State | Scope | Authority | Notes |
| --- | --- | --- | --- |
| Diagram ids, names, order, Mermaid source, node positions | Durable/session | Yjs document; server persists it | Stable diagram ids are the MCP target; names are human-facing aliases. |
| MCP revision | Request-time concurrency guard | SessionManager | Create checks the session revision; existing-tab mutations check that tab's revision. |
| Activity | Durable but bounded feed | Yjs document | Retain at most 100 events. It cannot substitute for version history. |
| Presence/cursors | Ephemeral collaboration | Yjs awareness | The server currently materializes a participant snapshot for session metadata; it must not become a store for browser UI state. |
| Active tab, camera, selection, toolbar, flyout, drafts | Browser local | React/local storage where appropriate | Never move these into Yjs merely to make UI react to remote edits. |
| Parsed SVG, hit map, flowchart snapshot | Derived browser state | Mermaid/mermaid-ast | Current last-valid state is active-tab derived; #12 requires per-tab isolation. |

## Ingress and concurrency flow

1. A browser attaches a `WebsocketProvider` to `/ws/:sessionId`; the server
   obtains or creates the authoritative Yjs document, relays updates, and
   persists accepted updates.
2. The browser switches only its local active-tab binding. CodeMirror writes
   the active diagram's Y.Text; visual flowchart edits use `MutationQueue` so
   the latest source is parsed and minimally diffed before the Yjs write.
3. An MCP client discovers tools, calls `getSession` to choose a stable id,
   then `readDiagram` before a replacement/rename/delete. The session manager
   checks the supplied current revision inside the mutation path, appends
   activity, persists, and broadcasts through the same Yjs document.
4. A stale MCP revision is a conflict signal: re-read, merge the current
   source, and retry. It must never result in a blind full-source overwrite.

## Extend versus refactor decisions for #12 and #13

| Decision | Direction | Reason and threshold |
| --- | --- | --- |
| Generic Mermaid preview | Extend the existing Mermaid SVG/canvas path | Mermaid already parses/renders sequence diagrams. Add viewBox-aware pan/zoom/Fit for generic SVG; do not introduce a second diagram renderer or a generic editable AST. |
| Flowchart capability detection | Refactor one classification seam before adding types | Replace source-prefix checks in `session-workspace.tsx` with Mermaid parser-result classification. The same result must control canvas controls, copy, and cached last-valid kind. |
| Per-tab render resilience | Introduce a small per-diagram render registry if needed | Last-valid SVG/kind must survive tab switching and invalid input independently. Do not use one global preview cache or reset unrelated tab state. |
| Human/MCP collaboration | Reuse Yjs plus server revision checks | They already converge document operations and prevent stale agent replacement. Do not add a second realtime database, lock service, or transport-session identity. |
| Interaction lifecycle | Extract only where an invariant cannot be tested in `session-workspace.tsx` | It currently binds provider, active-tab state, CodeMirror, rendering, activity, and local UI. Pull out focused tab/render or transaction-origin helpers before adding more cross-cutting effects, not a framework-wide rewrite. |
| Undo, drag, and remote updates | Establish explicit origin/coalescing seams before feature growth | The acceptance boundary is local undo only, no remote camera/focus takeover, and no active-drag jitter. Add interface-level tests at those seams. |
| Activity versus history | Keep them separate | The bounded feed identifies collaboration events; issue #17 must use revision snapshots/restore-as-new-revision rather than replaying activity text. |

## Scaling boundaries and current debt

- Server memory holds live Yjs documents; LevelDB is a whole-session snapshot
  store. Large rooms, long histories, or high-frequency layout writes need
  measured batching/snapshot policy before adding retention or fan-out claims.
- Browser clients can make raw Yjs updates that bypass MCP command validation.
  The authoritative server must keep deterministic name reconciliation and
  protect all server command mutations with their revision checks.
- `session-workspace.tsx` is the coordination point, not a universal feature
  bucket. A new behavior that needs both local UI and durable state must name
  its ownership and test seam before being added there.
- Current prefix-based flowchart detection and active-tab-only last-valid render
  state are known #12 refactor targets. Current undo-origin configuration,
  remote-layout drag behavior, reconnect/out-of-order convergence, and
  activity revision metadata are #13 proof targets.

## Verification and evidence

From the root (use `npx --yes pnpm@10.15.0` in place of `pnpm` when needed):

```bash
pnpm --filter @arielcharts/shared build
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

For browser interaction work, start the server and web app, then run
`npx tsx e2e-validate.ts`; screenshots are written to `/tmp/arielcharts-*.png`.
The CI contract is `.github/workflows/ci.yml`. For architecture decisions,
evidence comes from the named source/test files above and issues #12 (generic
Mermaid/API flows) and #13 (coworking semantics), not a stale status document.
