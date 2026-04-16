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

## Common gotchas

- **Shared package must be built first.** `apps/web` and `apps/server` import from `@arielcharts/shared`. If you change shared types, rebuild with `pnpm --filter @arielcharts/shared build` before typechecking consumers.
- **pnpm monorepo.** Use `pnpm --filter <package>` to scope commands. Don't `cd` into subdirectories to run scripts.
- **Yjs CRDT types.** The server uses `Y.Doc`, `Y.Text`, `Y.Map`, and `Y.Array` for collaborative state. Mutations must happen inside `doc.transact()`.
- **mermaid-ast.** The web app uses a typed AST layer (`mermaid-ast` package) for flowchart parsing/rendering. Only flowchart syntax (`flowchart` or `graph` prefix) is supported — guard against other diagram types.
- **Test mocks.** Server test files (`index.test.ts`, `websocket.test.ts`) construct `ServerEnv` objects manually. When adding fields to `ServerEnv`, update all test mocks.
- **Node 24+.** The project requires Node 24 or later.
