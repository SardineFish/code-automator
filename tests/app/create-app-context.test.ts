import assert from "node:assert/strict";
import test from "node:test";

import { createAppContext, UnknownProviderError } from "../../src/app/create-app-context.js";
import type { AppRuntimeOptions } from "../../src/app/default-app-runtime.js";
import type { HttpProviderKey } from "../../src/types/provider-keys.js";
import type {
  HttpRequestProvider,
  ProviderHandler,
  WorkflowContext,
  WorkflowContextTerminalListeners
} from "../../src/types/runtime.js";
import type { ActiveWorkflowRunRecord, WorkflowRunArtifacts } from "../../src/types/tracking.js";
import {
  createMemoryLogSink,
  createNoOpLogSink,
  type CapturedLogRecord
} from "../fixtures/log-sink.js";
import { createServiceConfig } from "../fixtures/service-config.js";

function createQueuedRunRecord(runId: string, source: string): ActiveWorkflowRunRecord {
  const artifacts: WorkflowRunArtifacts = {
    runDir: `/tmp/${runId}`,
    wrapperScriptPath: `/tmp/${runId}/run.sh`,
    pidFilePath: `/tmp/${runId}/wrapper.pid`,
    resultFilePath: `/tmp/${runId}/result.json`,
    stdoutPath: `/tmp/${runId}/stdout.log`,
    stderrPath: `/tmp/${runId}/stderr.log`
  };

  return {
    runId,
    status: "queued",
    createdAt: "2026-04-02T00:00:00.000Z",
    updatedAt: "2026-04-02T00:00:00.000Z",
    source,
    workflowName: "issue-plan",
    matchedTrigger: "issue:command:plan",
    executorName: "codex",
    workspacePath: "",
    artifacts
  };
}

test("createAppContext creates multiple independent workflows", async () => {
  const queuedSources: string[] = [];
  const managed = createAppContext({
    config: createServiceConfig(),
    runtime: createRuntime(queuedSources),
    providers: new Map()
  });
  const first = managed.appContext.createWorkflow("/one");
  const second = managed.appContext.createWorkflow("/two");

  first.trigger("issue:command:plan", {
    in: { event: "issue:command:plan", issueId: "7" }
  });
  second.trigger("issue:command:plan", {
    in: { event: "issue:command:plan", issueId: "8" }
  });

  const [firstResult, secondResult] = await Promise.all([first.submit(), second.submit()]);

  assert.equal(firstResult.status, "matched");
  assert.equal(secondResult.status, "matched");
  assert.deepEqual(queuedSources, ["/one", "/two"]);
});

test("createAppContext returns registered providers and trusts caller-declared typing", () => {
  const provider: ProviderHandler<[string, number], string> = async (_workflow, key, count) =>
    `${key}:${count}`;
  const managed = createAppContext({
    config: createServiceConfig(),
    runtime: createRuntime(),
    providers: new Map([["chat", provider]])
  });

  assert.equal(managed.appContext.getProvider<typeof provider>("chat"), provider);
  assert.equal(
    managed.appContext.getProvider<(ctx: WorkflowContext) => Promise<number>>("chat"),
    provider
  );
});

test("createAppContext returns typed HTTP providers for slash-prefixed keys", () => {
  const key: HttpProviderKey = "/chat";
  const provider: HttpRequestProvider = async (_workflow, _request, response) => {
    response.end("ok");
  };
  const managed = createAppContext({
    config: createServiceConfig(),
    runtime: createRuntime(),
    providers: new Map([[key, provider]])
  });

  assert.equal(managed.appContext.getProvider(key), provider);
  assert.equal(managed.appContext.getProvider("/chat"), provider);
});

test("createAppContext throws UnknownProviderError for unknown provider keys", () => {
  const managed = createAppContext({
    config: createServiceConfig(),
    runtime: createRuntime(),
    providers: new Map()
  });

  assert.throws(() => managed.appContext.getProvider("missing"), UnknownProviderError);
});

