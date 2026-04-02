import type { WorkflowRunContext } from "../../types/tracking.js";

export function extractWorkflowRunContext(input: Record<string, unknown>): Partial<WorkflowRunContext> {
  const event = readObject(input.event);
  const installation = readObject(input.installation);

  return {
    deliveryId: readString(input.deliveryId) ?? readString(event?.deliveryId),
    eventName: readString(input.eventName) ?? readString(event?.name),
    repoFullName: readString(input.repo),
    actorLogin: readString(input.actorLogin),
    installationId: readInteger(installation?.id)
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

function readObject(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function readInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}
