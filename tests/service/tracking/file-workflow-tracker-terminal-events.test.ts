import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { fileWorkflowTrackerRepo } from "../../../src/repo/tracking/file-workflow-tracker-repo.js";
import { createFileWorkflowTracker } from "../../../src/service/tracking/file-workflow-tracker.js";
import type { ProcessRunResult } from "../../../src/types/execution.js";
import type { WorkflowTracker } from "../../../src/service/tracking/workflow-tracker.js";
import type { WorkflowCompletedEventPayload } from "../../../src/types/runtime.js";
import { createMemoryLogSink, createNoOpLogSink, type CapturedLogRecord } from "../../fixtures/log-sink.js";

test("fileWorkflowTracker emits one completed event for terminal success", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-terminal-completed-"));
  const tracker = createTracker(dir);
  const queued = await createQueuedRun(tracker);
  const events: WorkflowCompletedEventPayload[] = [];

  tracker.subscribeTerminalEvents(queued.runId, {
    completed: [
      (event) => {
        events.push(event);
      }
    ],
    error: []
  });

  const completedAt = "2026-04-02T00:00:10.000Z";
  const firstResult = await tracker.markTerminal(queued.runId, "succeeded", {
    completedAt,
    process: createProcessResult(queued, completedAt, 0)
  });
  const secondResult = await tracker.markTerminal(queued.runId, "succeeded", {
    completedAt
  });

  assert.equal(firstResult.completed?.status, "succeeded");
  assert.equal(secondResult.completed, null);
  assert.deepEqual(events, [
    {
      runId: queued.runId,
      workflowName: "issue-plan",
      matchedTrigger: "issue:open",
      executorName: "codex",
      completedAt,
      status: "succeeded"
    }
  ]);
});

test("fileWorkflowTracker emits error events for failed, error, and lost terminal statuses", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-terminal-error-"));
  const tracker = createTracker(dir);
  const events: Array<{ runId: string; status: string; message: string; completedAt: string }> = [];
  const scenarios = [
    {
      status: "failed" as const,
      completedAt: "2026-04-02T00:00:10.000Z",
      details: {
        completedAt: "2026-04-02T00:00:10.000Z",
        process: {
          pid: 4100,
          exitCode: 17,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          completedAt: "2026-04-02T00:00:10.000Z"
        }
      },
      expectedMessage: "Workflow exited with code 17."
    },
    {
      status: "error" as const,
      completedAt: "2026-04-02T00:00:11.000Z",
      details: {
        completedAt: "2026-04-02T00:00:11.000Z",
        errorMessage: "Launch exploded"
      },
      expectedMessage: "Launch exploded"
    },
    {
      status: "lost" as const,
      completedAt: "2026-04-02T00:00:12.000Z",
      details: {
        completedAt: "2026-04-02T00:00:12.000Z"
      },
      expectedMessage: "Workflow completed with terminal status 'lost'."
    }
  ];

  for (const scenario of scenarios) {
    const queued = await createQueuedRun(tracker);
    tracker.subscribeTerminalEvents(queued.runId, {
      completed: [],
      error: [
        (event) => {
          events.push({
            runId: event.runId,
            status: event.status,
            message: event.error.message,
            completedAt: event.completedAt
          });
        }
      ]
    });

    await tracker.markTerminal(queued.runId, scenario.status, scenario.details);
  }

  assert.deepEqual(
    events.map((event) => ({
      status: event.status,
      message: event.message,
      completedAt: event.completedAt
    })),
    scenarios.map((scenario) => ({
      status: scenario.status,
      message: scenario.expectedMessage,
      completedAt: scenario.completedAt
    }))
  );
});

test("fileWorkflowTracker unsubscribe prevents terminal listeners from firing", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-terminal-unsubscribe-"));
  const tracker = createTracker(dir);
  const queued = await createQueuedRun(tracker);
  let eventCount = 0;

  const unsubscribe = tracker.subscribeTerminalEvents(queued.runId, {
    completed: [
      () => {
        eventCount += 1;
      }
    ],
    error: []
  });

  unsubscribe();
  await tracker.markTerminal(queued.runId, "succeeded", {
    completedAt: "2026-04-02T00:00:10.000Z",
    process: createProcessResult(queued, "2026-04-02T00:00:10.000Z", 0)
  });

  assert.equal(eventCount, 0);
});

