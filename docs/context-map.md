<!-- markdownlint-disable MD013 -->

# ArielCharts context map

## System shape

```text
Browser (Next.js) ── RoomGate/cookie ── Yjs websocket ──> SessionManager ──> LevelDB snapshot + private revision journal
       │                                                  ▲
       └─ Mermaid render / CodeMirror                      │
MCP client ── Bearer room capability ── POST /mcp ──> MCP tools ─────────┘
```

The browser and MCP tools write the same session document. Mermaid source is
canonical; the SVG and flowchart interaction model derive from it.

| Concern | Owner and source | Main files | Evidence |
| --- | --- | --- | --- |
| Session catalog | Durable Yjs `diagrams` map plus `diagramOrder`; server repairs structure/order/names and retains at least one valid tab | `apps/server/src/lib/session-manager.ts`, `packages/shared/src/types.ts` | `apps/server/src/lib/session-manager.test.ts` |
| Diagram content | Per-diagram `mermaid: Y.Text`, `name`, and `nodePositions: Y.Map`; shared source policy makes accepted source authoritative for durable layout membership | `packages/shared/src/source-layout.ts`, `session-manager.ts`, `apps/web/src/components/session-workspace.tsx`, `apps/web/src/lib/diagram-layout.ts` | `source-layout.test.ts`, `mcp.test.ts`, `diagram-layout.test.ts` |
| Realtime ingress | Every framed message is per-socket frame/rate bounded by its sync, awareness, or control class; SyncStep2/update then enters a hydrated detached candidate. Reserved Yjs roots (catalog/order/activity/presence/overlays) and their bounded values must validate before live apply, fan-out, checkpoints, or persistence. Fixed content-free rejection counters make dropped input observable. | `apps/server/src/lib/websocket.ts`, `apps/server/src/lib/document-admission.ts` | `document-admission.test.ts`, `websocket.test.ts`, `e2e-collaboration-validate.ts` (`pnpm test:e2e-collaboration`) |
| Overlay envelope | Durable `overlays` is a versioned, quota-bounded per-diagram envelope. v1 currently owns only scene/object containment budgets; #69 owns scene-object semantics. Newer versions remain opaque/read-only to this server and are never repaired away. | `apps/server/src/lib/constants.ts`, `apps/server/src/lib/document-admission.ts`, `session-manager.ts` | `document-admission.test.ts`, `session-manager.test.ts` |
| Room access | `RoomAccessService` stores salted verifier/access-version records outside Yjs, signs browser cookies, rate-limits attempts, and authenticates all ingress before the manager. Only protected creation creates a session; rotation advances the version and terminates room sockets. | `apps/server/src/lib/room-access.ts`, `apps/server/src/index.ts`, `apps/web/src/components/room-gate.tsx` | `room-access.test.ts`, `index.test.ts`, `websocket.test.ts`, `pnpm test:e2e-collaboration` |
| MCP writes | Modern-only HTTP tools require a room-scoped bearer and current server-derived revisions before mutation; the request-bound capability rejects cross-room inputs, while the shared mutation boundary rejects a projected source that would exceed the same durable document budget before it can mutate, then lazily joins the authenticated agent without replacing its existing identity and reconciles accepted source/layout in that transaction | `apps/server/src/lib/mcp-server.ts`, `apps/server/src/lib/mcp.ts`, `apps/server/src/lib/session-manager.ts` | `session-manager.test.ts`, `mcp.test.ts`, `index.test.ts`, `pnpm test:e2e-collaboration` |
| Revision history | Server-private immutable per-diagram journal; each identity covers normalized name, source, and sorted finite layout. `SessionManager` alone reads, checkpoints, compacts, and copy-forwards restores | `apps/server/src/lib/persistence.ts`, `apps/server/src/lib/session-manager.ts`, `packages/shared/src/types.ts` | `session-manager.test.ts`, `mcp.test.ts`, `index.test.ts` |
| Starter creation | Immutable shared starter registry resolves a selected template to ordinary Mermaid source before the existing browser or revision-checked MCP creation owner runs; template identity is never durable state | `packages/shared/src/starter-templates.ts`, `apps/server/src/lib/mcp.ts`, `apps/server/src/lib/mcp-server.ts` | `starter-templates.test.ts`, `mcp.test.ts`, `index.test.ts` |
| Source editing and undo | Per-tab CodeMirror/Yjs binding; UndoManager tracks local-human origins only | `apps/web/src/components/session-workspace.tsx`, `apps/web/src/lib/collaboration-origins.ts` | `apps/web/src/lib/session.test.ts`, `apps/web/src/lib/collaboration-origins.test.ts` |
| Drag collaboration | The workspace synchronously reconciles source membership and drops invalid pending and active ids before durable deletion. On normal drag finish, `DragLayoutCommitter` writes Yjs positions in 120 ms batches and final-flushes canonical pending ids before local runtime release; invalidation can let valid pending siblings finish after the presentation-local canvas clears runtime | `apps/web/src/components/diagram-canvas.tsx`, `apps/web/src/components/session-workspace.tsx`, `apps/web/src/lib/reactflow-controlled-node-adapter.ts`, `apps/web/src/lib/drag-layout.ts` | `reactflow-controlled-node-adapter.test.ts`, `drag-layout.test.ts`, `pnpm test:e2e-sequence`, `pnpm test:e2e-collaboration` |
| Render/navigation | Mermaid parser results map through the version-pinned capability catalog; a local per-diagram registry holds derived SVG, family/mode, and parse errors. The family adapter decides whether source is representable for scoped controls while Y.Text remains canonical. Class, State, and Requirement adapters share only current-preview/form orchestration; their source grammars and mutations remain family-owned and fail closed. | `session-workspace.tsx`, `diagram-capabilities.ts`, `diagram-preview.ts`, `diagram-canvas.tsx`, `class-mutations.ts`, `state-mutations.ts`, `requirement-mutations.ts`, `svg-hit-map.ts` | `diagram-capabilities.test.ts`, `diagram-preview.test.ts`, `class-mutations.test.ts`, `state-mutations.test.ts`, `requirement-mutations.test.ts`, `pnpm test:e2e-workspace-ux` |
| Workspace UX/theme | One provider resolves local system/light/dark preference; semantic shell tokens and source-owned Mermaid item styles remain separate | `theme-provider.tsx`, `theme.ts`, `globals.css`, `workspace-*.tsx` | `theme.test.ts`, `workspace-flyout-state.test.ts`, `pnpm test:e2e-workspace-ux` |
| Structural canvas mutations | Flowcharts use Mermaid AST mutations; nested subgraph renames use one declaration-only source rewrite because AST rendering flattens nesting. Sequence diagrams use source-derived participant/message append operations; both commit minimal Y.Text diffs and empty-state type choice is represented only by ordinary Mermaid source | `apps/web/src/lib/diagram-mutations.ts`, `apps/web/src/lib/diagram-subgraphs.ts`, `apps/web/src/lib/sequence-mutations.ts`, `apps/web/src/components/session-workspace.tsx` | `diagram-mutations.test.ts`, `diagram-subgraphs.test.ts`, `diagram-flow-identity.test.ts`, `sequence-mutations.test.ts`, `pnpm test:e2e-sequence` |
| Persistence | LevelDB stores encoded Yjs state, derived session metadata, and a server-private immutable `history:<session>:<diagram>` journal; snapshot, new records, history metadata, retention, and deletion share one atomic batch | `apps/server/src/lib/persistence.ts`, `session-manager.ts` | `session-manager.test.ts` |

