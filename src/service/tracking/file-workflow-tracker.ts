import { randomUUID } from "node:crypto";

import type { TrackingConfig } from "../../types/config.js";
import type { LogSink } from "../../types/logging.js";
import type { AppContextTerminalListeners } from "../../types/runtime.js";
import type {
  ActiveWorkflowRunRecord,
  CompletedWorkflowRunRecord,
  WorkflowTrackerState
} from "../../types/tracking.js";
import type { WorkflowTrackerRepo } from "../../repo/tracking/file-workflow-tracker-repo.js";
import { logCompletedRun } from "./log-completed-run.js";
import { cleanupWorkspace, getCompletedStatus, readPid, requireActiveRun } from "./tracker-helpers.js";
import type { WorkflowTracker } from "./workflow-tracker.js";
import { buildWorkflowTerminalEvent, emitWorkflowTerminalEvent } from "./workflow-terminal-events.js";

const QUEUED_LOST_GRACE_MS = 30000;

export function createFileWorkflowTracker(
  config: TrackingConfig,
  repo: WorkflowTrackerRepo,
  logSink: LogSink
): WorkflowTracker {
  let state: WorkflowTrackerState = { version: 1, activeRuns: {} };
  const terminalListeners = new Map<string, AppContextTerminalListeners>();
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
    subscribeTerminalEvents(runId, listeners) {
      const nextListeners = cloneTerminalListeners(listeners);
      if (!hasTerminalListeners(nextListeners)) {
        return () => undefined;
      }

      const currentListeners = terminalListeners.get(runId);
      terminalListeners.set(
        runId,
        currentListeners ? mergeTerminalListeners(currentListeners, nextListeners) : nextListeners
      );

      return () => {
        const current = terminalListeners.get(runId);
        if (!current) {
          return;
        }

        const remaining = removeTerminalListeners(current, nextListeners);
        if (hasTerminalListeners(remaining)) {
          terminalListeners.set(runId, remaining);
          return;
        }

        terminalListeners.delete(runId);
      };
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
    async getActiveRunCount() {
      return withLock(async () => Object.keys(state.activeRuns).length);
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
          terminalListeners.delete(runId);
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
        await logCompletedRun(logSink, completedRecord);
        const listeners = terminalListeners.get(runId);
        terminalListeners.delete(runId);
        const terminalEvent = buildWorkflowTerminalEvent(completedRecord);
        if (listeners && terminalEvent) {
          emitWorkflowTerminalEvent(logSink, runId, listeners, terminalEvent);
        }
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

function hasTerminalListeners(listeners: AppContextTerminalListeners): boolean {
  return listeners.completed.length > 0 || listeners.error.length > 0;
}

function cloneTerminalListeners(listeners: AppContextTerminalListeners): AppContextTerminalListeners {
  return {
    completed: [...listeners.completed],
    error: [...listeners.error]
  };
}

function mergeTerminalListeners(
  current: AppContextTerminalListeners,
  next: AppContextTerminalListeners
): AppContextTerminalListeners {
  return {
    completed: [...current.completed, ...next.completed],
    error: [...current.error, ...next.error]
  };
}

function removeTerminalListeners(
  current: AppContextTerminalListeners,
  listenersToRemove: AppContextTerminalListeners
): AppContextTerminalListeners {
  return {
    completed: removeListenerEntries(current.completed, listenersToRemove.completed),
    error: removeListenerEntries(current.error, listenersToRemove.error)
  };
}

function removeListenerEntries<T>(
  currentListeners: T[],
  listenersToRemove: T[]
): T[] {
  const remaining = [...currentListeners];

  for (const listener of listenersToRemove) {
    const index = remaining.indexOf(listener);
    if (index !== -1) {
      remaining.splice(index, 1);
    }
  }

  return remaining;
}
