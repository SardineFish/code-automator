import type { WorkspaceRepo } from "../../repo/workspace/workspace-repo.js";
import { renderExecutorCommand } from "../template/render-workflow-template.js";
import type { ProcessRunner } from "../../providers/process/process-runner.js";
import type { ServiceConfig } from "../../types/config.js";
import type { ExecutorRunResult } from "../../types/execution.js";
import { toShellLiteral } from "./shell-escape.js";

export interface ExecuteWorkflowOptions {
  config: ServiceConfig;
  executorName: string;
  prompt: string;
  workspaceRepo: WorkspaceRepo;
  processRunner: ProcessRunner;
  baseEnv?: NodeJS.ProcessEnv;
}

export async function executeWorkflow(options: ExecuteWorkflowOptions): Promise<ExecutorRunResult> {
  const executor = options.config.executors[options.executorName];

  if (!executor) {
    return buildErrorResult(options.executorName, "", "", "Unknown executor.");
  }

  const started = new Date();
  const startedAtMs = Date.now();
  const startedAt = started.toISOString();
  let workspacePath = "";
  let result: ExecutorRunResult;

  try {
    workspacePath = await resolveWorkspace(options);
    const command = renderExecutorCommand(executor.run, {
      prompt: toShellLiteral(options.prompt),
      workspace: toShellLiteral(workspacePath, { allowEmpty: true })
    });
    const env = { ...options.baseEnv, ...executor.env };
    const processResult = await options.processRunner.run(command, {
      env,
      cwd: workspacePath || process.cwd(),
      timeoutMs: executor.timeoutMs
    });

    result = {
      status: processResult.exitCode === 0 && !processResult.timedOut ? "success" : "failed",
      executorName: options.executorName,
      command,
      workspacePath,
      startedAt,
      durationMs: Date.now() - startedAtMs,
      process: processResult
    };
  } catch (error) {
    result = buildErrorResult(
      options.executorName,
      "",
      workspacePath,
      error instanceof Error ? error.message : "Unknown execution error.",
      startedAt,
      startedAtMs
    );
  }

  const cleanupError = await cleanupWorkspace(options, workspacePath);

  if (cleanupError) {
    return {
      ...result,
      status: "error",
      errorMessage: cleanupError.message
    };
  }

  return result;
}

async function resolveWorkspace(options: ExecuteWorkflowOptions): Promise<string> {
  if (!options.config.workspace.enabled) {
    return "";
  }

  return options.workspaceRepo.createRunWorkspace(options.config.workspace.baseDir);
}

async function cleanupWorkspace(
  options: ExecuteWorkflowOptions,
  workspacePath: string
): Promise<Error | null> {
  if (!options.config.workspace.enabled || !options.config.workspace.cleanupAfterRun || workspacePath === "") {
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

function buildErrorResult(
  executorName: string,
  command: string,
  workspacePath: string,
  message: string,
  startedAt = new Date().toISOString(),
  startedAtMs = Date.now()
): ExecutorRunResult {
  return {
    status: "error",
    executorName,
    command,
    workspacePath,
    startedAt,
    durationMs: Date.now() - startedAtMs,
    process: { exitCode: null, signal: null, stdout: "", stderr: "", timedOut: false },
    errorMessage: message
  };
}
