# Shared package context

`src/types.ts` defines browser/server/MCP contract shapes. `src/source-layout.ts`
owns the platform-neutral source-to-durable-layout policy, and
`src/starter-templates.ts` owns the immutable starter registry.

- Keep this package free of Node, browser, persistence, transport, and React
  behavior. A shared change must work in both the browser and server builds.
- Mermaid source stays canonical. Templates resolve to ordinary source before
  the browser or server creation transaction; never persist template identity
  as diagram state.
- Preserve the source-layout policy: accepted blank, flowchart, and generic
  source may prune obsolete positions; indeterminate source must not delete
  settled layout.
- Update `docs/context-map.md` when a public shape or ownership boundary
  changes, and run `pnpm --filter @arielcharts/shared build` plus its focused
  tests before dependent package gates.
