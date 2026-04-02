# Quality Score

This file tracks the repo as it moves from the starter scaffold toward GitHub Agent Orchestrator.

| Area | Current State | Evidence |
| --- | --- | --- |
| Docs map | Yellow | Public docs now describe the staged provider-extensible ingress target and mark the runtime refactor as pending through Plans 12-14 in `docs/PLAN.md` |
| Architecture guidance | Green | `ARCHITECTURE.md` |
| Verification loop | Green | `npm run check`, fixture-driven workflow tests, and `.github/workflows/check.yml` |
| Foundation contracts | Green | `src/types/`, `src/config/`, and `src/service/template/` implement the current GitHub-only YAML, tracking, and template contract with tests |
| Product runtime | Yellow | `src/app/`, `src/runtime/`, `src/service/`, `src/repo/`, and `src/providers/` implement the current GitHub-only runtime while the provider-extensible ingress refactor is queued in Plans 12-14 |
| Generated knowledge | Yellow | No generated docs or code indexes yet |

## Next Up

- Land the provider-extensible ingress refactor and migrate the current GitHub behavior behind a registered provider.
- Add provider-level checks once the new routing and submission contract is in place.
- Add stronger operational tooling around persistent run inspection or query APIs if operators need more than file-based status.
- Add generated indexes only if they materially improve repo navigation.
