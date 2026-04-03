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

export interface WorkflowRunLaunchData {
  prompt: string;
  triggerEnv: Record<string, string>;
}

export interface WorkflowRunContext {
  source?: string;
  deliveryId?: string;
  eventName?: string;
  workflowName: string;
  matchedTrigger: TriggerKey;
  executorName: string;
  repoFullName?: string;
  actorLogin?: string;
  installationId?: number;
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
  workspaceKey?: string;
  launch?: WorkflowRunLaunchData;
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
  workspaceKey?: string;
  artifacts: WorkflowRunArtifacts;
  process?: ProcessRunResult;
  errorMessage?: string;
}

export interface KeyedWorkspaceQueueRecord {
  activeRunId?: string;
  pendingRunIds: string[];
}

export interface QueuedWorkflowRunTransition {
  record: ActiveWorkflowRunRecord;
  shouldLaunchNow: boolean;
}

export interface WorkflowTerminalTransition {
  completed: CompletedWorkflowRunRecord | null;
  releasedRuns: ActiveWorkflowRunRecord[];
}

export interface WorkflowTrackerState {
  version: 2;
  activeRuns: Record<string, ActiveWorkflowRunRecord>;
  keyedWorkspaces: Record<string, KeyedWorkspaceQueueRecord>;
}
