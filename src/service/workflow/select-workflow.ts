import type { WorkflowDefinition } from "../../types/config.js";
import type { SelectedWorkflow } from "../../types/runtime.js";
import type { TriggerKey } from "../../types/triggers.js";

export function selectWorkflow(
  workflows: WorkflowDefinition[],
  candidateTriggers: TriggerKey[]
): SelectedWorkflow | null {
  const candidateSet = new Set(candidateTriggers);

  for (const workflow of workflows) {
    const matchedTrigger = workflow.on.find((trigger) => candidateSet.has(trigger));

    if (matchedTrigger) {
      return { workflow, matchedTrigger };
    }
  }

  return null;
}
