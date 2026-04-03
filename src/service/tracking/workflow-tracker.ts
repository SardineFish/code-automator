import type { WorkspaceConfig } from "../../types/config.js";
import type { ProcessRunResult } from "../../types/execution.js";
import type { AppContextTerminalListeners } from "../../types/runtime.js";
import type {
  ActiveWorkflowRunRecord,
  CompletedWorkflowRunRecord,
  WorkflowRunContext
} from "../../types/tracking.js";
import type { ProcessRunner } from "../../providers/process/process-runner.js";
import type { WorkspaceRepo } from "../../repo/workspace/workspace-repo.js";

export interface WorkflowTracker {
  initialize(): Promise<void>;
  createQueuedRun(context: WorkflowRunContext, workspacePath: string): Promise<ActiveWorkflowRunRecord>;
  subscribeTerminalEvents(runId: string, listeners: AppContextTerminalListeners): () => void;
  updateQueuedRun(runId: string, details: { workspacePath: string }): Promise<ActiveWorkflowRunRecord>;
  getActiveRunCount(): Promise<number>;
  markRunning(
    runId: string,
    details: { pid: number; command: string; startedAt: string; workspacePath: string }
  ): Promise<ActiveWorkflowRunRecord>;
  markTerminal(
    runId: string,
    status: CompletedWorkflowRunRecord["status"],
    details: { process?: ProcessRunResult; errorMessage?: string; completedAt?: string }
  ): Promise<CompletedWorkflowRunRecord | null>;
  reconcileActiveRuns(processRunner: ProcessRunner, workspaceRepo: WorkspaceRepo, workspace: WorkspaceConfig): Promise<void>;
}
