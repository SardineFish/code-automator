import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { fileWorkflowTrackerRepo } from "../../../src/repo/tracking/file-workflow-tracker-repo.js";
import { createFileWorkflowTracker } from "../../../src/service/tracking/file-workflow-tracker.js";
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
  const queued = await tracker.createQueuedRun(
    {
      deliveryId: "delivery-1",
      eventName: "issues",
      workflowName: "issue-plan",
      matchedTrigger: "issue:open",
      executorName: "codex",
      repoFullName: "acme/demo",
      actorLogin: "octocat",
      installationId: 42,
      reactionTarget: {
        kind: "issue",
        subjectId: 7
      }
    },
    ""
  );
  assert.equal(await tracker.getActiveRunCount(), 1);

  const queuedState = JSON.parse(await readFile(statePath, "utf8")) as {
    activeRuns: Record<string, { installationId?: number; reactionTarget?: { kind: string; subjectId: number } }>;
  };
  assert.equal(queuedState.activeRuns[queued.runId]?.installationId, 42);
  assert.deepEqual(queuedState.activeRuns[queued.runId]?.reactionTarget, {
    kind: "issue",
    subjectId: 7
  });

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
      reactionTarget?: { kind: string; subjectId: number };
    });

  assert.deepEqual(state.activeRuns, {});
  assert.equal(logLines.length, 1);
  assert.equal(logLines[0].runId, queued.runId);
  assert.equal(logLines[0].status, "succeeded");
  assert.equal(logLines[0].installationId, 42);
  assert.deepEqual(logLines[0].reactionTarget, {
    kind: "issue",
    subjectId: 7
  });
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
  const completedRun = await tracker.createQueuedRun(
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
    "/tmp/workspace-1"
  );
  const lostRun = await tracker.createQueuedRun(
    {
      deliveryId: "delivery-2",
      eventName: "issues",
      workflowName: "issue-plan",
      matchedTrigger: "issue:open",
      executorName: "codex",
      repoFullName: "acme/demo",
      actorLogin: "octocat",
      installationId: 42
    },
    ""
  );
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
    {
      async createRunWorkspace() {
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
  const queuedRun = await tracker.createQueuedRun(
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
    ""
  );
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
    {
      async createRunWorkspace() {
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
  const badRun = await tracker.createQueuedRun(
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
    ""
  );
  const goodRun = await tracker.createQueuedRun(
    {
      deliveryId: "delivery-2",
      eventName: "issues",
      workflowName: "issue-plan",
      matchedTrigger: "issue:open",
      executorName: "codex",
      repoFullName: "acme/demo",
      actorLogin: "octocat",
      installationId: 42
    },
    ""
  );

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
    {
      async createRunWorkspace() {
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
  const workspaceRun = await tracker.createQueuedRun(
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
    "/tmp/workspace-1"
  );
  const noWorkspaceRun = await tracker.createQueuedRun(
    {
      deliveryId: "delivery-2",
      eventName: "issues",
      workflowName: "issue-plan",
      matchedTrigger: "issue:open",
      executorName: "codex",
      repoFullName: "acme/demo",
      actorLogin: "octocat",
      installationId: 42
    },
    ""
  );

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
