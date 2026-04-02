import { randomUUID } from "node:crypto";

import type { TrackingConfig } from "../../types/config.js";
import type { LogSink } from "../../types/runtime.js";
import type {
  ActiveWorkflowRunRecord,
  CompletedWorkflowRunRecord,
  WorkflowTrackerState
} from "../../types/tracking.js";
import type { WorkflowTrackerRepo } from "../../repo/tracking/file-workflow-tracker-repo.js";
import { cleanupWorkspace, getCompletedStatus, readPid, requireActiveRun } from "./tracker-helpers.js";
import type { WorkflowTracker } from "./workflow-tracker.js";

const QUEUED_LOST_GRACE_MS = 30000;

export function createFileWorkflowTracker(
  config: TrackingConfig,
  repo: WorkflowTrackerRepo,
  logSink: LogSink
): WorkflowTracker {
  let state: WorkflowTrackerState = { version: 1, activeRuns: {} };
  let queue = Promise.resolve();

  return {
    async initialize() {
      await repo.ensureFiles(config);
      state = await repo.loadState(config);
    },
    async createQueuedRun(context, workspacePath) {
      const runId = randomUUID();
      const artifacts = await repo.createArtifacts(config, runId);
      const now = new Date().toISOString();
      const record: ActiveWorkflowRunRecord = {
        ...context,
        runId,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        workspacePath,
        artifacts
      };

      return withLock(async () => {
        state.activeRuns[runId] = record;
        await repo.saveState(config, state);
        return record;
      });
    },
    async updateQueuedRun(runId, details) {
      return withLock(async () => {
        const record = requireActiveRun(runId, state.activeRuns[runId]);
        const nextRecord: ActiveWorkflowRunRecord = {
          ...record,
          workspacePath: details.workspacePath,
          updatedAt: new Date().toISOString()
        };
        state.activeRuns[runId] = nextRecord;
        await repo.saveState(config, state);
        return nextRecord;
      });
    },
    async markRunning(runId, details) {
      return withLock(async () => {
        const record = requireActiveRun(runId, state.activeRuns[runId]);
        const nextRecord: ActiveWorkflowRunRecord = {
          ...record,
          status: "running",
          pid: details.pid,
          command: details.command,
          startedAt: details.startedAt,
          workspacePath: details.workspacePath,
          updatedAt: new Date().toISOString()
        };
        state.activeRuns[runId] = nextRecord;
        await repo.saveState(config, state);
        return nextRecord;
      });
    },
    async markTerminal(runId, status, details) {
      return withLock(async () => {
        const record = state.activeRuns[runId];

        if (!record) {
          return null;
        }

        const completedAt = details.completedAt ?? details.process?.completedAt ?? new Date().toISOString();
        const completedRecord: CompletedWorkflowRunRecord = {
          ...record,
          status,
          updatedAt: completedAt,
          completedAt,
          process: details.process,
          errorMessage: details.errorMessage
        };

        delete state.activeRuns[runId];
        await repo.saveState(config, state);
        await repo.appendLog(config, { ...completedRecord });
        logSink.info({
          timestamp: new Date().toISOString(),
          level: "info",
          message: "workflow run completed",
          runId,
          workflowName: completedRecord.workflowName,
          status,
          pid: completedRecord.pid,
          source: completedRecord.source,
          repo: completedRecord.repoFullName
        });
        return completedRecord;
      });
    },
    async reconcileActiveRuns(processRunner, workspaceRepo, workspace) {
      const snapshot = await withLock(async () => Object.values(state.activeRuns));

      for (const record of snapshot) {
        try {
          const completed = await processRunner.readDetachedResult(record.artifacts.resultFilePath);

          if (completed) {
            await cleanupWorkspace(workspaceRepo, workspace, record.workspacePath);
            await this.markTerminal(record.runId, getCompletedStatus(completed), {
              process: completed,
              completedAt: completed.completedAt
            });
            continue;
          }

          const pid = record.pid ?? (await readPid(record.artifacts.pidFilePath));

          if (pid !== undefined) {
            if (record.pid === undefined) {
              await this.markRunning(record.runId, {
                pid,
                command: record.command ?? "",
                startedAt: record.startedAt ?? new Date().toISOString(),
                workspacePath: record.workspacePath
              });
            }

            if (processRunner.isProcessRunning(pid)) {
              continue;
            }
          }

          if (record.status === "queued" && !isQueuedRunExpired(record.createdAt)) {
            continue;
          }

          await cleanupWorkspace(workspaceRepo, workspace, record.workspacePath);
          await this.markTerminal(record.runId, "lost", {
            errorMessage: "Tracked executor process is no longer running and no result file was found."
          });
        } catch (error) {
          logSink.error({
            timestamp: new Date().toISOString(),
            level: "error",
            message: "workflow reconciliation item failed",
            runId: record.runId,
            errorMessage: error instanceof Error ? error.message : "Unknown reconciliation error."
          });
        }
      }
    }
  };

  function withLock<T>(task: () => Promise<T>): Promise<T> {
    const next = queue.then(task);
    queue = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  }
}

function isQueuedRunExpired(createdAt: string): boolean {
  return Date.now() - Date.parse(createdAt) > QUEUED_LOST_GRACE_MS;
}
