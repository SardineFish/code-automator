import type { WorkspaceRepo } from "../../repo/workspace/workspace-repo.js";
import type { ProcessRunner } from "../../providers/process/process-runner.js";
import type { ServiceConfig } from "../../types/config.js";
import type { LogSink, OrchestrationResult, SubmittedTrigger } from "../../types/runtime.js";
import type { WorkflowTracker } from "../tracking/workflow-tracker.js";
import { executeWorkflow, prepareWorkspace } from "../execution/execute-workflow.js";
import { renderWorkflowPrompt } from "../template/render-workflow-template.js";
import { selectWorkflow } from "../workflow/select-workflow.js";

export interface ProcessTriggerSubmissionOptions {
  config: ServiceConfig;
  source: string;
  triggers: SubmittedTrigger[];
  processRunner: ProcessRunner;
  workspaceRepo: WorkspaceRepo;
  workflowTracker: WorkflowTracker;
  logSink?: LogSink;
  baseEnv?: NodeJS.ProcessEnv;
}

export async function processTriggerSubmission(
  options: ProcessTriggerSubmissionOptions
): Promise<OrchestrationResult> {
  if (options.triggers.length === 0) {
    return { status: "ignored", reason: "no_triggers_submitted" };
  }

  const selected = selectWorkflow(
    options.config.workflow,
    options.triggers.map((trigger) => trigger.name)
  );
  if (!selected) {
    return { status: "ignored", reason: "no_matching_workflow" };
  }

  const matchedTrigger = options.triggers.find((trigger) => trigger.name === selected.matchedTrigger);
  if (!matchedTrigger) {
    return { status: "failed", reason: "matched_trigger_payload_missing" };
  }

  const queuedRun = await options.workflowTracker.createQueuedRun(
    {
      source: options.source,
      workflowName: selected.workflow.name,
      matchedTrigger: selected.matchedTrigger,
      executorName: selected.workflow.use
    },
    ""
  );

  try {
    const prompt = renderWorkflowPrompt(selected.workflow.prompt, { in: matchedTrigger.input });
    void continueWorkflowLaunch(options, selected.workflow.use, prompt, matchedTrigger.env, queuedRun);

    return {
      status: "matched",
      reason: "queued",
      runId: queuedRun.runId,
      workflowName: selected.workflow.name,
      matchedTrigger: selected.matchedTrigger,
      executorName: selected.workflow.use,
      executionStatus: "queued"
    };
  } catch (error) {
    await options.workflowTracker.markTerminal(queuedRun.runId, "error", {
      errorMessage: error instanceof Error ? error.message : "Unknown orchestration error."
    });

    return {
      status: "failed",
      reason: "launch_failed",
      runId: queuedRun.runId,
      workflowName: selected.workflow.name,
      matchedTrigger: selected.matchedTrigger,
      executorName: selected.workflow.use,
      errorMessage: error instanceof Error ? error.message : "Unknown orchestration error."
    };
  }
}

async function continueWorkflowLaunch(
  options: ProcessTriggerSubmissionOptions,
  executorName: string,
  prompt: string,
  triggerEnv: Record<string, string>,
  queuedRun: Awaited<ReturnType<WorkflowTracker["createQueuedRun"]>>
): Promise<void> {
  let execution:
    | {
        pid: number;
        command: string;
        startedAt: string;
        workspacePath: string;
      }
    | undefined;

  try {
    const workspacePath = await prepareWorkspace({
      config: options.config,
      executorName,
      prompt,
      artifacts: queuedRun.artifacts,
      triggerEnv,
      workspaceRepo: options.workspaceRepo,
      processRunner: options.processRunner,
      baseEnv: options.baseEnv
    });
    await options.workflowTracker.updateQueuedRun(queuedRun.runId, { workspacePath });
    execution = await executeWorkflow({
      config: options.config,
      executorName,
      prompt,
      artifacts: queuedRun.artifacts,
      triggerEnv,
      workspacePath,
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
  } catch (error) {
    if (execution) {
      options.logSink?.error?.({
        timestamp: new Date().toISOString(),
        level: "error",
        message: "workflow launch state persistence failed after process start",
        runId: queuedRun.runId,
        pid: execution.pid,
        errorMessage: error instanceof Error ? error.message : "Unknown workflow launch error."
      });
      return;
    }

    try {
      await options.workflowTracker.markTerminal(queuedRun.runId, "error", {
        errorMessage: error instanceof Error ? error.message : "Unknown workflow launch error."
      });
    } catch {
      return;
    }
  }
}
