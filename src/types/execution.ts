export type ExecutorRunStatus = "success" | "failed" | "error";

export interface ProcessRunResult {
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
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
