# Core Beliefs

- Keep critical knowledge inside the repository so an agent does not depend on fragile chat history.
- Prefer obvious directory structure and naming over clever abstractions.
- Default to planning before execution. The first agent pass should explain the work and reply on GitHub before writing code.
- Keep trigger policy explicit and deny by default. Provider handlers should validate and gate requests before they submit triggers into the shared workflow engine.
- Keep workflow routing deterministic. Providers may emit multiple candidate triggers, but the core runtime should still run only the first matching workflow in config order.
- Keep ingress extensible. The core app should own routing, workflow submission, execution, and tracking, while providers own request parsing, trigger naming, and provider-specific config.
- Keep providers extension-like, not half-inside the core. If code is GitHub-specific, it should stay in provider scope instead of leaking into shared engine layers.
- Prefer the smallest provider contract that works today. Add fields and abstractions only when current behavior needs them, not for hypothetical future reuse.
- Delete accidental abstraction before adding new abstraction. When simplification and generalization conflict, choose simplification.
- Keep agent execution runtime-agnostic through configurable command templates instead of embedding one provider or container model into the core design.
- Keep workspace creation optional so operators can rely on external isolation strategies when needed.
- Turn important workflow rules into code, scripts, or CI checks instead of relying on memory.
- Optimize for short feedback loops: a one-command check is more useful than a long checklist.
- Keep specs, and quality notes small, current, and easy to find from `AGENTS.md`.
