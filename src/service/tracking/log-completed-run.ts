import { readProcessOutputPreview } from "../logging/log-preview.js";
import type { LogSink, RuntimeLogLevel, RuntimeLogRecord } from "../../types/logging.js";
import type { CompletedWorkflowRunRecord } from "../../types/tracking.js";

export async function logCompletedRun(logSink: LogSink, record: CompletedWorkflowRunRecord): Promise<void> {
  const level = statusToLevel(record.status);

  emitLog(logSink, level, {
    message: "workflow run completed",
    runId: record.runId,
    workflowName: record.workflowName,
    matchedTrigger: record.matchedTrigger,
    executorName: record.executorName,
    status: record.status,
    pid: record.pid,
    source: record.source,
    deliveryId: record.deliveryId,
    eventName: record.eventName,
    repo: record.repoFullName,
    actorLogin: record.actorLogin,
    exitCode: record.process?.exitCode,
    signal: record.process?.signal,
    timedOut: record.process?.timedOut
  });

  if (logSink.isLevelEnabled("debug")) {
    const stdoutPreview = await readProcessOutputPreview(record.process, "stdout");

    if (stdoutPreview) {
      logSink.debug({
        message: "workflow stdout preview",
        runId: record.runId,
        workflowName: record.workflowName,
        matchedTrigger: record.matchedTrigger,
        executorName: record.executorName,
        stdoutPreview
      });
    }
  }

  if (record.status === "succeeded") {
    return;
  }

  const stderrPreview = await readProcessOutputPreview(record.process, "stderr");

  if (stderrPreview) {
    emitLog(logSink, level, {
      message: "workflow stderr preview",
      runId: record.runId,
      workflowName: record.workflowName,
      matchedTrigger: record.matchedTrigger,
      executorName: record.executorName,
      stderrPreview
    });
  }
}

function emitLog(logSink: LogSink, level: RuntimeLogLevel, record: RuntimeLogRecord): void {
  if (level === "debug") {
    logSink.debug(record);
    return;
  }
  if (level === "info") {
    logSink.info(record);
    return;
  }
  if (level === "warn") {
    logSink.warn(record);
    return;
  }

  logSink.error(record);
}

function statusToLevel(status: CompletedWorkflowRunRecord["status"]): RuntimeLogLevel {
  if (status === "succeeded") {
    return "info";
  }
  if (status === "failed" || status === "lost") {
    return "warn";
  }

  return "error";
}
