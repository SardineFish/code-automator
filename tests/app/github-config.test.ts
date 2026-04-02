import assert from "node:assert/strict";
import test from "node:test";

import { resolveGitHubProviderConfig } from "../../src/app/providers/github-config.js";
import { ConfigError } from "../../src/config/config-error.js";
import { createServiceConfig } from "../fixtures/service-config.js";

test("resolveGitHubProviderConfig defaults redelivery to false", () => {
  const github = resolveGitHubProviderConfig(createServiceConfig().gh);

  assert.equal(github.redelivery, false);
});

test("resolveGitHubProviderConfig accepts a redelivery poller config", () => {
  const github = resolveGitHubProviderConfig({
    ...createServiceConfig().gh,
    redelivery: {
      intervalSeconds: 300,
      maxPerRun: 10
    }
  });

  assert.deepEqual(github.redelivery, {
    intervalSeconds: 300,
    maxPerRun: 10
  });
});

test("resolveGitHubProviderConfig rejects invalid redelivery values", () => {
  assert.throws(
    () =>
      resolveGitHubProviderConfig({
        ...createServiceConfig().gh,
        redelivery: {
          intervalSeconds: 0,
          maxPerRun: 10
        }
      }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /gh\.redelivery\.intervalSeconds: Expected an integer greater than 0\./);
      return true;
    }
  );
});
