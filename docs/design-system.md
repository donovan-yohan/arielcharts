# ArielCharts design system

This contract translates the [user journeys](user-journeys.md) into component
selection, composition, copy, and state rules. Hotate defined it from actual
source consumers and rendered desktop, mobile, light/dark, and constrained-height
screens. These are implementation acceptance requirements, not a claim that a
token file or component inventory alone establishes adoption.

## Direction and ownership

Preserve the warm-neutral whiteboard and chalkboard palette, rounded sans,
Mermaid-first expanding toolbar pill, contextual menus, and canvas-first shell.
Keep Next.js, native React controls, CodeMirror, Mermaid, React Flow, and the
existing source/scene authorities. Do not introduce a framework migration or a
second theme system through a styling change.

The maintained foundation is the project's native-control presentation layer and
semantic CSS. A new external UI kit would duplicate the existing bespoke canvas,
editor, portal, and roving-focus owners. Shared primitives must style native
controls and accept their ordinary props, refs, accessible names, and states;
they must not replace those owners or create a parallel state framework.

| Authority | Source | Rule |
| --- | --- | --- |
| Semantic color, typography, geometry, and spacing | `apps/web/src/app/globals.css` | One token authority. Shell colors are not authored Mermaid/object colors. |
| Theme preference and system resolution | `components/theme-provider.tsx`, `lib/theme.ts` | Local preference only. `public/theme-init.js` mirrors first-paint resolution. |
| Workspace orchestration | `components/session-workspace.tsx` | Own Yjs bindings, tab/source state, promotion, and existing request lifecycles. Pass explicit presentation state. |
| Diagram rendering and capability | `lib/diagram-preview.ts`, `lib/diagram-capabilities.ts`, family mutation owners | Source and parser/model admission decide safe operations. Styling cannot broaden grammar support. |
| Canvas navigation and measured geometry | `components/diagram-canvas.tsx` and viewport/safe-lane helpers | Preserve camera, hit maps, drag, transforms, and local selection. |
| Canvas objects and toolbar/inspector | `components/overlay-canvas-layer.tsx`, `lib/use-overlay-scene.ts` | Scene content is durable; tools, unfinished strokes, selection, and handles are local. |
| Family/starter catalog | `packages/shared/src/mermaid-diagram-catalog.ts`, `starter-templates.ts` | Derive family inventory; do not maintain a reduced competing chooser list. |

Component paths below are relative to `apps/web/src/`. Keep visual primitives
focused on actions, fields, records, panels, notices, and dialog paint. Reuse
existing menu, modal, flyout, and toolbar behavior rather than manufacturing one
universal controller.

## Component-selection registry

This registry covers product patterns, not one required React file per row. A
component's presence in source does not prove its consumers use the system.

