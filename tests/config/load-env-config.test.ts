import assert from "node:assert/strict";
import test from "node:test";

import { ConfigError } from "../../src/config/config-error.js";
import { loadEnvironmentConfig } from "../../src/config/load-env-config.js";

test("loadEnvironmentConfig returns webhook secret", () => {
  const config = loadEnvironmentConfig({
    GITHUB_WEBHOOK_SECRET: "secret-value",
    GITHUB_APP_PRIVATE_KEY_PATH: "/tmp/app.pem"
  });
  assert.equal(config.webhookSecret, "secret-value");
  assert.equal(config.appPrivateKeyPath, "/tmp/app.pem");
});

test("loadEnvironmentConfig rejects missing secret", () => {
  assert.throws(() => loadEnvironmentConfig({ GITHUB_APP_PRIVATE_KEY_PATH: "/tmp/app.pem" }), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(error.message, /env\.GITHUB_WEBHOOK_SECRET: Missing required webhook secret\./);
    return true;
  });
});

test("loadEnvironmentConfig rejects missing private key path", () => {
  assert.throws(() => loadEnvironmentConfig({ GITHUB_WEBHOOK_SECRET: "secret-value" }), (error) => {
    assert.ok(error instanceof ConfigError);
    assert.match(
      error.message,
      /env\.GITHUB_APP_PRIVATE_KEY_PATH: Missing required GitHub App private key path\./
    );
    return true;
  });
});
