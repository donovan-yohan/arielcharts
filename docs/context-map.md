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
| Session catalog | Durable Yjs `diagrams` map plus `diagramOrder`; server repairs structure/order/names and retains at least one valid tab | `apps/server/src/lib/session-manager.ts`, `packages/shared/src/types.ts` | `apps/server/src/lib/session-manager.test.ts` |
| Diagram content | Per-diagram `mermaid: Y.Text`, `name`, and `nodePositions: Y.Map` | `session-manager.ts`, `apps/web/src/components/session-workspace.tsx`, `apps/web/src/lib/diagram-layout.ts` | `session-manager.test.ts`, `diagram-layout.test.ts` |
| Realtime | Yjs nested-document convergence plus socket-owned, filtered awareness | `apps/web/src/components/session-workspace.tsx`, `apps/server/src/lib/websocket.ts` | `apps/server/src/lib/websocket.test.ts`, `e2e-collaboration-validate.ts` (`pnpm test:e2e-collaboration`) |
| MCP writes | Modern-only HTTP tools require current server-derived revisions before mutation | `apps/server/src/lib/mcp-server.ts`, `apps/server/src/lib/mcp.ts`, `apps/server/src/index.ts` | `apps/server/src/lib/mcp.test.ts`, `apps/server/src/index.test.ts` |
| Source editing and undo | Per-tab CodeMirror/Yjs binding; UndoManager tracks local-human origins only | `apps/web/src/components/session-workspace.tsx`, `apps/web/src/lib/collaboration-origins.ts` | `apps/web/src/lib/session.test.ts`, `apps/web/src/lib/collaboration-origins.test.ts` |
| Drag collaboration | Local active-node overlay with 120 ms durable batches and unconditional final flush | `apps/web/src/components/session-workspace.tsx`, `apps/web/src/lib/drag-layout.ts` | `apps/web/src/lib/drag-layout.test.ts`, `e2e-collaboration-validate.ts` (`pnpm test:e2e-collaboration`) |
| Render/navigation | Mermaid parser result classifies flowcharts; a local per-diagram registry holds derived SVG, kind, and parse errors | `session-workspace.tsx`, `diagram-preview.ts`, `diagram-canvas.tsx`, `svg-hit-map.ts` | `diagram-preview.test.ts`, `pnpm test:e2e-sequence`, `/tmp/arielcharts-sequence.png`, `/tmp/arielcharts-sequence-isolation.png` |
| Flowchart mutations | Mermaid AST -> mutation -> minimal Y.Text diff | `apps/web/src/lib/diagram-mutations.ts` | `diagram-mutations.test.ts`, `diagram-flow-identity.test.ts` |
| Persistence | LevelDB stores encoded Yjs state and derived session metadata | `apps/server/src/lib/persistence.ts`, `session-manager.ts` | `session-manager.test.ts` |

## State ownership

| State | Scope | Authority | Notes |
| --- | --- | --- | --- |
| Diagram ids, names, order, Mermaid source, node positions | Durable/session | Yjs document; server persists it | Stable diagram ids are the MCP target; names are human-facing aliases. |
| MCP revision | Request-time concurrency guard | SessionManager | Create checks the session revision; existing-tab mutations check that tab's revision. |
| Activity | Durable but bounded feed | Server-managed Yjs document | Browser UI renders it; retain at most 100 events. It cannot substitute for version history. |
| Presence/cursors | Ephemeral collaboration | Yjs awareness with per-socket client-id ownership | The server filters stale/idempotent echoes and rejects foreign advances; awareness is not an authorization system or browser UI store. |
| Active tab, camera, selection, toolbar, flyout, drafts | Browser local | React/local storage where appropriate | Never move these into Yjs merely to make UI react to remote edits. |
| Parsed SVG, kind, parse error, hit map, flowchart snapshot | Derived browser state | Mermaid/mermaid-ast and local preview registry | Per-diagram last-valid state is isolated by stable diagram id; only an exact, representable current flowchart enables structural controls. |

## Ingress and concurrency flow

1. A browser attaches a `WebsocketProvider` to `/ws/:sessionId`; Yjs updates
   converge on the authoritative nested document. The server repairs the
   catalog, relays accepted updates, filters awareness, and persists snapshots.
2. The browser switches only its local active-tab binding. CodeMirror writes
   the active diagram's Y.Text; visual flowchart edits use `MutationQueue` so
   the latest source is parsed and minimally diffed before the Yjs write.
3. An MCP client discovers tools, calls `getSession` to choose a stable id,
   then `readDiagram` before a replacement/rename/delete. The session manager
   checks the supplied current revision inside the mutation path, appends
   activity, persists, and broadcasts through the same Yjs document.
4. A stale MCP revision is a conflict signal: re-read, merge the current
   source, and retry. It must never result in a blind full-source overwrite.

## Mermaid and collaboration architecture decisions

| Decision | Direction | Reason and threshold |
| --- | --- | --- |
| Generic Mermaid preview | Reuse the Mermaid SVG/canvas path | Mermaid renders API sequence diagrams through viewBox-aware pan/zoom/Fit; `pnpm test:e2e-sequence` covers generic behavior, cross-tab isolation, and invalid source. |
| Flowchart capability detection | Use Mermaid parser-result classification | Only current, representable `flowchart*` source exposes structural controls; generic and stale/invalid source stays source-editable. |
| Per-tab render resilience | Local per-diagram preview registry | Last-valid SVG/kind/error survives tab switching and invalid input independently; deleted ids are pruned and session changes reset the registry. |
| Human/MCP collaboration | Reuse Yjs plus server revision checks | They already converge document operations and prevent stale agent replacement. Do not add a second realtime database, lock service, or transport-session identity. |
| Interaction lifecycle | Extract only where an invariant cannot be tested in `session-workspace.tsx` | It currently binds provider, active-tab state, CodeMirror, rendering, activity, and local UI. Pull out focused tab/render or transaction-origin helpers before adding more cross-cutting effects, not a framework-wide rewrite. |
| Undo, drag, and remote updates | Explicit origin and coalescing seams | Per-diagram undo is human-only; drag writes batch at 120 ms and final-flush while a local overlay prevents remote jitter. |
| Activity versus history | Keep them separate | The bounded feed identifies collaboration events; issue #17 must use revision snapshots/restore-as-new-revision rather than replaying activity text. |

## Scaling boundaries and current debt

- Server memory holds live Yjs documents; LevelDB is a whole-session snapshot
  store. Large rooms, long histories, or high-frequency layout writes need
  measured batching/snapshot policy before adding retention or fan-out claims.
- Browser clients can make raw Yjs updates that bypass MCP command validation.
  The authoritative server repairs structure/order/names and protects all
  server command mutations with revision checks.
- `session-workspace.tsx` is the coordination point, not a universal feature
  bucket. A new behavior that needs both local UI and durable state must name
  its ownership and test seam before being added there.
- Awareness client-id ownership prevents cross-socket mutation but does not
  authenticate a person. Any future authorization must remain a separate
  boundary.

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
`npx tsx e2e-validate.ts`; for Mermaid type/canvas coverage also run
`pnpm test:e2e-sequence`. Inspect `/tmp/arielcharts-sequence.png` and
`/tmp/arielcharts-sequence-isolation.png`.
For human/MCP concurrency, local UI ownership, active-drag stability, and
eventual layout convergence, run `pnpm test:e2e-collaboration`; nested update,
awareness, reconnect, and persisted reload coverage lives in
`apps/server/src/lib/websocket.test.ts`.
The CI contract is `.github/workflows/ci.yml`; architecture evidence comes
from the named source and test files above.
