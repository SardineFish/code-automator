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
  submit(): Promise<OrchestrationResult>;
}