## State ownership

| State | Scope | Authority | Notes |
| --- | --- | --- | --- |
| Diagram ids, names, order, Mermaid source, node positions | Durable/session | Yjs document; server persists it | Stable diagram ids are the MCP target; names are human-facing aliases. |
| MCP revision | Request-time concurrency guard | SessionManager | Create checks the session revision; existing-tab mutations check that tab's revision. |
| Starter template identity | Creation-time input only | Shared immutable registry | Browser and MCP resolve it to ordinary source before one creation transaction; it is not stored in Yjs, activity, or tool outputs. |
| Activity | Durable but bounded feed | Server-managed Yjs document | Browser UI renders it; retain at most 100 events. It cannot substitute for version history. |
| Revision journal | Durable/session | Server-private LevelDB; `SessionManager` | Immutable records retain a system baseline plus the latest 99 revisions per diagram. Browser activity ids are idempotent checkpoint boundaries, not a second history authority. |
| Room verifier and access version | Durable/session | Server-private LevelDB; `RoomAccessService` | A salted scrypt verifier and monotonically increasing access version are never Yjs, history, activity, or URL query state. |
| Raw room key | Ephemeral browser/agent input | User capability | The browser receives it in a `#roomKey` fragment, exchanges it for an HttpOnly cookie, clears the fragment before mounting, and retains it in memory only for sharing or agent setup. The MCP form is `<sessionId>.<roomKey>`. |
| Participant membership | Durable/session | Yjs `presence` map; SessionManager mutation boundary | A valid MCP mutation adds its actor only if absent, preserving an existing name/color/type and creating no join activity. |
| Participant directory | Durable/session for successful MCP agents; otherwise live-only | Durable Yjs `presence` mirror plus live awareness | The browser merges live awareness participants with durable agent entries so successful MCP agents survive a server reload. Awareness-only agents never enter the durable mirror and disappear on disconnect; durable human entries are ignored unless that human is currently present in awareness. |
| Canvas/editor presence | Ephemeral collaboration | Yjs awareness with per-socket client-id ownership | Editor cursor and active-diagram canvas cursor/selection plus one advisory active node editor id travel only in awareness. Canvas cursor coordinates are quantized and coalesced client-side; canvas selection/identity/removal updates are immediate. The server caps raw awareness state size, bounds canvas fields, filters stale/idempotent echoes, and rejects foreign advances. Awareness is not an authorization system, draft transport, lock, or browser UI store. |
| Active tab, camera, node/subgraph selection, toolbar, flyout, drafts | Browser local | React/local storage where appropriate | Flyouts are exclusive overlays and cannot mutate outer anchors, camera, or remote state. Subgraph drag derives recursive membership from source and persists only ordinary member-node positions. |
| React Flow measurement and active drag positions | Ephemeral browser view | Controlled-node adapter keyed by stable Mermaid node id | Mermaid/parser output owns structure and membership; the workspace reconciles that membership with durable layout, while the canvas retains only presentation-local measurement and active positions. On normal drag finish, the valid final flush precedes local runtime release; source invalidation may leave a valid pending sibling to finish after the canvas clears runtime. |
| Theme preference and system resolution | Browser local | One `ThemeProvider`; versioned local storage plus media query | Resolved theme is a derived Mermaid/React Flow render input, never shared diagram state. |
| Parsed SVG, kind, parse error, hit map, flowchart snapshot | Derived browser state | Mermaid/mermaid-ast and local preview registry | Per-diagram last-valid state is isolated by stable diagram id; theme changes rerender it without changing source. |

