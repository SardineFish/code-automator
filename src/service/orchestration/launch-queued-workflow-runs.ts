import type { ProcessRunner } from "../../providers/process/process-runner.js";
import type { WorkspaceRepo } from "../../repo/workspace/workspace-repo.js";
import { clipLogPreview } from "../logging/log-preview.js";
import type { ServiceConfig } from "../../types/config.js";
import type { LogSink } from "../../types/logging.js";
import type { ActiveWorkflowRunRecord } from "../../types/tracking.js";
import type { WorkflowTracker } from "../tracking/workflow-tracker.js";
import { executeWorkflow, prepareWorkspace } from "../execution/execute-workflow.js";

export interface LaunchQueuedWorkflowRunsOptions {
  config: ServiceConfig;
  processRunner: ProcessRunner;
  workspaceRepo: WorkspaceRepo;
  workflowTracker: WorkflowTracker;
  logSink?: LogSink;
  baseEnv?: NodeJS.ProcessEnv;
}

export function launchQueuedWorkflowRuns(
  options: LaunchQueuedWorkflowRunsOptions,
  queuedRuns: ActiveWorkflowRunRecord[]
): void {
  for (const queuedRun of queuedRuns) {
    void launchQueuedWorkflowRun(options, queuedRun);
  }
}

async function launchQueuedWorkflowRun(
  options: LaunchQueuedWorkflowRunsOptions,
  queuedRun: ActiveWorkflowRunRecord
): Promise<void> {
  const runLog = options.logSink?.child({
    runId: queuedRun.runId,
    workflowName: queuedRun.workflowName,
    matchedTrigger: queuedRun.matchedTrigger,
    executorName: queuedRun.executorName
  });
  const launch = queuedRun.launch;

  if (!launch) {
    await markQueuedRunError(options, queuedRun, runLog, "Queued workflow run is missing launch data.");
    return;
  }

  let workspacePath = queuedRun.workspacePath;
  let execution:
    | {
        pid: number;
        command: string;
        startedAt: string;
        workspacePath: string;
      }
    | undefined;

  try {
    workspacePath = await prepareWorkspace({
      config: options.config,
      executorName: queuedRun.executorName,
      prompt: launch.prompt,
      artifacts: queuedRun.artifacts,
      triggerEnv: launch.triggerEnv,
      workspacePath: queuedRun.workspacePath || undefined,
      workspaceKey: queuedRun.workspaceKey,
      workspaceRepo: options.workspaceRepo,
      processRunner: options.processRunner,
      baseEnv: options.baseEnv
    });
    await options.workflowTracker.updateQueuedRun(queuedRun.runId, { workspacePath });
    execution = await executeWorkflow({
      config: options.config,
      executorName: queuedRun.executorName,
      prompt: launch.prompt,
      artifacts: queuedRun.artifacts,
      triggerEnv: launch.triggerEnv,
      workspacePath,
      workspaceKey: queuedRun.workspaceKey,
      workspaceRepo: options.workspaceRepo,
      processRunner: options.processRunner,
      baseEnv: options.baseEnv
    });

    await options.workflowTracker.markRunning(queuedRun.runId, {
      pid: execution.pid,
      command: execution.command,
      startedAt: execution.startedAt,
      workspacePath: execution.workspacePath
    });
    runLog?.info({
      message: "workflow launch started",
      pid: execution.pid,
      workspacePath: execution.workspacePath,
      workspaceKey: queuedRun.workspaceKey
    });
    if (runLog?.isLevelEnabled("debug")) {
      runLog.debug({
        message: "workflow launch command",
        commandPreview: clipLogPreview(execution.command)
      });
    }
  } catch (error) {
    if (execution) {
      runLog?.error({
        message: "workflow launch state persistence failed after process start",
        pid: execution.pid,
        errorMessage: error instanceof Error ? error.message : "Unknown workflow launch error."
      });
      return;
    }

    await cleanupPreparedWorkspace(options, workspacePath, queuedRun.workspaceKey);
    await markQueuedRunError(
      options,
      queuedRun,
      runLog,
      error instanceof Error ? error.message : "Unknown workflow launch error."
    );
  }
}

async function markQueuedRunError(
  options: LaunchQueuedWorkflowRunsOptions,
  queuedRun: ActiveWorkflowRunRecord,
  runLog: LogSink | undefined,
  errorMessage: string
): Promise<void> {
  runLog?.error({
    message: "workflow launch failed",
    errorMessage
  });
  const transition = await options.workflowTracker.markTerminal(queuedRun.runId, "error", {
    errorMessage
  });
  launchQueuedWorkflowRuns(options, transition.releasedRuns);
}

async function cleanupPreparedWorkspace(
  options: LaunchQueuedWorkflowRunsOptions,
  workspacePath: string,
  workspaceKey: string | undefined
): Promise<void> {
  if (!options.config.workspace.cleanupAfterRun || workspacePath === "" || workspaceKey !== undefined) {
    return;
  }

  await options.workspaceRepo.removeWorkspace(workspacePath);
}