| ID | Pattern | Existing behavior/source owner | Selection and extension rules |
| --- | --- | --- | --- |
| K01 | Route gate and status card | `components/local-workspace-gate.tsx`, `room-gate.tsx`, local loader in coordinator | One gate anatomy for checking, restoring, preparing, storage error, locked form, submit/error, and archive recovery. Keep authorization before protected mount. Do not revive legacy automatic room creation. |
| K02 | Workspace shell and footer | Coordinator topbar; `workspace-tab-strip.tsx`, `workspace-footer.tsx` | Stable outer anchors, shared action geometry, one visible storage/transport statement at every width. Counts and avatars are context, not save acknowledgement or proof of work. |
| K03 | Starter and empty canvas | `workspace-onboarding.tsx`, source-derived canvas chooser | Passive dismissible starter and type chooser have distinct eligibility. Never stack competing empty prompts. Overlay-only content is populated. Suppress guidance behind competing inspectors when it cannot fit. |
| K04 | Tabs, rename, and delete | `workspace-tab-strip.tsx`, coordinator catalog handlers | Roving tablist, overflow reveal, retained invalid-name draft, local validation, explicit target/scope deletion. Preserve last-tab guard and adjacent focus. |
| K05 | Grouped creation chooser | `workspace-template-picker.tsx`, shared starter catalog | Predictable availability/stability groups, consistent item/help-link geometry, independent Docs action. Preserve keyboard navigation and available external plugins. |
| K06 | Tool palette, toolbar, and menu | Overlay toolbar, canvas toolbar, `canvas-context-menu.tsx` | One native icon/action treatment; behavior owners retain roving focus, disabled skipping, pressed state, shortcuts, context placement, and selection eligibility. No second toolbar mode owner. |
| K07 | Canvas navigation and selection | Diagram canvas, React Flow adapter, overlay handles | Common action sizing without changing world geometry. Fit all/selection remain distinct from shared layout reset. Measured occupied chrome determines usable viewport. |
| K08 | Inline and creation editors | Canvas node/edge/section forms, overlay text editor | Shared labeled fields, commit/cancel actions, validation and focus paint around current identity/IME logic. Do not move draft ownership into a presentation wrapper. |
| K09 | Semantic family panel and record | Family controls in `diagram-canvas.tsx` | Shared field/action/record/scroll anatomy across every family below, including ER, Sequence, and paired containment asides. Preserve family-specific fields, adapters, callbacks, and canonical drafts. |
| K10 | Objects, layers, and frames inspector | `overlay-canvas-layer.tsx` | Objects then Layers, clear selection context, labeled native fields, distinct visibility/lock/export controls. Scroll to the final action. Unknown/newer scenes retain read-only recovery. |
| K11 | Source flyout | `workspace-flyouts.tsx`, coordinator CodeMirror configuration, `lib/source-flyout-resize.ts` | Resizable overlay, mobile sheet, current-source copy, truthful preview notice. Preserve editor Undo, focus return, and camera anchors. |
| K12 | Activity, history, and restore | Flyouts/coordinator source-history owner; overlay scene-history owner | Separate domains and current/history state. Detached preview writes nothing. Scope-specific confirmation names real revision metadata; stale restore requires renewed review. Local mode cannot call server history. |
| K13 | Export, import, and file action | `workspace-export-menu.tsx`, bundle/import/composite libraries | Distinguish source, static canvas, and editable backup. Validate before informed replacement confirmation. Static eligibility requires current valid render. Preserve source/editable recovery. |
| K14 | Settings and access controls | `workspace-settings.tsx`, theme/access owners | Reuse shared fields/actions for name and appearance. Keep local context, key unavailable/known, copy result, and revoke confirmation truthful and scoped. |
| K15 | Agent setup dialog | Coordinator agent modal and existing prompt builder | Shared bounded dialog/close/scroll treatment, exact technical prompt retained. Membership and connection remain separate; missing-key/copy failure has actionable recovery. |
| K16 | Presentation and presence | `presenter-controls.tsx`, presenter-follow hook, awareness layers | Styled native actions and consent; Present/Stop/Follow/Leave remain reachable in compact layouts. Following remains voluntary. Participant colors are data-driven, not shell palette drift. |
| K17 | Feedback and help | Local validation, shared notices, canvas feedback, shortcut dialog | One relevant announcement per action. Distinct errors stack without overlap; detailed diagnostics remain available. Shared modal paint does not impose modal focus policy on popovers. |

### Primitive selection

- Use native buttons for actions, native inputs/selects/textareas for fields, and
  native checkbox/radio glyphs with associated labels for boolean/choice state.
- Actions support neutral, primary, danger, and toggle presentation; compact,
  standard, and touch geometry; disabled, busy, pressed, hover, and focus states.
- Fields include a persistent visible label, control, optional task-specific help,
  and local error. A placeholder or accessible name alone is not a visual label.
- Records identify their target, group related fields, and separate commit,
  ordering, and destructive actions. Domain wrappers supply values and callbacks.
- Panels own their insets and scroll region. Children own field/action gaps; they
  do not add another full panel inset or reconstruct borders independently.
- Dialog paint is shared, but modal entry/trap/Escape/pending/return policy stays
  explicit. Popover outside-click behavior must not steal an interactive target's
  focus. Existing context menu owns its own portal and keyboard behavior.
- Exceptions include CodeMirror internals, hidden file inputs, world-geometry
  handles, authored SVG/object styles, and participant colors. Document an
  exception by its purpose, not as a blanket escape from adoption.

## Family and form ownership

All families retain source editing and safe generic navigation/annotation when
structural forms are unavailable. Blank is a starter state, not a family. There
are 30 built-in family descriptors and an available external ZenUML family.
There are 30 semantic panel IDs plus the separate flowchart control surface;
C4 and Block also have paired containment surfaces.

All panel owners below are symbols in `components/diagram-canvas.tsx`; mutation
filenames are under `lib/`. Shared presentation must reach record subforms,
move/order buttons, numeric error states, and cached canonical-draft editors,
not just the outer aside.

