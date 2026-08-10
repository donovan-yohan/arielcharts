# ArielCharts canvas-first design QA

> **Historical design-QA artifact — superseded on 2026-08-10.** This is a
> point-in-time visual comparison for the canvas-first slice, not a current
> product acceptance report. Its cited issue state, screenshots, browser
> observations, and "final result" must not be used as present-tense evidence.
> Use [ARCHITECTURE.md](ARCHITECTURE.md), [docs/context-map.md](docs/context-map.md),
> current tests, and fresh browser evidence for current behavior.

- Source visual truth: `reports/design-reference/canvas-first-history-flyout.png`
- Browser implementation: `reports/design-qa/activity-flyout.png`
- Additional states: `reports/design-qa/canvas.png`, `reports/design-qa/source-flyout.png`
- Full comparison: `reports/design-qa/reference-vs-activity.png`
- Focused flyout comparison: `reports/design-qa/flyout-detail.png`
- Viewport and CSS size: 1488 x 1058
- Device scale factor: 1
- Source pixels: 1487 x 1058; implementation pixels: 1488 x 1058
- Density normalization: none required; the one-pixel source-width difference is outside the product layout and was retained in the full comparison.
- State: dark desktop workspace, populated flowchart, activity flyout open. The source mock includes future revision preview/restore and additional populated tabs; those intentionally remain tracked in issues #17 and #15 and are not represented as working controls in this slice.

## Findings

No actionable P0, P1, or P2 fidelity findings remain for the selected canvas-first slice.

- P3: The implemented dot grid is slightly brighter than the reference at full-canvas scale. It remains restrained, meets the bullet-journal direction, and preserves graph contrast.
- P3: The implementation retains ArielCharts' existing compact monospace utility copy while the reference mock uses slightly larger proportional labels in a few controls. Hierarchy and scanability remain equivalent.

## Required fidelity surfaces

- Fonts and typography: logo, tab, flyout, activity, and footer hierarchy are clear and consistent with the existing product language. Labels do not wrap or truncate at the target viewport.
- Spacing and layout rhythm: top bar, tab rail, full canvas, overlay flyout, and simple footer match the selected composition. The preview root remained exactly `{ x: 0, y: 103, width: 1488, height: 901 }` with the source flyout open, both flyouts closed, and the activity flyout open.
- Colors and tokens: dark navy surfaces, blue active state, green save state, orange human presence, muted borders, and cyan dot grid preserve the reference's semantic palette and contrast.
- Image quality and assets: the UI has no photographic or illustrative assets. Product icons use the existing Lucide family and remain sharp at device scale factor 1; the reference image itself is preserved without substitution.
- Copy and content: source/history labels, flowchart editability, live-save state, activity descriptions, and named tab copy are coherent. Unsupported revision actions are not faked.
- Accessibility and interaction: the tablist supports arrow-key roving focus and controls a labeled tabpanel. Source and activity are mutually exclusive, Escape closes a flyout, and the tested node-edit/zoom/Fit controls were visible, inside the viewport, unobstructed at their center points, and clickable.

## Browser evidence

- Created a new session and received exactly one `Main` tab.
- Entered a six-node Mermaid flowchart, renamed the tab to `API request flow`, and verified the source flyout title updated immediately.
- Opened source, closed it, opened activity, and verified identical preview bounds in all three states.
- Verified source was absent while activity was open.
- Clicked the node edit control and the Zoom out, Zoom in, and Fit controls.
- Created a second blank tab and verified two tabs plus arrow-key tab focus.
- Console was checked. Chromium emitted one generic development 404 console line, while the captured response list contained no HTTP response with status 400 or higher; no application/runtime errors were observed.

## Comparison history

1. Initial implementation review found a 64 px bottom gap under the overlay flyout and a stale `Main` label after renaming the active tab. The flyout was extended to the workspace bottom, and the displayed title was rebound to the latest diagram catalog without rebinding CodeMirror.
2. Focused tests were added for the renamed active title. The implementation was recaptured at the same 1488 x 1058 viewport and compared with the source in the combined full-view and focused flyout images above.
3. Post-fix browser evidence showed stable geometry, current tab metadata, mutually exclusive flyouts, reachable controls, working tab creation and keyboard focus, and no application console errors.

Focused comparison was necessary because activity typography, borders, timeline markers, and footer/flyout alignment are too small to judge reliably in the 2975 px-wide full comparison.

final result: passed
