import type { WorkspaceRepo } from "../../repo/workspace/workspace-repo.js";
import type { ProcessRunner } from "../../providers/process/process-runner.js";
import { executeWorkflow } from "../execution/execute-workflow.js";
import { normalizeWebhookEvent } from "../normalize/normalize-webhook-event.js";
import { renderWorkflowPrompt } from "../template/render-workflow-template.js";
import { selectWorkflow } from "../workflow/select-workflow.js";
import type { ServiceConfig } from "../../types/config.js";
import type { DeliveryContext, OrchestrationResult } from "../../types/runtime.js";

export interface ProcessWebhookDeliveryOptions extends DeliveryContext {
  config: ServiceConfig;
  processRunner: ProcessRunner;
  workspaceRepo: WorkspaceRepo;
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

  try {
    const prompt = renderWorkflowPrompt(selected.workflow.prompt, {
      in: {
        ...normalized.input,
        event: { ...normalized.input.event, matchedTrigger: selected.matchedTrigger }
      }
    });
    const execution = await executeWorkflow({
      config: options.config,
      executorName: selected.workflow.use,
      prompt,
      workspaceRepo: options.workspaceRepo,
      processRunner: options.processRunner,
      baseEnv: options.baseEnv
    });

    return {
      status: execution.status === "success" ? "matched" : "failed",
      reason: execution.status === "success" ? "executed" : "execution_failed",
      workflowName: selected.workflow.name,
      matchedTrigger: selected.matchedTrigger,
      executorName: execution.executorName,
      command: execution.command,
      executionStatus: execution.status,
      errorMessage: execution.errorMessage
    };
  } catch (error) {
    return {
      status: "failed",
      reason: "render_failed",
      workflowName: selected.workflow.name,
      matchedTrigger: selected.matchedTrigger,
      executorName: selected.workflow.use,
      errorMessage: error instanceof Error ? error.message : "Unknown orchestration error."
    };
  }
}
