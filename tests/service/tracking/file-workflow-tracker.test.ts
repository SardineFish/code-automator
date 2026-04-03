import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { fileWorkflowTrackerRepo } from "../../../src/repo/tracking/file-workflow-tracker-repo.js";
import type { WorkspaceRepo } from "../../../src/repo/workspace/workspace-repo.js";
import { createFileWorkflowTracker } from "../../../src/service/tracking/file-workflow-tracker.js";
import type { WorkflowTracker } from "../../../src/service/tracking/workflow-tracker.js";
import { createNoOpLogSink } from "../../fixtures/log-sink.js";

test("fileWorkflowTracker persists running runs and appends terminal results", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-tracker-"));
  const statePath = path.join(dir, "state.json");
  const tracker = createFileWorkflowTracker(
    {
      stateFile: statePath,
      logFile: path.join(dir, "runs.jsonl")
    },
    fileWorkflowTrackerRepo,
    createNoOpLogSink()
  );

  await tracker.initialize();
  assert.equal(await tracker.getActiveRunCount(), 0);
  const queued = await createQueuedRun(tracker, "delivery-1");
  assert.equal(await tracker.getActiveRunCount(), 1);

  const queuedState = JSON.parse(await readFile(statePath, "utf8")) as {
    activeRuns: Record<string, { installationId?: number }>;
  };
  assert.equal(queuedState.activeRuns[queued.runId]?.installationId, 42);

  await tracker.markRunning(queued.runId, {
    pid: 4242,
    command: "codex exec 'Plan subject 7 in acme/demo'",
    startedAt: "2026-04-02T00:00:00.000Z",
    workspacePath: "/tmp/workspace-1"
  });
  assert.equal(await tracker.getActiveRunCount(), 1);
  await tracker.markTerminal(queued.runId, "succeeded", {
    completedAt: "2026-04-02T00:00:10.000Z",
    process: {
      pid: 4242,
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      stdoutPath: queued.artifacts.stdoutPath,
      stderrPath: queued.artifacts.stderrPath,
      timedOut: false,
      completedAt: "2026-04-02T00:00:10.000Z"
    }
  });
  assert.equal(await tracker.getActiveRunCount(), 0);

  const state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8")) as {
    activeRuns: Record<string, unknown>;
  };
  const logLines = (await readFile(path.join(dir, "runs.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as {
      status: string;
      runId: string;
      installationId?: number;
    });

  assert.deepEqual(state.activeRuns, {});
  assert.equal(logLines.length, 1);
  assert.equal(logLines[0].runId, queued.runId);
  assert.equal(logLines[0].status, "succeeded");
  assert.equal(logLines[0].installationId, 42);
});

