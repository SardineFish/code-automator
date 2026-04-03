import type { WorkflowErrorEventPayload } from "../../types/runtime.js";

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
