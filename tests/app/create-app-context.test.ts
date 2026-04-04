import assert from "node:assert/strict";
import test from "node:test";

import { createAppContext, UnknownProviderError } from "../../src/app/create-app-context.js";
import type { AppRuntimeOptions } from "../../src/app/default-app-runtime.js";
import type {
  ProviderHandler,
  WorkflowContext,
  WorkflowContextTerminalListeners
} from "../../src/types/runtime.js";
import type { ActiveWorkflowRunRecord, WorkflowRunArtifacts } from "../../src/types/tracking.js";
import { createMemoryLogSink, createNoOpLogSink } from "../fixtures/log-sink.js";
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
