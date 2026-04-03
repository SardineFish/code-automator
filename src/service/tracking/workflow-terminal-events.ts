import type { LogSink } from "../../types/logging.js";
import type { AppContextTerminalListeners, AppContextTerminalEventMap } from "../../types/runtime.js";
import type { CompletedWorkflowRunRecord } from "../../types/tracking.js";

export type WorkflowTerminalEvent =
  | { name: "completed"; payload: AppContextTerminalEventMap["completed"] }
  | { name: "error"; payload: AppContextTerminalEventMap["error"] };

export function buildWorkflowTerminalEvent(
  record: CompletedWorkflowRunRecord
): WorkflowTerminalEvent | undefined {
  if (record.status === "succeeded") {
    return {
      name: "completed",
      payload: {
        runId: record.runId,
        workflowName: record.workflowName,
        matchedTrigger: record.matchedTrigger,
        executorName: record.executorName,
        completedAt: record.completedAt,
        status: "succeeded"
      }
    };
  }

  if (record.status === "failed" || record.status === "error" || record.status === "lost") {
    return {
      name: "error",
      payload: {
        runId: record.runId,
        workflowName: record.workflowName,
        matchedTrigger: record.matchedTrigger,
        executorName: record.executorName,
        completedAt: record.completedAt,
        status: record.status,
        error: new Error(resolveWorkflowTerminalErrorMessage(record))
      }
    };
  }

  return undefined;
}

export function emitWorkflowTerminalEvent(
  logSink: LogSink,
  runId: string,
  listeners: AppContextTerminalListeners,
  event: WorkflowTerminalEvent
): void {
  if (event.name === "completed") {
    for (const listener of listeners.completed) {
      invokeCompletedListener(logSink, runId, listener, event.payload);
    }
    return;
  }

  for (const listener of listeners.error) {
    invokeErrorListener(logSink, runId, listener, event.payload);
  }
}

function invokeCompletedListener(
  logSink: LogSink,
  runId: string,
  listener: AppContextTerminalListeners["completed"][number],
  payload: AppContextTerminalEventMap["completed"]
): void {
  void Promise.resolve()
    .then(() => listener(payload))
    .catch((error) => {
      logSink.warn({
        message: "workflow terminal listener failed",
        runId,
        errorMessage: error instanceof Error ? error.message : "Unknown terminal listener error."
      });
    });
}

function invokeErrorListener(
  logSink: LogSink,
  runId: string,
  listener: AppContextTerminalListeners["error"][number],
  payload: AppContextTerminalEventMap["error"]
): void {
  void Promise.resolve()
    .then(() => listener(payload))
    .catch((error) => {
      logSink.warn({
        message: "workflow terminal listener failed",
        runId,
        errorMessage: error instanceof Error ? error.message : "Unknown terminal listener error."
      });
    });
}

function resolveWorkflowTerminalErrorMessage(record: CompletedWorkflowRunRecord): string {
  if (record.errorMessage && record.errorMessage.trim() !== "") {
    return record.errorMessage;
  }

  const process = record.process;
  if (process) {
    const details: string[] = [];

    if (process.timedOut) {
      details.push("timed out");
    }
    if (process.exitCode !== null && process.exitCode !== 0) {
      details.push(`exited with code ${process.exitCode}`);
    }
    if (process.signal) {
      details.push(`was terminated by signal ${process.signal}`);
    }

    if (details.length > 0) {
      return `Workflow ${details.join(" and ")}.`;
    }
  }

  return `Workflow completed with terminal status '${record.status}'.`;
}
