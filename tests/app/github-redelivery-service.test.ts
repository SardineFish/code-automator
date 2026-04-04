import assert from "node:assert/strict";
import test from "node:test";

import { startGitHubRedeliveryService } from "../../src/app/providers/github-redelivery-service.js";
import type { AppContext } from "../../src/types/runtime.js";
import { createServiceConfig } from "../fixtures/service-config.js";
import { createNoOpLogSink } from "../fixtures/log-sink.js";

test("startGitHubRedeliveryService registers the built-in interval scheduler", async () => {
  let runCount = 0;
  let scheduled:
    | {
        debugName: string;
        intervalMs: number;
        createJob: () => Promise<unknown>;
        options: { mode?: "skip" | "delay" | "overlap"; runImmediately?: boolean } | undefined;
      }
    | undefined;
  const config = createServiceConfig();
  if (!config.gh) {
    throw new Error("Missing test GitHub config.");
  }

  config.gh.redelivery = {
    intervalSeconds: 30,
    maxPerRun: 5
  };

  await startGitHubRedeliveryService(
    createAppContext(config, (debugName, intervalMs, createJob, options) => {
      scheduled = { debugName, intervalMs, createJob, options };
      return () => undefined;
    }),
    () => {
      return {
        async runOnce() {
          runCount += 1;
        }
      };
    }
  );

  assert.ok(scheduled);
  assert.deepEqual(scheduled.debugName, "github-redelivery");
  assert.deepEqual(scheduled.intervalMs, 30_000);
  assert.deepEqual(scheduled.options, { mode: "skip" });
  await scheduled.createJob();
  assert.equal(runCount, 1);
});

function createAppContext(
  config = createServiceConfig(),
  scheduleInterval: AppContext["scheduleInterval"]
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
    trackJob(_debugName, job) {
      return job;
    },
    scheduleInterval,
    scheduleDelay() {
      return () => undefined;
    },
    on(eventName, handler) {
      assert.equal(eventName, "shutdown");
      void handler;
      return () => undefined;
    }
  };
}
