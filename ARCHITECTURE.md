# Architecture

This repository is being shaped into a TypeScript GitHub App webhook automation service. The structure stays strict so agents can navigate it mechanically as product code is added.

## Layer Order

Product code should move from more stable to less stable layers:

1. `types`
2. `config`
3. `repo`
4. `service`
5. `runtime`
6. `ui`

Use layer-first paths such as `src/types/`, `src/config/`, `src/repo/`, `src/service/`, `src/runtime/`, and `src/ui/`.

`src/app/` wires layers together.

`src/providers/` holds cross-cutting adapters such as clocks, GitHub API clients, process runners, filesystem helpers, signature verifiers, YAML loaders, or logging sinks. Product code may only import providers from the `service` layer.

## Rules

- Files under `src/<layer>/` may only import files from the same layer or an earlier layer in the order above.
- A layer may depend on itself and any earlier layer in the order above.
- `src/app/` may import any layer or provider.
- Files in `src/` should stay below 150 lines. If they get bigger, split them before the structure becomes ambiguous.

These rules describe the intended structure for product code.

## Extension Guidance

- Add new product code under the layer that matches its responsibility.
- Group related code inside a layer when that improves navigation, for example `src/service/workflow/` or `src/runtime/webhooks/`.
- Add stable documentation before large features so agents can work from repo-local context.
- Favor narrow service functions and explicit wiring in `src/app/` over hidden global state.
- Keep executor invocation behind explicit service and provider boundaries.
- Keep workspace lifecycle policy in config, repo, and service layers rather than hard-coding it in `src/app/`.
- Normalize raw GitHub webhooks into canonical trigger keys such as `issue:open`, `issue:command:plan`, `issue:comment`, `pr:comment`, and `pr:review` before workflow selection.
- Keep workflow selection deterministic by evaluating configured workflows in declaration order and stopping at the first match.
