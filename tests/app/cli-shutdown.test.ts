import assert from "node:assert/strict";
import test from "node:test";

import {
  createCliShutdownCoordinator,
  FORCED_SIGINT_EXIT_CODE,
  SIGINT_DRAIN_MESSAGE
} from "../../src/app/cli-shutdown.js";

test("createCliShutdownCoordinator drains active work in order on first SIGINT", async () => {
  const events: string[] = [];
  const messages: string[] = [];
  const exitCodes: number[] = [];
  const activeCounts = [2, 1, 0];
  const coordinator = createCliShutdownCoordinator({
    app: {
      server: {} as never,
      async shutdown() {
        events.push("shutdown-app");
      }
    },
    workflowTracker: {
      async getActiveRunCount() {
        const count = activeCounts.shift() ?? 0;
        events.push(`count:${count}`);
        return count;
      }
    },
    redeliveryWorker: {
      async stop() {
        events.push("stop-redelivery");
      }
    },
    sleep: async () => {
      events.push("sleep");
    },
    writeLine(line) {
      messages.push(line);
    },
    exit(code) {
      exitCodes.push(code);
    }
  });

  coordinator.handleSigint();
  await coordinator.waitForShutdown();

  assert.equal(coordinator.getState(), "draining");
  assert.deepEqual(messages, [SIGINT_DRAIN_MESSAGE]);
  assert.deepEqual(events, [
    "stop-redelivery",
    "shutdown-app",
    "count:2",
    "sleep",
    "count:1",
    "sleep",
    "count:0"
  ]);
  assert.deepEqual(exitCodes, [0]);
});

test("createCliShutdownCoordinator forces immediate exit on second SIGINT", async () => {
  const events: string[] = [];
  const exitCodes: number[] = [];
  const release = createDeferred<void>();
  const coordinator = createCliShutdownCoordinator({
    app: {
      server: {} as never,
      async shutdown() {
        events.push("shutdown-app");
        await release.promise;
      }
    },
    workflowTracker: {
      async getActiveRunCount() {
        events.push("count:0");
        return 0;
      }
    },
    redeliveryWorker: {
      async stop() {
        events.push("stop-redelivery");
      }
    },
    writeLine() {},
    exit(code) {
      exitCodes.push(code);
    }
  });

  coordinator.handleSigint();
  assert.equal(coordinator.getState(), "draining");

  coordinator.handleSigint();
  assert.equal(coordinator.getState(), "forced");
  assert.deepEqual(exitCodes, [FORCED_SIGINT_EXIT_CODE]);

  release.resolve();
  await coordinator.waitForShutdown();

  assert.deepEqual(events, ["stop-redelivery", "shutdown-app", "count:0"]);
  assert.deepEqual(exitCodes, [FORCED_SIGINT_EXIT_CODE]);
});

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}
