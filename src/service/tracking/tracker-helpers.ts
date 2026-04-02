import { readFile } from "node:fs/promises";

import type { WorkspaceConfig } from "../../types/config.js";
import type { ProcessRunResult } from "../../types/execution.js";
import type { ActiveWorkflowRunRecord, CompletedWorkflowRunRecord } from "../../types/tracking.js";
import type { WorkspaceRepo } from "../../repo/workspace/workspace-repo.js";

export function requireActiveRun(
  runId: string,
  record: ActiveWorkflowRunRecord | undefined
): ActiveWorkflowRunRecord {
  if (!record) {
    throw new Error(`Unknown active workflow run '${runId}'.`);
  }

  return record;
}

export async function readPid(pidFilePath: string): Promise<number | undefined> {
  try {
    const contents = await readFile(pidFilePath, "utf8");
    const pid = Number.parseInt(contents.trim(), 10);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

export async function cleanupWorkspace(
  workspaceRepo: WorkspaceRepo,
  workspace: WorkspaceConfig,
  workspacePath: string
): Promise<void> {
  if (!workspace.enabled || !workspace.cleanupAfterRun || workspacePath === "") {
    return;
  }

  await workspaceRepo.removeWorkspace(workspacePath);
}

export function getCompletedStatus(result: ProcessRunResult): CompletedWorkflowRunRecord["status"] {
  if (result.exitCode === 0 && !result.timedOut) {
    return "succeeded";
  }

  return "failed";
}
