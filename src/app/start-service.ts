import type { Server } from "node:http";

import { loadEnvironmentFromDotenv } from "../config/load-env-config.js";
import { loadServiceConfig } from "../config/load-service-config.js";
import { consoleJsonLogSink } from "../providers/logging/json-log-sink.js";
import { shellProcessRunner } from "../providers/process/process-runner.js";
import { defaultWorkspaceRepo } from "../repo/workspace/workspace-repo.js";
import { processWebhookDelivery } from "../service/orchestration/process-webhook-delivery.js";
import { createWebhookServer } from "../runtime/http/create-webhook-server.js";

export async function startService(configPath: string): Promise<Server> {
  const environment = loadEnvironmentFromDotenv();
  const config = await loadServiceConfig(configPath);
  const server = createWebhookServer({
    config,
    webhookSecret: environment.webhookSecret,
    logSink: consoleJsonLogSink,
    onDelivery: (delivery) =>
      processWebhookDelivery({
        ...delivery,
        config,
        processRunner: shellProcessRunner,
        workspaceRepo: defaultWorkspaceRepo,
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
    webhookPath: config.server.webhookPath
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
