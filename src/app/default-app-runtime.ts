import { createConsoleLogSink } from "../providers/logging/winston-log-sink.js";
import { shellProcessRunner } from "../providers/process/process-runner.js";
import { fileWorkflowTrackerRepo } from "../repo/tracking/file-workflow-tracker-repo.js";
import { defaultWorkspaceRepo } from "../repo/workspace/workspace-repo.js";
import { createFileWorkflowTracker } from "../service/tracking/file-workflow-tracker.js";
import type { WorkspaceRepo } from "../repo/workspace/workspace-repo.js";
import type { WorkflowTracker } from "../service/tracking/workflow-tracker.js";
import type { ServiceConfig } from "../types/config.js";
import type { LogSink } from "../types/logging.js";
import type { ProcessRunner } from "../providers/process/process-runner.js";

const DEFAULT_RECONCILE_INTERVAL_MS = 2000;

export interface AppRuntimeOverrides {
  processRunner?: ProcessRunner;
  workspaceRepo?: WorkspaceRepo;
  workflowTracker?: WorkflowTracker;
  logSink?: LogSink;
  baseEnv?: NodeJS.ProcessEnv;
  reconcileIntervalMs?: number;
}

export interface AppRuntimeOptions {
  processRunner: ProcessRunner;
  workspaceRepo: WorkspaceRepo;
  workflowTracker: WorkflowTracker;
  logSink: LogSink;
  baseEnv: NodeJS.ProcessEnv;
  reconcileIntervalMs: number;
}

export function createAppRuntimeOptions(
  config: ServiceConfig,
  overrides: AppRuntimeOverrides = {}
): AppRuntimeOptions {
  const logSink = overrides.logSink ?? createConsoleLogSink(config.logging.level);

  return {
    processRunner: overrides.processRunner ?? shellProcessRunner,
    workspaceRepo: overrides.workspaceRepo ?? defaultWorkspaceRepo,
    workflowTracker:
      overrides.workflowTracker ??
      createFileWorkflowTracker(config.tracking, fileWorkflowTrackerRepo, logSink),
    logSink,
    baseEnv: overrides.baseEnv ?? process.env,
    reconcileIntervalMs: overrides.reconcileIntervalMs ?? DEFAULT_RECONCILE_INTERVAL_MS
  };
}

export async function initializeWorkflowTracking(
  config: ServiceConfig,
  options: AppRuntimeOptions
): Promise<void> {
  await options.workflowTracker.initialize();
  await options.workflowTracker.reconcileActiveRuns(
    options.processRunner,
    options.workspaceRepo,
    config.workspace
  );

  if (options.reconcileIntervalMs < 1) {
    return;
  }

  const reconcileTimer = setInterval(() => {
    void options.workflowTracker
      .reconcileActiveRuns(options.processRunner, options.workspaceRepo, config.workspace)
      .catch((error) => {
        options.logSink.error({
          message: "workflow reconciliation failed",
          errorMessage: error instanceof Error ? error.message : "Unknown reconciliation error."
        });
      });
  }, options.reconcileIntervalMs);

  reconcileTimer.unref();
}
