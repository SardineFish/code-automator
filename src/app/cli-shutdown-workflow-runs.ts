import type { ActiveWorkflowRunRecord } from "../types/tracking.js";
import {
  compareWorkflowShutdownBlockers,
  formatWorkflowShutdownBlocker
} from "../service/tracking/workflow-shutdown-blocker.js";
import type { WorkflowTracker } from "../service/tracking/workflow-tracker.js";

export const WAITING_FOR_WORKFLOW_RUN_DURING_SHUTDOWN_PREFIX =
  "Waiting for workflow run during shutdown:";
export const WORKFLOW_RUN_SETTLED_DURING_SHUTDOWN_PREFIX =
  "Workflow run settled during shutdown:";

export async function waitForActiveRunsToDrain(
  workflowTracker: Pick<WorkflowTracker, "getActiveRuns">,
  pollIntervalMs: number,
  sleep: (ms: number) => Promise<void>,
  writeLine: (line: string) => void
): Promise<void> {
  let previousRuns = new Map<string, ActiveWorkflowRunRecord>();

  while (true) {
    const activeRuns = await workflowTracker.getActiveRuns();
    const nextRuns = new Map(activeRuns.map((run) => [run.runId, run]));

    if (previousRuns.size === 0) {
      logWaitingRuns(activeRuns, writeLine);
    } else {
      logSettledRuns(previousRuns, nextRuns, writeLine);
      logWaitingRuns(
        activeRuns.filter((run) => !previousRuns.has(run.runId)),
        writeLine
      );
    }

    if (nextRuns.size === 0) {
      return;
    }

    previousRuns = nextRuns;
    await sleep(pollIntervalMs);
  }
}

function logSettledRuns(
  previousRuns: Map<string, ActiveWorkflowRunRecord>,
  nextRuns: Map<string, ActiveWorkflowRunRecord>,
  writeLine: (line: string) => void
): void {
  const settledRuns = [...previousRuns.values()]
    .filter((run) => !nextRuns.has(run.runId))
    .sort(compareWorkflowShutdownBlockers);

  for (const run of settledRuns) {
    writeLine(`${WORKFLOW_RUN_SETTLED_DURING_SHUTDOWN_PREFIX} ${formatWorkflowShutdownBlocker(run)}`);
  }
}

function logWaitingRuns(runs: ActiveWorkflowRunRecord[], writeLine: (line: string) => void): void {
  for (const run of [...runs].sort(compareWorkflowShutdownBlockers)) {
    writeLine(`${WAITING_FOR_WORKFLOW_RUN_DURING_SHUTDOWN_PREFIX} ${formatWorkflowShutdownBlocker(run)}`);
  }
}
