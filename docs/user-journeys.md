# ArielCharts user journeys

This is the product acceptance contract for the browser workspace. It was defined
from the implemented routes and action paths with Koi, then supplied to Hotate's
[design-system contract](design-system.md). It describes required behavior, not a
claim that every state has passed runtime verification. Source ownership and
protocol details remain in [the context map](context-map.md).

## Product boundary

ArielCharts lets people create, revise, annotate, collaborate on, and hand off
Mermaid diagrams. The default workspace stays on the device until an explicit
sharing or agent-connection action promotes it to a protected online room.

The source-supported usage roles are local author, returning device author,
room-link recipient, collaborating author, presenting or following participant,
MCP-assisted author, and someone exporting or moving a workspace. These are usage
roles, not an account or permissions model.

There are two authored route patterns:

- `/` checks for an existing online handoff, otherwise hydrates the local workspace.
- `/s/[id]` validates the identifier and authorizes room access before mounting
  protected content. Malformed identifiers produce the framework not-found page.

Settings, Source, Activity, History, presentation, templates, and export are
workspace surfaces, not separate pages. An unmounted legacy entry component is
not an alternative root-route contract.

No dashboard, accounts, private per-person notes, new diagram families, cloud file
manager, onboarding tour, or unified history engine is implied by this contract.

## Terminology and essential information

| Term | Meaning |
| --- | --- |
| Workspace | Named diagram catalog, ordering, Mermaid source, layout, and canvas scenes. |
| Diagram | One named tab with canonical Mermaid source and its canvas scene. |
| Preview | A derived picture of source, possibly retained from an earlier valid render. |
| Canvas scene | Notes, drawings, shapes, connectors, frames, and layers, separate from Mermaid source. |
| Room | A workspace explicitly promoted to protected online collaboration. |
| Room key | An access capability, not a personal invitation or permission role. |
| Activity | A bounded collaboration feed, not immutable revision history or Undo. |
| Restore | A checked copy-forward operation in one history domain, not erasure of later history. |
| Fit | A local camera operation, distinct from resetting shared node layout. |
| Agent membership | An agent recorded in the workspace, not proof it is connected or working. |

Keep storage scope, action eligibility, current versus retained or historical
preview, destructive scope, and actionable recovery visible where they affect a
decision. Remove text that merely explains the implementation or repeats an
already-labeled action. Accessibility names and necessary validation are not
narration.

## Journey map