test("fileWorkflowTracker reconciles active runs from result files and missing pids", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-reconcile-"));
  const tracker = createFileWorkflowTracker(
    {
      stateFile: path.join(dir, "state.json"),
      logFile: path.join(dir, "runs.jsonl")
    },
    fileWorkflowTrackerRepo,
    createNoOpLogSink()
  );

  await tracker.initialize();
  const completedRun = await createQueuedRun(tracker, "delivery-1", "/tmp/workspace-1");
  const lostRun = await createQueuedRun(tracker, "delivery-2");
  assert.equal(await tracker.getActiveRunCount(), 2);

  await tracker.markRunning(completedRun.runId, {
    pid: 1234,
    command: "codex exec plan",
    startedAt: "2026-04-02T00:00:00.000Z",
    workspacePath: "/tmp/workspace-1"
  });
  const statePath = path.join(dir, "state.json");
  const currentState = JSON.parse(await readFile(statePath, "utf8")) as {
    version: number;
    activeRuns: Record<string, { createdAt: string }>;
  };
  currentState.activeRuns[lostRun.runId].createdAt = "2026-04-01T00:00:00.000Z";
  await writeFile(statePath, JSON.stringify(currentState, null, 2));
  await writeFile(
    completedRun.artifacts.resultFilePath,
    JSON.stringify({
      pid: 1234,
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: "",
      timedOut: false,
      completedAt: "2026-04-02T00:00:05.000Z"
    })
  );

  const reloadedTracker = createFileWorkflowTracker(
    {
      stateFile: path.join(dir, "state.json"),
      logFile: path.join(dir, "runs.jsonl")
    },
    fileWorkflowTrackerRepo,
    createNoOpLogSink()
  );

  await reloadedTracker.initialize();
  assert.equal(await reloadedTracker.getActiveRunCount(), 2);
  await reloadedTracker.reconcileActiveRuns(
    {
      async run() {
        throw new Error("should not be called");
      },
      async startDetached() {
        throw new Error("should not be called");
      },
      isProcessRunning(pid) {
        return pid === 1234;
      },
      async readDetachedResult(resultFilePath) {
        if (resultFilePath === completedRun.artifacts.resultFilePath) {
          return {
            pid: 1234,
            exitCode: 0,
            signal: null,
            stdout: "",
            stderr: "",
            timedOut: false,
            completedAt: "2026-04-02T00:00:05.000Z"
          };
        }

        return null;
      }
    },
    createNoOpWorkspaceRepo(),
    {
      enabled: false,
      baseDir: "/tmp",
      cleanupAfterRun: false
    }
  );
  assert.equal(await reloadedTracker.getActiveRunCount(), 0);

  const logLines = (await readFile(path.join(dir, "runs.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { runId: string; status: string });

  assert.deepEqual(
    logLines.map((entry) => `${entry.runId}:${entry.status}`).sort(),
    [`${completedRun.runId}:succeeded`, `${lostRun.runId}:lost`].sort()
  );
});

test("fileWorkflowTracker does not mark fresh queued runs as lost", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-queued-"));
  const tracker = createFileWorkflowTracker(
    {
      stateFile: path.join(dir, "state.json"),
      logFile: path.join(dir, "runs.jsonl")
    },
    fileWorkflowTrackerRepo,
    createNoOpLogSink()
  );

  await tracker.initialize();
  const queuedRun = await createQueuedRun(tracker, "delivery-1");
  assert.equal(await tracker.getActiveRunCount(), 1);

  await tracker.reconcileActiveRuns(
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
      async readDetachedResult() {
        return null;
      }
    },
    createNoOpWorkspaceRepo(),
    {
      enabled: false,
      baseDir: "/tmp",
      cleanupAfterRun: false
    }
  );

  const state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8")) as {
    activeRuns: Record<string, unknown>;
  };

  assert.equal(await tracker.getActiveRunCount(), 1);
  assert.ok(queuedRun.runId in state.activeRuns);
});

test("fileWorkflowTracker isolates malformed result files during reconciliation", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-reconcile-bad-"));
  const tracker = createFileWorkflowTracker(
    {
      stateFile: path.join(dir, "state.json"),
      logFile: path.join(dir, "runs.jsonl")
    },
    fileWorkflowTrackerRepo,
    createNoOpLogSink()
  );

  await tracker.initialize();
  const badRun = await createQueuedRun(tracker, "delivery-1");
  const goodRun = await createQueuedRun(tracker, "delivery-2");

  await tracker.markRunning(badRun.runId, {
    pid: 1234,
    command: "codex exec bad",
    startedAt: "2026-04-02T00:00:00.000Z",
    workspacePath: ""
  });
  await tracker.markRunning(goodRun.runId, {
    pid: 5678,
    command: "codex exec good",
    startedAt: "2026-04-02T00:00:00.000Z",
    workspacePath: ""
  });

  await tracker.reconcileActiveRuns(
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
        if (resultFilePath === badRun.artifacts.resultFilePath) {
          throw new Error("bad json");
        }

        return {
          pid: 5678,
          exitCode: 0,
          signal: null,
          stdout: "",
          stderr: "",
          timedOut: false,
          completedAt: "2026-04-02T00:00:05.000Z"
        };
      }
    },
    createNoOpWorkspaceRepo(),
    {
      enabled: false,
      baseDir: "/tmp",
      cleanupAfterRun: false
    }
  );

  const logLines = (await readFile(path.join(dir, "runs.jsonl"), "utf8"))
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { runId: string; status: string });

  assert.deepEqual(logLines.map((entry) => `${entry.runId}:${entry.status}`), [
    `${goodRun.runId}:succeeded`
  ]);
});