| Family | Panel / test-ID root | Domain-specific content retained | Mutation authority |
| --- | --- | --- | --- |
| Flowchart | `DiagramCanvas`; node/edge/subgraph toolbars | Node/shape/label, edge identity/type/label, nested sections, grouping, layout | `diagram-mutations.ts` |
| Sequence | `SequenceEditorControls`; `sequence-editor-controls` | Participants/actors, messages, arrows, notes, activation, fragments, autonumber, order | `sequence-mutations.ts` |
| Entity relationship | `ErEditorControls`; `er-editor-controls` | Entities, typed attributes/keys/comments, cardinality, identifying relations, dependent deletion | `er-mutations.ts` |
| Class | `ClassEditorControls`; `class-editor-controls` | Classes, members, annotations, relationships | `class-mutations.ts` |
| State | `StateEditorControls`; `state-editor-controls` | States, transition identities and labels | `state-mutations.ts` |
| Requirement | `RequirementEditorControls`; `requirement-editor-controls` | Requirements/elements, risk/verification, relations | `requirement-mutations.ts` |
| Architecture | `ArchitectureEditorControls`; `architecture-editor-controls` | Services/groups/junctions, icons/parents, ports/flags, alignment | `architecture-mutations.ts` |
| Block | `BlockEditorControls`; `block-editor-controls`, `block-containment-controls` | Columns, nodes/spans, composites/links, containment | `block-mutations.ts` |
| C4 | `C4EditorControls`; `c4-editor-controls`, `c4-containment-controls` | Elements, technology/description, boundaries/relations, containment | `c4-mutations.ts` |
| Swimlane | `SwimlaneEditorControls`; `swimlane-editor-controls` | Lanes, nodes, lane assignments, handoffs | `swimlane-mutations.ts` |
| User journey | `JourneyEditorControls`; `journey-editor-controls` | Sections/tasks, satisfaction scores, actors, ordering | `journey-mutations.ts` |
| Gantt | `GanttEditorControls`; `gantt-editor-controls` | Sections/tasks, dates/dependencies/duration/status, ordering | `gantt-mutations.ts` |
| Timeline | `TimelineEditorControls`; `timeline-editor-controls` | Direction, sections, periods/events, destination/order | `timeline-mutations.ts` |
| Gitgraph | `GitGraphEditorControls`; `gitgraph-editor-controls` | Commit/branch/checkout/merge/cherry-pick records and ordering | `gitgraph-mutations.ts` |
| Event modeling | `EventModelingEditorControls`; `event-modeling-editor-controls` | Timeframes, entities/data, rename/edit/order | `event-modeling-mutations.ts` |
| Kanban | `KanbanEditorControls`; `kanban-editor-controls` | Columns, cards, metadata, movement | `kanban-mutations.ts` |
| Mindmap | `MindmapEditorControls`; `mindmap-editor-controls` | Topics, shape/classes/icon, parent/order | `mindmap-mutations.ts` |
| Tree view | `TreeViewEditorControls`; `treeview-editor-controls` | Labels, parent/order | `treeview-mutations.ts` |
| Ishikawa | `IshikawaEditorControls`; `ishikawa-editor-controls` | Effect, nested causes, parent/order | `ishikawa-mutations.ts` |
| Railroad | `RailroadEditorControls`; `railroad-editor-controls` | Rule names/grammar/order; parser variants remain one family | `railroad-mutations.ts` |
| Pie | `PieEditorControls`; `pie-editor-controls` | Title/value visibility, slices/labels/values/order | `pie-mutations.ts` |
| Quadrant | `QuadrantEditorControls`; `quadrant-editor-controls` | Title, axes/quadrant labels, point coordinates/options/order | `quadrant-mutations.ts` |
| XY chart | `XyChartEditorControls`; `xychart-editor-controls` | Title/orientation, axes, bar/line series/values/order | `xychart-mutations.ts` |
| Radar | `RadarEditorControls`; `radar-editor-controls` | Title/options, axes, aligned curve values/order | `radar-mutations.ts` |
| Sankey | `SankeyEditorControls`; `sankey-editor-controls` | Weighted/repeated link identity, node rename, order | `sankey-mutations.ts` |
| Packet | `PacketEditorControls`; `packet-editor-controls` | Field ranges, labels, order | `packet-mutations.ts` |
| Cynefin | `CynefinEditorControls`; `cynefin-editor-controls` | Domain items/movement, transitions/order | `cynefin-mutations.ts` |
| Treemap | `TreemapEditorControls`; `treemap-editor-controls` | Weighted nodes/subtrees, reparent/order, canonical drafts | `treemap-mutations.ts` |
| Venn | `VennEditorControls`; `venn-editor-controls` | Sets/subsets/overlaps, rename/order, one-property styles | `venn-mutations.ts` |
| Wardley | `WardleyEditorControls`; `wardley-editor-controls` | Components/anchors/pipelines, coordinates/strategy/inertia, links/evolution/notes | `wardley-mutations.ts` |
| ZenUML | `ZenUmlEditorControls`; `zenuml-editor-controls` | Participants/messages/nested controls, parent/order, lazy loading | `zenuml-mutations.ts`, `zenuml-runtime.ts` |

