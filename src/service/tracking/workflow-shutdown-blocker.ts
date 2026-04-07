import type { ActiveWorkflowRunRecord } from "../../types/tracking.js";

export type WorkflowShutdownBlocker = Pick<
  ActiveWorkflowRunRecord,
  "executorName" | "repoFullName" | "runId" | "workflowName"
>;

export function compareWorkflowShutdownBlockers(
  left: WorkflowShutdownBlocker,
  right: WorkflowShutdownBlocker
): number {
  return formatWorkflowShutdownBlocker(left).localeCompare(formatWorkflowShutdownBlocker(right));
}

export function formatWorkflowShutdownBlocker(blocker: WorkflowShutdownBlocker): string {
  return [
    blocker.workflowName,
    `via ${blocker.executorName}`,
    blocker.repoFullName ? `for ${blocker.repoFullName}` : undefined,
    `(${blocker.runId})`
  ]
    .filter((part): part is string => part !== undefined)
    .join(" ");
}