test("createAppContext shutdown awaits handlers, supports unsubscribe, and isolates failures", async () => {
  const records: Array<{ level: string; message?: string; errorMessage?: string }> = [];
  const events: string[] = [];
  const release = createDeferred<void>();
  const managed = createAppContext({
    config: createServiceConfig(),
    runtime: createRuntime([], createMemoryLogSink(records as never[])),
    providers: new Map()
  });

  managed.appContext.on("shutdown", async () => {
    events.push("first");
    await release.promise;
    events.push("first-done");
  });
  const unsubscribe = managed.appContext.on("shutdown", async () => {
    events.push("removed");
  });
  managed.appContext.on("shutdown", async () => {
    events.push("boom");
    throw new Error("shutdown failed");
  });
  managed.appContext.on("shutdown", async () => {
    events.push("last");
  });

  unsubscribe();

  let resolved = false;
  const shutdownPromise = managed.shutdown().then(() => {
    resolved = true;
  });

  await Promise.resolve();
  assert.equal(resolved, false);

  release.resolve();
  await shutdownPromise;
  await managed.shutdown();

  assert.deepEqual(events, ["first", "first-done", "boom", "last"]);
  assert.ok(
    records.some(
      (record) =>
        record.level === "warn" &&
        record.message === "app shutdown handler failed" &&
        record.errorMessage === "shutdown failed"
    )
  );
});

test("createAppContext trackJob preserves resolve and reject behavior", async () => {
  const managed = createAppContext({
    config: createServiceConfig(),
    runtime: createRuntime(),
    providers: new Map()
  });
  const value = managed.appContext.trackJob("sync-resolve", Promise.resolve("ok"));
  const error = managed.appContext.trackJob("sync-reject", Promise.reject(new Error("boom")));

  assert.equal(await value, "ok");
  await assert.rejects(error, /boom/);
  await managed.shutdown();
});

test("createAppContext validates app-managed job names and delays", () => {
  const managed = createAppContext({
    config: createServiceConfig(),
    runtime: createRuntime(),
    providers: new Map()
  });

  assert.throws(
    () => managed.appContext.trackJob("   ", Promise.resolve()),
    /App job debugName must be a non-empty string/
  );
  assert.throws(
    () => managed.appContext.scheduleInterval("job", 0, async () => undefined),
    /Interval milliseconds must be greater than 0/
  );
  assert.throws(
    () => managed.appContext.scheduleInterval("   ", 10, async () => undefined),
    /App job debugName must be a non-empty string/
  );
  assert.throws(
    () => managed.appContext.scheduleDelay("job", 0, async () => undefined),
    /Delay milliseconds must be greater than 0/
  );
  assert.throws(
    () => managed.appContext.scheduleDelay("   ", 10, async () => undefined),
    /App job debugName must be a non-empty string/
  );
});

test("createAppContext shutdown logs waiting tracked jobs, aggregates duplicates, and logs settle markers", async () => {
  const records: CapturedLogRecord[] = [];
  const alphaOne = createDeferred<void>();
  const alphaTwo = createDeferred<void>();
  const beta = createDeferred<void>();
  const managed = createAppContext({
    config: createServiceConfig(),
    runtime: createRuntime([], createMemoryLogSink(records)),
    providers: new Map()
  });

  managed.appContext.trackJob("alpha", alphaOne.promise);
  managed.appContext.trackJob("alpha", alphaTwo.promise);
  managed.appContext.trackJob("beta", beta.promise);

  let shutdownResolved = false;
  const shutdownPromise = managed.shutdown().then(() => {
    shutdownResolved = true;
  });

  await waitForCondition(
    () =>
      records.filter((record) => record.message === "waiting for tracked app job during shutdown")
        .length === 2
  );
  assert.equal(shutdownResolved, false);
  assert.deepEqual(
    records
      .filter((record) => record.message === "waiting for tracked app job during shutdown")
      .map((record) => ({ debugName: record.debugName, count: record.count })),
    [
      { debugName: "alpha", count: 2 },
      { debugName: "beta", count: 1 }
    ]
  );

  alphaOne.resolve();
  await waitForCondition(
    () =>
      records.filter(
        (record) =>
          record.message === "tracked app job settled during shutdown" && record.debugName === "alpha"
      ).length === 1
  );
  assert.equal(shutdownResolved, false);

  beta.resolve();
  await waitForCondition(
    () =>
      records.filter(
        (record) =>
          record.message === "tracked app job settled during shutdown" && record.debugName === "beta"
      ).length === 1
  );
  assert.equal(shutdownResolved, false);

  alphaTwo.resolve();
  await shutdownPromise;
  assert.equal(shutdownResolved, true);
  assert.equal(
    records.filter((record) => record.message === "tracked app job settled during shutdown").length,
    3
  );
});

