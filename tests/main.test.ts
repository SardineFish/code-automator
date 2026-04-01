import assert from "node:assert/strict";
import test from "node:test";

import { resolveConfigPath } from "../src/app/resolve-config-path.js";

test("resolveConfigPath prefers the --config flag", () => {
  assert.equal(
    resolveConfigPath(["--config", "/tmp/service.yml"], {
      GITHUB_AGENT_ORCHESTRATOR_CONFIG: "/tmp/fallback.yml"
    }),
    "/tmp/service.yml"
  );
});

test("resolveConfigPath falls back to the environment variable", () => {
  assert.equal(
    resolveConfigPath([], { GITHUB_AGENT_ORCHESTRATOR_CONFIG: "/tmp/service.yml" }),
    "/tmp/service.yml"
  );
});

test("resolveConfigPath rejects missing config input", () => {
  assert.throws(() => resolveConfigPath([], {}), {
    message: /Missing config path/
  });
});