test("fileWorkflowTracker only cleans up runs with real workspace paths", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-reconcile-cleanup-"));
  const tracker = createFileWorkflowTracker(
    {
      stateFile: path.join(dir, "state.json"),
      logFile: path.join(dir, "runs.jsonl")
    },
    fileWorkflowTrackerRepo,
    createNoOpLogSink()
  );

  await tracker.initialize();
  const workspaceRun = await createQueuedRun(tracker, "delivery-1", "/tmp/workspace-1");
  const noWorkspaceRun = await createQueuedRun(tracker, "delivery-2");

  await tracker.markRunning(workspaceRun.runId, {
    pid: 1234,
    command: "codex exec workspace",
    startedAt: "2026-04-02T00:00:00.000Z",
    workspacePath: "/tmp/workspace-1"
  });
  await tracker.markRunning(noWorkspaceRun.runId, {
    pid: 5678,
    command: "codex exec no-workspace",
    startedAt: "2026-04-02T00:00:00.000Z",
    workspacePath: ""
  });

  const removedWorkspaces: string[] = [];
  await tracker.reconcileActiveRuns(
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
        if (
          resultFilePath === workspaceRun.artifacts.resultFilePath ||
          resultFilePath === noWorkspaceRun.artifacts.resultFilePath
        ) {
          return {
            pid: resultFilePath === workspaceRun.artifacts.resultFilePath ? 1234 : 5678,
            exitCode: 0,
            signal: null,
            stdout: "",
            stderr: "",
            timedOut: false,
            completedAt: "2026-04-02T00:00:05.000Z"
          };
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
      async removeWorkspace(workspacePath) {
        removedWorkspaces.push(workspacePath);
      }
    },
    {
      enabled: false,
      baseDir: "/tmp",
      cleanupAfterRun: true
    }
  );

  assert.deepEqual(removedWorkspaces, ["/tmp/workspace-1"]);
});

test("fileWorkflowTracker serializes keyed workspace runs and releases the next queued run", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-keyed-queue-"));
  const tracker = createFileWorkflowTracker(
    {
      stateFile: path.join(dir, "state.json"),
      logFile: path.join(dir, "runs.jsonl")
    },
    fileWorkflowTrackerRepo,
    createNoOpLogSink()
  );

  await tracker.initialize();
  const first = await tracker.createQueuedRun(createQueuedRunContext("delivery-1"), {
    workspacePath: "",
    workspaceKey: "acme/demo#7",
    launch: {
      prompt: "Plan issue 7",
      triggerEnv: {}
    }
  });
  const second = await tracker.createQueuedRun(createQueuedRunContext("delivery-2"), {
    workspacePath: "",
    workspaceKey: "acme/demo#7",
    launch: {
      prompt: "Continue issue 7",
      triggerEnv: {}
    }
  });

  assert.equal(first.shouldLaunchNow, true);
  assert.equal(second.shouldLaunchNow, false);

  const state = JSON.parse(await readFile(path.join(dir, "state.json"), "utf8")) as {
    keyedWorkspaces: Record<string, { activeRunId?: string; pendingRunIds: string[] }>;
  };
  assert.deepEqual(state.keyedWorkspaces["acme/demo#7"], {
    activeRunId: first.record.runId,
    pendingRunIds: [second.record.runId]
  });

  const transition = await tracker.markTerminal(first.record.runId, "succeeded", {
    completedAt: "2026-04-02T00:00:10.000Z"
  });

  assert.equal(transition.completed?.status, "succeeded");
  assert.deepEqual(transition.releasedRuns.map((run) => run.runId), [second.record.runId]);
});

