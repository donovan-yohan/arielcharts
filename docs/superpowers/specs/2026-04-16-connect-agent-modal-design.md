# Connect My Agent Button + Modal

## Summary

Add a "connect my agent" button to the workspace topbar that opens a modal with a copy-pasteable prompt for connecting an AI agent to the current session via MCP. Also shrink the existing URL chip to show only the session ID.

## Topbar Left Layout

**Current:**
```
[ArielCharts]  [https://arielcharts.donovanyohan.com/s/qh4npzhs | copy]
```

**New:**
```
[ArielCharts]  [connect my agent]  [qh4npzhs | copy]
```

- The URL chip shrinks to display only the session ID instead of the full URL.
- A new "connect my agent" button sits between the logo and the session ID chip.
- Button is styled as a prominent accent button (purple/blue gradient using `--accent` / `--accent-strong`) to match the visual weight of the green share button on the right side.

## Modal

Opens when clicking "connect my agent". Dark-themed to match the app.

### Content

- **Title:** "Connect your agent"
- **Prompt block:** A `<pre>` element containing a natural language prompt with a copy button inline on the block. The prompt includes:
  - The MCP server URL
  - The current session ID
  - A hint to look up docs for adding an MCP server globally

Example prompt text:
```
Connect to my ArielCharts session "qh4npzhs" using the MCP server at https://arielcharts.donovanyohan.com/mcp. You can read and write Mermaid diagrams collaboratively in real-time. Look up your docs for how to add an MCP server globally.
```

- **Copy button:** Inline on the `<pre>` block, uses the existing copy-to-clipboard pattern with `copied` / `error` / `idle` state feedback.

### Dismiss

- Click the X button
- Click outside the modal (on the backdrop)
- Press Escape

## Implementation Scope

- All changes in `session-workspace.tsx` (modal + button + topbar layout change)
- New CSS in `globals.css` (modal styles, new button variant, updated chip styles)
- No new files or dependencies
- The MCP server URL is derived from `window.location.origin + '/mcp'`
- The session ID is already available as a prop
