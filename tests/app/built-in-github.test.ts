import assert from "node:assert/strict";
import test from "node:test";

import {
  requireBuiltInGitHubEnv,
  resolveBuiltInGitHubRuntimeConfig
} from "../../src/app/built-in-github.js";
import { createServiceConfig } from "../fixtures/service-config.js";

test("resolveBuiltInGitHubRuntimeConfig keeps config unchanged when gh is absent", () => {
  const config = createServiceConfig();
  delete config.gh;

  const resolved = resolveBuiltInGitHubRuntimeConfig(config);

  assert.equal(resolved.runtimeConfig, config);
  assert.equal(resolved.github, undefined);
});

test("requireBuiltInGitHubEnv skips validation when gh is absent", () => {
  assert.doesNotThrow(() => requireBuiltInGitHubEnv(undefined, {}));
});

test("requireBuiltInGitHubEnv requires GitHub runtime secrets when gh is enabled", () => {
  const { github } = resolveBuiltInGitHubRuntimeConfig(createServiceConfig());

  assert.ok(github);
  assert.throws(() => requireBuiltInGitHubEnv(github, {}), {
    message: /Missing GITHUB_WEBHOOK_SECRET in runtime environment\./
  });
});

test("requireBuiltInGitHubEnv accepts configured GitHub runtime secrets", () => {
  const { github } = resolveBuiltInGitHubRuntimeConfig(createServiceConfig());

  assert.ok(github);
  assert.doesNotThrow(() =>
    requireBuiltInGitHubEnv(github, {
      GITHUB_WEBHOOK_SECRET: "secret-value",
      GITHUB_APP_PRIVATE_KEY_PATH: "/tmp/app.pem"
    })
  );
});