Operation eligibility requires current valid preview, current source identity,
representability, adapter support, and the real callback's admission. Do not infer
permission from a panel's callback list. Rich Venn styles, for example, remain
source-only when the form cannot represent them without loss.

## Typography and copy

| Role | Target |
| --- | --- |
| Shell body | 13px, line-height 1.4, existing sans stack |
| Field label | 12px, line-height 1.35, weight 600 |
| Help/status | 12px, line-height 1.4 |
| Panel/dialog title | 14px, line-height 1.35, weight 700 |
| Starter heading | 16px, line-height 1.3, weight 700 |
| Gate heading | Up to 28px, 24px narrow, line-height 1.15 |
| Source editor | 14px mono, line-height 1.5 |
| Narrow text-entry/select control | 16px |

Use sentence case for human labels and accessible names. Preserve technical names
and exact enum, source, prompt/protocol, and user-authored bytes. Do not enforce
lowercase on buttons or uppercase whole error/status sentences with CSS.
Nonessential compact metadata can use 11px; required recovery and editable
controls cannot.

| Before / rejected pattern | Required treatment |
| --- | --- |
| “Type private canvas context.” | No privacy claim. Notes belong to the shared workspace. |
| “Start with Mermaid, then add collaboration layers.” plus mechanical subtitles | “Start a diagram” and the existing useful actions. At most one consequence sentence about notes/drawings staying with the workspace. |
| Device-save text repeated beside Activity and again beside a “device” badge | One visible “Saved on this device” status, including mobile. |
| “All changes saved” inferred from an open transport | “Connected”, “Connecting…”, “Reconnecting…”, or “Offline”, according to actual transport state. |
| Agent membership described as “working” | “1 MCP agent in this workspace” or plural; connection shown separately. |
| Preparing state says workspace is already ready | One truthful pending message. |
| “Paste this diagram into a GitHub PR” beside “Copy for GitHub PR” | Keep the action and its result announcement; delete the duplicate instruction. |
| “Restore overlay” for whole-scene replacement | “Restore previous canvas scene…” with target metadata and explicit domain confirmation. |
| Every parse failure says last-valid preview was kept | Distinguish no preview, retained same-tab preview, and failed historical preview. |

Keep concise diagnostics, destructive effects, family-specific field semantics,
missing-key recovery, current-versus-history distinctions, and meaningful format
scope. Deleting narration does not authorize deleting useful facts or controls.

## Geometry and spacing

- Use the 4/8/12/16/20/24px spacing scale. Label-to-control gap is 4px; field/action
  gaps 8px; record separation 12px; panel padding 16px, 12px narrow; section gap
  16px; modal body 20px, 16px narrow.
- The panel owns outer padding; records/fields own their internal gaps. Do not
  double-pad nested sections. Align labels, control text insets, section edges,
  and action rows on the same content grid.
- Desktop standard fields/text buttons have a 36px minimum height; compact chrome
  is 32px. Narrow/coarse-pointer action targets are at least 44×44px. Canvas
  navigation may use compact 32px desktop icons, not 24px touch controls.
- Keep the existing toolbar pill's 44px tool cells, 4px inset, and 12px radius.
  Shared field/button radius is 6px; panel/popover 10–12px; mobile sheet top
  corners 16px. Avatars remain circular.
- Inputs/selects/textareas use explicit semantic surface, border, text, font,
  and padding, with `width: 100%` and `min-width: 0`. Controls must not inherit
  inconsistent browser-default geometry. Checkbox/radio glyphs stay native
  16–18px inside an associated touch target, not enlarged 44px glyphs.
