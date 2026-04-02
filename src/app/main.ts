import { pathToFileURL } from "node:url";

import { loadServiceConfig } from "../config/load-service-config.js";
import { createConsoleLogSink } from "../providers/logging/winston-log-sink.js";
import { App } from "./app.js";
import { resolveBaseEnv } from "./default-app-runtime.js";
import { resolveGitHubProviderConfig } from "./providers/github-config.js";
import { githubProvider } from "./providers/github-provider.js";
import { createGitHubRedeliveryWorker } from "./providers/github-redelivery-worker.js";
import { requireEnv } from "./providers/github-utils.js";
import { resolveConfigPath } from "./resolve-config-path.js";

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<void> {
  const configPath = resolveConfigPath(argv);
  const config = await loadServiceConfig(configPath);
  const github = resolveGitHubProviderConfig(config.gh);
  const baseEnv = resolveBaseEnv(undefined);
  const logSink = createConsoleLogSink(config.logging.level);
  const runtimeConfig = { ...config, gh: github };

  requireEnv(baseEnv, "GITHUB_WEBHOOK_SECRET");
  requireEnv(baseEnv, "GITHUB_APP_PRIVATE_KEY_PATH");

  const redeliveryWorker = createGitHubRedeliveryWorker({
    github,
    tracking: runtimeConfig.tracking,
    env: baseEnv,
    logSink
  });

  await App(runtimeConfig, { baseEnv, logSink })
    .provider(github.url, githubProvider)
    .listen();

  redeliveryWorker.start();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "Unknown startup error."}\n`);
    process.exitCode = 1;
  });
}
