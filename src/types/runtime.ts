import type { TriggerKey } from "./triggers.js";
import type { ServiceConfig, WorkflowDefinition } from "./config.js";
import type { LogSink } from "./logging.js";
import type { WorkflowRunStatus } from "./tracking.js";

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
}

export interface WorkflowErrorEventPayload {
  runId: string;
  workflowName: string;
  matchedTrigger: TriggerKey;
  executorName: string;
  completedAt: string;
  status: WorkflowTerminalErrorStatus;
  error: Error;
}

export interface WorkflowContextTerminalEventMap {
  completed: WorkflowCompletedEventPayload;
  error: WorkflowErrorEventPayload;
}

export type WorkflowContextTerminalEventName = keyof WorkflowContextTerminalEventMap;
export type WorkflowContextTerminalListener<T extends WorkflowContextTerminalEventName> = (
  event: WorkflowContextTerminalEventMap[T]
) => void | Promise<void>;

export interface WorkflowContextTerminalListeners {
  completed: WorkflowContextTerminalListener<"completed">[];
  error: WorkflowContextTerminalListener<"error">[];
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

export interface WorkflowContext {
  config: ServiceConfig;
  env: NodeJS.ProcessEnv;
  log: LogSink;
  trigger(name: TriggerKey, payload: TriggerSubmissionInput): void;
  on<T extends WorkflowContextTerminalEventName>(
    eventName: T,
    listener: WorkflowContextTerminalListener<T>
  ): () => void;
  submit(): Promise<OrchestrationResult>;
}

export type ProviderHandler<
  TArgs extends unknown[] = unknown[],
  TResult = unknown
> = (ctx: WorkflowContext, ...args: TArgs) => Promise<TResult>;

export type AnyProvider = ProviderHandler<any[], unknown>;

export type ProviderArgs<T extends AnyProvider> =
  T extends (ctx: WorkflowContext, ...args: infer A) => Promise<unknown>
    ? A
    : never;

export type ProviderResult<T extends AnyProvider> =
  T extends (ctx: WorkflowContext, ...args: unknown[]) => Promise<infer R>
    ? R
    : never;

export type AppJobScheduleMode = "skip" | "delay" | "overlap";

export interface AppJobIntervalOptions {
  mode?: AppJobScheduleMode;
  runImmediately?: boolean;
}

export interface AppContext {
  config: ServiceConfig;
  env: NodeJS.ProcessEnv;
  log: LogSink;
  createWorkflow(source: string): WorkflowContext;
  getProvider<T extends AnyProvider>(key: string): T;
  trackJob<TResult>(debugName: string, job: Promise<TResult>): Promise<TResult>;
  scheduleInterval(
    debugName: string,
    intervalMs: number,
    createJob: () => Promise<unknown>,
    options?: AppJobIntervalOptions
  ): () => void;
  scheduleDelay(
    debugName: string,
    delayMs: number,
    createJob: () => Promise<unknown>
  ): () => void;
  on(eventName: "shutdown", handler: () => Promise<void>): () => void;
}

export type AppServiceHandler = (app: AppContext) => Promise<void>;
