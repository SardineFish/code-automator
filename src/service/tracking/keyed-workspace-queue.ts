import type { KeyedWorkspaceQueueRecord, WorkflowTrackerState } from "../../types/tracking.js";

export function reserveKeyedWorkspaceRun(
  keyedWorkspaces: WorkflowTrackerState["keyedWorkspaces"],
  workspaceKey: string,
  runId: string
): boolean {
  const queue = keyedWorkspaces[workspaceKey] ?? { pendingRunIds: [] };

  if (!queue.activeRunId) {
    queue.activeRunId = runId;
    keyedWorkspaces[workspaceKey] = queue;
    return true;
  }

  queue.pendingRunIds.push(runId);
  keyedWorkspaces[workspaceKey] = queue;
  return false;
}

export function releaseKeyedWorkspaceRun(
  keyedWorkspaces: WorkflowTrackerState["keyedWorkspaces"],
  workspaceKey: string,
  runId: string
): string | undefined {
  const queue = keyedWorkspaces[workspaceKey];

  if (!queue) {
    return undefined;
  }

  let nextRunId: string | undefined;

  if (queue.activeRunId === runId) {
    nextRunId = queue.pendingRunIds.shift();
    queue.activeRunId = nextRunId;
  } else {
    queue.pendingRunIds = queue.pendingRunIds.filter((pendingRunId) => pendingRunId !== runId);
  }

  cleanupEmptyWorkspaceQueue(keyedWorkspaces, workspaceKey, queue);
  return nextRunId;
}

function cleanupEmptyWorkspaceQueue(
  keyedWorkspaces: WorkflowTrackerState["keyedWorkspaces"],
  workspaceKey: string,
  queue: KeyedWorkspaceQueueRecord
): void {
  if (!queue.activeRunId && queue.pendingRunIds.length === 0) {
    delete keyedWorkspaces[workspaceKey];
    return;
  }

  keyedWorkspaces[workspaceKey] = queue;
}
