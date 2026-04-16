# Planner follow-up after committed review

Review outcome: do not start full Phase 4 execution yet.

## Blocker
1. Implement CORS response headers and OPTIONS/preflight behavior for `/mcp` so browser-origin calls from deployed web to server are supportable.

## Should-fix before Phase 4
2. Update `apps/server/.env.example` to match actual runtime env contract from `apps/server/src/lib/env.ts`.
3. Refresh `README.md` so it no longer describes a Phase 1 scaffold.
4. Add stable `data-testid` hooks to the frontend session and landing flows so Playwright can be written reliably.
5. Refresh `reports/phase4-verification-plan.md` to reflect the current frontend state instead of the earlier scaffold snapshot.

## Execution decision
- Short hardening pass first.
- Then re-run tests/typecheck/build.
- Then request a final reviewer pass and move into Phase 4 execution if clean.
