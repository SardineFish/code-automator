import assert from "node:assert/strict";
import test from "node:test";

import { createGitHubRedeliveryService } from "../../src/app/providers/github-redelivery-service.js";
import type { AppContext } from "../../src/types/runtime.js";
import { createServiceConfig } from "../fixtures/service-config.js";
import { createNoOpLogSink } from "../fixtures/log-sink.js";

test("createGitHubRedeliveryService starts the worker and stops it through app shutdown", async () => {
  const events: string[] = [];
  let shutdownHandler: (() => Promise<void>) | undefined;
  const config = createServiceConfig();
  if (!config.gh) {
    throw new Error("Missing test GitHub config.");
  }

  config.gh.redelivery = {
    intervalSeconds: 30,
    maxPerRun: 5
  };

  const service = createGitHubRedeliveryService({
    createWorker() {
      return {
        start() {
          events.push("start");
        },
        async runOnce() {},
        async stop() {
          events.push("stop");
        }
      };
    }
  });

  await service(createAppContext(config, (handler) => {
    shutdownHandler = handler;
    return () => undefined;
  }));

  assert.deepEqual(events, ["start"]);
  assert.ok(shutdownHandler);

  await shutdownHandler?.();

  assert.deepEqual(events, ["start", "stop"]);
});

function createAppContext(
  config = createServiceConfig(),
  onShutdown: (handler: () => Promise<void>) => () => void
): AppContext {
  return {
    config,
    env: {
      GITHUB_APP_PRIVATE_KEY_PATH: "/tmp/app.pem"
    },
    log: createNoOpLogSink(),
    createWorkflow() {
      throw new Error("should not create workflows");
    },
    getProvider() {
      throw new Error("should not read providers");
    },
    on(eventName, handler) {
      assert.equal(eventName, "shutdown");
      return onShutdown(handler);
    }
  };
}
