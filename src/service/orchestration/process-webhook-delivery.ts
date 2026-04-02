import type { WorkspaceRepo } from "../../repo/workspace/workspace-repo.js";
import type { ProcessRunner } from "../../providers/process/process-runner.js";
import type { InstallationTokenProvider } from "../github/create-installation-token-provider.js";
import { executeWorkflow, prepareWorkspace } from "../execution/execute-workflow.js";
import { normalizeWebhookEvent } from "../normalize/normalize-webhook-event.js";
import { renderWorkflowPrompt } from "../template/render-workflow-template.js";
import type { WorkflowTracker } from "../tracking/workflow-tracker.js";
import { selectWorkflow } from "../workflow/select-workflow.js";
import type { ServiceConfig } from "../../types/config.js";
import type { DeliveryContext, LogSink, OrchestrationResult } from "../../types/runtime.js";

export interface ProcessWebhookDeliveryOptions extends DeliveryContext {
  config: ServiceConfig;
  processRunner: ProcessRunner;
  workspaceRepo: WorkspaceRepo;
  installationTokenProvider: InstallationTokenProvider;
  workflowTracker: WorkflowTracker;
  logSink?: LogSink;
  baseEnv?: NodeJS.ProcessEnv;
}

export async function processWebhookDelivery(
  options: ProcessWebhookDeliveryOptions
): Promise<OrchestrationResult> {
  const normalized = normalizeWebhookEvent({
    eventName: options.eventName,
    deliveryId: options.deliveryId,
    payload: options.payload,
    botHandle: options.config.botHandle
  });

  if (!normalized) {
    return { status: "ignored", reason: "unsupported_event" };
  }

  const selected = selectWorkflow(options.config.workflow, normalized.candidateTriggers);
  if (!selected) {
    return { status: "ignored", reason: "no_matching_workflow" };
  }

  const queuedRun = await options.workflowTracker.createQueuedRun(
    {
      deliveryId: options.deliveryId,
      eventName: options.eventName,
      workflowName: selected.workflow.name,
      matchedTrigger: selected.matchedTrigger,
      executorName: selected.workflow.use,
      repoFullName: normalized.input.repo,
      actorLogin: normalized.input.actorLogin,
      installationId: normalized.input.installation.id
    },
    ""
  );

  try {
    const prompt = renderWorkflowPrompt(selected.workflow.prompt, {
      in: {
        ...normalized.input,
        event: { ...normalized.input.event, matchedTrigger: selected.matchedTrigger }
      }
    });
    void continueWorkflowLaunch(options, normalized.input.installation.id, selected.workflow.use, prompt, queuedRun);

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
  options: ProcessWebhookDeliveryOptions,
  installationId: number,
  executorName: string,
  prompt: string,
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
    const installationToken = await options.installationTokenProvider.createInstallationToken(
      options.config.clientId,
      installationId
    );
    const workspacePath = await prepareWorkspace({
      config: options.config,
      executorName,
      prompt,
      artifacts: queuedRun.artifacts,
      installationToken,
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
      installationToken,
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