## Ingress and concurrency flow

1. `POST /api/rooms` atomically creates a protected session and its private
   verifier record. A shared `#roomKey` fragment is exchanged through the
   RoomGate for a signed HttpOnly cookie and cleared before `SessionWorkspace`
   mounts. The cookie authorizes Yjs, diagram-history HTTP, and key rotation;
   failure reveals no room content.
2. A browser with that cookie attaches a `WebsocketProvider` to
   `/ws/:sessionId`; every framed message first consumes its bounded per-socket
   sync, awareness, or control ingress allowance, and raw Yjs SyncStep2/update payloads then pass a
   hydrated detached-candidate admission check. Only an accepted candidate can
   apply to the authoritative nested document, trigger catalog/legacy-overlay
   repair, relay, activity/checkpoints, or per-session snapshot persistence. New
   browser activity ids create one idempotent checkpoint from converged
   canonical state.
3. The browser switches only its local active-tab binding. CodeMirror writes
   the active diagram's Y.Text; visual flowchart edits use `MutationQueue` so
   the latest source is parsed and minimally diffed before the Yjs write.
4. An MCP client supplies `Authorization: Bearer <sessionId>.<roomKey>` and
   can access only that session; there is no room-list discovery tool. It calls
   `getSession` before creation, then supplies exactly one `templateId` or
   `mermaidText` to `createDiagram` with the fresh session revision. It calls
   `readDiagram` immediately before replacement/rename/delete/restore and
   uses JSON history routes or matching MCP list/read tools for detached
   inspection. A stale revision requires an explicit re-read and deliberate
   merge before one retry. The MCP boundary resolves a valid
   template to source before the session manager
   resolves source membership, checks the supplied current revision inside the
   mutation path, lazily materializes the authenticated agent's durable
   membership without changing an existing identity, then atomically replaces
   source and prunes accepted obsolete layout, appends activity, persists, and
   broadcasts through the same Yjs document. Read/discovery calls do not join
   an agent.
