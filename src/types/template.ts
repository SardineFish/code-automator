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
  configDir: string;
  prompt: string;
  workspace: string;
  workspaceKey: string;
  env: Record<string, string>;
}

export type TemplateVariables = Record<string, unknown>;
