import type { WorkflowRunContext, WorkflowRunReactionTarget } from "../../types/tracking.js";

export function extractWorkflowRunContext(input: Record<string, unknown>): Partial<WorkflowRunContext> {
  return {
    deliveryId: readString(input.deliveryId),
    eventName: readString(input.event),
    repoFullName: readString(input.repo),
    actorLogin: readString(input.user),
    installationId: readInteger(input.installationId),
    reactionTarget: readReactionTarget(input)
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

function readReactionTarget(input: Record<string, unknown>): WorkflowRunReactionTarget | undefined {
  const kind = readReactionKind(input.githubReactionKind);
  const subjectId = readInteger(input.githubReactionSubjectId);

  if (!kind || subjectId === undefined) {
    return undefined;
  }

  if (kind === "pull_request_review") {
    const nodeId = readString(input.githubReactionNodeId);
    return nodeId ? { kind, subjectId, nodeId } : undefined;
  }

  return { kind, subjectId };
}

function readReactionKind(value: unknown): WorkflowRunReactionTarget["kind"] | undefined {
  return value === "issue" ||
    value === "issue_comment" ||
    value === "pull_request_review" ||
    value === "pull_request_review_comment"
    ? value
    : undefined;
}
