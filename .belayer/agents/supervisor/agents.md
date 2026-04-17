# Supervisor Operating Notes — ArielCharts

## Communication

```bash
belayer message send --to <agent> "instructions"
belayer message broadcast "update for everyone"
belayer note "observation for reflection"
belayer recall "search query"
```

## Spawning teammates

```bash
# Implementer with worktree isolation (required for parallel code work)
belayer_spawn_agent name=web-dev profile=web-dev branch=feat/share-modal \
  message="Implement the share modal per spec section 4.2."

belayer_spawn_agent name=backend-dev profile=backend-dev branch=feat/mcp-list-sessions-pagination \
  message="Add pagination to the list_sessions MCP tool per spec section 6.1."

# Adversarial review (no worktree needed)
belayer_spawn_agent name=reviewer-1 profile=reviewer \
  message="Review the diff on feat/share-modal against the six dimensions and five attack vectors. Report PASS or FAIL."

# QA pass (no worktree; reads only)
belayer_spawn_agent name=qa profile=qa \
  message="Verify the share modal end to end. Cover the happy path and the keyboard escape, click-outside, and concurrent-paste edge cases."
```

## Quick research via delegate_task

When you just need an answer, not a peer:

```python
delegate_task(
  goal="Find every file that imports from @arielcharts/shared and list the symbols each one uses.",
  context="Monorepo lives at /workspace. apps/web and apps/server both import from @arielcharts/shared. Use ripgrep."
)
```

## Multi-package coordination

When a change spans `apps/web` + `apps/server` + `packages/shared`:

1. Decompose into per-package tasks plus the shared contract change.
2. Message `web-dev` and `backend-dev` with their slice AND the contract they must honor.
3. Build `packages/shared` first whenever its source changes — consumers won't typecheck until it's built.
4. When both implementers signal completion, run `qa` against the integrated app (`pnpm dev`, then exercise via browser + MCP curl).
5. If integration fails, identify which package owns the bug and route back.

## Review workflow

When an implementer signals completion:

1. Ask the implementer to summarize their changes (diff + rationale).
2. Spawn `reviewer` with the diff path or branch reference.
3. Reviewer returns structured findings (severity, file:line, summary, fix).
4. On FAIL: relay the findings back to the implementer with prioritization guidance.
5. On PASS: hand to `qa` for behavioral verification, or proceed to `belayer_request_completion`.

## Validation gate before completion

Before calling `belayer_request_completion`, run the full validation chain (mirrors CI):

```bash
pnpm --filter @arielcharts/shared build
pnpm typecheck
pnpm test
pnpm build
```

If anything fails, fix it. PM will reject if these aren't green.

## Deploy notes

The server deploys to Fly.io (`arielcharts-server`, region `sjc`). The web app does not deploy from this repo — only the server does. Dockerfile is at `apps/server/Dockerfile`. Persistent state lives in the `arielcharts_data` volume mounted at `/data`.

Don't trigger deploys from inside a session unless the operator asked for one.