test("fileWorkflowTracker does not lose an old queued keyed follower during the same reconcile pass", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-keyed-reconcile-"));
  const statePath = path.join(dir, "state.json");
  const tracker = createFileWorkflowTracker(
    {
      stateFile: statePath,
      logFile: path.join(dir, "runs.jsonl")
    },
    fileWorkflowTrackerRepo,
    createNoOpLogSink()
  );

  await tracker.initialize();
  const first = await tracker.createQueuedRun(createQueuedRunContext("delivery-1"), {
    workspacePath: "/tmp/reusable/acme_demo#7",
    workspaceKey: "acme/demo#7",
    launch: {
      prompt: "Plan issue 7",
      triggerEnv: {}
    }
  });
  const second = await tracker.createQueuedRun(createQueuedRunContext("delivery-2"), {
    workspacePath: "/tmp/reusable/acme_demo#7",
    workspaceKey: "acme/demo#7",
    launch: {
      prompt: "Continue issue 7",
      triggerEnv: {}
    }
  });

  await tracker.markRunning(first.record.runId, {
    pid: 1234,
    command: "codex exec plan",
    startedAt: "2026-04-02T00:00:00.000Z",
    workspacePath: "/tmp/reusable/acme_demo#7"
  });

  const currentState = JSON.parse(await readFile(statePath, "utf8")) as {
    activeRuns: Record<string, { createdAt: string }>;
  };
  currentState.activeRuns[second.record.runId].createdAt = "2026-04-01T00:00:00.000Z";
  await writeFile(statePath, JSON.stringify(currentState, null, 2));

  const reloadedTracker = createFileWorkflowTracker(
    {
      stateFile: statePath,
      logFile: path.join(dir, "runs.jsonl")
    },
    fileWorkflowTrackerRepo,
    createNoOpLogSink()
  );
  await reloadedTracker.initialize();

  const releasedRuns = await reloadedTracker.reconcileActiveRuns(
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
        return resultFilePath === first.record.artifacts.resultFilePath
          ? {
              pid: 1234,
              exitCode: 0,
              signal: null,
              stdout: "",
              stderr: "",
              timedOut: false,
              completedAt: "2026-04-02T00:00:05.000Z"
            }
          : null;
      }
    },
    createNoOpWorkspaceRepo(),
    {
      enabled: false,
      baseDir: "/tmp",
      cleanupAfterRun: true
    }
  );

  assert.deepEqual(releasedRuns.map((run) => run.runId), [second.record.runId]);
  assert.equal(await reloadedTracker.getActiveRunCount(), 1);
});

async function createQueuedRun(
  tracker: WorkflowTracker,
  deliveryId: string,
  workspacePath = ""
) {
  const queued = await tracker.createQueuedRun(createQueuedRunContext(deliveryId), {
    workspacePath,
    launch: {
      prompt: "Plan issue 7",
      triggerEnv: {}
    }
  });

  return queued.record;
}

function createQueuedRunContext(deliveryId: string) {
  return {
    deliveryId,
    eventName: "issues",
    workflowName: "issue-plan",
    matchedTrigger: "issue:open" as const,
    executorName: "codex",
    repoFullName: "acme/demo",
    actorLogin: "octocat",
    installationId: 42
  };
}

function createNoOpWorkspaceRepo(): WorkspaceRepo {
  return {
    async createRunWorkspace() {
      throw new Error("should not be called");
    },
    async ensureReusableWorkspace() {
      throw new Error("should not be called");
    },
    async removeWorkspace() {}
  };
}
