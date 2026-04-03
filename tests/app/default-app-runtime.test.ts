import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { initializeWorkflowTracking } from "../../src/app/default-app-runtime.js";
import { fileWorkflowTrackerRepo } from "../../src/repo/tracking/file-workflow-tracker-repo.js";
import { createFileWorkflowTracker } from "../../src/service/tracking/file-workflow-tracker.js";
import type { ActiveWorkflowRunRecord, WorkflowTrackerState } from "../../src/types/tracking.js";
import { createNoOpLogSink } from "../fixtures/log-sink.js";
import { createServiceConfig } from "../fixtures/service-config.js";

test("initializeWorkflowTracking relaunches persisted queued runs on startup", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gao-startup-relaunch-"));
  const config = createServiceConfig();
  config.tracking.stateFile = path.join(dir, "state.json");
  config.tracking.logFile = path.join(dir, "runs.jsonl");

  try {
    const tracker = createFileWorkflowTracker(config.tracking, fileWorkflowTrackerRepo, createNoOpLogSink());
    await tracker.initialize();
    const queued = await tracker.createQueuedRun(
      {
        source: "/gh-hook",
        eventName: "issue:command:plan",
        workflowName: "issue-plan",
        matchedTrigger: "issue:command:plan",
        executorName: "codex"
      },
      {
        workspacePath: "",
        launch: {
          prompt: "Plan issue 7",
          triggerEnv: { TRIGGER: "1" }
        }
      }
    );

    const reloadedTracker = createFileWorkflowTracker(
      config.tracking,
      fileWorkflowTrackerRepo,
      createNoOpLogSink()
    );
    const launchCommands: string[] = [];
    const envs: NodeJS.ProcessEnv[] = [];

    await initializeWorkflowTracking(config, {
      processRunner: {
        async run() {
          throw new Error("should not be called");
        },
        async startDetached(command, options) {
          launchCommands.push(command);
          envs.push(options.env);
          return {
            pid: 4242,
            startedAt: "2026-04-02T00:00:00.000Z"
          };
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
          throw new Error("should not be called");
        },
        async ensureReusableWorkspace() {
          throw new Error("should not be called");
        },
        async removeWorkspace() {}
      },
      workflowTracker: reloadedTracker,
      logSink: createNoOpLogSink(),
      baseEnv: { BASE: "1" },
      reconcileIntervalMs: 0
    });

    await waitForCondition(async () => {
      const activeRun = await readActiveRun(config.tracking.stateFile, queued.record.runId);
      return activeRun?.status === "running";
    });

    assert.deepEqual(launchCommands, ["codex exec 'Plan issue 7'"]);
    assert.equal(envs[0]?.BASE, "1");
    assert.equal(envs[0]?.EXECUTOR, "codex");
    assert.equal(envs[0]?.TRIGGER, "1");
    const activeRun = await readActiveRun(config.tracking.stateFile, queued.record.runId);
    assert.equal(activeRun?.status, "running");
    assert.equal(activeRun?.pid, 4242);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

async function readActiveRun(
  stateFile: string,
  runId: string
): Promise<ActiveWorkflowRunRecord | undefined> {
  const state = JSON.parse(await readFile(stateFile, "utf8")) as WorkflowTrackerState;
  return state.activeRuns[runId];
}

async function waitForCondition(check: () => Promise<boolean>, timeoutMs = 1000): Promise<void> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (await check()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Timed out waiting for startup workflow relaunch.");
}
