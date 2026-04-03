import type { ExecutorConfig, ServiceConfig, WorkspaceConfig } from "../../types/config.js";

export interface ResolvedExecutorWorkspace {
  enabled: boolean;
  baseDir: string;
  key?: string;
}

export function resolveExecutorWorkspace(
  config: ServiceConfig,
  executorName: string
): ResolvedExecutorWorkspace {
  const executor = config.executors[executorName];

  if (!executor) {
    throw new Error("Unknown executor.");
  }

  return resolveExecutorWorkspaceSetting(config.workspace, executor);
}

export function resolveExecutorWorkspaceSetting(
  workspace: WorkspaceConfig,
  executor: ExecutorConfig
): ResolvedExecutorWorkspace {
  if (executor.workspace === undefined) {
    return {
      enabled: workspace.enabled,
      baseDir: workspace.baseDir
    };
  }

  if (executor.workspace === false) {
    return {
      enabled: false,
      baseDir: workspace.baseDir
    };
  }

  if (executor.workspace === true) {
    return {
      enabled: true,
      baseDir: workspace.baseDir
    };
  }

  if (typeof executor.workspace === "string") {
    return {
      enabled: true,
      baseDir: executor.workspace
    };
  }

  return {
    enabled: true,
    baseDir: executor.workspace.baseDir ?? workspace.baseDir,
    key: executor.workspace.key
  };
}
