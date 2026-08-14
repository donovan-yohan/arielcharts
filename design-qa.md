# Inline overlay toolbar design QA

## Result

Final result: passed.

The source truth is the undesired anti-reference
`/home/donovanyohan/.codex/attachments/19c63b96-0dac-4e53-9f4f-a6b1fb33e720/codex-clipboard-6b28a070-0578-4be8-8cc1-f159d358b882.png`
(868 x 752): it shows a small three-button strip that opens a large dropdown
palette. The accepted direction is a persistent, centered, Figma-like inline
icon strip; screenshot fidelity to the anti-reference is explicitly not the
goal.

## Evidence

| State | Evidence | Dimensions | Coverage |
| --- | --- | --- | --- |
| Desktop light | `/tmp/arielcharts-inline-overlay-toolbar-light.png` | 1440 x 960 | Full view of the centered primary strip, canvas, source panel, and camera lane. |
| Desktop dark | `/tmp/arielcharts-inline-overlay-toolbar-dark.png` | 1440 x 960 | Full view of the same persistent strip with dark-theme contrast. |
| Phone default | `/tmp/arielcharts-inline-overlay-toolbar-mobile-390.png` | 390 x 844 | Full viewport; primary strip is reset to its default left-most tools before capture. |
| Phone landscape | `/tmp/arielcharts-inline-overlay-toolbar-mobile-landscape.png` | 844 x 390 | Full viewport; direct strip, canvas controls, and bottom lane coexist. |
| Comparison composite | `/tmp/arielcharts-inline-toolbar-design-comparison.png` | 1440 x 960 | Focused implementation comparison artifact. |

The focused evidence verifies direct Select, Text, Sticky, Rectangle, Ellipse,
Diamond, Line, Arrow, Pen, Highlighter, Eraser, Undo, Redo, and Objects/layers
actions rather than a More/Close palette. The production workspace UX browser
coverage also verifies 44px phone targets, first/last toolbar reachability,
roving keyboard behavior, contextual selected-object controls, inspector
containment above the camera lane, and error-banner coexistence.

## Fidelity surfaces

- Layout: a bounded horizontal strip is centered in the measured canvas lane;
  phone widths scroll the strip instead of opening a panel.
- Hierarchy: creation/history controls stay in the primary strip; selected-only
  actions are contextual; objects/layers are a bounded inspector disclosure.
- Interaction: there is no default dropdown, More control, or Close-palette
  state. Tooltips/labels, pressed states, V/Escape Select behavior, and cursor
  modes remain available.
- Accessibility: toolbar actions use semantic buttons, one roving tab stop per
  toolbar, arrow/Home/End navigation, and forced-colors/reduced-motion-aware
  styling.
- Responsive safety: the inspector capacity is conservatively floored with a
  one-pixel rendering reserve, keeping its border box above the camera safe
  lane even with fractional layout rectangles.

## Comparison history

1. The prior state was the anti-reference dropdown: compact top controls plus
   a large palette wall.
2. The implementation changed that to an always-visible inline icon toolbar.
3. Review fixes added a measured inspector/camera lane, responsive first/last
   reachability, roving focus repair, and explicit disclosure semantics.
4. Final evidence fixes made fractional inspector capacity conservative and
   reset the actual scrollable primary row before default mobile captures.

## Validation record

- Focused component test: `overlay-canvas-layer.test.tsx` passed (17 tests),
  including fractional inspector-capacity math.
- Production `mobile-390` workspace UX slice passed, including toolbar,
  inspector/error lifecycle, touch targets, and safe-lane assertions.
- The landscape slice exercised the overlay toolbar path and generated its
  capture, then stopped on an unrelated existing sequence-message control
  overlap with the canvas zoom-out control. That issue is outside the toolbar
  scope and is not classified as a toolbar design defect.
- Browser console output after aborted browser runs contained server-side
  `window is not defined` teardown noise; it did not accompany a toolbar
  assertion failure in the green mobile-390 slice.

The crowded phone global header is a pre-existing, out-of-scope follow-up. It
is not a toolbar P2 finding: the toolbar starts below the tab lane and remains
readable, directly reachable, and independently verified. There are no
actionable toolbar P0, P1, or P2 findings.
