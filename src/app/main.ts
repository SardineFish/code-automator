import { pathToFileURL } from "node:url";

import { loadServiceConfig } from "../config/load-service-config.js";
import { createConsoleLogSink } from "../providers/logging/winston-log-sink.js";
import { App } from "./app.js";
import { createCliShutdownCoordinator } from "./cli-shutdown.js";
import { createAppRuntimeOptions, resolveBaseEnv } from "./default-app-runtime.js";
import { loadConfiguredExtensions } from "./load-configured-extensions.js";
import { resolveGitHubProviderConfig } from "./providers/github-config.js";
import { githubRedeliveryService } from "./providers/github-redelivery-service.js";
import { githubProvider } from "./providers/github-provider.js";
import { requireEnv } from "./providers/github-utils.js";
import { resolveConfigPath } from "./resolve-config-path.js";

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const configPath = resolveConfigPath(argv);
  const config = await loadServiceConfig(configPath);
  const github = resolveGitHubProviderConfig(config.gh);
  const baseEnv = resolveBaseEnv(undefined);
  const logSink = createConsoleLogSink(config.logging.level);
  const runtimeConfig = { ...config, gh: github };
  const runtimeOptions = createAppRuntimeOptions(runtimeConfig, { baseEnv, logSink });

  requireEnv(baseEnv, "GITHUB_WEBHOOK_SECRET");
  requireEnv(baseEnv, "GITHUB_APP_PRIVATE_KEY_PATH");

  const builder = App(runtimeConfig, runtimeOptions)
    .provider(github.url, githubProvider)
    .service(githubRedeliveryService);

  await loadConfiguredExtensions(builder, runtimeConfig, baseEnv, runtimeOptions.logSink);

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
