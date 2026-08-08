# Web context

`src/components/session-workspace.tsx` binds a session's Yjs document to the
active tab, CodeMirror, Mermaid preview, and workspace UI. `diagram-canvas.tsx`
renders generic SVG navigation and flowchart-only structural controls.
`src/lib/diagram-mutations.ts` is the sole visual flowchart-to-source mutation
path; `diagram-layout.ts` owns per-diagram node-position encoding.

## Current boundaries

- Durable shared state is the tab catalog/order plus each tab's Mermaid source
  and node positions. Active tab, camera, selection, open flyout, toolbar,
  rename draft, and transient drag state are local; remote updates must not
  take them over.
- Mermaid source is canonical. Flowchart canvas mutations serialize through
  `MutationQueue` and minimal Y.Text diffs. Other Mermaid diagrams are
  currently source-editable with flowchart mutation controls withheld.
- Source and activity flyouts overlay the canvas rather than changing its
  geometry. Treat visible/clickable toolbar controls and stable preview bounds
  as browser-testable behavior.

## #12/#13 target guardrails

- Replace the current source-prefix flowchart check with Mermaid parser-result
  classification. Keep last-valid SVG and kind per tab so invalid source in one
  tab cannot affect another tab.
- Track only explicit local-human transaction origins in undo. Remote, MCP,
  initialization, and reconciliation updates must never enter that stack.
- Coalesce durable layout writes during a local drag and apply remote layout
  changes without jittering the active drag.

Run `pnpm --filter @arielcharts/web test` for focused changes. Run
`npx tsx e2e-validate.ts` after canvas, flyout, toolbar, layout, or responsive
UI changes, then use root gates before handoff.
