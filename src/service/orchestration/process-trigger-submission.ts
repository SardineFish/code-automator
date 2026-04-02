import type { WorkspaceRepo } from "../../repo/workspace/workspace-repo.js";
import type { ProcessRunner } from "../../providers/process/process-runner.js";
import { clipLogPreview } from "../logging/log-preview.js";
import type { LogSink } from "../../types/logging.js";
import type { ServiceConfig } from "../../types/config.js";
import type { OrchestrationResult, SubmittedTrigger } from "../../types/runtime.js";
import type { WorkflowTracker } from "../tracking/workflow-tracker.js";
import { executeWorkflow, prepareWorkspace } from "../execution/execute-workflow.js";
import { extractTriggerLogContext, extractWorkflowRunContext } from "./trigger-log-context.js";
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
  const requestLog = options.logSink?.child({
    ...extractLogContext(options.triggers),
    triggerCount: options.triggers.length
  });

  if (options.triggers.length === 0) {
    requestLog?.info({
      message: "ignored trigger submission",
      reason: "no_triggers_submitted"
    });
    return { status: "ignored", reason: "no_triggers_submitted" };
  }

  requestLog?.info({
    message: "evaluating submitted triggers",
    triggers: options.triggers.map((trigger) => trigger.name)
  });
  const selected = selectWorkflow(
    options.config.workflow,
    options.triggers.map((trigger) => trigger.name)
  );
  if (!selected) {
    requestLog?.info({
      message: "ignored trigger submission",
      reason: "no_matching_workflow",
      triggers: options.triggers.map((trigger) => trigger.name)
    });
    return { status: "ignored", reason: "no_matching_workflow" };
  }

  const matchedTrigger = options.triggers.find((trigger) => trigger.name === selected.matchedTrigger);
  if (!matchedTrigger) {
    requestLog?.error({
      message: "matched trigger payload missing",
      matchedTrigger: selected.matchedTrigger,
      triggers: options.triggers.map((trigger) => trigger.name)
    });
    return { status: "failed", reason: "matched_trigger_payload_missing" };
  }

  const workflowLog = requestLog?.child({
    workflowName: selected.workflow.name,
    matchedTrigger: selected.matchedTrigger,
    executorName: selected.workflow.use
  });
  workflowLog?.info({
    message: "selected workflow",
    triggers: options.triggers.map((trigger) => trigger.name)
  });
  const queuedRun = await options.workflowTracker.createQueuedRun(
    {
      source: options.source,
      ...extractWorkflowRunContext(matchedTrigger.input),
      workflowName: selected.workflow.name,
      matchedTrigger: selected.matchedTrigger,
      executorName: selected.workflow.use
    },
    ""
  );
  const runLog = workflowLog?.child({ runId: queuedRun.runId });
  runLog?.info({
    message: "queued workflow run"
  });

  try {
    const prompt = renderWorkflowPrompt(selected.workflow.prompt, { in: matchedTrigger.input });
    void continueWorkflowLaunch(
      options,
      runLog,
      selected.workflow.use,
      prompt,
      matchedTrigger.env,
      queuedRun
    );

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
    runLog?.error({
      message: "workflow launch failed",
      errorMessage: error instanceof Error ? error.message : "Unknown orchestration error."
    });
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
  logSink: LogSink | undefined,
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
    logSink?.info({
      message: "workflow launch started",
      pid: execution.pid,
      workspacePath: execution.workspacePath
    });
    if (logSink?.isLevelEnabled("debug")) {
      logSink.debug({
        message: "workflow launch command",
        commandPreview: clipLogPreview(execution.command)
      });
    }
  } catch (error) {
    if (execution) {
      logSink?.error({
        message: "workflow launch state persistence failed after process start",
        pid: execution.pid,
        errorMessage: error instanceof Error ? error.message : "Unknown workflow launch error."
      });
      return;
    }

    logSink?.error({
      message: "workflow launch failed",
      errorMessage: error instanceof Error ? error.message : "Unknown workflow launch error."
    });

    try {
      await options.workflowTracker.markTerminal(queuedRun.runId, "error", {
        errorMessage: error instanceof Error ? error.message : "Unknown workflow launch error."
      });
    } catch {
      return;
    }
  }
}

function extractLogContext(triggers: SubmittedTrigger[]): Record<string, unknown> {
  const firstTrigger = triggers[0];

  return firstTrigger ? extractTriggerLogContext(firstTrigger.input) : {};
}
