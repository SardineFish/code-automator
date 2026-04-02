# Architecture

This repository is being shaped into a TypeScript workflow automation service with a provider-extensible ingress runtime. The structure stays strict so agents can navigate it mechanically as product code is added.

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
- Keep provider-specific request parsing and normalization at the ingress edge. Providers should submit canonical trigger keys such as `issue:open`, `issue:command:plan`, `issue:comment`, `pr:comment`, and `pr:review` into the shared workflow engine before workflow selection.
- Keep workflow selection deterministic by evaluating configured workflows in declaration order and stopping at the first match.

## Provider Boundary Rules

- Treat providers as extensions. The core engine should not need to know provider-specific request shapes, auth flows, API clients, or input aliases.
- Keep provider-specific parsing, normalization, API calls, signature checks, and provider env handling inside provider-owned code.
- Do not move provider-specific logic into `src/service/`, `src/types/`, `src/config/`, `src/repo/`, or `src/runtime/` just to make it feel more reusable.
- If a helper mentions a provider by name, it belongs in provider scope unless at least two providers already use the exact same contract.
- Prefer deleting provider-only abstraction layers over renaming or relocating them. A direct handler is better than a factory, builder, or intermediate delivery object unless shared pressure is already real.
- When a provider needs extra workflow input fields, add only the fields required now. Do not pre-build a generic shape for imagined future providers.
- Keep the extension seam small and explicit: registration, route path, trigger submission, and shared execution/tracking are core concerns; everything else should stay on the provider side of the boundary.
