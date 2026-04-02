export type TemplateValue =
  | string
  | number
  | boolean
  | null
  | TemplateValue[]
  | { [key: string]: TemplateValue };

export interface WorkflowPromptTemplateVariables {
  in: object;
}

export interface ExecutorTemplateVariables {
  prompt: string;
  workspace: string;
}

export type TemplateVariables = Record<string, unknown>;
