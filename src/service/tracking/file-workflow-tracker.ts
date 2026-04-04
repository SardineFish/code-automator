import { randomUUID } from "node:crypto";

import type { TrackingConfig } from "../../types/config.js";
import type { LogSink } from "../../types/logging.js";
import type { WorkflowContextTerminalListeners } from "../../types/runtime.js";
import type {
  ActiveWorkflowRunRecord,
  CompletedWorkflowRunRecord,
  WorkflowTrackerState
} from "../../types/tracking.js";
import type { WorkflowTrackerRepo } from "../../repo/tracking/file-workflow-tracker-repo.js";
import { logCompletedRun } from "./log-completed-run.js";
import { releaseKeyedWorkspaceRun, reserveKeyedWorkspaceRun } from "./keyed-workspace-queue.js";
import { cleanupWorkspace, getCompletedStatus, readPid, requireActiveRun } from "./tracker-helpers.js";
import type { WorkflowTracker } from "./workflow-tracker.js";
import { buildWorkflowTerminalEvent, emitWorkflowTerminalEvent } from "./workflow-terminal-events.js";

const QUEUED_LOST_GRACE_MS = 30000;

export function createFileWorkflowTracker(
  config: TrackingConfig,
  repo: WorkflowTrackerRepo,
  logSink: LogSink
): WorkflowTracker {
  let state: WorkflowTrackerState = { version: 2, activeRuns: {}, keyedWorkspaces: {} };
  const terminalListeners = new Map<string, WorkflowContextTerminalListeners>();
  let queue = Promise.resolve();

  return {
    async initialize() {
      await repo.ensureFiles(config);
      state = await repo.loadState(config);
    },
    async createQueuedRun(context, details) {
      const runId = randomUUID();
      const artifacts = await repo.createArtifacts(config, runId);
      const now = new Date().toISOString();
      const record: ActiveWorkflowRunRecord = {
        ...context,
        runId,
        status: "queued",
        createdAt: now,
        updatedAt: now,
        workspacePath: details.workspacePath,
        workspaceKey: details.workspaceKey,
        launch: details.launch,
        artifacts
      };

      return withLock(async () => {
        state.activeRuns[runId] = record;
        const shouldLaunchNow =
          details.workspaceKey === undefined
            ? true
            : reserveKeyedWorkspaceRun(state.keyedWorkspaces, details.workspaceKey, runId);
        await repo.saveState(config, state);
        return {
          record,
          shouldLaunchNow
        };
      });
    },
    async getLaunchableQueuedRuns() {
      return withLock(async () =>
        Object.values(state.activeRuns).filter((record) => isLaunchableQueuedRun(record))
      );
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
          return { completed: null, releasedRuns: [] };
        }

        const completedAt = details.completedAt ?? details.process?.completedAt ?? new Date().toISOString();
        const { launch: _launch, ...completedRecordBase } = record;
        const completedRecord: CompletedWorkflowRunRecord = {
          ...completedRecordBase,
          status,
          updatedAt: completedAt,
          completedAt,
          process: details.process,
          errorMessage: details.errorMessage
        };
        const releasedRuns = releasePendingRuns(record.workspaceKey, runId);

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
        return {
          completed: completedRecord,
          releasedRuns
        };
      });
    },
    async reconcileActiveRuns(processRunner, workspaceRepo, workspace) {
      const snapshot = await withLock(async () => Object.values(state.activeRuns));
      const releasedRuns: ActiveWorkflowRunRecord[] = [];
      const releasedRunIds = new Set<string>();

      for (const record of snapshot) {
        if (releasedRunIds.has(record.runId)) {
          continue;
        }

        try {
          const completed = await processRunner.readDetachedResult(record.artifacts.resultFilePath);

          if (completed) {
            await cleanupWorkspace(workspaceRepo, workspace, record.workspacePath, record.workspaceKey);
            const transition = await this.markTerminal(record.runId, getCompletedStatus(completed), {
              process: completed,
              completedAt: completed.completedAt
            });
            releasedRuns.push(...transition.releasedRuns);
            for (const releasedRun of transition.releasedRuns) {
              releasedRunIds.add(releasedRun.runId);
            }
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

          if (isPendingKeyedRun(record)) {
            continue;
          }

          await cleanupWorkspace(workspaceRepo, workspace, record.workspacePath, record.workspaceKey);
          const transition = await this.markTerminal(record.runId, "lost", {
            errorMessage: "Tracked executor process is no longer running and no result file was found."
          });
          releasedRuns.push(...transition.releasedRuns);
          for (const releasedRun of transition.releasedRuns) {
            releasedRunIds.add(releasedRun.runId);
          }
        } catch (error) {
          logSink.error({
            message: "workflow reconciliation item failed",
            runId: record.runId,
            errorMessage: error instanceof Error ? error.message : "Unknown reconciliation error."
          });
        }
      }

      return releasedRuns;
    }
  };

  function releasePendingRuns(workspaceKey: string | undefined, runId: string): ActiveWorkflowRunRecord[] {
    if (workspaceKey === undefined) {
      return [];
    }

    const nextRunId = releaseKeyedWorkspaceRun(state.keyedWorkspaces, workspaceKey, runId);

    if (!nextRunId) {
      return [];
    }

    const nextRun = state.activeRuns[nextRunId];
    return nextRun ? [nextRun] : [];
  }

  function isPendingKeyedRun(record: ActiveWorkflowRunRecord): boolean {
    if (record.status !== "queued" || record.workspaceKey === undefined) {
      return false;
    }

    return state.keyedWorkspaces[record.workspaceKey]?.activeRunId !== record.runId;
  }

  function isLaunchableQueuedRun(record: ActiveWorkflowRunRecord): boolean {
    return record.status === "queued" && !isPendingKeyedRun(record);
  }

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

function hasTerminalListeners(listeners: WorkflowContextTerminalListeners): boolean {
  return listeners.completed.length > 0 || listeners.error.length > 0;
}

function cloneTerminalListeners(listeners: WorkflowContextTerminalListeners): WorkflowContextTerminalListeners {
  return {
    completed: [...listeners.completed],
    error: [...listeners.error]
  };
}

function mergeTerminalListeners(
  current: WorkflowContextTerminalListeners,
  next: WorkflowContextTerminalListeners
): WorkflowContextTerminalListeners {
  return {
    completed: [...current.completed, ...next.completed],
    error: [...current.error, ...next.error]
  };
}

function removeTerminalListeners(
  current: WorkflowContextTerminalListeners,
  listenersToRemove: WorkflowContextTerminalListeners
): WorkflowContextTerminalListeners {
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
