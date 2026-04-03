import assert from "node:assert/strict";
import test from "node:test";

import { resolveGitHubProviderConfig } from "../../src/app/providers/github-config.js";
import { ConfigError } from "../../src/config/config-error.js";
import { createServiceConfig } from "../fixtures/service-config.js";

test("resolveGitHubProviderConfig defaults redelivery to false", () => {
  const github = resolveGitHubProviderConfig(createServiceConfig().gh);

  assert.equal(github.requireMention, true);
  assert.equal(github.ignoreApprovalReview, true);
  assert.equal(github.redelivery, false);
});

test("resolveGitHubProviderConfig accepts requireMention false", () => {
  const github = resolveGitHubProviderConfig({
    ...createServiceConfig().gh,
    requireMention: false
  });

  assert.equal(github.requireMention, false);
});

test("resolveGitHubProviderConfig accepts ignoreApprovalReview true and false", () => {
  const config = createServiceConfig().gh;

  const ignoresApprovedReviews = resolveGitHubProviderConfig({
    ...config,
    ignoreApprovalReview: true
  });
  const routesApprovedReviews = resolveGitHubProviderConfig({
    ...config,
    ignoreApprovalReview: false
  });

  assert.equal(ignoresApprovedReviews.ignoreApprovalReview, true);
  assert.equal(routesApprovedReviews.ignoreApprovalReview, false);
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

test("resolveGitHubProviderConfig rejects invalid requireMention values", () => {
  assert.throws(
    () =>
      resolveGitHubProviderConfig({
        ...createServiceConfig().gh,
        requireMention: "false"
      }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /gh\.requireMention: Expected a boolean\./);
      return true;
    }
  );
});

test("resolveGitHubProviderConfig rejects invalid ignoreApprovalReview values", () => {
  assert.throws(
    () =>
      resolveGitHubProviderConfig({
        ...createServiceConfig().gh,
        ignoreApprovalReview: "false"
      }),
    (error) => {
      assert.ok(error instanceof ConfigError);
      assert.match(error.message, /gh\.ignoreApprovalReview: Expected a boolean\./);
      return true;
    }
  );
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
