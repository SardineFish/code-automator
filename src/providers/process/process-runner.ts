import { spawn } from "node:child_process";

import type { ProcessRunResult } from "../../types/execution.js";

const SIGKILL_GRACE_MS = 1000;

export interface ProcessRunOptions {
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs?: number;
}

export interface ProcessRunner {
  run(command: string, options: ProcessRunOptions): Promise<ProcessRunResult>;
}

export const shellProcessRunner: ProcessRunner = {
  run(command, options) {
    return new Promise<ProcessRunResult>((resolve, reject) => {
      const child = spawn("/bin/sh", ["-lc", command], {
        cwd: options.cwd,
        env: options.env,
        stdio: ["ignore", "pipe", "pipe"]
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let settled = false;
      let timeoutId: NodeJS.Timeout | undefined;
      let killId: NodeJS.Timeout | undefined;

      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        stdout += chunk;
      });

      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        stderr += chunk;
      });

      if (options.timeoutMs && options.timeoutMs > 0) {
        timeoutId = setTimeout(() => {
          timedOut = true;
          child.kill("SIGTERM");
          killId = setTimeout(() => {
            child.kill("SIGKILL");
          }, SIGKILL_GRACE_MS);
        }, options.timeoutMs);
      }

      child.on("error", (error) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimers(timeoutId, killId);
        reject(error);
      });

      child.on("close", (exitCode, signal) => {
        if (settled) {
          return;
        }

        settled = true;
        clearTimers(timeoutId, killId);
        resolve({
          exitCode,
          signal,
          stdout,
          stderr,
          timedOut
        });
      });
    });
  }
};

function clearTimers(...timers: Array<NodeJS.Timeout | undefined>): void {
  for (const timer of timers) {
    if (timer) {
      clearTimeout(timer);
    }
  }
}
