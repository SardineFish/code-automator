import type { WorkflowErrorEventPayload } from "../../types/runtime.js";
import { readInteger, readObject } from "./github-utils.js";

export interface GitHubReportTarget {
  subjectId: number;
  kind: "issue" | "pull_request";
}

export function getReportTarget(
  eventName: string,
  issue: Record<string, unknown> | null,
  pullRequest: Record<string, unknown> | null
): GitHubReportTarget | undefined {
  if (eventName === "issues" || eventName === "issue_comment") {
    const subjectId = readInteger(issue ?? {}, "number");
    if (subjectId === undefined) {
      return undefined;
    }

    return {
      subjectId,
      kind: readObject(issue ?? {}, "pull_request") ? "pull_request" : "issue"
    };
  }

  if (eventName === "pull_request_review" || eventName === "pull_request_review_comment") {
    const subjectId = readInteger(pullRequest ?? {}, "number");
    if (subjectId === undefined) {
      return undefined;
    }

    return { subjectId, kind: "pull_request" };
  }

  return undefined;
}

export function formatRuntimeErrorComment(error: unknown): string {
  const fallback = error instanceof Error ? error.message : "Unknown GitHub provider error.";
  const details = error instanceof Error && error.stack ? error.stack : fallback;

  return [
    "Coding Automator hit a JavaScript runtime error while handling this webhook.",
    "",
    "```text",
    details,
    "```"
  ].join("\n");
}

export function formatWorkflowTerminalErrorComment(event: WorkflowErrorEventPayload): string {
  return [
    "Coding Automator queued this workflow, but it later finished with a terminal error.",
    "",
    `- Workflow: \`${event.workflowName}\``,
    `- Trigger: \`${event.matchedTrigger}\``,
    `- Executor: \`${event.executorName}\``,
    `- Run ID: \`${event.runId}\``,
    `- Status: \`${event.status}\``,
    `- Completed At: \`${event.completedAt}\``,
    "",
    "```text",
    event.error.message,
    "```"
  ].join("\n");
}
