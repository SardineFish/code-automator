import assert from "node:assert/strict";
import test from "node:test";

import { ConfigError } from "../../src/config/config-error.js";
import { loadEnvironmentConfig } from "../../src/config/load-env-config.js";

test("loadEnvironmentConfig returns webhook secret", () => {
  const config = loadEnvironmentConfig({ GITHUB_WEBHOOK_SECRET: "secret-value" });
  assert.equal(config.webhookSecret, "secret-value");
});

test("loadEnvironmentConfig rejects missing secret", () => {
  assert.throws(() => loadEnvironmentConfig({}), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /env\.GITHUB_WEBHOOK_SECRET: Missing required webhook secret\./);
    return true;
  });
});
