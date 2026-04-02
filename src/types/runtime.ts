import type { TriggerKey } from "./triggers.js";
import type { ServiceConfig, WorkflowDefinition } from "./config.js";
import type { WorkflowRunStatus } from "./tracking.js";
import type { WorkflowTemplateInput } from "./workflow-input.js";

export interface WebhookGateContext {
  repoFullName: string;
  actorLogin: string;
  installationId: number;
}

export interface NormalizedWebhookEvent {
  deliveryId?: string;
  eventName: string;
  action?: string;
  candidateTriggers: TriggerKey[];
  input: WorkflowTemplateInput;
  gate: WebhookGateContext;
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
  trigger(name: TriggerKey, payload: TriggerSubmissionInput): void;
  submit(): Promise<OrchestrationResult>;
}

export interface DeliveryContext {
  deliveryId?: string;
  eventName: string;
  payload: unknown;
}
