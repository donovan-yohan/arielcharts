# ArielCharts

ArielCharts is a pnpm monorepo for collaborative Mermaid workspaces: a Next.js
browser client, a Node/Yjs/MCP server, and shared TypeScript contracts.

## Start here

- `docs/context-map.md` — state ownership, request/data flows, scaling seams,
  and the evidence map. Update it when a durable schema, public contract, or
  cross-package ownership boundary changes.
- `ARCHITECTURE.md` — implemented stack and system flows; use the context map
  for the finer-grained ownership and evidence detail.
- `apps/web/AGENTS.md` — browser rendering, editor, canvas, and local-state
  boundaries.
- `apps/server/AGENTS.md` — durable Yjs, MCP, persistence, and concurrency
  boundaries.
- `packages/shared/src/types.ts` — public shared shapes; keep it free of
  server or browser behavior.
- `packages/shared/AGENTS.md` — shared contracts, source/layout policy, and
  starter-template boundaries.

## Cross-package rules

- A session's named diagram catalog, Mermaid source, node positions, and
  activity live in the Yjs document. Browser selection, camera, toolbar,
  flyout, and draft interaction state stay local.
- MCP is a second writer to that same application document, not the owner of
  an MCP transport session. Mutating tools must use current server-derived
  revisions; a stale write must re-read and merge before retrying.
- Keep flowchart structure editing separate from generic Mermaid rendering.
  Any new diagram type must remain source-editable even when it has no canvas
  mutation controls.
- Prefer a focused refactor at an ownership boundary over another conditional
  in a cross-cutting component. Do not add documentation or comments that
  merely narrate implementation details.

## Commands and release gates

Run from the repository root. The commands below are the package scripts; use
`npx --yes pnpm@10.15.0` in environments without a `pnpm` executable.

```bash
pnpm --filter @arielcharts/shared build
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Choose the focused browser gate for the changed behavior:

- `pnpm test:e2e-workspace-ux` — production-mode browser gate for responsive
  layout, theme, flyouts, visible controls, Fit, and stable anchors/camera.
- `pnpm test:e2e-subgraphs` — nested-flowchart section editing.
- `pnpm test:e2e-sequence` — Mermaid kind/canvas behavior; inspect
  `/tmp/arielcharts-sequence.png` and
  `/tmp/arielcharts-sequence-isolation.png`.
- `pnpm test:e2e-collaboration` — protected-room access, browser/MCP
  concurrency, awareness, and persistence.

`npx tsx e2e-validate.ts` is a legacy manual harness: it requires separately
running services and is not the CI browser gate. CI has three verification jobs
in `.github/workflows/ci.yml`: `verify` (shared build, lint, typecheck, test,
and build), `workspace-ux` (workspace UX and subgraphs), and
`protected-collaboration`. The separate `deploy-server` job runs only for
pushes to `main` after all three verification jobs pass.

Before a behavior, protocol, persistence, or collaboration PR is merged:

1. Update the context map only if the ownership or contract actually changed.
2. Run one adversarial review, batch valid findings, then re-review only the
   changed hunks and their immediate contracts.
3. Record exact-head command evidence in the PR; green evidence for an older
   head is not a merge verdict.
