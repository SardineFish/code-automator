import type { ServiceConfig } from "../../types/config.js";
import { renderWorkflowPrompt } from "../template/render-workflow-template.js";
import { resolveExecutorWorkspace } from "./resolve-executor-workspace.js";

export function renderExecutorWorkspaceKey(
  config: ServiceConfig,
  executorName: string,
  input: Record<string, unknown>
): string | undefined {
  const keyTemplate = resolveExecutorWorkspace(config, executorName).key;

  if (!keyTemplate) {
    return undefined;
  }

  const renderedKey = renderWorkflowPrompt(keyTemplate, { in: input }).trim();

  if (renderedKey === "") {
    throw new Error(`Executor '${executorName}' workspace key rendered to an empty string.`);
  }

  return renderedKey;
}