- Fields have persistent labels. Records wrap actions and reflow to one field
  column at narrow widths; a fitting labeled coordinate pair can remain two
  columns. Save/Delete must not require horizontal scrolling or sit offscreen.
- Use one primary commit action per draft. Ordering actions are neutral;
  destructive actions use danger treatment and remain distinct from Save.
  Disabled and selected are different states. Focus remains visible over both.

## Responsive composition and feedback

1. Preserve topbar, tabs, footer, and camera anchors. Opening a flyout, inspector,
   menu, or toolbar expansion changes occupied chrome, not the camera.
2. Measure actual occupied error, toolbar, navigation, and flyout rectangles.
   Do not introduce a second geometry authority based on padding guesses.
3. Distinct errors occupy one vertically stacked feedback region with 8px gaps.
   Wrap and cap/scroll long diagnostics. No two absolute banners share one anchor;
   no reserved error height exists when there is no error. Deduplicate the same
   failure without hiding independent failures.
4. Family panels and inspector have `min-height: 0`, bounded scroll, and a usable
   body. In short landscape, use compact shell actions and a bounded overlay
   panel above the footer rather than an unusable clipped slice. The close
   control and final record/layer/ink action must remain reachable.
5. Passive guidance uses the free canvas lane, including expanded tools and the
   inspector. Suppress it when it cannot fit without covering work or controls;
   creation and Source remain available elsewhere.
6. Keep one visible footer state string at every width. A green dot without the
   local-storage qualifier is insufficient. Reduce redundant chrome before
   hiding a necessary fact.
7. Use dynamic viewport height and safe-area insets for narrow shells. Test
   portrait, short landscape, long labels, simultaneous errors, expanded tools,
   populated inspector, and enlarged browser zoom, not only an empty desktop.

## Focus, semantics, and accessibility

- Native controls, tabs, menu items, summaries, and resize handles retain their
  correct semantics and a visible 2px semantic focus ring. Forced-colors mode
  keeps focus and boundaries visible.
- Modal confirmations have a name, modal semantics, initial Cancel focus, trap,
  Escape/pending policy, scroll bounds, and focus return. Existing nonmodal
  surfaces remain nonmodal. Pending destructive work cannot invite duplicate
  writes through dismiss/reopen.
- Preserve tab arrows/Home/End; chooser/context-menu navigation; toolbar roving
  focus; disabled skipping; and nearest-owned Escape handling. Inputs and IME
  own typing, selection, composition, and text Undo.
- Browser Cmd/Ctrl +/− remains browser zoom. Canvas +/− and Shift+1/2 retain their
  existing meanings. Help documents actual platform modifiers.
- Tooltips supplement accessible names; they are not the only touch/focus
  explanation. Unavailable actions need a reachable reason, not disabled hover.
- Verify resolved text contrast at least 4.5:1 for ordinary text, 3:1 for large
  text and relevant nontext boundaries. Palette membership is not a contrast
  measurement. Respect reduced motion and avoid decorative hover movement.

## Adoption and regression rules

- Derive family coverage from the shared catalog, map every expected family to
  its actual surface/operation owner, and include C4/Block containment. A reduced
  hand-maintained list cannot certify complete adoption.
- Check native descendants, not just panel wrapper classes. Buttons and fields
  must use maintained presentation; inspect resolved size/font/surface/border
  at desktop and narrow widths in both themes. Preserve documented native and
  geometry exceptions.
- Reject repeated family-local padding, radius, control color, type, or layout
  decisions that recreate the shared system. Dynamic world geometry and authored
  data styles are legitimate local values.
- Check persistent labels, error association, native action type, pressed and
  disabled state, wrapping actions, and final-action reachability. Pair source
  adoption guards with rendered and behavioral checks.
- Exercise cancellation/no-write, stale scope, single checked restore, editable
  pending promotion, truthful transport/membership, and invalid static-export
  refusal. Mocked acceptance is not live collaboration evidence.
- Preserve all existing family mutation/canonical-draft tests. Runtime sampling
  must cover distinct numeric, relationship, hierarchy, containment, dense mixed,
  source-only, and external-plugin anatomy, plus selected flowchart controls.
  Do not claim every family variant was executed from one shared-panel pass.
- Capture and inspect complete mobile/desktop light/dark screens and constrained
  errors/inspector composition. Record applicable repository gates at the actual
  candidate head. Source inventory, design approval, integration acceptance,
  and verified production deployment remain separate claims.