5. A stale MCP revision is a conflict signal: re-read, merge the current
   source, and retry. It must never result in a blind full-source overwrite or
   restore retry. Restore is a fresh-head checked copy-forward transaction: it
   retains the current name and prior records while creating one new revision.

## Mermaid and collaboration architecture decisions

| Decision | Direction | Reason and threshold |
| --- | --- | --- |
| Sequence and generic Mermaid preview | Reuse the Mermaid SVG/canvas path | Sequence diagrams retain viewBox-aware pan/zoom/Fit and add source-backed participant/message controls. Unsupported Mermaid remains source-only; `pnpm test:e2e-sequence` covers editing, cross-tab isolation, and invalid source. |
| Structural capability detection | Use Mermaid parser-result classification | Current representable `flowchart*` sources and the exact parser-reported `sequence` type expose scoped controls; unsupported and stale/invalid source stays source-editable. Empty UI derives from blank/header-only source, never a hidden type flag. |
| Mermaid family capability catalog | Keep the version-pinned parser-family matrix and source-model adapter browser-derived | The catalog collapses Mermaid aliases, renderer variants, and Railroad grammar variants to 30 visual families. It exposes canvas, semantic-form, source-only, and unavailable-plugin modes without adding Yjs type metadata; adapters fail closed when source cannot safely support a semantic operation. Semantic panels share current-preview/Y.Text orchestration only; Class, State, and Requirement retain their own strict source models. |
| Per-tab render resilience | Local per-diagram preview registry | Last-valid SVG/kind/error survives tab switching and invalid input independently; deleted ids are pruned and session changes reset the registry. |
| Human/MCP collaboration | Reuse Yjs plus server revision checks | They already converge document operations and prevent stale agent replacement. Do not add a second realtime database, lock service, or transport-session identity. |
| Interaction lifecycle | Extract only where an invariant cannot be tested in `session-workspace.tsx` | It currently binds provider, active-tab state, CodeMirror, rendering, activity, and local UI. Pull out focused tab/render or transaction-origin helpers before adding more cross-cutting effects, not a framework-wide rewrite. |
| Undo, drag, and remote updates | Explicit origin, controlled-view, and coalescing seams | Per-diagram undo is human-only. Stable-id single/group drags stay local while active; synchronous source reconciliation drops ids that stop being canonical before durable deletion. `DragLayoutCommitter` is the sole 120 ms/final-flush path: normal finish flushes remaining canonical pending ids before runtime release, while invalidation drops invalid ids and can leave valid pending siblings to finish after canvas runtime clears. |
| Theme and item color | Semantic shell tokens plus neutral graphical fallbacks | Authored Mermaid `classDef`/`style` colors override item fallbacks; shell state colors never rewrite source. |
| Nested subgraph editing | Keep source nesting canonical and section layout derived | Rename only the explicit `subgraph <id>` declaration; never serialize the parsed AST. Section bounds derive from member nodes, and group drag writes those nodes through `DragLayoutCommitter` without section-position metadata. |
| Overlay and camera geometry | Measure the unobscured canvas | Flyouts overlay; Fit and toolbar placement use measured viewport bounds without opening-state camera mutation. |
| Activity versus history | Keep them separate | Activity is a bounded collaboration feed whose browser ids mark deduplicated checkpoints; the private immutable journal is the history authority. |
| History preview and restore | Detached browser render plus server copy-forward | Preview is keyed by revision id and cannot write Yjs, activity, Awareness, active tab, selection, or camera. Restore always rereads the head, makes one revision-checked request, and never auto-retries stale state. |

