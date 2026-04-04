import type { WorkspaceRepo } from "../../repo/workspace/workspace-repo.js";
import type { ProcessRunner } from "../../providers/process/process-runner.js";
import type { LogSink } from "../../types/logging.js";
import type { ServiceConfig } from "../../types/config.js";
import type {
  WorkflowContextTerminalListeners,
  OrchestrationResult,
  SubmittedTrigger
} from "../../types/runtime.js";
import type { WorkflowTracker } from "../tracking/workflow-tracker.js";
import { renderExecutorWorkspaceKey } from "../execution/render-workspace-key.js";
import { extractTriggerLogContext, extractWorkflowRunContext } from "./trigger-log-context.js";
import { launchQueuedWorkflowRuns } from "./launch-queued-workflow-runs.js";
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
  terminalListeners?: WorkflowContextTerminalListeners;
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
  const prompt = renderWorkflowPrompt(selected.workflow.prompt, { in: matchedTrigger.input });
  const workspaceKey = renderExecutorWorkspaceKey(
    options.config,
    selected.workflow.use,
    matchedTrigger.input
  );
  const queued = await options.workflowTracker.createQueuedRun(
    {
      source: options.source,
      ...extractWorkflowRunContext(matchedTrigger.input),
      workflowName: selected.workflow.name,
      matchedTrigger: selected.matchedTrigger,
      executorName: selected.workflow.use
    },
    {
      workspacePath: "",
      workspaceKey,
      launch: {
        prompt,
        triggerEnv: matchedTrigger.env
      }
    }
  );
  const queuedRun = queued.record;
  const runLog = workflowLog?.child({ runId: queuedRun.runId });
  runLog?.info({
    message: "queued workflow run",
    workspaceKey
  });
  const terminalListeners = options.terminalListeners;
  if (terminalListeners && hasTerminalListeners(terminalListeners)) {
    options.workflowTracker.subscribeTerminalEvents(queuedRun.runId, terminalListeners);
  }

  try {
    if (queued.shouldLaunchNow) {
      launchQueuedWorkflowRuns(
        {
          config: options.config,
          processRunner: options.processRunner,
          workspaceRepo: options.workspaceRepo,
          workflowTracker: options.workflowTracker,
          logSink: runLog,
          baseEnv: options.baseEnv
        },
        [queuedRun]
      );
    }

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

function extractLogContext(triggers: SubmittedTrigger[]): Record<string, unknown> {
  const firstTrigger = triggers[0];

  return firstTrigger ? extractTriggerLogContext(firstTrigger.input) : {};
}

function hasTerminalListeners(listeners: WorkflowContextTerminalListeners | undefined): boolean {
  return (listeners?.completed.length ?? 0) > 0 || (listeners?.error.length ?? 0) > 0;
}
