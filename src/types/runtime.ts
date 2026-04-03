import type { TriggerKey } from "./triggers.js";
import type { ServiceConfig, WorkflowDefinition } from "./config.js";
import type { LogSink } from "./logging.js";
import type { WorkflowRunReactionTarget, WorkflowRunStatus } from "./tracking.js";

export interface WebhookGateContext {
  repoFullName: string;
  actorLogin: string;
  installationId: number;
}

export interface SelectedWorkflow {
  matchedTrigger: TriggerKey;
  workflow: WorkflowDefinition;
}

export type OrchestrationStatus = "ignored" | "matched" | "failed";
export type WorkflowTerminalErrorStatus = Exclude<WorkflowRunStatus, "queued" | "running" | "succeeded">;

export interface WorkflowCompletedEventPayload {
  runId: string;
  workflowName: string;
  matchedTrigger: TriggerKey;
  executorName: string;
  completedAt: string;
  status: "succeeded";
  repoFullName?: string;
  installationId?: number;
  reactionTarget?: WorkflowRunReactionTarget;
}

export interface WorkflowErrorEventPayload {
  runId: string;
  workflowName: string;
  matchedTrigger: TriggerKey;
  executorName: string;
  completedAt: string;
  status: WorkflowTerminalErrorStatus;
  error: Error;
  repoFullName?: string;
  installationId?: number;
  reactionTarget?: WorkflowRunReactionTarget;
}

export interface AppContextTerminalEventMap {
  completed: WorkflowCompletedEventPayload;
  error: WorkflowErrorEventPayload;
}

export type AppContextTerminalEventName = keyof AppContextTerminalEventMap;
export type AppContextTerminalListener<T extends AppContextTerminalEventName> = (
  event: AppContextTerminalEventMap[T]
) => void | Promise<void>;

export interface AppContextTerminalListeners {
  completed: AppContextTerminalListener<"completed">[];
  error: AppContextTerminalListener<"error">[];
}

export interface OrchestrationResult {
  status: OrchestrationStatus;
  reason: string;
  runId?: string;
  pid?: number;
  workflowName?: string;
  matchedTrigger?: TriggerKey;
  executorName?: string;
  command?: string;
  executionStatus?: WorkflowRunStatus;
  errorMessage?: string;
}

export interface TriggerSubmissionInput {
  in: Record<string, unknown>;
  env?: Record<string, string>;
}

export interface SubmittedTrigger {
  name: TriggerKey;
  input: Record<string, unknown>;
  env: Record<string, string>;
}

export interface AppContext {
  config: ServiceConfig;
  env: NodeJS.ProcessEnv;
  log: LogSink;
  trigger(name: TriggerKey, payload: TriggerSubmissionInput): void;
  on<T extends AppContextTerminalEventName>(
    eventName: T,
    listener: AppContextTerminalListener<T>
  ): () => void;
  submit(): Promise<OrchestrationResult>;
}
