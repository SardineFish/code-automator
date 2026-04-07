import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { initializeWorkflowTracking } from "../../src/app/default-app-runtime.js";
import { fileWorkflowTrackerRepo } from "../../src/repo/tracking/file-workflow-tracker-repo.js";
import { createFileWorkflowTracker } from "../../src/service/tracking/file-workflow-tracker.js";
import type { WorkflowTrackerState } from "../../src/types/tracking.js";
import { createNoOpLogSink } from "../fixtures/log-sink.js";
import { createServiceConfig } from "../fixtures/service-config.js";

test("initializeWorkflowTracking relaunches persisted queued runs before they age out", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-runtime-startup-"));
  const workspaceBaseDir = path.join(dir, "workspaces");
  const config = createServiceConfig();
  config.tracking = {
    stateFile: path.join(dir, "state.json"),
    logFile: path.join(dir, "runs.jsonl")
  };
  config.workspace = {
    enabled: true,
    baseDir: workspaceBaseDir,
    cleanupAfterRun: false
  };
  config.executors.codex.workspace = {
    baseDir: workspaceBaseDir,
    key: "${in.repo}#${in.issueId}"
  };

  try {
    const tracker = createFileWorkflowTracker(config.tracking, fileWorkflowTrackerRepo, createNoOpLogSink());
    await tracker.initialize();
    const queued = await tracker.createQueuedRun(
      {
        workflowName: "issue-plan",
        matchedTrigger: "issue:command:plan",
        executorName: "codex",
        repoFullName: "acme/demo",
        actorLogin: "octocat",
        installationId: 42
      },
      {
        workspacePath: "",
        workspaceKey: "acme/demo#7",
        launch: {
          prompt: "Plan issue 7",
          triggerEnv: {
            GH_TOKEN: "token-1"
          }
        }
      }
    );

    const persistedState = JSON.parse(await readFile(config.tracking.stateFile, "utf8")) as WorkflowTrackerState;
    persistedState.activeRuns[queued.record.runId] = {
      ...persistedState.activeRuns[queued.record.runId],
      createdAt: "2026-04-01T00:00:00.000Z",
      updatedAt: "2026-04-01T00:00:00.000Z"
    };
    await writeFile(config.tracking.stateFile, JSON.stringify(persistedState, null, 2));

    const reloadedTracker = createFileWorkflowTracker(
      config.tracking,
      fileWorkflowTrackerRepo,
      createNoOpLogSink()
    );
    const startedCommands: string[] = [];
    const startedCwds: string[] = [];
    const envs: NodeJS.ProcessEnv[] = [];
    const reusableWorkspaceNames: string[] = [];

    await initializeWorkflowTracking(config, {
      processRunner: {
        async run() {
          throw new Error("should not run");
        },
        async startDetached(command, options) {
          startedCommands.push(command);
          startedCwds.push(options.cwd);
          envs.push(options.env);
          return {
            pid: 4242,
            startedAt: "2026-04-02T00:00:00.000Z"
          };
        },
        isProcessRunning(pid) {
          return pid === 4242;
        },
        async readDetachedResult() {
          return null;
        }
      },
      workspaceRepo: {
        async createRunWorkspace() {
          throw new Error("should not be called");
        },
        async ensureReusableWorkspace(baseDir, workspaceName) {
          reusableWorkspaceNames.push(`${baseDir}:${workspaceName}`);
          return path.join(baseDir, workspaceName);
        },
        async removeWorkspace() {}
      },
      workflowTracker: reloadedTracker,
      logSink: createNoOpLogSink(),
      baseEnv: { BASE: "1" },
      reconcileIntervalMs: 0
    });

    const savedState = JSON.parse(await readFile(config.tracking.stateFile, "utf8")) as WorkflowTrackerState;
    const recoveredRun = savedState.activeRuns[queued.record.runId];
    const expectedWorkspacePath = path.join(workspaceBaseDir, "acme_demo#7");

    assert.deepEqual(reusableWorkspaceNames, [`${workspaceBaseDir}:acme_demo#7`]);
    assert.deepEqual(startedCommands, ["codex exec 'Plan issue 7'"]);
    assert.deepEqual(startedCwds, [expectedWorkspacePath]);
    assert.equal(envs[0]?.BASE, "1");
    assert.equal(envs[0]?.EXECUTOR, "codex");
    assert.equal(envs[0]?.GH_TOKEN, "token-1");
    assert.equal(recoveredRun?.status, "running");
    assert.equal(recoveredRun?.pid, 4242);
    assert.equal(recoveredRun?.workspacePath, expectedWorkspacePath);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("initializeWorkflowTracking cleanup stops future reconcile intervals", async () => {
  let reconcileCount = 0;
  const cleanup = await initializeWorkflowTracking(createServiceConfig(), {
    processRunner: {
      async run() {
        throw new Error("should not run");
      },
      async startDetached() {
        throw new Error("should not run");
      },
      isProcessRunning() {
        return false;
      },
      async readDetachedResult() {
        return null;
      }
    },
    workspaceRepo: {
      async createRunWorkspace() {
        throw new Error("should not run");
      },
      async ensureReusableWorkspace() {
        throw new Error("should not run");
      },
      async removeWorkspace() {}
    },
    workflowTracker: {
      async initialize() {},
      async createQueuedRun() {
        throw new Error("should not run");
      },
      async getLaunchableQueuedRuns() {
        return [];
      },
      async getActiveRuns() {
        return [];
      },
      subscribeTerminalEvents() {
        return () => undefined;
      },
      async updateQueuedRun() {
        throw new Error("should not run");
      },
      async getActiveRunCount() {
        return 0;
      },
      async markRunning() {
        throw new Error("should not run");
      },
      async markTerminal() {
        throw new Error("should not run");
      },
      async reconcileActiveRuns() {
        reconcileCount += 1;
        return [];
      }
    },
    logSink: createNoOpLogSink(),
    baseEnv: {},
    reconcileIntervalMs: 10
  });

  assert.equal(reconcileCount, 1);
  await waitForCondition(() => reconcileCount > 1);
  const stoppedAt = reconcileCount;

  await cleanup();
  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.equal(reconcileCount, stoppedAt);
});

async function waitForCondition(predicate: () => boolean): Promise<void> {
  const startedAt = Date.now();

  while (!predicate()) {
    if (Date.now() - startedAt > 500) {
      throw new Error("Condition did not become true in time.");
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}
