import type { AppServiceHandler } from "../../types/runtime.js";
import { resolveGitHubProviderConfig } from "./github-config.js";
import {
  createGitHubRedeliveryWorker,
  type GitHubRedeliveryWorker,
  type GitHubRedeliveryWorkerOptions
} from "./github-redelivery-worker.js";

export interface CreateGitHubRedeliveryServiceOptions {
  createWorker?: (options: GitHubRedeliveryWorkerOptions) => GitHubRedeliveryWorker;
}

export function createGitHubRedeliveryService(
  options: CreateGitHubRedeliveryServiceOptions = {}
): AppServiceHandler {
  const createWorker = options.createWorker ?? createGitHubRedeliveryWorker;

  return async (app) => {
    const github = resolveGitHubProviderConfig(app.config.gh);
    const worker = createWorker({
      github,
      tracking: app.config.tracking,
      env: app.env,
      logSink: app.log
    });

    worker.start();
    app.on("shutdown", async () => {
      await worker.stop();
    });
  };
}
