import type { ServiceConfig } from "../types/config.js";
import type {
  WorkflowContext,
  WorkflowContextTerminalEventName,
  WorkflowContextTerminalListener,
  WorkflowContextTerminalListeners,
  TriggerSubmissionInput
} from "../types/runtime.js";
import { processTriggerSubmission } from "../service/orchestration/process-trigger-submission.js";
import type { AppRuntimeOptions } from "./default-app-runtime.js";

export function createWorkflowContext(
  routePath: string,
  config: ServiceConfig,
  runtime: AppRuntimeOptions
): WorkflowContext {
  let submitted = false;
  const triggers = new Map<string, { input: Record<string, unknown>; env: Record<string, string> }>();
  const terminalListeners: WorkflowContextTerminalListeners = {
    completed: [],
    error: []
  };
  const log = runtime.logSink.child({ source: routePath });

  return {
    config,
    extensionConfig: undefined,
    env: runtime.baseEnv,
    log,
    trigger(name, payload) {
      assertTriggerName(name);
      assertTriggerPayload(payload);
      if (submitted) {
        throw new Error("Cannot register triggers after submit().");
      }
      if (triggers.has(name)) {
        throw new Error(`Duplicate trigger '${name}' in one request is not allowed.`);
      }

      triggers.set(name, {
        input: payload.in,
        env: payload.env ?? {}
      });
    },
    on(eventName, listener) {
      assertTerminalEventName(eventName);
      if (submitted) {
        throw new Error("Cannot register terminal listeners after submit().");
      }

      const eventListeners = terminalListeners[eventName] as WorkflowContextTerminalListener<
        typeof eventName
      >[];
      eventListeners.push(listener);

      return () => {
        const index = eventListeners.indexOf(listener);
        if (index !== -1) {
          eventListeners.splice(index, 1);
        }
      };
    },
    submit() {
      if (submitted) {
        throw new Error("submit() may only be called once per request.");
      }
      submitted = true;

      return processTriggerSubmission({
        config,
        source: routePath,
        triggers: [...triggers.entries()].map(([name, trigger]) => ({
          name,
          input: trigger.input,
          env: trigger.env
        })),
        processRunner: runtime.processRunner,
        workspaceRepo: runtime.workspaceRepo,
        workflowTracker: runtime.workflowTracker,
        logSink: log,
        baseEnv: runtime.baseEnv,
        terminalListeners: cloneTerminalListeners(terminalListeners)
      });
    }
  };
}

function assertTriggerName(value: string): void {
  if (value.trim() === "") {
    throw new Error("Trigger name must be a non-empty string.");
  }
}

function assertTriggerPayload(payload: TriggerSubmissionInput): void {
  if (!isPlainObject(payload.in)) {
    throw new Error("Trigger input must be a plain object.");
  }
  if (payload.env && !isStringMap(payload.env)) {
    throw new Error("Trigger env must be a string-to-string map.");
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringMap(value: unknown): value is Record<string, string> {
  return isPlainObject(value) && Object.values(value).every((entry) => typeof entry === "string");
}

function assertTerminalEventName(value: string): asserts value is WorkflowContextTerminalEventName {
  if (value !== "completed" && value !== "error") {
    throw new Error(`Unsupported terminal event '${value}'.`);
  }
}

function cloneTerminalListeners(listeners: WorkflowContextTerminalListeners): WorkflowContextTerminalListeners {
  return {
    completed: [...listeners.completed],
    error: [...listeners.error]
  };
}