## Scaling boundaries and current debt

- Server memory holds live Yjs documents; LevelDB persists a whole-session
  snapshot and the immutable journal. Per-session persistence serialization,
  atomic snapshot/history/meta/retention/deletion batches, and baseline + 99
  retention avoid a WAL or second authority; larger rooms, histories, or
  high-frequency layout writes still need measured batching/fan-out policy.
- Browser clients can make raw Yjs updates that bypass MCP command validation,
  but every decoded update is now admitted against a disposable current-state
  candidate with byte, rate, structural, finite-number, and overlay-envelope
  budgets before live fan-out or persistence. Legacy persisted documents are
  repaired only in a detached load candidate; oversized or invalid records
  fail closed. Durable scene-object behavior remains #69 work, not a generic
  metadata channel.
- The canonical production topology is
  `arielcharts.donovanyohan.com` (browser) plus
  `api.arielcharts.donovanyohan.com` (HTTP/WebSocket/MCP). Exact browser-origin
  CORS, `Secure; SameSite=Lax` cookies, and
  `CLIENT_ADDRESS_PROFILE=fly` keep those same-site subdomains usable without
  cross-site cookies. That profile accepts only one valid `Fly-Client-IP` and
  ignores `X-Forwarded-For`; local/default mode trusts neither. A production
  deployment must provide `ROOM_COOKIE_SECRET`; do not fall back to wildcard
  origins or query-string keys.
- `session-workspace.tsx` is the coordination point, not a universal feature
  bucket. A new behavior that needs both local UI and durable state must name
  its ownership and test seam before being added there.
- No deeper nested `AGENTS.md` is justified: theme, overlays, and viewport
  invariants span the existing web boundary.
- Room capability authenticates room ingress, while awareness client-id
  ownership prevents cross-socket mutation within an authorized room. It is
  deliberately not an identity or roles system.

## Verification and evidence

From the root (use `npx --yes pnpm@10.15.0` in place of `pnpm` when needed):

```bash
pnpm --filter @arielcharts/shared build
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Browser gates have two execution models. The owned-service gates build the
workspace, start an isolated production-like web/server pair, and clean up the
temporary data directory themselves: `pnpm test:e2e-workspace-ux`,
`pnpm test:e2e-subgraphs`, and `pnpm test:e2e-collaboration`. CI runs all three.
`pnpm test:e2e-workspace-ux` covers theme, flyout focus/exclusivity,
responsive layout, visible toolbars, Fit, and stable outer anchors/camera.
`pnpm test:e2e-collaboration` covers human/MCP concurrency, local UI ownership,
active-drag stability, and eventual layout convergence; nested update,
awareness, reconnect, and persisted reload coverage also lives in
`apps/server/src/lib/websocket.test.ts`.

The focused/manual gates use the supplied local services (or
`E2E_BASE_URL`/`E2E_MCP_URL`): start the server and web app before
`npx tsx e2e-validate.ts` or `pnpm test:e2e-sequence`. The latter covers
Mermaid type/canvas behavior; inspect `/tmp/arielcharts-sequence.png` and
`/tmp/arielcharts-sequence-isolation.png`. These two focused gates are not CI
jobs today.
The collaboration gate additionally proves RoomGate fragment clearing, cookie-gated
browser access, room-scoped MCP bearer rejection, and rotation revocation. The
production deployment check exercises the canonical DNS/cookie topology and
refuses non-canonical targets:

```bash
E2E_PRODUCTION_SMOKE=1 \
E2E_BASE_URL=https://arielcharts.donovanyohan.com \
E2E_MCP_URL=https://api.arielcharts.donovanyohan.com/mcp \
pnpm test:e2e-production-smoke
```

It creates and rotates a real protected room, checks `Secure; HttpOnly;
SameSite=Lax` host-only cookies, validates browser/API/WebSocket/MCP access,
and proves the old cookie and MCP bearer are revoked after rotation.
The CI contract is `.github/workflows/ci.yml`; architecture evidence comes
from the named source and test files above.
