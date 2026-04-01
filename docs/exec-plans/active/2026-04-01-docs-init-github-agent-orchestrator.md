# docs-init-github-agent-orchestrator

## Objective

- Replace the starter-skeleton documentation with a coherent docs-first definition of GitHub Agent Orchestrator.
- Record the first product slice, YAML config contract, trigger contract, executor model, and workspace configuration before product code is written.

## Constraints

- Documentation only. Do not implement webhook runtime code in this change.
- Keep the existing harness file layout and root-doc contract intact.
- Preserve the current executable checks and make the docs pass them.

## Steps

1. Rewrite `README.md` and `AGENTS.md` so they describe the GitHub App automation product and current repo state.
2. Realign `ARCHITECTURE.md`, product specs, design docs, and the quality ledger with the new product direction.
3. Run `npm run check` and record the result.

## Verification

- `npm run check`

## Notes

- The config contract is a YAML file with `clientId`, `workspace`, `whitelist`, `executors`, and ordered `workflow` entries.
- Workflow routing is first-match-wins, so command handlers must appear before generic mention handlers.
- Workspace creation is configurable and disabled by default.
