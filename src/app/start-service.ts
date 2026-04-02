import type { Server } from "node:http";

import { loadEnvironmentFromDotenv } from "../config/load-env-config.js";
import { loadServiceConfig } from "../config/load-service-config.js";
import { fetchGitHubInstallationTokenClient } from "../providers/github/github-installation-token-client.js";
import { consoleJsonLogSink } from "../providers/logging/json-log-sink.js";
import { shellProcessRunner } from "../providers/process/process-runner.js";
import { fileWorkflowTrackerRepo } from "../repo/tracking/file-workflow-tracker-repo.js";
import { defaultWorkspaceRepo } from "../repo/workspace/workspace-repo.js";
import { createInstallationTokenProvider } from "../service/github/create-installation-token-provider.js";
import { readGitHubRuntimeConfig } from "../service/github/read-github-runtime-config.js";
import { processWebhookDelivery } from "../service/orchestration/process-webhook-delivery.js";
import { createFileWorkflowTracker } from "../service/tracking/file-workflow-tracker.js";
import { createWebhookServer } from "../runtime/http/create-webhook-server.js";

const RECONCILE_INTERVAL_MS = 2000;

export async function startService(configPath: string): Promise<Server> {
  const environment = loadEnvironmentFromDotenv();
  const config = await loadServiceConfig(configPath);
  const github = readGitHubRuntimeConfig(config);
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
  const server = createWebhookServer({
    routePath: github.url,
    whitelist: github.whitelist,
    webhookSecret: environment.webhookSecret,
    logSink: consoleJsonLogSink,
    onDelivery: (delivery) =>
      processWebhookDelivery({
        ...delivery,
        config,
        botHandle: github.botHandle,
        clientId: github.clientId,
        processRunner: shellProcessRunner,
        workspaceRepo: defaultWorkspaceRepo,
        installationTokenProvider,
        workflowTracker,
        logSink: consoleJsonLogSink,
        baseEnv: process.env
      })
  });

  await listen(server, config.server.port, config.server.host);

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

function listen(server: Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });
}
