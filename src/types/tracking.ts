import type { TriggerKey } from "./triggers.js";
import type { ProcessRunResult } from "./execution.js";

export type WorkflowRunStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "error"
  | "lost";

export interface WorkflowRunArtifacts {
  runDir: string;
  wrapperScriptPath: string;
  pidFilePath: string;
  resultFilePath: string;
  stdoutPath: string;
  stderrPath: string;
}

export interface WorkflowRunContext {
  deliveryId?: string;
  eventName: string;
  workflowName: string;
  matchedTrigger: TriggerKey;
  executorName: string;
  repoFullName: string;
  actorLogin: string;
  installationId: number;
}

export interface ActiveWorkflowRunRecord extends WorkflowRunContext {
  runId: string;
  status: "queued" | "running";
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  pid?: number;
  command?: string;
  workspacePath: string;
  artifacts: WorkflowRunArtifacts;
  errorMessage?: string;
}

export interface CompletedWorkflowRunRecord extends WorkflowRunContext {
  runId: string;
  status: Exclude<WorkflowRunStatus, "queued" | "running">;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt: string;
  pid?: number;
  command?: string;
  workspacePath: string;
  artifacts: WorkflowRunArtifacts;
  process?: ProcessRunResult;
  errorMessage?: string;
}

export interface WorkflowTrackerState {
  version: 1;
  activeRuns: Record<string, ActiveWorkflowRunRecord>;
}
