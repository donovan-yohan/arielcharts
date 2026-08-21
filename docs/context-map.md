<!-- markdownlint-disable MD013 -->

# ArielCharts context map

## System shape

```text
Browser root (Next.js) ── Local Yjs + IndexedDB ──> Mermaid render / CodeMirror
       │
       └─ explicit share / agent connection: POST /api/rooms { bounded bundle }
                                                    │
Browser online room ── RoomGate/cookie ── Yjs websocket ──> SessionManager ──> LevelDB snapshot + private revision journal
       │                                                                  ▲
MCP client ── Bearer room capability ── POST /mcp ──> MCP tools ─────────────┘
```

The root browser workspace is local-first: its Yjs document is persisted in IndexedDB, with no room request, WebSocket, MCP host, or server history. On an explicit share or agent-connection action, a bounded snapshot is atomically promoted to an online room. In that online mode the browser and MCP tools write the same session document. Mermaid source is canonical; the SVG and flowchart interaction model derive from it.

| Concern | Owner and source | Main files | Evidence |
| --- | --- | --- | --- |
| Workspace catalog | Durable Yjs `diagrams` map plus `diagramOrder`; IndexedDB owns the default local document, while the server repairs/persists the same schema after explicit promotion and retains at least one valid tab | `apps/web/src/lib/local-workspace.ts`, `apps/web/src/components/session-workspace.tsx`, `apps/server/src/lib/session-manager.ts`, `packages/shared/src/types.ts` | `apps/server/src/lib/session-manager.test.ts`, `pnpm test:e2e-workspace-ux` |
| Diagram content | Per-diagram `mermaid: Y.Text`, `name`, and `nodePositions: Y.Map`; shared source policy makes accepted source authoritative for durable layout membership | `packages/shared/src/source-layout.ts`, `session-manager.ts`, `apps/web/src/components/session-workspace.tsx`, `apps/web/src/lib/diagram-layout.ts` | `source-layout.test.ts`, `mcp.test.ts`, `diagram-layout.test.ts` |
| Realtime ingress | Every framed message is per-socket frame/rate bounded by its sync, awareness, or control class; SyncStep2/update then enters a hydrated detached candidate. Reserved Yjs roots (catalog/order/activity/presence/overlays) and their bounded values must validate before live apply, fan-out, checkpoints, or persistence. Independently valid offline annotation bodies whose merge exceeds 8 KiB are deterministically UTF-8 truncated in CRDT order; the server broadcasts the full repaired state to every peer including the sender before persistence, preventing silent replica forks. Fixed content-free rejection counters make dropped input observable. | `apps/server/src/lib/websocket.ts`, `apps/server/src/lib/document-admission.ts` | `document-admission.test.ts`, `websocket.test.ts`, `e2e-collaboration-validate.ts` (`pnpm test:e2e-collaboration`) |
| Overlay scenes | Durable `overlays` holds a pre-seeded versioned scene per diagram. v1 objects use renderer-neutral finite world geometry, stable `(order_key, id)` ordering, optional semantic anchors with fallback geometry, bounded style/metadata/payload, and feature-owned `kind` values. Box/frame/annotation extents are non-negative; line, arrow, and connector extents are signed endpoint vectors so either endpoint may cross the other without changing identity. Legacy diamonds retain their former implicit +45 degree visual basis until the first direct transform atomically writes its absolute geometry with `payload.rotation_model: "absolute"`; new diamonds always write that marker, including intentional 0 degree rotation. Text and sticky annotations keep their safe plain-text body in a bounded nested `Y.Text`; local-human incremental operations share the overlay undo origin while IME composition drafts remain browser-local and commit through relative Yjs boundaries so remote text survives. Pen/highlighter finalization creates one immutable `ink.stroke` with quantized/simplified 512-point, 48-KiB persistence, and 512-segment renderer-work budgets plus an explicit composite-export choice; its finite, bounded geometry must exactly match the point bounding box and stroke-width padding, and each pointer-up is its own local undo unit. Raw pointer moves never write Yjs. Basic shapes, overlay-endpoint connectors, and frames are ordinary bounded v1 records; connectors use endpoint fallbacks and frames only move/hide/lock overlay members. A bounded v1 `layers` map provides deterministic order, visible/locked/composite-export policy, with missing legacy layers projected as `default`. New objects use the measured unobscured viewport center transformed into world coordinates. Newer scenes remain opaque/read-only and are rejected by v1 read/history/restore paths without projection; unknown v1 kinds remain recoverable records. A focused hook owns Yjs operations and a focused canvas layer consumes the renderer's world-to-screen transform while selection/tool drafts stay local. | `packages/shared/src/types.ts`, `apps/server/src/lib/document-admission.ts`, `apps/web/src/lib/overlay-scene.ts`, `apps/web/src/lib/freehand-ink.ts`, `use-overlay-scene.ts`, `components/overlay-canvas-layer.tsx` | `document-admission.test.ts`, `overlay-scene.test.ts`, `freehand-ink.test.ts`, `overlay-canvas-layer.test.tsx`, `session-manager.test.ts`, `pnpm test:e2e-workspace-ux` |
| Local-first promotion and room access | Root startup uses `IndexeddbPersistence` plus local-only awareness and creates no room. Explicit share/agent connection snapshots the bounded local document and sends it to protected creation; `SessionManager` first admits a detached candidate, then the initial session and salted verifier persist atomically and the response sets the creator cookie. `RoomAccessService` signs browser cookies, rate-limits attempts, and authenticates online ingress; rotation advances the version and terminates room sockets. | `apps/web/src/lib/local-workspace.ts`, `apps/web/src/components/session-workspace.tsx`, `apps/web/src/lib/workspace-bundle.ts`, `apps/server/src/lib/room-access.ts`, `apps/server/src/index.ts`, `apps/server/src/lib/session-manager.ts`, `apps/web/src/components/room-gate.tsx` | `room-access.test.ts`, `session-manager.test.ts`, `index.test.ts`, `websocket.test.ts`, `pnpm test:e2e-workspace-ux`, `pnpm test:e2e-collaboration` |
| MCP writes | Modern-only HTTP tools require a room-scoped bearer and current server-derived revisions before mutation; the request-bound capability rejects cross-room inputs. Mermaid mutations retain their source/layout boundary. Overlay tools are object operations only (create/update/reorder/delete), use a lossless raw-scene revision, return bounded current state on conflict, and never replace a scene. A newer scene or opaque v1 object is disclosed but read-only, so no mutation can silently drop it. Successful mutations lazily join the authenticated agent without replacing its identity; overlay-only work creates no Mermaid revision or activity entry and uses the same canonical persistence/checkpoint policy as browser overlay writes. | `apps/server/src/lib/mcp-server.ts`, `apps/server/src/lib/mcp.ts`, `apps/server/src/lib/session-manager.ts` | `session-manager.test.ts`, `mcp.test.ts`, `index.test.ts`, `pnpm test:e2e-collaboration` |
| Revision history | Server-private immutable per-diagram journal; each identity covers normalized name, source, and sorted finite layout. `SessionManager` alone reads, checkpoints, compacts, and copy-forwards restores | `apps/server/src/lib/persistence.ts`, `apps/server/src/lib/session-manager.ts`, `packages/shared/src/types.ts` | `session-manager.test.ts`, `mcp.test.ts`, `index.test.ts` |
| Overlay history | A separate server-derived content revision and private immutable journal snapshots each canonical scene. Browser-cookie routes can list/read/restore it; MCP can only read/mutate current bounded objects and has no scene replacement or history-restore surface. Source restore never writes overlays and overlay restore never writes source/layout. A whole-workspace snapshot is an explicit Mermaid/overlay revision pair, not a timestamp join. | `apps/server/src/lib/persistence.ts`, `session-manager.ts`, `apps/web/src/lib/overlay-history-api.ts`, `packages/shared/src/types.ts` | `session-manager.test.ts`, `mcp.test.ts`, `index.test.ts`, `overlay-history-api.test.ts` |
| Portable workspace and canvas export | Mermaid export is source bytes only. Canvas export is a standalone sanitized SVG/PNG projection of the current Mermaid render plus only visible, layer-export-enabled overlay objects; awareness, laser, drafts, comments, credentials, and editable metadata never enter it. Editable `.arielcharts` is deterministic, bounded plain JSON (no decompressor surface) with SHA-256 integrity over an allowlisted catalog/source/layout/overlay payload. The browser sends the intact bundle to a cookie-authenticated server import route with a full-workspace revision; the server validates it in a detached copy of the complete document, then atomically replaces catalog/order/scenes, persists it, and relays the authoritative Yjs update. Unknown newer versions, stale writes, or invalid/over-budget payloads fail without mutation; activity/presence/history remain untouched. | `apps/web/src/lib/workspace-bundle.ts`, `workspace-import-api.ts`, `apps/server/src/lib/workspace-import.ts`, `session-manager.ts`, `components/workspace-export-menu.tsx` | `workspace-bundle.test.ts`, `workspace-import-api.test.ts`, `index.test.ts`, `composite-export.test.ts`, workspace UX download/import coverage |
| Starter creation | The shared Mermaid family descriptor is the single version-pinned catalog for built-in parser aliases, editing model, stability, help, availability, and minimal starter source. `STARTER_TEMPLATES` preserves the original Blank-plus-six curated public values; distinct immutable primary/chooser collections supply Blank plus the 30 catalog families, while `ALL_STARTER_TEMPLATES` de-duplicates every accepted MCP ID. The browser keeps semantic adapters local and renders unavailable external families as disabled rows. Selected starters resolve to ordinary Mermaid source before the existing browser or revision-checked MCP creation owner runs; template identity is never durable state. | `packages/shared/src/mermaid-diagram-catalog.ts`, `packages/shared/src/starter-templates.ts`, `apps/web/src/lib/diagram-capabilities.ts`, `apps/web/src/components/workspace-template-picker.tsx`, `apps/server/src/lib/mcp.ts`, `apps/server/src/lib/mcp-server.ts` | `starter-templates.test.ts`, `diagram-capabilities.test.ts`, `workspace-template-picker.test.ts`, `mcp.test.ts`, `index.test.ts`, `pnpm test:e2e-workspace-ux` |
| Source editing and undo | Per-tab CodeMirror/Yjs binding; a bounded fail-soft Mermaid tokenizer supplies presentation-only highlighting without calling the renderer or normalizing source; UndoManager tracks local-human origins only | `apps/web/src/components/session-workspace.tsx`, `apps/web/src/lib/mermaid-language.ts`, `apps/web/src/lib/collaboration-origins.ts` | `apps/web/src/lib/mermaid-language.test.ts`, `apps/web/src/lib/session.test.ts`, `apps/web/src/lib/collaboration-origins.test.ts` |
| Drag collaboration | The workspace synchronously reconciles source membership and drops invalid pending and active ids before durable deletion. On normal drag finish, `DragLayoutCommitter` writes Yjs positions in 120 ms batches and final-flushes canonical pending ids before local runtime release; invalidation can let valid pending siblings finish after the presentation-local canvas clears runtime | `apps/web/src/components/diagram-canvas.tsx`, `apps/web/src/components/session-workspace.tsx`, `apps/web/src/lib/reactflow-controlled-node-adapter.ts`, `apps/web/src/lib/drag-layout.ts` | `reactflow-controlled-node-adapter.test.ts`, `drag-layout.test.ts`, `pnpm test:e2e-sequence`, `pnpm test:e2e-collaboration` |
| Render/navigation | Mermaid parser results map through the version-pinned capability catalog; a local per-diagram registry holds derived SVG, family/mode, and parse errors. The family adapter decides whether source is representable for scoped controls while Y.Text remains canonical. Class, State, and Requirement adapters share only current-preview/form orchestration; their source grammars and mutations remain family-owned and fail closed. | `session-workspace.tsx`, `diagram-capabilities.ts`, `diagram-preview.ts`, `diagram-canvas.tsx`, `class-mutations.ts`, `state-mutations.ts`, `requirement-mutations.ts`, `svg-hit-map.ts` | `diagram-capabilities.test.ts`, `diagram-preview.test.ts`, `class-mutations.test.ts`, `state-mutations.test.ts`, `requirement-mutations.test.ts`, `pnpm test:e2e-workspace-ux` |
| Workspace UX/theme | One provider resolves local system/light/dark preference; semantic shell tokens and source-owned Mermaid item styles remain separate | `theme-provider.tsx`, `theme.ts`, `globals.css`, `workspace-*.tsx` | `theme.test.ts`, `workspace-flyout-state.test.ts`, `pnpm test:e2e-workspace-ux` |
| Structural canvas mutations | Flowcharts use Mermaid AST mutations; nested subgraph renames use one declaration-only source rewrite because AST rendering flattens nesting. Sequence diagrams use source-derived participant/message append operations; both commit minimal Y.Text diffs and empty-state type choice is represented only by ordinary Mermaid source | `apps/web/src/lib/diagram-mutations.ts`, `apps/web/src/lib/diagram-subgraphs.ts`, `apps/web/src/lib/sequence-mutations.ts`, `apps/web/src/components/session-workspace.tsx` | `diagram-mutations.test.ts`, `diagram-subgraphs.test.ts`, `diagram-flow-identity.test.ts`, `sequence-mutations.test.ts`, `pnpm test:e2e-sequence` |
| Persistence | The root local document is stored by `IndexeddbPersistence`; an online room stores encoded Yjs state, derived metadata, and a server-private immutable `history:<session>:<diagram>` journal in LevelDB. Online snapshot, new-record, history-metadata, retention, and deletion writes share one atomic batch. | `apps/web/src/lib/local-workspace.ts`, `apps/server/src/lib/persistence.ts`, `session-manager.ts` | `session-manager.test.ts`, `pnpm test:e2e-workspace-ux` |

