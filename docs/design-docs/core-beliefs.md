# Core Beliefs

- Keep critical knowledge inside the repository so an agent does not depend on fragile chat history.
- Prefer obvious directory structure and naming over clever abstractions.
- Default to planning before execution. The first agent pass should explain the work and reply on GitHub before writing code.
- Keep trigger policy explicit and deny by default. Only whitelisted users and defined commands or mentions should start workflows.
- Keep workflow routing deterministic. Normalize events first, then run only the first matching workflow in config order.
- Keep agent execution runtime-agnostic through configurable command templates instead of embedding one provider or container model into the core design.
- Keep workspace creation optional so operators can rely on external isolation strategies when needed.
- Turn important workflow rules into code, scripts, or CI checks instead of relying on memory.
- Optimize for short feedback loops: a one-command check is more useful than a long checklist.
- Keep plans, specs, and quality notes small, current, and easy to find from `AGENTS.md`.
