import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";

import type { DetachedProcessStartResult, ProcessRunResult } from "../../types/execution.js";
import type { WorkflowRunArtifacts } from "../../types/tracking.js";
import { buildDetachedWrapperScript, isErrnoException } from "./detached-process-helpers.js";

const SIGKILL_GRACE_MS = 1000;

export interface ProcessRunOptions {
  env: NodeJS.ProcessEnv;
  cwd: string;
  timeoutMs?: number;
}

export interface ProcessRunner {
  run(command: string, options: ProcessRunOptions): Promise<ProcessRunResult>;
  startDetached(
    command: string,
    options: ProcessRunOptions & { artifacts: WorkflowRunArtifacts }
  ): Promise<DetachedProcessStartResult>;
  isProcessRunning(pid: number): boolean;
  readDetachedResult(resultFilePath: string): Promise<ProcessRunResult | null>;
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
  },
  async startDetached(command, options) {
    const wrapperScript = buildDetachedWrapperScript(command, options);

    await writeFile(options.artifacts.wrapperScriptPath, wrapperScript, { mode: 0o700 });

    return new Promise<DetachedProcessStartResult>((resolve, reject) => {
      const child = spawn("/bin/sh", [options.artifacts.wrapperScriptPath], {
        cwd: options.cwd,
        detached: true,
        env: options.env,
        stdio: ["ignore", "ignore", "ignore"]
      });

      child.once("error", reject);
      child.once("spawn", () => {
        if (!child.pid || child.pid < 1) {
          reject(new Error("Detached executor wrapper did not provide a valid PID."));
          return;
        }

        child.unref();
        void waitForPidFile(options.artifacts.pidFilePath)
          .then((pid) => {
            resolve({
              pid,
              startedAt: new Date().toISOString()
            });
          })
          .catch(reject);
      });
    });
  },
  isProcessRunning(pid) {
    if (pid < 1) {
      return false;
    }

    try {
      process.kill(pid, 0);
      return true;
    } catch (error) {
      return !isErrnoException(error, "ESRCH");
    }
  },
  async readDetachedResult(resultFilePath) {
    try {
      const contents = await readFile(resultFilePath, "utf8");
      return JSON.parse(contents) as ProcessRunResult;
    } catch (error) {
      if (isErrnoException(error, "ENOENT")) {
        return null;
      }

      throw error;
    }
  }
};

function clearTimers(...timers: Array<NodeJS.Timeout | undefined>): void {
  for (const timer of timers) {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

async function waitForPidFile(pidFilePath: string, timeoutMs = 1000): Promise<number> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    try {
      const contents = await readFile(pidFilePath, "utf8");
      const pid = Number.parseInt(contents.trim(), 10);

      if (Number.isInteger(pid) && pid > 0) {
        return pid;
      }
    } catch (error) {
      if (!isErrnoException(error, "ENOENT")) {
        throw error;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error("Detached executor wrapper did not write a valid command PID file.");
}
