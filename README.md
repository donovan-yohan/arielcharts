# MermaidFlow

MermaidFlow is a collaborative Mermaid diagram editor with realtime Yjs sync and MCP agent integration.

## Workspace layout

- `apps/web` — Next.js frontend
- `apps/server` — Node.js realtime + MCP server
- `packages/shared` — shared types and contracts

## Quick start

```bash
pnpm install
pnpm dev
```

## Scripts

- `pnpm dev` — run web and server in parallel
- `pnpm build` — build all workspaces
- `pnpm typecheck` — type-check all workspaces
- `pnpm test` — run all workspace tests
- `pnpm lint` — run all workspace linters

## Phase 1 status

This scaffold provides the baseline monorepo, CI, shared types, a minimal session-oriented web shell, and a minimal server shell. Realtime sync, Mermaid rendering, MCP tools, and E2E coverage land in later phases.
