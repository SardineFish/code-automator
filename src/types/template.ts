import type { WorkflowTemplateInput } from "./workflow-input.js";

export type TemplateValue =
  | string
  | number
  | boolean
  | null
  | TemplateValue[]
  | { [key: string]: TemplateValue };

export interface WorkflowPromptTemplateVariables {
  in: WorkflowTemplateInput;
}

export interface ExecutorTemplateVariables {
  prompt: string;
  workspace: string;
}

export type TemplateVariables = Record<string, unknown>;