## State ownership

| State | Scope | Authority | Notes |
| --- | --- | --- | --- |
| Diagram ids, names, order, Mermaid source, node positions | Durable/local or online session | Yjs document; IndexedDB persists root-local work, server persists promoted online work | Stable diagram ids are the MCP target only after promotion; names are human-facing aliases. |
| Per-diagram overlay scene | Durable/local or online session | Yjs `overlays`; IndexedDB locally, server admission and persistence online | Browser owns selection, drafts, resize handles, and camera. One browser-local `CanvasTool` is projected into Mermaid-supported select/connect/laser modes and overlay creation/ink modes; renderer shortcuts update that owner directly, never each other through window events. MCP can list/read bounded current object records and make revision-checked object operations only after promotion; it never replaces a scene, writes awareness, or changes Mermaid source/layout. Diagram deletion removes its scene and both private histories in one online persistence batch. |
| MCP revision | Request-time concurrency guard | SessionManager | Create checks the session revision; existing-tab mutations check that tab's revision. |
| Starter template identity | Creation-time input only | Shared immutable registry | Browser and MCP resolve it to ordinary source before one creation transaction; it is not stored in Yjs, activity, or tool outputs. |
| Activity | Durable but bounded feed | Local Yjs document before promotion; server-managed Yjs document online | Browser UI renders it; retain at most 100 events. It cannot substitute for online version history. |
| Revision journal | Online room only | Server-private LevelDB; `SessionManager` | Immutable records retain a system baseline plus the latest 99 revisions per diagram. Local mode has normal browser undo but no server revision journal. Browser activity ids are idempotent checkpoint boundaries, not a second history authority. |
| Room verifier and access version | Durable/session | Server-private LevelDB; `RoomAccessService` | A salted scrypt verifier and monotonically increasing access version are never Yjs, history, activity, or URL query state. |
| Raw room key | Ephemeral browser/agent input | User capability | The browser receives it in a `#roomKey` fragment, exchanges it for an HttpOnly cookie, clears the fragment before mounting, and retains it in memory only for sharing or agent setup. The MCP form is `<sessionId>.<roomKey>`. |
| Participant membership | Online room only | Yjs `presence` map; SessionManager mutation boundary | Local mode uses only the current browser's local awareness surface. A valid online MCP mutation adds its actor only if absent, preserving an existing name/color/type and creating no join activity. |
| Participant directory | Durable/session for successful MCP agents; otherwise live-only | Durable Yjs `presence` mirror plus live awareness | The browser merges live awareness participants with durable agent entries so successful MCP agents survive a server reload. Awareness-only agents never enter the durable mirror and disappear on disconnect; durable human entries are ignored unless that human is currently present in awareness. |
| Canvas/editor/presenter presence | Ephemeral collaboration | Yjs awareness with per-socket client-id ownership | Editor cursor, active-diagram canvas cursor/selection, a bounded world-coordinate laser sample/sequence, one advisory active node editor id, bounded coalesced ink-preview samples with monotonic sequence, and bounded presenter diagram/camera/spotlight sequences travel only in awareness. Ink previews have no durable object id or authoritative content and clear on stroke end/cancel, tool exit, diagram switch, or disconnect; final strokes use `overlays`. Cursor, laser, ink previews, and presenter cameras are quantized/coalesced client-side. Following and spotlight acceptance are voluntary browser-local state that exit on local interaction or disconnect. The server caps raw awareness state size, bounds these fields, filters stale/idempotent echoes, and rejects foreign advances. Awareness is not an authorization system, draft transport, lock, durable history, undo input, or browser UI store. |
| Active tab, camera, node/subgraph/overlay selection, toolbar, flyout, drafts | Browser local | React/local storage where appropriate | Flyouts are exclusive overlays and cannot mutate outer anchors, camera, or remote state. Subgraph drag derives recursive membership from source and persists only ordinary member-node positions. Overlay common operations use a local-human Yjs origin while their interaction state remains local. |
| React Flow measurement and active drag positions | Ephemeral browser view | Controlled-node adapter keyed by stable Mermaid node id | Mermaid/parser output owns structure and membership; the workspace reconciles that membership with durable layout, while the canvas retains only presentation-local measurement and active positions. On normal drag finish, the valid final flush precedes local runtime release; source invalidation may leave a valid pending sibling to finish after the canvas clears runtime. |
| Theme preference and system resolution | Browser local | One `ThemeProvider`; versioned local storage plus media query | Resolved theme is a derived Mermaid/React Flow render input, never shared diagram state. |
| Parsed SVG, kind, parse error, hit map, flowchart snapshot | Derived browser state | Mermaid/mermaid-ast and local preview registry | Per-diagram last-valid state is isolated by stable diagram id; theme changes rerender it without changing source. |

