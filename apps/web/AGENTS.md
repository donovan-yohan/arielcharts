# Web context

`src/components/session-workspace.tsx` binds a session's Yjs document to the
active tab, CodeMirror, Mermaid preview, and workspace UI. `diagram-canvas.tsx`
renders generic SVG navigation and flowchart-only structural controls.
`src/lib/diagram-mutations.ts` is the sole visual flowchart-to-source mutation
path; `diagram-layout.ts` owns per-diagram node-position encoding.
`theme-provider.tsx` is the sole browser theme controller.

## Current boundaries

- Durable shared state is the server/Yjs-owned tab catalog/order, Mermaid
  source, node positions, and activity feed. The browser renders that activity
  but does not own it. Active tab, camera, selection, open flyout, toolbar,
  rename draft, theme preference/system resolution, and transient drag state
  are local; remote updates must not take them over.
- Mermaid source is canonical. Flowchart canvas mutations serialize through
  `MutationQueue` and minimal Y.Text diffs. Other Mermaid diagrams are
  currently source-editable with flowchart mutation controls withheld.
- Source and activity flyouts overlay the canvas without moving outer anchors
  or camera state. Closing returns focus to the originating toggle.
- Shell semantic tokens are separate from Mermaid source-owned item styles.
  Authored item colors override the neutral accessible fallbacks.

## Mermaid and collaboration invariants

- Mermaid parser-result classification decides whether controls are structural.
  Derived SVG, kind, and errors are kept in a local per-diagram preview
  registry; stale or invalid source remains source-only.
- React Flow is a controlled view: Mermaid/parser output owns stable node ids,
  structure, and membership; app state owns selection; Yjs `nodePositions`
  owns durable layout. Its adapter may retain only measurement and positions
  for stable ids in the active local drag, including a multi-node drag batch.
- Resolved theme is a derived input to Mermaid rendering and React Flow color
  mode. Theme changes rerender previews; they do not change diagram source.
- Fit and floating toolbars use the measured unobscured canvas viewport; no
  overlay may mutate camera state merely by opening.
- Undo is per diagram and tracks only explicit local-human source/visual/layout
  origins. Remote, MCP, initialization, and reconciliation updates never enter
  that stack; keep `src/lib/collaboration-origins.test.ts` authoritative.
- `DragLayoutCommitter` is the sole durable drag-write path: it batches at 120
  ms and flushes every final group position before local runtime ownership is
  released. After release, the canonical Yjs position wins. Keep
  `src/lib/drag-layout.test.ts`, `src/lib/reactflow-controlled-node-adapter.test.ts`,
  `test:e2e-sequence`, and `test:e2e-collaboration` green.

Run `pnpm --filter @arielcharts/web test` for focused changes. Run
`npx tsx e2e-validate.ts` for legacy canvas coverage and
`pnpm test:e2e-sequence` for generic Mermaid coverage. For collaboration
changes also run `pnpm test:e2e-collaboration`. Inspect
`/tmp/arielcharts-sequence.png` and `/tmp/arielcharts-sequence-isolation.png`
for Mermaid changes, and `/tmp/arielcharts-collaboration.png` plus
`/tmp/arielcharts-collaboration-local-state.png` for collaboration changes.
`pnpm test:e2e-workspace-ux` is the exact production-mode browser gate for
theme, flyout, focus, responsive, toolbar, Fit, and layout stability; CI runs it.

No deeper nested `AGENTS.md` is justified for these cross-cutting web invariants.