| ID | Job and entry | Required result | Distinguishing recovery and preservation | Patterns |
| --- | --- | --- | --- | --- |
| J01 | Start or resume work from `/`. | Hydrate before seeding; start without login or room/network creation. Offer one dismissible starter surface with useful actions. | Reload preserves device work. Storage failure never claims ready or saved. Overlay-only content is not empty. Dismissed guidance does not reappear automatically. | K01–K03, K17 |
| J02 | Choose a diagram kind through Add or the blank-canvas chooser. | Create one named source-backed tab from the selected template. Group by actual editing availability and stability. | Documentation links do not create tabs. Invalid or unrepresentable source retains Source editing without unsafe structural controls. Available external plugins are not blanket-disabled. | K04–K07, K09 |
| J03 | Bring in existing work or take an editable backup. | Paste Mermaid through Source, or explicitly replace the workspace with a valid editable bundle. Export the complete editable document separately from static images. | Validate file size, version, integrity, and budgets before confirmation. Cancel or invalid/stale admission leaves the document unchanged. Confirmation identifies whole-workspace scope and detects changes before apply. No dedicated Mermaid-file import is promised. | K11, K13, K17 |
| J04 | Write Mermaid and recover from invalid syntax. | Edit the current tab's canonical source and copy its current bytes. Keep same-tab retained preview distinct from current source. | First-invalid input cannot claim a retained picture. Errors never erase source, borrow another tab's render, enable stale edits, or export a stale picture as current. Panel resize/disclosure cannot move the camera. | K03, K07, K11, K17 |
| J05 | Edit flowchart structure and layout on the canvas. | Use current representable source for nodes, edges, labels, shapes, sections, grouping, and layout. Preserve selection, context menus, keyboard editing, and local-human Undo. | Nested renames preserve nesting. Parallel edges keep identity. Remote deletion during drag cannot resurrect a node; valid siblings can finish. Fit does not reset shared layout. | K06–K08, K17 |
| J06 | Edit a non-flowchart family through its supported form. | Preserve grammar-specific fields, operations, order, hierarchy, and canonical drafts through consistent labeled records. | Invalid values retain drafts and explain correction. Remote changes cannot retarget a draft. Valid but unrepresentable syntax stays source-editable without lossy normalization. A callback alone does not establish operation eligibility. | K07–K09, K17 |
| J07 | Add context through notes, shapes, text, or ink. | Persist canvas objects separately from Mermaid. Share them with the workspace when it goes online. Keep tool, selection, and unfinished drafts local. | Cancelled ink is not persisted. Each finished stroke is one Undo unit. Locks apply through all action paths. IME and remote text survive. Orphaned anchors retain fallback geometry; unknown/newer data remains recoverable. | K03, K06–K10, K17 |
| J08 | Organize context into layers and frames. | Distinguish object, frame, and layer; visibility, editing lock, and export inclusion remain separate. Show Objects and Layers in a usable inspector. | Hiding/export exclusion is not deletion. Frames affect overlay members, not Mermaid grouping. Selection-count actions remain correctly gated. Last controls remain reachable in a scrollable panel. | K06, K07, K10, K12 |
| J09 | Organize diagrams without losing orientation. | Activate and keyboard-navigate tabs; keep the active tab visible; rename with validation; explicitly confirm deletion. | Never delete the last tab. Reject blank/duplicate names without pretending they saved. Escape cancels a rename. Deletion names the actual target and shared consequences, then selects a valid adjacent tab. No tab-reorder feature is implied. | K04, K17 |
| J10 | Go online, share access, and recover safely. | Promote only on explicit intent. Keep local editing available during the pending snapshot request. Share only a real in-memory capability. | Duplicate promotion is blocked. Changed content cannot hand off an older snapshot. Failure preserves local work. A non-secret marker precedes navigation. Cookie-only access can edit but needs a replacement key to share. Reset explains revocation before confirmation. | K01, K02, K13–K15, K17 |
| J11 | Work with another browser or an MCP agent. | Browser and agent write the same admitted document. Show transport and membership truthfully; keep the room-scoped setup prompt and current-revision rules. | Stale writes require re-read and deliberate merge, never blind overwrite. Agent changes do not steal human tab, camera, flyout, or Undo. Durable membership does not imply current work. | K02, K06–K08, K14–K17 |
| J12 | Inspect changes and deliberately restore. | Separate Activity, Mermaid/layout history, and canvas-scene history. Detached preview is read-only. Restore explicitly names target and domain. | Local mode has no server history action. Confirmation cancellation writes nothing. Restore reads the current head and makes one checked request; conflicts require renewed review. Source restore leaves overlays alone; scene restore leaves source/layout alone. | K10–K12, K17 |
| J13 | Present or voluntarily follow someone. | Keep Present/Stop, Follow/Leave, and spotlight accept/ignore reachable, including compact layouts. | Never force-follow. Local interaction, tab choice, or disconnect releases following. Camera, laser, and presence stay ephemeral and out of exports/history. Local/history/disconnected eligibility remains truthful. | K02, K06, K07, K16, K17 |
| J14 | Export what the recipient needs. | Distinguish current Mermaid bytes, current static canvas SVG/PNG, and editable workspace backup. Respect visible/export-enabled scene content. | Invalid, pending, stale, or historical render cannot masquerade as current static output. Source and editable recovery stay available. No credentials, awareness, drafts, or comments enter static output. Overlay-only static export is not promised by an SVG-dependent renderer. | K11, K13, K17 |
| J15 | Work with themes, touch, keyboard, and small screens. | Keep all existing jobs reachable with consistent controls and a usable canvas lane. Theme is local and never rewrites authored colors/source. | Errors, long names, expanded tools, and inspectors cannot hide recovery or final actions. Inputs/IME own typing and text Undo. Closing a surface returns appropriate focus without stealing an outside action. | K01–K17 |

## State acceptance examples