## Ingress and concurrency flow

1. The root browser route creates a local Yjs document and waits for `IndexeddbPersistence` hydration before seeding an empty catalog. It mounts local-only awareness, reports “Saved on this device,” and makes no server request or WebSocket.
2. An explicit **Go online & share** or agent-connection action snapshots the bounded local workspace and sends it to `POST /api/rooms`. The server validates that bundle in a detached candidate, then atomically creates the protected session and verifier record and sets the creator's signed HttpOnly cookie. A failed request leaves the local document unchanged. If the local document changes while the request is pending, it remains editable and no handoff/navigation occurs. On an unchanged success, a non-secret session-id handoff marker is persisted before navigation while IndexedDB remains an archived recovery copy; root startup resumes that cookie-authorized room instead of exposing the archive as a fork. The returned `#roomKey` fragment is the shareable capability; another browser exchanges it through RoomGate for its own cookie and clears it before the online workspace mounts.
3. A browser with that cookie attaches a `WebsocketProvider` to
   `/ws/:sessionId`; every framed message first consumes its bounded per-socket
   sync, awareness, or control ingress allowance, and raw Yjs SyncStep2/update payloads then pass a
   hydrated detached-candidate admission check. Only an accepted candidate can
   apply to the authoritative nested document, trigger catalog/legacy-overlay
   repair, relay, activity/checkpoints, or per-session snapshot persistence. New
   browser activity ids create one idempotent checkpoint from converged
   canonical state.
