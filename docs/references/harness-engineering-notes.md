# Harness Engineering Notes

Source article: https://openai.com/index/harness-engineering/

This repository keeps the harness-engineering structure described in the article while it evolves into GitHub Agent Orchestrator.

1. Treat the repository as the durable system of record for an agent.
2. Use a clear root table of contents so an agent knows where stable knowledge lives.
3. Express workflow and architecture rules as executable checks whenever possible.
4. Keep the codebase legible enough that agents can make safe local changes without rebuilding context from scratch.

This repository maps those ideas to concrete files:

- `AGENTS.md` is the root navigation surface.
- `docs/` stores stable specs, design notes, plans, and quality tracking.
- `scripts/` contains mechanical checks and a plan generator.
- `src/` is reserved for the product runtime as implementation begins.
