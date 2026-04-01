import type { ExecutorTemplateVariables, WorkflowPromptTemplateVariables } from "../../types/template.js";
import { renderTemplate } from "./render-template.js";

export function renderWorkflowPrompt(
  template: string,
  variables: WorkflowPromptTemplateVariables
): string {
  return renderTemplate(template, variables);
}

export function renderExecutorCommand(
  template: string,
  variables: ExecutorTemplateVariables
): string {
  return renderTemplate(template, variables);
}