These cases define the corpus for acceptance. They are not a percentage-complete
score or inherited test results. Record source, command, outcome, and evidence
for each affected case in the release review.

| Case | Discriminating setup | Observable acceptance |
| --- | --- | --- |
| A01 | Fresh local boot; create source and sticky; reload. | No room/socket/MCP before explicit intent; existing content hydrates intact. |
| A02 | IndexedDB initialization fails. | Honest unavailable state without a false save/readiness claim. |
| A03 | Blank, header-only, overlay-only, dismissed guidance, and competing panel. | One appropriate guidance owner; creation/Source remain reachable. |
| A04 | Catalog families and available external starter; separate Docs click. | One correct source-backed tab; no hidden durable family flag; Docs creates nothing. |
| A05 | Valid → invalid → fixed source; separately first-invalid and tab switch. | Same-tab retained preview only, truthful feedback, no stale mutation/static export. |
| A06 | Pointer/keyboard Source open, resize, close, and clipboard refusal. | Stable anchors/camera, sensible focus return, current-source copy and honest result. |
| A07 | Invalid numeric draft, hierarchy ambiguity, remote target change. | No silent draft loss, wrong-target mutation, or lossy source rewrite. |
| A08 | Nested rename, parallel edges, remote delete during multi-drag. | Nesting and edge identity preserved; deleted targets stay deleted; valid positions converge. |
| A09 | Note/ink creation, explicit promotion, second authorized browser. | Shared objects, local interaction state, and note-free Mermaid export. |
| A10 | IME plus remote text, reversed line, legacy diamond transform, cancelled ink. | Text/geometry identity survives; cancelled stroke absent; finished stroke Undo remains scoped. |
| A11 | Hidden/locked/export-disabled layer/frame members; alternate mutation paths. | No unauthorized object changes; hidden content retained; export choices respected. |
| A12 | Blank/duplicate rename, Escape, last-tab restriction, confirmed/cancelled deletion. | Truthful validation, cancellation without writes, informed target, valid adjacent focus. |
| A13 | Held promotion request with edit, network refusal, unchanged success, navigation interruption. | No stale handoff or content loss; pending editing matches contract; safe room resume. |
| A14 | Fragment success, stale fragment with valid cookie, no access, bad key, malformed ID. | Secret cleared before protected mount; no early sockets/history; appropriate generic refusal. |
| A15 | Cookie-only reload; reset cancellation/confirmation; old browser and agent access. | Clear missing-key recovery; cancel unchanged; confirmed replacement revokes old access. |
| A16 | Browser changes source between agent read/write; durable offline agent entry. | Stale write refused; membership not described as work; human local UI/Undo preserved. |
| A17 | History loading/error/empty; preview during remote edit; stale restore. | No preview writes or camera changes; fresh-head single restore; renewed review on conflict. |
| A18 | Source restore, scene restore, and local inspector. | Only the named domain changes; local server-history action unavailable; no implicit paired restore. |
| A19 | Current source/static/editable export; invalid/stale render; overlay-only scene. | Correct bytes and eligibility; no secret/draft leakage; unsupported static result not promised. |
| A20 | Valid bundle; bad integrity/new version/oversize/stale scope; cancel. | Informed atomic replacement; unchanged document on every failed/cancelled path. |
| A21 | Ignore/accept spotlight, local pan/tab choice, disconnect, compact presentation. | Voluntary following and reachable exits; no durable camera/laser state. |
| A22 | System/light/dark, authored colors, editor hotkeys, IME. | Local appearance only; unchanged source; visible focus; no canvas shortcut theft. |
| A23 | Narrow portrait, short landscape, enlarged browser zoom, long names, dense errors/inspector. | Critical controls and status visible; final actions scroll into view; disclosure does not move camera. |

## Verification boundary

Existing unit tests and UX, subgraph, sequence, and collaboration browser gates
provide the starting coverage. Source inventory, a rendered starter, geometry
assertions, design approval, and deployed production behavior are distinct forms
of evidence. Do not report every family as exercised from shared-component tests
or infer live collaboration from a local fixture.

For family/component ownership and composition rules, use
[the design system](design-system.md). Release commands and production topology
remain in the root project instructions and context map.
