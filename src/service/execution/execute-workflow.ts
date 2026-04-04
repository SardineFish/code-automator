import type { ProcessRunner } from "../../providers/process/process-runner.js";
import type { WorkspaceRepo } from "../../repo/workspace/workspace-repo.js";
import type { ServiceConfig } from "../../types/config.js";
import type { WorkflowLaunchResult } from "../../types/execution.js";
import type { WorkflowRunArtifacts } from "../../types/tracking.js";
import { renderExecutorCommand } from "../template/render-workflow-template.js";
import { resolveExecutorWorkspace } from "./resolve-executor-workspace.js";
import { toShellLiteral } from "./shell-escape.js";
import { escapeWorkspaceKeyForPath } from "./workspace-key.js";

export interface ExecuteWorkflowOptions {
  config: ServiceConfig;
  executorName: string;
  prompt: string;
  artifacts: WorkflowRunArtifacts;
  installationToken?: string;
  triggerEnv?: Record<string, string>;
  workspacePath?: string;
  workspaceKey?: string;
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
  const env = buildExecutionEnv(options, executor.env);

  try {
    const command = renderExecutorCommand(executor.run, {
      prompt: toShellLiteral(options.prompt),
      workspace: toShellLiteral(workspacePath, { allowEmpty: true }),
      workspaceKey: toShellLiteral(options.workspaceKey ?? "", { allowEmpty: true }),
      env: buildExecutorTemplateEnv(env)
    });

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

function buildExecutionEnv(
  options: ExecuteWorkflowOptions,
  executorEnv: Record<string, string>
): NodeJS.ProcessEnv {
  const env = {
    ...options.baseEnv,
    ...executorEnv,
    ...options.triggerEnv
  };

  if (options.installationToken) {
    env.GH_TOKEN = options.installationToken;
  }

  return env;
}

function buildExecutorTemplateEnv(env: NodeJS.ProcessEnv): Record<string, string> {
  const templateEnv: Record<string, string> = {};

  for (const [key, value] of Object.entries(env)) {
    if (value !== undefined) {
      templateEnv[key] = toShellLiteral(value);
    }
  }

  templateEnv.NODE_BIN = toShellLiteral(process.execPath);
  return templateEnv;
}

async function resolveWorkspace(options: ExecuteWorkflowOptions): Promise<string> {
  const workspace = resolveExecutorWorkspace(options.config, options.executorName);

  if (!workspace.enabled) {
    return "";
  }

  if (options.workspaceKey !== undefined) {
    return options.workspaceRepo.ensureReusableWorkspace(
      workspace.baseDir,
      escapeWorkspaceKeyForPath(options.workspaceKey)
    );
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
  if (!options.config.workspace.cleanupAfterRun || workspacePath === "" || options.workspaceKey !== undefined) {
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
