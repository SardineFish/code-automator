# Quality Score

This file tracks the repo as it moves from the starter scaffold toward GitHub Agent Orchestrator.

| Area | Current State | Evidence |
| --- | --- | --- |
| Docs map | Green | `README.md`, `AGENTS.md`, product specs, and design docs now describe the same YAML-driven workflow model |
| Architecture guidance | Green | `ARCHITECTURE.md` |
| Verification loop | Green | `npm run check`, fixture-driven workflow tests, and `.github/workflows/check.yml` |
| Foundation contracts | Green | `src/types/`, `src/config/`, and `src/service/template/` implement the YAML, tracking, and template contract with tests |
| Product runtime | Green | `src/app/`, `src/runtime/`, `src/service/`, `src/repo/`, and `src/providers/` implement webhook intake, workflow routing, detached execution, persistent tracking, and executor auth |
| Generated knowledge | Yellow | No generated docs or code indexes yet |

## Next Up

- Expand supported GitHub events beyond the starter workflow set as product scope grows.
- Add stronger operational tooling around persistent run inspection or query APIs if operators need more than file-based status.
- Add generated indexes only if they materially improve repo navigation.
