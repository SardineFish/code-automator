import type { Server } from "node:http";

import { loadEnvironmentFromDotenv } from "../config/load-env-config.js";
import { loadServiceConfig } from "../config/load-service-config.js";
import { fetchGitHubInstallationTokenClient } from "../providers/github/github-installation-token-client.js";
import { consoleJsonLogSink } from "../providers/logging/json-log-sink.js";
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
  const github = readGitHubProviderConfig(config);
  const installationTokenProvider = createInstallationTokenProvider(
    environment.appPrivateKeyPath,
    fetchGitHubInstallationTokenClient
  );
  const workflowTracker = createFileWorkflowTracker(
    config.tracking,
    fileWorkflowTrackerRepo,
    consoleJsonLogSink
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
        consoleJsonLogSink.error({
          timestamp: new Date().toISOString(),
          level: "error",
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
    logSink: consoleJsonLogSink,
    baseEnv: process.env
  })
    .provider(
      github.url,
      createGitHubProviderHandler({
        github,
        webhookSecret: environment.webhookSecret,
        installationTokenProvider,
        logSink: consoleJsonLogSink
      })
    )
    .listen();

  consoleJsonLogSink.info({
    timestamp: new Date().toISOString(),
    level: "info",
    message: "server listening",
    host: config.server.host,
    port: config.server.port,
    routePath: github.url
  });

  return server;
}