4. The browser switches only its local active-tab binding. CodeMirror writes
   the active diagram's Y.Text; visual flowchart edits use `MutationQueue` so
   the latest source is parsed and minimally diffed before the Yjs write.
5. An MCP client supplies `Authorization: Bearer <sessionId>.<roomKey>` and
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
   broadcasts through the same Yjs document. Overlay discovery uses a bounded,
   canonical raw-scene revision; object create/update/reorder/delete first
   admit the exact participant+object candidate, then commit one object-only
   Yjs transaction. A newer scene or opaque v1 object is boundedly disclosed
   but read-only, so it cannot be silently dropped. Overlay-only mutations
   create no Mermaid revision/activity event and persist/checkpoint exactly as
   browser overlay writes. Read/discovery calls do not join an agent.
6. A stale MCP revision is a conflict signal: re-read, merge the current
   source, and retry. It must never result in a blind full-source overwrite or
   restore retry. Restore is a fresh-head checked copy-forward transaction: it
   retains the current name and prior records while creating one new revision.

## Mermaid and collaboration architecture decisions

| Decision | Direction | Reason and threshold |
| --- | --- | --- |
| Sequence and generic Mermaid preview | Reuse the Mermaid SVG/canvas path | Sequence diagrams retain viewBox-aware pan/zoom/Fit and add source-backed participant/message controls. Unsupported Mermaid remains source-only; `pnpm test:e2e-sequence` covers editing, cross-tab isolation, and invalid source. |
| Structural capability detection | Use Mermaid parser-result classification | Current representable `flowchart*` sources and the exact parser-reported `sequence` type expose scoped controls; unsupported and stale/invalid source stays source-editable. Empty UI derives from blank/header-only source, never a hidden type flag. |
| Mermaid family capability catalog | Keep the version-pinned parser-family descriptor shared and browser source-model adapters local | The shared catalog collapses Mermaid aliases, renderer variants, and Railroad grammar variants to 30 visual built-ins with starter/help/stability metadata. It exposes canvas, semantic-form, source-only, and unavailable-plugin modes without adding Yjs type metadata; browser adapters fail closed when source cannot safely support a semantic operation. Semantic panels share current-preview/Y.Text orchestration only; Class, State, and Requirement retain their own strict source models. |
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
  fail closed. Overlay records are a bounded, namespaced collaboration plane,
  not a generic root metadata channel; feature-specific payload semantics stay
  with their owning tools.
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
`pnpm test:e2e-workspace-ux` covers the root local-first boot (no server request or WebSocket), IndexedDB reload persistence, the saved-on-device status, and explicit-only promotion, as well as theme, flyout focus/exclusivity,
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
