import { pathToFileURL } from "node:url";

import { loadServiceConfig } from "../config/load-service-config.js";
import { createConsoleLogSink } from "../providers/logging/winston-log-sink.js";
import { App } from "./app.js";
import { requireBuiltInGitHubEnv, resolveBuiltInGitHubRuntimeConfig } from "./built-in-github.js";
import { createCliShutdownCoordinator } from "./cli-shutdown.js";
import { createAppRuntimeOptions, resolveBaseEnv } from "./default-app-runtime.js";
import { githubRedeliveryService } from "./providers/github-redelivery-service.js";
import { githubProvider } from "./providers/github-provider.js";
import { resolveConfigPath } from "./resolve-config-path.js";

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const configPath = resolveConfigPath(argv);
  const config = await loadServiceConfig(configPath);
  const { runtimeConfig, github } = resolveBuiltInGitHubRuntimeConfig(config);
  const baseEnv = resolveBaseEnv(undefined);
  const logSink = createConsoleLogSink(runtimeConfig.logging.level);
  const runtimeOptions = createAppRuntimeOptions(runtimeConfig, { baseEnv, logSink });
  const builder = App(runtimeConfig, runtimeOptions);

  requireBuiltInGitHubEnv(github, baseEnv);
  if (github) {
    builder.provider(github.url, githubProvider).service(githubRedeliveryService);
  }

  for (const extension of runtimeConfig.extensions) {
    builder.extension(extension.id, extension.use, extension.config);
  }

  const app = await builder.listen();
  const shutdown = createCliShutdownCoordinator({
    app,
    workflowTracker: runtimeOptions.workflowTracker
  });

  process.on("SIGINT", () => shutdown.handleSigint());
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown startup error."}\n`);
    process.exitCode = 1;
  });
}
