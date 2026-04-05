import type { AppServiceHandler } from "../../types/runtime.js";
import { resolveGitHubProviderConfig } from "./github-config.js";
import {
  createGitHubRedeliveryWorker,
  type GitHubRedeliveryWorker,
  type GitHubRedeliveryWorkerOptions
} from "./github-redelivery-worker.js";

export const githubRedeliveryService: AppServiceHandler = async (app) => {
  await startGitHubRedeliveryService(app, createGitHubRedeliveryWorker);
};

export async function startGitHubRedeliveryService(
  app: Parameters<AppServiceHandler>[0],
  createWorker: (options: GitHubRedeliveryWorkerOptions) => GitHubRedeliveryWorker
): Promise<void> {
  if (!app.config.gh) {
    return;
  }

  const github = resolveGitHubProviderConfig(app.config.gh);
  const redelivery = github.redelivery;

  if (!redelivery) {
    return;
  }

  const worker = createWorker({
    github,
    tracking: app.config.tracking,
    env: app.env,
    logSink: app.log
  });

  app.scheduleInterval("github-redelivery", redelivery.intervalSeconds * 1000, () => worker.runOnce(), {
    mode: "skip"
  });
}
