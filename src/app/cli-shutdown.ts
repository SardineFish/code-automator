import type { WorkflowTracker } from "../service/tracking/workflow-tracker.js";
import type { AppLifecycle } from "./app.js";
import type { GitHubRedeliveryWorker } from "./providers/github-redelivery-worker.js";

const DEFAULT_POLL_INTERVAL_MS = 250;

export const SIGINT_DRAIN_MESSAGE =
  "SIGINT received, draining active workflows. Press Ctrl-C again to exit immediately.";
export const FORCED_SIGINT_EXIT_CODE = 130;

export type CliShutdownState = "running" | "draining" | "forced";

export interface CliShutdownCoordinator {
  getState(): CliShutdownState;
  handleSigint(): void;
  waitForShutdown(): Promise<void>;
}

export interface CliShutdownCoordinatorOptions {
  app: AppLifecycle;
  workflowTracker: Pick<WorkflowTracker, "getActiveRunCount">;
  redeliveryWorker: Pick<GitHubRedeliveryWorker, "stop">;
  exit?: (code: number) => void;
  pollIntervalMs?: number;
  sleep?: (ms: number) => Promise<void>;
  writeErrorLine?: (line: string) => void;
  writeLine?: (line: string) => void;
}

export function createCliShutdownCoordinator(
  options: CliShutdownCoordinatorOptions
): CliShutdownCoordinator {
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const sleep =
    options.sleep ??
    ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const writeErrorLine =
    options.writeErrorLine ??
    ((line: string) => {
      process.stderr.write(`${line}\n`);
    });
  const writeLine =
    options.writeLine ??
    ((line: string) => {
      process.stdout.write(`${line}\n`);
    });

  let state: CliShutdownState = "running";
  let shutdownPromise = Promise.resolve();

  return {
    getState() {
      return state;
    },
    handleSigint() {
      if (state === "forced") {
        return;
      }

      if (state === "draining") {
        state = "forced";
        exit(FORCED_SIGINT_EXIT_CODE);
        return;
      }

      state = "draining";
      writeLine(SIGINT_DRAIN_MESSAGE);
      shutdownPromise = drainGracefully()
        .then(() => {
          if (state !== "forced") {
            exit(0);
          }
        })
        .catch((error) => {
          if (state === "forced") {
            return;
          }

          writeErrorLine(
            `Failed to drain active workflows: ${
              error instanceof Error ? error.message : "Unknown shutdown error."
            }`
          );
          exit(1);
        });
    },
    waitForShutdown() {
      return shutdownPromise;
    }
  };

  async function drainGracefully(): Promise<void> {
    await options.app.stopAcceptingRequests();
    await options.redeliveryWorker.stop();
    await options.app.waitForIdleRequests();
    await waitForActiveRunsToDrain(options.workflowTracker, pollIntervalMs, sleep);
  }
}

async function waitForActiveRunsToDrain(
  workflowTracker: Pick<WorkflowTracker, "getActiveRunCount">,
  pollIntervalMs: number,
  sleep: (ms: number) => Promise<void>
): Promise<void> {
  while ((await workflowTracker.getActiveRunCount()) > 0) {
    await sleep(pollIntervalMs);
  }
}
