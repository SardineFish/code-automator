import type { Server } from "node:http";

import { loadEnvironmentFromDotenv } from "../config/load-env-config.js";
import { loadServiceConfig } from "../config/load-service-config.js";
import { fetchGitHubInstallationTokenClient } from "../providers/github/github-installation-token-client.js";
import { createConsoleLogSink } from "../providers/logging/winston-log-sink.js";
import { shellProcessRunner } from "../providers/process/process-runner.js";
import { fileWorkflowTrackerRepo } from "../repo/tracking/file-workflow-tracker-repo.js";
import { defaultWorkspaceRepo } from "../repo/workspace/workspace-repo.js";
import { createInstallationTokenProvider } from "../service/github/create-installation-token-provider.js";
import { readGitHubProviderConfig } from "../service/github/read-github-provider-config.js";
import { createFileWorkflowTracker } from "../service/tracking/file-workflow-tracker.js";
import { App } from "./app.js";
import { createGitHubProviderHandler } from "./providers/github-provider.js";

const RECONCILE_INTERVAL_MS = 2000;

export async function startService(configPath: string): Promise<Server> {
  const environment = loadEnvironmentFromDotenv();
  const config = await loadServiceConfig(configPath);
  const logSink = createConsoleLogSink(config.logging.level);
  const github = readGitHubProviderConfig(config);
  const installationTokenProvider = createInstallationTokenProvider(
    environment.appPrivateKeyPath,
    fetchGitHubInstallationTokenClient
  );
  const workflowTracker = createFileWorkflowTracker(
    config.tracking,
    fileWorkflowTrackerRepo,
    logSink
  );

  await workflowTracker.initialize();
  await workflowTracker.reconcileActiveRuns(
    shellProcessRunner,
    defaultWorkspaceRepo,
    config.workspace
  );

  const reconcileTimer = setInterval(() => {
    void workflowTracker
      .reconcileActiveRuns(shellProcessRunner, defaultWorkspaceRepo, config.workspace)
      .catch((error) => {
        logSink.error({
          message: "workflow reconciliation failed",
          errorMessage: error instanceof Error ? error.message : "Unknown reconciliation error."
        });
      });
  }, RECONCILE_INTERVAL_MS);

  reconcileTimer.unref();
  const server = await App.listen(config.server.host, config.server.port, {
    config,
    processRunner: shellProcessRunner,
    workspaceRepo: defaultWorkspaceRepo,
    workflowTracker,
    logSink,
    baseEnv: process.env
  })
    .provider(
      github.url,
      createGitHubProviderHandler({
        github,
        webhookSecret: environment.webhookSecret,
        installationTokenProvider,
        logSink
      })
    )
    .listen();

  logSink.info({
    message: "server listening",
    host: config.server.host,
    port: config.server.port,
    routePath: github.url
  });

  return server;
}
