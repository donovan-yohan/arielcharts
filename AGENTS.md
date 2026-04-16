# AGENTS.md

## Project overview

ArielCharts is a real-time collaborative Mermaid diagram editor. It's a pnpm monorepo with three packages:

- `apps/web` — React + Vite frontend (TypeScript, CSS modules, Yjs CRDT, CodeMirror, mermaid)
- `apps/server` — Node.js + Express backend (TypeScript, WebSocket via ws, MCP server, SQLite persistence)
- `packages/shared` — Shared types and constants

## Hermes agent profiles

Agent profiles live at `~/.hermes/profiles/`. Each has a `SOUL.md` (role description) and `config.yaml`.

| Profile    | Role                                                                 |
|------------|----------------------------------------------------------------------|
| `planner`  | Decomposes tasks, assigns to specialists, tracks progress, merges    |
| `frontend` | Implements UI components, pages, client-side logic (React/TS/CSS)    |
| `backend`  | Implements APIs, data models, server logic (Node/TS/Express)         |
| `qa`       | Tests implementations end-to-end, probes edge cases, runs test suites|
| `reviewer` | Reviews code for correctness, design quality, security, completeness |

All profiles use `gpt-5.4` via `openai-codex` provider.

## Validation steps

Before reporting work as done, agents **must** run these checks from the repo root:

```bash
# 1. Build the shared package first (other packages depend on it)
pnpm --filter @arielcharts/shared build

# 2. Typecheck all packages
pnpm typecheck

# 3. Run all tests
pnpm test

# 4. Full build
pnpm build
```

These mirror the CI pipeline in `.github/workflows/ci.yml`. If any step fails, fix the issue before committing.

## Local development

### Starting the dev servers

The web app and backend must both be running for full functionality:

```bash
# Terminal 1 — backend (port 4000)
pnpm --filter @arielcharts/server dev

# Terminal 2 — web app (port 3003, avoids conflicts with port 3000)
pnpm --filter @arielcharts/web dev -- --port 3003
```

### Workarounds

- **Port 3000 conflicts.** Port 3000 is often occupied by stale Next.js processes. Use `--port 3003` or kill the stale process: `lsof -ti:3000 | xargs kill`.
- **Lock file stuck.** If Next.js reports "Another dev server running", remove the lock: `rm -f apps/web/.next/dev/lock`.
- **Session routes.** Session pages are at `/s/[id]`, not `/session/[id]`.
- **WebSocket errors in headless tests.** The backend WebSocket server may reject connections from Playwright. These errors are cosmetic — the editor still works for local-only testing.

## Playwright UI validation

Use `e2e-validate.ts` at the repo root to validate interactive editor behavior in a real browser. This catches issues that typechecking alone cannot (overlay alignment, pointer events, DOM rendering).

### Prerequisites

```bash
# Install Playwright (one-time)
npx playwright install chromium
```

### Running

```bash
# Both dev servers must be running first (see "Local development" above)
npx tsx e2e-validate.ts
```

### What it tests

1. **Overlay alignment** — verifies node overlay buttons sit exactly on top of their SVG nodes (0px tolerance)
2. **Fit-to-diagram** — clicks the fit button and checks zoom updates
3. **Node click** — clicks a node and verifies the editing toolbar appears
4. **Add node** — clicks "Add node" from the toolbar, verifies a new node appears in both the diagram and the editor text
5. **Post-mutation alignment** — re-checks overlay alignment after the diagram changes

### When to run

Run this after any changes to:
- `apps/web/src/lib/svg-hit-map.ts` — coordinate transforms, hit map building
- `apps/web/src/components/diagram-canvas.tsx` — overlay positioning, pointer events, viewport transforms
- `apps/web/src/components/session-workspace.tsx` — SVG rendering pipeline, hit map wiring
- Any mermaid rendering or diagram mutation logic

### Extending

Add new test sections to `e2e-validate.ts` following the existing pattern. Push results to the `results` array and they'll appear in the summary. Screenshots are saved to `/tmp/arielcharts-*.png` for visual inspection.

## Common gotchas

- **Shared package must be built first.** `apps/web` and `apps/server` import from `@arielcharts/shared`. If you change shared types, rebuild with `pnpm --filter @arielcharts/shared build` before typechecking consumers.
- **pnpm monorepo.** Use `pnpm --filter <package>` to scope commands. Don't `cd` into subdirectories to run scripts.
- **Yjs CRDT types.** The server uses `Y.Doc`, `Y.Text`, `Y.Map`, and `Y.Array` for collaborative state. Mutations must happen inside `doc.transact()`.
- **mermaid-ast.** The web app uses a typed AST layer (`mermaid-ast` package) for flowchart parsing/rendering. Only flowchart syntax (`flowchart` or `graph` prefix) is supported — guard against other diagram types.
- **Test mocks.** Server test files (`index.test.ts`, `websocket.test.ts`) construct `ServerEnv` objects manually. When adding fields to `ServerEnv`, update all test mocks.
- **Node 24+.** The project requires Node 24 or later.