test("createAppContext scheduleInterval defaults to fixed-period skip mode and stop prevents future ticks", async () => {
  const events: string[] = [];
  const releases: Array<ReturnType<typeof createDeferred<void>>> = [];
  let started = 0;
  const managed = createAppContext({
    config: createServiceConfig(),
    runtime: createRuntime(),
    providers: new Map()
  });
  const stop = managed.appContext.scheduleInterval("skip-job", 25, async () => {
    started += 1;
    const jobId = started;
    const release = createDeferred<void>();
    releases.push(release);
    events.push(`start-${jobId}`);
    await release.promise;
    events.push(`done-${jobId}`);
  });

  await waitForCondition(() => events.includes("start-1"));
  await sleep(35);
  assert.equal(events.filter((event) => event.startsWith("start-")).length, 1);

  releases[0]?.resolve();
  await waitForCondition(() => events.includes("done-1"));
  await waitForCondition(() => events.includes("start-2"));

  stop();
  releases[1]?.resolve();
  await waitForCondition(() => events.includes("done-2"));
  const startedBeforeWait = events.filter((event) => event.startsWith("start-")).length;

  await sleep(60);
  assert.equal(events.filter((event) => event.startsWith("start-")).length, startedBeforeWait);
  await managed.shutdown();
});

test("createAppContext scheduleInterval supports fixed-delay mode with immediate first run", async () => {
  const events: string[] = [];
  const releases: Array<ReturnType<typeof createDeferred<void>>> = [];
  let started = 0;
  const managed = createAppContext({
    config: createServiceConfig(),
    runtime: createRuntime(),
    providers: new Map()
  });
  const stop = managed.appContext.scheduleInterval(
    "delay-job",
    20,
    async () => {
      started += 1;
      const jobId = started;
      const release = createDeferred<void>();
      releases.push(release);
      events.push(`start-${jobId}`);
      await release.promise;
      events.push(`done-${jobId}`);
    },
    { mode: "delay", runImmediately: true }
  );

  await waitForCondition(() => events.includes("start-1"));
  await sleep(30);
  assert.deepEqual(events, ["start-1"]);

  releases[0]?.resolve();
  await waitForCondition(() => events.includes("done-1"));
  await sleep(10);
  assert.deepEqual(events, ["start-1", "done-1"]);
  await waitForCondition(() => events.includes("start-2"));

  stop();
  releases[1]?.resolve();
  await waitForCondition(() => events.includes("done-2"));
  await sleep(35);
  assert.equal(events.filter((event) => event.startsWith("start-")).length, 2);
  await managed.shutdown();
});

test("createAppContext scheduleInterval supports overlapping runs", async () => {
  const releases: Array<ReturnType<typeof createDeferred<void>>> = [];
  let active = 0;
  let maxActive = 0;
  let started = 0;
  const managed = createAppContext({
    config: createServiceConfig(),
    runtime: createRuntime(),
    providers: new Map()
  });
  const stop = managed.appContext.scheduleInterval(
    "overlap-job",
    20,
    async () => {
      started += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      const release = createDeferred<void>();
      releases.push(release);
      await release.promise;
      active -= 1;
    },
    { mode: "overlap" }
  );

  await waitForCondition(() => started >= 2 && maxActive >= 2);
  stop();
  for (const release of releases) {
    release.resolve();
  }

  await managed.shutdown();
  assert.ok(started >= 2);
  assert.ok(maxActive >= 2);
});

