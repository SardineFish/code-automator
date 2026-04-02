import type { WorkflowRunContext } from "../../types/tracking.js";

export function extractWorkflowRunContext(input: Record<string, unknown>): Partial<WorkflowRunContext> {
  return {
    deliveryId: readString(input.deliveryId),
    eventName: readString(input.event),
    repoFullName: readString(input.repo),
    actorLogin: readString(input.user),
    installationId: readInteger(input.installationId)
  };
}

export function extractTriggerLogContext(input: Record<string, unknown>): Record<string, unknown> {
  const context = extractWorkflowRunContext(input);

  return {
    deliveryId: context.deliveryId,
    eventName: context.eventName,
    repo: context.repoFullName,
    actorLogin: context.actorLogin,
    installationId: context.installationId
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
