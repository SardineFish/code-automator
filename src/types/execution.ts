export type ExecutorRunStatus = "success" | "failed" | "error";

export interface ProcessRunResult {
  pid?: number;
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  stdoutPath?: string;
  stderrPath?: string;
  timedOut: boolean;
  completedAt?: string;
}

export interface ExecutorRunResult {
  status: ExecutorRunStatus;
  executorName: string;
  command: string;
  workspacePath: string;
  startedAt: string;
  durationMs: number;
  process: ProcessRunResult;
  errorMessage?: string;
}

export interface DetachedProcessStartResult {
  pid: number;
  startedAt: string;
}

export interface WorkflowLaunchResult {
  status: "running";
  executorName: string;
  command: string;
  workspacePath: string;
  pid: number;
  startedAt: string;
}