test("createAppContext scheduleDelay runs once and can be canceled before firing", async () => {
  let ran = 0;
  const managed = createAppContext({
    config: createServiceConfig(),
    runtime: createRuntime(),
    providers: new Map()
  });
  const stop = managed.appContext.scheduleDelay("later", 20, async () => {
    ran += 1;
  });

  await sleep(10);
  stop();
  await sleep(30);
  assert.equal(ran, 0);

  managed.appContext.scheduleDelay("later", 20, async () => {
    ran += 1;
  });
  await waitForCondition(() => ran === 1);
  await sleep(30);
  assert.equal(ran, 1);
  await managed.shutdown();
});

test("createAppContext scheduleDelay and scheduleInterval pending waits are canceled during shutdown", async () => {
  let runs = 0;
  const managed = createAppContext({
    config: createServiceConfig(),
    runtime: createRuntime(),
    providers: new Map()
  });

  managed.appContext.scheduleDelay("delayed", 40, async () => {
    runs += 1;
  });
  managed.appContext.scheduleInterval("interval", 40, async () => {
    runs += 1;
  });

  await managed.shutdown();
  await sleep(70);
  assert.equal(runs, 0);
});

test("createAppContext logs detached scheduler failures at warn", async () => {
  const records: CapturedLogRecord[] = [];
  const managed = createAppContext({
    config: createServiceConfig(),
    runtime: createRuntime([], createMemoryLogSink(records)),
    providers: new Map()
  });

  managed.appContext.scheduleDelay("failing-job", 20, async () => {
    throw new Error("scheduler failed");
  });

  await waitForCondition(
    () =>
      records.some(
        (record) =>
          record.level === "warn" &&
          record.message === "scheduled app job failed" &&
          record.debugName === "failing-job" &&
          record.errorMessage === "scheduler failed"
      )
  );
  await managed.shutdown();
});

function createRuntime(
  queuedSources: string[] = [],
  logSink = createNoOpLogSink()
): AppRuntimeOptions {
  let runCount = 0;

  return {
    processRunner: {
      async run() {
        throw new Error("should not run");
      },
      async startDetached() {
        return {
          pid: 4242,
          startedAt: "2026-04-02T00:00:00.000Z"
        };
      },
      isProcessRunning() {
        return true;
      },
      async readDetachedResult() {
        return null;
      }
    },
    workspaceRepo: {
      async createRunWorkspace() {
        return "";
      },
      async ensureReusableWorkspace() {
        return "";
      },
      async removeWorkspace() {}
    },
    workflowTracker: {
      async initialize() {},
      async createQueuedRun(context) {
        runCount += 1;
        queuedSources.push(context.source ?? "");
        return {
          record: createQueuedRunRecord(`run-${runCount}`, context.source ?? ""),
          shouldLaunchNow: false
        };
      },
      async getLaunchableQueuedRuns() {
        return [];
      },
      subscribeTerminalEvents(_runId: string, _listeners: WorkflowContextTerminalListeners) {
        return () => undefined;
      },
      async updateQueuedRun() {
        return {} as never;
      },
      async getActiveRunCount() {
        return 0;
      },
      async markRunning() {
        return {} as never;
      },
      async markTerminal() {
        return { completed: null, releasedRuns: [] };
      },
      async reconcileActiveRuns() {
        return [];
      }
    },
    logSink,
    baseEnv: {},
    reconcileIntervalMs: 0
  };
}

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });

  return { promise, resolve, reject };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForCondition(condition: () => boolean, timeoutMs = 500): Promise<void> {
  const deadline = Date.now() + timeoutMs;

  while (!condition()) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out waiting for condition.");
    }
    await sleep(5);
  }
}
