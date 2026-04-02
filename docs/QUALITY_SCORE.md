# Quality Score

This file tracks the repo as it moves from the starter scaffold toward GitHub Agent Orchestrator.

| Area | Current State | Evidence |
| --- | --- | --- |
| Docs map | Green | `README.md`, product specs, and design docs now describe the provider-extensible ingress runtime and the shipped GitHub provider |
| Architecture guidance | Green | `ARCHITECTURE.md` |
| Verification loop | Green | `npm run check`, fixture-driven workflow tests, and `.github/workflows/check.yml` |
| Foundation contracts | Green | `src/types/`, `src/config/`, `src/service/`, and `src/app/` implement shared app config, provider trigger submission, and template rendering with tests |
| Product runtime | Green | `src/app/`, `src/runtime/`, `src/service/`, `src/repo/`, and `src/providers/` implement the provider app runtime, GitHub provider wiring, detached execution, persistent tracking, and executor auth |
| Generated knowledge | Yellow | No generated docs or code indexes yet |

## Next Up

- Add more registered providers on top of the shared app/context contract when product scope expands.
- Add provider-level checks once additional providers or startup registration paths land.
- Add stronger operational tooling around persistent run inspection or query APIs if operators need more than file-based status.
- Add generated indexes only if they materially improve repo navigation.