test("fileWorkflowTracker listener failures do not break terminal persistence", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-terminal-listener-failure-"));
  const logRecords: CapturedLogRecord[] = [];
  const tracker = createTracker(dir, logRecords);
  const queued = await createQueuedRun(tracker);

  tracker.subscribeTerminalEvents(queued.runId, {
    completed: [
      () => {
        throw new Error("listener sync failed");
      },
      async () => {
        throw new Error("listener async failed");
      }
    ],
    error: []
  });

  const completedAt = "2026-04-02T00:00:10.000Z";
  const result = await tracker.markTerminal(queued.runId, "succeeded", {
    completedAt,
    process: createProcessResult(queued, completedAt, 0)
  });

  assert.equal(result.completed?.status, "succeeded");
  assert.equal(await tracker.getActiveRunCount(), 0);

  const logLines = (await readFile(path.join(dir, "runs.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { runId: string; status: string });

  assert.deepEqual(
    logLines.map((line) => ({ runId: line.runId, status: line.status })),
    [{ runId: queued.runId, status: "succeeded" }]
  );

  await waitForCondition(() => {
    return (
      logRecords.filter(
        (record) => record.level === "warn" && record.message === "workflow terminal listener failed"
      ).length === 2
    );
  });

  assert.deepEqual(
    logRecords
      .filter((record) => record.level === "warn" && record.message === "workflow terminal listener failed")
      .map((record) => record.errorMessage)
      .sort(),
    ["listener async failed", "listener sync failed"]
  );
});

test("fileWorkflowTracker does not replay terminal listeners across restart recovery", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-terminal-restart-"));
  const tracker = createTracker(dir);
  const queued = await createQueuedRun(tracker);
  let eventCount = 0;

  tracker.subscribeTerminalEvents(queued.runId, {
    completed: [
      () => {
        eventCount += 1;
      }
    ],
    error: [
      () => {
        eventCount += 1;
      }
    ]
  });

  await writeFile(
    queued.artifacts.resultFilePath,
    JSON.stringify(createProcessResult(queued, "2026-04-02T00:00:10.000Z", 0))
  );

  const reloadedTracker = createTracker(dir);
  await reloadedTracker.initialize();
  await reloadedTracker.reconcileActiveRuns(
    {
      async run() {
        throw new Error("should not be called");
      },
      async startDetached() {
        throw new Error("should not be called");
      },
      isProcessRunning() {
        return false;
      },
      async readDetachedResult(resultFilePath) {
        if (resultFilePath === queued.artifacts.resultFilePath) {
          return createProcessResult(queued, "2026-04-02T00:00:10.000Z", 0);
        }

        return null;
      }
    },
    {
      async createRunWorkspace() {
        throw new Error("should not be called");
      },
      async ensureReusableWorkspace() {
        throw new Error("should not be called");
      },
      async removeWorkspace() {}
    },
    {
      enabled: false,
      baseDir: "/tmp",
      cleanupAfterRun: false
    }
  );

  assert.equal(eventCount, 0);
});

function createTracker(dir: string, logRecords?: CapturedLogRecord[]): WorkflowTracker {
  return createFileWorkflowTracker(
    {
      stateFile: path.join(dir, "state.json"),
      logFile: path.join(dir, "runs.jsonl")
    },
    fileWorkflowTrackerRepo,
    logRecords ? createMemoryLogSink(logRecords) : createNoOpLogSink()
  );
}

async function createQueuedRun(tracker: WorkflowTracker) {
  await tracker.initialize();
  const queued = await tracker.createQueuedRun(
    {
      deliveryId: "delivery-1",
      eventName: "issues",
      workflowName: "issue-plan",
      matchedTrigger: "issue:open",
      executorName: "codex",
      repoFullName: "acme/demo",
      actorLogin: "octocat",
      installationId: 42
    },
    {
      workspacePath: "",
      launch: {
        prompt: "Plan issue 7",
        triggerEnv: {}
      }
    }
  );

  return queued.record;
}

function createProcessResult(
  queued: Awaited<ReturnType<typeof createQueuedRun>>,
  completedAt: string,
  exitCode: number
): ProcessRunResult {
  return {
    pid: 4242,
    exitCode,
    signal: null,
    stdout: "",
    stderr: "",
    stdoutPath: queued.artifacts.stdoutPath,
    stderrPath: queued.artifacts.stderrPath,
    timedOut: false,
    completedAt
  };
}

async function waitForCondition(check: () => boolean, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (check()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for terminal listener logs.");
}
