# Plans

Execution plans are lightweight, local artifacts for any change large enough to require more than one edit.

## Workflow

1. Run `npm run plan:new -- <slug>`.
2. Fill in the objective, constraints, steps, and verification notes.
3. Keep the plan in `docs/exec-plans/active/` while the work is in progress.
4. Move it to `docs/exec-plans/completed/` when the change is shipped.
5. If anything is deferred, capture it in `docs/exec-plans/tech-debt-tracker.md`.

## Why This Exists

The plan file is repo-local state that agents can rely on. It reduces hidden context and gives future sessions a durable narrative of what changed and why.

