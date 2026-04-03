import type { ProcessRunner } from "../../providers/process/process-runner.js";
import type { WorkspaceRepo } from "../../repo/workspace/workspace-repo.js";
import type { ExecutorConfig, ServiceConfig } from "../../types/config.js";
import type { WorkflowLaunchResult } from "../../types/execution.js";
import type { WorkflowRunArtifacts } from "../../types/tracking.js";
import { renderExecutorCommand } from "../template/render-workflow-template.js";
import { toShellLiteral } from "./shell-escape.js";

export interface ExecuteWorkflowOptions {
  config: ServiceConfig;
  executorName: string;
  prompt: string;
  artifacts: WorkflowRunArtifacts;
  installationToken?: string;
  triggerEnv?: Record<string, string>;
  workspacePath?: string;
  workspaceRepo: WorkspaceRepo;
  processRunner: ProcessRunner;
  baseEnv?: NodeJS.ProcessEnv;
}

export async function executeWorkflow(options: ExecuteWorkflowOptions): Promise<WorkflowLaunchResult> {
  const executor = options.config.executors[options.executorName];

  if (!executor) {
    throw new Error("Unknown executor.");
  }

  const workspacePath = options.workspacePath ?? (await prepareWorkspace(options));

  try {
    const command = renderExecutorCommand(executor.run, {
      prompt: toShellLiteral(options.prompt),
      workspace: toShellLiteral(workspacePath, { allowEmpty: true })
    });
    const env = {
      ...options.baseEnv,
      ...executor.env,
      ...options.triggerEnv
    };

    if (options.installationToken) {
      env.GH_TOKEN = options.installationToken;
    }

    const startedProcess = await options.processRunner.startDetached(command, {
      artifacts: options.artifacts,
      env,
      cwd: workspacePath || process.cwd(),
      timeoutMs: executor.timeoutMs
    });

    return {
      status: "running",
      executorName: options.executorName,
      command,
      workspacePath,
      pid: startedProcess.pid,
      startedAt: startedProcess.startedAt
    };
  } catch (error) {
    const cleanupError = await cleanupWorkspace(options, workspacePath);

    if (cleanupError) {
      throw cleanupError;
    }

    throw error;
  }
}

async function resolveWorkspace(options: ExecuteWorkflowOptions): Promise<string> {
  const workspace = resolveExecutorWorkspace(options.config, options.executorName);

  if (!workspace.enabled) {
    return "";
  }

  return options.workspaceRepo.createRunWorkspace(workspace.baseDir);
}

export async function prepareWorkspace(options: ExecuteWorkflowOptions): Promise<string> {
  return resolveWorkspace(options);
}

async function cleanupWorkspace(
  options: ExecuteWorkflowOptions,
  workspacePath: string
): Promise<Error | null> {
  if (!options.config.workspace.cleanupAfterRun || workspacePath === "") {
    return null;
  }

  try {
    await options.workspaceRepo.removeWorkspace(workspacePath);
    return null;
  } catch (error) {
    return new Error(
      `Workspace cleanup failed: ${error instanceof Error ? error.message : "Unknown cleanup error."}`
    );
  }
}

function resolveExecutorWorkspace(
  config: ServiceConfig,
  executorName: string
): { enabled: boolean; baseDir: string } {
  const executor = config.executors[executorName];

  if (!executor) {
    throw new Error("Unknown executor.");
  }

  return resolveExecutorWorkspaceSetting(config.workspace, executor);
}

function resolveExecutorWorkspaceSetting(
  workspace: ServiceConfig["workspace"],
  executor: ExecutorConfig
): { enabled: boolean; baseDir: string } {
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

  return {
    enabled: true,
    baseDir: executor.workspace
  };
}
